import { describe, expect, it } from "vitest";
import { analyticsSearchSchema, buildItemsAnalytics, type AnalyticsAccess } from "../items-analytics.helpers";
import { aggregatePhifAnalytics, dailyPhifAnalytics } from "../phif-analytics.model";
import { analyticsComparison, analyticsMonths, analyticsPeriodQueryKey, buildPhifAnalyticsPeriod, validAnalyticsSelection } from "../phif-analytics-period.helpers";
import { QueryClient } from "@tanstack/react-query";

const identity = JSON.stringify(["metformin", "500mg", "tablet"]);
function fixture() {
  const rights = { items: true, movements: true, cost: true, revenue: true, profit: true };
  const items: any[] = [], invoices: any[] = [], rows: any[] = [];
  for (let m = 0; m < 24; m++) for (let i = 0; i < 8; i++) {
    const id = `${m}-${i}`, date = new Date(Date.UTC(2024, m, 12)).toISOString().slice(0, 10);
    invoices.push({ id, dispensing_date: date, insurance_card_number: `000${i}`, beneficiary_name: "Same name" });
    items.push({ id, phif_invoice_id: id, source_classification: i % 2 ? "phif-supplier" : "actual-supplier",
      active_ingredient: "Metformin", strength: "500MG", brand: "Brand", quantity: i ? 30 : 0,
      metadata: { unit: "TAB", dosage_form: "TABLET", package_quantity: 30 }, phif_financial_fields: { total_amount: 60 } });
    rows.push({ item_id: id, revenue: 60, purchase_cost: 30, gross_margin: 30, invoice_quantity_unit: "TAB", invoice_dosage_form: "TABLET" });
  }
  // Older explicit evidence must still resolve a recent missing form identically.
  items.at(-1).metadata = { package_quantity: 30 };
  return { items, invoices, rows, stocks: [], pharmacyId: "tiryaq", access: { actual: rights, phif: rights } as AnalyticsAccess,
    settings: [{ pharmacy_id: "tiryaq", item_identity: identity, units_per_box: 30, base_unit: "tablet" as const, version: 1 }],
    canExport: true, filters: analyticsSearchSchema.parse({ month: "2025-12" }) };
}

describe("shared PHIF Analytics period", () => {
  it("matches all six corrected old results, including historical identity evidence and card unions", () => {
    const input = fixture(), before = JSON.stringify(input);
    const oldStart = performance.now();
    const old = analyticsMonths("2025-12").map(month => buildItemsAnalytics({ ...input, filters: analyticsSearchSchema.parse({ month }) }));
    const oldMs = performance.now() - oldStart;
    const newStart = performance.now(), result = buildPhifAnalyticsPeriod(input, "2025-12"), newMs = performance.now() - newStart;
    result.months.forEach((month, index) => {
      expect(month.status).toBe("success");
      if (month.status === "success") expect(aggregatePhifAnalytics(month.movements)).toEqual(aggregatePhifAnalytics(old[index].movements));
    });
    expect(JSON.stringify(input)).toBe(before);
    expect(result.months.flatMap(m => m.status === "success" ? m.movements : [])).toHaveLength(48);
    console.info("analytics_period_local_measurement", JSON.stringify({ fixtureItems: input.items.length, oldIdentityItemVisits: input.items.length * 6,
      newIdentityItemVisits: input.items.length, oldReportBuilds: 6, newReportBuilds: 1,
      oldPayloadBytes: Buffer.byteLength(JSON.stringify(old)), newPayloadBytes: Buffer.byteLength(JSON.stringify(result)), oldMs, newMs }));
  });
  it("uses calendar boundaries including leap years and preserves full daily axis on failure", () => {
    expect(analyticsMonths("2026-02")).toEqual(["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
    const empty = dailyPhifAnalytics([], "2024-02");
    expect(empty).toHaveLength(29); expect(empty.every(d => d.status === "no_dispensing" && d.sup === 0)).toBe(true);
    const failed = dailyPhifAnalytics([], "2024-02", false);
    expect(failed).toHaveLength(29); expect(failed.every(d => d.status === "unavailable" && d.sup === null && d.act === null)).toBe(true);
  });
  it("keeps a failed month null and suppresses growth only when its required pair is unavailable", () => {
    const data = buildPhifAnalyticsPeriod(fixture(), "2025-12"), months = analyticsMonths("2025-12");
    for (const entry of data.months) if (entry.status === "success") {
      entry.movements = entry.movements.map(r => ({ ...r, boxes: 1, boxSize: 30, baseUnit: "tablet", boxIssue: null }));
    }
    data.months[1] = { month: months[1], status: "error", message: "test" };
    const comparison = analyticsComparison(months, data, "all", "all");
    expect(comparison.months[1]).toMatchObject({ status: "error", sup: null, act: null });
    expect(comparison.months[0].status).toBe("success");
    expect(comparison.growth).not.toBeNull();
    data.months[4] = { month: months[4], status: "error", message: "test" };
    expect(analyticsComparison(months, data, "all", "all").growth).toBeNull();
    expect(analyticsComparison(months, undefined, "all", "all").months.every(m => m.status === "loading" && m.sup === null)).toBe(true);
    expect(analyticsComparison(months, data, "all", "all", true).months.every(m => m.status === "error" && m.sup === null)).toBe(true);
    data.months.pop();
    expect(analyticsComparison(months, data, "all", "all").months[5]).toMatchObject({ status: "error", sup: null });
  });
  it("uses the existing scoped invalidation prefix for the period cache", async () => {
    const client = new QueryClient(), key = analyticsPeriodQueryKey("tiryaq", "2025-12"), other = analyticsPeriodQueryKey("andalus", "2025-12");
    try {
      client.setQueryData(key, {}); client.setQueryData(other, {});
      await client.invalidateQueries({ queryKey: ["items_analytics", "tiryaq"], refetchType: "none" });
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    } finally { client.clear(); }
  });
  it("resets only missing selections and preserves source filtering, unknowns and zero", () => {
    const data = buildPhifAnalyticsPeriod(fixture(), "2025-12"), last = data.months[5];
    if (last.status !== "success") throw new Error("fixture");
    expect(validAnalyticsSelection(identity, last.movements)).toBe(identity);
    expect(validAnalyticsSelection("other", last.movements)).toBe("all");
    expect(validAnalyticsSelection(identity, [])).toBe("all");
    last.movements[0].boxes = null;
    const daily = dailyPhifAnalytics(last.movements, "2025-12");
    expect(daily[11].status).toBe("incomplete"); expect(daily[0].status).toBe("no_dispensing");
    const comparison = analyticsComparison(analyticsMonths("2025-12"), data, "all", "all");
    expect(comparison.months[5].aggregate?.total.value).toBeNull(); expect(comparison.growth).toBeNull();
    expect(analyticsComparison(analyticsMonths("2025-12"), data, "phif", identity).months[5].rows?.every(r => r.source === "phif")).toBe(true);
  });
});
