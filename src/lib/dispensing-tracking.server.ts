import { createHash } from "node:crypto";
import {
  analyticsSearchSchema,
  authorizeAnalyticsRead,
  buildItemsAnalytics,
} from "./items-analytics.helpers";
import {
  buildTrackingReport,
  trackingMovements,
  type TrackingInput,
} from "./dispensing-tracking.model";

export async function loadTrackingReport(filters: TrackingInput, exporting: boolean) {
  const { loadItemAnalyticsDataset } = await import("./management.functions");
  let rights!: ReturnType<typeof authorizeAnalyticsRead>;
  const dataset = await loadItemAnalyticsDataset(
    (context, access) => {
      rights = authorizeAnalyticsRead(context.session.data, access, {
        source: filters.source,
        financial: false,
        export: exporting,
      });
      for (const source of ["actual", "phif"] as const) {
        rights.access[source].items &&= rights.access[source].movements;
      }
      const sources = filters.source === "all" ? (["actual", "phif"] as const) : [filters.source];
      if (!sources.some((source) => rights.access[source].items))
        throw new Error("لا تملك صلاحية حركات الصرف للمصدر المختار");
    },
    { includeUndated: true },
  );
  const { loadReportBoxSettings } = await import("./report-box-settings.server");
  const settings = await loadReportBoxSettings(dataset.admin, dataset.session.pharmacy_id);
  const report = buildItemsAnalytics({
    ...dataset,
    ...rights,
    pharmacyId: dataset.session.pharmacy_id,
    settings: settings.settings,
    settingsAvailable: settings.available,
    supplierUnitsAvailable: settings.supplierUnitsAvailable,
    filters: analyticsSearchSchema.parse({ month: "all" }),
  });
  const movements = trackingMovements(report, dataset.items, dataset.rows);
  const ids = new Set(movements.map((row) => row.id));
  if (
    ids.size !== movements.length ||
    new Set(dataset.items.map((item) => item.id)).size !== dataset.items.length
  )
    throw new Error("تكررت معرفات بنود الصرف أثناء القراءة؛ أعد تحديث التقرير");
  for (const item of dataset.items) {
    const source =
      item.source_classification === "phif-supplier"
        ? "phif"
        : item.source_classification === "actual-supplier"
          ? "actual"
          : null;
    if (source && rights.access[source].items && !ids.has(item.id))
      throw new Error("تعذر تضمين بعض بنود الصرف؛ لا يمكن عرض تقرير مكتمل");
  }
  const result = buildTrackingReport(movements, filters);
  if (exporting && !result.selected) throw new Error("حدد الصنف قبل التصدير");
  const revision = createHash("sha256")
    .update(
      JSON.stringify({
        pharmacy: dataset.session.pharmacy_id,
        item: result.selected?.id,
        mode: filters.mode,
        product: filters.product,
        source: filters.source,
        company: filters.company,
        from: filters.from,
        to: filters.to,
        rows: result.movements,
      }),
    )
    .digest("hex");
  const pageCount = Math.max(1, Math.ceil(result.movements.length / 50));
  const page = Math.min(pageCount, filters.page);
  return {
    ...result,
    movements: exporting ? result.movements : result.movements.slice((page - 1) * 50, page * 50),
    totalMovements: result.movements.length,
    page,
    pageCount,
    revision,
    filters,
    pharmacy: dataset.session.pharmacy_name,
    issuedAt: new Date().toISOString(),
    canExport: rights.canExport,
    hiddenSources: (["actual", "phif"] as const).filter((source) => !rights.access[source].items),
    unclassifiedItems: dataset.items.filter(
      (i) => !["phif-supplier", "actual-supplier"].includes(i.source_classification || ""),
    ).length,
  };
}
export type TrackingReport = Awaited<ReturnType<typeof loadTrackingReport>>;
