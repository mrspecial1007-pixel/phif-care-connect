import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const unlockSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(3).max(80),
  remember: z.boolean().optional(),
});

export const unlockPharmacy = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => unlockSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getPharmacySession, verifyPin, rateLimit, clearRateLimit } = await import(
      "@/lib/pharmacy-session.server"
    );
    const { adminPermissions, normalizePermissions } = await import("@/lib/user-permissions");
    const { writeAudit } = await import("@/lib/audit.server");
    const { getRequestIP } = await import("@tanstack/react-start/server");

    const ip = getRequestIP({ xForwardedFor: true }) ?? "unknown";
    const email = data.email.trim().toLowerCase();
    const rlKey = `login:${ip}:${email}`;
    const rl = rateLimit(rlKey);
    if (!rl.ok) {
      return { ok: false as const, error: "too_many_attempts" };
    }

    const { data: user } = await supabaseAdmin
      .from("pharmacy_users")
      .select("id, pharmacy_id, display_name, login_identifier, password_hash, role, permissions, is_active, pharmacies(id, name, address, phone)")
      .ilike("login_identifier", email)
      .maybeSingle();

    if (user) {
      const pharm = Array.isArray(user.pharmacies) ? user.pharmacies[0] : user.pharmacies;
      if (!user.is_active || !verifyPin(data.password, user.password_hash) || !pharm?.id) {
        return { ok: false as const, error: "invalid_pin" };
      }
      clearRateLimit(rlKey);
      await supabaseAdmin.from("pharmacy_users").update({ last_login_at: new Date().toISOString() }).eq("id", user.id);
      const session = await getPharmacySession(data.remember);
      await session.update({
        pharmacy_id: pharm.id,
        pharmacy_name: pharm.name,
        pharmacy_address: pharm.address ?? undefined,
        pharmacy_phone: pharm.phone ?? undefined,
        user_id: user.id,
        user_name: user.display_name,
        user_role: user.role === "admin" || user.role === "employee" ? user.role : "employee",
        user_permissions: user.role === "admin" ? adminPermissions() : normalizePermissions(user.permissions),
        unlocked_at: Date.now(),
      });
      await writeAudit({
        pharmacy_id: pharm.id,
        action: "user_login",
        entity: "pharmacy_user",
        entity_id: user.id,
        ip,
      });
      return { ok: true as const, pharmacy: { id: pharm.id, name: pharm.name } };
    }

    const { data: pharm } = await supabaseAdmin
      .from("pharmacies")
      .select("id, name, address, phone, pin_hash")
      .ilike("login_email", email)
      .maybeSingle();

    if (!pharm || !verifyPin(data.password, pharm.pin_hash)) {
      if (pharm?.id) {
        await writeAudit({
          pharmacy_id: pharm.id,
          action: "unlock_failed",
          entity: "pharmacy",
          entity_id: pharm.id,
          ip,
        });
      }
      return { ok: false as const, error: "invalid_pin" };
    }

    clearRateLimit(rlKey);
    const session = await getPharmacySession(data.remember);
    await session.update({
      pharmacy_id: pharm.id,
      pharmacy_name: pharm.name,
      pharmacy_address: pharm.address ?? undefined,
      pharmacy_phone: pharm.phone ?? undefined,
      user_role: "legacy",
      user_permissions: adminPermissions(),
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
      address: session.data.pharmacy_address ?? "",
      phone: session.data.pharmacy_phone ?? "",
    },
    user: session.data.user_role
      ? {
          id: session.data.user_id ?? null,
          name: session.data.user_name ?? (session.data.user_role === "legacy" ? "Legacy pharmacy session" : ""),
          role: session.data.user_role,
          permissions: session.data.user_permissions ?? {},
        }
      : null,
  };
});
