import { readReportPages } from "./report-pages.server";
import { readReportFormReferences } from "./report-medication-evidence.server";
import {
  resolveReportIdentities,
  scientificReportIdentity,
  reportStrength,
  reportIngredient,
} from "./report-medication-evidence.helpers";
import { reportReviewIdentity } from "./report-identity-review.helpers";
import type { ActualUnit } from "./actual-units.helpers";
type SettingMeasure = <R>(phase: string, fn: () => R) => Promise<Awaited<R>>;

/** Use operational evidence first; linked Actual forms reuse the report dataset when needed. */
export async function loadReportSettingScope(
  db: any,
  pharmacyId: string,
  identity: string,
  measure: SettingMeasure = (_phase, fn) => Promise.resolve(fn()),
  review?: { itemId: string; baseUnit: ActualUnit },
) {
  let key: unknown;
  try { key = JSON.parse(identity); }
  catch { throw new Error("صيغة هوية الصنف غير صالحة؛ أعد تحميل التقرير"); }
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
        reportIngredient(i.active_ingredient) === key[0] &&
        reportStrength(i.strength) === key[1],
    ),
  );
  const reviewItem = review && candidates.find(i => i.id === review.itemId);
  if (review && (!reviewItem || reviewItem.source_classification !== "phif-supplier"
    || reportReviewIdentity(identity, key[2]) !== identity))
    throw new Error("بند المراجعة لا يطابق الصيدلية أو هوية PHIF Supplier المطلوبة");
  if (reviewItem && scientificReportIdentity(reviewItem).form
    && scientificReportIdentity(reviewItem).form !== expected.form)
    throw new Error("لا يمكن استبدال شكل دوائي صريح في الفاتورة بتعريف مختلف");
  let identities = resolveReportIdentities(candidates, [], []);
  let definitions: Parameters<typeof resolveReportIdentities>[4];
  let stocks: any[] = [], references: any[] = [];
  let finance: any[] = [];
  // Missing forms need the same pharmacy-scoped stock/reference evidence as the report.
  // Resolve once per scientific scope, not once per invoice or exception.
  if (review || candidates.some((i) => !scientificReportIdentity(i).form)) {
    const { loadReportBoxSettings } = await import("./report-box-settings.server");
    const { settings } = await measure("definition_database_read", () =>
      loadReportBoxSettings(db, pharmacyId),
    );
    definitions = { pharmacyId, settings };
    stocks = await measure("form_database_read", () =>
      readReportPages(() =>
        db
          .from("phif_stock_items")
          .select("id,active_ingredient,strength,dosage_unit")
          .eq("pharmacy_id", pharmacyId)
          .eq("is_current", true)
          .order("id"),
      ),
    );
    references = await measure("reference_database_read", () =>
      readReportFormReferences(db, pharmacyId),
    );
    // Actual's linked stock/form can be scientific evidence in the displayed report.
    // Do not substitute the stock's generic form when that same report used a link.
    if (candidates.some(i => i.source_classification === "actual-supplier"
      && !scientificReportIdentity(i).form)) {
      const { loadItemAnalyticsDataset } = await import("./management.functions");
      const dataset = await measure("linked_identity_evidence", () => loadItemAnalyticsDataset());
      if (dataset.session.pharmacy_id !== pharmacyId)
        throw new Error("تغيرت الصيدلية؛ أعد تحميل الصفحة");
      finance = dataset.rows;
      stocks = dataset.stocks;
      references = dataset.referenceForms;
    }
    identities = await measure("identity_resolution", () =>
      resolveReportIdentities(candidates, finance, stocks, references, definitions),
    );
  }
  if (review) {
    // Preview the existing resolver with the proposed persistent definition.
    // This never writes invoices, infers dispensing units, or supplies forms to Actual.
    const proposed = { pharmacyId, settings: [...(definitions?.settings || []), {
      pharmacy_id: pharmacyId, item_identity: identity, base_unit: review.baseUnit,
    }] };
    const reviewed = resolveReportIdentities(candidates, finance, stocks, references, proposed);
    const checked = reviewed.get(review.itemId);
    if (!checked || checked.key !== identity || checked.reviewReason)
      throw new Error(`تعذر اعتماد الشكل: ${checked?.reviewReason || "تعارض مع بيانات الصنف المسجلة"}`);
    const items = candidates.filter(i => i.source_classification === "phif-supplier"
      && reviewed.get(i.id)?.key === identity && !reviewed.get(i.id)?.reviewReason);
    return { id: identity, form: expected.form, items };
  }
  const items = candidates.filter((i) => identities.get(i.id)?.key === identity
    && !identities.get(i.id)?.reviewReason);
  if (!items.length) {
    if (!candidates.length) throw new Error("لا يوجد بند مطابق للمادة العلمية والتركيز في هذه الصيدلية؛ حدّث التقرير وراجع الهوية");
    const reasons = [...new Set(candidates.map(i => identities.get(i.id)?.reviewReason).filter(Boolean))];
    throw new Error(`مراجعة الهوية مطلوبة: ${reasons.join("؛ ") || "الشكل الدوائي المطلوب لا يطابق الأدلة المسجلة"}`);
  }
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
