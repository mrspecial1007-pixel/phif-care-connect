import { describe, expect, it } from "vitest";
import { analyticsSearchSchema, buildItemsAnalytics } from "../items-analytics.helpers";
import { readSupplierPriceItem } from "../phif-supplier-price-basis.server";
import {
  reportSettingKey,
  resolveReportIdentities,
  scientificReportIdentity,
  supplierQuantityEvidence,
  type ReportDefinitionScope,
} from "../report-medication-evidence.helpers";

const pharmacyId = "tiryaq";
const item = (id: string, patch: any = {}) => ({
  id,
  phif_invoice_id: `invoice-${id}`,
  source_classification: "phif-supplier",
  active_ingredient: "Amlodipine + Valsartan",
  strength: "10MG/160MG",
  brand: "brand",
  quantity: 30,
  metadata: {},
  phif_financial_fields: { total_amount: 90, internal_purchase_cost_value: 24 },
  ...patch,
});
const key = scientificReportIdentity(item("a"), "tablet").key;
const definition = (patch: any = {}) => ({
  pharmacy_id: pharmacyId,
  item_identity: key,
  base_unit: "tablet" as const,
  units_per_box: 30,
  version: 1,
  ...patch,
});
const scope = (settings = [definition()]): ReportDefinitionScope => ({ pharmacyId, settings });
const resolve = (items: any[], settings = [definition()], refs: any[] = []) =>
  resolveReportIdentities(items, [], [], refs, scope(settings));
const rights = { items: true, movements: true, revenue: true, cost: true, profit: true };
function report(items: any[], settings = [definition()]) {
  return buildItemsAnalytics({
    pharmacyId,
    items,
    settings,
    stocks: [],
    rows: items.map((i) => ({ item_id: i.id, revenue: 90, purchase_cost: 24, gross_margin: 66 })),
    invoices: items.map((i) => ({
      id: i.phif_invoice_id,
      invoice_number: i.id,
      dispensing_date: i.id === "historic" ? "2026-03-01" : "2026-10-24",
      insurance_card_number: "000123",
    })),
    access: { phif: rights, actual: rights },
    filters: analyticsSearchSchema.parse({ month: "all" }),
  });
}

