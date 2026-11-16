import { describe, expect, it, vi, afterEach } from "vitest";
import { emptyAuditSnapshot, inspectDefinitions } from "../definition-audit.helpers";
import { scientificReportIdentity } from "../report-medication-evidence.helpers";
import { actualItemSignature, actualLinkIdentity } from "../actual-stock-links.helpers";
import { readDefinitionSnapshot, requireDefinitionAuditAdmin, runDefinitionAudit, summarizeAuditFindings } from "../definition-audit.server";

const item = (id: string, patch: any = {}) => ({ id, phif_invoice_id: `v${id}`, active_ingredient: "INSULIN(HUMAN)", strength: "100IU", brand: "Brand", quantity: 30, source_classification: "phif-supplier", metadata: { dosage_form: "pen", quantity_unit: "pen" }, ...patch });
function fixture() {
  const data = emptyAuditSnapshot();
  data.items = [item("1"), item("2")];
  data.invoices = data.items.map((i, n) => ({ id: i.phif_invoice_id, pharmacy_id: "own", invoice_number: String(n), dispensing_date: `2026-${n ? "11" : "10"}-01` }));
  data.settings = [{ id: "s", pharmacy_id: "own", item_identity: scientificReportIdentity(data.items[0]).key, base_unit: "pen", units_per_box: 1, version: 1, supplier_quantity_unit: "pen" }];
  return data;
}
describe("definition audit shared identity and conversions", () => {
  it("returns bounded evidence while preserving full counts", () => {
    const data = fixture(); data.settings = [];
    data.items = Array.from({ length: 30 }, (_, n) => item(String(n)));
    data.invoices = data.items.map(i => ({ id: i.phif_invoice_id, pharmacy_id: "own", dispensing_date: "2026-01-01" }));
    const f = summarizeAuditFindings(inspectDefinitions(data, "own")).find(r => r.code === "missing_definition")!;
    expect(f.itemCount).toBe(30); expect(f.invoiceCount).toBe(30);
    expect(f.itemIds).toHaveLength(5); expect(f.invoices).toHaveLength(5); expect(f.evidenceTruncated).toBe(true);
  });
  it("retrieves a saved definition across months without changing invoices or financial fields", () => {
    const data = fixture(); data.items[0].phif_financial_fields = { internal_purchase_cost: 123.45, total_amount: 999 };
    const original = structuredClone(data);
    const result = inspectDefinitions(data, "own");
    expect(result.filter(r => ["missing_definition", "unused_definition"].includes(r.code) || r.code.startsWith("conversion_unverified"))).toEqual([]);
    expect(data).toEqual(original);
  });
  it("detects malformed/unretrievable keys separately from a working legacy formatting alias", () => {
    const data = fixture(); data.settings[0].item_identity = '["insulin(human)","100iu","pen"]';
    expect(inspectDefinitions(data, "own").some(r => r.code === "normalized_alias")).toBe(true);
    expect(inspectDefinitions(data, "own").some(r => r.code === "missing_definition")).toBe(false);
    data.settings[0].item_identity = "bad-key";
    const result = inspectDefinitions(data, "own");
    expect(result.some(r => r.code === "invalid_key")).toBe(true);
    expect(result.find(r => r.code === "missing_definition")?.invoices.map(i => i.month)).toEqual(["2026-10", "2026-11"]);
  });
  it("does not call documented sizes 28 and 30 an erroneous identity or change them", () => {
    const data = fixture(); data.items = [28, 30].map((n, index) => item(String(index + 1), { active_ingredient: "Drug", strength: "5MG", quantity: n, metadata: { dosage_form: "tablet", quantity_unit: "tablet", package_quantity: n } }));
    data.settings[0] = { ...data.settings[0], item_identity: scientificReportIdentity(data.items[0]).key, units_per_box: 30, base_unit: "tablet", supplier_quantity_unit: "tablet" };
    expect(inspectDefinitions(data, "own").filter(r => r.category === "error")).toEqual([]);
    expect(inspectDefinitions(data, "own").some(r => r.code.startsWith("conversion_unverified"))).toBe(false);
  });
  it("does not borrow a definition across strengths or explicit forms", () => {
    const data = fixture(); data.items[1].strength = "200IU";
    expect(inspectDefinitions(data, "own").find(r => r.code === "missing_definition")?.itemIds).toEqual(["2"]);
    data.items[1].strength = "100IU"; data.items[1].metadata = { dosage_form: "vial" };
    expect(inspectDefinitions(data, "own").find(r => r.code === "missing_definition")?.itemIds).toEqual(["2"]);
  });
  it("does not infer a quantity unit from a saved box/form; retains real zero", () => {
    const data = fixture(); data.settings[0].supplier_quantity_unit = null;
    data.items[0].metadata = { dosage_form: "pen" };
    data.items[1].quantity = 0;
    expect(inspectDefinitions(data, "own").find(r => r.code.startsWith("conversion_unverified"))?.itemIds).toEqual(["1"]);
  });
  it("keeps SQL compatibility unverified for both valid-looking and unrelated exceptions", () => {
    const data = fixture(); data.settings[0].supplier_unit_exceptions = { v1: "pen", other: "pen" };
    const result = inspectDefinitions(data, "own");
    expect(result.find(r => r.code === "supplier_exception_sql")?.category).toBe("unverified");
    expect(result.some(r => r.code === "supplier_exception_scope")).toBe(true);
  });
  it.each(["INSULIN(HUMAN)", "INSULIN (HUMAN)"])("preserves historical Actual keys for %s", name => {
    const data = fixture(); data.items[0] = item("1", { active_ingredient: name, source_classification: "actual-supplier" });
    const target = { id: "stock", source_stock_id: "s1", brand_name: "Brand", active_ingredient: name, strength: "100IU", dosage_unit: "pen", package_quantity: 1 };
    data.links = [{ id: "l", version: 1, phif_invoice_item_id: "1", source_signature: actualItemSignature(data.items[0]), source_identity: actualLinkIdentity(data.items[0], target), is_active: true, target }];
    const before = structuredClone(data.links);
    expect(inspectDefinitions(data, "own").some(r => r.code === "legacy_key_mismatch")).toBe(false);
    expect(data.links).toEqual(before);
    data.links[0].source_identity = "wrong";
    expect(inspectDefinitions(data, "own").some(r => r.code === "legacy_key_mismatch")).toBe(true);
  });
  it("reports inactive/orphan raw links and decisions, not only applied results", () => {
    const data = fixture(); data.links = [{ id: "l", phif_invoice_item_id: "deleted", is_active: false }];
    data.decisions = [{ id: "d", phif_invoice_item_id: "deleted" }];
    expect(inspectDefinitions(data, "own").map(r => r.code)).toEqual(expect.arrayContaining(["orphan_link", "inactive_link", "orphan_unit_decision"]));
  });
  it("groups thousands of affected items without dropping any invoice or producing one finding per item", () => {
    const data = fixture(); data.settings = [];
    data.items = Array.from({ length: 2000 }, (_, n) => item(String(n)));
    data.invoices = data.items.map(i => ({ id: i.phif_invoice_id, pharmacy_id: "own", dispensing_date: "2026-01-01" }));
    const start = performance.now();
    const findings = inspectDefinitions(data, "own");
    console.info(`Local synthetic audit: 2000 items, ${Math.round(performance.now() - start)} ms, ${findings.length} grouped findings`);
    expect(findings.find(f => f.code === "missing_definition")?.itemIds).toHaveLength(2000);
    expect(findings.find(f => f.code === "missing_definition")?.invoices).toHaveLength(2000);
    expect(findings.length).toBeLessThan(10);
  });
  it("reports duplicate active relationships without changing Actual evidence, invoices or stock", () => {
    const data = fixture(); data.items[0] = item("1", { source_classification: "actual-supplier", metadata: { dosage_form: "tablet", quantity_unit: "tablet" } });
    const target = { id: "st", source_stock_id: "st", brand_name: "Brand", active_ingredient: "INSULIN(HUMAN)", strength: "100IU", dosage_unit: "tablet", package_quantity: 30, cost_price: 1, sale_price: 2, is_current: true };
    data.stocks = [target];
    data.links = ["l1", "l2"].map(id => ({ id, version: 1, phif_invoice_item_id: "1", source_signature: actualItemSignature(data.items[0]), source_identity: actualLinkIdentity(data.items[0], target), is_active: true, target }));
    const original = structuredClone(data);
    expect(inspectDefinitions(data, "own").some(f => f.code === "duplicate_actual_links")).toBe(true);
    expect(data).toEqual(original);
  });
});

