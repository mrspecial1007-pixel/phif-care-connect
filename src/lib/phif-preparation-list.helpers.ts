import type { PhifMedicationProfileItem } from "./phif-invoices.functions";
import type { PhifPreparationSummary } from "./phif-preparation.helpers";
import { ACTUAL_UNITS, actualSourceUnit, actualUnit, type ActualUnit } from "./actual-units.helpers";
import { normalizeActiveIngredient } from "./medication-normalize";
import { REPORT_IDENTITY_REASONS, reportForm, reportSettingKey, reportStrength, resolveReportIdentities } from "./report-medication-evidence.helpers";
import { reportSupplierUnit } from "./report-supplier-units.helpers";
import { normalizeSupplierUnit } from "./phif-supplier-quick-cost.helpers";

export type PreparationItem = {
  id: string; name: string; strength: string; form: string; dueDate: string; identityComplete: boolean;
  latestDate: string | null; sourceItemIds: string[];
  quantity: number | null; quantityUnit: ActualUnit | null;
  packageSize: number | null; packageUnit: ActualUnit | null;
  lastDispensingBoxes: number | null; issue: string | null;
  lastDispensingPartial?: true | null;
  scientificName?: string | null; sourceProductIds?: string[]; formIssue?: string | null;
};
export type PreparationPatient = {
  patient_id: string; patient_name: string; insurance_card_number: string | null;
  phif_preparation_items?: PreparationItem[];
};
export type PreparationMember = {
  key: string; patientId: string; name: string; card: string | null; items: PreparationItem[];
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

const scientificKey = (name: string, strength: string) => JSON.stringify([preparationScientificName(name), reportStrength(strength)]);
const identityIssue = (reason: string | null | undefined) => Object.entries(REPORT_IDENTITY_REASONS).find(([, text]) => text === reason)?.[0] || null;
const formConflict = (issue: string | null | undefined) => Boolean(issue && issue !== "missing_form");

/** Request-local, pharmacy-scoped identity evidence only; never supplies quantities or prices. */
export function preparationIdentityContext(sources: any[], pharmacyId: string, settings: any[] = []) {
  const scoped = settings.filter(s => s.pharmacy_id === pharmacyId);
  const rows = sources.filter(row => !row.pharmacy_id || row.pharmacy_id === pharmacyId);
  const identities = resolveReportIdentities(rows, [], [], [], { pharmacyId, settings: scoped });
  const forms = new Map<string, Set<string>>(), blocked = new Set<string>();
  const add = (key: string, form: string) => {
    const known = forms.get(key) || new Set<string>();
    known.add(form); forms.set(key, known);
  };
  for (const row of rows) {
    if (!row.active_ingredient?.trim() || !row.strength?.trim()) continue;
    const identity = identities.get(row.id);
    if (identity?.form) add(scientificKey(row.active_ingredient, row.strength), identity.form);
  }
  for (const setting of scoped) {
    const normalized = reportSettingKey(setting.item_identity);
    if (!normalized) continue;
    const [name, strength, form] = JSON.parse(normalized), key = scientificKey(name, strength);
    if (actualUnit(form) && actualUnit(setting.base_unit) !== actualUnit(form)) blocked.add(key);
    else add(key, form);
  }
  return { pharmacyId, identities, forms, blocked };
}

/** Saved invoice quantities support estimates only, never confirmed future requirements. */
export function buildPreparationItems(
  medications: PhifMedicationProfileItem[], sources: any[], identityOf: (item: any) => string,
  pharmacyId: string, settings: any[] = [],
  invoices: { id: string; status?: string | null }[] = [],
  context = preparationIdentityContext(sources, pharmacyId, settings),
): PreparationItem[] {
  const scoped = settings.filter(s => s.pharmacy_id === pharmacyId);
  if (context.pharmacyId !== pharmacyId) context = preparationIdentityContext(sources, pharmacyId, settings);
  const { identities } = context;
  const byIdentity = new Map<string, any[]>();
  for (const row of sources) {
    const key = identityOf(row), group = byIdentity.get(key) || [];
    group.push(row); byIdentity.set(key, group);
  }
  return medications.filter(m => m.follow_up_status !== "stopped" && m.next_due_date).map(m => {
    const invoiceIds = new Set(m.movements.filter(v => v.dispensing_date === m.latest_dispensing_date).map(v => v.invoice_id));
    const latest = (byIdentity.get(m.identity_key) || []).filter(row => invoiceIds.has(row.phif_invoice_id));
    const forms = new Set(latest.map(row => identities.get(row.id)?.form || reportForm(m.dosage_form)).filter(Boolean));
    const issues = latest.map(row => identityIssue(identities.get(row.id)?.reviewReason)).filter(Boolean);
    const key = scientificKey(m.active_ingredient || "", m.strength || "");
    const known = context.forms.get(key);
    const conflict = forms.size > 1 || issues.some(formConflict);
    const form = !conflict && forms.size === 1 ? [...forms][0]
      : !conflict && m.active_ingredient?.trim() && m.strength?.trim() && !context.blocked.has(key) && known?.size === 1 ? [...known][0] : "";
    const name = m.active_ingredient || m.brand || "اسم الصنف غير مسجل";
    const base: PreparationItem = { id: m.identity_key, name, strength: m.strength || "", form,
      identityComplete: Boolean((m.active_ingredient || m.brand)?.trim() && m.strength?.trim() && form),
      dueDate: m.next_due_date!, latestDate: m.latest_dispensing_date,
      sourceItemIds: [...new Set<string>(latest.map(row => row.id).filter(Boolean))],
      scientificName: m.active_ingredient || null,
      sourceProductIds: [...new Set<string>(latest.map(row => row.phif_item_id).filter(Boolean).map(String))],
      formIssue: conflict ? issues.find(formConflict) || "conflicting_form_evidence"
        : !form && context.blocked.has(key) ? "invalid_saved_definition" : !form && known && known.size > 1 ? "conflicting_form_evidence" : form ? null : "missing_form",
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

// Ignore Latin word spacing only for an explicitly scientific name; keep chemical separators.
export function preparationScientificName(name: string) {
  return normalizeActiveIngredient(name.normalize("NFKC")).replace(/([a-z])\s+(?=[a-z])/g, "$1");
}

function preparationIdentities(rows: PreparationPatient[], evidence: PreparationPatient[]) {
  const items = [...new Set([...evidence, ...rows].flatMap(row => row.phif_preparation_items || []))];
  // Older cached DTOs can still prove a scientific name through their existing profile key.
  const scientific = (item: PreparationItem) => item.scientificName ||
    (item.scientificName === undefined && item.id.startsWith("medication|") ? item.name : "");
  const name = (item: PreparationItem) => scientific(item)
    ? preparationScientificName(scientific(item)) : normalizeActiveIngredient(item.name);
  const base = (item: PreparationItem) => JSON.stringify([name(item), reportStrength(item.strength)]);
  const quantityForms = new Set(["tablet", "capsule", "pen", "vial", "ampoule", "inhaler", "suppository", "patch", "sachet"]);
  const direct = (item: PreparationItem) => reportForm(item.form) ||
    ((!item.formIssue || item.formIssue === "missing_form") && quantityForms.has(item.quantityUnit || "") ? reportForm(item.quantityUnit) : "");
  const products = new Map<string, Set<string>>();
  const scientificForms = new Map<string, Set<string>>();
  for (const item of items) {
    const form = direct(item);
    if (!form || !scientific(item) || !reportStrength(item.strength)) continue;
    const known = scientificForms.get(base(item)) || new Set<string>();
    known.add(form); scientificForms.set(base(item), known);
    for (const id of item.sourceProductIds || []) {
      const key = JSON.stringify([base(item), id]), forms = products.get(key) || new Set<string>();
      forms.add(form); products.set(key, forms);
    }
  }
  return new Map(items.map(item => {
    let form = direct(item);
    if (!reportForm(item.form) && form && item.sourceProductIds?.some(id => {
      const evidence = products.get(JSON.stringify([base(item), id]));
      return evidence && [...evidence].some(known => known !== form);
    })) form = "";
    if (!form && scientific(item) && (!item.formIssue || item.formIssue === "missing_form") && item.sourceProductIds?.length) {
      const evidence = item.sourceProductIds.map(id => products.get(JSON.stringify([base(item), id])));
      const forms = new Set(evidence.flatMap(set => set ? [...set] : []));
      if (evidence.every(set => set?.size === 1) && forms.size === 1) form = [...forms][0];
    }
    // A single evidenced scientific form is sufficient without a product ID or quantity.
    if (!form && scientific(item) && (!item.formIssue || item.formIssue === "missing_form")) {
      const known = scientificForms.get(base(item));
      if (known?.size === 1) form = [...known][0];
    }
    const complete = Boolean(name(item) && reportStrength(item.strength) && form && !formConflict(item.formIssue)
      && (scientific(item) || item.identityComplete));
    return [item, { name: name(item), strength: reportStrength(item.strength), form, complete }] as const;
  }));
}

export function groupPreparationItems(rows: PreparationPatient[], preparation: Map<string, PhifPreparationSummary>, identityEvidence: PreparationPatient[] = rows) {
  const groups = new Map<string, PreparationGroup>();
  const identities = preparationIdentities(rows, identityEvidence);
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
      const { name, strength, form, complete } = identities.get(item)!;
      const key = JSON.stringify([name, strength, form, ...(!complete ? [row.patient_id, item.id] : [])]);
      const group = groups.get(key) || { key, name: item.name, strength: item.strength, form,
        itemCount: 0, beneficiaries: [], boxes: 0, knownBoxes: 0, knownItemCount: 0, unresolvedCount: 0, partialCount: 0 };
      const card = row.insurance_card_number?.trim() || null, personKey = card ? `card:${card}` : `patient:${row.patient_id}`;
      let person = group.beneficiaries.find(p => p.key === personKey);
      if (!person) { person = { key: personKey, patientId: row.patient_id, name: row.patient_name, card, items: [], boxes: 0, knownBoxes: 0, knownItemCount: 0, unresolvedCount: 0 }; group.beneficiaries.push(person); }
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
