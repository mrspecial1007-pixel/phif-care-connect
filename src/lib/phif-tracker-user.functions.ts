import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const confirmPhifTrackerIdentity = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ identifier: z.string().trim().min(3).max(160), pin: z.string().min(3).max(80) }).strict().parse(input))
  .handler(async ({ data }) => {
    const { requirePharmacySession, verifyPin, rateLimit, clearRateLimit } = await import("./pharmacy-session.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getRequestIP } = await import("@tanstack/react-start/server");
    const { confirmPhifTrackerUser } = await import("./phif-tracker-user.server");
    const context = await requirePharmacySession();
    const key = `phif-identity:${context.pharmacy_id}:${getRequestIP({ xForwardedFor: true }) || "unknown"}:${data.identifier.toLowerCase()}`;
    if (!rateLimit(key).ok) throw new Error("محاولات كثيرة؛ انتظر دقيقة قبل المحاولة مجددًا");
    const result = await confirmPhifTrackerUser(supabaseAdmin, context, data, verifyPin);
    clearRateLimit(key);
    return result;
  });
