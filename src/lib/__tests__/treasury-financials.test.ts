import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { treasuryReportForRole } from "@/lib/treasury-financials.helpers";

function report() {
  const actual = { source: "actual", known_profit: 31.125, gross_margin: 31.125 };
  const phif = { source: "phif", known_profit: 122.875, gross_margin: 122.875 };
  return {
    summary: { total_revenue: 300, known_cost: 146, known_profit: 154, coverage_ratio: 1 },
    source_split: {
      actual: { revenue: 100, known_cost: 68.875, known_profit: 31.125 },
      phif: { revenue: 200, known_cost: 77.125, known_profit: 122.875 },
    },
    top_profit_items: [actual, phif], top_profit_beneficiaries: [{ known_profit: 154 }],
    top_revenue_items: [actual], top_dispensed_items: [phif], top_revenue_beneficiaries: [{ known_profit: 154 }],
    invoices: [{ known_profit: 154, revenue: 300, items: [actual, phif] }],
  };
}

describe("treasury manager financial cards", () => {
  it("reuses existing profits and calculates claim as PHIF revenue plus Actual profit, not PHIF profit", () => {
    const result = treasuryReportForRole(report(), "admin", { actual: true, phif: true });
    expect(result.treasury_financials.actual).toEqual({ profit: 31.125, complete: true });
    expect(result.treasury_financials.phif).toEqual({ profit: 122.875, complete: true });
    expect(result.treasury_financials.claim).toEqual({ value: 231.125, complete: true });
    expect(result.summary.known_profit).toBe(154);
  });

  it("never labels partial Actual profit or a claim as complete", () => {
    const result = treasuryReportForRole(report(), "admin", { actual: false, phif: true });
    expect(result.treasury_financials.actual).toEqual({ profit: null, complete: false });
    expect(result.treasury_financials.phif.profit).toBe(122.875);
    expect(result.treasury_financials.claim).toEqual({ value: null, complete: false });
  });

  it("marks claim incomplete when PHIF costs are missing, even if Actual profit is known", () => {
    const result = treasuryReportForRole(report(), "admin", { actual: true, phif: false });
    expect(result.treasury_financials.actual.profit).toBe(31.125);
    expect(result.treasury_financials.phif.profit).toBeNull();
    expect(result.treasury_financials.claim.value).toBeNull();
    expect(result.treasury_financials.claim.complete).toBe(false);
  });

  it("uses the already filtered source totals and preserves zero or negative known profit", () => {
    const filtered = report();
    filtered.source_split.phif = { revenue: 0, known_cost: 0, known_profit: 0 };
    filtered.source_split.actual.known_profit = -5;
    expect(treasuryReportForRole(filtered, "admin", { actual: true, phif: true }).treasury_financials.claim.value).toBe(-5);
    filtered.source_split.actual = { revenue: 0, known_cost: 0, known_profit: 0 };
    expect(treasuryReportForRole(filtered, "admin", { actual: true, phif: true }).treasury_financials.claim).toEqual({ value: 0, complete: true });
    filtered.source_split.phif = { revenue: 200, known_cost: 77.125, known_profit: 122.875 };
    expect(treasuryReportForRole(filtered, "admin", { actual: true, phif: true }).treasury_financials.claim.value).toBe(200);
  });

  it("removes claim and every treasury profit field for employees, legacy or missing roles server-side", () => {
    for (const role of ["employee", "legacy", undefined, null, "", { role: "admin", actual_profit_read: true }]) {
      const result = treasuryReportForRole(report(), role, { actual: true, phif: true });
      expect(result.treasury_financials).toBeNull();
      expect(result.summary.known_profit).toBeNull();
      expect(result.source_split.actual.known_profit).toBeNull();
      expect(result.source_split.phif.known_profit).toBeNull();
      expect(result.top_profit_items).toEqual([]);
      expect(result.top_profit_beneficiaries).toEqual([]);
      for (const row of [...result.top_revenue_items, ...result.top_dispensed_items, ...result.top_revenue_beneficiaries]) expect(row.known_profit).toBeNull();
      expect(result.invoices[0].known_profit).toBeNull();
      expect(result.invoices[0].items.every((row: any) => row.gross_margin === null && row.profit_hidden)).toBe(true);
      expect(JSON.stringify(result)).not.toContain("31.125");
      expect(JSON.stringify(result)).not.toContain("122.875");
      expect(result.source_split.phif.revenue).toBe(200);
      expect(result.summary.known_cost).toBe(146);
    }
  });

  it("does not change the report used by other pages or alter stored/sale data", () => {
    const original = report();
    const before = JSON.stringify(original);
    treasuryReportForRole(original, "employee", { actual: true, phif: true });
    treasuryReportForRole(original, "admin", { actual: false, phif: true });
    expect(JSON.stringify(original)).toBe(before);
  });

  it("binds the treasury API to the server session role and preserves scoped reads and existing cost completeness", () => {
    const server = readFileSync("src/lib/management.functions.ts", "utf8");
    const route = readFileSync("src/routes/management.treasury.tsx", "utf8");
    expect(server).toContain('export const getTreasuryReport = createServerFn({ method: "POST" })');
    expect(server).toContain(".handler(({ data }) => buildProfitAnalysisReport(data, true))");
    expect(server).toContain(".handler(({ data }) => buildProfitAnalysisReport(data))");
    expect(server).toContain("treasuryReportForRole(report, session.session.data.user_role");
    expect(server).toContain("loadProfitRows(supabaseAdmin, pharmacy_id, data, access)");
    expect(server).toContain('if (treasury && session.session.data.user_role !== "admin")');
    expect(server).toContain("access.actual.profit = false");
    expect(server).toContain("access.phif.profit = false");
    expect(server).toContain('.filter(row => row.source === "actual").every(isFinanciallyCompleteRow)');
    expect(server).toContain('.filter(row => row.source === "phif").every(isFinanciallyCompleteRow)');
    expect(route).toContain("useServerFn(getTreasuryReport)");
    expect(route).toContain('label="مكسب Actual"');
    expect(route).toContain('label="مكسب PHIF Supplier"');
    expect(route).toContain('label="قيمة المطالبة"');
    expect(route).toContain("غير مكتملة");
    expect(route).toContain("data?.treasury_financials &&");
  });
});
