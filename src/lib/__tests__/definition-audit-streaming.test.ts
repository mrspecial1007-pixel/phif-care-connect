import { describe, it, expect } from "vitest";
import { createReportIdentityEvidence, resolveReportIdentities, scientificReportIdentity } from "../report-medication-evidence.helpers";
import { resolveReportIdentities as legacy } from "./fixtures/legacy-report-identity";
import { createStreamingAudit } from "../definition-audit.streaming";
import { emptyAuditSnapshot, inspectDefinitions, prepareAuditBatch } from "../definition-audit.helpers";
import { actualItemSignature, actualLinkIdentity } from "../actual-stock-links.helpers";
import { buildItemsAnalytics, analyticsSearchSchema } from "../items-analytics.helpers";
import { runDefinitionAudit } from "../definition-audit.server";

function fixture() {
  const data = emptyAuditSnapshot();
  data.items = Array.from({ length: 80 }, (_, n) => ({ id: `i${n}`, phif_invoice_id: `v${n % 9}`, brand: `B${n % 3}`,
    active_ingredient: n % 2 ? "INSULIN(HUMAN)" : "INSULIN (HUMAN)", strength: n % 7 ? "100IU" : "200IU",
    source_classification: n % 3 ? "phif-supplier" : "actual-supplier", quantity: n % 5 ? 30 : null,
    metadata: n % 4 === 0 ? {} : { dosage_form: n % 5 ? "pen" : "vial", quantity_unit: "pen", package_quantity: n % 2 ? 28 : 30 } }));
  data.items.push({ ...data.items[1], id: "saved", active_ingredient: "Saved medicine", metadata: {} });
  data.items.push({ ...data.items[1], id: "unresolved", active_ingredient: "Unresolved", metadata: {} });
  data.invoices = Array.from({ length: 9 }, (_, n) => ({ id: `v${n}`, pharmacy_id: "own", invoice_number: `${n}`, dispensing_date: `2026-${n % 2 ? "10" : "11"}-01` }));
  data.settings = [{ id: "s", pharmacy_id: "own", item_identity: scientificReportIdentity({ ...data.items[80], metadata: { dosage_form: "tablet" } }).key,
    base_unit: "tablet", units_per_box: 30, supplier_unit_exceptions: { v0: "tablet" } }];
  const source = data.items[0];
  const target = { id: "stock", pharmacy_id: "own", source_stock_id: "stock", brand_name: source.brand,
    active_ingredient: source.active_ingredient, strength: source.strength, dosage_unit: "pen", package_quantity: 1, is_current: true };
  data.stocks = [target];
  data.links = [{ id: "link", phif_invoice_item_id: source.id, source, target, is_active: true,
    source_signature: actualItemSignature(source), source_identity: actualLinkIdentity(source, target) }];
  data.decisions = [{ id: "orphan", phif_invoice_item_id: "deleted" }];
  return data;
}
describe("incremental identity equivalence", () => {
  it.each(["stable", "changed", "interrupted", "foreign-link"])("checks both database passes: %s", async mode => {
    const raw = fixture();
    raw.items = raw.items.map(i => ({ ...i, phif_invoices: { pharmacy_id: "own" } }));
    raw.links[0] = { ...raw.links[0], pharmacy_id: "own", source: { ...raw.links[0].source,
      phif_invoices: { pharmacy_id: mode === "foreign-link" ? "other" : "own" } } };
    raw.decisions[0].pharmacy_id = "own";
    const data: Record<string, any[]> = { phif_invoices: raw.invoices, phif_invoice_items: raw.items, phif_report_box_settings: raw.settings,
      phif_stock_items: raw.stocks, phif_actual_stock_links: raw.links, phif_actual_unit_decisions: raw.decisions, prescription_items: [] };
    let itemPass = 0;
    const db = { from(table: string) {
      const q: any = { select: () => q, eq: () => q, order: () => q, range: async (from: number) => {
        if (table === "phif_invoice_items" && from === 0) itemPass++;
        if (mode === "interrupted" && itemPass === 2 && table === "phif_invoice_items" && from > 7) return { error: { message: "disconnected" } };
        const rows = data[table];
        return { count: rows.length, data: rows.slice(from, from + 7).map(r => mode === "changed" && itemPass === 2 && table === "phif_invoice_items" ? { ...r, quantity: 777 } : r) };
      } }; return q;
    } };
    const result = await runDefinitionAudit(db, "own");
    expect(result.coverage).toBe(mode === "stable" ? "observed_stable" : "incomplete");
    if (mode !== "stable") expect(result.findings).toEqual([]);
    else expect(result.counts.items).toBe(raw.items.length);
  });
  it("fails explicitly on evidence budget exhaustion instead of resolving a partial index", () => {
    const raw = fixture(), prepared = prepareAuditBatch(raw);
    const evidence = createReportIdentityEvidence([], [], undefined, 1);
    expect(() => evidence.addBatch(prepared.items, prepared.rows)).toThrow("budget");
  });
  it("keeps report calculations unchanged when using the completed index", () => {
    const raw = fixture(), prepared = prepareAuditBatch(raw);
    const evidence = createReportIdentityEvidence(prepared.stocks, [], { pharmacyId: "own", settings: raw.settings });
    evidence.addBatch(prepared.items.slice(40), prepared.rows);
    evidence.addBatch(prepared.items.slice(0, 40), prepared.rows);
    const rights = { items: true, movements: true, revenue: true, cost: true, profit: true };
    const input = { pharmacyId: "own", ...prepared, invoices: raw.invoices, settings: raw.settings,
      filters: analyticsSearchSchema.parse({ month: "all" }), access: { actual: rights, phif: rights } };
    expect(buildItemsAnalytics({ ...input, identityEvidence: evidence })).toEqual(buildItemsAnalytics(input));
  });
  it.each([1, 7, 25, 100])("matches the frozen resolver per item with batch size %i and reversed ordering", size => {
    const raw = fixture(), before = structuredClone(raw), prepared = prepareAuditBatch(raw);
    const scope = { pharmacyId: "own", settings: raw.settings };
    const expected = legacy(prepared.items, prepared.rows, prepared.stocks, [], scope);
    expect(resolveReportIdentities(prepared.items, prepared.rows, prepared.stocks, [], scope)).toEqual(expected);
    const index = createReportIdentityEvidence(prepared.stocks, [], scope);
    const reversed = [...prepared.items].reverse();
    for (let n = 0; n < reversed.length; n += size) index.addBatch(reversed.slice(n, n + size), prepared.rows);
    for (let n = 0; n < prepared.items.length; n += size) {
      for (const [id, identity] of index.resolveBatch(prepared.items.slice(n, n + size), prepared.rows)) expect(identity).toEqual(expected.get(id));
    }
    expect(raw).toEqual(before);
  });
  it.each([1, 7, 50])("preserves full audit findings and counts across batch size %i", size => {
    const raw = fixture();
    const expected = inspectDefinitions(raw, "own");
    const audit = createStreamingAudit({ ...raw, items: [] }, "own");
    for (let n = raw.items.length; n > 0; n -= size) audit.addEvidence(raw.items.slice(Math.max(0, n - size), n));
    for (let n = 0; n < raw.items.length; n += size) audit.inspectBatch(raw.items.slice(n, n + size));
    const result = audit.finish();
    expect(result.orphanItems).toBe(false);
    expect(result.findingsTotal).toBe(expected.length);
    for (const finding of expected) {
      const streamed = result.findings.find(f => f.id === finding.id);
      expect(streamed, finding.code).toMatchObject({ category: finding.category, reason: finding.reason,
        itemCount: finding.itemIds.length, invoiceCount: finding.invoices.length, recordCount: finding.records.length });
    }
  });
});
