import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function writeAudit(input: {
  pharmacy_id: string | null;
  action: string;
  entity: string;
  entity_id?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}) {
  try {
    await supabaseAdmin.from("audit_log").insert({
      pharmacy_id: input.pharmacy_id,
      action: input.action,
      entity: input.entity,
      entity_id: input.entity_id ?? null,
      before: (input.before as any) ?? null,
      after: (input.after as any) ?? null,
      ip: input.ip ?? null,
    });
    if (input.pharmacy_id) {
      try {
        const { getPharmacySession } = await import("@/lib/pharmacy-session.server");
        const session = await getPharmacySession();
        await supabaseAdmin.from("user_operation_log").insert({
          pharmacy_id: input.pharmacy_id,
          user_id: session.data.user_id ?? null,
          action: input.action,
          entity: input.entity,
          entity_id: input.entity_id ?? null,
          metadata: {},
        });
      } catch {
        // The operation log table is additive; keep legacy audit reliable before migration rollout.
      }
    }
  } catch (e) {
    console.error("audit write failed", e);
  }
}
