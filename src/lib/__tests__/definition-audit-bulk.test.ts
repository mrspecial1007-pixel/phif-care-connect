import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyAuditSnapshot, type AuditSnapshot } from "../definition-audit.helpers";
import { planBulkSupplierUnits, previewBulkSupplierUnits, executeBulkSupplierUnit, readBulkTicket } from "../definition-audit-bulk.server";
import { scientificReportIdentity } from "../report-medication-evidence.helpers";
import { previewSupplierUnitRows, supplierBoxPreview } from "../report-supplier-units.helpers";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context = (role = "admin", pharmacy = "own", userId = uuid(99)) => ({ pharmacy_id: pharmacy, session: { data: { user_id: userId, user_role: role } } });
function fixture(count = 2) {
  const raw = emptyAuditSnapshot();
  raw.items = Array.from({ length: count }, (_, n) => ({ id: uuid(n + 1000), phif_invoice_id: uuid(n + 2000),
    active_ingredient: `INSULIN (HUMAN ${n})`, strength: "100IU", quantity: 2, source_classification: "phif-supplier",
    metadata: { dosage_form: "pen" }, phif_financial_fields: { total_amount: 25, internal_purchase_cost_value: 10 },
    phif_invoices: { pharmacy_id: "own" }, invoice: { pharmacy_id: "own" } }));
  raw.invoices = raw.items.map(i => ({ id: i.phif_invoice_id, pharmacy_id: "own", dispensing_date: "2026-11-01", invoice_number: "PRIVATE" }));
  raw.settings = raw.items.map((i, n) => ({ id: uuid(n + 3000), pharmacy_id: "own",
    item_identity: scientificReportIdentity(i).key.replace("insulin (", "insulin("), version: 1,
    units_per_box: 1, base_unit: "pen", supplier_quantity_unit: "pen", supplier_unit_exceptions: {} }));
  return raw;
}
const tables: Record<string, keyof AuditSnapshot> = { phif_invoice_items: "items", phif_invoices: "invoices", phif_report_box_settings: "settings",
  phif_stock_items: "stocks", phif_actual_stock_links: "links", phif_actual_unit_decisions: "decisions", prescription_items: "references" };
function database(raw: AuditSnapshot, options: { disabled?: boolean; partial?: boolean; changed?: boolean; rpcFail?: boolean; logFail?: string } = {}) {
  const logs: any[] = [], calls: any[] = [];
  let invoiceReads = 0;
  const db = { logs, calls, from(table: string) {
    let rows = table === "pharmacy_users" ? [{ id: uuid(99), pharmacy_id: "own", role: "admin", is_active: !options.disabled }]
      : table === "user_operation_log" ? logs : raw[tables[table]];
    const q: any = { select: () => q, order: () => q, not: () => q,
      eq: (key: string, value: unknown) => { rows = rows.filter(r => key.split(".").reduce((v, part) => v?.[part], r) === value); return q; },
      in: (key: string, values: any[]) => { rows = rows.filter(r => values.includes(r[key])); return q; },
      contains: (key: string, value: any) => { rows = rows.filter(r => Object.entries(value).every(([k, v]) => r[key]?.[k] === v)); return q; },
      maybeSingle: async () => ({ data: rows[0] ? structuredClone(rows[0]) : null, error: null }),
      limit: async (n: number) => ({ data: structuredClone(rows.slice(0, n)), error: null }),
      range: async (a: number) => {
        if (table === "phif_invoices" && a === 0) invoiceReads++;
        const page = structuredClone(rows.slice(a, a + 5));
        if (options.changed && invoiceReads > 1 && table === "phif_invoices" && page[0]) page[0].dispensing_date = "2026-10-01";
        return { data: options.partial && table === "phif_invoice_items" && a >= 5 ? [] : page, count: rows.length, error: null };
      },
      insert: async (value: any) => {
        expect(table).toBe("user_operation_log");
        if (options.logFail === value.action) return { error: { message: "unavailable" } };
        logs.push({ id: uuid(logs.length + 5000), ...structuredClone(value) }); return { error: null };
      },
    }; return q;
  }, async rpc(name: string, args: any) {
    expect(name).toBe("set_phif_report_supplier_unit"); calls.push({ name, args });
    const setting = raw.settings.find(s => s.pharmacy_id === args.p_pharmacy_id && s.item_identity === args.p_identity);
    if (options.rpcFail || !setting || setting.version !== args.p_expected_version) return { error: { message: "conflict" }, data: null };
    // The existing RPC returns the current row for identical values, without duplicate decisions.
    expect(args.p_unit).toBe(setting.supplier_quantity_unit); expect(args.p_exceptions).toEqual(setting.supplier_unit_exceptions);
    return { data: structuredClone(setting), error: null };
  } };
  return db;
}
beforeEach(() => vi.stubEnv("SESSION_SECRET", "bulk-test-only"));
afterEach(() => vi.unstubAllEnvs());

