import { afterEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { emptyAuditSnapshot, inspectDefinitions, type AuditSnapshot } from "../definition-audit.helpers";
import { runDefinitionAudit } from "../definition-audit.server";
import { buildAuditReviewRows, exportAuthorizedDefinitionAudit, readAuditReviewExport } from "../definition-audit-export.server";
import { buildAuditReviewWorkbook } from "../definition-audit-export.xlsx";
import { scientificReportIdentity } from "../report-medication-evidence.helpers";
import type { AuditReviewExport } from "../definition-audit-export.model";

function fixture(count = 2) {
  const raw = emptyAuditSnapshot();
  raw.items = Array.from({ length: count }, (_, n) => ({ id: `item-${String(n).padStart(4, "0")}`, phif_invoice_id: `invoice-${n}`,
    active_ingredient: `Medicine ${n}`, strength: "10MG", quantity: 30, source_classification: "phif-supplier",
    metadata: { dosage_form: "tablet" }, phif_invoices: { pharmacy_id: "own" },
    phif_financial_fields: { total_amount: 61.41, internal_purchase_cost: 30 } }));
  raw.invoices = raw.items.map(i => ({ id: i.phif_invoice_id, pharmacy_id: "own", invoice_number: `PRIVATE-NUMBER-${i.id}`, dispensing_date: "2026-11-01" }));
  return raw;
}
const tables: Record<string, keyof AuditSnapshot> = { phif_invoices: "invoices", phif_invoice_items: "items", phif_report_box_settings: "settings",
  phif_stock_items: "stocks", phif_actual_stock_links: "links", phif_actual_unit_decisions: "decisions", prescription_items: "references" };
function database(raw: AuditSnapshot, options: { manager?: boolean; partial?: boolean; changeOnVerification?: boolean } = {}) {
  let invoiceReads = 0;
  const reads: string[] = [];
  return { reads, from(table: string) {
    const equalities: Record<string, unknown> = {};
    const builder = { select: () => builder, eq: (key: string, value: unknown) => { equalities[key] = value; return builder; }, order: () => builder,
      maybeSingle: async () => ({ data: options.manager !== false && equalities.id === "admin" && equalities.pharmacy_id === "own"
        && equalities.role === "admin" && equalities.is_active === true ? { id: "admin" } : null, error: null }),
      range: async (from: number) => {
        reads.push(table);
        expect(equalities[table === "phif_invoice_items" ? "phif_invoices.pharmacy_id" : "pharmacy_id"]).toBe("own");
        if (table === "phif_invoices" && from === 0) invoiceReads++;
        const rows = structuredClone(raw[tables[table]]);
        if (options.changeOnVerification && invoiceReads > 1 && table === "phif_invoices") rows[0].dispensing_date = "2026-10-01";
        return { data: options.partial && table === "phif_invoice_items" && from >= 7 ? [] : rows.slice(from, from + 7), count: rows.length, error: null };
      } };
    return builder;
  } };
}
const scanRequest = async (raw: AuditSnapshot) => {
  const scan = await runDefinitionAudit(database(raw), "own");
  expect(scan.coverage).toBe("observed_stable");
  return { fingerprint: scan.evidenceFingerprint!, ruleVersion: "definitions-2" as const, finishedAt: scan.finishedAt };
};
const context = (role = "admin", pharmacy = "own") => ({ pharmacy_id: pharmacy, session: { data: { user_id: "admin", user_role: role } } });
afterEach(() => vi.unstubAllEnvs());

describe("complete pharmacy-scoped audit export", () => {
  it("exports ALL identities past the 100-finding UI cap and all read pages; never returns invoice details or finances", async () => {
    const raw = fixture(121), before = structuredClone(raw), scan = await runDefinitionAudit(database(raw), "own");
    expect(scan.findingsTruncated).toBe(true); expect(scan.findings.length).toBe(100);
    const db = database(raw);
    const result = await readAuditReviewExport(db, "own", { fingerprint: scan.evidenceFingerprint!, ruleVersion: "definitions-2", finishedAt: scan.finishedAt });
    expect(result.rows).toHaveLength(121);
    expect(new Set(result.rows.map(r => r.key)).size).toBe(121);
    expect(result.rows.every(r => r.itemCount === 1 && r.invoiceCount === 1)).toBe(true);
    expect(result.rows.reduce((n, r) => n + r.itemCount, 0)).toBe(121);
    expect(db.reads.filter(t => t === "phif_invoice_items").length).toBeGreaterThan(2);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE-NUMBER|total_amount|internal_purchase_cost|invoice-\d/);
    expect(raw).toEqual(before);
  });
  it("recovers saved alias definitions by the shared key; unions items and invoices across multiple reasons", () => {
    const raw = fixture(); raw.items.forEach(i => { i.active_ingredient = "INSULIN (HUMAN)"; i.strength = "100IU"; i.metadata = { dosage_form: "pen" }; });
    raw.items[1].phif_invoice_id = raw.items[0].phif_invoice_id;
    raw.settings = [{ id: "setting-1", pharmacy_id: "own", item_identity: '["insulin(human)","100iu","pen"]', units_per_box: 1, base_unit: "pen", supplier_quantity_unit: null, version: 4 }];
    const projection = buildAuditReviewRows(raw, "own", inspectDefinitions(raw, "own"));
    expect(projection.rows).toHaveLength(1);
    expect(projection.rows[0]).toMatchObject({ itemCount: 2, invoiceCount: 1, boxSize: 1, baseUnit: "pen", supplierUnit: null });
    expect(projection.rows[0].reasons.length).toBeGreaterThan(1);
    expect(projection.definitions[0]).toMatchObject({ id: "setting-1", identity: raw.settings[0].item_identity, version: 4 });
  });
  it("keeps different strengths, forms and sources separate, with no guessed size or Supplier values for Actual", () => {
    const raw = fixture(4);
    raw.items.forEach(i => { i.active_ingredient = "Same medicine"; });
    raw.items[1].strength = "20MG"; raw.items[2].metadata.dosage_form = "capsule";
    raw.items[3].source_classification = "actual-supplier";
    const projection = buildAuditReviewRows(raw, "own", inspectDefinitions(raw, "own"));
    expect(projection.rows).toHaveLength(4);
    expect(projection.rows.every(r => r.boxSize == null && r.supplierUnit == null)).toBe(true);
    expect(new Set(projection.rows.map(r => r.key)).size).toBe(4);
  });
  it("preserves conflicting current definitions for review without picking one or treating absence as zero", () => {
    const raw = fixture(1), identity = scientificReportIdentity(raw.items[0]).key;
    raw.settings = [28, 30].map((size, n) => ({ id: `s${n}`, pharmacy_id: "own", item_identity: identity, units_per_box: size, base_unit: "tablet", version: n + 1 }));
    const projection = buildAuditReviewRows(raw, "own", inspectDefinitions(raw, "own"));
    expect(projection.rows[0].boxSize).toBeNull(); expect(projection.rows[0].supplierUnit).toBeNull();
    expect(projection.definitions.map(d => d.boxSize)).toEqual([28, 30]);
    expect(projection.rows[0].status).toContain("عدة تعريفات");
  });
  it("counts only affected Supplier items in shared-identity definition conflicts, and keeps Actual package evidence independent", () => {
    const raw = fixture(2); raw.items[1].active_ingredient = raw.items[0].active_ingredient;
    raw.items[1].source_classification = "actual-supplier";
    const identity = scientificReportIdentity(raw.items[0]).key;
    raw.settings = [28, 30].map((size, n) => ({ id: `s${n}`, pharmacy_id: "own", item_identity: identity, units_per_box: size, base_unit: "tablet", supplier_quantity_unit: "tablet" }));
    const projection = buildAuditReviewRows(raw, "own", inspectDefinitions(raw, "own"), [{ id: raw.items[1].id, boxSize: 60, baseUnit: "tablet" }]);
    expect(projection.rows.find(r => r.source === "phif")).toMatchObject({ itemCount: 1, invoiceCount: 1, boxSize: null });
    expect(projection.rows.find(r => r.source === "actual")).toMatchObject({ itemCount: 1, invoiceCount: 1, boxSize: 60, supplierUnit: null });
    const actualKey = projection.rows.find(r => r.source === "actual")!.key;
    expect(projection.definitions.some(d => d.rowKey === actualKey)).toBe(false);
  });
  it("exports one stable reference row for multiple issues on the same orphan relationship", () => {
    const raw = emptyAuditSnapshot();
    raw.links = [{ id: "old-link", phif_invoice_item_id: "gone", is_active: false }];
    const result = buildAuditReviewRows(raw, "own", inspectDefinitions(raw, "own"));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].reasons.length).toBeGreaterThan(1);
    expect(result.rows[0]).toMatchObject({ itemCount: 0, invoiceCount: 0 });
    expect(result.records).toHaveLength(1);
  });
  it("keeps unresolved and orphan records addressable without name-only linking", () => {
    const raw = fixture(2); raw.items.forEach(i => { i.active_ingredient = "Ambiguous"; i.metadata = {}; });
    raw.settings = [{ id: "bad-definition", pharmacy_id: "own", item_identity: "invalid-key" }];
    const result = buildAuditReviewRows(raw, "own", inspectDefinitions(raw, "own"));
    expect(new Set(result.rows.map(r => r.key)).size).toBe(result.rows.length);
    expect(result.records).toContainEqual(expect.objectContaining({ id: "bad-definition", table: "phif_report_box_settings" }));
    expect(result.definitions).toContainEqual(expect.objectContaining({ id: "bad-definition", identity: "invalid-key" }));
    expect(result.rows.filter(r => r.name === "Ambiguous")).toHaveLength(2);
  });
  it("rejects stale snapshots, changed second reads, incomplete pagination and foreign records", async () => {
    const raw = fixture(10), request = await scanRequest(raw);
    raw.items[0].quantity++;
    await expect(readAuditReviewExport(database(raw), "own", request)).rejects.toThrow("تغيرت البيانات منذ");
    raw.items[0].quantity--;
    await expect(readAuditReviewExport(database(raw, { changeOnVerification: true }), "own", request)).rejects.toThrow("تغيرت البيانات أثناء");
    await expect(readAuditReviewExport(database(raw, { partial: true }), "own", request)).rejects.toThrow("جميع مصادر");
    raw.items[0].phif_invoices.pharmacy_id = "foreign";
    await expect(readAuditReviewExport(database(raw), "own", request)).rejects.toThrow("جميع مصادر");
  });
  it("authorizes current active managers before and after export; rejects employee, disabled and other-pharmacy sessions", async () => {
    vi.stubEnv("SESSION_SECRET", "test-only");
    const raw = fixture(), request = await scanRequest(raw);
    await expect(exportAuthorizedDefinitionAudit(async () => context(), database(raw), request)).resolves.toMatchObject({ pharmacyId: "own" });
    for (const [session, manager] of [[context("employee"), true], [context(), false], [context("admin", "foreign"), true]] as const) {
      const db = database(raw, { manager });
      await expect(exportAuthorizedDefinitionAudit(async () => session, db, request)).rejects.toThrow();
      expect(db.reads).toEqual([]);
    }
    let reads = 0;
    await expect(exportAuthorizedDefinitionAudit(async () => ++reads === 1 ? context() : context("admin", "foreign"), database(raw), request)).rejects.toThrow();
    await expect(exportAuthorizedDefinitionAudit(async () => context(), database(raw), { ...request, pharmacyId: "foreign" })).rejects.toThrow();
  });
});

