import { describe, expect, it } from "vitest";
import { calculateActualGrossMargin } from "@/lib/phif-stock.helpers";
import { buildManagementAuditReport } from "@/lib/management.functions";
import { actualCoverage } from "@/lib/treasury-financials.helpers";

// Medicine-only Cloud fields; fixture invoice/item identifiers are synthetic.
const item = { id: "tablet", phif_invoice_id: "invoice", brand: "Rosuvastatin", strength: "10MG", quantity: 28,
  source_classification: "actual-supplier", metadata: {}, phif_financial_fields: { total_amount: 100 } };
const stock = { brand_name: "Rosuvastatin", strength: "10MG", dosage_unit: "TABS", cost_price: "0.535000",
  sale_price: "999.000", package_quantity: 28, strips_quantity: 2, is_current: true };

describe("pharmacy-confirmed Actual tablet quantities", () => {
  it("costs Rosuvastatin 28/30/56 tablets independently of current sale price or package size", () => {
    for (const [quantity, cost] of [[28,14.980], [30,16.050], [56,29.960]]) {
      for (const sale_price of [999, null, 0]) {
        const result = calculateActualGrossMargin({ ...item, quantity }, [{ ...stock, sale_price }]);
        expect(result).toMatchObject({ status: "matched", invoiceValue: 100, purchaseCost: cost,
          reason: "confirmed_tablet_quantity", units: { dispensingUnit: "tablet", costUnit: "tablet", factor: 1,
            provenance: "pharmacy_tablet_policy" } });
        expect(result.grossMargin).toBeCloseTo(100 - cost, 3);
      }
    }
    expect(calculateActualGrossMargin(item, [stock, { ...stock, sale_price: 1 }]).purchaseCost).toBe(14.98);
  });

  it("handles all seven remaining Cloud tablet identities and variable Methotrexate quantities", () => {
    for (const [brand,strength,quantity,cost,expected] of [
      ["Rosuvastatin","10MG",28,.535,14.980], ["ROSUVASTATIN","20MG",28,.710,19.880],
      ["Warfarin","1MG",28,.325,9.100], ["Liptin 40mg","40MG",30,.767,23.010],
      ["Methotrexate","2.5MG",20,1.395,27.900], ["Methotrexate","2.5MG",40,1.395,55.800],
      ["BLOCOR 10mg","10MG",30,.467,14.010], ["Warfarin","5MG",28,.4,11.200],
    ] as const) {
      expect(calculateActualGrossMargin({ ...item, brand, strength, quantity }, [{ ...stock, brand_name: brand, strength, cost_price: cost }]))
        .toMatchObject({ status: "matched", purchaseCost: expected, reason: "confirmed_tablet_quantity" });
    }
  });

  it("does not extend the tablet policy to capsules, pens, vials or unknown presentations", () => {
    for (const dosage_unit of ["CAPS", "PEN", "VIAL", "INJ", "CREAM"]) {
      expect(calculateActualGrossMargin(item, [{ ...stock, dosage_unit }]).purchaseCost).toBeNull();
    }
    expect(calculateActualGrossMargin({ ...item, source_classification: "phif-supplier" }, [stock]).status).toBe("phif_supplier_excluded");
    expect(calculateActualGrossMargin({ ...item, brand: "Another brand" }, [stock]).purchaseCost).toBeNull();
    expect(calculateActualGrossMargin({ ...item, strength: "5MG" }, [stock]).purchaseCost).toBeNull();
  });

  it("preserves explicit quantity units and blocks conflicts, stale decisions and uncertain costs", () => {
    const boxes = { ...item, quantity: 2, metadata: { quantity_unit: "BOX" } };
    expect(calculateActualGrossMargin(boxes, [stock])).toMatchObject({ purchaseCost: 29.96, units: { dispensingUnit: "box", factor: 28, provenance: "source" } });
    for (const metadata of [{ unit: "BOX", quantity_unit: "TAB" }, { quantity_unit: "unknown" }]) {
      expect(calculateActualGrossMargin({ ...item, metadata }, [stock]).purchaseCost).toBeNull();
    }
    for (const cost_price of [null, 0, -1]) expect(calculateActualGrossMargin(item, [{ ...stock, cost_price }]).purchaseCost).toBeNull();
    expect(calculateActualGrossMargin(item, [stock, { ...stock, cost_price: .6 }]).purchaseCost).toBeNull();
    const stale = { ...item, actual_unit_decision: { is_active: true, source_signature: "{}", stock_signature: "{}" } };
    expect(calculateActualGrossMargin(stale as any, [stock])).toMatchObject({ purchaseCost: null, reason: "stale_unit_decision" });
  });

  it("updates audit and Actual-only treasury coverage without writing imported fields", () => {
    const before = JSON.stringify({ item, stock });
    const result = calculateActualGrossMargin(item, [stock]);
    const report = buildManagementAuditReport({ invoices: [{ id: "invoice" }], items: [item], stocks: [stock] });
    expect(report.financial.summary).toMatchObject({ complete_invoices: 1, actual_cost_review_items: 0, actual_unmatched_items: 0 });
    expect(report.actual.summary).toMatchObject({ automatic_cost_items: 1, matched: 1, unmatched: 0 });
    expect(actualCoverage([{ source: "actual", match_status: result.status, revenue: result.invoiceValue,
      purchase_cost: result.purchaseCost, gross_margin: result.grossMargin }]))
      .toMatchObject({ complete_items: 1, review_items: 0, actual_cost: 14.980, actual_profit: 85.020, price_basis: "current_stock" });
    expect(JSON.stringify({ item, stock })).toBe(before);
  });
});
