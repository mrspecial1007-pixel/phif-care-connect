import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  calculateActualGrossMargin,
  invoiceItemValue,
  stockSnapshotCandidatesForInvoice,
} from "@/lib/phif-stock.helpers";
import {
  buildMonthlyReport,
  officialReportPayload,
  type DrugGrouping,
  type ReportInvoice,
  type ReportItem,
  type ReportSource,
  type ReportStock,
  type TopSort,
} from "@/lib/reports.helpers";

const rangeSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.enum(["all", "actual", "phif"]).default("all"),
});

const monthlyReportSchema = rangeSchema.extend({
  groupBy: z.enum(["scientific", "brand"]).default("scientific"),
  sortBy: z.enum(["quantity", "beneficiaries", "dispenses", "value"]).default("quantity"),
  topLimit: z.union([z.literal("all"), z.number().int().min(10).max(500)]).default(20),
});

function moneyValue(fields: Record<string, unknown> | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = fields?.[key];
    if (value === undefined || value === null || value === "") continue;
    const numeric = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function itemAmount(item: any) {
  return invoiceItemValue(item);
}

function previousMonthRange(dateFrom: string, dateTo: string) {
  const start = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  if (dateFrom !== first.toISOString().slice(0, 10) || dateTo !== last.toISOString().slice(0, 10)) return null;
  const prevFirst = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
  const prevLast = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 0));
  return {
    dateFrom: prevFirst.toISOString().slice(0, 10),
    dateTo: prevLast.toISOString().slice(0, 10),
  };
}

async function loadReportDataset(
  supabaseAdmin: any,
  pharmacyId: string,
  dateFrom: string,
  dateTo: string,
) {
  const { data: invoices, error } = await supabaseAdmin
    .from("phif_invoices")
    .select("id, invoice_number, invoice_key, beneficiary_name, insurance_card_number, dispensing_date, metadata")
    .eq("pharmacy_id", pharmacyId)
    .gte("dispensing_date", dateFrom)
    .lte("dispensing_date", dateTo)
    .order("dispensing_date", { ascending: false });
  if (error) throw new Error(error.message);

  const invoiceRows = (invoices ?? []) as ReportInvoice[];
  const ids = invoiceRows.map((invoice) => invoice.id);
  const items: ReportItem[] = [];
  for (let index = 0; index < ids.length; index += 500) {
    const batch = ids.slice(index, index + 500);
    if (batch.length === 0) continue;
    const { data: rows, error: itemError } = await supabaseAdmin
      .from("phif_invoice_items")
      .select("id, phif_invoice_id, phif_item_id, active_ingredient, strength, brand, quantity, supplier, source_classification, phif_financial_fields, metadata")
      .in("phif_invoice_id", batch);
    if (itemError) throw new Error(itemError.message);
    items.push(...((rows ?? []) as ReportItem[]));
  }

  return { invoices: invoiceRows, items };
}

async function loadFirstDispensingByCard(
  supabaseAdmin: any,
  pharmacyId: string,
  invoices: ReportInvoice[],
) {
  const cards = [...new Set(invoices.map((invoice) => invoice.insurance_card_number).filter(Boolean))] as string[];
  const first = new Map<string, string>();
  for (let index = 0; index < cards.length; index += 500) {
    const batch = cards.slice(index, index + 500);
    const { data: rows, error } = await supabaseAdmin
      .from("phif_invoices")
      .select("insurance_card_number, dispensing_date")
      .eq("pharmacy_id", pharmacyId)
      .in("insurance_card_number", batch)
      .not("dispensing_date", "is", null);
    if (error) throw new Error(error.message);
    for (const row of rows ?? []) {
      const card = String(row.insurance_card_number ?? "");
      const date = String(row.dispensing_date ?? "");
      if (!card || !date) continue;
      const current = first.get(card);
      if (!current || date < current) first.set(card, date);
    }
  }
  return first;
}

async function loadCurrentStockForReport(supabaseAdmin: any, pharmacyId: string) {
  const { data: rows, error } = await supabaseAdmin
    .from("phif_stock_items")
    .select("source_stock_id, brand_name, active_ingredient, strength, dosage_unit, stock_quantity, source_quantity_unit, synced_at")
    .eq("pharmacy_id", pharmacyId)
    .eq("is_current", true)
    .limit(1000);
  if (error) throw new Error(error.message);
  return (rows ?? []) as ReportStock[];
}

