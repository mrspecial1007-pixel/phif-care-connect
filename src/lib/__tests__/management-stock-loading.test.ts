import { describe, expect, it } from "vitest";
import { buildManagementAuditReport, loadStockWithCosts } from "@/lib/management.functions";
import { calculateActualGrossMargin, matchActualInvoiceItemToStock } from "@/lib/phif-stock.helpers";

const examples = [
  ["XARELTO", "15MG"], ["SYNJARDY", "12.5/1000MG"],
  ["JARDIANCE", "10MG"], ["VILDAGLIPTIN", "50MG"],
];
function stock(id: string, brand = "OTHER", strength = "5MG", overrides: any = {}) {
  return { id, source_stock_id: id, pharmacy_id: "tiryaq", is_current: true,
    brand_name: `${brand} ${strength} TABLETS`, strength, dosage_unit: "TABLETS",
    cost_price: 0.5, stock_quantity: 0, supplier_id: "stock-supplier", ...overrides };
}
function invoiceItem(brand: string, strength: string) {
  return { id: brand, phif_invoice_id: "invoice", brand: `${brand} ${strength}`, strength,
    source_classification: "actual-supplier", quantity: 30,
    metadata: { unit: "TAB", supplier_id: "different-invoice-supplier" },
    phif_financial_fields: { total_amount: 30 } };
}
function stockDb(rows: any[], cap = 1000, options: { failAt?: number; emptyAt?: number; repeatPage?: boolean } = {}) {
  const calls: any[] = [];
  return { calls, from(table: string) {
    expect(table).toBe("phif_stock_items");
    let filtered = [...rows];
    const query = {
      select(fields: string, opts: any) { calls.push(["select", fields, opts]); return query; },
      eq(field: string, value: any) { calls.push(["eq", field, value]); filtered = filtered.filter(row => row[field] === value); return query; },
      order(field: string, opts: any) { calls.push(["order", field, opts]); filtered.sort((a, b) => String(a[field]).localeCompare(String(b[field]))); return query; },
      async range(from: number, to: number) {
        calls.push(["range", from, to]);
        if (options.failAt !== undefined && from >= options.failAt) return { data: null, error: { message: "read failed" }, count: null };
        if (options.emptyAt !== undefined && from >= options.emptyAt) return { data: [], error: null, count: filtered.length };
        const start = options.repeatPage ? 0 : from;
        return { data: filtered.slice(start, start + Math.min(cap, to - from + 1)), error: null, count: filtered.length };
      },
    };
    return query;
  } };
}

describe("complete current stock for Actual matching", () => {
  it("loads products beyond 1000 rows for both audit and financial calculations", async () => {
    const fillers = Array.from({ length: 1001 }, (_, i) => stock(String(i).padStart(5, "0")));
    const products = examples.map(([brand, strength], i) => stock(`z-${i}`, brand, strength));
    const db = stockDb([...fillers, ...products]);
    const loaded = await loadStockWithCosts(db, "tiryaq");
    expect(loaded).toHaveLength(1005);
    expect(db.calls).toContainEqual(["order", "id", { ascending: true }]);
    expect(db.calls).toContainEqual(["range", 1000, 1999]);
    const items = examples.map(([brand, strength]) => invoiceItem(brand, strength));
    for (const item of items) {
      // This reproduces the failure when a single API response only includes the first page.
      expect(matchActualInvoiceItemToStock(item, fillers).status).toBe("needs_match_review");
      const margin = calculateActualGrossMargin(item, loaded);
      expect(margin.status).toBe("matched");
      expect(margin.purchaseCost).toBe(15);
      expect(margin.grossMargin).toBe(15);
    }
    const report = buildManagementAuditReport({ invoices: [{ id: "invoice", dispensing_date: "2026-09-20" }], items, stocks: loaded });
    expect(report.actual.summary.matched).toBe(4);
    expect(report.financial.summary.complete_invoices).toBe(1);
  });

  it("handles smaller API row caps without skipping records", async () => {
    const db = stockDb(Array.from({ length: 5 }, (_, i) => stock(String(i))), 2);
    expect(await loadStockWithCosts(db, "tiryaq")).toHaveLength(5);
    expect(db.calls.filter(call => call[0] === "range").map(call => call[1])).toEqual([0, 2, 4]);
  });

  it("excludes other pharmacies and historical snapshots while including zero balance and missing costs", async () => {
    const db = stockDb([
      stock("current", "XARELTO", "15MG"),
      stock("old", "XARELTO", "15MG", { is_current: false, cost_price: 5 }),
      stock("other-pharmacy", "XARELTO", "15MG", { pharmacy_id: "andalus", cost_price: 9 }),
      stock("no-cost", "OTHER", "5MG", { cost_price: null }),
    ]);
    const loaded = await loadStockWithCosts(db, "tiryaq");
    expect(loaded.map(row => row.id)).toEqual(["current", "no-cost"]);
    expect(calculateActualGrossMargin(invoiceItem("XARELTO", "15MG"), loaded).status).toBe("matched");
    expect(calculateActualGrossMargin(invoiceItem("OTHER", "5MG"), loaded).purchaseCost).toBeNull();
  });

  it("retains cost ambiguity and rejects different brands, full strengths and dosage units", async () => {
    const item = invoiceItem("SYNJARDY", "12.5/1000MG");
    const loaded = await loadStockWithCosts(stockDb([
      stock("a", "SYNJARDY", "12.5/1000MG"),
      stock("b", "SYNJARDY", "12.5/1000MG", { cost_price: 1 }),
    ]), "tiryaq");
    expect(matchActualInvoiceItemToStock(item, loaded)).toMatchObject({ status: "needs_match_review", reason: "ambiguous_match" });
    expect(calculateActualGrossMargin(item, loaded).purchaseCost).toBeNull();
    for (const candidate of [
      stock("wrong-strength", "SYNJARDY", "1000MG"),
      stock("wrong-component", "SYNJARDY", "10/1000MG"),
      stock("wrong-brand", "JARDIANCE", "12.5/1000MG"),
      stock("wrong-form", "SYNJARDY", "12.5/1000MG", { dosage_unit: "CAPS", brand_name: "SYNJARDY 12.5/1000MG CAPS" }),
    ]) expect(matchActualInvoiceItemToStock(item, [candidate]).status).toBe("needs_match_review");
  });

  it("rejects failed, incomplete or repeated pages instead of matching a partial stock list", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => stock(String(i)));
    await expect(loadStockWithCosts(stockDb(rows, 2, { failAt: 2 }), "tiryaq")).rejects.toThrow("read failed");
    await expect(loadStockWithCosts(stockDb(rows, 2, { emptyAt: 2 }), "tiryaq")).rejects.toThrow("تعذر تحميل مخزون PHIF كاملاً");
    await expect(loadStockWithCosts(stockDb(rows, 2, { repeatPage: true }), "tiryaq")).rejects.toThrow("تعذر التحقق من اكتمال مخزون PHIF");
  });
});
