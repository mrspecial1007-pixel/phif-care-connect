import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { BoxEditor } from "@/components/management/ItemsAnalyticsViews";
import { actualUnit } from "../actual-units.helpers";
import { reportReviewIdentity, reportReviewRequest, REPORT_REVIEW_FORMS } from "../report-identity-review.helpers";
import { loadReportSettingScope } from "../report-setting-scope.server";
import { analyticsSearchSchema, authorizeAnalyticsRead, buildItemsAnalytics, scientificReportIdentity } from "../items-analytics.helpers";

vi.mock("@/components/ui/sheet", () => {
  const Wrapper = ({ children }: any) => <div>{children}</div>;
  return { Sheet: Wrapper, SheetContent: Wrapper, SheetHeader: Wrapper, SheetTitle: Wrapper, SheetDescription: Wrapper };
});

const pharmacyId = "tiryaq";
const item = (id: string, patch: any = {}) => ({
  id, phif_invoice_id: `invoice-${id}`, source_classification: "phif-supplier",
  active_ingredient: "Amlodipine + Valsartan", strength: "10MG/160MG", brand: "Brand",
  quantity: 30, metadata: {}, phif_financial_fields: { total_amount: 90, internal_purchase_cost_value: 24 },
  invoice: { pharmacy_id: pharmacyId }, ...patch,
});
const raw = scientificReportIdentity(item("a")).key;
const identity = scientificReportIdentity(item("a"), "tablet").key;
const definition = (patch: any = {}) => ({ id: "setting", pharmacy_id: pharmacyId, item_identity: identity,
  units_per_box: 30, base_unit: "tablet" as const, version: 1, ...patch });
const rights = { items: true, movements: true, revenue: true, cost: true, profit: true };

function database(items: any[], settings: any[] = [], stocks: any[] = []) {
  const calls: { table: string; filters: [string, any][] }[] = [];
  return { calls, db: { from(table: string) {
    const call = { table, filters: [] as [string, any][] }; calls.push(call);
    let rows = table === "phif_invoice_items" ? items : table === "phif_report_box_settings" ? settings
      : table === "phif_stock_items" ? stocks : [];
    const q: any = {
      select: () => q, order: () => q, not: () => q,
      eq: (field: string, value: any) => {
        call.filters.push([field, value]);
        rows = rows.filter(r => (field === "invoice.pharmacy_id" ? r.invoice?.pharmacy_id : r[field]) === value);
        return q;
      },
      in: (field: string, values: any[]) => { rows = rows.filter(r => values.includes(r[field])); return q; },
      limit: async (n: number) => ({ data: rows.slice(0, n), error: null }),
      range: async (a: number, b: number) => ({ data: rows.slice(a, b + 1), count: rows.length, error: null }),
    };
    return q;
  } } };
}

function report(items: any[], settings: any[] = []) {
  return buildItemsAnalytics({ pharmacyId, items, settings, stocks: [],
    rows: items.map(i => ({ item_id: i.id, revenue: 90, purchase_cost: 24, gross_margin: 66 })),
    invoices: items.map(i => ({ id: i.phif_invoice_id, dispensing_date: "2026-10-24", insurance_card_number: "000123" })),
    access: { phif: rights, actual: rights }, filters: analyticsSearchSchema.parse({ month: "all" }),
  });
}

