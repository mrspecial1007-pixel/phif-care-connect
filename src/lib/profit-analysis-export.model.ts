import { hasPermission } from "./user-permissions";

export type ExportColumn = { title: string; kind?: "money" | "number" | "percent" | "date" | "text"; width?: number };
export type ExportCell = string | number | null;
export type ExportSection = { id: string; title: string; columns: ExportColumn[]; rows: ExportCell[][]; totals?: ExportCell[] };
export type ProfitExport = {
  meta: { pharmacy: string; dateFrom: string; dateTo: string; source: "all" | "actual" | "phif"; issuedAt: string };
  summary: ExportSection;
  sources: ExportSection;
  beneficiaries: ExportSection;
  revenueItems: ExportSection;
  profitItems: ExportSection;
  invoices: ExportSection;
  details: ExportSection;
  complete: boolean;
};
export type ProfitExportFormat = "pdf-summary" | "pdf-full" | "xlsx";
export const profitSourceLabel = (source: string) => source === "actual" ? "Actual" : source === "phif" ? "PHIF Supplier" : "جميع المصادر";
const col = (title: string, kind: ExportColumn["kind"] = "text", width = 16): ExportColumn => ({ title, kind, width });
const money = (value: unknown): number | null => value == null || !Number.isFinite(Number(value)) ? null : Number(value);

export function canExportProfit(user: any, source: "all" | "actual" | "phif", access: any) {
  const can = (permission: any) => hasPermission(user?.user_role, user?.user_permissions, permission);
  if (!can("reports_read") || !can("reports_export")) return false;
  if (source !== "phif" && !can("stock_cost_read")) return false;
  return (["actual", "phif"] as const).filter(s => source === "all" || source === s)
    .every(s => ["items", "movements", "revenue", "cost", "profit"].every(right => access[s]?.[right] === true));
}
export function validProfitExportRange(from: string, to: string) {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  return valid(from) && valid(to) && from <= to;
}
const state = (complete: boolean) => complete ? "مكتملة" : "غير مكتملة - القيم المالية المعروفة فقط";
const financialColumns = [col("الإيراد", "money"), col("التكلفة المعروفة", "money"), col("الربح المعروف", "money"), col("حالة التكلفة", "text", 30)];

