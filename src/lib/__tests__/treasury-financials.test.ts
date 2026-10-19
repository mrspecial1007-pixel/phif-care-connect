import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isTreasuryManager, treasuryFinanceAccess, treasuryReportForSession } from "@/lib/treasury-financials.helpers";
import { ANDALUS_PHARMACY_NAME, TIRYAQ_PHARMACY_NAME } from "@/lib/pharmacy-isolation";

function session(role: string | undefined = "admin", permissions: Record<string, boolean> = {}, userId?: string) {
  return { pharmacy_id: "tiryaq-test", pharmacy_name: TIRYAQ_PHARMACY_NAME, session: { data: { user_role: role, user_permissions: permissions, user_id: userId } } };
}

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
    const result = treasuryReportForSession(report(), session(), { actual: true, phif: true });
    expect(result.treasury_financials.actual).toEqual({ profit: 31.125, complete: true });
    expect(result.treasury_financials.phif).toEqual({ profit: 122.875, complete: true });
    expect(result.treasury_financials.claim).toEqual({ value: 231.125, complete: true });
    expect(result.summary.known_profit).toBe(154);
  });

  it("never labels partial Actual profit or a claim as complete", () => {
    const result = treasuryReportForSession(report(), session(), { actual: false, phif: true });
    expect(result.treasury_financials.actual).toEqual({ profit: null, complete: false });
    expect(result.treasury_financials.phif.profit).toBe(122.875);
    expect(result.treasury_financials.claim).toEqual({ value: null, complete: false });
  });

  it("marks claim incomplete when PHIF costs are missing, even if Actual profit is known", () => {
    const result = treasuryReportForSession(report(), session(), { actual: true, phif: false });
    expect(result.treasury_financials.actual.profit).toBe(31.125);
    expect(result.treasury_financials.phif.profit).toBeNull();
    expect(result.treasury_financials.claim.value).toBeNull();
    expect(result.treasury_financials.claim.complete).toBe(false);
  });

  it("uses the already filtered source totals and preserves zero or negative known profit", () => {
    const filtered = report();
    filtered.source_split.phif = { revenue: 0, known_cost: 0, known_profit: 0 };
    filtered.source_split.actual.known_profit = -5;
    expect(treasuryReportForSession(filtered, session(), { actual: true, phif: true }).treasury_financials.claim.value).toBe(-5);
    filtered.source_split.actual = { revenue: 0, known_cost: 0, known_profit: 0 };
    expect(treasuryReportForSession(filtered, session(), { actual: true, phif: true }).treasury_financials.claim).toEqual({ value: 0, complete: true });
    filtered.source_split.phif = { revenue: 200, known_cost: 77.125, known_profit: 122.875 };
    expect(treasuryReportForSession(filtered, session(), { actual: true, phif: true }).treasury_financials.claim.value).toBe(200);
  });

  it("removes claim and every treasury profit field for employees and unauthorized contexts server-side", () => {
    const denied = [
      session("employee"),
      session("employee", { users_manage: true, actual_profit_read: true, phif_profit_read: true }),
      session("legacy"), session("unknown"), session("", {}, "employee-test"),
      { ...session(), pharmacy_name: ANDALUS_PHARMACY_NAME },
      { ...session("legacy", { users_manage: true }), pharmacy_name: ANDALUS_PHARMACY_NAME },
      { ...session(), pharmacy_id: "" }, null, undefined,
    ];
    for (const context of denied) {
      const result = treasuryReportForSession(report(), context, { actual: true, phif: true });
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
    treasuryReportForSession(original, session("employee"), { actual: true, phif: true });
    treasuryReportForSession(original, session(), { actual: false, phif: true });
    expect(JSON.stringify(original)).toBe(before);
  });

  it("binds the treasury API to the server session role and preserves scoped reads and existing cost completeness", () => {
    const server = readFileSync("src/lib/management.functions.ts", "utf8");
    const route = readFileSync("src/routes/management.treasury.tsx", "utf8");
    expect(server).toContain('export const getTreasuryReport = createServerFn({ method: "POST" })');
    expect(server).toContain(".handler(({ data }) => buildProfitAnalysisReport(data, true))");
    expect(server).toContain(".handler(({ data }) => buildProfitAnalysisReport(data))");
    expect(server).toContain("treasuryReportForSession(report, session,");
    expect(server).toContain("loadProfitRows(supabaseAdmin, pharmacy_id, data, access)");
    expect(server).toContain('await requireTiryaqPermission("reports_read")');
    expect(server).toContain("treasury ? treasuryFinanceAccess(session, financeAccess(session)) : financeAccess(session)");
    expect(server).toContain('.filter(row => row.source === "actual").every(isFinanciallyCompleteRow)');
    expect(server).toContain('.filter(row => row.source === "phif").every(isFinanciallyCompleteRow)');
    expect(route).toContain("useServerFn(getTreasuryReport)");
    expect(route).toContain('label="مكسب Actual"');
    expect(route).toContain('label="مكسب PHIF Supplier"');
    expect(route).toContain('label="قيمة المطالبة"');
    expect(route).toContain("غير مكتملة");
    expect(route).toContain("data?.treasury_financials &&");
  });

  it("recognizes the existing legacy manager and older authenticated pharmacy PIN context", () => {
    const oldPin = session();
    oldPin.session.data.user_role = undefined;
    for (const context of [session("legacy", { users_manage: true }), oldPin]) {
      expect(isTreasuryManager(context)).toBe(true);
      const result = treasuryReportForSession(report(), context, { actual: true, phif: true });
      expect(result.summary.known_profit).toBe(154);
      expect(result.treasury_financials.actual.profit).toBe(31.125);
      expect(result.treasury_financials.phif.profit).toBe(122.875);
      expect(result.treasury_financials.claim.value).toBe(231.125);
    }
  });

  it("preserves manager read fields before aggregation but never grants employee profits or write permissions", () => {
    const source = { items: false, movements: false, revenue: false, cost: false, profit: false, purchasePriceWrite: false };
    const access = { actual: { ...source }, phif: { ...source } };
    const oldPin = session();
    oldPin.session.data.user_role = undefined;
    for (const context of [session(), session("legacy", { users_manage: true }), oldPin]) {
      const allowed = treasuryFinanceAccess(context, access);
      for (const result of [allowed.actual, allowed.phif]) {
        expect(result).toEqual({ items: true, movements: true, revenue: true, cost: true, profit: true, purchasePriceWrite: false });
      }
    }
    const employeeAccess = { actual: { ...source, items: true, profit: true }, phif: { ...source, revenue: true, profit: true } };
    const employee = treasuryFinanceAccess(session("employee", { users_manage: true }), employeeAccess);
    expect(employee.actual).toEqual({ ...employeeAccess.actual, profit: false });
    expect(employee.phif).toEqual({ ...employeeAccess.phif, profit: false });
    expect(access.actual.profit).toBe(false);
    expect(employeeAccess.actual.profit).toBe(true);
  });
});
