import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getRecentActivity = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const sinceIso = since.toISOString();

  const [txRes, auditRes, commRes] = await Promise.all([
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
    supabaseAdmin
      .from("communication_logs")
      .select("*, patients(patient_name), pharmacies(name)")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  return {
    transactions: txRes.data ?? [],
    audit: auditRes.data ?? [],
    communication: commRes.data ?? [],
  };
});

const logCommSchema = z.object({
  patientId: z.string().uuid(),
  pharmacyId: z.string().uuid(),
  actionType: z.string(),
  phoneNumber: z.string(),
  channel: z.enum(["WhatsApp", "SMS", "Call"]),
  patientStatus: z.string().optional(),
  remainingDays: z.number().optional(),
});

export const logCommunication = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => logCommSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("communication_logs").insert({
      patient_id: data.patientId,
      pharmacy_id: data.pharmacyId,
      action_type: data.actionType,
      phone_number: data.phoneNumber,
      channel: data.channel,
      patient_status: data.patientStatus,
      remaining_days: data.remainingDays,
    } as any);
    if (error) throw error;
    return { success: true };
  });

export const exportAllData = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [patients, cycles, txs, audit, pharmacies] = await Promise.all([
    supabaseAdmin.from("patients").select("*"),
    supabaseAdmin.from("dispensing_cycles").select("*"),
    supabaseAdmin.from("dispensing_transactions").select("*, patients(patient_name), pharmacies(name)"),
    supabaseAdmin.from("audit_log").select("*"),
    supabaseAdmin.from("pharmacies").select("id, name, address, phone, created_at"),
  ]);
  return {
    patients: patients.data ?? [],
    cycles: cycles.data ?? [],
    transactions: txs.data ?? [],
    audit: audit.data ?? [],
    pharmacies: pharmacies.data ?? [],
  };
});