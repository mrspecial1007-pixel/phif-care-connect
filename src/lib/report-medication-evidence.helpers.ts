import { actualUnit } from "./actual-units.helpers";
import { normalizeActiveIngredient, normalizeDosageForm } from "./medication-normalize";
import {
  normalizeSupplierUnit,
  supplierInvoiceForm,
  supplierInvoiceUnit,
} from "./phif-supplier-quick-cost.helpers";

const text = (v: unknown) =>
  String(v ?? "")
    .normalize("NFKC")
    .trim();
export function reportStrength(value: unknown) {
  const raw = text(value).toLowerCase().replace(/\s+/g, "").replace(/[µμ]g/g, "mcg");
  const chain = /^(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*)\s*(mg|mcg|g)$/.exec(raw);
  const dose = (n: string, u: string) =>
    `${Number((Number(n) * (u === "g" ? 1000 : u === "mcg" ? 0.001 : 1)).toPrecision(12))}mg`;
  return chain
    ? chain[1]
        .split("/")
        .map((n) => dose(n, chain[2]))
        .join("/")
    : raw.replace(/(\d+(?:\.\d+)?)(mcg|mg|g)(?=\/|$)/g, (_, n, u) => dose(n, u));
}
export function reportForm(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  if (["box", "strip"].includes(actualUnit(raw) || "")) return "";
  return /^(inj|injections?)$/i.test(raw)
    ? "injection"
    : actualUnit(raw) || normalizeDosageForm(raw);
}
export function scientificReportIdentity(item: any, formHint?: unknown) {
  const ingredient = normalizeActiveIngredient(text(item.active_ingredient));
  const strength = reportStrength(item.strength);
  const proof = supplierQuantityEvidence(item);
  const quantityForm = ["TAB", "CAP", "PEN", "VIAL", "AMP", "EYE_DROPS"].includes(proof.unit || "")
    ? proof.unit
    : "";
  const form =
    reportForm(formHint) || reportForm(supplierInvoiceForm(item)) || reportForm(quantityForm);
  return {
    key: JSON.stringify([
      ingredient,
      strength,
      form,
      ...(!ingredient || !strength || !form ? ["unresolved", item.id] : []),
    ]),
    ingredient: text(item.active_ingredient) || "اسم علمي غير مسجل",
    strength: text(item.strength),
    form,
  };
}

/** Saved dispensing confirmations are evidence; purchase units and box settings are not. */
export function supplierQuantityEvidence(item: any): ReturnType<typeof supplierInvoiceUnit> {
  const { dosage_unit: ignoredMetaForm, ...metadata } = item.metadata || {};
  const { dosage_unit: ignoredFinancialForm, ...fields } = item.phif_financial_fields || {};
  const recorded = supplierInvoiceUnit({ ...item, metadata, phif_financial_fields: fields });
  const imported = item.phif_financial_fields?.internal_purchase_import;
  const basis = item.phif_financial_fields?.internal_purchase_price_basis;
  const confirmed =
    basis?.quantity_unit_confirmed === true ? normalizeSupplierUnit(basis.unit) : null;
  if (recorded.issue === "conflict" || (recorded.unit && confirmed && recorded.unit !== confirmed))
    return { unit: null, issue: "conflict" };
  if (
    imported?.authorization === "explicit_pharmacy_owner_approval_historical_only" &&
    imported.unit_confirmation === "pharmacy_owner_individual_oral_units_confirmation" &&
    recorded.unit &&
    !["TAB", "CAP"].includes(recorded.unit)
  )
    return { unit: null, issue: "conflict" };
  if (recorded.unit) return recorded;
  if (recorded.issue !== "missing") return recorded;
  if (confirmed) return { unit: confirmed, issue: null };
  // This provenance was saved by the explicitly approved historical import.
  // Its oral confirmation establishes individual doses, but not tablet vs capsule.
  if (
    item.source_classification === "phif-supplier" &&
    imported?.authorization === "explicit_pharmacy_owner_approval_historical_only" &&
    imported.unit_confirmation === "pharmacy_owner_individual_oral_units_confirmation"
  ) {
    const form = normalizeSupplierUnit(item.report_form || supplierInvoiceForm(item));
    if (form === "TAB" || form === "CAP") return { unit: form, issue: null };
  }
  if (
    item.source_classification === "phif-supplier" &&
    imported?.authorization === "explicit_pharmacy_owner_approval_historical_only" &&
    imported.unit_confirmation ===
      "current_user_confirmation_price_per_single_dispensed_unit_regardless_of_form" &&
    Number(imported.original_reference_quantity) === 1
  ) {
    const unit = normalizeSupplierUnit(item.report_form || supplierInvoiceForm(item));
    if (unit && !["BOX", "STRIP", "INJ"].includes(unit)) return { unit, issue: null };
  }
  return recorded;
}

export type ReportDefinitionScope = {
  pharmacyId: string;
  settings: readonly {
    pharmacy_id?: string;
    item_identity: string;
    base_unit: unknown;
  }[];
};

export const REPORT_IDENTITY_REASONS = {
  missing_ingredient: "المادة العلمية غير مسجلة",
  missing_strength: "التركيز غير مسجل",
  missing_form: "الشكل الدوائي غير موثق",
  conflicting_saved_forms: "أكثر من شكل دوائي معتمد؛ يلزم تحديد شكل هذا البند",
  conflicting_form_evidence: "تعارض بين التعريف المحفوظ وأدلة الشكل الدوائي",
  invalid_saved_definition: "التعريف المحفوظ يتضمن وحدة لا تتوافق مع شكله الدوائي",
} as const;

