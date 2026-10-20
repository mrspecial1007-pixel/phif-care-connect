import { describe, expect, it } from "vitest";
import { buildManagementAuditReport } from "@/lib/management.functions";
import { calculateActualGrossMargin, currentStockCandidatesForActual, matchActualInvoiceItemToStock } from "@/lib/phif-stock.helpers";

// Medicine-only fields read from Tiryaq Cloud on 2026-10-20. No patient or session data.
const examples = [
  { brand: "XARELTO 15 MG TABS -28 TABS", strength: "15MG", quantity: 28, value: 364,
    stockBrand: "XARELTO 15 MG TABS -28 TABS", product: "1963", pack: "28", strips: "2", balance: "42", cost: "12.089000" },
  { brand: "SYNJARDY 12.5 /1000MG, FICTA-60 TABS", strength: "12.5/1000MG", quantity: 30, value: 120,
    stockBrand: "SYNJARDY 12.5 /1000MG, FICTA-60 TABS", product: "1960", pack: "60", strips: "6", balance: "72", cost: "3.600000" },
  { brand: "JARDIANCE 10 MG , FICTA BLI - 30 Tabs", strength: "10MG", quantity: 30, value: 189,
    stockBrand: "JARDIANCE 10 MG  , FICTA BLI - 30 Tabs", product: "1958", pack: "30", strips: "3", balance: "0", cost: "5.998000" },
];

function item(example = examples[0]) {
  return { id: example.product, phif_invoice_id: example.product, brand: example.brand, strength: example.strength,
    source_classification: "actual-supplier", quantity: example.quantity, metadata: {}, phif_financial_fields: { total_amount: example.value } };
}
function stock(example = examples[0]) {
  return { brand_name: example.stockBrand, strength: example.strength, brand_product_id: example.product,
    package_quantity: example.pack, strips_quantity: example.strips, stock_quantity: example.balance,
    dosage_unit: "TABS", source_quantity_unit: "TABS", cost_price: example.cost, is_current: true };
}

