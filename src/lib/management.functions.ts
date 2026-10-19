import { createServerFn } from "@tanstack/react-start";
import { supplierQuickCostIdentity } from "@/lib/phif-supplier-quick-cost.helpers";
import { z } from "zod";
import {
  calculateActualGrossMargin,
  currentStockCandidatesForActual,
  invoiceItemValue,
  matchActualInvoiceItemToStock,
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
import { hasPermission, type TiryaqPermission } from "@/lib/user-permissions";

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
  purchasePrice: z.number().min(0).max(1_000_000).optional(),
  purchaseUnit: z.string().trim().min(1).max(40).optional(),
  purchaseCostMode: z.enum(["total_dispensed_cost", "unit_price"]).default("total_dispensed_cost"),
  purchaseCostValue: z.number().min(0).max(1_000_000).optional(),
  purchaseCostUnit: z.string().trim().min(1).max(40).optional(),
});

const auditSchema = z.object({
  refreshNonce: z.number().optional(),
}).optional();

type SourceKey = "actual" | "phif";

type FinanceAccess = Record<SourceKey, {
  items: boolean;
  movements: boolean;
  revenue: boolean;
  cost: boolean;
  profit: boolean;
  purchasePriceWrite: boolean;
}>;

function sessionHasPermission(session: any, permission: TiryaqPermission) {
  return hasPermission(session?.session?.data?.user_role, session?.session?.data?.user_permissions, permission);
}

function financeAccess(session: any): FinanceAccess {
  return {
    actual: {
      items: sessionHasPermission(session, "actual_items_read"),
      movements: sessionHasPermission(session, "actual_movements_read"),
      revenue: sessionHasPermission(session, "actual_revenue_read"),
      cost: sessionHasPermission(session, "actual_cost_read"),
      profit: sessionHasPermission(session, "actual_profit_read"),
      purchasePriceWrite: false,
    },
    phif: {
      items: sessionHasPermission(session, "phif_items_read"),
      movements: sessionHasPermission(session, "phif_movements_read"),
      revenue: sessionHasPermission(session, "phif_revenue_read"),
      cost: sessionHasPermission(session, "phif_cost_read"),
      profit: sessionHasPermission(session, "phif_profit_read"),
      purchasePriceWrite: sessionHasPermission(session, "phif_purchase_price_write"),
    },
  };
}

async function requireTiryaqItemAccess() {
  const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
  const { TIRYAQ_PHARMACY_NAME } = await import("@/lib/pharmacy-isolation");
  const session = await requirePharmacySession();
  if (session.pharmacy_name !== TIRYAQ_PHARMACY_NAME) {
    throw new Error("Unauthorized");
  }
  const access = financeAccess(session);
  if (!access.actual.items && !access.phif.items) {
    throw new Error("لا تملك صلاحية عرض الأصناف");
  }
  return { session, access };
}

function sourceAccess(access: FinanceAccess, source: unknown) {
  return access[String(source) === "phif" ? "phif" : "actual"];
}

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

async function loadAllReportDataset(supabaseAdmin: any, pharmacyId: string) {
  const { data: invoices, error } = await supabaseAdmin
    .from("phif_invoices")
    .select("id, invoice_number, invoice_key, beneficiary_name, insurance_card_number, dispensing_date, metadata")
    .eq("pharmacy_id", pharmacyId)
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
  const stocks: ReportStock[] = [];
  for (let from = 0; ; ) {
    const { data: rows, error } = await supabaseAdmin
    .from("phif_stock_items")
    .select("source_stock_id, brand_product_id, brand_name, active_ingredient, strength, dosage_unit, package_quantity, strips_quantity, stock_quantity, source_quantity_unit, synced_at")
    .eq("pharmacy_id", pharmacyId)
    .eq("is_current", true)
    .order("id", { ascending: true })
    .range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = rows ?? [];
    if (!page.length) break;
    stocks.push(...page);
    from += page.length;
  }
  return stocks;
}

