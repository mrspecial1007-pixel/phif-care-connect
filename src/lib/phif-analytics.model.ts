import type { AnalyticsRow } from "./items-analytics.helpers";
import { monthWindow } from "./items-analytics.helpers";
import { summarizeReportBoxes, REPORT_BOX_REASONS } from "./report-box-quantity.helpers";
import { reportSettingKey } from "./report-medication-evidence.helpers";

export type AnalyticsMovement = Pick<AnalyticsRow, "id" | "identity" | "ingredient" | "strength" | "form" | "brand" | "invoiceId" | "date" | "card" | "source" | "boxes" | "unit" | "boxSize" | "baseUnit" | "boxIssue" | "beneficiariesAvailable">;
export type AnalyticsSource = "all" | "actual" | "phif";
export const analyticsQueryKey = (scope: string | null, month: string) =>
  ["items_analytics", scope, "phif_analytics", month] as const;

export function filterAnalyticsMovements(rows: AnalyticsMovement[], source: AnalyticsSource, identity: string) {
  return rows.filter(r => (source === "all" || r.source === source) && (identity === "all" || r.identity === identity));
}

export const analyticsBoxes = summarizeReportBoxes;
export type BoxMetric = ReturnType<typeof analyticsBoxes>;
export function analyticsBoxLabel(metric: BoxMetric) {
  return metric.state === "incompatible" ? "عبوات غير متوافقة" : metric.state === "unknown" ? "غير محدد" : "مكتمل";
}

export function analyticsCard(value: unknown) {
  if (typeof value !== "string") return null;
  const card = value.normalize("NFKC").replace(/[\s\u200e\u200f]/g, "")
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776));
  return /^\d+$/.test(card) ? card : null;
}
function beneficiaries(rows: AnalyticsMovement[]) {
  if (rows.some(r => r.beneficiariesAvailable !== true)) return { count: null, missing: null, invalid: null };
  const cards = rows.map(r => analyticsCard(r.card));
  return { count: new Set(cards.filter((c): c is string => c !== null)).size,
    missing: rows.filter(r => !r.card?.trim()).length,
    invalid: rows.filter(r => r.card?.trim() && !analyticsCard(r.card)).length };
}
const brandKey = (name: string | null) => (name || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
function metrics(rows: AnalyticsMovement[]) {
  return { total: analyticsBoxes(rows), sup: analyticsBoxes(rows.filter(r => r.source === "phif")),
    act: analyticsBoxes(rows.filter(r => r.source === "actual")), beneficiaries: beneficiaries(rows) };
}
export function aggregatePhifAnalytics(input: AnalyticsMovement[]) {
  const rows = [...new Map(input.map(r => [r.id, r])).values()];
  const groups = new Map<string, AnalyticsMovement[]>();
  for (const row of rows) groups.set(row.identity, [...(groups.get(row.identity) || []), row]);
  const generics = [...groups.entries()].map(([id, items]) => {
    const first = items[0], brands = new Map<string, AnalyticsMovement[]>();
    for (const row of items) {
      const key = JSON.stringify([brandKey(row.brand), row.source]);
      brands.set(key, [...(brands.get(key) || []), row]);
    }
    return { id, name: first.ingredient, strength: first.strength, form: first.form,
      identityComplete: reportSettingKey(id) !== null, rows: items.length, ...metrics(items),
      brandCount: new Set(items.map(r => brandKey(r.brand)).filter(Boolean)).size,
      brandList: [...brands.values()].map(list => ({ brand: list[0].brand?.trim() || "بدون اسم تجاري",
        source: list[0].source, boxes: analyticsBoxes(list), beneficiaries: beneficiaries(list), rows: list.length })) };
  });
  const result = metrics(rows);
  const rankingComplete = result.total.state === "complete" && generics.every(g => g.identityComplete);
  generics.sort((a, b) => (rankingComplete ? b.total.value! - a.total.value! : 0)
    || `${a.name} ${a.strength} ${a.form}`.localeCompare(`${b.name} ${b.strength} ${b.form}`) || a.id.localeCompare(b.id));
  return { ...result, generics, rows: rows.length, invoices: new Set(rows.map(r => r.invoiceId)).size,
    confirmedGenerics: generics.filter(g => g.identityComplete).length,
    reviewGenerics: generics.filter(g => !g.identityComplete).length, rankingComplete };
}
export function dailyPhifAnalytics(rows: AnalyticsMovement[], month: string, loaded = true) {
  const range = monthWindow(month), days = Number(range.to.slice(8, 10));
  const incompatible = analyticsBoxes(rows).state === "incompatible";
  return Array.from({ length: days }, (_, i) => {
    const day = String(i + 1).padStart(2, "0"), date = `${month}-${day}`;
    if (!loaded) return { day, sup: null, act: null, complete: false, status: "unavailable" };
    const data = aggregatePhifAnalytics(rows.filter(r => r.date.slice(0, 10) === date));
    return { day, sup: incompatible ? null : data.sup.value,
      act: incompatible ? null : data.act.value, complete: !incompatible && data.total.state === "complete",
      status: incompatible || data.total.state !== "complete" ? "incomplete" : data.rows ? "recorded" : "no_dispensing" };
  });
}
export function analyticsGrowth(current: BoxMetric, previous: BoxMetric | undefined) {
  return current.state === "complete" && previous?.state === "complete" && previous.value! > 0
    ? (current.value! - previous.value!) / previous.value! * 100 : null;
}
export function phifAnalyticsExportRows(report: { canExport: boolean; movements: AnalyticsMovement[] }, source: AnalyticsSource, identity: string) {
  if (!report.canExport) throw new Error("لا تملك صلاحية تصدير التقارير");
  const aggregate = aggregatePhifAnalytics(filterAnalyticsMovements(report.movements, source, identity));
  return { summary: { "بنود الصرف": aggregate.rows, "الفواتير": aggregate.invoices,
    "الهويات العلمية المؤكدة": aggregate.confirmedGenerics, "هويات تحتاج مراجعة": aggregate.reviewGenerics,
    "المستفيدون الفريدون": aggregate.beneficiaries.count, "بنود دون بطاقة": aggregate.beneficiaries.missing,
    "بنود ببطاقة غير صالحة": aggregate.beneficiaries.invalid,
    "إجمالي العلب": aggregate.total.value, "حالة العبوات": analyticsBoxLabel(aggregate.total),
    "حالة المستفيدين": aggregate.beneficiaries.count == null ? "غير متاح" : "حسب البطاقات الصالحة فقط" },
    rows: aggregate.generics.flatMap(g => g.brandList.map(b => ({ "المادة العلمية": g.name, "التركيز": g.strength,
      "الشكل": g.form, "حالة الهوية": g.identityComplete ? "مؤكدة" : "تحتاج مراجعة",
      "الاسم التجاري": b.brand, "المصدر": b.source === "phif" ? "PHIF Supplier" : "PHIF Actual",
      "بنود الصرف": b.rows, "العلب": b.boxes.value, "حالة العبوات": analyticsBoxLabel(b.boxes),
      "ملاحظات العبوات": b.boxes.issues.map(i => REPORT_BOX_REASONS[i] || i).join("؛ "),
      "حالة إجمالي الصنف": analyticsBoxLabel(g.total), "المستفيدون": b.beneficiaries.count,
      "حالة المستفيدين": b.beneficiaries.count == null ? "غير متاح" : "حسب البطاقات الصالحة فقط",
      "بنود دون بطاقة": b.beneficiaries.missing, "بنود ببطاقة غير صالحة": b.beneficiaries.invalid }))) };
}
