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

async function patientMatchCards(admin: any, pharmacyId: string, cards: (string | null)[]) {
  const uniqueCards = [...new Set(cards.filter(Boolean) as string[])];
  if (uniqueCards.length === 0) return new Set<string>();

  const { data: patients, error } = await admin
    .from("patients")
    .select("id, insurance_card_number")
    .in("insurance_card_number", uniqueCards);
  if (error) throw new Error(error.message);

  const patientIds = (patients ?? []).map((patient: any) => patient.id).filter(Boolean);
  if (patientIds.length === 0) return new Set<string>();

  const { data: served, error: servedError } = await admin
    .from("dispensing_transactions")
    .select("patient_id")
    .in("patient_id", patientIds)
    .eq("pharmacy_id", pharmacyId);
  if (servedError) throw new Error(servedError.message);

  const servedIds = new Set((served ?? []).map((row: any) => row.patient_id));
  return new Set(
    (patients ?? [])
      .filter((patient: any) => servedIds.has(patient.id))
      .map((patient: any) => patient.insurance_card_number)
      .filter(Boolean),
  );
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

function toArchiveRow(row: any, count: number, matchedCards: Set<string>): PhifInvoiceArchiveRow {
  const card = row.insurance_card_number ?? null;
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
    match_status: card && matchedCards.has(card) ? "matched" : "not_matched",
  };
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
      .select("id, invoice_key, invoice_number, insurance_card_number, beneficiary_name, dispensing_date, dispensing_time, status, synced_at")
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
    const [counts, matchedCards] = await Promise.all([
      itemCounts(db, ids),
      patientMatchCards(db, pharmacy_id, (rows ?? []).map((row: any) => row.insurance_card_number ?? null)),
    ]);

    return {
      rows: (rows ?? []).map((row: any) => toArchiveRow(row, counts.get(row.id) ?? 0, matchedCards)),
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
      .select("id, invoice_key, invoice_number, insurance_card_number, beneficiary_name, dispensing_date, dispensing_time, status, synced_at, metadata")
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

    const matchedCards = await patientMatchCards(db, pharmacy_id, [invoice.insurance_card_number ?? null]);
    return {
      ...toArchiveRow(invoice, items?.length ?? 0, matchedCards),
      metadata: invoice.metadata ?? {},
      items: (items ?? []).map((item: any) => ({
        ...item,
        phif_financial_fields: item.phif_financial_fields ?? {},
        metadata: item.metadata ?? {},
      })),
    } satisfies PhifInvoiceArchiveDetail;
  });