describe("persisted pharmacy Supplier scientific definitions", () => {
  it("reuses the reporting definition in the Supplier item reader without treating it as a pricing unit", async () => {
    const a = item("a"), original = JSON.stringify(a);
    const query: any = {
      select: () => query, eq: () => query, maybeSingle: async () => ({ data: a, error: null }),
    };
    const context: any = { pharmacyId, userId: "manager", reportForms: Promise.resolve(resolve([a])),
      db: { from: () => query } };
    const result = await readSupplierPriceItem(context, a.id);
    expect(result.report_form).toBe("tablet");
    expect(supplierQuantityEvidence(result).unit).toBeNull();
    expect(JSON.stringify(a)).toBe(original);
  });

  it("resolves historical and future invoices once, across brands and normalized complete strengths", () => {
    const items = [
      item("historic"),
      item("future", {
        active_ingredient: " AMLODIPINE+VALSARTAN ",
        strength: "10 / 160 MG",
        brand: "new brand",
      }),
    ];
    const original = JSON.stringify(items);
    const first = report(items);
    const reloaded = report(structuredClone(items), structuredClone([definition()]));
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      id: key,
      dispenseCount: 2,
      beneficiaries: 1,
      cost: 48,
      profit: 132,
    });
    expect(first.reviewItems).toHaveLength(0);
    expect(reloaded).toEqual(first);
    expect(JSON.stringify(items)).toBe(original);
  });

  it("does not infer an invoice quantity unit from either dosage form or reference pack size", () => {
    for (const units_per_box of [1, 28, 30, 60]) {
      const a = item("a"),
        result = report([a], [definition({ units_per_box })]);
      expect(result.items[0]).toMatchObject({
        form: "tablet",
        phifUnits: null,
        boxes: null,
        boxSale: null,
      });
      expect(result.movements[0]).toMatchObject({
        quantity: 30,
        unit: null,
        units: null,
        boxes: null,
      });
      expect(supplierQuantityEvidence(a)).toEqual({ unit: null, issue: "missing" });
      expect(result.items[0]).toMatchObject({ cost: 24, profit: 66 });
    }
  });

  it("retains recorded quantities and a separately documented unit, including invoice exceptions", () => {
    const a = item("a", { metadata: { quantity_unit: "BOX" } });
    const result = report([a]);
    expect(result.movements[0]).toMatchObject({
      quantity: 30,
      unit: "box",
      units: null,
      boxes: null,
    });
    const confirmed = report(
      [item("b")],
      [
        definition({
          supplier_quantity_unit: "tablet",
          supplier_unit_exceptions: { "invoice-b": "unknown" },
        }),
      ],
    );
    expect(confirmed.items[0].boxes).toBeNull();
    expect(confirmed.movements[0].unitIssue).toBe("invoice_exception");
  });

  it("never replaces an explicit different form or merges it with the saved form", () => {
    const items = [
      item("tab", { metadata: { dosage_form: "tablet" } }),
      item("cap", { metadata: { dosage_form: "CAPSULE" } }),
    ];
    const result = report(items);
    expect(result.items.map((i) => i.form).sort()).toEqual(["capsule", "tablet"]);
    expect(resolve(items).get("cap")?.form).toBe("capsule");
  });

  it("does not apply definitions of another pharmacy, ingredient or strength", () => {
    const cases = [
      definition({ pharmacy_id: "andalus" }),
      definition({ item_identity: '["amlodipine + valsartan","5mg/160mg","tablet"]' }),
      definition({ item_identity: '["other ingredient","10mg/160mg","tablet"]' }),
    ];
    for (const saved of cases) expect(resolve([item("a")], [saved]).get("a")?.form).toBe("");
    expect(resolve([item("a", { invoice: { pharmacy_id: "andalus" } })]).get("a")?.form).toBe("");
    expect(
      resolveReportIdentities([item("a")], [], [], [], {
        pharmacyId: "",
        settings: [definition()],
      }).get("a")?.form,
    ).toBe("");
  });

  it("leaves multiple saved dosage forms for review, but accepts explicit source evidence", () => {
    const settings = [
      definition(),
      definition({
        base_unit: "capsule",
        item_identity: '["amlodipine + valsartan","10mg/160mg","capsule"]',
      }),
    ];
    const result = report([item("a")], settings);
    expect(result.items).toHaveLength(0);
    expect(result.reviewItems[0].identityReviewReason).toContain("أكثر من شكل");
    expect(
      resolve([item("b", { metadata: { dosage_form: "CAP" } })], settings).get("b")?.form,
    ).toBe("capsule");
  });

  it("refuses conflicting reference evidence or an inconsistent saved definition", () => {
    const result = resolve(
      [item("a")],
      [definition()],
      [
        {
          active_ingredient: item("x").active_ingredient,
          strength: "10MG/160MG",
          dosage_form: "capsule",
        },
      ],
    ).get("a");
    expect(result?.form).toBe("");
    expect(result?.reviewReason).toContain("تعارض");
    const invalid = resolve([item("a")], [definition({ base_unit: "vial" })]).get("a");
    expect(invalid?.form).toBe("");
    expect(invalid?.reviewReason).toContain("لا تتوافق");
  });

  it("keeps genuinely incomplete ingredients and strengths separate with clear reasons", () => {
    const result = report([item("a", { strength: "" }), item("b", { active_ingredient: "" })]);
    expect(result.items).toHaveLength(0);
    expect(result.reviewItems).toHaveLength(2);
    expect(result.reviewItems.map((i) => i.identityReviewReason)).toEqual(
      expect.arrayContaining(["المادة العلمية غير مسجلة", "التركيز غير مسجل"]),
    );
  });

  it("does not create a scientific identity per pack size or repeated invoice item", () => {
    const a = item("a");
    const result = report([a, a], [definition(), definition({ units_per_box: 60 })]);
    expect(result.items).toHaveLength(1);
    expect(result.movements).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      settingConflict: true,
      setting: null,
      boxes: null,
      cost: 24,
    });
    expect(reportSettingKey('[" AMLODIPINE+VALSARTAN ","10/160 MG","TABLETS"]')).toBe(key);
  });

  it("applies the approved Isophane Vial definition without changing an explicit historical Pen", () => {
    const vialKey = '["insulin isophane hm","100iu","vial"]';
    const settings = [definition({ item_identity: vialKey, base_unit: "vial", units_per_box: 1 })];
    const items = [
      item("vial", { active_ingredient: "INSULIN ISOPHANE HM", strength: "100IU" }),
      item("pen", {
        active_ingredient: "INSULIN ISOPHANE HM",
        strength: "100IU",
        metadata: { dosage_form: "PEN" },
      }),
    ];
    const result = resolve(items, settings);
    expect(result.get("pen")?.form).toBe("pen");
    // Other source evidence explicitly differs; do not silently reclassify missing data.
    expect(result.get("vial")?.form).toBe("");
    expect(result.get("vial")?.reviewReason).toContain("تعارض");
    expect(resolve([items[0]], settings).get("vial")?.key).toBe(vialKey);
    expect(supplierQuantityEvidence(items[0]).unit).toBeNull();
  });

  it("does not change Actual identity, stock links, prices or the existing engine's financial rows", () => {
    const a = item("a", {
      source_classification: "actual-supplier",
      manual_stock_link: { is_active: true },
    });
    expect(resolve([a]).get("a")).toEqual(resolve([a], []).get("a"));
    const baseline = report([a], []),
      after = report([a]);
    expect(after.movements).toEqual(baseline.movements);
    expect(after.invoices).toEqual(baseline.invoices);
    expect(after.reviewItems[0]).toMatchObject({ cost: 24, profit: 66 });
    expect(a.manual_stock_link.is_active).toBe(true);
  });
});
