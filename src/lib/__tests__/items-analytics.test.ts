import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  analyticsSearchSchema,
  authorizeAnalyticsRead,
  buildItemsAnalytics,
  monthWindow,
  reportStrength,
  scientificReportIdentity,
  type AnalyticsAccess,
} from "../items-analytics.helpers";
import { buildAnalyticsWorkbook, selectAnalyticsRows } from "../items-analytics-export";
import { calculateActualGrossMargin } from "../phif-stock.helpers";
import { readFileSync } from "node:fs";

const access: AnalyticsAccess = {
  actual: { items: true, movements: true, revenue: true, cost: true, profit: true },
  phif: {
    items: true,
    movements: true,
    revenue: true,
    cost: true,
    profit: true,
    purchasePriceWrite: true,
  },
};
const filters = analyticsSearchSchema.parse({ month: "2026-09" });
const invoice = (id: string, date = "2026-09-10", card = "000123") => ({
  id,
  invoice_number: id,
  dispensing_date: date,
  insurance_card_number: card,
  beneficiary_name: "مستفيد اختباري",
});
const item = (id: string, invoiceId: string, source = "phif-supplier", changes = {}) => ({
  id,
  phif_invoice_id: invoiceId,
  source_classification: source,
  active_ingredient: "Metformin",
  strength: "500MG",
  brand: "brand",
  quantity: 30,
  metadata: { unit: "TABS", dosage_form: "TABLET" },
  phif_financial_fields: { total_amount: 60 },
  ...changes,
});
const row = (i: any, revenue = 60, cost: number | null = 30) => ({
  item_id: i.id,
  revenue,
  purchase_cost: cost,
  gross_margin: cost == null ? null : revenue - cost,
  invoice_quantity_unit: "TAB",
  invoice_dosage_form: "TAB",
  match_reason: cost == null ? "missing_cost" : "saved",
  matched_stock_id: null,
});
const identity = scientificReportIdentity(item("i", "v")).key;
const setting = {
  item_identity: identity,
  units_per_box: 30,
  base_unit: "tablet" as const,
  version: 1,
};
function report(items: any[], invoices: any[], changes: any = {}) {
  return buildItemsAnalytics({
    items,
    invoices,
    rows: items.map((i) => row(i)),
    stocks: [],
    settings: [setting],
    access,
    filters,
    ...changes,
  });
}

