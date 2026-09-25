import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const TIRYAQ_PHARMACY_NAME = "صيدلية الترياق الشافي";

const listSchema = z.object({
  search: z.string().trim().max(120).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const detailSchema = z.object({
  id: z.string().uuid(),
});

const patientInvoicesSchema = z.object({
  patientId: z.string().uuid(),
});

const reviewListSchema = z.object({
  search: z.string().trim().max(120).optional(),
  includeRejected: z.boolean().optional(),
});

const cardSchema = z.object({
  insurance_card_number: z.string().trim().min(1).max(60),
});

const createPatientFromInvoiceSchema = cardSchema.extend({
  patient_name: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
});

const linkExistingPatientSchema = cardSchema.extend({
  patient_id: z.string().uuid(),
  confirm_card_mismatch: z.boolean().optional(),
});

export type PhifInvoiceArchiveRow = {
  id: string;
  invoice_key: string;
  invoice_number: string | null;
  insurance_card_number: string | null;
  beneficiary_name: string | null;
  dispensing_date: string | null;
  dispensing_time: string | null;
  status: string | null;
  synced_at: string;
  item_count: number;
  match_status: "matched" | "not_matched";
  review_status: "pending" | "linked" | "rejected";
  patient_id: string | null;
};

export type PhifInvoiceArchiveDetail = PhifInvoiceArchiveRow & {
  metadata: Record<string, unknown>;
  items: {
    id: string;
    phif_item_id: string | null;
    active_ingredient: string | null;
    strength: string | null;
    brand: string | null;
    quantity: number | null;
    supplier: string | null;
    source_classification: string | null;
    phif_financial_fields: Record<string, unknown>;
    metadata: Record<string, unknown>;
    created_at: string;
  }[];
};

export type PhifInvoiceReviewCase = {
  insurance_card_number: string;
  beneficiary_name: string | null;
  invoice_count: number;
  latest_dispensing_date: string | null;
  latest_synced_at: string | null;
  review_status: "pending" | "rejected";
  invoices: PhifInvoiceArchiveRow[];
};

export type PhifMedicationProfileMovement = {
  invoice_id: string;
  invoice_key: string;
  invoice_number: string | null;
  dispensing_date: string | null;
  status: string | null;
  quantity: number | null;
  active_ingredient: string | null;
  strength: string | null;
  brand: string | null;
  source_classification: string | null;
};

export type PhifMedicationProfileItem = {
  identity_key: string;
  brand: string | null;
  active_ingredient: string | null;
  strength: string | null;
  dosage_form: string | null;
  latest_quantity: number | null;
  total_quantity: number;
  latest_dispensing_date: string | null;
  next_due_date: string | null;
  days_until_due: number | null;
  needs_review: boolean;
  review_reasons: string[];
  movements: PhifMedicationProfileMovement[];
};

export type PhifDispensingReconciliationRow = {
  kind: "manual_matches_phif" | "date_mismatch" | "phif_without_manual" | "manual_without_phif" | "ambiguous";
  manual_transaction_id: string | null;
  manual_date: string | null;
  manual_type: string | null;
  phif_invoice_id: string | null;
  phif_invoice_number: string | null;
  phif_date: string | null;
  reason: string;
};

export type PhifMedicationProfile = {
  items: PhifMedicationProfileItem[];
  nearest_due_date: string | null;
  nearest_due_items: string[];
  nearest_due_item_count: number;
  due_summaries: PhifDueSummary[];
  reconciliation: PhifDispensingReconciliationRow[];
};

export type PhifDueSummary = {
  next_due_date: string;
  item_count: number;
  days_until_due: number | null;
};

async function requireTiryaqPhifArchiveAccess() {
  const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
  const session = await requirePharmacySession();
  if (session.pharmacy_name !== TIRYAQ_PHARMACY_NAME) {
    throw new Error("Unauthorized: PHIF invoice archive is only available for Tiryaq pharmacy");
  }
  return session;
}

function normalizeSearch(value: string | undefined) {
  return value?.trim() || "";
}

async function patientAccessSets(admin: any, pharmacyId: string) {
  const { patientAccessSetsForSession } = await import("@/lib/pharmacy-isolation");
  return patientAccessSetsForSession(admin, pharmacyId);
}

async function accessiblePatientsByCard(admin: any, pharmacyId: string, cards: (string | null)[]) {
  const uniqueCards = [...new Set(cards.filter(Boolean) as string[])];
  const matches = new Map<string, string>();
  if (uniqueCards.length === 0) return matches;

  const { data: patients, error } = await admin
    .from("patients")
    .select("id, insurance_card_number")
    .in("insurance_card_number", uniqueCards);
  if (error) throw new Error(error.message);

  const { served, anyTx, excluded } = await patientAccessSets(admin, pharmacyId);
  for (const patient of patients ?? []) {
    if (!patient?.id || !patient.insurance_card_number || excluded.has(patient.id)) continue;
    if (served.has(patient.id) || !anyTx.has(patient.id)) matches.set(patient.insurance_card_number, patient.id);
  }
  return matches;
}

async function itemCounts(admin: any, invoiceIds: string[]) {
  const counts = new Map<string, number>();
  if (invoiceIds.length === 0) return counts;

  const { data, error } = await admin
    .from("phif_invoice_items")
    .select("phif_invoice_id")
    .in("phif_invoice_id", invoiceIds);
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const id = (row as any).phif_invoice_id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function toArchiveRow(row: any, count: number, cardMatches: Map<string, string>): PhifInvoiceArchiveRow {
  const card = row.insurance_card_number ?? null;
  const linkedPatientId = row.patient_id ?? (card ? cardMatches.get(card) ?? null : null);
  return {
    id: row.id,
    invoice_key: row.invoice_key,
    invoice_number: row.invoice_number ?? null,
    insurance_card_number: card,
    beneficiary_name: row.beneficiary_name ?? null,
    dispensing_date: row.dispensing_date ?? null,
    dispensing_time: row.dispensing_time ?? null,
    status: row.status ?? null,
    synced_at: row.synced_at,
    item_count: count,
    match_status: linkedPatientId ? "matched" : "not_matched",
    review_status: row.review_status ?? "pending",
    patient_id: linkedPatientId,
  };
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function diffDays(from: string, to: string) {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

function daysUntil(date: string | null) {
  if (!date) return null;
  const today = new Date().toISOString().slice(0, 10);
  return diffDays(today, date);
}

function pickMetadataString(metadata: Record<string, unknown> | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = metadata?.[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function normalizeIdentityPart(value: unknown) {
  if (value === undefined || value === null) return "";
  return String(value).trim().toLowerCase();
}

export function phifMedicationIdentityKey(item: {
  phif_item_id?: string | null;
  active_ingredient?: string | null;
  strength?: string | null;
  brand?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  if (item.phif_item_id) return `phif:${normalizeIdentityPart(item.phif_item_id)}`;
  const dosageForm = pickMetadataString(item.metadata, ["dosage_form", "dosageForm", "form", "pharmaceuticalForm"]);
  return [
    "derived",
    normalizeIdentityPart(item.active_ingredient),
    normalizeIdentityPart(item.strength),
    normalizeIdentityPart(dosageForm),
    normalizeIdentityPart(item.brand),
  ].join("|");
}

export function buildPhifMedicationProfileFromRows(
  invoices: any[],
  items: any[],
  manualTransactions: any[] = [],
): PhifMedicationProfile {
  const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const grouped = new Map<string, { sample: any; movements: PhifMedicationProfileMovement[]; reasons: Set<string> }>();

  for (const item of items) {
    const invoice = invoicesById.get(item.phif_invoice_id);
    if (!invoice) continue;
    const key = phifMedicationIdentityKey(item);
    const group = grouped.get(key) ?? { sample: item, movements: [], reasons: new Set<string>() };
    if (!item.phif_item_id) group.reasons.add("مطابقة الصنف مشتقة من البيانات المتاحة وتحتاج مراجعة عند التشابه");
    if (!item.active_ingredient || !item.strength) group.reasons.add("بيانات المادة الفعالة أو التركيز غير مكتملة");
    group.movements.push({
      invoice_id: invoice.id,
      invoice_key: invoice.invoice_key,
      invoice_number: invoice.invoice_number ?? null,
      dispensing_date: invoice.dispensing_date ?? null,
      status: invoice.status ?? null,
      quantity: item.quantity ?? null,
      active_ingredient: item.active_ingredient ?? null,
      strength: item.strength ?? null,
      brand: item.brand ?? null,
      source_classification: item.source_classification ?? null,
    });
    grouped.set(key, group);
  }

  const profileItems = [...grouped.entries()].map(([identity_key, group]) => {
    const movements = group.movements.sort((a, b) => String(a.dispensing_date ?? "").localeCompare(String(b.dispensing_date ?? "")));
    for (let index = 1; index < movements.length; index++) {
      const prev = movements[index - 1].dispensing_date;
      const current = movements[index].dispensing_date;
      if (prev && current && diffDays(prev, current) < 28) {
        group.reasons.add("تكرار نفس الصنف خلال أقل من 28 يومًا يحتاج مراجعة");
      }
    }
    const dated = movements.filter((movement) => movement.dispensing_date);
    const latest = dated[dated.length - 1] ?? movements[movements.length - 1] ?? null;
    const latestDate = latest?.dispensing_date ?? null;
    const nextDue = latestDate ? addDays(latestDate, 28) : null;
    const dosageForm = pickMetadataString(group.sample.metadata, ["dosage_form", "dosageForm", "form", "pharmaceuticalForm"]);
    return {
      identity_key,
      brand: group.sample.brand ?? null,
      active_ingredient: group.sample.active_ingredient ?? null,
      strength: group.sample.strength ?? null,
      dosage_form: dosageForm,
      latest_quantity: latest?.quantity ?? null,
      total_quantity: movements.reduce((sum, movement) => sum + (movement.quantity ?? 0), 0),
      latest_dispensing_date: latestDate,
      next_due_date: nextDue,
      days_until_due: daysUntil(nextDue),
      needs_review: group.reasons.size > 0,
      review_reasons: [...group.reasons],
      movements: movements.sort((a, b) => String(b.dispensing_date ?? "").localeCompare(String(a.dispensing_date ?? ""))),
    } satisfies PhifMedicationProfileItem;
  });

  profileItems.sort((a, b) => String(a.next_due_date ?? "9999-12-31").localeCompare(String(b.next_due_date ?? "9999-12-31")));
  const nearestDueDate = profileItems.find((item) => item.next_due_date)?.next_due_date ?? null;
  const nearestDueItems = nearestDueDate
    ? profileItems
        .filter((item) => item.next_due_date === nearestDueDate)
        .map((item) => medicationDisplayName(item) || "صنف PHIF")
    : [];

  const dueSummaries = buildPhifDueSummaries(profileItems);

  return {
    items: profileItems,
    nearest_due_date: nearestDueDate,
    nearest_due_items: nearestDueItems,
    nearest_due_item_count: nearestDueItems.length,
    due_summaries: dueSummaries,
    reconciliation: buildPhifManualReconciliation(invoices, manualTransactions),
  };
}

export function buildPhifDueSummaries(items: { next_due_date?: string | null }[]): PhifDueSummary[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.next_due_date) continue;
    counts.set(item.next_due_date, (counts.get(item.next_due_date) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([next_due_date, item_count]) => ({
      next_due_date,
      item_count,
      days_until_due: daysUntil(next_due_date),
    }));
}

function medicationDisplayName(item: { active_ingredient?: string | null; strength?: string | null }) {
  return [item.active_ingredient, item.strength].filter(Boolean).join(" ").trim();
}

function dateOnly(value: string | null | undefined) {
  return value ? String(value).slice(0, 10) : null;
}

export function buildPhifManualReconciliation(invoices: any[], manualTransactions: any[]): PhifDispensingReconciliationRow[] {
  const rows: PhifDispensingReconciliationRow[] = [];
  const manualByDate = new Map<string, any[]>();
  const invoiceByDate = new Map<string, any[]>();

  for (const tx of manualTransactions) {
    const date = dateOnly(tx.dispensing_date);
    if (!date || tx.is_cancelled) continue;
    manualByDate.set(date, [...(manualByDate.get(date) ?? []), tx]);
  }
  for (const invoice of invoices) {
    const date = dateOnly(invoice.dispensing_date);
    if (!date) continue;
    invoiceByDate.set(date, [...(invoiceByDate.get(date) ?? []), invoice]);
  }

  const usedManual = new Set<string>();
  const usedInvoices = new Set<string>();
  for (const invoice of invoices) {
    const invoiceDate = dateOnly(invoice.dispensing_date);
    if (!invoiceDate) continue;
    const sameDay = manualByDate.get(invoiceDate) ?? [];
    if (sameDay.length === 1 && (invoiceByDate.get(invoiceDate) ?? []).length === 1) {
      const tx = sameDay[0];
      usedManual.add(tx.id);
      usedInvoices.add(invoice.id);
      rows.push({
        kind: "manual_matches_phif",
        manual_transaction_id: tx.id,
        manual_date: dateOnly(tx.dispensing_date),
        manual_type: tx.transaction_type ?? null,
        phif_invoice_id: invoice.id,
        phif_invoice_number: invoice.invoice_number ?? null,
        phif_date: invoiceDate,
        reason: "تاريخ واحد وحركة يدوية واحدة وفاتورة PHIF واحدة",
      });
      continue;
    }
    if (sameDay.length > 1 || (invoiceByDate.get(invoiceDate) ?? []).length > 1) {
      rows.push({
        kind: "ambiguous",
        manual_transaction_id: null,
        manual_date: invoiceDate,
        manual_type: null,
        phif_invoice_id: invoice.id,
        phif_invoice_number: invoice.invoice_number ?? null,
        phif_date: invoiceDate,
        reason: "توجد عدة حركات أو فواتير في نفس التاريخ وتحتاج مراجعة",
      });
      usedInvoices.add(invoice.id);
    }
  }

  for (const invoice of invoices) {
    if (usedInvoices.has(invoice.id)) continue;
    const invoiceDate = dateOnly(invoice.dispensing_date);
    const nearManual = manualTransactions.find((tx) => {
      const manualDate = dateOnly(tx.dispensing_date);
      return !tx.is_cancelled && manualDate && invoiceDate && Math.abs(diffDays(manualDate, invoiceDate)) <= 3;
    });
    if (nearManual) {
      usedManual.add(nearManual.id);
      rows.push({
        kind: "date_mismatch",
        manual_transaction_id: nearManual.id,
        manual_date: dateOnly(nearManual.dispensing_date),
        manual_type: nearManual.transaction_type ?? null,
        phif_invoice_id: invoice.id,
        phif_invoice_number: invoice.invoice_number ?? null,
        phif_date: invoiceDate,
        reason: "تاريخ الصرف اليدوي قريب لكنه لا يطابق تاريخ PHIF",
      });
    } else {
      rows.push({
        kind: "phif_without_manual",
        manual_transaction_id: null,
        manual_date: null,
        manual_type: null,
        phif_invoice_id: invoice.id,
        phif_invoice_number: invoice.invoice_number ?? null,
        phif_date: invoiceDate,
        reason: "فاتورة PHIF محفوظة ولا توجد حركة يدوية مقابلة واضحة",
      });
    }
  }

  for (const tx of manualTransactions) {
    if (tx.is_cancelled || usedManual.has(tx.id)) continue;
    rows.push({
      kind: "manual_without_phif",
      manual_transaction_id: tx.id,
      manual_date: dateOnly(tx.dispensing_date),
      manual_type: tx.transaction_type ?? null,
      phif_invoice_id: null,
      phif_invoice_number: null,
      phif_date: null,
      reason: "حركة يدوية لا توجد لها فاتورة PHIF مقابلة واضحة",
    });
  }

  return rows;
}

export const getPhifInvoiceArchiveStats = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { pharmacy_id } = await requireTiryaqPhifArchiveAccess();
  const { count, error } = await (supabaseAdmin as any)
    .from("phif_invoices")
    .select("id", { count: "exact", head: true })
    .eq("pharmacy_id", pharmacy_id);
  if (error) throw new Error(error.message);
  return { total: count ?? 0 };
});

export const listPhifInvoices = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => listSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pharmacy_id } = await requireTiryaqPhifArchiveAccess();
    const db = supabaseAdmin as any;
    const search = normalizeSearch(data.search);

    let query = db
      .from("phif_invoices")
      .select("id, invoice_key, invoice_number, insurance_card_number, beneficiary_name, dispensing_date, dispensing_time, status, synced_at, patient_id, review_status")
      .eq("pharmacy_id", pharmacy_id)
      .order("dispensing_date", { ascending: false, nullsFirst: false })
      .order("synced_at", { ascending: false })
      .limit(500);

    if (data.dateFrom) query = query.gte("dispensing_date", data.dateFrom);
    if (data.dateTo) query = query.lte("dispensing_date", data.dateTo);
    if (search) {
      const term = search.replace(/[%_]/g, "\\$&");
      query = query.or(
        `insurance_card_number.ilike.%${term}%,beneficiary_name.ilike.%${term}%,invoice_number.ilike.%${term}%,invoice_key.ilike.%${term}%`,
      );
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((row: any) => row.id);
    const [counts, cardMatches] = await Promise.all([
      itemCounts(db, ids),
      accessiblePatientsByCard(db, pharmacy_id, (rows ?? []).map((row: any) => row.insurance_card_number ?? null)),
    ]);

    return {
      rows: (rows ?? []).map((row: any) => toArchiveRow(row, counts.get(row.id) ?? 0, cardMatches)),
      total: rows?.length ?? 0,
    };
  });

export const getPhifInvoiceDetail = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => detailSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pharmacy_id } = await requireTiryaqPhifArchiveAccess();
    const db = supabaseAdmin as any;

    const { data: invoice, error } = await db
      .from("phif_invoices")
      .select("id, invoice_key, invoice_number, insurance_card_number, beneficiary_name, dispensing_date, dispensing_time, status, synced_at, metadata, patient_id, review_status")
      .eq("id", data.id)
      .eq("pharmacy_id", pharmacy_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!invoice) throw new Error("PHIF invoice was not found");

    const { data: items, error: itemError } = await db
      .from("phif_invoice_items")
      .select("id, phif_item_id, active_ingredient, strength, brand, quantity, supplier, source_classification, phif_financial_fields, metadata, created_at")
      .eq("phif_invoice_id", invoice.id)
      .order("created_at", { ascending: true });
    if (itemError) throw new Error(itemError.message);

    const cardMatches = await accessiblePatientsByCard(db, pharmacy_id, [invoice.insurance_card_number ?? null]);
    return {
      ...toArchiveRow(invoice, items?.length ?? 0, cardMatches),
      metadata: invoice.metadata ?? {},
      items: (items ?? []).map((item: any) => ({
        ...item,
        phif_financial_fields: item.phif_financial_fields ?? {},
        metadata: item.metadata ?? {},
      })),
    } satisfies PhifInvoiceArchiveDetail;
  });

async function rowsForReviewCard(admin: any, pharmacyId: string, card: string) {
  const { data, error } = await admin
    .from("phif_invoices")
    .select("id, invoice_key, invoice_number, insurance_card_number, beneficiary_name, dispensing_date, dispensing_time, status, synced_at, patient_id, review_status")
    .eq("pharmacy_id", pharmacyId)
    .eq("insurance_card_number", card)
    .order("dispensing_date", { ascending: false, nullsFirst: false })
    .order("synced_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function pendingReviewRows(admin: any, pharmacyId: string, includeRejected: boolean) {
  let query = admin
    .from("phif_invoices")
    .select("id, invoice_key, invoice_number, insurance_card_number, beneficiary_name, dispensing_date, dispensing_time, status, synced_at, patient_id, review_status")
    .eq("pharmacy_id", pharmacyId)
    .not("insurance_card_number", "is", null)
    .is("patient_id", null)
    .order("synced_at", { ascending: false })
    .limit(1000);
  query = includeRejected
    ? query.in("review_status", ["pending", "rejected"])
    : query.eq("review_status", "pending");
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

function groupReviewCases(rows: any[], counts: Map<string, number>, cardMatches: Map<string, string>, search: string) {
  const q = search.toLowerCase();
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const card = row.insurance_card_number;
    if (!card || cardMatches.has(card)) continue;
    if (q) {
      const haystack = `${card} ${row.beneficiary_name ?? ""} ${row.invoice_number ?? ""} ${row.invoice_key ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) continue;
    }
    groups.set(card, [...(groups.get(card) ?? []), row]);
  }

  return [...groups.entries()].map(([card, invoices]) => {
    const archiveRows = invoices.map((row) => toArchiveRow(row, counts.get(row.id) ?? 0, cardMatches));
    return {
      insurance_card_number: card,
      beneficiary_name: invoices.find((row) => row.beneficiary_name)?.beneficiary_name ?? null,
      invoice_count: invoices.length,
      latest_dispensing_date: invoices[0]?.dispensing_date ?? null,
      latest_synced_at: invoices[0]?.synced_at ?? null,
      review_status: invoices.some((row) => row.review_status === "pending") ? "pending" : "rejected",
      invoices: archiveRows,
    } satisfies PhifInvoiceReviewCase;
  });
}

export const listPhifReviewCases = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => reviewListSchema.parse(d ?? {}))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pharmacy_id } = await requireTiryaqPhifArchiveAccess();
    const db = supabaseAdmin as any;
    const rows = await pendingReviewRows(db, pharmacy_id, data.includeRejected === true);
    const ids = rows.map((row: any) => row.id);
    const cards = rows.map((row: any) => row.insurance_card_number ?? null);
    const [counts, cardMatches] = await Promise.all([
      itemCounts(db, ids),
      accessiblePatientsByCard(db, pharmacy_id, cards),
    ]);
    const cases = groupReviewCases(rows, counts, cardMatches, normalizeSearch(data.search));
    return {
      cases,
      total: cases.length,
      invoice_count: cases.reduce((sum, reviewCase) => sum + reviewCase.invoice_count, 0),
    };
  });

export const searchPhifLinkPatients = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ search: z.string().trim().min(1).max(120) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pharmacy_id } = await requireTiryaqPhifArchiveAccess();
    const db = supabaseAdmin as any;
    const term = data.search.replace(/[%_]/g, "\\$&");
    const { data: rows, error } = await db
      .from("patients")
      .select("id, patient_name, insurance_card_number, phone")
      .or(`patient_name.ilike.%${term}%,insurance_card_number.ilike.%${term}%,phone.ilike.%${term}%`)
      .limit(30);
    if (error) throw new Error(error.message);
    const { served, anyTx, excluded } = await patientAccessSets(db, pharmacy_id);
    return (rows ?? []).filter((patient: any) => !excluded.has(patient.id) && (served.has(patient.id) || !anyTx.has(patient.id)));
  });

async function linkInvoicesForCard(admin: any, pharmacyId: string, card: string, patientId: string) {
  const { error } = await admin
    .from("phif_invoices")
    .update({
      patient_id: patientId,
      review_status: "linked",
      review_note: null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("pharmacy_id", pharmacyId)
    .eq("insurance_card_number", card);
  if (error) throw new Error(error.message);
}

export const createPatientFromPhifInvoice = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => createPatientFromInvoiceSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normalizeArabicName } = await import("@/lib/name-normalize");
    const { pharmacy_id } = await requireTiryaqPhifArchiveAccess();
    const db = supabaseAdmin as any;
    const card = data.insurance_card_number.trim();
    const invoices = await rowsForReviewCard(db, pharmacy_id, card);
    if (invoices.length === 0) throw new Error("PHIF review case was not found");

    const { data: existing } = await db
      .from("patients")
      .select("id")
      .eq("insurance_card_number", card)
      .maybeSingle();
    if (existing?.id) throw new Error("يوجد مستفيد بنفس رقم البطاقة بالفعل");

    const name = data.patient_name?.trim() || invoices.find((row: any) => row.beneficiary_name)?.beneficiary_name || "مستفيد PHIF";
    const { data: inserted, error } = await db
      .from("patients")
      .insert({
        patient_name: name,
        patient_name_normalized: normalizeArabicName(name),
        insurance_card_number: card,
        phone: data.phone?.trim() || null,
        address: data.address?.trim() || null,
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "Failed to create patient");

    await linkInvoicesForCard(db, pharmacy_id, card, inserted.id);
    return { ok: true as const, patient_id: inserted.id as string, linked_invoices: invoices.length };
  });

export const linkPhifInvoicesToPatient = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => linkExistingPatientSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { authorizePatientForSessionPharmacy } = await import("@/lib/pharmacy-isolation");
    const { pharmacy_id } = await requireTiryaqPhifArchiveAccess();
    const db = supabaseAdmin as any;
    const card = data.insurance_card_number.trim();
    const invoices = await rowsForReviewCard(db, pharmacy_id, card);
    if (invoices.length === 0) throw new Error("PHIF review case was not found");

    if (!(await authorizePatientForSessionPharmacy(db, pharmacy_id, data.patient_id))) {
      throw new Error("Patient not found");
    }
    const { data: patient, error } = await db
      .from("patients")
      .select("id, insurance_card_number")
      .eq("id", data.patient_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!patient) throw new Error("Patient not found");
    if (patient.insurance_card_number !== card && data.confirm_card_mismatch !== true) {
      return {
        ok: false as const,
        needs_confirmation: true as const,
        message: "رقم بطاقة المستفيد مختلف عن رقم بطاقة الفاتورة. أكد الربط دون تعديل رقم البطاقة.",
      };
    }

    await linkInvoicesForCard(db, pharmacy_id, card, data.patient_id);
    return { ok: true as const, patient_id: data.patient_id, linked_invoices: invoices.length };
  });

export const rejectPhifReviewCase = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => cardSchema.extend({ reason: z.string().trim().max(300).optional() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pharmacy_id } = await requireTiryaqPhifArchiveAccess();
    const { error } = await (supabaseAdmin as any)
      .from("phif_invoices")
      .update({
        review_status: "rejected",
        review_note: data.reason?.trim() || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("pharmacy_id", pharmacy_id)
      .eq("insurance_card_number", data.insurance_card_number.trim())
      .is("patient_id", null);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const reopenPhifReviewCase = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => cardSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pharmacy_id } = await requireTiryaqPhifArchiveAccess();
    const { error } = await (supabaseAdmin as any)
      .from("phif_invoices")
      .update({
        review_status: "pending",
        review_note: null,
        reviewed_at: null,
      })
      .eq("pharmacy_id", pharmacy_id)
      .eq("insurance_card_number", data.insurance_card_number.trim())
      .eq("review_status", "rejected")
      .is("patient_id", null);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const listPatientPhifInvoices = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => patientInvoicesSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { authorizePatientForSessionPharmacy } = await import("@/lib/pharmacy-isolation");
    const { pharmacy_id } = await requireTiryaqPhifArchiveAccess();
    const db = supabaseAdmin as any;
    if (!(await authorizePatientForSessionPharmacy(db, pharmacy_id, data.patientId))) return [];

    const { data: patient, error: patientError } = await db
      .from("patients")
      .select("id, insurance_card_number")
      .eq("id", data.patientId)
      .maybeSingle();
    if (patientError) throw new Error(patientError.message);
    if (!patient) return [];

    let query = db
      .from("phif_invoices")
      .select("id, invoice_key, invoice_number, insurance_card_number, beneficiary_name, dispensing_date, dispensing_time, status, synced_at, patient_id, review_status")
      .eq("pharmacy_id", pharmacy_id)
      .order("dispensing_date", { ascending: false, nullsFirst: false })
      .order("synced_at", { ascending: false })
      .limit(200);

    if (patient.insurance_card_number) {
      query = query.or(`patient_id.eq.${data.patientId},insurance_card_number.eq.${patient.insurance_card_number}`);
    } else {
      query = query.eq("patient_id", data.patientId);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    const counts = await itemCounts(db, (rows ?? []).map((row: any) => row.id));
    const cardMatches = patient.insurance_card_number
      ? new Map([[patient.insurance_card_number, data.patientId]])
      : new Map<string, string>();
    return (rows ?? []).map((row: any) => toArchiveRow(row, counts.get(row.id) ?? 0, cardMatches));
  });

export const getPatientPhifMedicationProfile = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => patientInvoicesSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { authorizePatientForSessionPharmacy } = await import("@/lib/pharmacy-isolation");
    const { pharmacy_id } = await requireTiryaqPhifArchiveAccess();
    const db = supabaseAdmin as any;
    if (!(await authorizePatientForSessionPharmacy(db, pharmacy_id, data.patientId))) {
      return { items: [], nearest_due_date: null, nearest_due_items: [], nearest_due_item_count: 0, due_summaries: [], reconciliation: [] } satisfies PhifMedicationProfile;
    }

    const { data: patient, error: patientError } = await db
      .from("patients")
      .select("id, insurance_card_number")
      .eq("id", data.patientId)
      .maybeSingle();
    if (patientError) throw new Error(patientError.message);
    if (!patient) return { items: [], nearest_due_date: null, nearest_due_items: [], nearest_due_item_count: 0, due_summaries: [], reconciliation: [] } satisfies PhifMedicationProfile;

    let invoiceQuery = db
      .from("phif_invoices")
      .select("id, invoice_key, invoice_number, insurance_card_number, beneficiary_name, dispensing_date, dispensing_time, status, synced_at, patient_id, review_status")
      .eq("pharmacy_id", pharmacy_id)
      .order("dispensing_date", { ascending: false, nullsFirst: false })
      .limit(500);

    if (patient.insurance_card_number) {
      invoiceQuery = invoiceQuery.or(`patient_id.eq.${data.patientId},insurance_card_number.eq.${patient.insurance_card_number}`);
    } else {
      invoiceQuery = invoiceQuery.eq("patient_id", data.patientId);
    }

    const [{ data: invoices, error: invoiceError }, { data: manualTransactions, error: txError }] = await Promise.all([
      invoiceQuery,
      db
        .from("dispensing_transactions")
        .select("id, dispensing_date, transaction_type, items_dispensed, items_remaining, notes, is_cancelled")
        .eq("patient_id", data.patientId)
        .eq("pharmacy_id", pharmacy_id)
        .order("dispensing_date", { ascending: false })
        .limit(500),
    ]);
    if (invoiceError) throw new Error(invoiceError.message);
    if (txError) throw new Error(txError.message);

    const invoiceIds = (invoices ?? []).map((invoice: any) => invoice.id);
    if (invoiceIds.length === 0) {
      return buildPhifMedicationProfileFromRows([], [], manualTransactions ?? []);
    }

    const { data: items, error: itemError } = await db
      .from("phif_invoice_items")
      .select("id, phif_invoice_id, phif_item_id, active_ingredient, strength, brand, quantity, supplier, source_classification, phif_financial_fields, metadata, created_at")
      .in("phif_invoice_id", invoiceIds);
    if (itemError) throw new Error(itemError.message);

    return buildPhifMedicationProfileFromRows(invoices ?? [], items ?? [], manualTransactions ?? []);
  });