describe("manual Supplier identity review through existing report settings", () => {
  it("builds a complete scientific key without changing the original unresolved key", () => {
    expect(reportReviewIdentity(raw, "tablet")).toBe(identity);
    expect(JSON.parse(raw)).toEqual(["amlodipine + valsartan", "10mg/160mg", "", "unresolved", "a"]);
    expect(reportReviewIdentity(raw, "capsule")).not.toBe(identity);
  });

  it.each(REPORT_REVIEW_FORMS.filter(([form]) => actualUnit(form)))("supports an explicit %s form with a separate pack count", form => {
    const request = reportReviewRequest({ id: raw }, form, "1", form, "a");
    expect(request).toMatchObject({ baseUnit: form, unitsPerBox: 1, version: 0, reviewItemId: "a" });
    expect(request).not.toHaveProperty("supplier_quantity_unit");
  });

  it("keeps non-discrete forms separate from their explicitly selected pack-content unit", () => {
    expect(reportReviewRequest({ id: raw }, "cream", "1", "tube", "a")).toMatchObject({ baseUnit: "tube" });
    expect(reportReviewRequest({ id: raw }, "cream", "1", "", "a")).toBeNull();
    expect(reportReviewRequest({ id: raw }, "tablet", "30", "pen", "a")).toBeNull();
  });

  it("rejects incomplete identities, unsupported forms, invalid sizes and missing Supplier items", () => {
    for (const key of ['["","10mg","","unresolved","a"]', '["drug","","","unresolved","a"]', '[]', 'invalid'])
      expect(reportReviewIdentity(key, "tablet")).toBeNull();
    expect(reportReviewIdentity(raw, "invented-form")).toBeNull();
    for (const count of ["", "0", "-1", "2.5", "10001", "NaN"])
      expect(reportReviewRequest({ id: raw }, "tablet", count, "tablet", "a")).toBeNull();
    expect(reportReviewRequest({ id: raw }, "tablet", "30", "tablet")).toBeNull();
  });

  it("verifies one current pharmacy item and previews all compatible historical/future Supplier items", async () => {
    const items = [item("a"), item("historic"), item("future", { brand: "another" }),
      item("wrong-dose", { strength: "5MG/160MG" }), item("actual", { source_classification: "actual-supplier" }),
      item("foreign", { invoice: { pharmacy_id: "andalus" } })];
    const before = JSON.stringify(items);
    const { db, calls } = database(items);
    const scope = await loadReportSettingScope(db, pharmacyId, identity, undefined, { itemId: "a", baseUnit: "tablet" });
    expect(scope.items.map(i => i.id)).toEqual(["a", "historic", "future"]);
    expect(calls[0].filters).toContainEqual(["invoice.pharmacy_id", pharmacyId]);
    expect(calls.some(c => c.table === "phif_invoices")).toBe(false);
    expect(JSON.stringify(items)).toBe(before);
  });

  it("rejects other pharmacies, forged strengths and Actual-only review targets", async () => {
    const { db } = database([item("a"), item("foreign", { invoice: { pharmacy_id: "andalus" } }),
      item("actual", { source_classification: "actual-supplier" })]);
    for (const itemId of ["foreign", "missing", "actual"])
      await expect(loadReportSettingScope(db, pharmacyId, identity, undefined, { itemId, baseUnit: "tablet" })).rejects.toThrow("بند المراجعة");
    await expect(loadReportSettingScope(db, pharmacyId, '["amlodipine + valsartan","5mg/160mg","tablet"]', undefined,
      { itemId: "a", baseUnit: "tablet" })).rejects.toThrow("بند المراجعة");
  });

  it("never replaces a different explicit source form, or selects between conflicting saved forms", async () => {
    const explicit = database([item("a", { metadata: { dosage_form: "CAP" } })]);
    await expect(loadReportSettingScope(explicit.db, pharmacyId, identity, undefined, { itemId: "a", baseUnit: "tablet" }))
      .rejects.toThrow("شكل دوائي صريح");
    const conflict = database([item("a")], [definition(), definition({ id: "cap", item_identity: identity.replace("tablet", "capsule"), base_unit: "capsule" })]);
    await expect(loadReportSettingScope(conflict.db, pharmacyId, identity, undefined, { itemId: "a", baseUnit: "tablet" }))
      .rejects.toThrow("أكثر من شكل");
    const stock = database([item("a")], [], [{ id: "s", pharmacy_id: pharmacyId, is_current: true,
      active_ingredient: item("a").active_ingredient, strength: item("a").strength, dosage_unit: "CAP" }]);
    await expect(loadReportSettingScope(stock.db, pharmacyId, identity, undefined, { itemId: "a", baseUnit: "tablet" }))
      .rejects.toThrow("تعارض");
  });

  it("removes genuinely resolved review items after reload, preserves finances and never establishes a dispensing unit", () => {
    const items = [item("a"), item("historic"), item("future"), item("actual", { source_classification: "actual-supplier" })];
    const original = JSON.stringify(items);
    const before = report(items);
    const saved = [definition()];
    const after = report(items, saved);
    expect(before.reviewItems).toHaveLength(4);
    expect(after.reviewItems).toHaveLength(1);
    expect(after.reviewItems[0].sources).toEqual(["actual"]);
    expect(after.items[0]).toMatchObject({ id: identity, dispenseCount: 3, cost: 72, profit: 198, boxes: null });
    expect(after.movements.filter(r => r.source === "phif").every(r => r.unit == null && r.quantity === 30)).toBe(true);
    expect(after.movements.find(r => r.source === "actual")).toEqual(before.movements.find(r => r.source === "actual"));
    expect(after.invoices).toEqual(before.invoices);
    expect(after.beneficiaries).toEqual(before.beneficiaries);
    expect(report(structuredClone(items), structuredClone(saved))).toEqual(after);
    expect(JSON.stringify(items)).toBe(original);
  });

  it("keeps saved definitions stable across later box-size edits and reuses them without duplicates", () => {
    const items = [item("a"), item("b")];
    const first = report(items, [definition()]);
    const changed = report(items, [definition({ units_per_box: 60, version: 2 })]);
    expect(first.items).toHaveLength(1);
    expect(changed.items).toHaveLength(1);
    expect(changed.reviewItems).toHaveLength(0);
    expect(changed.items[0]).toMatchObject({ id: identity, cost: first.items[0].cost, profit: first.items[0].profit });
    expect(changed.items[0].setting.units_per_box).toBe(60);
  });

  it("renders review form and pack controls, blocks incomplete saves and hides the separate quantity-unit approval", () => {
    const client = new QueryClient();
    const html = renderToStaticMarkup(<QueryClientProvider client={client}>
      <BoxEditor item={{ id: raw, ingredient: "Amlodipine + Valsartan", strength: "10MG/160MG", form: "", identityComplete: false }}
        rows={[{ id: "a", source: "phif" } as any]} unitsAvailable reportKey={["items_analytics"]} onClose={() => {}} />
    </QueryClientProvider>);
    client.clear();
    expect(html).toContain("تعريف صنف PHIF Supplier");
    expect(html).toContain('aria-label="الشكل الدوائي"');
    expect(html).toContain("عدد الوحدات في العلبة");
    expect(html).toContain("وحدة محتوى العلبة");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
    expect(html).not.toContain("حفظ توثيق الوحدة");
  });

  it("keeps admin-only server verification, version protection and the existing audited RPC", () => {
    const access = { phif: rights, actual: rights };
    expect(authorizeAnalyticsRead({ user_role: "admin" }, access, { source: "all", financial: false, export: false }).canManageBoxes).toBe(true);
    expect(authorizeAnalyticsRead({ user_role: "employee" }, access, { source: "all", financial: false, export: false }).canManageBoxes).toBe(false);
    const source = readFileSync("src/lib/items-analytics.functions.ts", "utf8");
    expect(source).toContain('user.user_role !== "admin"');
    expect(source).toContain('.eq("pharmacy_id", context.pharmacy_id)');
    expect(source).toContain('.eq("is_active", true)');
    expect(source).toContain('supabaseAdmin.rpc("set_phif_report_box_setting"');
    expect(source).toContain("p_expected_version: data.version");
    expect(source).toContain("reviewItemId: z.string().uuid().optional()");
    expect(source).not.toMatch(/\.from\("phif_invoice_items"\)[\s\S]*\.update\(/);
  });
});
