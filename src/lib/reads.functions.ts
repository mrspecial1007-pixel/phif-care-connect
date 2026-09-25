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
import { authorizePatientForSessionPharmacy, patientAccessSetsForSession, TIRYAQ_PHARMACY_NAME } from "@/lib/pharmacy-isolation";
import { buildPhifMedicationProfileFromRows } from "@/lib/phif-invoices.functions";

const idSchema = z.object({ id: z.string().uuid() });

async function ctx() {
  const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { pharmacy_id, pharmacy_name } = await requirePharmacySession();
  return { pharmacy_id, pharmacy_name, admin: supabaseAdmin };
}

/**
 * Returns { served, anyTx } sets over all patients.
 * Paged: PostgREST caps a single response at 1000 rows, so an unpaged scan
 * would silently under-report and leak other pharmacies' beneficiaries.
 */
async function authorizePatient(admin: any, pharmacyId: string, patientId: string) {
  return authorizePatientForSessionPharmacy(admin, pharmacyId, patientId);
}

function dateOnly(value: string | null | undefined) {
  return value ? String(value).slice(0, 10) : null;
}

function compareDates(a: string | null | undefined, b: string | null | undefined) {
  if (!a) return b ? -1 : 0;
  if (!b) return 1;
  return dateOnly(a)!.localeCompare(dateOnly(b)!);
}

export function mergeDueTracks(manualTracks: any[] = [], phifDueSummaries: any[] = []) {
  const byDate = new Map<string, any>();
  for (const track of manualTracks ?? []) {
    if (!track?.next_due_date) continue;
    byDate.set(track.next_due_date, { ...track, source: "manual" });
  }
  for (const summary of phifDueSummaries ?? []) {
    if (!summary?.next_due_date) continue;
    const existing = byDate.get(summary.next_due_date);
    if (existing) {
      byDate.set(summary.next_due_date, {
        ...existing,
        source: existing.source === "manual" ? "manual+phif" : existing.source,
        phif_item_count: summary.item_count,
      });
    } else {
      byDate.set(summary.next_due_date, {
        id: `phif:${summary.next_due_date}`,
        next_due_date: summary.next_due_date,
        remaining_days: summary.days_until_due,
        status: "PHIF",
        source: "phif",
        phif_item_count: summary.item_count,
      });
    }
  }
  return [...byDate.values()].sort((a, b) => String(a.next_due_date).localeCompare(String(b.next_due_date)));
}

export function buildPhifHistoryRows(profile: any, pharmacyId: string, pharmacyName: string) {
  const phifRowsByInvoice = new Map<string, any>();
  for (const item of profile?.items ?? []) {
    for (const movement of item.movements ?? []) {
      const existing = phifRowsByInvoice.get(movement.invoice_id) ?? {
        id: `phif:${movement.invoice_id}`,
        source: "phif",
        dispensing_date: movement.dispensing_date ? `${movement.dispensing_date}T12:00:00Z` : null,
        transaction_type: "PHIF",
        items_dispensed: 0,
        items_remaining: null,
        notes: "",
        pharmacy_id: pharmacyId,
        cycle_id: null,
        is_cancelled: false,
        cancellation_reason: null,
        invoice_id: movement.invoice_id,
        invoice_number: movement.invoice_number,
        invoice_key: movement.invoice_key,
        phif_items: [],
        reconciliation_status: profile.reconciliation?.some((row: any) => row.kind === "ambiguous" && row.phif_invoice_id === movement.invoice_id)
          ? "needs_review"
          : "phif",
        pharmacies: { name: pharmacyName },
      };
      existing.phif_items.push({
        name: [movement.active_ingredient, movement.strength, movement.brand].filter(Boolean).join(" - "),
        quantity: movement.quantity,
        source_classification: movement.source_classification,
      });
      existing.items_dispensed = existing.phif_items.length;
      existing.notes = existing.phif_items.map((phifItem: any) => `${phifItem.name}${phifItem.quantity ? ` (${phifItem.quantity})` : ""}`).join("، ");
      phifRowsByInvoice.set(movement.invoice_id, existing);
    }
  }
  return [...phifRowsByInvoice.values()];
}

