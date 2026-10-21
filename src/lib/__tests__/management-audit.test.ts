import { describe, expect, it } from "vitest";
import { buildManagementAuditReport } from "@/lib/management.functions";
import { calculateActualGrossMargin } from "@/lib/phif-stock.helpers";
import { readFileSync } from "node:fs";

const invoice = {
  id: "invoice-1",
  invoice_number: "1001",
  invoice_key: "2026-1001",
  beneficiary_name: "مستفيد",
  dispensing_date: "2026-09-20",
};

function actualItem(overrides: Record<string, unknown>) {
  return {
    id: `item-${Math.random()}`,
    phif_invoice_id: "invoice-1",
    source_classification: "actual-supplier",
    active_ingredient: "INSULIN GLULISINE",
    brand: "APIDRA U100 SOLOSTAR 5X3ML INJ",
    strength: "U100",
    quantity: 5,
    metadata: { unit: "PEN" },
    phif_financial_fields: { total_amount: 50 },
    ...overrides,
  };
}

function stock(overrides: Record<string, unknown>) {
  return {
    source_stock_id: `stock-${Math.random()}`,
    brand_name: "APIDRA SOLOSTAR U100 INJECTION PEN",
    active_ingredient: "INSULIN GLULISINE",
    strength: "100IU",
    dosage_unit: "PEN",
    cost_price: 8,
    synced_at: "2026-09-19T00:00:00Z",
    ...overrides,
  };
}

