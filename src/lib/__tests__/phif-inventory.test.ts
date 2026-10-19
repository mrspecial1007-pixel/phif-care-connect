import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { filterInventoryItems, inventoryAvailability, inventoryExpiry, inventoryExportRows } from "@/lib/phif-inventory.helpers";

const filters = { query: "", mode: "available" as const, lowThreshold: 1, lowUnit: "boxes" as const, expiry: "all", supplier: "all", form: "all" };
const rows = [
  { id: "a", brand_name: "Brand 5MG", active_ingredient: "Ingredient", stock_quantity: "217", strips_quantity: "3", batch_number: "A", expiry_month: "2028-05", supplier_name: "Supplier A", dosage_unit: "TABS", cost_price: 99, raw_metadata: { secret: "not exported" } },
  { id: "b", brand_name: "Brand 5MG", stock_quantity: "2", strips_quantity: "3", batch_number: "B", expiry_date: "2020-06-15", supplier_name: "Supplier B", dosage_unit: "TABS" },
  { id: "c", brand_name: "Other", stock_quantity: "0", strips_quantity: "2", dosage_unit: "CAPS" },
  { id: "d", brand_name: "Unknown", stock_quantity: null, strips_quantity: null },
];

describe("inventory display filters and export", () => {
  it("defaults to every positive quantity including low stock, never zero or unknown", () => {
    expect(filterInventoryItems(rows, filters).map(row => row.id)).toEqual(["a", "b"]);
    expect(filterInventoryItems(rows, { ...filters, mode: "out" }).map(row => row.id)).toEqual(["c"]);
    expect(filterInventoryItems(rows, { ...filters, mode: "all" })).toHaveLength(4);
  });

  it("supports adjustable box or source-quantity thresholds without guessing missing packaging", () => {
    expect(filterInventoryItems(rows, { ...filters, mode: "low" }).map(row => row.id)).toEqual(["b"]);
    expect(filterInventoryItems(rows, { ...filters, mode: "low", lowThreshold: 73 }).map(row => row.id)).toEqual(["a", "b"]);
    expect(filterInventoryItems(rows, { ...filters, mode: "low", lowThreshold: 1, lowUnit: "units" })).toHaveLength(0);
    expect(inventoryAvailability({ stock_quantity: 1 }, 5, "boxes").status).toBe("available");
    expect(inventoryAvailability({ stock_quantity: 1 }, 5, "units").status).toBe("low");
    expect(inventoryAvailability({ stock_quantity: null }).status).toBe("unknown");
    expect(filterInventoryItems(rows, { ...filters, mode: "low", lowThreshold: NaN })).toHaveLength(0);
  });

  it("combines search, availability, supplier, expiry and dosage form", () => {
    expect(filterInventoryItems(rows, { ...filters, query: "ingredient", supplier: "Supplier A", form: "TABS", expiry: "valid" }).map(row => row.id)).toEqual(["a"]);
    expect(filterInventoryItems(rows, { ...filters, query: "brand", supplier: "Supplier B", expiry: "expired" }).map(row => row.id)).toEqual(["b"]);
    expect(filterInventoryItems(rows, { ...filters, form: "CAPS" })).toHaveLength(0);
  });

  it("keeps separate batches and month precision; exports only the selected rows with no private costs", () => {
    const result = inventoryExportRows(filterInventoryItems(rows, filters));
    expect(result).toHaveLength(2);
    expect(result[0]["الكمية"]).toMatch(/72.*1/);
    expect(result[0]["الصلاحية"]).toBe("2028-05");
    expect(result[0]["دقة الصلاحية"]).toBe("شهر/سنة");
    expect(result[1]["الصلاحية"]).toBe("2020-06-15");
    expect(result.map(row => row["رقم التشغيلة"])).toEqual(["A", "B"]);
    expect(JSON.stringify(result)).not.toMatch(/cost_price|raw_metadata|not exported/);
    expect(rows[0].stock_quantity).toBe("217");
  });

  it("distinguishes missing, invalid and conflicting dates without fabricating expiry", () => {
    expect(inventoryExpiry({}).label).toBe("الصلاحية غير مسجلة");
    expect(inventoryExpiry({ expiry_status: "invalid" }).label).toContain("صيغة");
    expect(inventoryExpiry({ expiry_status: "conflict" }).label).toContain("متعارضة");
    expect(inventoryExportRows([{ batch_number: "2028-01-01" }])[0]["الصلاحية"]).toBe("");
  });

  it("connects the default filter and filtered export to the inventory page, keeping extra filters separate", () => {
    const route = readFileSync("src/routes/management.inventory.tsx", "utf8");
    expect(route).toContain('useState<InventoryMode>("available")');
    expect(route).toContain("inventoryExportRows(filteredItems)");
    expect(route.indexOf("تصدير Excel")).toBeLessThan(route.indexOf('<ToggleGroup type="single"'));
    expect(route).toContain("فلاتر إضافية");
    expect(route).toContain('id="low-stock-threshold"');
    expect(route).toContain("canViewCost &&");
    expect(route).toContain("items.isError");
    const stock = readFileSync("src/lib/phif-stock.functions.ts", "utf8");
    expect(stock).toContain("row.expiry_month = month");
    expect(stock).toContain("row.expiry_status = raw_metadata.expiry_status");
    expect(stock).toContain("const { cost_price, ...safe } = row");
  });
});