export async function loadStockWithCosts(supabaseAdmin: any, pharmacyId: string) {
  const stocks: any[] = [];
  const seen = new Set<string>();
  let expectedCount: number | null = null;
  for (let from = 0; ; ) {
    const { data: rows, error, count } = await supabaseAdmin
      .from("phif_stock_items")
      .select("id, source_stock_id, generic_ingredient_id, supplier_id, supplier_name, brand_product_id, brand_name, active_ingredient, strength, dosage_unit, package_quantity, strips_quantity, stock_quantity, source_quantity_unit, cost_price, sale_price, synced_at", { count: "exact" })
      .eq("pharmacy_id", pharmacyId)
      .eq("is_current", true)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (typeof count === "number") {
      if (expectedCount !== null && count !== expectedCount) throw new Error("تغير المخزون أثناء القراءة. أعد المحاولة.");
      expectedCount = count;
    }
    const page = rows ?? [];
    if (page.length === 0) {
      if (expectedCount !== null && from < expectedCount) throw new Error("تعذر تحميل مخزون PHIF كاملاً. أعد المحاولة.");
      break;
    }
    for (const row of page) {
      if (!row.id || seen.has(row.id)) throw new Error("تعذر التحقق من اكتمال مخزون PHIF. أعد المحاولة.");
      seen.add(row.id);
      stocks.push(row);
    }
    // Advance by received rows: a server-side row cap can be lower than the requested page.
    from += page.length;
    if (expectedCount !== null && from >= expectedCount) break;
  }
  return stocks;
}