describe("review XLSX", () => {
  it("round-trips all rows, stable keys, numeric counts, blank inputs, Arabic lists, formatting and reference IDs", async () => {
    const raw = fixture(121), request = await scanRequest(raw);
    const data = await readAuditReviewExport(database(raw), "own", request);
    data.rows[0].name = "=NOT_A_FORMULA";
    data.definitions.push({ rowKey: data.rows[0].key, id: "000123", identity: data.rows[0].identity!, version: 4, boxSize: 30, baseUnit: "tablet", supplierUnit: null });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await buildAuditReviewWorkbook(data).xlsx.writeBuffer());
    const sheet = book.getWorksheet("الأصناف للمراجعة")!;
    expect(sheet.rowCount).toBe(122);
    expect(sheet.getCell("A2").value).toBe(data.rows[0].key);
    expect(sheet.getCell("C2").value).toBe("=NOT_A_FORMULA");
    expect(sheet.getCell("H2").value).toBe(1);
    expect(sheet.getCell("J2").value).toBeNull();
    expect(sheet.getCell("M2").value).toBeNull();
    expect(sheet.getCell("N2").dataValidation.formulae).toEqual(["AuditBoxUnits"]);
    expect(sheet.getCell("O2").dataValidation.formulae).toEqual(["AuditQuantityUnits"]);
    expect(sheet.getCell("M2").dataValidation.type).toBe("whole");
    expect(sheet.views[0]).toMatchObject({ rightToLeft: true, state: "frozen", ySplit: 1 });
    expect(sheet.autoFilter).toBeTruthy();
    expect(sheet.getCell("N2").fill).not.toEqual(sheet.getCell("A2").fill);
    expect(book.getWorksheet("التعريفات المرجعية")!.getCell("B2").value).toBe("000123");
    expect(book.definedNames.model.map(n => n.name)).toEqual(expect.arrayContaining(["AuditBoxUnits", "AuditQuantityUnits"]));
    expect(book.getWorksheet("بيانات التصدير")!.getCell("B2").value).toBe("own");
  });
  it("fails explicitly rather than silently clipping stable identifiers or names beyond Excel cell limits", () => {
    const data: AuditReviewExport = { schemaVersion: 1, pharmacyId: "own", fingerprint: "a".repeat(64), ruleVersion: "definitions-2",
      auditFinishedAt: "2026-11-18T10:00:00Z", verifiedAt: "2026-11-18T10:00:00Z", findingsCount: 1, definitions: [], records: [],
      rows: [{ key: "stable", identity: null, source: "phif", name: "x".repeat(32768), strength: "", form: "", reasons: [],
        itemCount: 1, invoiceCount: 1, boxSize: null, baseUnit: null, supplierUnit: null, status: "" }] };
    expect(() => buildAuditReviewWorkbook(data)).toThrow("سعة خلية");
  });
});
