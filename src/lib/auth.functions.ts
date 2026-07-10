import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const unlockSchema = z.object({
  pharmacy_id: z.string().uuid(),
  pin: z.string().min(3).max(20),
});

export const unlockPharmacy = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => unlockSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getPharmacySession, verifyPin, rateLimit, clearRateLimit } = await import(
      "@/lib/pharmacy-session.server"
    );
    const { writeAudit } = await import("@/lib/audit.server");
    const { getRequestIP } = await import("@tanstack/react-start/server");

    const ip = getRequestIP({ xForwardedFor: true }) ?? "unknown";
    const rlKey = `pin:${ip}:${data.pharmacy_id}`;
    const rl = rateLimit(rlKey);
    if (!rl.ok) {
      return { ok: false as const, error: "too_many_attempts" };
    }

    const { data: pharm } = await supabaseAdmin
      .from("pharmacies")
      .select("id, name, pin_hash")
      .eq("id", data.pharmacy_id)
      .maybeSingle();

    if (!pharm || !verifyPin(data.pin, pharm.pin_hash)) {
      await writeAudit({
        pharmacy_id: data.pharmacy_id,
        action: "unlock_failed",
        entity: "pharmacy",
        entity_id: data.pharmacy_id,
        ip,
      });
      return { ok: false as const, error: "invalid_pin" };
    }

    clearRateLimit(rlKey);
    const session = await getPharmacySession();
    await session.update({
      pharmacy_id: pharm.id,
      pharmacy_name: pharm.name,
      unlocked_at: Date.now(),
    });
    await writeAudit({
      pharmacy_id: pharm.id,
      action: "unlock",
      entity: "pharmacy",
      entity_id: pharm.id,
      ip,
    });
    return { ok: true as const, pharmacy: { id: pharm.id, name: pharm.name } };
  });

export const lockPharmacy = createServerFn({ method: "POST" }).handler(async () => {
  const { getPharmacySession } = await import("@/lib/pharmacy-session.server");
  const session = await getPharmacySession();
  await session.clear();
  return { ok: true as const };
});

export const currentSession = createServerFn({ method: "GET" }).handler(async () => {
  const { getPharmacySession } = await import("@/lib/pharmacy-session.server");
  const session = await getPharmacySession();
  if (!session.data.pharmacy_id) return { unlocked: false as const };
  return {
    unlocked: true as const,
    pharmacy: {
      id: session.data.pharmacy_id,
      name: session.data.pharmacy_name ?? "",
    },
  };
});