function internalPurchaseValue(item: any): number | null {
  const raw = item.phif_financial_fields?.internal_purchase_cost_value
    ?? item.phif_financial_fields?.internal_purchase_price
    ?? item.phif_financial_fields?.internalPurchasePrice;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function itemUnit(item: any) {
  return String(item.metadata?.unit ?? item.metadata?.dosage_unit ?? item.metadata?.quantity_unit ?? item.phif_financial_fields?.unit ?? "").trim() || null;
}

function savedPurchaseUnit(item: any) {
  return String(
    item.phif_financial_fields?.internal_purchase_cost_unit
      ?? item.phif_financial_fields?.internal_purchase_unit
      ?? item.phif_financial_fields?.purchase_price_unit
      ?? item.phif_financial_fields?.internalPurchaseUnit
      ?? "",
  ).trim();
}

function savedPurchaseMode(item: any): "total_dispensed_cost" | "unit_price" {
  const mode = String(item.phif_financial_fields?.internal_purchase_cost_mode ?? "").trim();
  if (mode === "total_dispensed_cost" || mode === "unit_price") return mode;
  return "unit_price";
}

function invoiceItemName(item: any) {
  return [item.brand, item.active_ingredient, item.strength].filter(Boolean).join(" · ") || "صنف غير محدد";
}

function profitForItem(item: any, invoice: any, stocks: any[]) {
  const source = reportItemSource(item);
  const invoiceValue = invoiceItemValue(item);
  if (source === "phif") {
    const override = internalPurchaseValue(item);
    const quantity = reportNumberValue(item.quantity);
    const unit = itemUnit(item);
    const purchaseUnit = savedPurchaseUnit(item);
    const purchaseMode = savedPurchaseMode(item);
    const unitVerified = purchaseMode === "total_dispensed_cost" || Boolean(purchaseUnit && (!unit || unit.toLowerCase() === purchaseUnit.toLowerCase()));
    const purchaseCost = override !== null && unitVerified
      ? purchaseMode === "total_dispensed_cost"
        ? override
        : quantity > 0
          ? override * quantity
          : null
      : null;
    return {
      source,
      invoiceValue,
      revenue: invoiceValue,
      purchaseCost,
      grossMargin: purchaseCost === null ? null : invoiceValue - purchaseCost,
      unitPurchasePrice: override,
       status: purchaseCost === null ? (override !== null && !unitVerified ? "pricing_unit_unverified" : "needs_purchase_price") : "matched",
       reason: purchaseCost === null ? (override !== null && !unitVerified ? "pricing_unit_unverified" : "phif_supplier_purchase_price_missing") : "phif_supplier_internal_purchase_price",
      stock: null,
      invoice,
    };
  }
  const margin = calculateActualGrossMargin(item, stocks);
  return {
    source,
    invoiceValue: margin.invoiceValue,
    revenue: margin.invoiceValue,
    purchaseCost: margin.purchaseCost,
    grossMargin: margin.grossMargin,
    unitPurchasePrice: margin.status === "matched" ? reportNumberValue(margin.stock?.cost_price) : null,
    status: margin.status,
    reason: margin.reason,
    stock: margin.stock,
    invoice,
  };
}

async function loadProfitRows(supabaseAdmin: any, pharmacyId: string, data: { dateFrom: string; dateTo: string; source?: "all" | "actual" | "phif" }, access?: FinanceAccess) {
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
        quick_cost_identity: profit.source === "phif" ? supplierQuickCostIdentity(item) : null,
        invoice_quantity_unit: itemUnit(item),
        invoice_dosage_form: item.metadata?.dosage_form ?? item.metadata?.dosageForm ?? item.metadata?.form ?? item.metadata?.pharmaceuticalForm ?? itemUnit(item),
        invoice_package_quantity: item.metadata?.package_quantity ?? item.metadata?.packageQuantity ?? null,
        invoice_strips_quantity: item.metadata?.strips_quantity ?? item.metadata?.stripsQuantity ?? null,
         quantity_label: reportItemQuantityLabel(item, profit.stock),
         identity_key: reportDrugIdentityKey(item, "scientific"),
          purchase_cost_mode: profit.source === "phif" ? savedPurchaseMode(item) : null,
          unit: (profit.source === "phif" ? String(item.phif_financial_fields?.internal_purchase_cost_unit ?? item.phif_financial_fields?.internal_purchase_unit ?? "").trim() || itemUnit(item) : itemUnit(item) ?? profit.stock?.dosage_unit) ?? null,
         supplier: item.supplier ?? profit.stock?.supplier_name ?? null,
         stock_quantity: profit.stock?.stock_quantity ?? null,
         stock_synced_at: profit.stock?.synced_at ?? null,
         matched_stock_id: profit.stock?.source_stock_id ?? null,
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
  return { invoices: dataset.invoices, items: dataset.items, rows: access ? redactProfitRows(rows, access) : rows, stocks };
}

function isKnownCostRow(row: any) {
  return row.purchase_cost !== null && row.purchase_cost !== undefined && row.gross_margin !== null && row.gross_margin !== undefined;
}

function isFinanciallyCompleteRow(row: any) {
  return row.match_status === "matched";
}

function invoiceFinancialStatus(invoice: any) {
  if ((invoice.needs_match_count ?? 0) > 0) return "actual_unmatched";
  if ((invoice.unit_review_count ?? 0) > 0) return "unit_review";
  if ((invoice.needs_price_count ?? 0) > 0) return "incomplete_cost";
  return "complete";
}

function auditReason(reason: string) {
  if (reason === "ambiguous_match") return "AMBIGUOUS_MATCHES";
  if (reason === "unsafe_identity") return "MISSING_IDENTIFIERS";
  if (reason === "pricing_unit_unverified") return "UNIT_MISMATCH";
  if (reason === "unit_mismatch") return "UNIT_MISMATCH";
  if (reason === "strength_mismatch") return "STRENGTH_MISMATCH";
  if (reason === "supplier_mismatch") return "SUPPLIER_MISMATCH";
  if (reason === "unknown_source") return "SOURCE_MISSING";
  if (reason === "no_match") return "NO_STOCK_MATCH";
  if (reason === "not_actual") return "SOURCE_MISMATCH";
  return reason || "NO_STOCK_MATCH";
}

function stockCandidateView(stock: any, reason?: string) {
  return {
    stock_id: stock?.source_stock_id ?? stock?.id ?? null,
    brand_name: stock?.brand_name ?? null,
    generic: stock?.active_ingredient ?? null,
    strength: stock?.strength ?? null,
    unit: stock?.dosage_unit ?? stock?.source_quantity_unit ?? null,
    supplier: stock?.supplier_name ?? null,
    cost_price: reportNumberValue(stock?.cost_price),
    match_score: null,
    match_reasons: reason ? [reason] : [],
  };
}

function auditStatusPriority(status: string) {
  if (status === "ambiguous") return 3;
  if (status === "unmatched") return 2;
  return 1;
}

export function buildManagementAuditReport(input: { invoices: any[]; items: any[]; stocks: any[] }) {
  const invoiceById = new Map(input.invoices.map((invoice) => [invoice.id, invoice]));
  const actualGroups = new Map<string, any>();
  const financialInvoices = new Map<string, any>();
  const profitCache = new Map<string, ReturnType<typeof profitForItem>>();
  const matchCache = new Map<string, ReturnType<typeof matchActualInvoiceItemToStock>>();
  const actualAuditKey = (item: any) => JSON.stringify({
    source: item.source_classification ?? null,
    brand: item.brand ?? null,
    ingredient: item.active_ingredient ?? null,
    strength: item.strength ?? null,
    quantity: item.quantity ?? null,
    metadata: item.metadata ?? null,
    financial: item.phif_financial_fields ?? null,
    supplier: item.supplier ?? null,
  });
  const actualMatchKey = (item: any) => JSON.stringify({
    source: item.source_classification ?? null,
    brand: item.brand ?? null,
    ingredient: item.active_ingredient ?? null,
    strength: item.strength ?? null,
    metadata: item.metadata ?? null,
    financial: item.phif_financial_fields ?? null,
    supplier: item.supplier ?? null,
  });
  const cachedProfit = (item: any, invoice: any) => {
    const key = actualAuditKey(item);
    const existing = profitCache.get(key);
    if (existing) return existing;
    const result = profitForItem(item, invoice, input.stocks);
    profitCache.set(key, result);
    return result;
  };
  const cachedMatch = (item: any) => {
    const key = actualMatchKey(item);
    const existing = matchCache.get(key);
    if (existing) return existing;
    const result = matchActualInvoiceItemToStock(item, currentStockCandidatesForActual(item, input.stocks));
    matchCache.set(key, result);
    return result;
  };

  for (const invoice of input.invoices) {
    financialInvoices.set(invoice.id, {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number ?? invoice.invoice_key ?? null,
      invoice_key: invoice.invoice_key ?? null,
      beneficiary_name: invoice.beneficiary_name ?? null,
      dispensing_date: invoice.dispensing_date ?? null,
      item_count: 0,
      actual_unmatched_count: 0,
      phif_missing_cost_count: 0,
      unit_review_count: 0,
      reasons: [],
    });
  }

  for (const item of input.items) {
    const invoice: any = invoiceById.get(item.phif_invoice_id) ?? {};
    const invoiceAudit = financialInvoices.get(item.phif_invoice_id);
    if (invoiceAudit) invoiceAudit.item_count += 1;

    const profit = cachedProfit(item, invoice);
    if (profit.source === "phif") {
      if (invoiceAudit && profit.status === "needs_purchase_price") {
        invoiceAudit.phif_missing_cost_count += 1;
        invoiceAudit.reasons.push("PHIF Supplier بدون تكلفة محفوظة");
      } else if (invoiceAudit && profit.status === "pricing_unit_unverified") {
        invoiceAudit.unit_review_count += 1;
        invoiceAudit.reasons.push("وحدة تكلفة PHIF Supplier تحتاج مراجعة");
      }
      continue;
    }

    const match = profit.status === "matched" ? null : cachedMatch(item);
    const reasonCode = profit.status === "pricing_unit_unverified" ? "UNIT_MISMATCH" : auditReason(match?.reason ?? profit.reason);
    const status = profit.status === "matched"
      ? "matched"
      : match?.reason === "ambiguous_match"
        ? "ambiguous"
        : "unmatched";
    if (invoiceAudit && status === "unmatched") {
      invoiceAudit.actual_unmatched_count += 1;
      invoiceAudit.reasons.push(`Actual: ${reasonCode}`);
    } else if (invoiceAudit && status === "ambiguous") {
      invoiceAudit.actual_unmatched_count += 1;
      invoiceAudit.reasons.push("Actual: AMBIGUOUS_MATCHES");
    }

    const identityKey = reportDrugIdentityKey(item, "brand");
    const row = actualGroups.get(identityKey) ?? {
      identity_key: identityKey,
      brand: item.brand ?? null,
      active_ingredient: item.active_ingredient ?? null,
      strength: item.strength ?? null,
      unit: item.metadata?.unit ?? item.metadata?.dosage_unit ?? item.metadata?.quantity_unit ?? item.metadata?.dosage_form ?? null,
      occurrence_count: 0,
      invoice_ids: new Set<string>(),
      status,
      reason: status === "matched" ? null : reasonCode,
      candidates: [],
    };
    row.occurrence_count += 1;
    row.invoice_ids.add(item.phif_invoice_id);
    if (auditStatusPriority(status) > auditStatusPriority(row.status)) {
      row.status = status;
      row.reason = status === "matched" ? null : reasonCode;
    }
    const candidateRows = match?.status === "needs_match_review" && match.candidates
      ? match.candidates.map((stock) => stockCandidateView(stock, "ambiguous_match"))
      : profit.stock
        ? [stockCandidateView(profit.stock, profit.reason)]
        : [];
    for (const candidate of candidateRows) {
      if (!row.candidates.some((existing: any) => existing.stock_id === candidate.stock_id && existing.brand_name === candidate.brand_name)) {
        row.candidates.push(candidate);
      }
    }
    actualGroups.set(identityKey, row);
  }

  const actualItems = [...actualGroups.values()].map((row) => ({
    ...row,
    invoice_count: row.invoice_ids.size,
    invoice_ids: undefined,
  }));
  const actualSummary = {
    total_unique: actualItems.length,
    matched: actualItems.filter((row) => row.status === "matched").length,
    unmatched: actualItems.filter((row) => row.status === "unmatched").length,
    ambiguous: actualItems.filter((row) => row.status === "ambiguous").length,
    match_ratio: actualItems.length ? actualItems.filter((row) => row.status === "matched").length / actualItems.length : 0,
  };

  const invoices = [...financialInvoices.values()].map((invoice) => {
    const uniqueReasons = [...new Set(invoice.reasons)];
    return {
      ...invoice,
      reasons: uniqueReasons,
      status: uniqueReasons.length === 0 ? "complete" : "incomplete",
    };
  });
  const financialSummary = {
    complete_invoices: invoices.filter((invoice) => invoice.status === "complete").length,
    incomplete_invoices: invoices.filter((invoice) => invoice.status === "incomplete").length,
    actual_unmatched_items: invoices.reduce((sum, invoice) => sum + invoice.actual_unmatched_count, 0),
    phif_missing_cost_items: invoices.reduce((sum, invoice) => sum + invoice.phif_missing_cost_count, 0),
  };

  return {
    generated_at: new Date().toISOString(),
    actual: {
      summary: actualSummary,
      issues: actualItems
        .filter((row) => row.status !== "matched")
        .sort((a, b) => b.occurrence_count - a.occurrence_count),
    },
    financial: {
      summary: financialSummary,
      incomplete_invoices: invoices
        .filter((invoice) => invoice.status === "incomplete")
        .sort((a, b) => String(b.dispensing_date ?? "").localeCompare(String(a.dispensing_date ?? ""))),
    },
  };
}

function redactProfitRow(row: any, access: FinanceAccess) {
  const allowed = sourceAccess(access, row.source);
  const canShowMovement = allowed.movements || allowed.items;
  return {
    ...row,
    beneficiary_name: canShowMovement ? row.beneficiary_name : null,
    insurance_card_number: canShowMovement ? row.insurance_card_number : null,
    quantity: canShowMovement ? row.quantity : null,
    quantity_label: canShowMovement ? row.quantity_label : null,
    invoice_value: allowed.revenue ? row.invoice_value : null,
    revenue: allowed.revenue ? row.revenue : null,
    purchase_cost: allowed.cost ? row.purchase_cost : null,
    unit_purchase_price: allowed.cost ? row.unit_purchase_price : null,
    gross_margin: allowed.profit ? row.gross_margin : null,
    stock_quantity: allowed.movements ? row.stock_quantity : null,
    cost_hidden: !allowed.cost && row.purchase_cost !== null && row.purchase_cost !== undefined,
    profit_hidden: !allowed.profit && row.gross_margin !== null && row.gross_margin !== undefined,
    revenue_hidden: !allowed.revenue && ((row.revenue !== null && row.revenue !== undefined) || (row.invoice_value !== null && row.invoice_value !== undefined)),
    can_edit_purchase_price: row.source === "phif" && allowed.purchasePriceWrite,
  };
}

function redactProfitRows(rows: any[], access: FinanceAccess) {
  return rows
    .filter((row) => sourceAccess(access, row.source).items || sourceAccess(access, row.source).movements)
    .map((row) => redactProfitRow(row, access));
}

function summarizeInvoiceItems(rows: any[]) {
  const actualRows = rows.filter((row) => row.source === "actual");
  const phifRows = rows.filter((row) => row.source === "phif");
  const knownRows = rows.filter(isKnownCostRow);
  return {
    revenue: rows.reduce((sum, row) => sum + reportNumberValue(row.revenue), 0),
    actual_value: actualRows.reduce((sum, row) => sum + reportNumberValue(row.revenue), 0),
    phif_value: phifRows.reduce((sum, row) => sum + reportNumberValue(row.revenue), 0),
    known_cost: knownRows.reduce((sum, row) => sum + reportNumberValue(row.purchase_cost), 0),
    known_profit: knownRows.reduce((sum, row) => sum + reportNumberValue(row.gross_margin), 0),
    matched_count: rows.filter(isFinanciallyCompleteRow).length,
    needs_price_count: rows.filter((row) => row.source === "phif" && row.match_status === "needs_purchase_price").length,
    actual_unmatched_count: rows.filter((row) => row.source === "actual" && row.match_status === "needs_match_review").length,
    unit_review_count: rows.filter((row) => row.match_status === "pricing_unit_unverified").length,
  };
}

async function buildManagementMonthlyReport(data: z.infer<typeof monthlyReportSchema>, permission: "reports_read" | "reports_export") {
  const { requireTiryaqPermission } = await import("@/lib/user-management.functions");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const session = await requireTiryaqPermission(permission);
  const { pharmacy_id } = session;
  const current = await loadReportDataset(supabaseAdmin, pharmacy_id, data.dateFrom, data.dateTo);
  const previousRange = previousMonthRange(data.dateFrom, data.dateTo);
  const previous = previousRange
    ? await loadReportDataset(supabaseAdmin, pharmacy_id, previousRange.dateFrom, previousRange.dateTo)
    : null;
  const firstDispensingByCard = await loadFirstDispensingByCard(supabaseAdmin, pharmacy_id, current.invoices);
  const stockItems = await loadCurrentStockForReport(supabaseAdmin, pharmacy_id);
  return redactMonthlyReport(buildMonthlyReport({
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
  }), financeAccess(session));
}

function redactMonthlyReport(report: any, access: FinanceAccess) {
  const actualRevenue = access.actual.revenue;
  const phifRevenue = access.phif.revenue;
  const canSeeAllRevenue = actualRevenue && phifRevenue;
  const visibleActual = actualRevenue ? report.source_split.actual.value : 0;
  const visiblePhif = phifRevenue ? report.source_split.phif.value : 0;
  const visibleTotal = visibleActual + visiblePhif;
  return {
    ...report,
    summary: {
      ...report.summary,
      total_dispensed_value: canSeeAllRevenue ? report.summary.total_dispensed_value : visibleTotal,
      actual_value: actualRevenue ? report.summary.actual_value : null,
      phif_value: phifRevenue ? report.summary.phif_value : null,
    },
    source_split: {
      actual: {
        ...report.source_split.actual,
        value: actualRevenue ? report.source_split.actual.value : null,
        contribution: actualRevenue && visibleTotal ? report.source_split.actual.value / visibleTotal : null,
      },
      phif: {
        ...report.source_split.phif,
        value: phifRevenue ? report.source_split.phif.value : null,
        contribution: phifRevenue && visibleTotal ? report.source_split.phif.value / visibleTotal : null,
      },
    },
    beneficiary_stats: {
      ...report.beneficiary_stats,
      beneficiaries: report.beneficiary_stats.beneficiaries.map((row: any) => ({
        ...row,
        total_value: canSeeAllRevenue ? row.total_value : null,
      })),
    },
    top_drugs: report.top_drugs.map((row: any) => {
      const canSeeRevenue = sourceAccess(access, row.source).revenue;
      return {
        ...row,
        total_value: canSeeRevenue ? row.total_value : null,
        products: row.products?.map((product: any) => ({ ...product, value: canSeeRevenue ? product.value : null })),
      };
    }),
    daily: report.daily.map((row: any) => ({
      ...row,
      actual_value: actualRevenue ? row.actual_value : null,
      phif_value: phifRevenue ? row.phif_value : null,
      total_value: canSeeAllRevenue ? row.total_value : (actualRevenue ? row.actual_value : 0) + (phifRevenue ? row.phif_value : 0),
    })),
    comparison: report.comparison ? {
      ...report.comparison,
      total_value: canSeeAllRevenue ? report.comparison.total_value : null,
    } : null,
    reconciliation: canSeeAllRevenue ? report.reconciliation : { available: false, status: "hidden_by_permissions", invoice_total: null, item_total: null, difference: null },
  };
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
    const session = await requireTiryaqPermission("treasury_read");
    const { pharmacy_id } = session;
    const { rows } = await loadProfitRows(supabaseAdmin, pharmacy_id, data, financeAccess(session));
    const invoiceMap = new Map<string, any>();
    const uniquePatients = new Set<string>();

    for (const row of rows) {
      const invoice = invoiceMap.get(row.invoice_id) ?? {
        id: row.invoice_id,
        invoice_number: row.invoice_number,
        invoice_key: row.invoice_key,
        beneficiary_name: row.beneficiary_name,
        insurance_card_number: row.insurance_card_number,
        dispensing_date: row.dispensing_date,
        item_count: 0,
        actual_value: 0,
        phif_value: 0,
        total_dispensed_value: 0,
        known_cost: 0,
        known_profit: 0,
        matched_count: 0,
        needs_price_count: 0,
        needs_match_count: 0,
        unit_review_count: 0,
        items: [],
      };
      invoice.item_count += 1;
      invoice.total_dispensed_value += reportNumberValue(row.revenue);
      if (row.source === "actual") invoice.actual_value += reportNumberValue(row.revenue);
      if (row.source === "phif") invoice.phif_value += reportNumberValue(row.revenue);
      if (isFinanciallyCompleteRow(row)) {
        invoice.matched_count += 1;
      }
      if (isKnownCostRow(row)) {
        invoice.known_cost += reportNumberValue(row.purchase_cost);
        invoice.known_profit += reportNumberValue(row.gross_margin);
      } else if (row.match_status === "pricing_unit_unverified") {
        invoice.unit_review_count += 1;
      } else if (row.source === "phif") {
        invoice.needs_price_count += 1;
      } else {
        invoice.needs_match_count += 1;
      }
      invoice.items.push(row);
      invoiceMap.set(row.invoice_id, invoice);
      uniquePatients.add(row.insurance_card_number ?? row.beneficiary_name ?? row.invoice_id);
    }

    const details = [...invoiceMap.values()].map((invoice) => ({
      ...invoice,
      financial_status: invoiceFinancialStatus(invoice),
      cost_coverage_ratio: invoice.item_count ? invoice.matched_count / invoice.item_count : 0,
    }));

    return {
      invoice_count: details.length,
      unique_patient_count: uniquePatients.size,
      item_count: rows.length,
      actual_value: rows.filter((row) => row.source === "actual").reduce((sum, row) => sum + reportNumberValue(row.revenue), 0),
      phif_value: rows.filter((row) => row.source === "phif").reduce((sum, row) => sum + reportNumberValue(row.revenue), 0),
      total_dispensed_value: rows.reduce((sum, row) => sum + reportNumberValue(row.revenue), 0),
      known_cost: rows.reduce((sum, row) => sum + reportNumberValue(row.purchase_cost), 0),
      known_profit: rows.reduce((sum, row) => sum + reportNumberValue(row.gross_margin), 0),
      matched_item_count: rows.filter(isFinanciallyCompleteRow).length,
      needs_price_count: rows.filter((row) => row.source === "phif" && row.match_status === "needs_purchase_price").length,
      actual_unmatched_count: rows.filter((row) => row.source === "actual" && row.match_status === "needs_match_review").length,
      unit_review_count: rows.filter((row) => row.match_status === "pricing_unit_unverified").length,
      cost_coverage_ratio: rows.length ? rows.filter(isFinanciallyCompleteRow).length / rows.length : 0,
      employee_breakdown_available: false,
      details,
    };
  });

