import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loadReportSettingScope } from "../report-setting-scope.server";
import {
  reportSettingRequest,
  refreshReportAfterSettingSave,
} from "../report-setting-save.helpers";
import { analyticsSearchSchema, buildItemsAnalytics } from "../items-analytics.helpers";

const identity = JSON.stringify(["atorvastatin", "40mg", "tablet"]);
const item = (id: string, patch: any = {}) => ({
  id,
  phif_invoice_id: `invoice-${id}`,
  brand: "Atorvastatin",
  active_ingredient: "ATORVASTATIN",
  strength: "40MG",
  source_classification: "phif-supplier",
  quantity: 30,
  metadata: { dosage_form: "TAB" },
  phif_financial_fields: { total_amount: 60 },
  invoice: { pharmacy_id: "tiryaq" },
  ...patch,
});

function database(items: any[], stocks: any[] = [], settings: any[] = []) {
  const calls: { table: string; fields?: string; filters: [string, any][] }[] = [];
  const db = {
    from(table: string) {
      const call = { table, fields: "", filters: [] as [string, any][] };
      calls.push(call);
      let rows =
        table === "phif_invoice_items"
          ? items
          : table === "phif_stock_items"
            ? stocks
            : table === "phif_report_box_settings"
              ? settings
              : [];
      const query = {
        select(fields: string) {
          call.fields = fields;
          return query;
        },
        eq(key: string, value: any) {
          call.filters.push([key, value]);
          rows = rows.filter((r) =>
            key === "invoice.pharmacy_id" ? r.invoice?.pharmacy_id === value : r[key] === value,
          );
          return query;
        },
        in(key: string, values: any[]) {
          rows = rows.filter((r) => values.includes(r[key]));
          return query;
        },
        not() {
          return query;
        },
        order() {
          return query;
        },
        async limit(count: number) {
          return { data: rows.slice(0, count), error: null };
        },
        async range(from: number, to: number) {
          return { data: rows.slice(from, to + 1), count: rows.length, error: null };
        },
      };
      return query;
    },
  };
  return { db, calls };
}