describe("manual bulk Supplier confirmation", () => {
  it("examines all review identities beyond UI caps and page limits, without performing writes in preview", async () => {
    const raw = fixture(121), db = database(raw), before = structuredClone(raw);
    const result = await previewBulkSupplierUnits(db, context());
    expect(result.ready).toHaveLength(121); expect(result.excluded).toEqual([]);
    expect(new Set(result.ready.map(r => r.identity)).size).toBe(121);
    expect(db.calls).toEqual([]); expect(db.logs).toEqual([]); expect(raw).toEqual(before);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it("uses the individual save RPC with unchanged values, records outcomes, and does not replay a completed approval", async () => {
    const raw = fixture(), db = database(raw), before = structuredClone(raw);
    const plan = await previewBulkSupplierUnits(db, context());
    const token = plan.ready[0].token;
    expect(await executeBulkSupplierUnit(db, context(), token)).toMatchObject({ status: "confirmed" });
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].args).toMatchObject({ p_pharmacy_id: "own", p_actor_id: uuid(99), p_expected_version: 1, p_unit: "pen" });
    expect(db.logs.map(l => l.metadata.status)).toEqual(["started", "confirmed"]);
    expect(await executeBulkSupplierUnit(db, context(), token)).toMatchObject({ status: "already_confirmed" });
    const newPreview = await previewBulkSupplierUnits(db, context());
    expect(await executeBulkSupplierUnit(db, context(), newPreview.ready[0].token)).toMatchObject({ status: "already_confirmed" });
    expect(db.calls).toHaveLength(1); expect(raw).toEqual(before);
  });
  it("never promotes the editor's form-derived default or size 1 into a saved quantity unit", () => {
    const raw = fixture(1); raw.settings[0].supplier_quantity_unit = null;
    const plan = planBulkSupplierUnits(raw, context());
    expect(plan.ready).toEqual([]); expect(plan.excluded[0].reason).toContain("الافتراضية");
  });
  it.each(["missing", "invalid-size", "conflicting", "unknown-quantity", "unknown-unit", "exceptions", "form", "strip", "unresolved", "actual"])("excludes %s rather than guessing or changing evidence", type => {
    const raw = fixture(1);
    if (type === "missing") raw.settings = [];
    if (type === "invalid-size") raw.settings[0].units_per_box = 0;
    if (type === "conflicting") raw.settings.push({ ...raw.settings[0], id: uuid(9), units_per_box: 5 });
    if (type === "unknown-quantity") raw.items[0].quantity = null;
    if (type === "unknown-unit") raw.items[0].metadata.quantity_unit = "unrecognized";
    if (type === "exceptions") raw.settings[0].supplier_unit_exceptions = { [raw.items[0].phif_invoice_id]: "pen" };
    if (type === "form") raw.settings[0].base_unit = "vial";
    if (type === "strip") raw.settings[0].supplier_quantity_unit = "strip";
    if (type === "unresolved") { raw.settings = []; raw.items[0].metadata = {}; }
    if (type === "actual") raw.items[0].source_classification = "actual-supplier";
    const plan = planBulkSupplierUnits(raw, context());
    expect(plan.ready).toEqual([]); expect(plan.excluded.length).toBeGreaterThan(0);
  });
  it("checks all matching invoices, not just one issue sample, and keeps strengths/forms distinct", async () => {
    const raw = fixture(3);
    raw.items[1].active_ingredient = raw.items[0].active_ingredient;
    raw.settings.splice(1, 1);
    raw.items[1].quantity = null;
    raw.items[2].strength = "200IU";
    const db = database(raw), plan = await previewBulkSupplierUnits(db, context());
    expect(plan.ready).toHaveLength(0);
    expect(db.calls).toEqual([]);
  });
  it("binds approvals to the manager and pharmacy; rejects staff, revoked accounts, tampering and expiration", async () => {
    const raw = fixture(), db = database(raw), plan = await previewBulkSupplierUnits(db, context()), token = plan.ready[0].token;
    for (const c of [context("employee"), context("admin", "foreign"), context("admin", "own", uuid(98))]) {
      await expect(previewBulkSupplierUnits(db, c)).rejects.toThrow();
      await expect(executeBulkSupplierUnit(db, c, token)).rejects.toThrow();
    }
    await expect(previewBulkSupplierUnits(database(raw, { disabled: true }), context())).rejects.toThrow();
    await expect(executeBulkSupplierUnit(database(raw, { disabled: true }), context(), token)).rejects.toThrow();
    expect(() => readBulkTicket(token, context("admin", "foreign"))).toThrow("الصيدلية");
    expect(() => readBulkTicket(token, context("admin", "own", uuid(98)))).toThrow("المستخدم");
    await expect(executeBulkSupplierUnit(db, context(), token + "x")).rejects.toThrow();
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60_000);
    expect(() => readBulkTicket(token, context())).toThrow("انتهت"); now.mockRestore();
    expect(db.calls).toEqual([]);
  });
  it("rejects changed versions, values, quantities and newly added matching items before RPC", async () => {
    for (const change of ["version", "size", "quantity", "new-item"]) {
      const raw = fixture(1), db = database(raw), plan = await previewBulkSupplierUnits(db, context());
      if (change === "version") raw.settings[0].version++;
      if (change === "size") raw.settings[0].units_per_box++;
      if (change === "quantity") raw.items[0].quantity++;
      if (change === "new-item") raw.items.push({ ...raw.items[0], id: uuid(555) });
      expect(await executeBulkSupplierUnit(db, context(), plan.ready[0].token)).toMatchObject({ status: "failed" });
      expect(db.calls).toEqual([]);
    }
  });
  it("rejects incomplete or changing reads and never offers partial ready lists", async () => {
    const raw = fixture(12);
    await expect(previewBulkSupplierUnits(database(raw, { partial: true }), context())).rejects.toThrow("لم تكتمل");
    await expect(previewBulkSupplierUnits(database(raw, { changed: true }), context())).rejects.toThrow("تغيرت");
  });
  it("reports uncertainty after RPC failure or a lost outcome log, without claiming success or retrying automatically", async () => {
    for (const options of [{ rpcFail: true }, { logFail: "supplier_unit_bulk_result" }]) {
      const raw = fixture(1), db = database(raw, options), plan = await previewBulkSupplierUnits(db, context());
      expect(await executeBulkSupplierUnit(db, context(), plan.ready[0].token)).toMatchObject({ status: "uncertain" });
      expect(db.calls).toHaveLength(1);
    }
  });
  it("does not start the RPC if the initial operation log is unavailable", async () => {
    const raw = fixture(1), db = database(raw, { logFail: "supplier_unit_bulk_attempt" }), plan = await previewBulkSupplierUnits(db, context());
    expect(await executeBulkSupplierUnit(db, context(), plan.ready[0].token)).toMatchObject({ status: "failed" });
    expect(db.calls).toEqual([]);
  });
  it("uses the same individual conversion preview, including fractional boxes and explicit conflicts", () => {
    const row: any = { source: "phif", invoiceId: "i", quantity: 15, unit: "tablet", units: 15, unitProvenance: "source", unitIssue: null };
    const setting: any = { units_per_box: 30, base_unit: "tablet" };
    expect(previewSupplierUnitRows([row], setting, "tablet", {})[0].boxes).toBe(supplierBoxPreview(15, "tablet", "tablet", 30));
    expect(previewSupplierUnitRows([{ ...row, unitIssue: "conflict" }], setting, "tablet", {})[0].boxes).toBeNull();
    expect(previewSupplierUnitRows([row], setting, "tablet", { i: "box" })[0].boxes).toBeNull();
  });
});
