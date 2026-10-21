import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { actualUnit, actualSourceUnit, actualUnitSourceSignature, actualStockUnitSignature, actualCostUnits,
  applyActualUnitDecisions, actualConversionFactor, type ActualUnit } from "@/lib/actual-units.helpers";
import { actualUnitPreview, actualDecisionInput } from "@/lib/actual-units.preview";
import { loadActualUnitDecisions } from "@/lib/actual-units.server";
import { calculateActualGrossMargin, matchActualInvoiceItemToStock } from "@/lib/phif-stock.helpers";
import { buildManagementAuditReport } from "@/lib/management.functions";
import { actualCoverage, treasuryReportForSession, isTreasuryManager } from "@/lib/treasury-financials.helpers";
import { TIRYAQ_PHARMACY_NAME, ANDALUS_PHARMACY_NAME } from "@/lib/pharmacy-isolation";
import { readReportPages } from "@/lib/report-pages.server";
import { actualItemSignature, applyActualStockLinks } from "@/lib/actual-stock-links.helpers";
import { actualUnitAdminId, verifyActualUnitAdmin } from "@/lib/actual-units.auth";

// Medicine-only Cloud fields, no patient/card/session data. IDs below are synthetic.
const item = { id: "a", phif_invoice_id: "f1", brand: "Aspirem EC", strength: "75MG", quantity: 30,
  source_classification: "actual-supplier", metadata: {}, phif_financial_fields: { total_amount: 21 } };
const stock = { id: "s1", brand_product_id: "product", brand_name: "Aspirem EC", strength: "75MG", dosage_unit: "TABS",
  package_quantity: 56, strips_quantity: 4, cost_price: 0.563, stock_quantity: 0, is_current: true, synced_at: "2026-10-20" };
const decision = (source: any = item, target: any = stock, unit: ActualUnit = "tablet", costUnit: ActualUnit = "tablet", version = 1) => ({
  id: "decision", phif_invoice_item_id: source.id, source_signature: actualUnitSourceSignature(source),
  stock_signature: actualStockUnitSignature(target), dispensing_unit: unit, cost_unit: costUnit, is_active: true,
  version, updated_actor: "test-manager", updated_at: "2026-10-20T10:00:00Z" });
const bind = (source: any = item, target: any = stock, unit: ActualUnit = "tablet", priceUnit: ActualUnit = "tablet") =>
  applyActualUnitDecisions([source], [decision(source, target, unit, priceUnit)])[0];