describe("item consumption and profitability analytics", () => {
  it("unifies complete compound strengths and forms across brands and sources, not different doses", () => {
    const variants = [
      item("a", "v", "phif-supplier", {
        active_ingredient: " Amlodipine+Valsartan ",
        strength: "5 / 160 MG",
      }),
      item("b", "w", "actual-supplier", {
        active_ingredient: "AMLODIPINE + VALSARTAN",
        strength: "5MG/160MG",
        brand: "different brand",
        metadata: { unit: "TABLET" },
      }),
      item("c", "w", "phif-supplier", {
        active_ingredient: "Amlodipine + Valsartan",
        strength: "10MG/160MG",
      }),
    ];
    const result = report(variants, [invoice("v"), invoice("w")]);
    expect(result.items).toHaveLength(2);
    expect(result.items.find((i) => i.dispenseCount === 2).beneficiaries).toBe(1);
    expect(result.movements).toHaveLength(3);
    expect(result.invoices).toHaveLength(2);
  });
  it("uses pharmacy reference forms without treating the form as an invoice quantity unit", () => {
    const a = item("a", "v", "phif-supplier", { metadata: {} });
    const result = report([a], [invoice("v")], {
      referenceForms: [
        { active_ingredient: "METFORMIN", strength: "500mg", dosage_form: "TABLETS" },
      ],
    });
    expect(result.items[0]).toMatchObject({ form: "tablet", units: null, boxes: null });
    const ambiguous = report([a], [invoice("v")], {
      referenceForms: [
        { active_ingredient: "Metformin", strength: "500mg", dosage_form: "tablet" },
        { active_ingredient: "Metformin", strength: "500mg", dosage_form: "capsule" },
      ],
    });
    expect(ambiguous.items).toHaveLength(0);
    expect(ambiguous.reviewItems).toHaveLength(1);
  });
  it("uses historical oral confirmation and distinguishes purchase units, reporting boxes and dispensing", () => {
    const a = item("a", "v", "phif-supplier", {
      active_ingredient: "ACETYLSALICYLIC ACID",
      strength: "100MG",
      metadata: {},
      phif_financial_fields: {
        total_amount: 33.06,
        internal_purchase_unit: "BOX",
        internal_purchase_cost_value: 24,
        internal_purchase_import: {
          authorization: "explicit_pharmacy_owner_approval_historical_only",
          unit_confirmation: "pharmacy_owner_individual_oral_units_confirmation",
        },
      },
    });
    const key = scientificReportIdentity(a, "tablet").key;
    const result = report([a], [invoice("v")], {
      referenceForms: [
        { active_ingredient: a.active_ingredient, strength: a.strength, dosage_form: "TAB" },
      ],
      settings: [{ ...setting, item_identity: key }],
      rows: [row(a, 33.06, 24)],
    });
    expect(result.items[0]).toMatchObject({
      units: 30,
      boxes: 1,
      boxSale: 33.06,
      cost: 24,
      profit: 9.06,
    });
    expect(result.movements[0]).toMatchObject({ quantity: 30, unit: "tablet" });
    expect((a.phif_financial_fields as Record<string, unknown>).internal_purchase_cost_value).toBe(
      24,
    );
  });
  it("looks up last reliable historical source prices outside the selected month and source", () => {
    const a = item("a", "march"),
      b = item("b", "now", "actual-supplier");
    const result = report([a, b], [invoice("march", "2026-03-01"), invoice("now")], {
      filters: { ...filters, source: "actual" },
      rows: [row(a, 33.06), row(b, 90)],
    });
    expect(result.items[0]).toMatchObject({
      boxes: null,
      boxSale: 33.06,
      actualBoxSale: null,
      latestSale: { date: "2026-03-01" },
      dispenseCount: 1,
    });
    expect(result.movements).toHaveLength(1);
  });
  it("keeps last sale date without a box setting and never fabricates a sale from costs", () => {
    const a = item("a", "v");
    expect(report([a], [invoice("v")], { settings: [] }).items[0]).toMatchObject({
      boxSale: null,
      latestSale: { date: "2026-09-10" },
    });
    const onlyCost = { ...a, phif_financial_fields: { internal_purchase_cost_value: 60 } };
    expect(report([onlyCost], [invoice("v")]).items[0].latestSale).toBeNull();
  });
  it("reads normalized legacy box settings and refuses conflicting aliases without losing either", () => {
    const a = item("a", "v");
    const legacy = {
      ...setting,
      item_identity: '[" METFORMIN ","500 MG","TABLETS"]',
      units_per_box: 28,
      version: 4,
    };
    const resolved = report([a], [invoice("v")], { settings: [legacy] });
    expect(resolved.items[0].setting).toEqual(legacy);
    expect(resolved.items[0].boxes).toBe(30 / 28);
    const conflict = report([a], [invoice("v")], { settings: [legacy, setting] });
    expect(conflict.items[0]).toMatchObject({ settingConflict: true, setting: null, boxes: null });
  });
  it("separates monthly and historical unique text cards, without multiplying mixed sources or repeated IDs", () => {
    const a = item("a", "old"),
      b = item("b", "v"),
      c = item("c", "w", "actual-supplier");
    const result = report(
      [a, b, c, c],
      [invoice("old", "2026-04-01", "000456"), invoice("v"), invoice("w")],
    );
    expect(result.items[0]).toMatchObject({
      beneficiaries: 1,
      historicalBeneficiaries: 2,
      dispenseCount: 2,
      invoiceCount: 2,
    });
    expect(result.historyMovements).toHaveLength(3);
    expect(result.movements.map((r) => r.card)).toEqual(["000123", "000123"]);
  });
  it("keeps unresolved movements and their financial totals in a separate review export", async () => {
    const a = item("a", "v", "phif-supplier", { metadata: {}, active_ingredient: "Unknown drug" });
    const result = report([a], [invoice("v")]);
    expect(result.items).toHaveLength(0);
    expect(result.reviewItems).toHaveLength(1);
    expect(result.invoices[0].cost).toBe(30);
    const book = await buildAnalyticsWorkbook(result, "consumption", filters);
    expect(book.SheetNames).toContain("مراجعة الهوية");
    expect(result.movements).toHaveLength(1);
  });
  it("does not confuse the reporting box with the physical box on an old invoice", () => {
    const a = item("a", "v", "phif-supplier", {
      quantity: 1,
      metadata: { quantity_unit: "BOX", dosage_form: "tablet", package_quantity: 60 },
    });
    expect(report([a], [invoice("v")]).items[0]).toMatchObject({
      units: 60,
      boxes: 2,
      boxSale: 30,
    });
    expect(
      report([{ ...a, metadata: { quantity_unit: "BOX", dosage_form: "tablet" } }], [invoice("v")])
        .items[0].boxes,
    ).toBeNull();
  });
  it("combines Actual and PHIF only for the exact scientific identity and deduplicates item IDs/cards", () => {
    const a = item("a", "v", "actual-supplier"),
      b = item("b", "w");
    const result = report([a, b, a], [invoice("v"), invoice("w")]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      actualUnits: 30,
      phifUnits: 30,
      actualBoxes: null,
      phifBoxes: 1,
      boxes: null,
      beneficiaries: 1,
      dispenseCount: 2,
    });
    expect(result.movements.map((r) => r.card)).toEqual(["000123", "000123"]);
  });
  it("never combines different strengths, combined components, forms or incomplete identities", () => {
    const base = item("a", "v");
    const variants = [
      base,
      item("b", "v", "phif-supplier", { strength: "850MG" }),
      item("c", "v", "phif-supplier", { strength: "500/5MG" }),
      item("d", "v", "phif-supplier", { metadata: { unit: "CAP", dosage_form: "capsule" } }),
      item("e", "v", "phif-supplier", { metadata: {} }),
      item("f", "v", "phif-supplier", { metadata: {} }),
    ];
    const result = report(variants, [invoice("v")]);
    expect(result.items).toHaveLength(4);
    expect(result.reviewItems).toHaveLength(2);
    expect(reportStrength("12.5/1000 MG")).toBe(reportStrength("12.5MG/1000MG"));
    expect(reportStrength("160MG")).not.toBe(reportStrength("160/25MG"));
    expect(reportStrength("400MCG")).toBe(reportStrength("0.4mg"));
  });
  it("uses dispensing dates and the three preceding complete calendar months including zero months", () => {
    const items = [item("a", "sep"), item("b", "aug"), item("c", "jun")];
    const result = report(items, [
      invoice("sep"),
      invoice("aug", "2026-08-31"),
      invoice("jun", "2026-06-01"),
    ]);
    expect(result.items[0]).toMatchObject({ boxes: 1, previousBoxes: 1, averageBoxes: 2 / 3 });
    expect(result.period.averageRange).toEqual({ from: "2026-06-01", to: "2026-08-31" });
    expect(monthWindow("2026-01", -1)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(monthWindow("2024-02").to).toBe("2024-02-29");
  });
  it("updates when an older dispensing invoice is added, without multiplying beneficiaries", () => {
    const first = report([item("a", "v")], [invoice("v")]);
    const next = report(
      [item("a", "v"), item("b", "w")],
      [invoice("v"), invoice("w", "2026-09-01")],
    );
    expect(first.items[0].boxes).toBe(1);
    expect(next.items[0].boxes).toBe(2);
    expect(next.items[0].beneficiaries).toBe(1);
  });
  it("keeps fractional boxes and computes the latest PHIF box price without mixing Actual prices", () => {
    const a = item("a", "v", "phif-supplier", { quantity: 75 }),
      b = item("b", "w", "actual-supplier");
    const result = report([a, b], [invoice("v"), invoice("w", "2026-09-20")], {
      rows: [row(a, 86.775), row(b, 999)],
    });
    expect(result.items[0].phifBoxes).toBe(2.5);
    expect(result.items[0].boxSale).toBe(34.71);
    expect(result.items[0].latestSale.date).toBe("2026-09-10");
  });
  it("rounds the final box price, not the unit price before multiplying", () => {
    const a = item("a", "v", "phif-supplier", { quantity: 3 });
    expect(
      report([a], [invoice("v")], {
        rows: [row(a, 1)],
        settings: [{ ...setting, units_per_box: 3000 }],
      }).items[0].boxSale,
    ).toBe(1000);
  });
  it("authorizes admin reads and rejects employee financial/export requests before loading private rows", () => {
    expect(
      authorizeAnalyticsRead({ user_role: "admin" }, access, {
        source: "all",
        financial: true,
        export: true,
      }),
    ).toMatchObject({ canExport: true, canManageBoxes: true });
    const user = { user_role: "employee", user_permissions: { actual_items_read: true } };
    const operational = authorizeAnalyticsRead(user, access, {
      source: "all",
      financial: false,
      export: false,
    });
    expect(operational.access.actual.cost).toBe(false);
    expect(operational.access.actual.profit).toBe(false);
    expect(() =>
      authorizeAnalyticsRead(user, access, { source: "all", financial: true, export: false }),
    ).toThrow();
    expect(() =>
      authorizeAnalyticsRead(user, access, { source: "all", financial: false, export: true }),
    ).toThrow();
    expect(() =>
      authorizeAnalyticsRead({ ...user, user_permissions: { reports_read: true } }, access, {
        source: "actual",
        financial: true,
        export: false,
      }),
    ).toThrow();
    const phif = authorizeAnalyticsRead(
      {
        ...user,
        user_permissions: {
          reports_read: true,
          phif_cost_read: true,
          phif_profit_read: true,
          phif_revenue_read: true,
        },
      },
      access,
      { source: "phif", financial: true, export: false },
    );
    expect(phif.access.phif.profit).toBe(true);
    expect(phif.access.actual.profit).toBe(false);
  });
  it("uses a deterministic invoice tie-breaker for the latest eligible historical sale", () => {
    const a = item("a", "v"),
      b = item("b", "w");
    expect(
      report([a, b], [invoice("v"), invoice("w")], { rows: [row(a, 60), row(b, 90)] }).items[0],
    ).toMatchObject({ boxSale: 90, latestSale: { conflict: false, invoiceNumber: "w" } });
  });
  it("requires documented units, rejects mixed unit sums and never derives a package size from strength", () => {
    const a = item("a", "v", "phif-supplier", {
      strength: "5/1000MG",
      metadata: { dosage_form: "tablet" },
    });
    const key = scientificReportIdentity(a).key;
    const result = report([a], [invoice("v")], { settings: [{ ...setting, item_identity: key }] });
    expect(result.items[0]).toMatchObject({ boxes: null, units: null, boxSale: null });
    const b = item("b", "v", "phif-supplier", {
      metadata: { quantity_unit: "PEN", dosage_form: "tablet" },
    });
    expect(report([item("ok", "v"), b], [invoice("v")]).items[0].units).toBeNull();
  });
  it("converts boxes and explicitly documented strips, not assumed strip counts", () => {
    const a = item("a", "v", "phif-supplier", {
      quantity: 3,
      metadata: {
        quantity_unit: "STRIP",
        dosage_form: "tablet",
        package_quantity: 30,
        strips_quantity: 3,
      },
    });
    expect(report([a], [invoice("v")]).items[0].boxes).toBe(1);
    const b = { ...a, metadata: { quantity_unit: "STRIP", dosage_form: "tablet" } };
    expect(report([b], [invoice("v")]).items[0].boxes).toBeNull();
  });
  it("supports a documented pen quantity and multiple pens in a box", () => {
    const a = item("a", "v", "phif-supplier", {
      quantity: 5,
      metadata: { quantity_unit: "PEN", dosage_form: "pen" },
    });
    const key = scientificReportIdentity(a).key;
    expect(
      report([a], [invoice("v")], {
        settings: [{ ...setting, item_identity: key, base_unit: "pen", units_per_box: 5 }],
      }).items[0].boxes,
    ).toBe(1);
  });
  it("does not invent a box size or a discount", () => {
    const result = report([item("a", "v")], [invoice("v")], { settings: [] });
    expect(result.items[0]).toMatchObject({ boxSale: null, boxes: null, afterDiscount: null });
  });
  it("uses a saved explicit quantity-unit confirmation, never the purchase denominator alone", () => {
    const a = item("a", "v", "phif-supplier", {
      metadata: {},
      phif_financial_fields: {
        total_amount: 60,
        internal_purchase_price_basis: {
          amount: 90,
          count: 60,
          unit: "TAB",
          quantity_unit_confirmed: true,
        },
      },
    });
    expect(report([a], [invoice("v")]).items[0]).toMatchObject({ boxes: 1, form: "tablet" });
    const b = {
      ...a,
      phif_financial_fields: {
        ...a.phif_financial_fields,
        internal_purchase_price_basis: {
          amount: 90,
          count: 60,
          unit: "TAB",
          quantity_unit_confirmed: false,
        },
      },
    };
    expect(report([b], [invoice("v")]).reviewItems[0].boxes).toBeNull();
  });
  it("preserves current manual cost changes and never reapplies historical import totals", () => {
    const a = item("a", "v");
    expect(report([a], [invoice("v")], { rows: [row(a, 60, 40)] }).items[0].profit).toBe(20);
    expect(report([a], [invoice("v")], { rows: [row(a, 60, 50)] }).items[0].profit).toBe(10);
  });
  it("counts a mixed-source invoice once and keeps a losing invoice visible under a profitable drug", () => {
    const a = item("a", "v"),
      b = item("b", "w", "actual-supplier"),
      c = item("c", "w");
    const result = report([a, b, c], [invoice("v"), invoice("w")], {
      rows: [row(a, 10, 20), row(b, 90, 10), row(c, 20, 10)],
    });
    expect(result.invoices).toHaveLength(2);
    expect(result.items[0].losingInvoices).toBe(1);
    expect(result.beneficiaries).toHaveLength(1);
    expect(result.beneficiaries[0].invoiceCount).toBe(2);
    expect(result.audit).toMatchObject({ losingItems: 0, losingInvoices: 1 });
    expect(selectAnalyticsRows(result, "invoices", { ...filters, result: "loss" })).toHaveLength(1);
  });
  it("never turns an unknown cost into zero or a completed invoice", () => {
    const a = item("a", "v");
    const result = report([a], [invoice("v")], { rows: [row(a, 60, null)] });
    expect(result.items[0]).toMatchObject({ cost: null, profit: null, complete: false });
    expect(result.invoices[0]).toMatchObject({ cost: null, profit: null, complete: false });
  });
  it("redacts source finances, price basis and PII on the server before API or export", async () => {
    const a = item("a", "v"),
      b = item("b", "v", "actual-supplier");
    const rights = {
      ...access,
      phif: { ...access.phif, revenue: false, cost: false, profit: false, movements: false },
    };
    const result = report([a, b], [invoice("v")], { access: rights });
    expect(result.movements[0]).toMatchObject({
      revenue: null,
      cost: null,
      profit: null,
      beneficiary: null,
      card: null,
      supplierBasis: null,
      canEditCost: false,
    });
    expect(result.invoices[0]).toMatchObject({
      revenue: null,
      cost: null,
      profit: null,
      complete: false,
    });
    expect(result.items[0].boxSale).toBeNull();
    const book = await buildAnalyticsWorkbook(result, "consumption", filters);
    const movements = XLSX.utils.sheet_to_json(book.Sheets["سجل الصرف"]);
    expect((movements[0] as any).تكلفة_الشراء == null).toBe(true);
  });
  it("excludes unauthorized sources and unclassified items instead of treating them as Actual", () => {
    const a = item("a", "v"),
      b = item("b", "v", "actual-supplier"),
      c = item("c", "v", "unknown");
    expect(
      report([a, b, c], [invoice("v")], {
        access: { ...access, phif: { ...access.phif, items: false } },
      }).movements.map((r) => r.id),
    ).toEqual(["b"]);
  });
  it("never merges missing-card beneficiaries using their name", () => {
    const result = report(
      [item("a", "v"), item("b", "w")],
      [invoice("v", "2026-09-01", ""), invoice("w", "2026-09-02", "")],
    );
    expect(result.beneficiaries).toHaveLength(0);
    expect(result.items[0].beneficiaries).toBe(0);
    expect(result.items[0].beneficiariesWithoutCard).toBe(2);
  });
  it("exports all filtered results to two actual XLSX sheets with text cards and numerical prices", async () => {
    const items = Array.from({ length: 65 }, (_, i) => item(`i${i}`, `v${i}`));
    const result = report(
      items,
      items.map((i) => invoice(i.phif_invoice_id)),
    );
    const book = await buildAnalyticsWorkbook(result, "consumption", filters);
    const bytes = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    const parsed = XLSX.read(bytes, { type: "buffer" });
    expect(parsed.SheetNames).toEqual(["ملخص الأصناف", "سجل الصرف"]);
    const rows = XLSX.utils.sheet_to_json(parsed.Sheets["سجل الصرف"]);
    expect(rows).toHaveLength(65);
    expect((rows[0] as any).البطاقة).toBe("000123");
    expect((rows[0] as any).قيمة_البيع).toBe(60);
    expect((rows[0] as any).التاريخ).toBe("2026-09-10");
  });
  it("continues to use Actual's existing cost engine rather than a parallel financial formula", () => {
    const a = item("a", "v", "actual-supplier", {
      brand: "FORMIN 500MG",
      metadata: { unit: "TAB" },
      quantity: 30,
    });
    const stock = {
      brand_name: "FORMIN 500MG",
      active_ingredient: "Metformin",
      strength: "500MG",
      dosage_unit: "TAB",
      cost_price: 0.284,
      sale_price: 1,
      source_stock_id: "s",
    };
    const profit = calculateActualGrossMargin(a, [stock]);
    expect(profit.purchaseCost).toBeCloseTo(8.52, 3);
    const result = report([a], [invoice("v")], {
      rows: [{ ...row(a), purchase_cost: profit.purchaseCost, gross_margin: profit.grossMargin }],
    });
    expect(result.items[0].cost).toBeCloseTo(8.52, 3);
  });
  it("requires authenticated admin writes and server-only settings with atomic operation logging", () => {
    const server = readFileSync("src/lib/items-analytics.functions.ts", "utf8");
    const sql = readFileSync(
      "supabase/migrations/20261022010000_add_report_box_settings.sql",
      "utf8",
    );
    expect(server).toContain('user.user_role !== "admin"');
    expect(server).toContain('.eq("is_active", true)');
    const helpers = readFileSync("src/lib/items-analytics.helpers.ts", "utf8");
    expect(helpers).toContain('can("stock_cost_read")');
    expect(helpers).toContain('request.export && !can("reports_export")');
    expect(server).toContain("loadItemAnalyticsDataset((context, access)");
    expect(sql).toContain("p_actor_id IS NULL");
    expect(sql).toContain("REVOKE ALL ON FUNCTION");
    expect(sql).toContain("public.user_operation_log");
    expect(sql).not.toMatch(/UPDATE public\.(phif_invoice_items|phif_stock_items|patients)/);
    expect(server).not.toMatch(/73989|historical-cost|source-prices/);
  });
  it("scopes client report caches to pharmacy, user and permissions, and invalidates after cost edits", () => {
    const page = readFileSync("src/components/management/ItemsAnalyticsViews.tsx", "utf8");
    expect(page).toContain("session.data.pharmacy.id");
    expect(page).toContain("session.data.user?.permissions");
    expect(page).toContain('["items_analytics", scope, view, filters]');
    expect(page).toContain("gcTime: 0");
    expect(
      readFileSync("src/components/management/SupplierPriceBasisEditor.tsx", "utf8"),
    ).toContain('"items_analytics"');
  });
});
