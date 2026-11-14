import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@tanstack/react-start", () => ({
  createServerOnlyFn: (fn: any) => fn,
  createServerFn: () => ({ inputValidator: (validate: any) => ({ handler: (fn: any) =>
    (input: any) => fn({ data: validate(input.data) }) }) }),
}));
const state = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, role: "admin", calls: [] as any[] }));
const actor = "11111111-1111-4111-8111-111111111111";
const invoice = "22222222-2222-4222-8222-222222222222";
const line = "33333333-3333-4333-8333-333333333333";
vi.mock("../user-management.functions", () => ({ requireTiryaqPermission: async () => ({
  pharmacy_id: "own", session: { data: { user_id: "11111111-1111-4111-8111-111111111111", user_role: state.role } },
}) }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from(table: string) {
    let rows = state.tables[table] || [];
    const q: any = { select: () => q, order: () => q, not: () => q,
      eq: (k: string, v: any) => { rows = rows.filter(r => (k === "invoice.pharmacy_id" ? r.invoice?.pharmacy_id : r[k]) === v); return q; },
      in: (k: string, values: any[]) => { rows = rows.filter(r => values.includes(r[k])); return q; },
      maybeSingle: async () => ({ data: rows[0] || null, error: null }),
      limit: async (n: number) => ({ data: rows.slice(0, n), error: null }),
      range: async (a: number, b: number) => ({ data: rows.slice(a, b + 1), count: rows.length, error: null }),
    }; return q;
  },
  async rpc(name: string, args: any) {
    state.calls.push({ name, args });
    const settings = state.tables.phif_report_box_settings;
    const old = settings.find(s => s.pharmacy_id === args.p_pharmacy_id && s.item_identity === args.p_identity);
    if ((old?.version || 0) !== args.p_expected_version) return { data: null, error: { code: "P0001" } };
    const saved = { ...(old || { id: "44444444-4444-4444-8444-444444444444", pharmacy_id: args.p_pharmacy_id,
      item_identity: args.p_identity, supplier_quantity_unit: null, supplier_unit_exceptions: {} }),
      ...(name === "set_phif_report_box_setting" ? { units_per_box: args.p_units_per_box, base_unit: args.p_base_unit }
        : { supplier_quantity_unit: args.p_unit, supplier_unit_exceptions: args.p_exceptions }),
      version: (old?.version || 0) + 1 };
    if (old) settings.splice(settings.indexOf(old), 1, saved); else settings.push(saved);
    return { data: saved, error: null };
  },
} }));
import { saveReportBoxSetting, saveReportSupplierUnit } from "../items-analytics.functions";
import { scientificReportIdentity } from "../report-medication-evidence.helpers";
import { buildItemsAnalytics, analyticsSearchSchema } from "../items-analytics.helpers";

beforeEach(() => {
  state.role = "admin"; state.calls = [];
  state.tables = {
    pharmacy_users: [{ id: actor, pharmacy_id: "own", role: "admin", is_active: true }],
    phif_report_box_settings: [],
    phif_invoice_items: [{ id: line, phif_invoice_id: invoice, source_classification: "phif-supplier",
      active_ingredient: "INSULIN(HUMAN RECOMBINANT RAPID ACTING ANALOGUE)", strength: "100IU", quantity: 2,
      metadata: {}, phif_financial_fields: { total_amount: 60, internal_purchase_cost_value: 20 }, invoice: { pharmacy_id: "own" } }],
  };
});
const request = () => ({ identity: scientificReportIdentity(state.tables.phif_invoice_items[0], "pen").key,
  unitsPerBox: 1, baseUnit: "pen" as const, version: 0, reviewItemId: line });

it("saves the definition then separately confirms the unit and reuses it in another month", async () => {
  const data = request();
  const original = JSON.stringify(state.tables.phif_invoice_items);
  const saved = await saveReportBoxSetting({ data });
  expect(saved).toMatchObject({ version: 1, units_per_box: 1, supplier_quantity_unit: null });
  const confirmed = await saveReportSupplierUnit({ data: { identity: data.identity, unit: "pen", exceptions: [], version: 1 } });
  expect(confirmed).toMatchObject({ version: 2, supplier_quantity_unit: "pen" });
  const source = state.tables.phif_invoice_items[0];
  const items = [source, { ...source, id: "next", phif_invoice_id: "next", active_ingredient: "INSULIN (HUMAN RECOMBINANT RAPID ACTING ANALOGUE)" }];
  const rights = { items: true, movements: true, revenue: true, cost: true, profit: true };
  for (const month of ["2026-10", "2026-11"]) {
    const report = buildItemsAnalytics({ pharmacyId: "own", items, settings: structuredClone(state.tables.phif_report_box_settings),
      invoices: items.map((i, n) => ({ id: i.phif_invoice_id, dispensing_date: `2026-${n ? "11" : "10"}-01` })),
      rows: items.map(i => ({ item_id: i.id, revenue: 60, purchase_cost: 20, gross_margin: 40 })), stocks: [],
      access: { phif: rights, actual: rights }, filters: analyticsSearchSchema.parse({ month }) });
    expect(report.items[0]).toMatchObject({ boxes: 2, cost: 20, profit: 40 });
  }
  expect(JSON.stringify(state.tables.phif_invoice_items)).toBe(original);
  expect(state.tables.phif_report_box_settings).toHaveLength(1);
  expect(state.calls.every(c => c.args.p_actor_id === actor && c.args.p_pharmacy_id === "own")).toBe(true);
});

it("rejects unauthorized and revoked managers before a save RPC", async () => {
  state.role = "employee";
  await expect(saveReportBoxSetting({ data: request() })).rejects.toThrow("المدير");
  await expect(saveReportSupplierUnit({ data: { identity: request().identity, unit: "pen", exceptions: [], version: 1 } })).rejects.toThrow("مدير");
  state.role = "admin"; state.tables.pharmacy_users = [];
  await expect(saveReportBoxSetting({ data: request() })).rejects.toThrow("صلاحية المدير");
  expect(state.calls).toEqual([]);
});

it("does not replace a version, a different strength or duplicate legacy definitions", async () => {
  const data = request();
  await saveReportBoxSetting({ data });
  await expect(saveReportBoxSetting({ data })).rejects.toThrow("تعذر حفظ");
  await expect(saveReportBoxSetting({ data: { ...data, identity: data.identity.replace("100iu", "200iu") } })).rejects.toThrow("بند المراجعة");
  state.tables.phif_report_box_settings.push({ ...state.tables.phif_report_box_settings[0],
    id: "55555555-5555-4555-8555-555555555555", item_identity: data.identity.replace("insulin (", "insulin(") });
  const before = state.calls.length;
  await expect(saveReportBoxSetting({ data: { ...data, version: 1 } })).rejects.toThrow("متعارضة");
  expect(state.calls).toHaveLength(before);
});
