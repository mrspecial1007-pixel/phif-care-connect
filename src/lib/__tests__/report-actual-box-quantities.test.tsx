import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as XLSX from "xlsx";
import { ReportBoxQuantities } from "@/components/management/ItemsAnalyticsViews";
import { actualUnit } from "../actual-units.helpers";
import { analyticsSearchSchema, buildItemsAnalytics, scientificReportIdentity } from "../items-analytics.helpers";
import { buildAnalyticsWorkbook } from "../items-analytics-export";

function fixture(quantity = 330, pack: number | null = 30, form = "tablet", unit: string | null = "TAB") {
  const actual = {
    id: "a", phif_invoice_id: "v", source_classification: "actual-supplier",
    active_ingredient: "Amlodipine", strength: "5MG", brand: "actual brand", quantity,
    metadata: { dosage_form: form, ...(unit ? { quantity_unit: unit } : {}) },
    phif_financial_fields: { total_amount: 100 },
  };
  const supplier = {
    ...actual, id: "b", source_classification: "phif-supplier", quantity: 30,
    metadata: { dosage_form: form, quantity_unit: form },
    phif_financial_fields: { total_amount: 60, internal_purchase_cost_value: 24 },
  };
  const key = scientificReportIdentity(actual).key;
  const rights = { items: true, movements: true, revenue: true, cost: true, profit: true };
  return {
    pharmacyId: "p",
    items: [actual, supplier],
    invoices: [{ id: "v", invoice_number: "1", dispensing_date: "2026-09-10", insurance_card_number: "000123" }],
    stocks: [{ source_stock_id: "stock", pharmacy_id: "p", is_current: true, brand_name: actual.brand,
      strength: actual.strength, dosage_unit: form, package_quantity: pack, strips_quantity: null as number | null,
      stock_quantity: 0, cost_price: 0.563, sale_price: 999 }],
    rows: [
      { item_id: "a", invoice_quantity_unit: unit, actual_cost_unit: actualUnit(form),
        actual_conversion_factor: unit && actualUnit(unit) === actualUnit(form) ? 1 : null,
        match_status: "matched", matched_stock_id: "stock", revenue: 100, purchase_cost: 70, gross_margin: 30 },
      { item_id: "b", invoice_quantity_unit: form, revenue: 60, purchase_cost: 24, gross_margin: 36 },
    ],
    settings: [{ item_identity: key, units_per_box: 30, base_unit: actualUnit(form)!, version: 1 }],
    access: { actual: { ...rights }, phif: { ...rights } },
    filters: analyticsSearchSchema.parse({ month: "2026-09" }),
  };
}