describe("management audit center", () => {
  it("separates a matched identity with unknown units from unmatched items and incomplete financials", () => {
    const item = actualItem({ brand: "Unverified injection", strength: "100MG", metadata: {} });
    const candidate = stock({ brand_name: "Unverified injection", strength: "100MG", dosage_unit: "INJ" });
    const report = buildManagementAuditReport({ invoices: [invoice], items: [item], stocks: [candidate] });
    expect(report.actual.summary).toMatchObject({ matched: 1, unmatched: 0, ambiguous: 0, cost_review: 1, match_ratio: 1 });
    expect(report.actual.issues).toHaveLength(0);
    expect(report.actual.cost_reviews[0]).toMatchObject({ status: "matched", cost_review_count: 1, reason: null });
    expect(report.financial.summary).toMatchObject({ complete_invoices: 0, incomplete_invoices: 1, actual_unmatched_items: 0, actual_cost_review_items: 1 });
    expect(calculateActualGrossMargin(item, [candidate])).toMatchObject({ status: "pricing_unit_unverified", purchaseCost: null, grossMargin: null });
  });

  it("keeps quantity-unit conflicts and missing prices in cost review without rejecting the product identity", () => {
    for (const [item, candidate] of [
      [actualItem({ metadata: { unit: "BOX" } }), stock({})],
      [actualItem({}), stock({ cost_price: null })],
    ]) {
      const report = buildManagementAuditReport({ invoices: [invoice], items: [item], stocks: [candidate] });
      expect(report.actual.summary.matched).toBe(1);
      expect(report.actual.summary.unmatched).toBe(0);
      expect(report.actual.summary.cost_review).toBe(1);
      expect(report.financial.summary.actual_unmatched_items).toBe(0);
      expect(report.financial.summary.incomplete_invoices).toBe(1);
      expect(calculateActualGrossMargin(item, [candidate]).grossMargin).toBeNull();
    }
  });

  it("groups complete and cost-review occurrences under one matched identity without inflating unmatched statistics", () => {
    const base = { brand: "Allopurinol", strength: "100MG" };
    const report = buildManagementAuditReport({ invoices: [invoice],
      items: [actualItem({ ...base, metadata: {} }), actualItem({ ...base, metadata: { unit: "TAB" } })],
      stocks: [stock({ ...base, brand_name: base.brand, dosage_unit: "TABLETS", cost_price: 0 })] });
    expect(report.actual.summary).toMatchObject({ total_unique: 1, matched: 1, cost_review: 1, unmatched: 0 });
    expect(report.actual.cost_reviews[0]).toMatchObject({ occurrence_count: 2, cost_review_count: 1 });
  });

  it("exposes separate cost-review sections in audit and correct review labels in financial views", () => {
    const audit = readFileSync("src/routes/management.audit.tsx", "utf8");
    const treasury = readFileSync("src/routes/management.treasury.tsx", "utf8");
    const reports = readFileSync("src/components/management/ReportsViews.tsx", "utf8");
    expect(audit).toContain("actual.cost_reviews");
    expect(audit).toContain("financial.summary.actual_cost_review_items");
    expect(audit).toContain("التكلفة تحتاج مراجعة");
    expect(treasury).toContain('if (item.match_status === "pricing_unit_unverified") return "التكلفة تحتاج مراجعة"');
    expect(reports).toContain('row.match_status === "pricing_unit_unverified" ? "التكلفة تحتاج مراجعة"');
  });
  it("reports matched Actual items with the current Actual matcher", () => {
    const report = buildManagementAuditReport({
      invoices: [invoice],
      items: [actualItem({})],
      stocks: [stock({})],
    });

    expect(report.actual.summary.total_unique).toBe(1);
    expect(report.actual.summary.matched).toBe(1);
    expect(report.actual.summary.unmatched).toBe(0);
    expect(report.actual.issues).toHaveLength(0);
    expect(report.financial.summary.complete_invoices).toBe(0);
    expect(report.financial.summary.actual_cost_review_items).toBe(1);
  });

  it("does not make supplier differences fail Actual audit or invoice completion", () => {
    const report = buildManagementAuditReport({
      invoices: [invoice],
      items: [actualItem({
        supplier: "Invoice Supplier",
        metadata: { unit: "PEN", supplier_id: "invoice-supplier" },
        phif_financial_fields: { total_amount: 50, supplier_id: "invoice-supplier" },
      })],
      stocks: [stock({
        supplier_id: "stock-supplier",
        supplier_name: "Stock Supplier",
      })],
    });

    expect(report.actual.summary.matched).toBe(1);
    expect(report.actual.summary.ambiguous).toBe(0);
    expect(report.actual.summary.unmatched).toBe(0);
    expect(report.financial.summary.complete_invoices).toBe(0);
    expect(report.financial.summary.actual_cost_review_items).toBe(1);
    expect(report.financial.summary.actual_unmatched_items).toBe(0);
  });

  it("reports unmatched Actual items with a clear reason", () => {
    const report = buildManagementAuditReport({
      invoices: [invoice],
      items: [actualItem({ brand: "UNKNOWN BRAND", active_ingredient: "UNKNOWN", strength: "5MG" })],
      stocks: [stock({})],
    });

    expect(report.actual.summary.unmatched).toBe(1);
    expect(report.actual.issues[0].reason).toBe("NO_STOCK_MATCH");
    expect(report.financial.summary.actual_unmatched_items).toBe(1);
  });

  it("keeps ambiguous Actual candidates for review instead of selecting one", () => {
    const report = buildManagementAuditReport({
      invoices: [invoice],
      items: [actualItem({})],
      stocks: [
        stock({ source_stock_id: "stock-a", cost_price: 8 }),
        stock({ source_stock_id: "stock-b", cost_price: 9 }),
      ],
    });

    expect(report.actual.summary.ambiguous).toBe(1);
    expect(report.actual.issues[0].status).toBe("ambiguous");
    expect(report.actual.issues[0].candidates).toHaveLength(2);
    expect(report.financial.summary.actual_unmatched_items).toBe(1);
  });

  it("counts PHIF Supplier missing cost and incomplete invoices without writing data", () => {
    const report = buildManagementAuditReport({
      invoices: [invoice],
      items: [{
        id: "phif-item-1",
        phif_invoice_id: "invoice-1",
        source_classification: "phif-supplier",
        active_ingredient: "METFORMIN",
        brand: null,
        strength: "500MG",
        quantity: 30,
        metadata: { unit: "TAB" },
        phif_financial_fields: { total_amount: 20 },
      }],
      stocks: [],
    });

    expect(report.financial.summary.incomplete_invoices).toBe(1);
    expect(report.financial.summary.phif_missing_cost_items).toBe(1);
    expect(report.financial.incomplete_invoices[0].reasons).toContain("PHIF Supplier بدون تكلفة محفوظة");
  });
});