async function loadPatientPhifProfile(admin: any, pharmacyId: string, patientId: string, insuranceCardNumber?: string | null, manualTransactions: any[] = []) {
  let invoiceQuery = admin
    .from("phif_invoices")
    .select("id, invoice_key, invoice_number, insurance_card_number, beneficiary_name, dispensing_date, dispensing_time, status, synced_at, patient_id, review_status")
    .eq("pharmacy_id", pharmacyId)
    .order("dispensing_date", { ascending: false, nullsFirst: false })
    .limit(500);

  if (insuranceCardNumber) {
    invoiceQuery = invoiceQuery.or(`patient_id.eq.${patientId},insurance_card_number.eq.${insuranceCardNumber}`);
  } else {
    invoiceQuery = invoiceQuery.eq("patient_id", patientId);
  }

  const { data: invoices, error: invoiceError } = await invoiceQuery;
  if (invoiceError) throw new Error(invoiceError.message);
  const invoiceIds = (invoices ?? []).map((invoice: any) => invoice.id);
  if (invoiceIds.length === 0) return buildPhifMedicationProfileFromRows([], [], manualTransactions);

  const { data: items, error: itemError } = await admin
    .from("phif_invoice_items")
    .select("id, phif_invoice_id, phif_item_id, active_ingredient, strength, brand, quantity, supplier, source_classification, phif_financial_fields, metadata, created_at")
    .in("phif_invoice_id", invoiceIds);
  if (itemError) throw new Error(itemError.message);

  return buildPhifMedicationProfileFromRows(invoices ?? [], items ?? [], manualTransactions);
}