describe("Actual quantity-unit documentation", () => {
  it("never certifies an invoice quantity from a commercial package suffix or dosage form", () => {
    for (const source of [item, { ...item, brand: "Aspirem EC 75MG 56TABS" }, { ...item, metadata: { dosage_form: "TABLET" } }]) {
      expect(actualSourceUnit(source).unit).toBeNull();
      expect(actualCostUnits(source, stock).issue).toBe("missing_dispensing_unit");
    }
    expect(calculateActualGrossMargin(item, [stock])).toMatchObject({ status: "pricing_unit_unverified", reason: "missing_dispensing_unit", purchaseCost: null });
    expect(matchActualInvoiceItemToStock(item, [stock]).status).toBe("matched");
  });

  it("uses explicit source units and keeps conflicts unresolved", () => {
    for (const alias of ["TAB", "TABS", "TABLET", "TABLETS", "قرص"]) {
      const source = { ...item, metadata: { quantity_unit: alias } };
      expect(actualSourceUnit(source).unit).toBe("tablet");
      expect(actualCostUnits(source, stock).provenance).toBe("source");
      expect(calculateActualGrossMargin(source, [stock]).purchaseCost).toBeCloseTo(16.89);
    }
    expect(actualSourceUnit({ metadata: { unit: "BOX", quantity_unit: "TAB" } }).issue).toBe("conflicting_dispensing_unit");
    expect(actualSourceUnit({ metadata: { quantity_unit: "unknown" } }).unit).toBeNull();
  });

  it("documents Aspirem 30 tablets as 16.890, preserving original invoice and current price provenance", () => {
    const original = JSON.stringify(item), target = JSON.stringify(stock);
    const bound = bind();
    expect(calculateActualGrossMargin(bound, [stock]).purchaseCost).toBeCloseTo(16.89);
    expect(actualCostUnits(bound, stock)).toMatchObject({ provenance: "manual", actor: "test-manager", costUnit: "tablet" });
    expect(JSON.stringify(item)).toBe(original); expect(JSON.stringify(stock)).toBe(target);
    // No invoice-date price filter in current-stock costing.
    expect(calculateActualGrossMargin(bound, [{ ...stock, synced_at: "2027-01-01" }]).status).toBe("matched");
  });

  it("converts documented strips/boxes using actual solid-dose packaging, never 10/30 defaults", () => {
    const source = { ...item, quantity: 2 };
    expect(calculateActualGrossMargin(bind(source, stock, "strip"), [stock]).purchaseCost).toBeCloseTo(2 * 14 * 0.563);
    expect(calculateActualGrossMargin(bind(source, stock, "box"), [stock]).purchaseCost).toBeCloseTo(2 * 56 * 0.563);
    for (const target of [{ ...stock, package_quantity: null }, { ...stock, strips_quantity: 3 }, { ...stock, strips_quantity: 0 }]) {
      expect(calculateActualGrossMargin(bind(source, target, "strip"), [target]).purchaseCost).toBeNull();
    }
    expect(actualConversionFactor("box", "tablet", { dosage_unit: "TAB", brand_name: "Xigduo 5/1000MG" })).toBeNull();
    expect(actualConversionFactor("box", "pen", { ...stock, dosage_unit: "PEN" })).toBeNull();
  });

  it("handles pen/vial/drops/inhaler/cream only after explicit price-unit confirmation", () => {
    for (const [brand, strength, form, unit, cost] of [
      ["APIDRA U100 SOLOSTAR 5X3ML INJ", "100IU", "PEN", "pen", 53.794],
      ["Novomix", "100IU", "PEN", "pen", 78],
      ["Synthetic vial", "1MG", "VIAL", "vial", 12],
      ["Normoptic", "0.5%", "DROPS", "drops", 11.55],
      ["Synthetic inhaler", "100MCG", "SPRAY", "inhaler", 14.9],
      ["Synthetic topical", "1%", "TUBE", "tube", 5],
    ] as const) {
      const source = { ...item, brand, strength, quantity: 1, phif_financial_fields: { total_amount: 150 } };
      const target = { ...stock, brand_name: brand, strength, dosage_unit: form, cost_price: cost, package_quantity: null, strips_quantity: null };
      expect(calculateActualGrossMargin(source, [target]).purchaseCost).toBeNull();
      expect(calculateActualGrossMargin(bind(source, target, unit, unit), [target]).purchaseCost).toBeCloseTo(cost);
    }
    expect(actualUnit("INJ")).toBeNull();
  });

  it("does not leak an approval to another item/source/quantity/stock or new invoice", () => {
    const approval = decision();
    for (const changed of [{ ...item, quantity: 31 }, { ...item, strength: "150MG" }, { ...item, metadata: { unit: "BOX" } }]) {
      expect(calculateActualGrossMargin(applyActualUnitDecisions([changed], [approval])[0], [stock]).purchaseCost).toBeNull();
    }
    expect(calculateActualGrossMargin(applyActualUnitDecisions([{ ...item, id: "other" }], [approval])[0], [stock]).purchaseCost).toBeNull();
    expect(calculateActualGrossMargin(bind(), [{ ...stock, package_quantity: 28 }]).purchaseCost).toBeNull();
    expect(calculateActualGrossMargin(bind(), [{ ...stock, cost_price: 1 }]).purchaseCost).toBe(30);
    expect(calculateActualGrossMargin(applyActualUnitDecisions([{ ...item, source_classification: "phif-supplier" }], [approval])[0], [stock]).status).toBe("phif_supplier_excluded");
  });

  it("never reads insulin package_quantity 300 as 300 pens or multiplies a pen cost by it", () => {
    // Actual current Cloud insulin rows have package_quantity=300, not a documented pen count.
    const source = { ...item, brand: "Novomix", strength: "100IU", quantity: 7, phif_financial_fields: { total_amount: 600 } };
    const target = { ...stock, brand_name: "Novomix", strength: "100IU", dosage_unit: "PEN", package_quantity: 300, strips_quantity: null, cost_price: 78 };
    expect(calculateActualGrossMargin(bind(source, target, "pen", "pen"), [target]).purchaseCost).toBe(546);
    expect(calculateActualGrossMargin(bind(source, target, "box", "pen"), [target]).purchaseCost).toBeNull();
  });

  it("honors the existing VILDAGLIPTIN→VILDATIC link without generalizing its unit decision", () => {
    const source = { ...item, brand: "VILDAGLIPTIN", strength: "50MG" };
    const target = { ...stock, brand_name: "VILDATIC", strength: "50MG", cost_price: 1.4 };
    const link = { id: "link", version: 1, phif_invoice_item_id: source.id, source_signature: actualItemSignature(source), is_active: true, target };
    const [linked] = applyActualStockLinks([source], [link]);
    const documented = bind(linked, target);
    expect(calculateActualGrossMargin(documented, [target]).purchaseCost).toBe(42);
    expect(applyActualUnitDecisions([documented], [])[0].manual_stock_link).toEqual(link);
    expect(calculateActualGrossMargin(applyActualUnitDecisions([documented], [])[0], [target]).purchaseCost).toBeNull();
    expect(calculateActualGrossMargin(applyActualStockLinks([documented], [])[0], [target]).status).toBe("needs_match_review");
    expect(documented.brand).toBe("VILDAGLIPTIN");
  });

  it("edits, revokes, reloads and recalculates decisions without altering stock identity", () => {
    const first = bind();
    const edited = applyActualUnitDecisions([first], [decision(item, stock, "strip", "tablet", 2)])[0];
    expect(calculateActualGrossMargin(edited, [stock]).purchaseCost).toBeCloseTo(30 * 14 * 0.563);
    const revoked = applyActualUnitDecisions([edited], [{ ...decision(), is_active: false, version: 3 }])[0];
    expect(calculateActualGrossMargin(revoked, [stock]).purchaseCost).toBeNull();
    expect(matchActualInvoiceItemToStock(revoked, [stock]).status).toBe("matched");
    expect(calculateActualGrossMargin(JSON.parse(JSON.stringify(first)), [stock]).purchaseCost).toBeCloseTo(16.89);
  });

  it("previews exact compatible historical rows, date scope and invoice/item exceptions", () => {
    const items = [item, { ...item, id: "b", phif_invoice_id: "f2", quantity: 28 },
      { ...item, id: "c", phif_invoice_id: "f3", strength: "150MG" }, { ...item, id: "d", source_classification: "phif-supplier" }];
    const invoices = ["f1", "f2", "f3"].map(id => ({ id, invoice_number: id, dispensing_date: id === "f2" ? "2026-08-30" : "2026-09-01" }));
    const preview = actualUnitPreview({ invoices, items, stocks: [stock], decisions: [], scope: { itemId: item.id } });
    expect(preview.summary).toEqual({ items: 2, invoices: 2, quantity: 58 });
    const input = { rows: [preview.rows[1]], dispensingUnit: "tablet" as const, costUnit: "tablet" as const, revoke: false };
    expect(actualDecisionInput(preview, input).map(e => e.item.id)).toEqual(["b"]);
    expect(() => actualDecisionInput(preview, { ...input, rows: [{ ...preview.rows[1], version: 5 }] })).toThrow("تغيرت المعاينة");
    expect(() => actualDecisionInput(preview, { ...input, rows: [preview.rows[1], preview.rows[1]] })).toThrow("مكررة");
    expect(() => actualDecisionInput(preview, { ...input, rows: [{ ...preview.rows[1], id: "foreign" }] })).toThrow();
    expect(actualUnitPreview({ invoices, items, stocks: [stock], decisions: [], scope: { itemId: item.id, dateFrom: "2026-09-01" } }).rows).toHaveLength(1);
    const mixed = [item, { ...items[1], phif_financial_fields: { total_amount: 21, quantity_unit: "BOX" } }];
    expect(actualUnitPreview({ invoices, items: mixed, stocks: [stock], decisions: [], scope: { itemId: item.id } }).rows).toHaveLength(1);
    expect(() => actualDecisionInput(preview, { ...input, costUnit: "pen" })).toThrow("وحدة التكلفة");
  });

  it("keeps request-local audit caches separate for different unit approvals and manual links", () => {
    const second = { ...item, id: "b", phif_invoice_id: "f2" };
    const report = buildManagementAuditReport({ invoices: [{ id: "f1" }, { id: "f2" }], items: [bind(), second], stocks: [stock] });
    expect(report.actual.summary).toMatchObject({ matched: 1, unmatched: 0 });
    expect(report.financial.summary).toMatchObject({ complete_invoices: 1, incomplete_invoices: 1, actual_cost_review_items: 1 });
    expect(report.actual.documented_units).toHaveLength(1);
  });

  it("separates Actual-only coverage and incomplete profit from PHIF Supplier and current-vs-historical prices", () => {
    const rows = [{ source: "actual", match_status: "matched", revenue: 21, purchase_cost: 16.89, gross_margin: 4.11 },
      { source: "actual", match_status: "pricing_unit_unverified", revenue: 20, purchase_cost: null, gross_margin: null }];
    expect(actualCoverage(rows)).toEqual({ complete_items: 1, review_items: 1, complete_revenue: 21, incomplete_revenue: 20,
      actual_cost: 16.89, actual_profit: null, price_basis: "current_stock" });
    expect(actualCoverage([rows[0]]).actual_profit).toBe(4.11);
  });

  it("scopes decision reads by pharmacy and item, fails closed on errors, supports pre-migration pages", async () => {
    const calls: any[] = [];
    const db = (error: any = null) => ({ from(table: string) { calls.push(table);
      const query = { select() { return query; }, eq(field: string, value: any) { calls.push([field, value]); return query; },
        async in(field: string, ids: string[]) { calls.push([field, ids]); return { data: [decision()], error }; } }; return query;
    } });
    const loaded = await loadActualUnitDecisions(db(), "tiryaq", [item]);
    expect(loaded.available).toBe(true);
    expect(calculateActualGrossMargin(loaded.items[0], [stock]).purchaseCost).toBeCloseTo(16.89);
    expect(calls).toContainEqual(["pharmacy_id", "tiryaq"]); expect(calls).toContainEqual(["phif_invoice_item_id", ["a"]]);
    const missing = await loadActualUnitDecisions(db({ code: "42P01" }), "tiryaq", [bind()]);
    expect(missing.available).toBe(false); expect(missing.items[0].actual_unit_decision).toBeUndefined();
    await expect(loadActualUnitDecisions(db({ code: "42501" }), "tiryaq", [item])).rejects.toThrow();
  });

  it("guards every editor/save request with the existing manager guard and never grants employees/Andalus access", () => {
    const session = (role: string, pharmacy = TIRYAQ_PHARMACY_NAME) => ({ pharmacy_id: "p", pharmacy_name: pharmacy, session: { data: { user_role: role } } });
    expect(isTreasuryManager(session("admin"))).toBe(true);
    expect(isTreasuryManager(session("employee"))).toBe(false);
    expect(isTreasuryManager(session("admin", ANDALUS_PHARMACY_NAME))).toBe(false);
    const fn = readFileSync("src/lib/actual-units.functions.ts", "utf8");
    expect(fn).toContain("await verifyActualUnitAdmin(supabaseAdmin, await requirePharmacySession(), process.env.SESSION_SECRET)"); expect(fn.match(/await previewForManager\(/g)).toHaveLength(2);
    expect(fn).toContain("confirmed: z.literal(true)"); expect(fn).toContain("actualDecisionInput(preview, data)");
    expect(fn).not.toMatch(/\.from\("phif_invoice_items"\)\.(update|insert|delete)/);
    const sql = readFileSync("supabase/migrations/20261020020000_add_actual_unit_decisions.sql", "utf8");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY"); expect(sql).toContain("FROM PUBLIC,anon,authenticated");
    expect(sql).toContain("FOR UPDATE OF i"); expect(sql).toContain("expected_version"); expect(sql).toContain("user_operation_log");
    expect(sql).not.toMatch(/(?:UPDATE|DELETE FROM) public\.(phif_invoice_items|phif_stock_items|patients)/i);
  });

  it("rejects legacy/employee/forged sessions and revalidates an active individual administrator", async () => {
    const secret = "x".repeat(32);
    const context = (role: string, id?: string, pharmacy = TIRYAQ_PHARMACY_NAME) => ({ pharmacy_id: "tiryaq", pharmacy_name: pharmacy,
      session: { data: { user_role: role, user_id: id, user_permissions: { users_manage: true } } } });
    for (const session of [context("legacy"), context("employee", "employee"), context("admin"), context("admin", "admin", ANDALUS_PHARMACY_NAME)]) {
      expect(() => actualUnitAdminId(session, secret)).toThrow();
    }
    for (const unsafe of [undefined, "short", "dev-only-session-secret-please-set-SESSION_SECRET-in-env"]) {
      expect(() => actualUnitAdminId(context("admin", "admin"), unsafe)).toThrow("سر جلسات");
    }
    const calls: any[] = [];
    const db = (row: any) => ({ from(table: string) { calls.push(table);
      const query = { select() { return query; }, eq(key: string, value: any) { calls.push([key, value]); return query; },
        async maybeSingle() { return { data: row, error: null }; } }; return query;
    } });
    expect(await verifyActualUnitAdmin(db({ id: "admin", display_name: "Verified manager" }), context("admin", "admin"), secret))
      .toMatchObject({ actorId: "admin", actor: "Verified manager", pharmacyId: "tiryaq" });
    expect(calls).toContainEqual(["pharmacy_id", "tiryaq"]); expect(calls).toContainEqual(["role", "admin"]);
    expect(calls).toContainEqual(["is_active", true]);
    await expect(verifyActualUnitAdmin(db(null), context("admin", "admin"), secret)).rejects.toThrow("صلاحية المدير");
  });

  it("accepts database-canonical signature JSON but rejects forged signatures and unproven price units", () => {
    const approval = decision();
    const reverse = (text: string) => JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(text)).reverse()), null, 2);
    const [bound] = applyActualUnitDecisions([item], [{ ...approval, source_signature: reverse(approval.source_signature), stock_signature: reverse(approval.stock_signature) }]);
    expect(calculateActualGrossMargin(bound, [stock]).purchaseCost).toBeCloseTo(16.89);
    for (const bad of ["{}", "null", "not-json"]) {
      expect(calculateActualGrossMargin(applyActualUnitDecisions([item], [{ ...approval, source_signature: bad }])[0], [stock]).purchaseCost).toBeNull();
    }
    const recorded = { ...item, phif_financial_fields: { total_amount: 21, quantity_unit: "TABLETS" } };
    expect(calculateActualGrossMargin(bind(recorded, stock, "box"), [stock]).purchaseCost).toBeNull();
    expect(calculateActualGrossMargin(bind(recorded), [stock]).purchaseCost).toBeCloseTo(16.89);
    for (const [form, unit] of [["INJ", "vial"], ["CREAM", "gram"], ["CREAM", "tube"]] as const) {
      const source = { ...item, brand: "Uncertain presentation", strength: "1MG" };
      const target = { ...stock, brand_name: source.brand, strength: source.strength, dosage_unit: form };
      expect(calculateActualGrossMargin(bind(source, target, unit, unit), [target]).purchaseCost).toBeNull();
    }
  });

  it("does not truncate historical invoices/items when the response cap is below the requested page size", async () => {
    const rows = Array.from({ length: 1007 }, (_, index) => ({ id: String(index) }));
    const query = () => ({ async range(from: number, to: number) {
      return { data: rows.slice(from, from + Math.min(37, to - from + 1)), count: rows.length, error: null };
    } });
    expect(await readReportPages(query)).toEqual(rows);
    await expect(readReportPages(() => ({ async range() { return { data: [], count: 3 }; } }))).rejects.toThrow("غير مكتملة");
    await expect(readReportPages(() => ({ async range() { return { data: [rows[0]], count: 3 }; } }))).rejects.toThrow("ترتيب");
  });

  it("reproduces the medicine-only Cloud costs after explicit tablet/pen decisions, never before them", () => {
    for (const [brand, strength, form, cost] of [
      ["Lipover", "20MG", "TABS", 1.077], ["Lipover", "40MG", "TABS", 1.378],
      ["FORMIN", "850MG", "TABS", 0.350], ["FORMIN", "500MG", "TABS", 0.284],
      ["XARELTO 15 MG TABS -28 TABS", "15MG", "TABS", 12.089],
      ["SYNJARDY 12.5 /1000MG, FICTA-60 TABS", "12.5/1000MG", "TABS", 3.6],
      ["JARDIANCE 10 MG , FICTA BLI - 30 Tabs", "10MG", "TABS", 5.998],
    ] as const) {
      const source = { ...item, brand, strength, quantity: brand.startsWith("XARELTO") ? 28 : 30 };
      const target = { ...stock, brand_name: brand, strength, dosage_unit: form, cost_price: cost,
        package_quantity: brand.startsWith("SYNJARDY") ? 60 : brand.startsWith("XARELTO") ? 28 : 30 };
      expect(matchActualInvoiceItemToStock(source, [target]).status).toBe("matched");
      expect(calculateActualGrossMargin(source, [target]).purchaseCost).toBeNull();
      expect(calculateActualGrossMargin(bind(source, target), [target]).purchaseCost).toBeCloseTo(source.quantity * cost);
    }
  });
});
