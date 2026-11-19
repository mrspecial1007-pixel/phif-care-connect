import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  calls: [] as any[],
  fail: false,
}));
vi.mock("../pharmacy-session.server", () => ({
  requirePharmacySession: async () => ({
    pharmacy_id: "p1",
    pharmacy_name: "Test",
    session: { data: { user_id: "manager", user_role: "admin" } },
  }),
}));
vi.mock("../pharmacy-isolation", () => ({ TIRYAQ_PHARMACY_NAME: "Test" }));
vi.mock("../actual-units.server", () => ({
  loadActualReportDecisions: async (_db: any, pharmacy: string, items: any[]) => {
    expect(pharmacy).toBe("p1");
    return { items };
  },
}));
vi.mock("../report-medication-evidence.server", () => ({
  readReportFormReferences: async () => [],
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from(table: string) {
      state.calls.push(["from", table]);
      let rows = [...(state.tables[table] || [])];
      const query: any = {
        select: () => query,
        eq(field: string, value: any) {
          state.calls.push(["eq", table, field, value]);
          rows = rows.filter((r) => r[field] === value);
          return query;
        },
        in(field: string, values: any[]) {
          rows = rows.filter((r) => values.includes(r[field]));
          return query;
        },
        gte(field: string, value: string) {
          rows = rows.filter((r) => r[field] != null && r[field] >= value);
          return query;
        },
        lte(field: string, value: string) {
          rows = rows.filter((r) => r[field] != null && r[field] <= value);
          return query;
        },
        order: () => query,
        range: async (from: number, to: number) => {
          state.calls.push(["range", table, from]);
          if (state.fail && table === "phif_invoice_items" && from > 0)
            return { data: null, error: { message: "Interrupted read" }, count: null };
          return {
            data: rows.slice(from, from + Math.min(37, to - from + 1)),
            error: null,
            count: rows.length,
          };
        },
      };
      return query;
    },
  },
}));
import { loadItemAnalyticsDataset } from "../management.functions";
beforeEach(() => {
  state.calls = [];
  state.fail = false;
  state.tables = {
    phif_invoices: Array.from({ length: 1005 }, (_, i) => ({
      id: `v${i}`,
      pharmacy_id: "p1",
      dispensing_date: i === 0 ? null : i % 2 ? "2026-11-01" : "2015-01-01",
    })),
    phif_invoice_items: Array.from({ length: 1005 }, (_, i) => ({
      id: `i${i}`,
      phif_invoice_id: `v${i}`,
      source_classification: "phif-supplier",
      active_ingredient: "Medicine",
      strength: "5MG",
      quantity: 30,
      metadata: { dosage_form: "TABLET", unit: "TAB" },
      phif_financial_fields: { total_amount: 60 },
    })),
    phif_stock_items: [],
  };
  state.tables.phif_invoices.push({
    id: "foreign",
    pharmacy_id: "p2",
    dispensing_date: "2026-11-01",
  });
  state.tables.phif_invoice_items.push({
    id: "foreign-item",
    phif_invoice_id: "foreign",
    source_classification: "phif-supplier",
  });
});
describe("complete pharmacy-scoped history reads", () => {
  it("includes undated invoices and every historical page, without changing other reports or writing", async () => {
    const snapshot = JSON.stringify(state.tables);
    const result = await loadItemAnalyticsDataset(() => expect(state.calls).toHaveLength(0), {
      includeUndated: true,
    });
    expect(result.items).toHaveLength(1005);
    expect(result.invoices).toHaveLength(1005);
    expect(result.items.find((r) => r.id === "i0")).toBeDefined();
    expect(result.items.find((r) => r.id === "foreign-item")).toBeUndefined();
    expect(state.calls).toContainEqual(["eq", "phif_invoices", "pharmacy_id", "p1"]);
    expect(state.calls).toContainEqual(["range", "phif_invoices", 999]);
    expect((await loadItemAnalyticsDataset()).items).toHaveLength(1004);
    expect(JSON.stringify(state.tables)).toBe(snapshot);
  });
  it("stops on permission failure before any database reads", async () => {
    await expect(
      loadItemAnalyticsDataset(
        () => {
          throw new Error("Denied");
        },
        { includeUndated: true },
      ),
    ).rejects.toThrow("Denied");
    expect(state.calls).toHaveLength(0);
  });
  it("does not turn interrupted historical pages into a successful partial report", async () => {
    state.fail = true;
    await expect(loadItemAnalyticsDataset(undefined, { includeUndated: true })).rejects.toThrow(
      "تعذر تحميل بيانات التقرير كاملة",
    );
  });
});
