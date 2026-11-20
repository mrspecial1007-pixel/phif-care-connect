import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuditItemsDiagnostics } from "../definition-audit-diagnostics.server";
import { runDefinitionAudit } from "../definition-audit.server";
import { createStreamingAudit } from "../definition-audit.streaming";

vi.mock("../definition-audit.streaming", async importOriginal => {
  const actual = await importOriginal<typeof import("../definition-audit.streaming")>();
  return { ...actual, createStreamingAudit: vi.fn(actual.createStreamingAudit) };
});

const setting = "PHIF_AUDIT_ITEMS_DIAGNOSTICS_UNTIL";
const enable = () => vi.stubEnv(setting, new Date(Date.now() + 60_000).toISOString());
const events = () => vi.mocked(console.info).mock.calls.filter(c => c[0] === "definition_audit_items").map(c => c[1] as any);

function fixture(onItems?: (from: number, pass: number) => void, failQuery = false) {
  const items = Array.from({ length: 5 }, (_, n) => ({
    id: `private-item-${n}`, phif_invoice_id: "private-invoice-id", active_ingredient: "Test medicine", strength: "5MG",
    quantity: 30, source_classification: "phif-supplier", phif_invoices: { pharmacy_id: "own" },
    metadata: { dosage_form: "tablet", quantity_unit: "tablet", patient_name: "PRIVATE-PATIENT", card: "000PRIVATE-CARD", token: "PRIVATE-TOKEN" },
  }));
  const invoices = [{ id: "private-invoice-id", pharmacy_id: "own", invoice_number: "PRIVATE-INVOICE-NUMBER", dispensing_date: "2026-11-01" }];
  const calls: unknown[] = [];
  let pass = 0;
  const db = { from(table: string) {
    const q: any = { select: (...args: any[]) => { calls.push([table, "select", ...args]); return q; },
      eq: (...args: any[]) => { calls.push([table, "eq", ...args]); return q; }, order: (...args: any[]) => { calls.push([table, "order", ...args]); return q; },
      range: async (from: number, to: number) => {
        calls.push([table, "range", from, to]);
        if (table === "phif_invoice_items") {
          if (from === 0) pass++;
          onItems?.(from, pass);
          if (failQuery) throw new Error("PRIVATE-QUERY-DETAILS");
        }
        const data = table === "phif_invoice_items" ? items : table === "phif_invoices" ? invoices : [];
        return { data: data.slice(from, from + 2), count: data.length };
      } };
    return q;
  } };
  return { db, calls, items, invoices };
}

