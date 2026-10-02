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
  reportDrugIdentityKey,
  reportItemQuantityLabel,
  reportItemSource,
  reportNumberValue,
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

const itemSearchSchema = z.object({
  search: z.string().trim().min(2).max(120),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const itemTrackingSchema = itemSearchSchema.extend({
  identityKey: z.string().min(1).max(300),
  groupBy: z.enum(["scientific", "brand"]).default("scientific"),
});

const supplierPurchaseOverrideSchema = z.object({
  itemId: z.string().uuid(),
  purchasePrice: z.number().min(0).max(1_000_000),
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

async function loadStockWithCosts(supabaseAdmin: any, pharmacyId: string) {
  const { data: rows, error } = await supabaseAdmin
    .from("phif_stock_items")
    .select("id, source_stock_id, generic_ingredient_id, supplier_id, supplier_name, brand_product_id, brand_name, active_ingredient, strength, dosage_unit, package_quantity, strips_quantity, stock_quantity, source_quantity_unit, cost_price, sale_price, synced_at")
    .eq("pharmacy_id", pharmacyId)
    .order("synced_at", { ascending: false })
    .limit(5000);
  if (error) throw new Error(error.message);
  return rows ?? [];
}

function internalPurchaseOverride(item: any): number | null {
  const raw = item.phif_financial_fields?.internal_purchase_price
      ?? item.phif_financial_fields?.internalPurchasePrice
      ?? item.phif_financial_fields?.internal_sale_price_override
      ?? item.phif_financial_fields?.internalSalePriceOverride
      ?? item.metadata?.internal_purchase_price
      ?? item.metadata?.internal_sale_price_override;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function itemUnit(item: any) {
  return String(item.metadata?.unit ?? item.metadata?.dosage_unit ?? item.metadata?.quantity_unit ?? item.phif_financial_fields?.unit ?? "").trim() || null;
}

function invoiceItemName(item: any) {
  return [item.brand, item.active_ingredient, item.strength].filter(Boolean).join(" · ") || "صنف غير محدد";
}

function profitForItem(item: any, invoice: any, stocks: any[]) {
  const source = reportItemSource(item);
  const invoiceValue = invoiceItemValue(item);
  if (source === "phif") {
    const override = internalPurchaseOverride(item);
    const quantity = reportNumberValue(item.quantity);
    const unit = itemUnit(item);
    const purchaseCost = override !== null && quantity > 0 && unit ? override * quantity : null;
    return {
      source,
      invoiceValue,
      revenue: invoiceValue,
      purchaseCost,
      grossMargin: purchaseCost === null ? null : invoiceValue - purchaseCost,
      unitPurchasePrice: override,
      status: purchaseCost === null ? (override !== null && !unit ? "pricing_unit_unverified" : "needs_purchase_price") : "matched",
      reason: purchaseCost === null ? (!unit ? "pricing_unit_unverified" : "phif_supplier_purchase_price_missing") : "phif_supplier_internal_purchase_price",
      stock: null,
      invoice,
    };
  }
  const candidates = stockSnapshotCandidatesForInvoice(item, stocks, invoice?.dispensing_date);
  const margin = calculateActualGrossMargin(item, candidates);
  return {
    source,
    invoiceValue: margin.invoiceValue,
    revenue: margin.invoiceValue,
    purchaseCost: margin.purchaseCost,
    grossMargin: margin.grossMargin,
    unitPurchasePrice: null,
    status: margin.status,
    reason: margin.reason,
    stock: margin.stock,
    invoice,
  };
}

async function loadProfitRows(supabaseAdmin: any, pharmacyId: string, data: { dateFrom: string; dateTo: string; source?: "all" | "actual" | "phif" }) {
  const dataset = await loadReportDataset(supabaseAdmin, pharmacyId, data.dateFrom, data.dateTo);
  const stocks = await loadStockWithCosts(supabaseAdmin, pharmacyId);
  const invoiceById = new Map(dataset.invoices.map((invoice) => [invoice.id, invoice]));
  const rows = dataset.items
    .filter((item) => {
      if (data.source === "actual") return reportItemSource(item) === "actual";
      if (data.source === "phif") return reportItemSource(item) === "phif";
      return true;
    })
    .map((item) => {
      const invoice: any = invoiceById.get(item.phif_invoice_id);
       const profit = profitForItem(item, invoice, stocks);
      return {
        item_id: item.id,
        invoice_id: item.phif_invoice_id,
        invoice_number: invoice?.invoice_number ?? invoice?.invoice_key ?? null,
        invoice_key: invoice?.invoice_key ?? null,
        beneficiary_name: invoice?.beneficiary_name ?? null,
        insurance_card_number: invoice?.insurance_card_number ?? null,
        dispensing_date: invoice?.dispensing_date ?? null,
        item_name: invoiceItemName(item),
        active_ingredient: item.active_ingredient ?? null,
        strength: item.strength ?? null,
        brand: item.brand ?? null,
        quantity: item.quantity,
        quantity_label: reportItemQuantityLabel(item, profit.stock),
         unit: itemUnit(item) ?? profit.stock?.dosage_unit ?? null,
         supplier: item.supplier ?? profit.stock?.supplier_name ?? null,
         stock_quantity: profit.stock?.stock_quantity ?? null,
         stock_synced_at: profit.stock?.synced_at ?? null,
        source: profit.source,
         invoice_value: profit.invoiceValue,
        revenue: profit.revenue,
        purchase_cost: profit.purchaseCost,
        gross_margin: profit.grossMargin,
        unit_purchase_price: profit.unitPurchasePrice,
        match_status: profit.status,
        match_reason: profit.reason,
      };
    });
  return { invoices: dataset.invoices, items: dataset.items, rows, stocks };
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

export const searchReportItems = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => itemSearchSchema.parse(d))
  .handler(async ({ data }) => {
    const { requireTiryaqPermission } = await import("@/lib/user-management.functions");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pharmacy_id } = await requireTiryaqPermission("reports_read");
    const dataset = await loadReportDataset(supabaseAdmin, pharmacy_id, data.dateFrom, data.dateTo);
    const query = data.search.toLowerCase();
    const grouped = new Map<string, any>();
    for (const item of dataset.items) {
      const text = [item.brand, item.active_ingredient, item.strength].filter(Boolean).join(" ").toLowerCase();
      if (!text.includes(query)) continue;
      const identityKey = reportDrugIdentityKey(item, "scientific");
      const row = grouped.get(identityKey) ?? {
        identity_key: identityKey,
        brand: item.brand ?? null,
        active_ingredient: item.active_ingredient ?? null,
        strength: item.strength ?? null,
        source: reportItemSource(item),
        occurrence_count: 0,
      };
      row.occurrence_count += 1;
      grouped.set(identityKey, row);
    }
    return [...grouped.values()].sort((a, b) => b.occurrence_count - a.occurrence_count).slice(0, 20);
  });

export const getReportItemTracking = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => itemTrackingSchema.parse(d))
  .handler(async ({ data }) => {
    const { requireTiryaqPermission } = await import("@/lib/user-management.functions");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pharmacy_id } = await requireTiryaqPermission("stock_cost_read");
    const { rows } = await loadProfitRows(supabaseAdmin, pharmacy_id, { dateFrom: data.dateFrom, dateTo: data.dateTo, source: "all" });
    const movements = rows.filter((row) => {
      const key = reportDrugIdentityKey({
        active_ingredient: row.active_ingredient,
        strength: row.strength,
        brand: row.brand,
        metadata: {},
      }, data.groupBy);
      return key === data.identityKey;
    });
     const beneficiaryCards = new Set(movements.map((row) => row.insurance_card_number ?? row.beneficiary_name).filter(Boolean));
    const knownCostRows = movements.filter((row) => row.purchase_cost !== null);
    const knownProfitRows = movements.filter((row) => row.gross_margin !== null);
    const first = movements[0] ?? null;
    return {
      item: first ? {
        identity_key: data.identityKey,
        brand: first.brand,
        active_ingredient: first.active_ingredient,
        strength: first.strength,
        source: first.source,
         unit: first.unit,
         supplier: first.supplier,
         stock_quantity: first.stock_quantity,
         stock_synced_at: first.stock_synced_at,
      } : null,
      summary: {
        total_quantity: movements.reduce((sum, row) => sum + reportNumberValue(row.quantity), 0),
        dispense_count: movements.length,
        unique_patient_count: beneficiaryCards.size,
        total_revenue: movements.reduce((sum, row) => sum + reportNumberValue(row.revenue), 0),
        known_cost: knownCostRows.reduce((sum, row) => sum + reportNumberValue(row.purchase_cost), 0),
        known_profit: knownProfitRows.reduce((sum, row) => sum + reportNumberValue(row.gross_margin), 0),
        coverage_ratio: movements.length ? knownProfitRows.length / movements.length : 0,
      },
      movements,
       beneficiaries: [...new Map(movements.map((row) => [row.insurance_card_number ?? row.beneficiary_name, { name: row.beneficiary_name, card: row.insurance_card_number }])).values()],
    };
  });

export const getProfitAnalysisReport = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => rangeSchema.parse(d))
  .handler(async ({ data }) => {
    const { requireTiryaqPermission } = await import("@/lib/user-management.functions");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pharmacy_id } = await requireTiryaqPermission("stock_cost_read");
    const { rows } = await loadProfitRows(supabaseAdmin, pharmacy_id, data);
    const invoiceMap = new Map<string, any>();
    const beneficiaryMap = new Map<string, any>();
    const itemMap = new Map<string, any>();
    for (const row of rows) {
      const invoice = invoiceMap.get(row.invoice_id) ?? {
        invoice_id: row.invoice_id,
        invoice_number: row.invoice_number,
        invoice_key: row.invoice_key,
        beneficiary_name: row.beneficiary_name,
        insurance_card_number: row.insurance_card_number,
        dispensing_date: row.dispensing_date,
        revenue: 0,
        known_cost: 0,
        known_profit: 0,
        item_count: 0,
         matched_count: 0,
         needs_price_count: 0,
         needs_match_count: 0,
        items: [],
      };
      invoice.revenue += reportNumberValue(row.revenue);
      invoice.known_cost += reportNumberValue(row.purchase_cost);
      invoice.known_profit += reportNumberValue(row.gross_margin);
      invoice.item_count += 1;
       if (row.gross_margin !== null) invoice.matched_count += 1;
       else if (row.source === "phif" && row.match_status === "needs_purchase_price") invoice.needs_price_count += 1;
       else invoice.needs_match_count += 1;
      invoice.items.push(row);
      invoiceMap.set(row.invoice_id, invoice);

      const beneficiaryKey = row.insurance_card_number ?? row.beneficiary_name ?? "unknown";
      const beneficiary = beneficiaryMap.get(beneficiaryKey) ?? {
        key: beneficiaryKey,
        beneficiary_name: row.beneficiary_name,
        insurance_card_number: row.insurance_card_number,
        revenue: 0,
        known_cost: 0,
        known_profit: 0,
        invoice_ids: new Set<string>(),
        item_count: 0,
      };
      beneficiary.revenue += reportNumberValue(row.revenue);
      beneficiary.known_cost += reportNumberValue(row.purchase_cost);
      beneficiary.known_profit += reportNumberValue(row.gross_margin);
      beneficiary.item_count += 1;
      beneficiary.invoice_ids.add(row.invoice_id);
      beneficiaryMap.set(beneficiaryKey, beneficiary);

      const itemKey = reportDrugIdentityKey(row, "scientific");
      const item = itemMap.get(itemKey) ?? {
        key: itemKey,
        item_name: row.item_name,
         brand: row.brand,
         active_ingredient: row.active_ingredient,
         strength: row.strength,
        source: row.source,
        revenue: 0,
        known_cost: 0,
        known_profit: 0,
        quantity: 0,
        dispense_count: 0,
         matched_count: 0,
      };
      item.revenue += reportNumberValue(row.revenue);
      item.known_cost += reportNumberValue(row.purchase_cost);
      item.known_profit += reportNumberValue(row.gross_margin);
      item.quantity += reportNumberValue(row.quantity);
      item.dispense_count += 1;
       if (row.gross_margin !== null) item.matched_count += 1;
      itemMap.set(itemKey, item);
    }
    const knownRows = rows.filter((row) => row.gross_margin !== null);
    const beneficiaries = [...beneficiaryMap.values()].map((row) => ({
      ...row,
      invoice_count: row.invoice_ids.size,
      invoice_ids: undefined,
    }));
    return {
      summary: {
        total_revenue: rows.reduce((sum, row) => sum + reportNumberValue(row.revenue), 0),
        known_cost: rows.reduce((sum, row) => sum + reportNumberValue(row.purchase_cost), 0),
        known_profit: rows.reduce((sum, row) => sum + reportNumberValue(row.gross_margin), 0),
        invoice_count: invoiceMap.size,
        unique_patient_count: beneficiaryMap.size,
        item_count: rows.length,
         matched_count: knownRows.length,
         review_count: rows.length - knownRows.length,
        coverage_ratio: rows.length ? knownRows.length / rows.length : 0,
      },
      source_split: {
        actual: summarizeProfitRows(rows.filter((row) => row.source === "actual")),
        phif: summarizeProfitRows(rows.filter((row) => row.source === "phif")),
      },
      top_profit_items: [...itemMap.values()].sort((a, b) => b.known_profit - a.known_profit).slice(0, 20),
       top_revenue_items: [...itemMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 20),
       top_dispensed_items: [...itemMap.values()].sort((a, b) => b.dispense_count - a.dispense_count).slice(0, 20),
      top_revenue_beneficiaries: beneficiaries.sort((a, b) => b.revenue - a.revenue).slice(0, 20),
      top_profit_beneficiaries: [...beneficiaries].sort((a, b) => b.known_profit - a.known_profit).slice(0, 20),
      invoices: [...invoiceMap.values()].sort((a, b) => String(b.dispensing_date ?? "").localeCompare(String(a.dispensing_date ?? ""))),
    };
  });