describe("report setting save performance and safety", () => {
  it("verifies current scientific scope without loading patient invoices or calculating profit", async () => {
    const { db, calls } = database([
      item("own"),
      item("other", { invoice: { pharmacy_id: "andalus" } }),
      item("wrong-dose", { strength: "20MG" }),
      item("wrong-form", { metadata: { dosage_form: "CAP" } }),
    ]);
    const scope = await loadReportSettingScope(db, "tiryaq", identity);
    expect(scope.items.map((i) => i.id)).toEqual(["own"]);
    expect(calls.map((c) => c.table)).toEqual(["phif_invoice_items"]);
    expect(calls[0].filters).toContainEqual(["invoice.pharmacy_id", "tiryaq"]);
    expect(calls[0].fields).not.toContain("beneficiary");
    expect(calls[0].fields).not.toContain("quantity,");
  });

  it("uses zero-balance current stock and pharmacy references only when form evidence is absent", async () => {
    const { db, calls } = database(
      [item("a", { metadata: {} })],
      [
        {
          id: "current",
          pharmacy_id: "tiryaq",
          is_current: true,
          active_ingredient: "ATORVASTATIN",
          strength: "40MG",
          dosage_unit: "TABS",
          stock_quantity: 0,
        },
        {
          id: "foreign",
          pharmacy_id: "andalus",
          is_current: true,
          active_ingredient: "ATORVASTATIN",
          strength: "40MG",
          dosage_unit: "CAP",
        },
      ],
    );
    expect((await loadReportSettingScope(db, "tiryaq", identity)).items).toHaveLength(1);
    expect(calls.filter((c) => c.table === "phif_stock_items")[0].filters).toContainEqual([
      "pharmacy_id",
      "tiryaq",
    ]);
    expect(calls.some((c) => c.table === "phif_invoices")).toBe(false);
  });

  it("rejects forged identities and different strengths/forms without relaxing RPC checks", async () => {
    const { db, calls } = database([item("a", { metadata: { dosage_form: "CAP" } })]);
    await expect(loadReportSettingScope(db, "tiryaq", identity)).rejects.toThrow("الشكل الدوائي");
    await expect(
      loadReportSettingScope(db, "tiryaq", '["atorvastatin","20mg","tablet"]'),
    ).rejects.toThrow();
    const before = calls.length;
    await expect(loadReportSettingScope(db, "tiryaq", '["fake"]')).rejects.toThrow();
    expect(calls).toHaveLength(before);
    const source = readFileSync("src/lib/items-analytics.functions.ts", "utf8");
    expect(source).toContain('user.user_role !== "admin"');
    expect(source).toContain("p_expected_version: data.version");
    expect(source).toContain("relevant.get(exception.invoiceId) !== 1");
    expect(source).toContain("database_rpc_roundtrip");
  });

  it("reuses a persisted definition for saving settings on previously incomplete Supplier items", async () => {
    const setting = {
      id: "saved-definition",
      pharmacy_id: "tiryaq",
      item_identity: identity,
      base_unit: "tablet",
      units_per_box: 30,
      version: 1,
    };
    const own = item("own", { metadata: {} });
    const other = item("other", { metadata: {}, invoice: { pharmacy_id: "andalus" } });
    const { db, calls } = database([own, other], [], [setting]);
    const before = JSON.stringify([own, other, setting]);
    const scope = await loadReportSettingScope(db, "tiryaq", identity);
    expect(scope.items.map((i) => i.id)).toEqual(["own"]);
    expect(
      calls
        .filter((c) => c.table === "phif_report_box_settings")
        .every((c) =>
          c.filters.some(([field, value]) => field === "pharmacy_id" && value === "tiryaq"),
        ),
    ).toBe(true);
    expect(JSON.stringify([own, other, setting])).toBe(before);
    expect(scope.items[0].metadata).toEqual({});
  });

  it("finishes a confirmed save before a slow report refresh and refetches only the active report", async () => {
    let completeRefresh!: () => void;
    const refresh = new Promise<void>((resolve) => {
      completeRefresh = resolve;
    });
    const reads: any[] = [],
      failures: string[] = [];
    const client: any = {
      invalidateQueries: async (options: any) => {
        reads.push(options);
      },
      refetchQueries: (options: any) => {
        reads.push(options);
        return refresh;
      },
    };
    const saved = await reportSettingRequest(async () => ({ version: 2 }));
    expect(saved.version).toBe(2);
    const key = ["items_analytics", "tiryaq-manager", "consumption", { month: "2026-10" }];
    expect(
      refreshReportAfterSettingSave(client, key, () => failures.push("refresh")),
    ).toBeUndefined();
    await Promise.resolve();
    expect(reads).toContainEqual({ queryKey: ["items_analytics"], refetchType: "none" });
    expect(reads).toContainEqual({ queryKey: key, exact: true, type: "active" });
    expect(failures).toEqual([]);
    completeRefresh();
    await expect(
      reportSettingRequest(async () => {
        throw new Error("version conflict");
      }),
    ).rejects.toThrow("version conflict");
  });

  it("reports a secondary refresh failure separately from an already successful save", async () => {
    let reportFailure!: () => void;
    const reported = new Promise<void>((resolve) => {
      reportFailure = resolve;
    });
    const client: any = {
      invalidateQueries: async () => {},
      refetchQueries: async () => {
        throw new Error("offline");
      },
    };
    refreshReportAfterSettingSave(client, ["items_analytics", "current"], reportFailure);
    await reported;
    expect(true).toBe(true);
  });

  it("benchmarks a high-history product without changing any prices or quantities", async () => {
    const items = Array.from({ length: 5000 }, (_, i) =>
      item(`i${i}`, i < 120 ? {} : { active_ingredient: `Other ${i % 100}` }),
    );
    const financial = items.map((i) => ({
      item_id: i.id,
      revenue: 60,
      purchase_cost: 24,
      gross_margin: 36,
    }));
    const invoices = items.map((i) => ({
      id: i.phif_invoice_id,
      invoice_number: i.id,
      dispensing_date: "2026-10-22",
      insurance_card_number: "000012",
    }));
    const access = { items: true, movements: true, revenue: true, cost: true, profit: true };
    const original = JSON.stringify(items);
    const start = performance.now();
    const old = buildItemsAnalytics({
      items,
      invoices,
      rows: financial,
      stocks: [],
      settings: [],
      access: { phif: access, actual: access },
      filters: analyticsSearchSchema.parse({ month: "all" }),
    });
    const oldMs = performance.now() - start;
    const { db, calls } = database(items);
    const after = performance.now();
    const scope = await loadReportSettingScope(db, "tiryaq", identity);
    const newMs = performance.now() - after;
    expect(scope.items).toHaveLength(120);
    expect(old.items.some((i) => i.id === scope.id)).toBe(true);
    expect(calls.every((c) => c.table === "phif_invoice_items")).toBe(true);
    expect(JSON.stringify(items)).toBe(original);
    console.info("report_setting_local_benchmark", {
      historical_items: 5000,
      target_items: 120,
      old_report_validation_ms: Math.round(oldMs),
      operational_validation_ms: Math.round(newMs),
      network: "in-memory; not production save latency",
    });
  });
});
