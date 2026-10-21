export const ACTUAL_UNITS = {
  tablet: "قرص", capsule: "كبسولة", strip: "شريط", box: "علبة", pen: "قلم",
  vial: "فيال", ampoule: "أمبول", bottle: "عبوة", drops: "عبوة قطرات",
  inhaler: "بخاخ", tube: "أنبوب", ml: "مل", gram: "غرام", sachet: "كيس",
} as const;
export type ActualUnit = keyof typeof ACTUAL_UNITS;
export type ActualUnitDecision = {
  phif_invoice_item_id: string; source_signature: string; stock_signature: string;
  dispensing_unit: ActualUnit; cost_unit: ActualUnit; is_active: boolean; version: number;
  updated_actor?: string; updated_at?: string;
};

export function actualUnit(value: unknown): ActualUnit | null {
  const key = String(value ?? "").trim().toLowerCase().replace(/[._\s-]+/g, "");
  const aliases: Record<ActualUnit, string[]> = {
    tablet: ["tab", "tabs", "tablet", "tablets", "قرص", "أقراص"],
    capsule: ["cap", "caps", "capsule", "capsules", "كبسولة"],
    strip: ["strip", "strips", "شريط"], box: ["box", "boxes", "علبة"],
    pen: ["pen", "pens", "قلم"], vial: ["vial", "vials", "فيال"],
    ampoule: ["amp", "ampoule", "ampoules", "ampul", "أمبول"],
    bottle: ["bottle", "bottles", "عبوة"], drops: ["drop", "drops", "eyedrops", "قطرات"],
    inhaler: ["inhaler", "spray", "بخاخ"], tube: ["tube", "tubes", "أنبوب"],
    ml: ["ml", "مل"], gram: ["g", "gm", "gram", "غرام"], sachet: ["sachet", "sachets", "كيس"],
  };
  return (Object.keys(aliases) as ActualUnit[]).find(unit => aliases[unit].includes(key)) ?? null;
}

export function actualSourceUnit(item: any) {
  // Dosage form and brand-name tokens do not document the unit of invoice quantity.
  const values = [item.metadata?.quantity_unit, item.metadata?.quantityUnit, item.metadata?.unit,
    item.phif_financial_fields?.quantity_unit, item.phif_financial_fields?.unit].filter(v => v != null && v !== "");
  const units = values.map(actualUnit);
  if (!units.length) return { unit: null, issue: "missing_dispensing_unit" };
  if (units.some(u => !u) || new Set(units).size !== 1) return { unit: null, issue: "conflicting_dispensing_unit" };
  return { unit: units[0], issue: null };
}

export function actualUnitSourceSnapshot(item: any) {
  return { brand: item.brand ?? null, strength: item.strength ?? null,
    source_classification: item.source_classification ?? null, metadata: item.metadata ?? {},
    quantity: item.quantity == null ? null : Number(item.quantity),
    financial_units: { quantity_unit: item.phif_financial_fields?.quantity_unit ?? null, unit: item.phif_financial_fields?.unit ?? null } };
}

export function actualUnitSourceSignature(item: any) {
  return JSON.stringify(actualUnitSourceSnapshot(item));
}

export function actualUnitGroupSignature(item: any) {
  const { quantity, ...identity } = actualUnitSourceSnapshot(item);
  return JSON.stringify(identity);
}

export function actualStockUnitSignature(stock: any) {
  return JSON.stringify({ product_reference: stock.brand_product_id || stock.source_stock_id || null,
    brand_name: stock.brand_name ?? null, strength: stock.strength ?? null, dosage_unit: stock.dosage_unit ?? null,
    package_quantity: stock.package_quantity == null ? null : Number(stock.package_quantity),
    strips_quantity: stock.strips_quantity == null ? null : Number(stock.strips_quantity) });
}

export function sameActualSignature(left: string, right: string) {
  const ordered = (value: any): any => Array.isArray(value) ? value.map(ordered)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
  try { return JSON.stringify(ordered(JSON.parse(left))) === JSON.stringify(ordered(JSON.parse(right))); }
  catch { return false; }
}

