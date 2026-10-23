import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  analyticsSearchSchema,
  buildItemsAnalytics,
  scientificReportIdentity,
} from "../items-analytics.helpers";
import {
  reportSupplierUnit,
  supplierBoxPreview,
  latestReportSupplierSale,
} from "../report-supplier-units.helpers";
import {
  actualItemSignature,
  actualLinkGroups,
  actualLinkIdentity,
  applyActualStockLinks,
  type ActualStockLink,
} from "../actual-stock-links.helpers";
import { calculateActualGrossMargin } from "../phif-stock.helpers";
import { loadReportBoxSettings } from "../report-box-settings.server";
import { buildManagementAuditReport } from "../management.functions";

const access = {
  actual: { items: true, movements: true, revenue: true, cost: true, profit: true },
  phif: { items: true, movements: true, revenue: true, cost: true, profit: true },
};
const invoice = (id: string, date = "2026-10-22", number = id) => ({
  id,
  invoice_number: number,
  dispensing_date: date,
  insurance_card_number: "00012",
});
const tablet = (
  id: string,
  source = "phif-supplier",
  metadata: any = { dosage_form: "TABLET" },
) => ({
  id,
  phif_invoice_id: id,
  brand: "ATORVASTATIN",
  active_ingredient: "ATORVASTATIN",
  strength: "40MG",
  quantity: 30,
  source_classification: source,
  metadata,
  phif_financial_fields: {
    total_amount: 61.41,
    internal_purchase_cost_mode: "total_dispensed_cost",
    internal_purchase_cost_value: 24,
  },
});
const identity = scientificReportIdentity(tablet("x")).key;
const setting = {
  item_identity: identity,
  units_per_box: 30,
  base_unit: "tablet" as const,
  version: 1,
  supplier_quantity_unit: "tablet" as const,
};
function analytics(items: any[], invoices = items.map((i) => invoice(i.id)), options: any = {}) {
  return buildItemsAnalytics({
    items,
    invoices,
    settings: [setting],
    stocks: [],
    access,
    filters: analyticsSearchSchema.parse({ month: "2026-10" }),
    rows: items.map((i) => ({
      item_id: i.id,
      revenue: i.phif_financial_fields.total_amount,
      purchase_cost: 24,
      gross_margin: i.phif_financial_fields.total_amount - 24,
      invoice_quantity_unit: "TAB",
      match_status: "matched",
      actual_cost_unit: "TAB",
      actual_conversion_factor: 1,
      match_reason: "saved",
    })),
    ...options,
  });
}

