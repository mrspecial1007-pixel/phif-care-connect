import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { actualItemSignature, actualReferenceItem, applyActualStockLinks, type ActualStockLink } from "@/lib/actual-stock-links.helpers";
import { calculateActualGrossMargin, matchActualInvoiceItemToStock, validateActualStockLink } from "@/lib/phif-stock.helpers";
import { buildManagementAuditReport } from "@/lib/management.functions";
import { buildMonthlyReport, reportDrugIdentityKey } from "@/lib/reports.helpers";
import { loadActualStockLinks } from "@/lib/actual-stock-links.server";
import { isTreasuryManager } from "@/lib/treasury-financials.helpers";
import { TIRYAQ_PHARMACY_NAME, ANDALUS_PHARMACY_NAME } from "@/lib/pharmacy-isolation";

// Medicine fields verified in Cloud for invoice 4535722. Identifiers below are synthetic.
const item = { id: "item", phif_invoice_id: "invoice", brand: "VILDAGLIPTIN", active_ingredient: "VILDAGLIPTIN", strength: "50MG",
  quantity: 30, source_classification: "actual-supplier", metadata: {}, phif_financial_fields: { total_amount: 50.46 } };
const target = { source_stock_id: "stock", brand_product_id: "1314", brand_name: "VILDATIC", strength: "50MG", dosage_unit: "TABS", package_quantity: "30", strips_quantity: "3", cost_price: "1.400000", is_current: true };
function link(source = item, overrides: Partial<ActualStockLink> = {}): ActualStockLink {
  return { id: "decision", version: 1, phif_invoice_item_id: source.id, source_signature: actualItemSignature(source), is_active: true, target, ...overrides };
}

