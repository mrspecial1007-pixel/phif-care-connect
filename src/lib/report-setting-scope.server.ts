import { readReportPages } from "./report-pages.server";
import { readReportFormReferences } from "./report-medication-evidence.server";
import {
  resolveReportIdentities,
  scientificReportIdentity,
  reportStrength,
} from "./report-medication-evidence.helpers";
import { normalizeActiveIngredient } from "./medication-normalize";
type SettingMeasure = <R>(phase: string, fn: () => R) => Promise<Awaited<R>>;

/** Fresh operational evidence only. Saving a reporting setting never needs profit calculations. */
export async function loadReportSettingScope(
  db: any,
  pharmacyId: string,
  identity: string,
  measure: SettingMeasure = (_phase, fn) => Promise.resolve(fn()),
) {
  const key = JSON.parse(identity);
  if (
    !Array.isArray(key) ||
    key.length !== 3 ||
    key.some((v) => typeof v !== "string" || !v.trim())
  )
    throw new Error("هوية الصنف تحتاج مراجعة");
  const expected = scientificReportIdentity(
    { active_ingredient: key[0], strength: key[1] },
    key[2],
  );
  if (expected.key !== identity) throw new Error("الهوية العلمية غير موحدة؛ أعد تحميل التقرير");
  const rows = await measure("identity_database_read", () =>
    readReportPages(() =>
      db
        .from("phif_invoice_items")
        .select(
          "id,phif_invoice_id,active_ingredient,strength,brand,source_classification,metadata,phif_financial_fields,invoice:phif_invoices!inner(pharmacy_id)",
          { count: "exact" },
        )
        .eq("invoice.pharmacy_id", pharmacyId)
        .in("source_classification", ["phif-supplier", "actual-supplier"])
        .order("id"),
    ),
  );
  const candidates = await measure("identity_normalization", () =>
    rows.filter(
      (i) =>
        normalizeActiveIngredient(String(i.active_ingredient || "").normalize("NFKC")) === key[0] &&
        reportStrength(i.strength) === key[1],
    ),
  );
  let identities = new Map(candidates.map((i) => [i.id, scientificReportIdentity(i)]));
  // Missing forms need the same pharmacy-scoped stock/reference evidence as the report.
  // Resolve once per scientific scope, not once per invoice or exception.
  if (candidates.some((i) => !identities.get(i.id)?.form)) {
    const stocks = await measure("form_database_read", () =>
      readReportPages(() =>
        db
          .from("phif_stock_items")
          .select("id,active_ingredient,strength,dosage_unit")
          .eq("pharmacy_id", pharmacyId)
          .eq("is_current", true)
          .order("id"),
      ),
    );
    const references = await measure("reference_database_read", () =>
      readReportFormReferences(db, pharmacyId),
    );
    identities = await measure("identity_resolution", () =>
      resolveReportIdentities(candidates, [], stocks, references),
    );
  }
  let items = candidates.filter((i) => identities.get(i.id)?.key === identity);
  if (!items.length && candidates.some((i) => !identities.get(i.id)?.form)) {
    // Preserve identities that require legacy/manual Actual evidence. This rare
    // fallback retains the old checks rather than guessing a missing form.
    const { loadItemAnalyticsDataset } = await import("./management.functions");
    const dataset = await loadItemAnalyticsDataset();
    if (dataset.session.pharmacy_id !== pharmacyId)
      throw new Error("تغيرت الصيدلية؛ أعد تحميل الصفحة");
    const verified = resolveReportIdentities(
      dataset.items,
      dataset.rows,
      dataset.stocks,
      dataset.referenceForms,
    );
    items = dataset.items.filter((i) => verified.get(i.id)?.key === identity);
  }
  if (!items.length) throw new Error("هوية الصنف أو الشكل الدوائي تحتاج مراجعة");
  return { id: identity, form: expected.form, items };
}

/** Durations only: no identities, patient data, prices, credentials or session values. */
export async function timedReportSetting<T>(
  operation: string,
  work: (measure: SettingMeasure) => Promise<T>,
) {
  const start = performance.now(),
    phases: Record<string, number> = {};
  let success = false;
  const measure = async <R>(phase: string, fn: () => R): Promise<Awaited<R>> => {
    const at = performance.now();
    try {
      return await fn();
    } finally {
      phases[phase] = Math.round(performance.now() - at);
    }
  };
  try {
    const result = await work(measure);
    success = true;
    return result;
  } finally {
    console.info("phif_report_setting_timing", {
      operation,
      success,
      phases,
      total_ms: Math.round(performance.now() - start),
    });
  }
}
