import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider, QueryObserver, focusManager, onlineManager } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemsAnalyticsPage } from "@/components/management/ItemsAnalyticsViews";
import { analyticsSearchSchema, buildItemsAnalytics } from "../items-analytics.helpers";
import { bindItemsAnalyticsSessionCache, itemsAnalyticsCacheOptions, itemsAnalyticsScope } from "../items-analytics-cache.helpers";
import { refreshReportAfterSettingSave } from "../report-setting-save.helpers";

const auth = vi.hoisted(() => ({ session: {} as any }));
vi.mock("@/lib/queries", () => ({ useSession: () => auth.session }));
vi.mock("@tanstack/react-router", () => ({ useSearch: () => ({ month: "all" }), useNavigate: () => vi.fn() }));
vi.mock("@/components/management/ReportBackLink", () => ({ ReportBackLink: () => null }));

const session = (patch: any = {}) => ({ unlocked: true, pharmacy: { id: "tiryaq" },
  user: { id: "manager", role: "admin", permissions: { reports_read: true } }, ...patch });
const filters = analyticsSearchSchema.parse({ month: "all" });
const key = (scope = itemsAnalyticsScope(session())!, month = "all") =>
  ["items_analytics", scope, "consumption", { ...filters, month }] as const;
const clients: QueryClient[] = [];
function client() {
  const value = new QueryClient();
  clients.push(value);
  return value;
}
function observe(client: QueryClient, queryKey: readonly unknown[], queryFn: () => Promise<any>) {
  const observer = new QueryObserver(client, { ...itemsAnalyticsCacheOptions, queryKey, queryFn });
  const stop = observer.subscribe(() => {});
  return { observer, stop };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const ready = (observer: QueryObserver<any>) => vi.waitFor(() => {
  expect(observer.getCurrentResult().isSuccess).toBe(true);
  expect(observer.getCurrentResult().isFetching).toBe(false);
});
afterEach(() => {
  for (const client of clients.splice(0)) { client.unmount(); client.clear(); }
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

describe("retained item report cache", () => {
  it("returns cached results immediately on repeated navigation without another report request", async () => {
    const c = client();
    const read = vi.fn(async () => ({ items: ["retained"] }));
    const first = observe(c, key(), read);
    await ready(first.observer);
    first.stop();
    await tick();
    const second = observe(c, key(), read);
    expect(second.observer.getCurrentResult()).toMatchObject({ data: { items: ["retained"] }, isLoading: false, isFetching: false });
    second.stop();
    const third = observe(c, key(), read);
    await tick();
    expect(read).toHaveBeenCalledTimes(1);
    third.stop();
  });

  it("does not refetch on focus or reconnect, even when invalidated until an explicit refresh/return", async () => {
    const c = client(); c.mount();
    const read = vi.fn(async () => ({ version: 1 }));
    const report = observe(c, key(), read);
    await ready(report.observer);
    await c.invalidateQueries({ queryKey: key(), refetchType: "none" });
    focusManager.setFocused(false); focusManager.setFocused(true);
    onlineManager.setOnline(false); onlineManager.setOnline(true);
    await tick();
    expect(read).toHaveBeenCalledTimes(1);
    report.stop();
  });

  it("keeps months, filters, pharmacies, users and permissions in separate caches", async () => {
    const c = client();
    const read = vi.fn(async () => ({ version: 1 }));
    const scopes = [session(), session({ pharmacy: { id: "andalus" } }),
      session({ user: { id: "employee", role: "employee", permissions: {} } }),
      session({ user: { id: "manager", role: "admin", permissions: {} } })];
    const keys = scopes.map(s => key(itemsAnalyticsScope(s)!));
    keys.push(key(undefined, "2026-10"));
    keys.push([...key().slice(0, 3), { ...filters, source: "phif", q: "aspirem" }] as any);
    for (const queryKey of keys) {
      const report = observe(c, queryKey, read);
      expect(report.observer.getCurrentResult().data).toBeUndefined();
      await ready(report.observer);
      report.stop();
    }
    expect(read).toHaveBeenCalledTimes(keys.length);
  });

  it("refetches an inactive report invalidated by a real data change on return without hiding old results", async () => {
    const c = client();
    const read = vi.fn(async () => ({ version: 1 }));
    const first = observe(c, key(), read);
    await ready(first.observer); first.stop();
    await c.invalidateQueries({ queryKey: ["items_analytics"] });
    expect(read).toHaveBeenCalledTimes(1);
    let finish!: (value: any) => void;
    read.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const returned = observe(c, key(), read);
    expect(returned.observer.getCurrentResult()).toMatchObject({ data: { version: 1 }, isLoading: false, isFetching: true });
    finish({ version: 2 }); await ready(returned.observer);
    expect(returned.observer.getCurrentResult().data).toEqual({ version: 2 });
    returned.stop();
  });

  it("refreshes only the active exact report after save, invalidating other cached variants only in its session scope", async () => {
    const c = client();
    const otherKey = key("another-session");
    const monthKey = key(undefined, "2026-09");
    c.setQueryData(otherKey, { version: 7 });
    c.setQueryData(monthKey, { version: 1 });
    const read = vi.fn(async () => ({ version: 1 }));
    const report = observe(c, key(), read);
    await ready(report.observer);
    let finish!: (value: any) => void;
    read.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const failure = vi.fn();
    refreshReportAfterSettingSave(c, key(), failure);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(report.observer.getCurrentResult()).toMatchObject({ data: { version: 1 }, isLoading: false });
    expect(c.getQueryState(monthKey)?.isInvalidated).toBe(true);
    expect(c.getQueryState(otherKey)?.isInvalidated).toBe(false);
    finish({ version: 2 }); await ready(report.observer);
    expect(report.observer.getCurrentResult().data).toEqual({ version: 2 });
    expect(failure).not.toHaveBeenCalled(); report.stop();
  });

  it("cancels a pre-save in-flight response so it cannot overwrite the refreshed report", async () => {
    const c = client();
    c.setQueryData(key(), { version: 1 });
    let finishOld!: (value: any) => void;
    const old = new Promise(resolve => { finishOld = resolve; });
    const read = vi.fn().mockReturnValueOnce(old).mockResolvedValue({ version: 3 });
    const report = observe(c, key(), read);
    const pending = report.observer.refetch();
    refreshReportAfterSettingSave(c, key(), vi.fn());
    await vi.waitFor(() => expect(c.getQueryData(key())).toEqual({ version: 3 }));
    finishOld({ version: 2 }); await pending;
    expect(c.getQueryData(key())).toEqual({ version: 3 }); report.stop();
  });

  it("keeps data on a failed background refresh and leaves the query invalidated for retry", async () => {
    const c = client();
    const read = vi.fn(async () => ({ version: 1 }));
    const report = observe(c, key(), read);
    await ready(report.observer);
    read.mockRejectedValue(new Error("offline"));
    const failure = vi.fn();
    refreshReportAfterSettingSave(c, key(), failure);
    await vi.waitFor(() => expect(failure).toHaveBeenCalledTimes(1));
    expect(report.observer.getCurrentResult()).toMatchObject({ data: { version: 1 }, isLoading: false, isError: true });
    expect(c.getQueryState(key())?.isInvalidated).toBe(true); report.stop();
  });

  it("clears retained reports on logout and on a user/pharmacy/permission change, not during background verification", async () => {
    const c = client();
    const unbind = bindItemsAnalyticsSessionCache(c);
    c.setQueryData(["session"], session());
    c.setQueryData(key(), { privateCost: 123 });
    await c.fetchQuery({ queryKey: ["session"], queryFn: async () => {
      expect(c.getQueryData(key())).toEqual({ privateCost: 123 });
      return session();
    } });
    expect(c.getQueryData(key())).toBeDefined();
    for (const next of [session({ pharmacy: { id: "andalus" } }),
      session({ user: { id: "employee", role: "employee", permissions: {} } }),
      session({ user: { id: "manager", role: "admin", permissions: {} } }), { unlocked: false }]) {
      c.setQueryData(key(), { privateCost: 123 });
      c.setQueryData(["session"], next);
      expect(c.getQueryData(key())).toBeUndefined();
    }
    unbind();
  });

  it("also purges reports if session verification fails", async () => {
    const c = client(); bindItemsAnalyticsSessionCache(c);
    c.setQueryData(["session"], session()); c.setQueryData(key(), { privateCost: 123 });
    await expect(c.fetchQuery({ queryKey: ["session"], queryFn: async () => { throw new Error("unauthorized"); }, retry: false })).rejects.toThrow();
    expect(c.getQueryData(key())).toBeUndefined();
  });

  it("renders a cached report during background session verification, but fails closed on a session error", () => {
    const c = client();
    const data = buildItemsAnalytics({ items: [], invoices: [], stocks: [], rows: [], settings: [], filters,
      access: { actual: { items: true }, phif: { items: true } } as any });
    c.setQueryData(key(), data);
    auth.session = { data: session(), isFetching: true, error: null };
    const render = () => renderToStaticMarkup(<QueryClientProvider client={c}><ItemsAnalyticsPage /></QueryClientProvider>);
    const html = render();
    expect(html).toContain("تقرير الأصناف والاستهلاك");
    expect(html).not.toContain("جارٍ التحقق من الجلسة");
    expect(html).not.toContain("جارٍ تحميل التقرير");
    auth.session = { ...auth.session, error: new Error("expired") };
    expect(render()).toContain("تعذر التحقق من الجلسة الحالية");
    expect(render()).not.toContain("تقرير الأصناف والاستهلاك");
  });

  it("renders identity review above the cards from cached results and retains the section after review is resolved", () => {
    const c = client();
    const rights = { items: true, movements: true, revenue: true, cost: true, profit: true };
    const items = [
      { id: "complete", phif_invoice_id: "invoice", source_classification: "phif-supplier",
        active_ingredient: "Resolved marker medicine", strength: "5MG", quantity: 30, metadata: { dosage_form: "TAB" } },
      { id: "review", phif_invoice_id: "invoice", source_classification: "phif-supplier",
        active_ingredient: "Needs review medicine", strength: "10MG", quantity: 30, metadata: {} },
    ];
    const data = buildItemsAnalytics({ items, invoices: [{ id: "invoice", dispensing_date: "2026-10-24", insurance_card_number: "0001" }],
      stocks: [], rows: items.map(item => ({ item_id: item.id, revenue: 90, purchase_cost: 24, gross_margin: 66 })),
      settings: [], filters, canManageBoxes: true, access: { actual: rights, phif: rights } });
    expect(data.reviewItems).toHaveLength(1);
    c.setQueryData(key(), data);
    auth.session = { data: session(), isFetching: false, error: null };
    const render = () => renderToStaticMarkup(<QueryClientProvider client={c}><ItemsAnalyticsPage /></QueryClientProvider>);
    const html = render();
    expect(html).toContain("مراجعة هوية الأصناف (1)");
    expect(html.indexOf("مراجعة هوية الأصناف")).toBeLessThan(html.indexOf("Resolved marker medicine"));
    expect(html).toContain("تعديل التعريف");
    c.setQueryData(key(), { ...data, reviewItems: [] });
    expect(render()).toContain("مراجعة هوية الأصناف (0)");
    expect(render()).not.toContain("جارٍ تحميل التقرير");
  });
});