describe("PHIF Supplier report settings are independent from Actual", () => {
  it("converts invoice 4814615's confirmed 30 tablets into one box and derives 61.410 from its sale", () => {
    const a = tablet("a");
    const before = JSON.stringify(a);
    const report = analytics([a], [invoice("a", "2026-10-22", "4814615")]);
    expect(report.items[0]).toMatchObject({
      phifBoxes: 1,
      boxSale: 61.41,
      latestSale: { date: "2026-10-22", invoiceNumber: "4814615" },
    });
    expect(report.movements[0]).toMatchObject({
      unit: "tablet",
      quantity: 30,
      unitProvenance: "item_confirmation",
      cost: 24,
      profit: 37.41,
    });
    expect(JSON.stringify(a)).toBe(before);
  });
  it("never substitutes an Actual sale and never uses the PHIF reporting box for Actual quantities/costs", () => {
    const a = tablet("a", "actual-supplier");
    a.phif_financial_fields.total_amount = 57.87;
    const first = analytics([a]),
      second = analytics([a], undefined, { settings: [{ ...setting, units_per_box: 60 }] });
    expect(first.items[0]).toMatchObject({ latestSale: null, boxSale: null, actualBoxSale: null });
    expect(first.movements[0]).toMatchObject({
      units: 30,
      boxes: null,
      reportingBox: null,
      cost: 24,
      profit: 33.87,
    });
    expect(second.movements[0]).toEqual(first.movements[0]);
    expect(readFileSync("src/components/management/ItemsAnalyticsViews.tsx", "utf8")).toContain(
      "لا يوجد سعر بيع PHIF Supplier مسجل",
    );
  });
  it("keeps Actual's independently documented box size and refuses a mixed total when box sizes differ", () => {
    const a = tablet("a", "actual-supplier", {
        unit: "TAB",
        dosage_form: "TAB",
        package_quantity: 28,
      }),
      b = tablet("b");
    const result = analytics([a, b]);
    expect(result.items[0]).toMatchObject({ actualBoxes: 30 / 28, phifBoxes: 1, boxes: null });
    const changed = analytics([a, b], undefined, { settings: [{ ...setting, units_per_box: 60 }] });
    expect(changed.items[0].actualBoxes).toBe(result.items[0].actualBoxes);
    expect(changed.items[0].phifBoxes).toBe(0.5);
    expect(changed.items[0].cost).toBe(result.items[0].cost);
    expect(changed.items[0].profit).toBe(result.items[0].profit);
  });
  it("uses all PHIF history and skips a newer unconvertible invoice instead of selecting Actual", () => {
    const good = tablet("good"),
      bad = tablet("bad", "phif-supplier", { quantity_unit: "STRIP", dosage_form: "TAB" }),
      actual = tablet("actual", "actual-supplier");
    actual.phif_financial_fields.total_amount = 999;
    const result = analytics(
      [good, bad, actual],
      [invoice("good", "2026-04-01"), invoice("bad", "2026-10-23"), invoice("actual")],
    );
    expect(result.items[0]).toMatchObject({ boxSale: 61.41, latestSale: { date: "2026-04-01" } });
    expect(result.movements).toHaveLength(2);
    const sale = (id: string, n: string) => ({
      ...good,
      id,
      quantity: 30,
      invoice: invoice(id, "2026-10-22", n),
    });
    expect(latestReportSupplierSale([sale("a", "4814614"), sale("b", "4814615")])?.itemId).toBe(
      "b",
    );
  });
  it("requires a dispensing decision, not just a pack size, and reuses a saved decision on new matching invoices", () => {
    const a = tablet("a"),
      b = tablet("b");
    expect(
      analytics([a], undefined, { settings: [{ ...setting, supplier_quantity_unit: null }] })
        .items[0].phifBoxes,
    ).toBeNull();
    expect(analytics([a, b]).items[0].phifBoxes).toBe(2);
    const other = { ...b, id: "other", strength: "20MG", phif_invoice_id: "other" };
    expect(analytics([a, other]).movements.find((r) => r.id === "other")?.unit).toBeNull();
    expect(supplierBoxPreview(30, "tablet", "tablet", 30)).toBe(1);
    expect(supplierBoxPreview(1, "strip", "tablet", 30)).toBeNull();
    expect(supplierBoxPreview(2, "strip", "tablet", 30, 30, 3)).toBeCloseTo(2 / 3);
  });
  it("respects original units and invoice exceptions without changing any saved purchase fields", () => {
    const original = tablet("a", "phif-supplier", {
      quantity_unit: "BOX",
      dosage_form: "TAB",
      package_quantity: 60,
    });
    expect(reportSupplierUnit(original, setting)).toMatchObject({
      unit: "box",
      provenance: "source",
    });
    expect(
      reportSupplierUnit(original, { ...setting, supplier_unit_exceptions: { a: "tablet" } }),
    ).toMatchObject({ unit: null, issue: "conflict" });
    expect(
      reportSupplierUnit(tablet("a"), { ...setting, supplier_unit_exceptions: { a: "unknown" } }),
    ).toMatchObject({ unit: null, issue: "invoice_exception" });
    const a = tablet("a"),
      before = JSON.stringify(a.phif_financial_fields);
    const report = analytics([a], undefined, {
      settings: [{ ...setting, supplier_unit_exceptions: { a: "unknown" } }],
    });
    expect(report.movements[0]).toMatchObject({ cost: 24, profit: 37.41, boxes: null });
    expect(JSON.stringify(a.phif_financial_fields)).toBe(before);
  });
  it("keeps old settings readable before migration and never falls back on authorization errors", async () => {
    const old = { ...setting };
    const calls: any[] = [];
    const db = (code: string) => ({
      from() {
        const q = {
          select() {
            return q;
          },
          eq(k: string, v: string) {
            calls.push([k, v]);
            return q;
          },
          order() {
            return q;
          },
          async limit() {
            return { error: { code } };
          },
          async range(from: number) {
            return { data: from ? [] : [{ ...old, id: "setting" }], count: 1, error: null };
          },
        };
        return q;
      },
    });
    const result = await loadReportBoxSettings(db("42703"), "tiryaq");
    expect(result.supplierUnitsAvailable).toBe(false);
    expect(result.settings[0].units_per_box).toBe(30);
    expect(calls).toContainEqual(["pharmacy_id", "tiryaq"]);
    await expect(loadReportBoxSettings(db("42501"), "tiryaq")).rejects.toThrow();
  });
  it("never exposes invoice exception identifiers to a non-manager report or export", () => {
    const result = analytics([tablet("a")], undefined, {
      settings: [{ ...setting, supplier_unit_exceptions: { a: "unknown" } }],
    });
    expect(result.items[0].setting).not.toHaveProperty("supplier_unit_exceptions");
    expect(result.movements[0].reportingBox).not.toHaveProperty("supplier_unit_exceptions");
    const manager = analytics([tablet("a")], undefined, {
      canManageBoxes: true,
      settings: [{ ...setting, supplier_unit_exceptions: { a: "unknown" } }],
    });
    expect(manager.items[0].setting).toHaveProperty("supplier_unit_exceptions.a", "unknown");
  });
});

