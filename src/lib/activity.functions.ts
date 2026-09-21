import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getRecentActivity = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
  const { pharmacy_id: sessionPharmacyId } = await requirePharmacySession();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const sinceIso = since.toISOString();

  const [txRes, auditRes, commRes] = await Promise.all([
    supabaseAdmin
      .from("dispensing_transactions")
      .select("id, dispensing_date, transaction_type, items_dispensed, items_remaining, notes, created_at, patient_id, pharmacy_id, patients(patient_name, insurance_card_number), pharmacies(name)")
      .eq("pharmacy_id", sessionPharmacyId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin
      .from("audit_log")
      .select("id, action, entity, entity_id, before, after, created_at, pharmacy_id")
      .eq("pharmacy_id", sessionPharmacyId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin
      .from("communication_logs")
      .select("*, patients(patient_name), pharmacies(name)")
      .eq("pharmacy_id", sessionPharmacyId)
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
    const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
    const { pharmacy_id: sessionPharmacyId } = await requirePharmacySession();
    const { error } = await supabaseAdmin.from("communication_logs").insert({
      patient_id: data.patientId,
      pharmacy_id: sessionPharmacyId,
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
  const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
  const { patientAccessSetsForSession } = await import("@/lib/pharmacy-isolation");
  const { pharmacy_id: sessionPharmacyId } = await requirePharmacySession();
  const { served, anyTx, excluded } = await patientAccessSetsForSession(supabaseAdmin, sessionPharmacyId);
  const [patients, cycles, txs, audit, pharmacies] = await Promise.all([
    supabaseAdmin.from("patients").select("*"),
    supabaseAdmin.from("dispensing_cycles").select("*").eq("pharmacy_id", sessionPharmacyId),
    supabaseAdmin.from("dispensing_transactions").select("*, patients(patient_name), pharmacies(name)").eq("pharmacy_id", sessionPharmacyId),
    supabaseAdmin.from("audit_log").select("*").eq("pharmacy_id", sessionPharmacyId),
    supabaseAdmin.from("pharmacies").select("id, name, address, phone, created_at").eq("id", sessionPharmacyId),
  ]);
  return {
    patients: (patients.data ?? []).filter((p: any) => !excluded.has(p.id) && (served.has(p.id) || !anyTx.has(p.id))),
    cycles: cycles.data ?? [],
    transactions: txs.data ?? [],
    audit: audit.data ?? [],
    pharmacies: pharmacies.data ?? [],
  };
});