function database(options: { mode?: string; size?: number } = {}) {
  const calls: any[] = [];
  let invoicePass = 0;
  return { calls, from(table: string) {
    let field: string, scope: string;
    return { select() { return this; }, eq(k: string, v: string) { field = k; scope = v; return this; }, order() { return this; },
      async range(from: number, to: number) {
        calls.push({ table, field, scope, from, to });
        if (table !== "phif_invoices") return { data: [], count: 0 };
        if (from === 0) invoicePass++;
        if (options.mode === "error") return { error: { message: "network" }, count: 1 };
        const size = options.size || 2;
        const rows = Array.from({ length: size }, (_, n) => ({ id: String(n), pharmacy_id: options.mode === "foreign" ? "other" : "own", invoice_number: options.mode === "changed" && invoicePass === 2 ? "changed" : "old" }));
        return { data: options.mode === "short" && from > 0 ? [] : options.mode === "duplicate" && from > 0 ? [rows[0]] : rows.slice(from, Math.min(to + 1, from + 2)), count: options.mode === "countless" ? null : size };
      } };
  } };
}
describe("complete pharmacy-scoped reads", () => {
  it("exhausts server-capped pages across all dates", async () => {
    const db = database({ size: 5 }); const result = await readDefinitionSnapshot(db, "own");
    expect(result.snapshot?.invoices).toHaveLength(5);
    expect(db.calls.every(c => c.scope === "own")).toBe(true);
    expect(db.calls.find(c => c.table === "phif_invoice_items").field).toBe("phif_invoices.pharmacy_id");
  });
  it("verifies the second pass without retaining another copy of the source rows", async () => {
    const db = database({ size: 1001 });
    const first = await readDefinitionSnapshot(db, "own");
    const verification = await readDefinitionSnapshot(db, "own", false);
    expect(first.snapshot?.invoices).toHaveLength(1001);
    expect(verification.snapshot).toBeNull();
    expect(verification.manifest[0]).toMatchObject({ count: 1001, digest: first.manifest[0].digest });
  });
  it.each(["error", "short", "duplicate", "foreign", "countless"])("marks %s incomplete, never healthy", async mode => {
    const result = await runDefinitionAudit(database({ mode, size: 5 }), "own");
    expect(result.coverage).toBe("incomplete"); expect(result.findings).toEqual([]);
    expect(result.counts.unverified).toBeGreaterThan(0);
    expect(result.manifest[0].reason).toBeTruthy();
  });
  it("detects changed old data even with identical row counts", async () => {
    const result = await runDefinitionAudit(database({ mode: "changed" }), "own");
    expect(result.manifest[0].status).toBe("changed"); expect(result.coverage).toBe("incomplete");
  });
  it("never claims an atomic snapshot or resolved issues from equal reads", async () => {
    const result = await runDefinitionAudit(database(), "own");
    expect(result.coverage).toBe("observed_stable"); expect(result.consistency).toBe("unverified_snapshot"); expect(result.previousRun).toBeNull();
  });
});
describe("audit administrator authorization", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each(["employee", "legacy", "disabled", "foreign", "admin"])("checks %s against the current pharmacy", async role => {
    vi.stubEnv("SESSION_SECRET", "local-test-only-secret");
    const filters: any = {};
    const q: any = { select: () => q, eq: (k: string, v: any) => { filters[k] = v; return q; }, maybeSingle: async () => ({ data: role === "admin" ? { id: "u" } : null }) };
    const run = requireDefinitionAuditAdmin({ from: () => q }, { pharmacy_id: "own", session: { data: { user_id: "u", user_role: ["disabled", "foreign"].includes(role) ? "admin" : role } } });
    if (role === "admin") { await expect(run).resolves.toBeUndefined(); expect(filters).toMatchObject({ pharmacy_id: "own", role: "admin", is_active: true }); }
    else await expect(run).rejects.toThrow();
  });
});