function summarizeProfitRows(rows: any[]) {
  return {
    revenue: rows.reduce((sum, row) => sum + reportNumberValue(row.revenue), 0),
    known_cost: rows.reduce((sum, row) => sum + reportNumberValue(row.purchase_cost), 0),
    known_profit: rows.reduce((sum, row) => sum + reportNumberValue(row.gross_margin), 0),
    item_count: rows.length,
    invoice_count: new Set(rows.map((row) => row.invoice_id)).size,
    patient_count: new Set(rows.map((row) => row.insurance_card_number ?? row.beneficiary_name).filter(Boolean)).size,
  };
}

export const savePhifSupplierPurchasePrice = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => supplierPurchaseOverrideSchema.parse(d))
  .handler(async ({ data }) => {
    const { requireTiryaqPermission } = await import("@/lib/user-management.functions");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pharmacy_id } = await requireTiryaqPermission("stock_cost_read");
    const { data: item, error: itemError } = await supabaseAdmin
      .from("phif_invoice_items")
      .select("id, phif_invoice_id, source_classification, phif_financial_fields, metadata, quantity")
      .eq("id", data.itemId)
      .maybeSingle();
    if (itemError) throw new Error(itemError.message);
    if (!item) throw new Error("Invoice item not found");
    if (item.source_classification !== "phif-supplier") {
      throw new Error("Internal purchase price is only available for PHIF Supplier items");
    }
    if (!itemUnit(item) || reportNumberValue(item.quantity) <= 0) throw new Error("وحدة الصنف أو كميته غير واضحة؛ لا يمكن حساب تكلفة الشراء");
    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from("phif_invoices")
      .select("id, pharmacy_id")
      .eq("id", item.phif_invoice_id)
      .maybeSingle();
    if (invoiceError) throw new Error(invoiceError.message);
    if (!invoice || invoice.pharmacy_id !== pharmacy_id) throw new Error("Invoice item not found");
    const fields = {
      ...(item.phif_financial_fields ?? {}),
      internal_purchase_price: data.purchasePrice,
      internal_purchase_price_updated_at: new Date().toISOString(),
    };
    const { error } = await supabaseAdmin
      .from("phif_invoice_items")
      .update({ phif_financial_fields: fields })
      .eq("id", data.itemId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
