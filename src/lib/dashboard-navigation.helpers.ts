import { z } from "zod";

export const dashboardFilters = ["all", "active", "preparation", "suspended", "shared", "review", "overdue", "partial", "has_phone", "no_phone", "favorite", "old_follow_up"] as const;
const position = z.number().finite().min(0).max(100_000_000);
export const preparationListStateSchema = z.object({
  open: z.boolean(), query: z.string().max(2000), selectedKey: z.string().max(10000).nullable(),
  listScrollTop: position, detailScrollTop: position,
});
const dashboardViewSchema = z.object({
  q: z.string().max(2000), filter: z.enum(dashboardFilters), preparationMode: z.enum(["single", "range"]),
  preparationFrom: z.string().max(10), preparationTo: z.string().max(10), scrollY: position,
  preparationList: preparationListStateSchema,
});
export type PreparationListState = z.infer<typeof preparationListStateSchema>;
export type DashboardView = z.infer<typeof dashboardViewSchema>;
export const emptyPreparationList = (): PreparationListState => ({ open: false, query: "", selectedKey: null, listScrollTop: 0, detailScrollTop: 0 });
export const defaultDashboardView = (today: string): DashboardView => ({
  q: "", filter: "active", preparationMode: "single", preparationFrom: today, preparationTo: today,
  scrollY: 0, preparationList: emptyPreparationList(),
});
export function dashboardScope(session: any): string {
  return session?.unlocked && session.pharmacy?.id
    ? JSON.stringify([session.pharmacy.id, session.user?.id || "pin", session.user?.role || "pin"]) : "";
}

const views = new Map<string, DashboardView>();
const storageKey = (scope: string, entry: string) => `phif-dashboard-visit-v1:${JSON.stringify([scope, entry])}`;
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function readDashboardView(scope: string, entry: string, today: string, storage?: StorageLike): DashboardView {
  const key = storageKey(scope, entry);
  let value: unknown = views.get(key);
  try { if (!value && scope && entry) value = JSON.parse(storage?.getItem(key) || "null"); } catch { /* Storage may be unavailable. */ }
  const parsed = dashboardViewSchema.safeParse(value);
  return scope && entry && parsed.success ? parsed.data : defaultDashboardView(today);
}
export function saveDashboardView(scope: string, entry: string, value: DashboardView, storage?: StorageLike) {
  if (!scope || !entry) return;
  const parsed = dashboardViewSchema.safeParse(value);
  if (!parsed.success) return;
  const key = storageKey(scope, entry);
  views.delete(key); views.set(key, parsed.data);
  try { storage?.setItem(key, JSON.stringify(parsed.data)); } catch { /* In-memory restoration remains available. */ }
  while (views.size > 40) {
    const oldest = views.keys().next().value!;
    views.delete(oldest);
    try { storage?.removeItem(oldest); } catch { /* Optional tab storage. */ }
  }
}
export type DashboardOrigin = { scope: string; entry: string; index: number; patientId: string };
export function canReturnToDashboard(value: unknown, scope: string, patientId: string, currentIndex: unknown): value is DashboardOrigin {
  const v = value as DashboardOrigin | null;
  return Boolean(v && scope && v.scope === scope && v.patientId === patientId && typeof v.entry === "string" && v.entry
    && Number.isSafeInteger(v.index) && v.index >= 0 && currentIndex === v.index + 1);
}
