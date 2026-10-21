import { actualUnit, actualSourceUnit, actualConversionFactor, type ActualUnit } from "./actual-units.helpers";
import { invoiceItemValue, type ActualMatchResult } from "./phif-stock.helpers";

export const UNIT_SUGGESTION_REASONS: Record<string, string> = {
  identity_review: "هوية الصنف تحتاج مراجعة",
  pricing_unit_unknown: "وحدة سعر المخزون غير مؤكدة",
  invalid_amount: "الكمية أو قيمة الصرف أو السعر غير صالح للتحقق",
  source_conflict: "وحدات المصدر متعارضة",
  price_conflict: "أسعار أو وحدات سجلات المخزون المطابقة متعارضة",
  amount_mismatch: "قيمة الصرف لا توافق سعر البيع الحالي؛ قد يوجد خصم أو اختلاف تاريخي",
  competing_units: "أكثر من تفسير للوحدة يعطي المبلغ نفسه",
  price_verified: "توافق حسابي وحيد مع وحدة مخزون محددة؛ يحتاج اعتماد المدير",
};

// Decimal integers: LYD has three fractional digits. Round the final product
// half-up once to the millime; do not use percentage/absolute tolerances.
function decimal(value: unknown) {
  const text = String(value ?? "");
  if (!/^\d+(?:\.\d{1,12})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return { n: BigInt(whole + fraction), d: 10n ** BigInt(fraction.length) };
}
export function actualMoneyProduct(quantity: unknown, price: unknown, factor = 1): number | null {
  const q = decimal(quantity), p = decimal(price);
  if (!q || !p || !Number.isSafeInteger(factor) || factor < 1) return null;
  const denominator = q.d * p.d, numerator = q.n * p.n * BigInt(factor) * 1000n;
  const rounded = (numerator * 2n + denominator) / (2n * denominator);
  return rounded <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rounded) / 1000 : null;
}

export function actualUnitSuggestion(item: any, match: ActualMatchResult) {
  const review = (reason: string, extra: any = {}) => ({ status: "review" as const, reason,
    dispensingUnit: null as ActualUnit | null, costUnit: null as ActualUnit | null,
    expectedValue: null as number | null, projectedCost: null as number | null,
    projectedProfit: null as number | null, priceSignature: "", ...extra });
  if (item.source_classification !== "actual-supplier" || match.status !== "matched") return review("identity_review");
  const stock = match.stock, equivalents = match.equivalentStocks ?? [stock];
  const costUnit = actualUnit(stock.dosage_unit);
  if (!costUnit) return review("pricing_unit_unknown");
  const priceSignature = JSON.stringify({ quantity: item.quantity, value: item.phif_financial_fields,
    prices: equivalents.map(s => [s.cost_price, s.sale_price, s.dosage_unit, s.package_quantity, s.strips_quantity]) });
  const base = { costUnit, priceSignature, salePrice: Number(stock.sale_price), costPrice: Number(stock.cost_price),
    invoiceValue: invoiceItemValue(item) };
  if (equivalents.some(s => actualUnit(s.dosage_unit) !== costUnit || s.cost_price == null || s.sale_price == null
    || Number(s.cost_price) !== Number(stock.cost_price) || Number(s.sale_price) !== Number(stock.sale_price))) return review("price_conflict", base);
  const value = decimal(invoiceItemValue(item)), quantity = decimal(item.quantity);
  if (!value || value.n <= 0n || (value.n * 1000n) % value.d !== 0n || !quantity || quantity.n <= 0n
    || !(Number(stock.cost_price) > 0) || !(Number(stock.sale_price) > 0)) return review("invalid_amount", base);
  const source = actualSourceUnit(item);
  if (source.issue === "conflicting_dispensing_unit") return review("source_conflict", base);
  const candidates = source.unit ? [source.unit] : [...new Set<ActualUnit>([costUnit, "strip", "box"])];
  const verified = candidates.flatMap(unit => {
    const factor = actualConversionFactor(unit, costUnit, stock);
    if (factor == null) return [];
    const expectedValue = actualMoneyProduct(item.quantity, stock.sale_price, factor);
    if (expectedValue !== Number(value.n * 1000n / value.d) / 1000) return [];
    return [{ dispensingUnit: unit, expectedValue, factor }];
  });
  if (verified.length !== 1) return review(verified.length ? "competing_units" : "amount_mismatch", base);
  const proposed = verified[0], projectedCost = actualMoneyProduct(item.quantity, stock.cost_price, proposed.factor);
  if (projectedCost == null) return review("invalid_amount", base);
  return { status: "high_confidence" as const, reason: "price_verified", ...base, ...proposed, projectedCost,
    projectedProfit: Math.round((invoiceItemValue(item) - projectedCost) * 1000) / 1000 };
}
