import { createServerFn } from "@tanstack/react-start";

export const getRecentActivity = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const sinceIso = since.toISOString();

  const [txRes, auditRes] = await Promise.all([
    supabaseAdmin
      .from("dispensing_transactions")
      .select("id, dispensing_date, transaction_type, items_dispensed, items_remaining, notes, created_at, patient_id, pharmacy_id, patients(patient_name, insurance_card_number), pharmacies(name)")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin
      .from("audit_log")
      .select("id, action, entity, entity_id, before, after, created_at, pharmacy_id")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  return {
    transactions: txRes.data ?? [],
    audit: auditRes.data ?? [],
  };
});

export const exportAllData = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [patients, cycles, txs, audit, pharmacies] = await Promise.all([
    supabaseAdmin.from("patients").select("*"),
    supabaseAdmin.from("dispensing_cycles").select("*"),
    supabaseAdmin.from("dispensing_transactions").select("*, patients(patient_name), pharmacies(name)"),
    supabaseAdmin.from("audit_log").select("*"),
    supabaseAdmin.from("pharmacies").select("id, name, created_at"),
  ]);
  return {
    patients: patients.data ?? [],
    cycles: cycles.data ?? [],
    transactions: txs.data ?? [],
    audit: audit.data ?? [],
    pharmacies: pharmacies.data ?? [],
  };
});