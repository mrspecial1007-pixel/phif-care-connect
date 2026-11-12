import { analyticsSearchSchema, type AnalyticsFilters } from "./items-analytics.helpers";

export type ItemReportReturn = {
  scope: string; filters: AnalyticsFilters; identityId: string; scrollY: number; cardTop: number | null; limit: number;
};
export const reportItemAnchor = (id: string) => `report-item-${encodeURIComponent(id)}`;

export async function openItemIdentityReview(navigate: (options: any) => unknown, context: ItemReportReturn) {
  const state = { itemReportReturn: context };
  // Preserve the originating entry as well, so the browser's Back button restores it.
  await navigate({ to: "/management/reports/items", search: context.filters, state, replace: true, resetScroll: false });
  await navigate({ to: "/management/reports/items/identity-review/$identityId",
    params: { identityId: context.identityId }, search: context.filters, state });
}

export function itemReportReturn(value: unknown, scope: string, filters: AnalyticsFilters): ItemReportReturn | null {
  const state = value as ItemReportReturn | null;
  if (!state || state.scope !== scope || typeof state.identityId !== "string" || !state.identityId
    || !Number.isFinite(state.scrollY) || state.scrollY < 0 || !Number.isSafeInteger(state.limit)
    || state.limit < 40 || state.limit > 100000 || (state.cardTop !== null && !Number.isFinite(state.cardTop))) return null;
  const parsed = analyticsSearchSchema.safeParse(state.filters);
  return parsed.success && JSON.stringify(parsed.data) === JSON.stringify(filters) ? { ...state, filters: parsed.data } : null;
}

/** Resolve by exact scientific key, or the exact source item embedded in a formerly unresolved key. */
export function reportReviewTarget(report: any, identityId: string) {
  const items = [...(report.items || []), ...(report.reviewItems || [])];
  const direct = items.find(item => item.id === identityId);
  if (direct) return direct;
  try {
    const key = JSON.parse(identityId);
    if (!Array.isArray(key) || key.length !== 5 || key[3] !== "unresolved" || typeof key[4] !== "string") return null;
    const movement = report.historyMovements?.find((row: any) => row.id === key[4] && row.source === "phif");
    if (!movement) return null;
    const linked = items.find(item => item.id === movement.identity);
    if (!linked) return null;
    const target = JSON.parse(linked.id);
    return target[0] === key[0] && target[1] === key[1] ? linked : null;
  } catch { return null; }
}

export function restoreItemReportPosition(
  state: ItemReportReturn,
  card: { getBoundingClientRect: () => { top: number } } | null,
  scrollY: number,
  scroll: (y: number) => void,
) {
  scroll(card && state.cardTop !== null
    ? Math.max(0, scrollY + card.getBoundingClientRect().top - state.cardTop) : state.scrollY);
}
