import type { PhifMedicationProfileItem } from "./phif-invoices.functions";
import type { PhifPreparationSummary } from "./phif-preparation.helpers";
import { ACTUAL_UNITS, actualSourceUnit, actualUnit, type ActualUnit } from "./actual-units.helpers";
import { normalizeActiveIngredient } from "./medication-normalize";
import { reportForm, reportSettingKey, reportStrength, resolveReportIdentities } from "./report-medication-evidence.helpers";
import { reportSupplierUnit } from "./report-supplier-units.helpers";
import { normalizeSupplierUnit } from "./phif-supplier-quick-cost.helpers";

export type PreparationItem = {
  id: string; name: string; strength: string; form: string; dueDate: string; identityComplete: boolean;
  latestDate: string | null; sourceItemIds: string[];
  quantity: number | null; quantityUnit: ActualUnit | null;
  packageSize: number | null; packageUnit: ActualUnit | null;
  lastDispensingBoxes: number | null; issue: string | null;
  lastDispensingPartial?: true | null;
};
export type PreparationPatient = {
  patient_id: string; patient_name: string; insurance_card_number: string | null;
  phif_preparation_items?: PreparationItem[];
};
export type PreparationMember = {
  key: string; name: string; card: string | null; items: PreparationItem[];
  boxes: number | null; knownBoxes: number; knownItemCount: number; unresolvedCount: number;
};
export type PreparationGroup = {
  key: string; name: string; strength: string; form: string;
  itemCount: number; beneficiaries: PreparationMember[];
  boxes: number | null; knownBoxes: number; knownItemCount: number; unresolvedCount: number; partialCount: number;
};

