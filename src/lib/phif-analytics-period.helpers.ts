import { analyticsSearchSchema, buildItemsAnalytics, monthWindow } from "./items-analytics.helpers";
import { aggregatePhifAnalytics, analyticsBoxes, analyticsGrowth, filterAnalyticsMovements, type AnalyticsMovement, type AnalyticsSource } from "./phif-analytics.model";

export function analyticsMonths(month: string) {
  return Array.from({ length: 6 }, (_, i) => monthWindow(month, i - 5).from.slice(0, 7));
}
export const analyticsPeriodQueryKey = (scope: string | null, month: string) =>
  ["items_analytics", scope, "phif_analytics_period", month] as const;
export type AnalyticsMonth = { month: string; status: "success"; movements: AnalyticsMovement[]; canExport: boolean }
  | { month: string; status: "error"; message: string };
export type AnalyticsPeriod = { months: AnalyticsMonth[] };
type Input = Parameters<typeof buildItemsAnalytics>[0];

/** One shared identity/conversion pass, then disjoint calendar partitions. No financial engine here. */
export function buildPhifAnalyticsPeriod(input: Input, month: string): AnalyticsPeriod {
  const months = analyticsMonths(month);
  const report = buildItemsAnalytics({ ...input,
    filters: analyticsSearchSchema.parse({ month: "all", source: "all", mode: "cumulative" }),
    movementRange: { from: monthWindow(months[0]).from, to: monthWindow(month).to },
  });
  const buckets = new Map(months.map(m => [m, [] as AnalyticsMovement[]]));
  for (const r of report.movements) {
    // Only server-redacted consumption fields cross this endpoint, without names or financial values.
    const { id, identity, ingredient, strength, form, brand, invoiceId, date, card, source, boxes,
      unit, boxSize, baseUnit, boxIssue, beneficiariesAvailable } = r;
    buckets.get(date.slice(0, 7))?.push({ id, identity, ingredient, strength, form, brand, invoiceId, date,
      card, source, boxes, unit, boxSize, baseUnit, boxIssue, beneficiariesAvailable });
  }
  return { months: months.map(m => ({ month: m, status: "success", movements: buckets.get(m)!, canExport: report.canExport })) };
}

export function validAnalyticsSelection(identity: string, rows: AnalyticsMovement[]) {
  return identity === "all" || rows.some(r => r.identity === identity) ? identity : "all";
}

/** A failed month stays absent; it never contributes a zero or blocks unrelated complete months. */
export function analyticsComparison(months: string[], period: AnalyticsPeriod | undefined, source: AnalyticsSource, identity: string, failed = false) {
  const entries = new Map(period?.months.map(m => [m.month, m]));
  const data = months.map(month => {
    const entry = entries.get(month);
    const status = failed || entry?.status === "error" || (period && !entry) ? "error" : entry?.status === "success" ? "success" : "loading";
    const rows = status === "success" && entry?.status === "success" ? filterAnalyticsMovements(entry.movements, source, identity) : null;
    return { month, status, rows, aggregate: rows ? aggregatePhifAnalytics(rows) : null };
  });
  const incompatible = analyticsBoxes(data.flatMap(m => m.rows || [])).state === "incompatible";
  const previous = data[4], current = data[5];
  const pairComplete = current?.rows && previous?.rows && analyticsBoxes([...current.rows, ...previous.rows]).state === "complete";
  return { months: data.map(m => ({ ...m,
    sup: incompatible ? null : m.aggregate?.sup.value ?? null,
    act: incompatible ? null : m.aggregate?.act.value ?? null,
    incompatible,
  })), growth: pairComplete ? analyticsGrowth(current.aggregate!.total, previous.aggregate!.total) : null };
}
