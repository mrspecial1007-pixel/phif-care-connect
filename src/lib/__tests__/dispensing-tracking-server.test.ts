import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  allowed: false,
  movements: true,
  stockCost: false,
  pharmacy: "p1",
  calls: [] as string[],
  dataset: {} as any,
}));
vi.mock("@tanstack/react-start", () => ({
  createServerOnlyFn: (fn: any) => fn,
  createServerFn: () => ({
    inputValidator: (validate: any) => ({
      handler: (fn: any) => async (input: any) => fn({ data: validate(input.data) }),
    }),
  }),
}));
vi.mock("../management.functions", () => ({
  loadItemAnalyticsDataset: async (authorize: any) => {
    const rights = {
      items: true,
      movements: state.movements,
      revenue: true,
      cost: true,
      profit: true,
    };
    authorize(
      {
        session: {
          data: {
            user_id: "employee",
            user_role: "employee",
            user_permissions: { reports_export: state.allowed, stock_cost_read: state.stockCost },
          },
        },
      },
      { actual: rights, phif: rights },
    );
    state.calls.push("authorized-read");
    return {
      ...state.dataset,
      session: { pharmacy_id: state.pharmacy, pharmacy_name: "Test" },
      admin: {},
    };
  },
}));
vi.mock("../report-box-settings.server", () => ({
  loadReportBoxSettings: async (_db: unknown, pharmacy: string) => {
    state.calls.push(`settings:${pharmacy}`);
    return { settings: [], available: true, supplierUnitsAvailable: true };
  },
}));
import { readDispensingTracking, exportDispensingTracking } from "../dispensing-tracking.functions";

beforeEach(() => {
  Object.assign(state, {
    allowed: false,
    movements: true,
    stockCost: false,
    pharmacy: "p1",
    calls: [],
  });
  state.dataset = {
    items: Array.from({ length: 123 }, (_, i) => ({
      id: `i${i}`,
      phif_invoice_id: `v${i}`,
      source_classification: i % 2 ? "actual-supplier" : "phif-supplier",
      active_ingredient: "Metformin",
      strength: "500MG",
      brand: "Brand",
      supplier: "Company",
      quantity: 30,
      metadata: { unit: "TAB", dosage_form: "TABLET", package_quantity: 30 },
    })),
    invoices: Array.from({ length: 123 }, (_, i) => ({
      id: `v${i}`,
      invoice_number: `000${i}`,
      dispensing_date: i % 2 ? "2026-11-01" : "2020-01-01",
      insurance_card_number: "000123",
    })),
    rows: Array.from({ length: 123 }, (_, i) => ({
      item_id: `i${i}`,
      revenue: 60,
      purchase_cost: 24,
      gross_margin: 36,
    })),
    stocks: [],
  };
});
describe("pharmacy-scoped dispensing server and export", () => {
  it("reads all history, paginates only screen rows and exports all selected rows with the same totals", async () => {
    const catalog = await readDispensingTracking({ data: {} });
    const filters = { item: catalog.catalog[0].id };
    const before = JSON.stringify(state.dataset);
    const screen = await readDispensingTracking({ data: filters });
    expect(screen.movements).toHaveLength(50);
    expect(screen.totalMovements).toBe(123);
    expect(screen.summary.first).toBe("2020-01-01");
    state.allowed = true;
    const full = await exportDispensingTracking({ data: { filters, revision: screen.revision } });
    expect(full.movements).toHaveLength(123);
    expect(full.summary).toEqual(screen.summary);
    const last = await readDispensingTracking({ data: { ...filters, page: 3 } });
    expect(last.movements).toHaveLength(23);
    expect(
      new Set(
        [
          ...screen.movements,
          ...(await readDispensingTracking({ data: { ...filters, page: 2 } })).movements,
          ...last.movements,
        ].map((r) => r.id),
      ).size,
    ).toBe(123);
    expect(JSON.stringify(state.dataset)).toBe(before);
    expect(state.calls.every((c) => c === "authorized-read" || c === "settings:p1")).toBe(true);
  });
  it("requires export and movements permission before reading any data", async () => {
    await expect(
      exportDispensingTracking({ data: { filters: {}, revision: "x".repeat(64) } }),
    ).rejects.toThrow("صلاحية تصدير");
    expect(state.calls).toEqual([]);
    state.movements = false;
    await expect(readDispensingTracking({ data: {} })).rejects.toThrow("صلاحية حركات");
    expect(state.calls).toEqual([]);
  });
  it("rejects client-supplied pharmacy and permission flags", async () => {
    await expect(
      readDispensingTracking({ data: { pharmacyId: "other" } } as any),
    ).rejects.toThrow();
    await expect(
      exportDispensingTracking({
        data: { filters: { canExport: true }, revision: "x".repeat(64) },
      } as any),
    ).rejects.toThrow();
    expect(state.calls).toEqual([]);
  });
  it("does not leak Actual stock costs through screen or official exports", async () => {
    state.allowed = true;
    const catalog = await readDispensingTracking({ data: {} });
    const filters = { item: catalog.catalog[0].id, source: "actual" as const };
    const screen = await readDispensingTracking({ data: filters });
    const full = await exportDispensingTracking({ data: { filters, revision: screen.revision } });
    expect(full.movements.every((r) => r.cost === null && r.profit === null)).toBe(true);
    expect(full.summary.cost).toBeNull();
    state.stockCost = true;
    const authorized = await readDispensingTracking({ data: filters });
    expect(authorized.summary.cost).toBe(61 * 24);
  });
  it("refuses stale export after a saved movement changes", async () => {
    state.allowed = true;
    const catalog = await readDispensingTracking({ data: {} });
    const filters = { item: catalog.catalog[0].id };
    const screen = await readDispensingTracking({ data: filters });
    state.dataset.items[0].quantity = 60;
    await expect(
      exportDispensingTracking({ data: { filters, revision: screen.revision } }),
    ).rejects.toThrow("تغيرت نتائج");
  });
  it("fails closed on duplicated or unlinked items rather than claiming a complete report", async () => {
    state.dataset.items.push({ ...state.dataset.items[0] });
    await expect(readDispensingTracking({ data: {} })).rejects.toThrow("تكررت");
    state.dataset.items.pop();
    state.dataset.invoices = [];
    await expect(readDispensingTracking({ data: {} })).rejects.toThrow("تضمين بعض");
  });
});