/** Resolve form without using reporting pack sizes as dispensing-unit evidence. */
export function resolveReportIdentities(
  items: any[],
  rows: any[],
  stocks: any[],
  references: any[] = [],
  definitions?: ReportDefinitionScope,
) {
  const finance = new Map(rows.map((r) => [r.item_id, r]));
  const stockById = new Map(stocks.map((s) => [s.source_stock_id, s]));
  const forms = new Map<string, Set<string>>();
  const scientificForms = new Map<string, Set<string>>();
  const scientificKey = (i: any) =>
    JSON.stringify([
      normalizeActiveIngredient(text(i.active_ingredient)),
      reportStrength(i.strength),
    ]);
  const savedForms = new Map<string, Set<string>>();
  const invalidSaved = new Set<string>();
  for (const setting of definitions?.settings || []) {
    if (!definitions?.pharmacyId || setting.pharmacy_id !== definitions.pharmacyId) continue;
    const normalized = reportSettingKey(setting.item_identity);
    if (!normalized) continue;
    const [ingredient, strength, form] = JSON.parse(normalized);
    const key = JSON.stringify([ingredient, strength]);
    const unit = actualUnit(form);
    if (unit && actualUnit(setting.base_unit) !== unit) {
      invalidSaved.add(key);
      continue;
    }
    const set = savedForms.get(key) || new Set<string>();
    set.add(form);
    savedForms.set(key, set);
  }
  const addScientific = (item: any, form: string) => {
    if (!form || !item.active_ingredient || !item.strength) return;
    const key = scientificKey(item),
      set = scientificForms.get(key) || new Set<string>();
    set.add(form);
    scientificForms.set(key, set);
  };
  for (const ref of [...references, ...stocks])
    addScientific(ref, reportForm(ref.dosage_form || ref.dosage_unit));
  const productKey = (i: any) =>
    JSON.stringify([
      normalizeActiveIngredient(text(i.active_ingredient)),
      reportStrength(i.strength),
      text(i.brand).toLowerCase().replace(/\s+/g, " "),
    ]);
  const direct = new Map<string, string>();
  for (const item of items) {
    const f = finance.get(item.id);
    const stock =
      item.source_classification === "actual-supplier" ? stockById.get(f?.matched_stock_id) : null;
    const form = scientificReportIdentity(
      item,
      reportForm(supplierInvoiceForm(item)) ||
        reportForm(stock?.dosage_unit) ||
        (item.source_classification === "actual-supplier"
          ? reportForm(f?.invoice_dosage_form) || reportForm(f?.invoice_quantity_unit)
          : null),
    ).form;
    direct.set(item.id, form);
    addScientific(item, form);
    if (form && item.brand) {
      const key = productKey(item),
        set = forms.get(key) || new Set<string>();
      set.add(form);
      forms.set(key, set);
    }
  }
  return new Map(
    items.map((item) => {
      const known = forms.get(productKey(item));
      const scientific = scientificForms.get(scientificKey(item));
      let form =
        direct.get(item.id) ||
        (known?.size === 1 ? [...known][0] : "") ||
        (scientific?.size === 1 ? [...scientific][0] : "");
      let issue: keyof typeof REPORT_IDENTITY_REASONS | null = null;
      const itemPharmacy = item.pharmacy_id ?? item.invoice?.pharmacy_id;
      const useDefinition =
        item.source_classification === "phif-supplier" &&
        definitions?.pharmacyId &&
        (!itemPharmacy || itemPharmacy === definitions.pharmacyId);
      // Never feed saved Supplier forms back into the shared evidence maps or Actual.
      if (useDefinition && !direct.get(item.id)) {
        const key = scientificKey(item),
          saved = savedForms.get(key);
        if (invalidSaved.has(key)) {
          form = "";
          issue = "invalid_saved_definition";
        } else if (saved?.size === 1) {
          const approved = [...saved][0];
          const evidence = known?.size ? known : scientific;
          if (evidence?.size && (evidence.size !== 1 || !evidence.has(approved))) {
            form = "";
            issue = "conflicting_form_evidence";
          } else form = approved;
        } else if (saved && saved.size > 1 && known?.size !== 1) {
          form = "";
          issue = "conflicting_saved_forms";
        }
      }
      const identity = scientificReportIdentity(item, form);
      issue = !normalizeActiveIngredient(text(item.active_ingredient))
        ? "missing_ingredient"
        : !reportStrength(item.strength)
          ? "missing_strength"
          : !identity.form
            ? issue || "missing_form"
            : null;
      return [
        item.id,
        { ...identity, reviewReason: issue ? REPORT_IDENTITY_REASONS[issue] : null },
      ];
    }),
  );
}

/** Read legacy keys through normalization, without rewriting or discarding settings. */
export function reportSettingKey(key: string) {
  try {
    const parts = JSON.parse(key);
    if (
      !Array.isArray(parts) ||
      parts.length !== 3 ||
      parts.some((p) => typeof p !== "string" || !p.trim())
    )
      return null;
    return scientificReportIdentity({ active_ingredient: parts[0], strength: parts[1] }, parts[2])
      .key;
  } catch {
    return null;
  }
}
