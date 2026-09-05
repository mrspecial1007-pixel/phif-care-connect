/**
 * P0 security remediation: pharmacy-session-guarded server reads.
 *
 * Rule enforced here:
 *   Browser -> server function -> requirePharmacySession()
 *           -> resource authorization predicate -> database
 *           -> minimum required response -> Browser
 *
 * Authorization predicate for patient-scoped reads:
 *   SERVED_BY(session.pharmacy_id, patient_id) :=
 *     EXISTS (SELECT 1 FROM dispensing_transactions t
 *              WHERE t.patient_id = patient_id
 *                AND t.pharmacy_id = session.pharmacy_id)
 *   plus UNSERVED(patient_id) := no dispensing transaction exists at all
 *   (a newly registered beneficiary belongs to no pharmacy yet; without this
 *   the beneficiary would disappear right after creation).
 *
 * Unauthorized patient lookups return not_found so existence is not confirmed.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const idSchema = z.object({ id: z.string().uuid() });

async function ctx() {
  const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { pharmacy_id } = await requirePharmacySession();
  return { pharmacy_id, admin: supabaseAdmin };
}

/** Returns { served, unserved } sets over all patients (cheap 2-column scan). */
async function patientAccessSets(admin: any, pharmacyId: string) {
  const { data } = await admin
    .from("dispensing_transactions")
    .select("patient_id, pharmacy_id")
    .limit(100000);
  const served = new Set<string>();
  const anyTx = new Set<string>();
  for (const r of data ?? []) {
    anyTx.add(r.patient_id);
    if (r.pharmacy_id === pharmacyId) served.add(r.patient_id);
  }
  return { served, anyTx };
}

async function authorizePatient(admin: any, pharmacyId: string, patientId: string) {
  const { count: mine } = await admin
    .from("dispensing_transactions")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", patientId)
    .eq("pharmacy_id", pharmacyId);
  if ((mine ?? 0) > 0) return true;
  const { count: any } = await admin
    .from("dispensing_transactions")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", patientId);
  return (any ?? 0) === 0;
}

export const listPatientStatuses = createServerFn({ method: "GET" }).handler(async () => {
  const { pharmacy_id, admin } = await ctx();
  const { served, anyTx } = await patientAccessSets(admin, pharmacy_id);
  const { data, error } = await admin.from("v_patient_status").select("*").limit(5000);
  if (error) throw new Error(error.message);
  return (data ?? []).filter((r: any) => served.has(r.patient_id) || !anyTx.has(r.patient_id));
});

export const getPatient = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    const { pharmacy_id, admin } = await ctx();
    if (!(await authorizePatient(admin, pharmacy_id, data.id))) return null;
    const { data: row } = await admin.from("patients").select("*").eq("id", data.id).maybeSingle();
    return row ?? null;
  });

export const getPatientHistory = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    const { pharmacy_id, admin } = await ctx();
    if (!(await authorizePatient(admin, pharmacy_id, data.id))) return [];
    const { data: rows } = await admin
      .from("dispensing_transactions")
      .select(
        "id, dispensing_date, transaction_type, items_dispensed, items_remaining, notes, pharmacy_id, cycle_id, is_cancelled, cancellation_reason, pharmacies!dispensing_transactions_pharmacy_id_fkey(name)",
      )
      .eq("patient_id", data.id)
      .eq("pharmacy_id", pharmacy_id)
      .order("dispensing_date", { ascending: false })
      .limit(200);
    return rows ?? [];
  });

/** Minimal eligibility projection only: no source_transaction_id, no stream_id, no notes. */
export const getPatientDueTracks = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    const { pharmacy_id, admin } = await ctx();
    if (!(await authorizePatient(admin, pharmacy_id, data.id))) return [];
    const { data: rows } = await admin
      .from("dispensing_due_tracks")
      .select("id, next_due_date, status")
      .eq("patient_id", data.id)
      .neq("status", "Completed")
      .order("next_due_date", { ascending: true });
    return (rows ?? []).map((t: any) => ({
      id: t.id as string,
      next_due_date: t.next_due_date as string,
      status: t.status as string,
    }));
  });

