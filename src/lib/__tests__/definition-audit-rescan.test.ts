import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyAuditSnapshot } from "../definition-audit.helpers";
import { scientificReportIdentity } from "../report-medication-evidence.helpers";
import { createStreamingAudit } from "../definition-audit.streaming";
import { runDefinitionAudit } from "../definition-audit.server";
import { IDBFactory } from "fake-indexeddb";
import { createDefinitionAuditStore } from "../definition-audit.local";
import { auditRequestErrorMessage, classifyAuditFailure } from "../definition-audit-errors";

vi.mock("../definition-audit.streaming", async importOriginal => {
  const actual = await importOriginal<typeof import("../definition-audit.streaming")>();
  return { ...actual, createStreamingAudit: vi.fn(actual.createStreamingAudit) };
});

function fixture() {
  const raw = emptyAuditSnapshot();
  raw.items = Array.from({ length: 1200 }, (_, n) => ({ id: `i${n}`, phif_invoice_id: `v${n}`,
    active_ingredient: n % 40 === 0 ? "BECLOMETHASONE DIPROPIONATE" : `Synthetic medicine ${n % 40}`,
    strength: n % 40 === 0 ? "250MCG" : "5MG", source_classification: "phif-supplier", quantity: n % 40 === 0 ? 1 : 30,
    metadata: { dosage_form: n % 40 === 0 ? "inhaler" : "tablet" }, phif_invoices: { pharmacy_id: "own" },
    phif_financial_fields: { total_amount: 60, internal_purchase_cost: 24 } }));
  raw.invoices = raw.items.map((i, n) => ({ id: i.phif_invoice_id, pharmacy_id: "own", invoice_number: String(n), dispensing_date: n % 2 ? "2026-11-01" : "2026-03-01" }));
  raw.settings = raw.items.slice(0, 40).map((i, n) => ({ id: `s${n}`, pharmacy_id: "own", item_identity: scientificReportIdentity(i).key,
    units_per_box: n === 0 ? 1 : 30, base_unit: n === 0 ? "inhaler" : "tablet", supplier_quantity_unit: null, supplier_unit_exceptions: {}, version: 1 }));
  const tables: Record<string, any[]> = { phif_invoices: raw.invoices, phif_invoice_items: raw.items, phif_report_box_settings: raw.settings,
    phif_stock_items: [], phif_actual_stock_links: [], phif_actual_unit_decisions: [], prescription_items: [] };
  const db = { from(table: string) {
    const q: any = { select: () => q, eq: () => q, order: () => q, range: async (from: number) => ({ data: tables[table].slice(from, from + 100), count: tables[table].length }) };
    return q;
  } };
  return { raw, db };
}
beforeEach(() => {
  vi.mocked(createStreamingAudit).mockClear();
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("re-scan after bulk documentation", () => {
  it("completes before and after forty confirmed definitions without modifying invoices or financial fields", async () => {
    const { raw, db } = fixture(); const original = JSON.stringify({ items: raw.items, invoices: raw.invoices });
    const before = await runDefinitionAudit(db, "own");
    expect(before.coverage).toBe("observed_stable");
    expect(before.findings.filter(f => f.code.startsWith("conversion_unverified"))).toHaveLength(40);
    for (const setting of raw.settings) { setting.supplier_quantity_unit = setting.base_unit; setting.version++; }
    const after = await runDefinitionAudit(db, "own");
    expect(after.coverage).toBe("observed_stable");
    expect(after.counts).toMatchObject({ items: 1200, invoices: 1200, definitions: 40 });
    expect(after.findings.filter(f => f.code.startsWith("conversion_unverified"))).toEqual([]);
    expect(JSON.stringify({ items: raw.items, invoices: raw.invoices })).toBe(original);
  });
  it("reports incomplete processing instead of escaping as an unhandled server error during initialization", async () => {
    const { db } = fixture();
    vi.mocked(createStreamingAudit).mockImplementationOnce(() => { throw new Error("budget"); });
    const result = await runDefinitionAudit(db, "own");
    expect(result.coverage).toBe("incomplete");
    expect(result.findings).toEqual([]);
    expect(result.failure).toMatchObject({ code: "budget", stage: "initialize", reference: result.runId });
  });
  it("does not return a successful or partial result if finalization throws", async () => {
    const { db } = fixture();
    const original = await vi.importActual<typeof import("../definition-audit.streaming")>("../definition-audit.streaming");
    vi.mocked(createStreamingAudit).mockImplementationOnce((...args) => ({ ...original.createStreamingAudit(...args), finish() { throw new TypeError("private database diagnostic"); } }));
    const result = await runDefinitionAudit(db, "own");
    expect(result.coverage).toBe("incomplete");
    expect(result.findings).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("private database diagnostic");
    expect(result.failure).toMatchObject({ code: "processing", stage: "finalize" });
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain("private database diagnostic");
    expect(result.evidenceFingerprint).toBeNull();
  });
  it("retains the last complete IndexedDB result when a later scan fails", async () => {
    const { db } = fixture();
    const store = createDefinitionAuditStore({ indexedDB: new IDBFactory() });
    const scope = { pharmacyId: "own", userId: "admin" };
    const complete = await runDefinitionAudit(db, "own");
    await store.save(scope, complete);
    const saved = await store.load(scope);
    vi.mocked(createStreamingAudit).mockImplementationOnce(() => { throw new Error("budget"); });
    const incomplete = await runDefinitionAudit(db, "own");
    await expect(store.save(scope, incomplete)).rejects.toThrow();
    expect(await store.load(scope)).toEqual(saved);
    expect(await store.load({ ...scope, pharmacyId: "other" })).toBeNull();
  });
  it("records a failed source and database code without leaking its message", async () => {
    const { db } = fixture();
    const from = db.from.bind(db);
    db.from = table => table !== "phif_report_box_settings" ? from(table) : {
      ...from(table), select() { return this; }, eq() { return this; }, order() { return this; },
      range: async () => ({ error: { code: "57014", message: "private statement and token" } }),
    };
    const result = await runDefinitionAudit(db, "own");
    expect(result.coverage).toBe("incomplete");
    expect(result.failure).toMatchObject({ code: "query", stage: "support_read" });
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logs).toContain('"databaseCode":"57014"');
    expect(logs).toContain('"source":"settings"');
    expect(logs + JSON.stringify(result)).not.toContain("private statement");
  });
  it.each(["addEvidence", "inspectBatch"] as const)("marks %s failures incomplete and never returns partial findings", async method => {
    const { db } = fixture();
    const original = await vi.importActual<typeof import("../definition-audit.streaming")>("../definition-audit.streaming");
    vi.mocked(createStreamingAudit).mockImplementationOnce((...args) => ({ ...original.createStreamingAudit(...args), [method]() { throw new Error("private processing details"); } }));
    const result = await runDefinitionAudit(db, "own");
    expect(result.coverage).toBe("incomplete");
    expect(result.findings).toEqual([]);
    expect(result.failure?.stage).toBe(method === "addEvidence" ? "identity_evidence" : "inspect_items");
    expect(JSON.stringify(result)).not.toContain("private processing details");
  });
  it("does not label an unknown 500 as memory exhaustion or timeout", () => {
    expect(classifyAuditFailure(new Error("Internal server error"))).toBe("processing");
    expect(classifyAuditFailure(Object.assign(new Error("private"), { name: "TimeoutError" }))).toBe("timeout");
    expect(classifyAuditFailure(Object.assign(new Error("private"), { name: "AbortError" }))).toBe("interrupted");
    expect(auditRequestErrorMessage(new Error("secret internal diagnostic"))).not.toContain("secret");
    expect(auditRequestErrorMessage(new Error("Internal server error"))).toContain("لم تُستبدل النتائج المحفوظة");
    expect(auditRequestErrorMessage(new Error("لا تملك صلاحية تدقيق هذه الصيدلية"))).toBe("لا تملك صلاحية تدقيق هذه الصيدلية");
  });
});