/** Presentation only. Every financial value comes from the existing report builder. */
export function profitExportPayload(report: any, meta: ProfitExport["meta"]): ProfitExport {
  const s = report.summary;
  const knownCost = s.matched_count ? money(s.known_cost) : null;
  const knownProfit = s.matched_count ? money(s.known_profit) : null;
  const totals = ["الإجمالي", null, null, null, money(s.total_revenue), knownCost, knownProfit, state(!s.review_count)];
  const beneficiaryKey = (r: any) => r.insurance_card_number ?? r.beneficiary_name ?? "unknown";
  const beneficiaryCompletion = new Map<string, boolean>();
  for (const invoice of report.invoices) {
    const key = beneficiaryKey(invoice);
    beneficiaryCompletion.set(key, (beneficiaryCompletion.get(key) ?? true) && invoice.financial_status === "complete");
  }
  const allItems = report.export_details.items;
  const itemRow = (r: any) => {
    const scientific = String(r.active_ingredient || r.item_name || "غير مسجل");
    const displayKey = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
    const brand = r.brand && ![scientific, `${scientific} ${r.strength || ""}`].some(name => displayKey(name) === displayKey(String(r.brand))) ? String(r.brand) : null;
    return [scientific, r.strength || null, brand, profitSourceLabel(r.source), money(r.revenue), r.matched_count ? money(r.known_cost) : null,
      r.matched_count ? money(r.known_profit) : null, state(r.matched_count === r.dispense_count)] as ExportCell[];
  };
  const itemColumns = [col("الاسم العلمي", "text", 42), col("التركيز", "text", 18), col("الاسم التجاري", "text", 28), col("المصدر", "text", 18), ...financialColumns];
  const invoiceRows = report.invoices.map((i: any) => [String(i.invoice_number || i.invoice_key || ""), i.dispensing_date || null,
    i.beneficiary_name || null, i.insurance_card_number == null ? null : String(i.insurance_card_number), money(i.revenue),
    i.matched_count ? money(i.known_cost) : null, i.matched_count ? money(i.known_profit) : null, state(i.financial_status === "complete")] as ExportCell[]);
  const details = report.invoices.flatMap((i: any) => i.items.map((r: any) => [
    String(i.invoice_number || i.invoice_key || ""), i.dispensing_date || null, r.active_ingredient || r.item_name || null, r.strength || null,
    r.brand || null, profitSourceLabel(r.source), money(r.quantity), r.invoice_quantity_unit || null, money(r.revenue),
    money(r.purchase_cost), money(r.gross_margin), state(r.match_status === "matched"), r.match_status === "matched" ? null : r.match_reason || r.match_status,
  ] as ExportCell[]));
  return {
    meta, complete: !s.review_count,
    summary: { id: "summary", title: "الملخص المالي", columns: [col("المؤشر", "text", 42), col("القيمة", "text", 34)], rows: [
      ["إجمالي الإيراد (د.ل)", money(s.total_revenue)], ["إجمالي التكلفة المعروفة (د.ل)", knownCost], ["إجمالي الربح المعروف (د.ل)", knownProfit],
      ["تغطية التكلفة", s.coverage_ratio], ["عدد الفواتير", s.invoice_count],
      ["الفواتير المكتملة", s.complete_invoice_count], ["الفواتير غير المكتملة", s.incomplete_invoice_count],
      ["عدد بنود الصرف", s.item_count], ["البنود المكتملة", s.matched_count], ["بنود تحتاج تسعيرًا", s.needs_price_item_count],
      ["بنود تحتاج مراجعة", s.review_count], ["عدد المستفيدين وفق التقرير", s.unique_patient_count],
    ] },
    sources: { id: "sources", title: "مقارنة المصادر", columns: [col("المصدر", "text", 22), col("أصناف فريدة", "number"), col("بنود الصرف", "number"),
      col("الإيراد", "money"), col("التكلفة المعروفة", "money"), col("الربح المعروف", "money"), col("نسبة الربح", "percent")],
      rows: (["actual", "phif"] as const).filter(source => meta.source === "all" || meta.source === source).map(source => {
        const r = report.source_split[source];
        const rows = report.invoices.flatMap((i: any) => i.items).filter((i: any) => i.source === source);
        const complete = rows.length > 0 && rows.every((i: any) => i.match_status === "matched");
        const anyKnown = rows.some((i: any) => i.purchase_cost != null && i.gross_margin != null);
        return [profitSourceLabel(source), new Set(rows.map((i: any) => i.identity_key)).size, r.item_count, money(r.revenue), anyKnown ? money(r.known_cost) : null,
          anyKnown ? money(r.known_profit) : null, complete && r.revenue ? r.known_profit / r.revenue : null];
      }) },
    beneficiaries: { id: "beneficiaries", title: "المستفيدون حسب الإيراد", columns: [col("المستفيد", "text", 38), col("رقم البطاقة", "text", 24), col("الفواتير", "number"), col("بنود الصرف", "number"), ...financialColumns],
      rows: [...report.export_details.beneficiaries].sort((a, b) => b.revenue - a.revenue).map((r: any) => {
        const invoices = report.invoices.filter((i: any) => beneficiaryKey(i) === r.key);
        const anyKnown = invoices.some((i: any) => i.matched_count > 0);
        return [r.beneficiary_name || "غير مسجل", r.insurance_card_number == null ? null : String(r.insurance_card_number), r.invoice_count, r.item_count,
          money(r.revenue), anyKnown ? money(r.known_cost) : null, anyKnown ? money(r.known_profit) : null, state(beneficiaryCompletion.get(r.key) === true)];
      }), totals },
    revenueItems: { id: "revenueItems", title: "الأصناف حسب الإيراد", columns: itemColumns, rows: [...allItems].sort((a, b) => b.revenue - a.revenue).map(itemRow), totals },
    profitItems: { id: "profitItems", title: "الأصناف حسب الربح المعروف", columns: itemColumns, rows: [...allItems].sort((a, b) => b.known_profit - a.known_profit).map(itemRow), totals },
    invoices: { id: "invoices", title: "الفواتير", columns: [col("رقم الفاتورة", "text", 23), col("تاريخ الصرف", "date", 18), col("المستفيد", "text", 38), col("رقم البطاقة", "text", 24), ...financialColumns], rows: invoiceRows, totals },
    details: { id: "details", title: "تفاصيل البنود", columns: [col("رقم الفاتورة", "text", 23), col("تاريخ الصرف", "date", 18), col("الاسم العلمي", "text", 42), col("التركيز", "text", 18), col("الاسم التجاري الأصلي", "text", 32), col("المصدر", "text", 18), col("الكمية", "number"), col("وحدة كمية الفاتورة"), col("قيمة الصرف", "money"), col("تكلفة البند", "money"), col("ربح البند", "money"), col("حالة التكلفة", "text", 30), col("سبب المراجعة", "text", 30)], rows: details },
  };
}

export function profitExportFilename(data: ProfitExport, format: ProfitExportFormat) {
  return `PHIF-profit-${format}-${data.meta.source}-${data.meta.dateFrom}_${data.meta.dateTo}-${data.meta.issuedAt.slice(0,10)}.${format === "xlsx" ? "xlsx" : "pdf"}`;
}
export const profitExportNotes = "القيم بالدينار الليبي. الربح والتكلفة المعروفان لا يمثلان نتيجة نهائية عند نقص التكلفة. تكلفة Actual وفق سعر المخزون المتاح، وليست إثباتًا لسعر تاريخي. لا توجد خصومات إضافية.";
