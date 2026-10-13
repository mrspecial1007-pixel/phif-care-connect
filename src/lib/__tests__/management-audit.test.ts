import { describe, expect, it } from "vitest";
import { buildManagementAuditReport } from "@/lib/management.functions";

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
    expect(report.financial.summary.complete_invoices).toBe(1);
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
    expect(report.financial.summary.complete_invoices).toBe(1);
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
