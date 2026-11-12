import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { aggregatePhifAnalytics, analyticsBoxes, analyticsCard, analyticsGrowth, analyticsQueryKey, dailyPhifAnalytics, filterAnalyticsMovements, phifAnalyticsExportRows, type AnalyticsMovement } from "../phif-analytics.model";
import { summarizeReportBoxes } from "../report-box-quantity.helpers";
import { bindItemsAnalyticsSessionCache, itemsAnalyticsCacheOptions, itemsAnalyticsScope } from "../items-analytics-cache.helpers";
import { refreshReportAfterSettingSave } from "../report-setting-save.helpers";

const identity = JSON.stringify(["metformin", "500mg", "tablet"]);
const row = (id: string, changes: Partial<AnalyticsMovement> = {}): AnalyticsMovement => ({
  id, identity, ingredient: "Metformin", strength: "500MG", form: "tablet", brand: "Brand",
  invoiceId: `invoice-${id}`, date: "2026-09-12", card: "000123", source: "phif",
  boxes: 1, unit: "tablet", boxSize: 30, baseUnit: "tablet", boxIssue: null,
  beneficiariesAvailable: true, ...changes,
});

describe("PHIF Analytics shared quantities and identities", () => {
  it("distinguishes unknown, confirmed zero and incompatible boxes", () => {
    expect(analyticsBoxes([row("a", { boxes: null })])).toMatchObject({ value: null, state: "unknown", rows: 1 });
    expect(analyticsBoxes([row("a", { boxes: 0 })])).toMatchObject({ value: 0, state: "complete" });
    expect(analyticsBoxes([row("a", { boxSize: 28 }), row("b")])).toMatchObject({ value: null, state: "incompatible" });
  });
  it("never masks 28/30 conflicts with an unknown row and uses the report engine", () => {
    const rows = [row("a", { boxSize: 28 }), row("b"), row("c", { boxes: null })];
    expect(analyticsBoxes(rows)).toEqual(summarizeReportBoxes(rows));
    expect(analyticsBoxes(rows)).toMatchObject({ state: "incompatible", unknown: 1 });
    expect(aggregatePhifAnalytics(rows)).toMatchObject({ rows: 3, rankingComplete: false });
  });
  it("retains known plus unknown rows without presenting a partial total", () => {
    const data = aggregatePhifAnalytics([row("a"), row("b", { boxes: null })]);
    expect(data).toMatchObject({ rows: 2, invoices: 2, total: { value: null }, rankingComplete: false });
  });
  it.each([NaN, Infinity, -1])("rejects invalid box count %s", boxes => {
    expect(analyticsBoxes([row("a", { boxes })]).value).toBeNull();
  });
  it("keeps fractions, confirmed zeros, source totals and deduplicates exact item IDs", () => {
    const a = row("a", { boxes: 0.5 }), b = row("b", { source: "actual", boxes: 2.25 });
    expect(aggregatePhifAnalytics([a, a, b])).toMatchObject({ rows: 2, total: { value: 2.75 }, sup: { value: 0.5 }, act: { value: 2.25 } });
  });
  it("counts a brand once across sources while preserving both details", () => {
    const g = aggregatePhifAnalytics([row("a"), row("b", { brand: " BRAND ", source: "actual" })]).generics[0];
    expect(g.brandCount).toBe(1); expect(g.brandList).toHaveLength(2);
    expect(g.beneficiaries.count).toBe(1);
  });
  it("keeps unresolved identity rows but excludes them from confirmed generics/ranking", () => {
    const a = row("a", { identity: JSON.stringify(["metformin", "500mg", "", "unresolved", "a"]), form: "" });
    const data = aggregatePhifAnalytics([a, row("b"), row("c", { identity: JSON.stringify(["metformin", "850mg", "tablet"]) })]);
    expect(data).toMatchObject({ rows: 3, confirmedGenerics: 2, reviewGenerics: 1, rankingComplete: false });
  });
  it("does not turn unknown daily movements into zero; days without movements are zero", () => {
    const data = dailyPhifAnalytics([row("a", { boxes: null })], "2026-09");
    expect(data).toHaveLength(30); expect(data[11]).toMatchObject({ sup: null, complete: false });
    expect(data[0]).toMatchObject({ sup: 0, act: 0, complete: true });
  });
  it("does not calculate growth from incomplete data or a zero baseline", () => {
    expect(analyticsGrowth(analyticsBoxes([row("a", { boxes: null })]), analyticsBoxes([row("b")]))).toBeNull();
    expect(analyticsGrowth(analyticsBoxes([row("a")]), analyticsBoxes([row("b", { boxes: 0 })]))).toBeNull();
    expect(analyticsGrowth(analyticsBoxes([row("a", { boxes: 2 })]), analyticsBoxes([row("b")]))).toBe(100);
  });
});

