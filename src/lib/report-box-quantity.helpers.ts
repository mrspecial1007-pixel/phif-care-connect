import { actualUnit, type ActualUnit } from "./actual-units.helpers";

export const REPORT_BOX_REASONS: Record<string, string> = {
  missing_dispensing_unit: "وحدة الكمية الأصلية غير موثقة",
  conflicting_dispensing_unit: "وحدات الكمية الأصلية متعارضة",
  missing_box_size: "حجم عبوة Actual غير موثق",
  missing_supplier_box_size: "حجم علبة PHIF Supplier غير محدد أو متعارض",
  conflicting_package: "بيانات العبوة متعارضة",
  invalid_package: "بيانات العبوة غير صالحة",
  package_unit_mismatch: "وحدة محتوى العبوة غير مؤكدة أو مختلفة",
  incompatible_box_sizes: "أحجام العلب أو وحداتها غير متوافقة للجمع",
  undocumented_conversion: "تحويل وحدة الكمية إلى علب غير موثق",
  invalid_quantity: "الكمية الأصلية غير صالحة",
};

function count(values: unknown[]) {
  const present = values.filter(v => v != null && v !== "");
  const numbers = present.map(Number);
  const valid = present.every(v => typeof v === "number" || typeof v === "string")
    && numbers.every(n => Number.isSafeInteger(n) && n > 0);
  return {
    value: numbers.length && valid
      && new Set(numbers).size === 1 ? numbers[0] : null,
    issue: !valid ? "invalid_package"
      : new Set(numbers).size > 1 ? "conflicting_package" : null,
  };
}

/** Reuses the engine's stock link, never a new name match or a Supplier box setting. */
export function actualReportPackages(stocks: any[], pharmacyId?: string) {
  const byId = new Map<string, any[]>();
  for (const stock of stocks) {
    if (stock.is_current === false || (pharmacyId && stock.pharmacy_id && stock.pharmacy_id !== pharmacyId)
      || stock.source_stock_id == null) continue;
    const id = String(stock.source_stock_id);
    const group = byId.get(id) || [];
    group.push(stock);
    byId.set(id, group);
  }
  return (item: any, financial: any, baseUnit: ActualUnit | null) => {
    const linked = financial.matched_stock_id == null ? [] : byId.get(String(financial.matched_stock_id)) || [];
    const packages = count([
      item.metadata?.package_quantity, item.metadata?.packageQuantity,
      ...linked.map(s => s.package_quantity),
    ]);
    const strips = count([
      item.metadata?.strips_quantity, item.metadata?.stripsQuantity,
      ...linked.map(s => s.strips_quantity),
    ]);
    const incompatibleUnit = linked.some(s => s.package_quantity != null && s.package_quantity !== ""
      && (!baseUnit || actualUnit(s.dosage_unit) !== baseUnit));
    return {
      size: packages.issue || incompatibleUnit ? null : packages.value,
      strips: strips.issue ? null : strips.value,
      issue: packages.issue || (incompatibleUnit ? "package_unit_mismatch" : null),
      stripsIssue: strips.issue,
    };
  };
}

type BoxRow = {
  identity: string; source: string; boxes: number | null; unit: ActualUnit | null;
  boxSize?: number | null; baseUnit?: ActualUnit | null; boxIssue?: string | null;
};

export function reportBoxIssues(rows: BoxRow[]): string[] {
  const issues = new Set<string>();
  const identities = new Map<string, BoxRow[]>();
  for (const row of rows) {
    if (row.boxes == null) issues.add(row.boxIssue || "undocumented_conversion");
    const group = identities.get(row.identity) || [];
    group.push(row);
    identities.set(row.identity, group);
  }
  for (const group of identities.values()) {
    if (group.length < 2 || group.some(r => r.boxes == null)) continue;
    const known = group.every(r => r.boxSize && r.baseUnit);
    const same = new Set(group.map(r => `${r.boxSize}:${r.baseUnit}`)).size === 1;
    // Native, explicitly recorded boxes remain countable on their own source.
    const native = group.every(r => r.unit === "box" && r.boxSize == null)
      && new Set(group.map(r => r.source)).size === 1;
    if (!(known && same) && !native) issues.add("incompatible_box_sizes");
  }
  return [...issues];
}