function recordedNumber(value: unknown) {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function packageCount(values: unknown[]) {
  const present = values.filter(v => v != null && v !== "");
  const numbers = present.map(recordedNumber);
  const valid = numbers.every(n => n !== null && Number.isSafeInteger(n) && n > 0);
  return { value: valid && numbers.length && new Set(numbers).size === 1 ? numbers[0]! : null,
    conflict: !valid || new Set(numbers).size > 1 };
}

/** Saved invoice quantities support estimates only, never confirmed future requirements. */
export function buildPreparationItems(
  medications: PhifMedicationProfileItem[], sources: any[], identityOf: (item: any) => string,
  pharmacyId: string, settings: any[] = [],
  invoices: { id: string; status?: string | null }[] = [],
): PreparationItem[] {
  const scoped = settings.filter(s => s.pharmacy_id === pharmacyId);
  const identities = resolveReportIdentities(sources, [], [], [], { pharmacyId, settings: scoped });
  const byIdentity = new Map<string, any[]>();
  for (const row of sources) {
    const key = identityOf(row), group = byIdentity.get(key) || [];
    group.push(row); byIdentity.set(key, group);
  }
  return medications.filter(m => m.follow_up_status !== "stopped" && m.next_due_date).map(m => {
    const invoiceIds = new Set(m.movements.filter(v => v.dispensing_date === m.latest_dispensing_date).map(v => v.invoice_id));
    const latest = (byIdentity.get(m.identity_key) || []).filter(row => invoiceIds.has(row.phif_invoice_id));
    const forms = new Set(latest.map(row => identities.get(row.id)?.form || reportForm(m.dosage_form)));
    const form = forms.size === 1 ? [...forms][0] : "";
    const name = m.active_ingredient || m.brand || "اسم الصنف غير مسجل";
    const base: PreparationItem = { id: m.identity_key, name, strength: m.strength || "", form,
      identityComplete: Boolean((m.active_ingredient || m.brand)?.trim() && m.strength?.trim() && form),
      dueDate: m.next_due_date!, latestDate: m.latest_dispensing_date,
      sourceItemIds: [...new Set<string>(latest.map(row => row.id).filter(Boolean))],
      quantity: null, quantityUnit: null, packageSize: null, packageUnit: null,
      lastDispensingBoxes: null, lastDispensingPartial: null, issue: null };
    if (!latest.length || invoiceIds.size !== 1) return { ...base, issue: "كمية آخر صرف غير محسومة؛ توجد حركات متعددة أو تفاصيل ناقصة" };
    // The invoice status is preserved by Bridge; do not infer partial dispensing from a fraction of a box.
    const status = invoices.find(invoice => invoiceIds.has(invoice.id))?.status?.trim().toLowerCase().replace(/\s+/g, " ");
    base.lastDispensingPartial = status && ["partial", "partially dispensed", "صرف جزئي", "تم الصرف جزئيا", "تم الصرف جزئيًا"].includes(status) ? true : null;
    const conversions = latest.map(row => {
      const key = identities.get(row.id)?.key;
      const candidates = row.source_classification === "phif-supplier"
        ? scoped.filter(s => key && reportSettingKey(s.item_identity) === key) : [];
      const conflict = new Set(candidates.map(s => JSON.stringify([s.units_per_box, s.base_unit,
        s.supplier_quantity_unit ?? null, s.supplier_unit_exceptions?.[row.phif_invoice_id] ?? null]))).size > 1;
      const setting = conflict ? null : candidates[0];
      const quantity = recordedNumber(row.quantity);
      const recorded = [row.metadata?.quantity_unit, row.metadata?.quantityUnit, row.metadata?.unit,
        row.phif_financial_fields?.quantity_unit, row.phif_financial_fields?.quantityUnit, row.phif_financial_fields?.unit]
        .filter(v => v != null && String(v).trim() !== "")
        .map(v => actualUnit(v) || actualUnit(normalizeSupplierUnit(v)));
      let evidence = recorded.length && (recorded.some(v => !v) || new Set(recorded).size > 1)
        ? { unit: null, issue: "conflict" }
        : row.source_classification === "phif-supplier" ? reportSupplierUnit(row, setting) : actualSourceUnit(row);
      // Accept a documented alias understood by the shared unit dictionary, never a form guess.
      if (evidence.issue === "unknown" && recorded.length && recorded[0]
        && !setting?.supplier_unit_exceptions?.[row.phif_invoice_id]) evidence = { unit: recorded[0], issue: null };
      const unit = evidence.unit;
      const meta = row.metadata || {};
      const pack = packageCount([meta.package_quantity, meta.packageQuantity, setting?.units_per_box]);
      const strips = packageCount([meta.strips_quantity, meta.stripsQuantity]);
      const packageUnit = actualUnit(setting?.base_unit) || actualUnit(form);
      let issue = conflict ? "تعريفات العبوة المحفوظة متعارضة" : quantity === null ? "الكمية غير مسجلة أو غير صالحة"
        : evidence.issue ? "وحدة الكمية غير موثقة أو متعارضة" : pack.conflict ? "بيانات العبوة متعارضة أو غير صالحة"
        : !pack.value || !packageUnit ? "حجم العبوة أو وحدة محتواها يحتاج تحديدًا"
        : actualUnit(form) && packageUnit !== actualUnit(form) ? "وحدة محتوى العبوة تختلف عن الشكل الموثق" : null;
      let boxes: number | null = null;
      if (!issue && quantity !== null && pack.value) {
        if (unit === "box") boxes = quantity;
        else if (unit === packageUnit) boxes = quantity / pack.value;
        else if (unit === "strip" && (packageUnit === "tablet" || packageUnit === "capsule")
          && !strips.conflict && strips.value && pack.value % strips.value === 0) boxes = quantity / strips.value;
        else issue = "تحويل وحدة الكمية إلى العلب غير موثق";
      }
      return { quantity, unit, size: pack.value, packageUnit, boxes, issue };
    });
    const units = new Set(conversions.map(c => c.unit)), sizes = new Set(conversions.map(c => c.size));
    const issue = conversions.find(c => c.issue)?.issue || (units.size > 1 || sizes.size > 1 ? "وحدات أو عبوات بنود آخر فاتورة متعارضة" : null);
    return { ...base, quantity: conversions.every(c => c.quantity !== null) && units.size === 1
      ? conversions.reduce((sum, c) => sum + c.quantity!, 0) : null,
      quantityUnit: units.size === 1 ? conversions[0].unit : null,
      packageSize: sizes.size === 1 ? conversions[0].size : null, packageUnit: conversions[0].packageUnit,
      lastDispensingBoxes: issue ? null : conversions.reduce((sum, c) => sum + c.boxes!, 0), issue };
  });
}

export function preparationEstimatedBoxes(item: PreparationItem) {
  const quantity = recordedNumber(item.quantity), pack = packageCount([item.packageSize]);
  const unit = actualUnit(item.quantityUnit), base = actualUnit(item.packageUnit);
  if (item.issue) return { boxes: null, issue: item.issue };
  if (quantity === null || !unit || !base || !pack.value || pack.conflict)
    return { boxes: null, issue: "كمية آخر صرف أو وحدتها أو حجم العبوة يحتاج تحديدًا" };
  const boxes = item.lastDispensingBoxes;
  if (typeof boxes !== "number" || !Number.isFinite(boxes) || boxes < 0)
    return { boxes: null, issue: "تحويل آخر كمية صرف إلى العلب غير موثق" };
  return { boxes, issue: null };
}

export function preparationTotalLabel(summary: { boxes: number | null; knownBoxes: number; knownItemCount: number }) {
  if (summary.boxes !== null) return `${preparationNumber(summary.boxes)} علبة تقديرية`;
  return summary.knownItemCount > 0 ? `${preparationNumber(summary.knownBoxes)} علبة تقديرية؛ الإجمالي غير مكتمل` : "يحتاج تحديد";
}

export function groupPreparationItems(rows: PreparationPatient[], preparation: Map<string, PhifPreparationSummary>) {
  const groups = new Map<string, PreparationGroup>();
  const seenPatients = new Set<string>(), seenItems = new Set<string>();
  let originalCount = 0, includedCount = 0;
  for (const row of rows) {
    if (seenPatients.has(row.patient_id)) continue;
    seenPatients.add(row.patient_id);
    const due = preparation.get(row.patient_id);
    if (!due) continue;
    originalCount += due.itemCount;
    const dates = new Set(due.dueDates.map(d => d.date));
    for (const item of row.phif_preparation_items || []) {
      if (!dates.has(item.dueDate) || seenItems.has(`${row.patient_id}:${item.id}`)) continue;
      seenItems.add(`${row.patient_id}:${item.id}`); includedCount++;
      const name = normalizeActiveIngredient(item.name), strength = reportStrength(item.strength), form = reportForm(item.form);
      const key = JSON.stringify([name, strength, form, ...(!item.identityComplete || !name || !strength || !form ? [row.patient_id, item.id] : [])]);
      const group = groups.get(key) || { key, name: item.name, strength: item.strength, form,
        itemCount: 0, beneficiaries: [], boxes: 0, knownBoxes: 0, knownItemCount: 0, unresolvedCount: 0, partialCount: 0 };
      const card = row.insurance_card_number?.trim() || null, personKey = card ? `card:${card}` : `patient:${row.patient_id}`;
      let person = group.beneficiaries.find(p => p.key === personKey);
      if (!person) { person = { key: personKey, name: row.patient_name, card, items: [], boxes: 0, knownBoxes: 0, knownItemCount: 0, unresolvedCount: 0 }; group.beneficiaries.push(person); }
      group.itemCount++;
      if (item.sourceItemIds.length && person.items.some(previous => previous.dueDate === item.dueDate
        && JSON.stringify([...previous.sourceItemIds].sort()) === JSON.stringify([...item.sourceItemIds].sort()))) {
        groups.set(key, group); continue;
      }
      person.items.push(item);
      if (item.lastDispensingPartial) group.partialCount++;
      // Use only the server-verified invoice conversion, not legacy required-quantity totals.
      const { boxes } = preparationEstimatedBoxes(item);
      if (boxes === null) { group.boxes = null; person.boxes = null; group.unresolvedCount++; person.unresolvedCount++; }
      else { group.knownBoxes += boxes; person.knownBoxes += boxes; group.knownItemCount++; person.knownItemCount++;
        if (group.boxes !== null) group.boxes += boxes;
        if (person.boxes !== null) person.boxes += boxes; }
      groups.set(key, group);
    }
  }
  const result = [...groups.values()].sort((a, b) => b.beneficiaries.length - a.beneficiaries.length
    || b.itemCount - a.itemCount || a.name.localeCompare(b.name, "ar") || a.key.localeCompare(b.key));
  for (const group of result) group.beneficiaries.sort((a, b) => a.name.localeCompare(b.name, "ar") || a.key.localeCompare(b.key));
  return { groups: result, originalCount, missingCount: Math.max(0, originalCount - includedCount) };
}

export function preparationNumber(value: number) {
  if (value > 0 && value < 0.000001) return "< 0.000001";
  const rounded = Number(value.toFixed(6));
  return `${Math.abs(value - rounded) > 1e-9 ? "≈ " : ""}${new Intl.NumberFormat("ar-LY", { maximumFractionDigits: 6 }).format(rounded)}`;
}
export const preparationUnitLabel = (unit: ActualUnit | null) => unit ? ACTUAL_UNITS[unit] : "وحدة غير موثقة";