describe("manual Actual stock identity links", () => {
  it("confirms only the linked VILDAGLIPTIN item and applies the pharmacy tablet policy without rewriting imports", () => {
    const before = JSON.stringify(item);
    expect(matchActualInvoiceItemToStock(item, [target]).status).toBe("needs_match_review");
    const [bound] = applyActualStockLinks([item], [link()]);
    expect(matchActualInvoiceItemToStock(bound, [target])).toMatchObject({ status: "matched", reason: "manual_link" });
    expect(calculateActualGrossMargin(bound, [target])).toMatchObject({ status: "matched", purchaseCost: 42, grossMargin: 8.46, reason: "confirmed_tablet_quantity" });
    expect(actualReferenceItem(bound).brand).toBe("VILDATIC");
    expect(bound.brand).toBe("VILDAGLIPTIN");
    expect(JSON.stringify(item)).toBe(before);
    const report = buildManagementAuditReport({ invoices: [{ id: "invoice" }], items: [bound], stocks: [target] });
    expect(report.actual.summary).toMatchObject({ matched: 1, unmatched: 0, cost_review: 0, automatic_cost_items: 1 });
    expect(report.actual.manual_matches[0].manual_match).toBe(true);
  });

  it("edits the reference and revokes it back to automatic rules without duplicating movements", () => {
    const documented = { ...item, metadata: { unit: "TAB" } };
    const second = { ...target, brand_product_id: "second", brand_name: "OTHER CONFIRMED BRAND", cost_price: 2 };
    const firstRead = applyActualStockLinks([documented], [link(documented)]);
    expect(calculateActualGrossMargin(firstRead[0], [target, second]).purchaseCost).toBe(42);
    const edited = applyActualStockLinks([documented], [link(documented, { target: second, version: 2 })]);
    expect(edited).toHaveLength(1);
    expect(calculateActualGrossMargin(edited[0], [target, second]).purchaseCost).toBe(60);
    expect(applyActualStockLinks([documented], [link(documented)]).length).toBe(1);
    const revoked = applyActualStockLinks([documented], [link(documented, { is_active: false, version: 3 })]);
    expect(matchActualInvoiceItemToStock(revoked[0], [target]).status).toBe("needs_match_review");
    expect(matchActualInvoiceItemToStock(applyActualStockLinks(firstRead, [link(documented, { is_active: false })])[0], [target]).status).toBe("needs_match_review");
  });

  it("never generalizes to another item, concentration, source or changed imported identity", () => {
    const other = { ...item, id: "other-item" };
    const [first, second] = applyActualStockLinks([item, other], [link()]);
    expect(matchActualInvoiceItemToStock(first, [target]).status).toBe("matched");
    expect(matchActualInvoiceItemToStock(second, [target]).status).toBe("needs_match_review");
    for (const changed of [{ ...item, strength: "100MG" }, { ...item, source_classification: "phif-supplier" }]) {
      expect((applyActualStockLinks([changed], [link()])[0] as any).manual_stock_link).toBeUndefined();
    }
    expect(() => validateActualStockLink({ ...item, strength: "100MG" }, target)).toThrow();
    expect(() => validateActualStockLink({ ...item, metadata: { dosage_form: "CAP" } }, target)).toThrow();
    expect(() => validateActualStockLink({ ...item, metadata: { package_quantity: 60 } }, target)).toThrow();
  });

  it("uses current costs only and leaves unavailable targets, conflicting costs and quantity units for review", () => {
    const documented = { ...item, metadata: { unit: "TAB" } };
    const [bound] = applyActualStockLinks([documented], [link(documented)]);
    const conflict = calculateActualGrossMargin(bound, [target, { ...target, cost_price: 2 }]);
    expect(conflict).toMatchObject({ status: "pricing_unit_unverified", purchaseCost: null, grossMargin: null });
    expect(matchActualInvoiceItemToStock(bound, [{ ...target, is_current: false }])).toMatchObject({ reason: "manual_target_unavailable" });
    expect(matchActualInvoiceItemToStock(bound, [{ ...target, strength: "100MG" }])).toMatchObject({ reason: "manual_target_unavailable" });
    const boxes = { ...item, metadata: { quantity_unit: "BOX" } };
    expect(calculateActualGrossMargin(applyActualStockLinks([boxes], [link(boxes)])[0], [target]).purchaseCost).toBe(30 * 30 * 1.4);
  });

  it("uses the unified brand tracking key but keeps each saved item once", () => {
    const [bound] = applyActualStockLinks([item], [link()]);
    expect(reportDrugIdentityKey(bound, "brand")).toBe(reportDrugIdentityKey({ ...item, brand: "VILDATIC" }, "brand"));
    expect([bound].reduce((sum, row) => sum + row.quantity, 0)).toBe(30);
    const second = { ...item, id: "other", phif_invoice_id: "second", brand: "VILDATIC" };
    const report = buildMonthlyReport({ dateFrom: "2026-10-01", dateTo: "2026-10-31", source: "actual", groupBy: "brand", sortBy: "quantity", topLimit: "all",
      invoices: ["invoice", "second"].map(id => ({ id, insurance_card_number: "00123", dispensing_date: "2026-10-06" })), items: [bound, second] });
    expect(report.top_drugs).toHaveLength(1);
    expect(report.top_drugs[0]).toMatchObject({ brand: "VILDATIC", quantity: 60 });
    expect(report.summary.unique_patient_count).toBe(1);
  });

  it("scopes link reads and gracefully preserves existing reports before migration, but never swallows other errors", async () => {
    const calls: any[] = [];
    const db = (error: any = null) => ({ from(table: string) {
      calls.push(table);
      const q = { select() { return q; }, eq(field: string, value: any) { calls.push([field, value]); return q; }, async in() { return { data: [link()], error }; } };
      return q;
    } });
    expect((await loadActualStockLinks(db(), "tiryaq", [item])).items[0].manual_stock_link).toBeDefined();
    expect(calls).toContainEqual(["pharmacy_id", "tiryaq"]);
    expect(calls).toContainEqual(["is_active", true]);
    expect((await loadActualStockLinks(db({ code: "42P01" }), "tiryaq", [item])).available).toBe(false);
    await expect(loadActualStockLinks(db({ code: "42501" }), "tiryaq", [item])).rejects.toThrow();
  });

  it("requires a server-verified Tiryaq manager and keeps writes atomic with audit logging and optimistic locking", () => {
    const context = { pharmacy_id: "tiryaq", pharmacy_name: TIRYAQ_PHARMACY_NAME, session: { data: { user_role: "admin" } } };
    expect(isTreasuryManager(context)).toBe(true);
    expect(isTreasuryManager({ ...context, session: { data: { user_role: "employee", user_permissions: { users_manage: true } } } })).toBe(false);
    expect(isTreasuryManager({ ...context, pharmacy_name: ANDALUS_PHARMACY_NAME })).toBe(false);
    const server = readFileSync("src/lib/actual-stock-links.functions.ts", "utf8");
    expect(server).toContain("if (!isTreasuryManager(context)) throw");
    expect(server).toContain('confirmed: z.literal(true)');
    expect(server).toContain('.eq("invoice.pharmacy_id", pharmacyId)');
    expect(server).toContain('db.rpc("set_phif_actual_stock_link"');
    const migration = readFileSync("supabase/migrations/20261020010000_add_phif_actual_stock_links.sql", "utf8");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("FOR UPDATE OF i");
    expect(migration).toContain("<> p_expected_version");
    expect(migration).toContain("INSERT INTO public.user_operation_log");
    expect(migration).not.toMatch(/(?:UPDATE|DELETE FROM) public\.(?:phif_invoices|phif_invoice_items|phif_stock_items|patients)\b/);
    const ui = readFileSync("src/components/management/ActualStockLinkEditor.tsx", "utf8");
    expect(ui).toContain("lock.current");
    expect(ui).toContain("management_profit_analysis");
    expect(ui).toContain("expectedVersion: existing?.version ?? 0");
  });
});