export const getActualProfitReport = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => rangeSchema.pick({ dateFrom: true, dateTo: true }).parse(d))
  .handler(async ({ data }) => {
    const { requireTiryaqPermission } = await import("@/lib/user-management.functions");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const session = await requireTiryaqPermission("reports_read");
    const { pharmacy_id } = session;
    const access = financeAccess(session);

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

    const stockRows = await loadStockWithCosts(supabaseAdmin, pharmacy_id);

    const invoiceById = new Map((invoices ?? []).map((invoice: any) => [invoice.id, invoice]));
    const details = redactProfitRows(items.map((item) => {
      const invoice: any = invoiceById.get(item.phif_invoice_id);
      const candidates = currentStockCandidatesForActual(item, stockRows ?? []);
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
        source: "actual",
        unit_purchase_price: margin.status === "matched" ? reportNumberValue(margin.stock?.cost_price) : null,
      };
    }), access);

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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { session, access } = await requireTiryaqItemAccess();
    const { pharmacy_id } = session;
    const dataset = await loadReportDataset(supabaseAdmin, pharmacy_id, data.dateFrom, data.dateTo);
    const query = data.search.toLowerCase();
    const grouped = new Map<string, any>();
    for (const item of dataset.items) {
      const source = reportItemSource(item);
      if (!sourceAccess(access, source).items) continue;
      const text = [item.brand, item.active_ingredient, item.strength].filter(Boolean).join(" ").toLowerCase();
      if (!text.includes(query)) continue;
      const identityKey = reportDrugIdentityKey(item, "scientific");
      const row = grouped.get(identityKey) ?? {
        identity_key: identityKey,
        brand: item.brand ?? null,
        active_ingredient: item.active_ingredient ?? null,
        strength: item.strength ?? null,
        source,
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { session, access } = await requireTiryaqItemAccess();
    const { pharmacy_id } = session;
    const { rows } = await loadProfitRows(supabaseAdmin, pharmacy_id, { dateFrom: data.dateFrom, dateTo: data.dateTo, source: "all" }, access);
    const movements = rows.filter((row) => {
       const key = row.identity_key;
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

export const getManagementAuditReport = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => auditSchema.parse(d))
  .handler(async () => {
    try {
      const { requireTiryaqPermission } = await import("@/lib/user-management.functions");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { pharmacy_id } = await requireTiryaqPermission("reports_read");
      const dataset = await loadAllReportDataset(supabaseAdmin, pharmacy_id);
      const stocks = await loadStockWithCosts(supabaseAdmin, pharmacy_id);
      return buildManagementAuditReport({ invoices: dataset.invoices, items: dataset.items, stocks });
    } catch (error: any) {
      console.error("management audit failed", {
        name: error?.name ?? null,
        message: error?.message ?? "Unknown audit error",
        code: error?.code ?? null,
        details: error?.details ?? null,
        hint: error?.hint ?? null,
      });
      throw new Error("تعذر تشغيل التدقيق من الخادم. تحقق من صلاحية التقارير وتوفر بيانات المخزون ثم حاول مرة أخرى.");
    }
  });

export const getProfitAnalysisReport = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => rangeSchema.parse(d))
  .handler(async ({ data }) => {
    const { requireTiryaqPermission } = await import("@/lib/user-management.functions");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const session = await requireTiryaqPermission("reports_read");
    const { pharmacy_id } = session;
    const { rows } = await loadProfitRows(supabaseAdmin, pharmacy_id, data, financeAccess(session));
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
        actual_value: 0,
        phif_value: 0,
        known_cost: 0,
        known_profit: 0,
        item_count: 0,
         matched_count: 0,
         needs_price_count: 0,
         needs_match_count: 0,
         unit_review_count: 0,
        items: [],
      };
      invoice.revenue += reportNumberValue(row.revenue);
      if (row.source === "actual") invoice.actual_value += reportNumberValue(row.revenue);
      if (row.source === "phif") invoice.phif_value += reportNumberValue(row.revenue);
      invoice.known_cost += reportNumberValue(row.purchase_cost);
      invoice.known_profit += reportNumberValue(row.gross_margin);
      invoice.item_count += 1;
       if (isFinanciallyCompleteRow(row)) invoice.matched_count += 1;
       else if (row.source === "phif" && row.match_status === "needs_purchase_price") invoice.needs_price_count += 1;
       else if (row.match_status === "pricing_unit_unverified") invoice.unit_review_count += 1;
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

       const itemKey = row.identity_key;
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
       if (isFinanciallyCompleteRow(row)) item.matched_count += 1;
      itemMap.set(itemKey, item);
    }
    const knownRows = rows.filter(isFinanciallyCompleteRow);
    const invoiceRows = [...invoiceMap.values()].map((invoice) => ({
      ...invoice,
      financial_status: invoiceFinancialStatus(invoice),
      cost_coverage_ratio: invoice.item_count ? invoice.matched_count / invoice.item_count : 0,
    }));
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
         complete_invoice_count: invoiceRows.filter((invoice) => invoice.financial_status === "complete").length,
         incomplete_invoice_count: invoiceRows.filter((invoice) => invoice.financial_status !== "complete").length,
         needs_price_item_count: rows.filter((row) => row.source === "phif" && row.match_status === "needs_purchase_price").length,
         actual_unmatched_item_count: rows.filter((row) => row.source === "actual" && row.match_status === "needs_match_review").length,
         unit_review_item_count: rows.filter((row) => row.match_status === "pricing_unit_unverified").length,
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
      invoices: invoiceRows.sort((a, b) => String(b.dispensing_date ?? "").localeCompare(String(a.dispensing_date ?? ""))),
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
    const { pharmacy_id } = await requireTiryaqPermission("phif_purchase_price_write");
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
    const purchaseValue = data.purchaseCostValue ?? data.purchasePrice;
    if (purchaseValue === undefined) throw new Error("Purchase cost is required");
    if (data.purchaseCostMode === "unit_price" && reportNumberValue(item.quantity) <= 0) {
      throw new Error("Invoice item quantity is required for unit-price purchase cost");
    }
    const recordedUnit = String(item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? (item.metadata.unit ?? item.metadata.dosage_unit ?? item.metadata.quantity_unit ?? "") : "").trim();
    const purchaseUnit = data.purchaseCostUnit ?? data.purchaseUnit;
    if (data.purchaseCostMode === "unit_price" && !purchaseUnit) throw new Error("Purchase cost unit is required");
    if (data.purchaseCostMode === "unit_price" && recordedUnit && purchaseUnit && recordedUnit.toLowerCase() !== purchaseUnit.toLowerCase()) {
      throw new Error("Purchase cost unit does not match invoice item unit");
    }
    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from("phif_invoices")
      .select("id, pharmacy_id")
      .eq("id", item.phif_invoice_id)
      .maybeSingle();
    if (invoiceError) throw new Error(invoiceError.message);
    if (!invoice || invoice.pharmacy_id !== pharmacy_id) throw new Error("Invoice item not found");
    const fields = {
      ...(typeof item.phif_financial_fields === "object" && item.phif_financial_fields !== null && !Array.isArray(item.phif_financial_fields) ? item.phif_financial_fields : {}),
      internal_purchase_cost_mode: data.purchaseCostMode,
      internal_purchase_cost_value: purchaseValue,
      internal_purchase_cost_unit: data.purchaseCostMode === "unit_price" ? purchaseUnit : null,
      internal_purchase_price: purchaseValue,
      internal_purchase_unit: data.purchaseCostMode === "unit_price" ? purchaseUnit : null,
      purchase_price_unit: data.purchaseCostMode === "unit_price" ? purchaseUnit : null,
      internal_purchase_price_updated_at: new Date().toISOString(),
    };
    const { error } = await supabaseAdmin
      .from("phif_invoice_items")
      .update({ phif_financial_fields: fields })
      .eq("id", data.itemId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