describe("Actual imported package descriptions", () => {
  it("keeps Cloud identities matched but requires documented quantity units rather than brand suffixes", () => {
    for (const example of examples) {
      const result = calculateActualGrossMargin(item(example), [stock(example)]);
      expect(result.status).toBe("pricing_unit_unverified");
      expect(result.stock?.brand_product_id).toBe(example.product);
      expect(result.purchaseCost).toBeNull();
      const documented = calculateActualGrossMargin({ ...item(example), metadata: { quantity_unit: "TAB" } }, [stock(example)]);
      expect(documented.purchaseCost).toBeCloseTo(example.quantity * Number(example.cost), 6);
      expect(documented.grossMargin).toBeCloseTo(example.value - example.quantity * Number(example.cost), 6);
    }
  });

  it("updates the audit and financial completeness from the same imported rows including zero-balance batches", () => {
    const rows = examples.map(item);
    const report = buildManagementAuditReport({ invoices: rows.map(row => ({ id: row.phif_invoice_id, dispensing_date: "2026-04-01" })),
      items: rows, stocks: [...examples.map(stock), stock(examples[2]), stock(examples[2])] });
    expect(report.actual.summary.matched).toBe(3);
    expect(report.financial.summary.complete_invoices).toBe(0);
    expect(report.financial.summary.actual_cost_review_items).toBe(3);
    expect(report.financial.summary.actual_unmatched_items).toBe(0);
  });

  it("reads a documented compact package suffix without treating its number as part of the brand", () => {
    expect(calculateActualGrossMargin({ ...item(), brand: "XARELTO 15MG-28TAB", metadata: { unit: "TAB" } }, [stock()])).toMatchObject({ status: "matched", purchaseCost: 338.492 });
  });

  it("never interprets a compound strength component as a package count", () => {
    for (const brand of ["Xigduo® 5/1000 Tabs", "Xigduo® 5/1000MG Tabs", "Xigduo® 5/1000MG 60 Tabs"]) {
      const row = { ...item(), brand, strength: "5MG / 1000MG", quantity: 60 };
      const candidate = { ...stock(), brand_name: "Xigduo® 5/1000 Tabs", strength: "5MG / 1000MG", package_quantity: "60", cost_price: "4.350000" };
      expect(matchActualInvoiceItemToStock(row, [candidate]).status).toBe("matched");
      expect(calculateActualGrossMargin({ ...row, metadata: { unit: "TAB" } }, [candidate]).purchaseCost).toBe(261);
      expect(calculateActualGrossMargin(row, [candidate]).purchaseCost).toBeNull();
      expect(matchActualInvoiceItemToStock({ ...row, strength: "5MG/850MG" }, [candidate]).status).toBe("needs_match_review");
    }
  });

  it("keeps VILDAGLIPTIN separate from the different VILDATIC commercial brand", () => {
    const row = { ...item(), brand: "VILDAGLIPTIN", strength: "50MG", quantity: 30, phif_financial_fields: { total_amount: 50.46 } };
    const candidate = { ...stock(), brand_name: "VILDATIC", strength: "50MG", package_quantity: "30", cost_price: "1.400000" };
    expect(matchActualInvoiceItemToStock(row, [candidate])).toMatchObject({ status: "needs_match_review", reason: "no_match" });
    expect(calculateActualGrossMargin(row, [candidate]).purchaseCost).toBeNull();
  });

  it("rejects different full strengths, forms and package counts", () => {
    for (const candidate of [
      { ...stock(), strength: "10MG" }, { ...stock(), dosage_unit: "CAPS" },
      { ...stock(), package_quantity: "30" },
      { ...stock(), brand_name: "XARELTO 15MG 30 TABS", package_quantity: null },
    ]) expect(matchActualInvoiceItemToStock(item(), [candidate]).status).toBe("needs_match_review");
    expect(matchActualInvoiceItemToStock(item(examples[1]), [{ ...stock(examples[1]), strength: "12.5/850MG" }]).status).toBe("needs_match_review");
  });

  it("keeps different costs ambiguous and excludes historical rows without excluding empty stock", () => {
    expect(matchActualInvoiceItemToStock(item(), [stock(), { ...stock(), cost_price: "10" }])).toMatchObject({ reason: "ambiguous_match" });
    const candidates = currentStockCandidatesForActual(item(), [stock(), { ...stock(), is_current: false, cost_price: "10" }]);
    expect(candidates).toHaveLength(1);
    expect(calculateActualGrossMargin({ ...item(), metadata: { unit: "TAB" } }, candidates).status).toBe("matched");
    expect(calculateActualGrossMargin({ ...item(examples[2]), metadata: { unit: "TAB" } }, [stock(examples[2])]).status).toBe("matched");
  });

  it("does not erase numbers belonging to the commercial brand using stock package metadata", () => {
    const row = { ...item(), brand: "PRODUCT 30 15MG TABS" };
    expect(matchActualInvoiceItemToStock(row, [{ ...stock(), brand_name: "PRODUCT 15MG TABS", package_quantity: "30" }]).status).toBe("needs_match_review");
  });

  it("never calculates unknown or conflicting quantity units as a documented unit cost", () => {
    expect(matchActualInvoiceItemToStock({ ...item(), metadata: { unit: "BOX" } }, [stock()]).status).toBe("matched");
    expect(matchActualInvoiceItemToStock({ ...item(), metadata: { unit: "BOX", dosage_form: "CAPS" } }, [stock()])).toMatchObject({ status: "needs_match_review", reason: "unit_mismatch" });
    expect(calculateActualGrossMargin({ ...item(), metadata: { unit: "BOX" } }, [stock()]).purchaseCost).toBeCloseTo(28 * 28 * 12.089);
    expect(calculateActualGrossMargin({ ...item(), metadata: { unit: "BOX", quantity_unit: "TAB" } }, [stock()]).purchaseCost).toBeNull();
    expect(calculateActualGrossMargin({ ...item(), brand: "XARELTO" }, [{ ...stock(), brand_name: "XARELTO" }])).toMatchObject({ status: "pricing_unit_unverified", purchaseCost: null });
    expect(calculateActualGrossMargin(item(), [{ ...stock(), cost_price: null }]).purchaseCost).toBeNull();
  });
});