export function actualConversionFactor(from: ActualUnit, to: ActualUnit, stock: any): number | null {
  if (from === to) return 1;
  const count = (value: any) => value !== null && value !== "" && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const perBox = count(stock.package_quantity), strips = count(stock.strips_quantity);
  // PHIF package_quantity counts dosage units per box; strips_quantity counts strips per box.
  // Only solid-dose conversions are supported by those documented fields.
  if (!["tablet", "capsule"].includes(to) || actualUnit(stock.dosage_unit) !== to || !perBox) return null;
  if (from === "box") return perBox;
  if (from === "strip" && strips && perBox % strips === 0) return perBox / strips;
  return null;
}

export const ACTUAL_UNIT_REASONS: Record<string, string> = {
  missing_dispensing_unit: "وحدة الكمية المصروفة غير موثقة",
  conflicting_dispensing_unit: "تعارض في وحدات الكمية المسجلة",
  missing_cost_unit: "وحدة سعر المخزون تحتاج اعتمادًا",
  stale_unit_decision: "تغير الصنف أو بيانات العبوة؛ أعد مراجعة التوثيق",
  undocumented_conversion: "تحويل الوحدة غير موثق أو بيانات العبوة غير كافية",
  invalid_cost_or_quantity: "سعر التكلفة أو الكمية غير صالح للحساب",
};

export function actualCostUnitAllowed(stock: any, unit: ActualUnit) {
  const form = actualUnit(stock.dosage_unit);
  // A generic form such as INJ/CREAM cannot prove whether the price is per
  // vial/pen/tube/gram. Keep it for review until a discrete unit is documented.
  return Boolean(form && form === unit);
}

export function actualCostUnits(item: any, stock: any) {
  const decision = item.actual_unit_decision as ActualUnitDecision | undefined;
  const source = actualSourceUnit(item);
  const valid = decision?.is_active && sameActualSignature(decision.source_signature, actualUnitSourceSignature(item))
    && sameActualSignature(decision.stock_signature, actualStockUnitSignature(stock));
  let issue = decision?.is_active && !valid ? "stale_unit_decision" : source.issue;
  const dispensingUnit = valid ? actualUnit(decision.dispensing_unit) : source.unit;
  // The pharmacy has explicitly confirmed tablet cost_price is per tablet. Other
  // pricing units require an item-level manager decision, not a dosage-form guess.
  const costUnit = valid ? actualUnit(decision.cost_unit) : actualUnit(stock.dosage_unit) === "tablet" ? "tablet" : null;
  if (!dispensingUnit) issue ||= "missing_dispensing_unit";
  else if (!costUnit) issue ||= "missing_cost_unit";
  const factor = dispensingUnit && costUnit ? actualConversionFactor(dispensingUnit, costUnit, stock) : null;
  if (!issue && factor === null) issue = "undocumented_conversion";
  const manualIssue = source.issue === "conflicting_dispensing_unit" || (source.unit && source.unit !== dispensingUnit)
    ? "conflicting_dispensing_unit"
    : costUnit && actualCostUnitAllowed(stock, costUnit) ? factor === null ? "undocumented_conversion" : null : "missing_cost_unit";
  return { dispensingUnit, costUnit, factor, issue: valid ? manualIssue : issue,
    provenance: valid ? "manual" : source.unit ? "source" : null,
    actor: valid ? decision.updated_actor : null, at: valid ? decision.updated_at : null };
}

export function applyActualUnitDecisions(items: any[], decisions: ActualUnitDecision[]) {
  const byId = new Map(decisions.filter(d => d.is_active).map(d => [d.phif_invoice_item_id, d]));
  return items.map(item => {
    const { actual_unit_decision: old, ...original } = item;
    const decision = byId.get(item.id);
    return item.source_classification === "actual-supplier" && decision ? { ...original, actual_unit_decision: decision } : original;
  });
}