async function buildManagementMonthlyReport(data: z.infer<typeof monthlyReportSchema>, permission: "reports_read" | "reports_export") {
  const { requireTiryaqPermission } = await import("@/lib/user-management.functions");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { pharmacy_id } = await requireTiryaqPermission(permission);
  const current = await loadReportDataset(supabaseAdmin, pharmacy_id, data.dateFrom, data.dateTo);
  const previousRange = previousMonthRange(data.dateFrom, data.dateTo);
  const previous = previousRange
    ? await loadReportDataset(supabaseAdmin, pharmacy_id, previousRange.dateFrom, previousRange.dateTo)
    : null;
  const firstDispensingByCard = await loadFirstDispensingByCard(supabaseAdmin, pharmacy_id, current.invoices);
  const stockItems = await loadCurrentStockForReport(supabaseAdmin, pharmacy_id);
  return buildMonthlyReport({
    dateFrom: data.dateFrom,
    dateTo: data.dateTo,
    source: data.source as ReportSource,
    groupBy: data.groupBy as DrugGrouping,
    sortBy: data.sortBy as TopSort,
    topLimit: data.topLimit,
    invoices: current.invoices,
    items: current.items,
    firstDispensingByCard,
    stockItems,
    previous,
  });
}

export const getMonthlyManagementReport = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => monthlyReportSchema.parse(d))
  .handler(async ({ data }) => buildManagementMonthlyReport(data, "reports_read"));

export const getOfficialMonthlyReportExport = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => monthlyReportSchema.parse(d))
  .handler(async ({ data }) => officialReportPayload(await buildManagementMonthlyReport(data, "reports_export")));

export const getManagementReport = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => rangeSchema.parse(d))
  .handler(async ({ data }) => {
    const { requireTiryaqPermission } = await import("@/lib/user-management.functions");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pharmacy_id } = await requireTiryaqPermission("reports_read");

    const { data: invoices, error } = await supabaseAdmin
      .from("phif_invoices")
      .select("id, invoice_number, invoice_key, beneficiary_name, insurance_card_number, dispensing_date, patient_id")
      .eq("pharmacy_id", pharmacy_id)
      .gte("dispensing_date", data.dateFrom)
      .lte("dispensing_date", data.dateTo)
      .order("dispensing_date", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = (invoices ?? []).map((invoice: any) => invoice.id);
    const items: any[] = [];
    for (let index = 0; index < ids.length; index += 500) {
      const batch = ids.slice(index, index + 500);
      if (batch.length === 0) continue;
      const { data: rows, error: itemError } = await supabaseAdmin
        .from("phif_invoice_items")
        .select("phif_invoice_id, source_classification, quantity, phif_financial_fields")
        .in("phif_invoice_id", batch);
      if (itemError) throw new Error(itemError.message);
      items.push(...(rows ?? []));
    }

    const invoiceById = new Map((invoices ?? []).map((invoice: any) => [invoice.id, invoice]));
    const filteredItems = items.filter((item) => {
      if (data.source === "all") return true;
      if (data.source === "phif") return item.source_classification === "phif-supplier";
      return item.source_classification !== "phif-supplier";
    });
    const invoiceIdsWithItems = new Set(filteredItems.map((item) => item.phif_invoice_id));
    const uniquePatients = new Set<string>();
    for (const invoice of invoices ?? []) {
      if (!invoiceIdsWithItems.has(invoice.id) && data.source !== "all") continue;
      uniquePatients.add(invoice.patient_id ?? invoice.insurance_card_number ?? invoice.beneficiary_name ?? invoice.id);
    }

    const actualValue = filteredItems
      .filter((item) => item.source_classification !== "phif-supplier")
      .reduce((sum, item) => sum + itemAmount(item), 0);
    const phifValue = filteredItems
      .filter((item) => item.source_classification === "phif-supplier")
      .reduce((sum, item) => sum + itemAmount(item), 0);

    const details = [...invoiceIdsWithItems].map((id) => {
      const invoice = invoiceById.get(id);
      const invoiceItems = filteredItems.filter((item) => item.phif_invoice_id === id);
      return {
        id,
        invoice_number: invoice?.invoice_number ?? null,
        invoice_key: invoice?.invoice_key ?? null,
        beneficiary_name: invoice?.beneficiary_name ?? null,
        insurance_card_number: invoice?.insurance_card_number ?? null,
        dispensing_date: invoice?.dispensing_date ?? null,
        item_count: invoiceItems.length,
        actual_value: invoiceItems.filter((item) => item.source_classification !== "phif-supplier").reduce((sum, item) => sum + itemAmount(item), 0),
        phif_value: invoiceItems.filter((item) => item.source_classification === "phif-supplier").reduce((sum, item) => sum + itemAmount(item), 0),
      };
    });

    return {
      invoice_count: invoiceIdsWithItems.size,
      unique_patient_count: uniquePatients.size,
      item_count: filteredItems.length,
      actual_value: actualValue,
      phif_value: phifValue,
      total_dispensed_value: actualValue + phifValue,
      employee_breakdown_available: false,
      details,
    };
  });