beforeEach(() => {
  vi.stubEnv(setting, "");
  vi.mocked(createStreamingAudit).mockClear();
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("expiring server-only audit diagnostics", () => {
  it.each(["", "true", "1", "invalid", "2020-01-01T00:00:00Z", "2099-01-01T00:00:00"])("is disabled for %s", value => {
    vi.stubEnv(setting, value);
    const c = new AbortController(), listen = vi.spyOn(c.signal, "addEventListener");
    expect(createAuditItemsDiagnostics("test-run", new Date().toISOString(), c.signal)).toBeUndefined();
    expect(listen).not.toHaveBeenCalled(); expect(events()).toEqual([]);
  });

  it("records each page only in the evidence pass, without changing reads, results or records", async () => {
    const baseline = fixture();
    const old = await runDefinitionAudit(baseline.db, "own");
    expect(events()).toEqual([]);
    enable();
    const active = fixture();
    const original = JSON.stringify([active.items, active.invoices]);
    const result = await runDefinitionAudit(active.db, "own");
    expect(result.coverage).toBe("observed_stable");
    for (const key of ["counts", "findings", "manifest", "evidenceFingerprint", "coverage"] as const) expect(result[key]).toEqual(old[key]);
    expect(active.calls).toEqual(baseline.calls);
    expect(JSON.stringify([active.items, active.invoices])).toBe(original);
    const log = events();
    expect(log.filter(e => e.event === "query_started").map(e => [e.page, e.offset, e.itemCount])).toEqual([[1, 0, null], [2, 2, null], [3, 4, null]]);
    expect(log.filter(e => e.event === "query_finished").map(e => e.itemCount)).toEqual([2, 2, 1]);
    for (const page of [1, 2, 3]) {
      expect(log.filter(e => e.page === page && !e.event.startsWith("phase_")).map(e => e.event))
        .toEqual(["query_started", "query_finished", "records_checked", "evidence_started", "evidence_finished"]);
    }
    expect(log.every(e => e.runId === result.runId && e.stage === "identity_evidence" && e.source === "items")).toBe(true);
    expect(log.filter(e => e.durationMs !== undefined).every(e => e.durationMs >= 0)).toBe(true);
    expect(log.at(-1)).toMatchObject({ event: "phase_finished", outcome: "completed", lastCompleted: { page: 3, step: "evidence_finished" } });
    const serialized = JSON.stringify(log);
    for (const secret of ["PRIVATE-", "private-item", "private-invoice", "Test medicine", "metadata", "pharmacy_id", "patient_name"])
      expect(serialized).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("query_started");
  });

  it("observes disconnection on a later page without cancelling reads or changing the scan outcome", async () => {
    enable();
    const c = new AbortController(), remove = vi.spyOn(c.signal, "removeEventListener");
    const { db } = fixture((from, pass) => { if (from === 2 && pass === 1) c.abort(new DOMException("The client has disconnected", "AbortError")); });
    const result = await runDefinitionAudit(db, "own", c.signal);
    expect(result.coverage).toBe("observed_stable");
    expect(events().find(e => e.event === "request_aborted")).toMatchObject({ runId: result.runId, page: 2, step: "query_started",
      abortReason: "client_disconnected", lastCompleted: { page: 1, step: "evidence_finished" } });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(events().filter(e => e.event === "query_started")).toHaveLength(3);
  });

  it.each([new Error("PRIVATE-TOKEN"), "PRIVATE-PATIENT", { name: "PRIVATE-CARD", message: "PRIVATE-INVOICE" }])("does not log arbitrary cancellation reasons", reason => {
    enable();
    const c = new AbortController(); c.abort(reason);
    const diagnostics = createAuditItemsDiagnostics("run", new Date().toISOString(), c.signal);
    expect(events().find(e => e.event === "request_aborted").abortReason).toBe("unspecified");
    expect(JSON.stringify(events())).not.toContain("PRIVATE-");
    diagnostics?.dispose();
  });

  it("captures a failed query without inventing query completion or leaking its exception", async () => {
    enable();
    const c = new AbortController(), remove = vi.spyOn(c.signal, "removeEventListener");
    const result = await runDefinitionAudit(fixture(undefined, true).db, "own", c.signal);
    expect(result.coverage).toBe("incomplete");
    expect(events().find(e => e.event === "page_failed")).toMatchObject({ page: 1, step: "query_started", lastCompleted: null });
    expect(events().some(e => e.event === "query_finished")).toBe(false);
    expect(JSON.stringify(events())).not.toContain("PRIVATE-QUERY");
    expect(remove).toHaveBeenCalled();
  });

  it("keeps an unsuccessful query response distinct from record processing", () => {
    enable();
    const d = createAuditItemsDiagnostics("run", new Date().toISOString())!;
    d.queryStarted(1, 0); d.queryFinished(null, true); d.failed(new Error("تعذر تحميل بيانات التقرير كاملة")); d.dispose();
    expect(events().find(e => e.event === "query_finished")).toMatchObject({ queryError: true, itemCount: null });
    expect(events().find(e => e.event === "page_failed")).toMatchObject({ step: "query_finished", errorKind: "query" });
    expect(events().some(e => e.event === "records_checked")).toBe(false);
  });

  it("distinguishes evidence processing failure from an unfinished query", async () => {
    enable();
    const original = await vi.importActual<typeof import("../definition-audit.streaming")>("../definition-audit.streaming");
    vi.mocked(createStreamingAudit).mockImplementationOnce((...args) => ({ ...original.createStreamingAudit(...args), addEvidence() { throw new Error("PRIVATE-METADATA"); } }));
    const result = await runDefinitionAudit(fixture().db, "own");
    expect(result.coverage).toBe("incomplete");
    expect(events().find(e => e.event === "page_failed")).toMatchObject({ step: "evidence_started", lastCompleted: { page: 1, step: "records_checked" } });
    expect(events().some(e => e.event === "evidence_finished")).toBe(false);
    expect(JSON.stringify(events())).not.toContain("PRIVATE-METADATA");
  });

  it("stops logging at expiry and removes its listener on disposal", () => {
    vi.useFakeTimers();
    try {
      enable();
      const c = new AbortController(), remove = vi.spyOn(c.signal, "removeEventListener");
      const diag = createAuditItemsDiagnostics("run", new Date().toISOString(), c.signal)!;
      diag.queryStarted(1, 0);
      const before = events().length;
      vi.advanceTimersByTime(60_001);
      diag.queryFinished(5, false); c.abort();
      expect(events()).toHaveLength(before);
      diag.dispose(); expect(remove).toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("never propagates diagnostic log failures", () => {
    enable();
    vi.mocked(console.info).mockImplementation(() => { throw new Error("logger unavailable"); });
    expect(() => {
      const c = new AbortController();
      const d = createAuditItemsDiagnostics("run", new Date().toISOString(), c.signal)!;
      d.queryStarted(1, 0); d.queryFinished(1, false); d.recordsChecked(); d.evidenceStarted(); c.abort(); d.evidenceFinished(); d.finished(true); d.dispose();
    }).not.toThrow();
  });
});