const source = {
  id: "first",
  phif_invoice_id: "first-invoice",
  brand: "VILDAGLIPTIN",
  active_ingredient: "VILDAGLIPTIN",
  strength: "50MG",
  quantity: 30,
  source_classification: "actual-supplier",
  metadata: {},
  phif_financial_fields: { total_amount: 50.46 },
};
const target = {
  id: "stock-id",
  source_stock_id: "stock",
  brand_product_id: "1314",
  brand_name: "VILDATIC",
  strength: "50MG",
  dosage_unit: "TABS",
  package_quantity: 30,
  strips_quantity: 3,
  cost_price: 1.4,
  is_current: true,
};
const link = (id: string, item = source): ActualStockLink => ({
  id,
  version: 1,
  phif_invoice_item_id: item.id,
  source_signature: actualItemSignature(item),
  source: item,
  is_active: true,
  target,
});
describe("durable manual Actual relationships", () => {
  it("distinguishes a usable relationship from a saved link whose current target is unavailable", () => {
    const [bound] = applyActualStockLinks([source],[link("a")]);
    const audit = (stocks: any[]) => buildManagementAuditReport({invoices:[{id:source.phif_invoice_id}],items:[bound],stocks});
    expect(audit([target]).actual.manual_matches[0].link_state).toBe("linked");
    expect(audit([]).actual.manual_matches[0].link_state).toBe("review");
  });
  it("displays identical legacy VILDAGLIPTIN/VILDATIC decisions once and reuses them on new reads and invoices", () => {
    const other = { ...source, id: "second" },
      future = { ...source, id: "future", metadata: { unit: "TAB" } };
    const links = [link("a"), link("b", other)];
    expect(actualLinkGroups(links)).toHaveLength(1);
    const [bound] = applyActualStockLinks([future], JSON.parse(JSON.stringify(links)));
    expect(bound.manual_stock_link?.id).toBe("a");
    const cost = calculateActualGrossMargin(bound, [target]);
    expect(cost).toMatchObject({ purchaseCost: 42, grossMargin: 8.46 });
    expect(calculateActualGrossMargin(applyActualStockLinks([future], links)[0], [target])).toEqual(
      cost,
    );
    expect(bound.brand).toBe("VILDAGLIPTIN");
    expect(actualLinkGroups(links)[0].members).toHaveLength(2);
  });
  it("never selects one conflicting target, merges other brands/forms/strengths or applies generic-only rules", () => {
    const links = [
      link("a"),
      { ...link("b"), target: { ...target, brand_product_id: "other", brand_name: "OTHER BRAND" } },
    ];
    expect(actualLinkGroups(links)[0].status).toBe("review");
    expect(applyActualStockLinks([{ ...source, id: "future" }], links)[0]).toMatchObject({
      manual_link_conflict: true,
    });
    expect(
      (applyActualStockLinks([{ ...source, id: "future" }], links)[0] as any).manual_stock_link,
    ).toBeUndefined();
    for (const change of [
      { brand: "OTHER BRAND" },
      { strength: "100MG" },
      { metadata: { dosage_form: "CAP" } },
      { source_classification: "phif-supplier" },
    ]) {
      expect(
        (applyActualStockLinks([{ ...source, id: "future", ...change }], [link("a")])[0] as any)
          .manual_stock_link,
      ).toBeUndefined();
    }
  });
  it("retains revoked item exceptions, reuses an explicitly consolidated scope, and cancels the entire scope", () => {
    const identity = actualLinkIdentity(source, target)!;
    const old = { ...source, id: "old" };
    const active = { ...link("a"), source_identity: identity };
    const inactive = { ...link("b", old), source_identity: identity, is_active: false };
    expect(applyActualStockLinks([old], [active, inactive])[0].manual_stock_link?.id).toBe("a");
    expect(
      (applyActualStockLinks([old], [active, { ...inactive, source_identity: null }])[0] as any)
        .manual_stock_link,
    ).toBeUndefined();
    expect(
      (applyActualStockLinks([old], [{ ...active, is_active: false }, inactive])[0] as any)
        .manual_stock_link,
    ).toBeUndefined();
  });
  it("requires verified admin and scoped RPCs, locks versions, and never changes imported financial data", () => {
    const api = readFileSync("src/lib/actual-stock-links.functions.ts", "utf8");
    expect(api).toContain("if (!actorId) throw");
    expect(api).toContain("fingerprint(members)!==fingerprint(data.expectedMembers)");
    expect(api).toContain("reused:true");
    const sql = readFileSync(
      "supabase/migrations/20261023010000_scope_supplier_units_and_actual_links.sql",
      "utf8",
    );
    expect(sql).toContain("p_actor_id IS NULL");
    expect(sql).toContain("p_user_id IS NULL");
    expect(sql).toContain("SET search_path=pg_catalog,pg_temp");
    expect(sql).toContain("phif_actual_active_identity_unique");
    expect(sql).toContain("INSERT INTO public.user_operation_log");
    expect(sql).not.toMatch(
      /(?:UPDATE|DELETE FROM) public\.(?:phif_invoice_items|phif_invoices|phif_stock_items|patients)\b/,
    );
    expect(sql).not.toContain("internal_purchase_cost");
  });
});