async function loadPhifStatusProfiles(admin: any, pharmacyId: string, rows: any[]) {
  const patients = rows.map((row) => ({
    id: row.patient_id,
    card: row.insurance_card_number ?? null,
  }));
  const patientIds = new Set(patients.map((patient) => patient.id));
  const cards = new Set(patients.map((patient) => patient.card).filter(Boolean));
  if (patientIds.size === 0 && cards.size === 0) return new Map<string, ReturnType<typeof buildPhifMedicationProfileFromRows>>();

  const invoices: any[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("phif_invoices")
      .select("id, invoice_key, invoice_number, insurance_card_number, beneficiary_name, dispensing_date, dispensing_time, status, synced_at, patient_id, review_status")
      .eq("pharmacy_id", pharmacyId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    invoices.push(...page.filter((invoice: any) => patientIds.has(invoice.patient_id) || (invoice.insurance_card_number && cards.has(invoice.insurance_card_number))));
    if (page.length < PAGE) break;
  }

  const invoiceIds = invoices.map((invoice) => invoice.id);
  const items: any[] = [];
  for (let index = 0; index < invoiceIds.length; index += 500) {
    const batch = invoiceIds.slice(index, index + 500);
    if (batch.length === 0) continue;
    const { data, error } = await admin
      .from("phif_invoice_items")
      .select("id, phif_invoice_id, phif_item_id, active_ingredient, strength, brand, quantity, supplier, source_classification, phif_financial_fields, metadata, created_at")
      .in("phif_invoice_id", batch);
    if (error) throw new Error(error.message);
    items.push(...(data ?? []));
  }

  const byPatient = new Map<string, { invoices: any[]; items: any[] }>();
  for (const patient of patients) byPatient.set(patient.id, { invoices: [], items: [] });
  const ownerByInvoice = new Map<string, string>();
  for (const invoice of invoices) {
    const owner = patients.find((patient) => invoice.patient_id === patient.id || (!!patient.card && invoice.insurance_card_number === patient.card));
    if (!owner) continue;
    byPatient.get(owner.id)?.invoices.push(invoice);
    ownerByInvoice.set(invoice.id, owner.id);
  }
  for (const item of items) {
    const ownerId = ownerByInvoice.get(item.phif_invoice_id);
    if (ownerId) byPatient.get(ownerId)?.items.push(item);
  }

  const profiles = new Map<string, ReturnType<typeof buildPhifMedicationProfileFromRows>>();
  for (const [patientId, group] of byPatient) {
    profiles.set(patientId, buildPhifMedicationProfileFromRows(group.invoices, group.items, []));
  }
  return profiles;
}

export const listPatientStatuses = createServerFn({ method: "GET" }).handler(async () => {
  const { pharmacy_id, pharmacy_name, admin } = await ctx();
  const { served, anyTx, excluded } = await patientAccessSetsForSession(admin, pharmacy_id);
  const rows: any[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("v_patient_status")
      .select("*")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  const filtered = rows.filter((r: any) => !excluded.has(r.patient_id) && (served.has(r.patient_id) || !anyTx.has(r.patient_id)));
  if (pharmacy_name !== TIRYAQ_PHARMACY_NAME) return filtered;

  const phifProfiles = await loadPhifStatusProfiles(admin, pharmacy_id, filtered);
  return filtered.map((row: any) => {
    const profile = phifProfiles.get(row.patient_id);
    if (!profile || profile.items.length === 0) return row;

    const mergedTracks = mergeDueTracks(row.active_tracks ?? row.tracks ?? [], profile.due_summaries);
    const nearestTrack = mergedTracks[0] ?? null;
    const latestPhifDate = profile.items
      .map((item) => item.latest_dispensing_date)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
    const lastDispensingDate = compareDates(latestPhifDate, row.last_dispensing_date) > 0 ? latestPhifDate : row.last_dispensing_date;

    return {
      ...row,
      next_due_date: nearestTrack?.next_due_date ?? row.next_due_date,
      remaining_days: nearestTrack?.remaining_days ?? row.remaining_days,
      active_tracks_count: mergedTracks.length,
      active_tracks: mergedTracks,
      tracks: mergedTracks,
      last_dispensing_date: lastDispensingDate,
      phif_due_summaries: profile.due_summaries,
      phif_nearest_due_item_count: profile.nearest_due_item_count,
    };
  });
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
    const { pharmacy_id, pharmacy_name, admin } = await ctx();
    if (!(await authorizePatient(admin, pharmacy_id, data.id))) return [];
    const [{ data: rows }, { data: patient }] = await Promise.all([
      admin
      .from("dispensing_transactions")
      .select(
        "id, dispensing_date, transaction_type, items_dispensed, items_remaining, notes, pharmacy_id, cycle_id, is_cancelled, cancellation_reason, pharmacies!dispensing_transactions_pharmacy_id_fkey(name)",
      )
      .eq("patient_id", data.id)
      .eq("pharmacy_id", pharmacy_id)
      .order("dispensing_date", { ascending: false })
      .limit(200),
      admin.from("patients").select("insurance_card_number").eq("id", data.id).maybeSingle(),
    ]);
    const manualRows = rows ?? [];
    if (pharmacy_name !== TIRYAQ_PHARMACY_NAME) return manualRows;

    const profile = await loadPatientPhifProfile(admin, pharmacy_id, data.id, patient?.insurance_card_number ?? null, manualRows);
    const phifRows = buildPhifHistoryRows(profile, pharmacy_id, TIRYAQ_PHARMACY_NAME);

    return [...manualRows.map((row: any) => ({ ...row, source: "manual" })), ...phifRows].sort((a: any, b: any) =>
      String(b.dispensing_date ?? "").localeCompare(String(a.dispensing_date ?? "")),
    );
  });

/** Minimal eligibility projection only: no source_transaction_id, no stream_id, no notes. */
export const getPatientDueTracks = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    const { pharmacy_id, pharmacy_name, admin } = await ctx();
    if (!(await authorizePatient(admin, pharmacy_id, data.id))) return [];
    const [{ data: rows }, { data: patient }] = await Promise.all([
      admin
      .from("dispensing_due_tracks")
      .select("id, next_due_date, status")
      .eq("patient_id", data.id)
      .neq("status", "Completed")
      .order("next_due_date", { ascending: true }),
      admin.from("patients").select("insurance_card_number").eq("id", data.id).maybeSingle(),
    ]);
    const manualTracks = (rows ?? []).map((t: any) => ({
      id: t.id as string,
      next_due_date: t.next_due_date as string,
      status: t.status as string,
    }));
    if (pharmacy_name !== TIRYAQ_PHARMACY_NAME) return manualTracks;
    const profile = await loadPatientPhifProfile(admin, pharmacy_id, data.id, patient?.insurance_card_number ?? null);
    return mergeDueTracks(manualTracks, profile.due_summaries);
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
    if (data.type && data.type !== "all") q = q.eq("transaction_type", data.type as never);

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
