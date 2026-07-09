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
  } catch (e) {
    console.error("audit write failed", e);
  }
}