describe("independent Actual reporting boxes", () => {
  it.each([
    ["Amlodipine", "5MG", 330, 11],
    ["Amlodipine", "10MG", 540, 18],
    ["Bisoprolol", "5MG", 180, 6],
    ["Bisoprolol", "2.5MG", 1200, 40],
  ])("converts %s %s from documented tablets and its linked stock pack", (ingredient, strength, quantity, expected) => {
    const data = fixture(quantity);
    data.items[0].active_ingredient = ingredient;
    data.items[0].strength = strength;
    data.items = [data.items[0]];
    const result = buildItemsAnalytics(data);
    expect(result.items[0]).toMatchObject({ actualBoxes: expected, boxes: expected, actualBoxIssues: [] });
    expect(result.movements[0]).toMatchObject({ quantity, unit: "tablet", boxSize: 30 });
    expect(result.reviewItems).toHaveLength(0);
  });

  it("shows all three columns in boxes using independently compatible pack sizes", () => {
    const result = buildItemsAnalytics(fixture());
    expect(result.items[0]).toMatchObject({ actualBoxes: 11, phifBoxes: 1, boxes: 12, boxIssues: [] });
    const html = renderToStaticMarkup(<ReportBoxQuantities row={result.items[0]} />);
    expect(html).toContain("grid-cols-3");
    for (const text of ["11 علبة", "1 علبة", "12 علبة"]) expect(html).toContain(text);
    expect(html).not.toContain("330 قرص");
  });

  it("keeps fractional boxes, uses actual pack counts rather than a default thirty, and never borrows Supplier settings", () => {
    for (const pack of [28, 30, 56, 60]) {
      const data = fixture(15, pack);
      data.settings[0].units_per_box = 99;
      const result = buildItemsAnalytics(data).items[0];
      expect(result.actualBoxes).toBe(15 / pack);
      expect(result.phifBoxes).toBe(30 / 99);
      expect(result.boxes).toBeNull();
      expect(result.boxIssues).toContain("incompatible_box_sizes");
    }
    const data = fixture(15, 30);
    data.settings = [];
    expect(buildItemsAnalytics(data).items[0].actualBoxes).toBe(0.5);
    expect(renderToStaticMarkup(<ReportBoxQuantities row={buildItemsAnalytics(data).items[0]} />)).toContain("0.5 علبة");
  });

  it.each(["capsule", "pen", "vial", "drops", "inhaler", "bottle", "tube"])("converts documented %s units only with their own pack size", form => {
    expect(buildItemsAnalytics(fixture(5, 5, form, form)).items[0].actualBoxes).toBe(1);
    expect(buildItemsAnalytics(fixture(5, null, form, form)).items[0].actualBoxes).toBeNull();
    expect(buildItemsAnalytics(fixture(5, 5, form, null)).items[0].actualBoxes).toBeNull();
  });

  it("uses explicit invoice pack evidence when present, never numbers from compound strengths", () => {
    const data = fixture(30, null);
    data.items[0].metadata = { ...data.items[0].metadata, package_quantity: 60 } as any;
    expect(buildItemsAnalytics(data).items[0].actualBoxes).toBe(0.5);
    data.items[0].metadata = { dosage_form: "tablet", quantity_unit: "TAB" };
    data.items[0].strength = "5/1000MG";
    const result = buildItemsAnalytics(data);
    expect(result.movements[0]).toMatchObject({ boxes: null, boxIssue: "missing_box_size" });
  });

  it("distinguishes missing units from missing packs and keeps the total unknown, not zero", () => {
    const missingUnit = buildItemsAnalytics(fixture(30, 30, "tablet", null));
    const missingPack = buildItemsAnalytics(fixture(30, null));
    expect(missingUnit.items[0]).toMatchObject({ actualBoxes: null, boxes: null, actualBoxIssues: ["missing_dispensing_unit"] });
    expect(missingPack.items[0]).toMatchObject({ actualBoxes: null, boxes: null, actualBoxIssues: ["missing_box_size"] });
    const html = renderToStaticMarkup(<ReportBoxQuantities row={missingPack.items[0]} />);
    expect(html).toContain("حجم عبوة Actual غير موثق");
    expect(html).not.toContain("0 علبة");
    expect(buildItemsAnalytics(fixture(0)).items[0].actualBoxes).toBe(0);
  });

  it("rejects conflicting invoice units even if the financial row contains a unit", () => {
    const data = fixture();
    data.items[0].metadata = { ...data.items[0].metadata, unit: "BOX" } as any;
    expect(buildItemsAnalytics(data).movements[0]).toMatchObject({ boxes: null, boxIssue: "conflicting_dispensing_unit" });
  });

  it("reuses Actual's verified historical and manual unit evidence without requiring completed finances", () => {
    const data = fixture();
    data.items[0].metadata = { dosage_form: "tablet" } as any;
    Object.assign(data.rows[0], { purchase_cost: null, gross_margin: null, match_status: "pricing_unit_unverified" });
    const result = buildItemsAnalytics(data);
    expect(result.items[0]).toMatchObject({ actualBoxes: 11, cost: null, profit: null, complete: false });
    expect(result.movements[0]).toMatchObject({ quantity: 330, unit: "tablet", boxes: 11 });
  });

  it("uses only the engine-linked current pharmacy stock, including zero-balance rows", () => {
    const data = fixture();
    data.stocks.push({ ...data.stocks[0], package_quantity: 60, source_stock_id: "unrelated" });
    data.stocks.push({ ...data.stocks[0], package_quantity: 60, is_current: false });
    data.stocks.push({ ...data.stocks[0], package_quantity: 60, pharmacy_id: "other" });
    expect(buildItemsAnalytics(data).items[0].actualBoxes).toBe(11);
    data.rows[0].matched_stock_id = "not-linked";
    expect(buildItemsAnalytics(data).items[0].actualBoxes).toBeNull();
  });

  it("accepts consistent lots without multiplying quantities and refuses contradictory pack evidence", () => {
    const data = fixture();
    data.stocks.push({ ...data.stocks[0] });
    expect(buildItemsAnalytics(data).items[0].actualBoxes).toBe(11);
    data.stocks[1].package_quantity = 60;
    expect(buildItemsAnalytics(data).movements[0]).toMatchObject({ boxes: null, boxIssue: "conflicting_package" });
    data.stocks.pop();
    data.items[0].metadata = { ...data.items[0].metadata, package_quantity: 60 } as any;
    expect(buildItemsAnalytics(data).items[0].actualBoxIssues).toContain("conflicting_package");
  });

  it("requires compatible documented pack units and rejects invalid sizes", () => {
    const data = fixture();
    data.stocks[0].dosage_unit = "PEN";
    expect(buildItemsAnalytics(data).movements[0]).toMatchObject({ boxes: null, boxIssue: "package_unit_mismatch" });
    data.stocks[0].dosage_unit = "tablet";
    for (const invalid of [0, -1, 1.5, Infinity, true, [30], "not a count"]) {
      data.stocks[0].package_quantity = invalid as any;
      expect(buildItemsAnalytics(data).items[0].actualBoxIssues).toContain("invalid_package");
    }
  });

  it("uses documented strip sizes without assuming ten tablets per strip", () => {
    const data = fixture(3, 28, "tablet", "STRIP");
    data.stocks[0].strips_quantity = 2;
    expect(buildItemsAnalytics(data).items[0].actualBoxes).toBe(1.5);
    data.stocks[0].strips_quantity = null;
    expect(buildItemsAnalytics(data).items[0].actualBoxes).toBeNull();
  });

  it("counts explicitly recorded native boxes without converting tablets by guesswork", () => {
    expect(buildItemsAnalytics(fixture(2, null, "tablet", "BOX")).items[0].actualBoxes).toBe(2);
    expect(buildItemsAnalytics(fixture(30, null, "tablet", "TAB")).items[0].actualBoxes).toBeNull();
  });

  it("keeps different Actual brand pack sizes separate for totals, not a false common box", () => {
    const data = fixture(30);
    data.items.push({ ...data.items[0], id: "c" });
    data.rows.push({ ...data.rows[0], item_id: "c", matched_stock_id: "other" });
    data.stocks.push({ ...data.stocks[0], source_stock_id: "other", package_quantity: 60 });
    const result = buildItemsAnalytics(data);
    expect(result.movements.filter(r => r.source === "actual").map(r => r.boxes)).toEqual([1, 0.5]);
    expect(result.items[0]).toMatchObject({ actualBoxes: null, boxes: null, actualBoxIssues: ["incompatible_box_sizes"] });
  });

  it("does not change finance, source prices, identities, original invoices or quantities, and exports the same derived boxes", async () => {
    const data = fixture();
    const original = JSON.stringify(data);
    const before = buildItemsAnalytics({ ...data, stocks: [] });
    const after = buildItemsAnalytics(data);
    expect(JSON.stringify(data)).toBe(original);
    for (const field of ["cost", "profit", "revenue", "boxSale", "latestSale", "identityComplete", "beneficiaries", "dispenseCount"]) {
      expect(after.items[0][field]).toEqual(before.items[0][field]);
    }
    expect(after.invoices).toEqual(before.invoices);
    expect(after.beneficiaries).toEqual(before.beneficiaries);
    expect(after.audit).toEqual(before.audit);
    const book = await buildAnalyticsWorkbook(after, "consumption", data.filters);
    const summary: any[] = XLSX.utils.sheet_to_json(book.Sheets["ملخص الأصناف"]);
    expect(summary[0]).toMatchObject({ علب_Actual: 11, علب_PHIF: 1, إجمالي_العلب: 12 });
    const movements: any[] = XLSX.utils.sheet_to_json(book.Sheets["سجل الصرف"]);
    expect(movements[0]).toMatchObject({ الكمية: 330, الوحدة: "tablet", الكمية_بالعلب: 11,
      تكلفة_الشراء: 70, الربح: 30, البطاقة: "000123" });
  });
});
