import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ allowed: false, pharmacy: "tiryaq", calls: [] as string[], dataset: {} as any }));
vi.mock("@tanstack/react-start", () => ({
  createServerOnlyFn: (fn: any) => fn,
  createServerFn: () => ({ inputValidator: (validate: any) => ({ handler: (fn: any) =>
    (input: any) => fn({ data: validate(input.data) }) }) }),
}));
vi.mock("../management.functions", () => ({
  loadItemAnalyticsDataset: async (authorize: any) => {
    const rights = { items: true, movements: true, revenue: true, cost: true, profit: true };
    authorize({ session: { data: { user_id: "employee", user_role: "employee",
      user_permissions: { reports_export: state.allowed } } } }, { actual: rights, phif: rights });
    state.calls.push("authorized-data-read");
    return { ...state.dataset, session: { pharmacy_id: state.pharmacy }, admin: {} };
  },
}));
vi.mock("../report-box-settings.server", () => ({
  loadReportBoxSettings: async (_db: unknown, pharmacy: string) => {
    state.calls.push(`settings:${pharmacy}`);
    return { settings: [], available: true, supplierUnitsAvailable: true };
  },
}));
import { exportPhifAnalytics, getPhifAnalyticsPeriod } from "../items-analytics.functions";

beforeEach(() => {
  state.allowed = false; state.pharmacy = "tiryaq"; state.calls = [];
  state.dataset = {
    items: [{ id: "item", phif_invoice_id: "invoice", source_classification: "phif-supplier",
      active_ingredient: "Metformin", strength: "500MG", brand: "Brand", quantity: 30,
      metadata: { unit: "TAB", dosage_form: "TABLET" }, phif_financial_fields: { total_amount: 60 } }],
    invoices: [{ id: "invoice", dispensing_date: "2026-09-10", insurance_card_number: "000123", beneficiary_name: "Test" }],
    rows: [{ item_id: "item", revenue: 60, purchase_cost: 30, gross_margin: 30 }], stocks: [],
  };
});
const input = () => ({ data: { month: "2026-09", source: "all", identity: "all" } } as any);
describe("server-authorized Analytics export", () => {
  it("loads the six-month period once using the verified pharmacy and returns no financial fields", async () => {
    const result = await getPhifAnalyticsPeriod({ data: { month: "2026-09", pharmacyId: "forged" } } as any);
    expect(state.calls).toEqual(["authorized-data-read", "settings:tiryaq"]);
    expect(result.months).toHaveLength(6);
    expect(result.months[5]).toMatchObject({ status: "success", canExport: false });
    expect(JSON.stringify(result)).not.toMatch(/purchase_cost|gross_margin|revenue|beneficiary_name/);
  });
  it("rejects direct export requests before reading data even if client submits permission flags", async () => {
    const request = input(); Object.assign(request.data, { export: false, canExport: true, user_role: "admin" });
    await expect(exportPhifAnalytics(request)).rejects.toThrow("صلاحية");
    expect(state.calls).toEqual([]);
  });
  it("uses verified session pharmacy rather than a client-supplied pharmacy", async () => {
    state.allowed = true;
    const request = input(); request.data.pharmacyId = "another-pharmacy";
    const result = await exportPhifAnalytics(request);
    expect(state.calls).toEqual(["authorized-data-read", "settings:tiryaq"]);
    expect(result.summary["بنود الصرف"]).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/purchase_cost|gross_margin|000123|beneficiary_name/);
  });
  it("honors month, source and exact identity, and rechecks permissions on every call", async () => {
    state.allowed = true;
    expect((await exportPhifAnalytics(input())).rows).toHaveLength(1);
    const otherMonth = input(); otherMonth.data.month = "2026-10";
    expect((await exportPhifAnalytics(otherMonth)).rows).toHaveLength(0);
    const otherSource = input(); otherSource.data.source = "actual";
    expect((await exportPhifAnalytics(otherSource)).rows).toHaveLength(0);
    const otherIdentity = input(); otherIdentity.data.identity = "different";
    expect((await exportPhifAnalytics(otherIdentity)).rows).toHaveLength(0);
    state.allowed = false;
    await expect(exportPhifAnalytics(input())).rejects.toThrow("صلاحية");
  });
});