export const getActualProfitReport = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => rangeSchema.pick({ dateFrom: true, dateTo: true }).parse(d))
  .handler(async ({ data }) => {
    const { requireTiryaqPermission } = await import("@/lib/user-management.functions");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pharmacy_id } = await requireTiryaqPermission("stock_cost_read");

    const { data: invoices, error } = await supabaseAdmin
      .from("phif_invoices")
      .select("id, invoice_number, invoice_key, dispensing_date")
      .eq("pharmacy_id", pharmacy_id)
      .gte("dispensing_date", data.dateFrom)
      .lte("dispensing_date", data.dateTo)
      .order("dispensing_date", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = (invoices ?? []).map((invoice: any) => invoice.id);
    const items: any[] = [];
    for (let index = 0; index < ids.length; index += 500) {
      const batch = ids.slice(index, index + 500);
      if (batch.length === 0) continue;
      const { data: rows, error: itemError } = await supabaseAdmin
        .from("phif_invoice_items")
        .select("id, phif_invoice_id, phif_item_id, active_ingredient, strength, brand, quantity, supplier, source_classification, phif_financial_fields, metadata")
        .in("phif_invoice_id", batch)
        .neq("source_classification", "phif-supplier");
      if (itemError) throw new Error(itemError.message);
      items.push(...(rows ?? []));
    }

    const { data: stockRows, error: stockError } = await supabaseAdmin
      .from("phif_stock_items")
      .select("id, source_stock_id, generic_ingredient_id, supplier_id, brand_product_id, brand_name, active_ingredient, strength, dosage_unit, package_quantity, strips_quantity, cost_price, sale_price, synced_at")
      .eq("pharmacy_id", pharmacy_id)
      .not("cost_price", "is", null)
      .order("synced_at", { ascending: false });
    if (stockError) throw new Error(stockError.message);

    const invoiceById = new Map((invoices ?? []).map((invoice: any) => [invoice.id, invoice]));
    const details = items.map((item) => {
      const invoice: any = invoiceById.get(item.phif_invoice_id);
      const candidates = stockSnapshotCandidatesForInvoice(item, stockRows ?? [], invoice?.dispensing_date);
      const margin = calculateActualGrossMargin(item, candidates);
      return {
        invoice_id: item.phif_invoice_id,
        invoice_number: invoice?.invoice_number ?? invoice?.invoice_key ?? null,
        dispensing_date: invoice?.dispensing_date ?? null,
        item_name: [item.brand, item.active_ingredient, item.strength].filter(Boolean).join(" · "),
        quantity: item.quantity,
        invoice_value: margin.invoiceValue,
        purchase_cost: margin.purchaseCost,
        gross_margin: margin.grossMargin,
        match_status: margin.status,
        match_reason: margin.reason,
        matched_stock_id: margin.stock?.source_stock_id ?? null,
      };
    });

    const matched = details.filter((row) => row.match_status === "matched");
    const totalValue = details.reduce((sum, row) => sum + row.invoice_value, 0);
    const knownCost = matched.reduce((sum, row) => sum + (row.purchase_cost ?? 0), 0);
    const knownMargin = matched.reduce((sum, row) => sum + (row.gross_margin ?? 0), 0);

    return {
      total_actual_items: details.length,
      total_actual_value: totalValue,
      matched_item_count: matched.length,
      review_item_count: details.length - matched.length,
      known_purchase_cost: knownCost,
      known_gross_margin: knownMargin,
      coverage_ratio: details.length ? matched.length / details.length : 0,
      details,
    };
  });
