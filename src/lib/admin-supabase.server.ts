import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

let cached: ReturnType<typeof createClient<Database>> | null = null;

export function getAdminSupabase() {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server Supabase env not configured");
  cached = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export async function writeAudit(input: {
  pharmacy_id: string | null;
  action: string;
  entity: string;
  entity_id?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}) {
  const supabase = getAdminSupabase();
  await supabase.from("audit_log").insert({
    pharmacy_id: input.pharmacy_id,
    action: input.action,
    entity: input.entity,
    entity_id: input.entity_id ?? null,
    before: (input.before as any) ?? null,
    after: (input.after as any) ?? null,
    ip: input.ip ?? null,
  });
}