export const getPatientTimeline = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    const { pharmacy_id, admin } = await ctx();
    if (!(await authorizePatient(admin, pharmacy_id, data.id))) return [];
    const [tx, comms] = await Promise.all([
      admin
        .from("dispensing_transactions")
        .select(
          "id, created_at, dispensing_date, transaction_type, notes, is_cancelled, cancellation_reason, pharmacies!dispensing_transactions_pharmacy_id_fkey(name)",
        )
        .eq("patient_id", data.id)
        .eq("pharmacy_id", pharmacy_id)
        .order("created_at", { ascending: false }),
      admin
        .from("communication_logs")
        .select("id, created_at, channel, action_type, pharmacies!communication_logs_pharmacy_id_fkey(name)")
        .eq("patient_id", data.id)
        .eq("pharmacy_id", pharmacy_id)
        .order("created_at", { ascending: false }),
    ]);
    return [
      ...(tx.data ?? []).map((t: any) => ({
        id: t.id,
        date: t.created_at,
        type: "dispense",
        title: t.is_cancelled ? "ملغاة" : t.transaction_type === "Completed" ? "صرف كامل" : "صرف جزئي",
        pharmacy: t.pharmacies?.name,
        details: t.is_cancelled ? `[ملغاة: ${t.cancellation_reason}] ${t.notes || ""}` : t.notes,
        is_cancelled: t.is_cancelled,
      })),
      ...(comms.data ?? []).map((c: any) => ({
        id: c.id,
        date: c.created_at,
        type: "comm",
        title: c.action_type,
        pharmacy: c.pharmacies?.name,
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  });

const txFilterSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  type: z.string().optional(),
});

export const listDispensingTransactions = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => txFilterSchema.parse(d ?? {}))
  .handler(async ({ data }) => {
    const { pharmacy_id, admin } = await ctx();
    let q = admin
      .from("dispensing_transactions")
      .select(
        `id, patient_id, transaction_type, items_dispensed, items_remaining, notes, dispensing_date, created_at, pharmacy_id, is_cancelled, cancellation_reason,
         patients(patient_name, insurance_card_number, national_id),
         pharmacies!dispensing_transactions_pharmacy_id_fkey(name)`,
      )
      .eq("pharmacy_id", pharmacy_id)
      .order("dispensing_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (data.startDate) q = q.gte("dispensing_date", `${data.startDate}T00:00:00Z`);
    if (data.endDate) q = q.lte("dispensing_date", `${data.endDate}T23:59:59Z`);
    if (data.type && data.type !== "all") q = q.eq("transaction_type", data.type);

    const { data: rows, error } = await q.limit(1000);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((d: any) => ({
      id: d.id,
      patient_id: d.patient_id,
      patient_name: d.patients?.patient_name || "مستفيد غير معروف",
      insurance_card_number: d.patients?.insurance_card_number ?? null,
      pharmacy_id: d.pharmacy_id,
      pharmacy_name: d.pharmacies?.name || "صيدلية غير معروفة",
      transaction_type: d.transaction_type,
      items_dispensed: d.items_dispensed,
      items_remaining: d.items_remaining,
      notes: d.notes,
      dispensing_date: d.dispensing_date,
      created_at: d.created_at,
      is_cancelled: d.is_cancelled,
      cancellation_reason: d.cancellation_reason,
    }));
  });

const pharmacyUpdateSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().optional(),
});

export const updateCurrentPharmacy = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => pharmacyUpdateSchema.parse(d))
  .handler(async ({ data }) => {
    const { pharmacy_id, admin } = await ctx();
    const { error } = await admin
      .from("pharmacies")
      .update({ name: data.name, address: data.address ?? null, phone: data.phone ?? null })
      .eq("id", pharmacy_id);
    if (error) return { ok: false as const };
    return { ok: true as const };
  });
