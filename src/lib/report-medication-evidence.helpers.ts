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

/** Resolve form only from explicit data or consistent evidence for this exact product. */
export function resolveReportIdentities(
  items: any[],
  rows: any[],
  stocks: any[],
  references: any[] = [],
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
      const form =
        direct.get(item.id) ||
        (known?.size === 1 ? [...known][0] : "") ||
        (scientific?.size === 1 ? [...scientific][0] : "");
      return [item.id, scientificReportIdentity(item, form)];
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