describe("beneficiary cards and exports", () => {
  it("counts same-name beneficiaries by different cards and preserves initial zeros", () => {
    const data = aggregatePhifAnalytics([row("a"), row("b", { card: "123" }), row("c", { card: "000123", brand: "Other" })]);
    expect(data.beneficiaries.count).toBe(2);
    expect(analyticsCard("٠٠٠١٢٣")).toBe("000123");
    expect(analyticsCard(123)).toBeNull();
  });
  it("does not fall back to names or add brand counts; separates absent/invalid cards", () => {
    const data = aggregatePhifAnalytics([row("a"), row("b", { brand: "Other" }), row("c", { card: null }), row("d", { card: "invalid" })]);
    expect(data.beneficiaries).toEqual({ count: 1, missing: 1, invalid: 1 });
  });
  it("labels permission-redacted beneficiaries unavailable rather than zero", () => {
    const movements = [row("a", { beneficiariesAvailable: false, card: null })];
    expect(aggregatePhifAnalytics(movements).beneficiaries.count).toBeNull();
    expect(phifAnalyticsExportRows({ canExport: true, movements }, "all", "all").summary["حالة المستفيدين"]).toBe("غير متاح");
  });
  it("blocks export without permission and preserves nulls and screen totals when allowed", () => {
    const movements = [row("a"), row("b", { boxes: null })];
    expect(() => phifAnalyticsExportRows({ canExport: false, movements }, "all", "all")).toThrow();
    const result = phifAnalyticsExportRows({ canExport: true, movements }, "all", "all");
    expect(result.summary["إجمالي العلب"]).toBe(aggregatePhifAnalytics(movements).total.value);
    expect(result.rows[0]["العلب"]).toBeNull(); expect(result.rows[0]["بنود الصرف"]).toBe(2);
    expect(filterAnalyticsMovements(movements, "actual", "all")).toEqual([]);
  });
});

describe("Analytics invalidation and scope", () => {
  const session = { unlocked: true, pharmacy: { id: "tiryaq" }, user: { id: "admin", role: "admin", permissions: {} } };
  it("reuses navigation cache then refreshes on return after invoice sync invalidation", async () => {
    const c = new QueryClient(), scope = itemsAnalyticsScope(session), key = analyticsQueryKey(scope, "2026-09");
    const read = vi.fn(async () => ({ rows: read.mock.calls.length }));
    const options = { ...itemsAnalyticsCacheOptions, queryKey: key, queryFn: read };
    try {
      await c.fetchQuery(options);
      const first = new QueryObserver(c, options); const stop = first.subscribe(() => {});
      expect(first.getCurrentResult().data).toEqual({ rows: 1 }); stop();
      await c.invalidateQueries({ queryKey: ["items_analytics"] });
      const second = new QueryObserver(c, options); const end = second.subscribe(() => {});
      await vi.waitFor(() => expect(second.getCurrentResult().data).toEqual({ rows: 2 })); end();
    } finally { c.clear(); }
  });
  it("invalidates Analytics after settings writes without invalidating another pharmacy", async () => {
    const c = new QueryClient(), key = analyticsQueryKey("scope", "2026-09"), other = analyticsQueryKey("other", "2026-09");
    try {
      c.setQueryData(key, {}); c.setQueryData(other, {});
      refreshReportAfterSettingSave(c, ["items_analytics", "scope", "consumption"], () => { throw new Error("unexpected refresh failure"); });
      await vi.waitFor(() => expect(c.getQueryState(key)?.isInvalidated).toBe(true));
      expect(c.getQueryState(other)?.isInvalidated).toBe(false);
    } finally { c.clear(); }
  });
  it("removes old and new Analytics cache on logout and permission/scope changes", () => {
    const c = new QueryClient(), scope = itemsAnalyticsScope(session), stop = bindItemsAnalyticsSessionCache(c);
    try {
      c.setQueryData(analyticsQueryKey(scope, "2026-09"), {});
      c.setQueryData(["phif_analytics", scope, "2026-09"], {});
      c.setQueryData(["session"], { ...session, user: { ...session.user, permissions: { reports_export: false } } });
      expect(c.getQueryData(analyticsQueryKey(scope, "2026-09"))).toBeUndefined();
      expect(c.getQueryData(["phif_analytics", scope, "2026-09"])).toBeUndefined();
      c.setQueryData(analyticsQueryKey(scope, "2026-09"), {});
      c.setQueryData(["session"], { unlocked: false });
      expect(c.getQueryData(analyticsQueryKey(scope, "2026-09"))).toBeUndefined();
    } finally { stop(); c.clear(); }
  });
});
