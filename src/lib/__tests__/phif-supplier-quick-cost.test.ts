import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuickSupplierCosts } from "@/components/management/QuickSupplierCosts";
import { buildManagementAuditReport } from "@/lib/management.functions";
import { quickCostInput, saveQuickCostEntry, supplierQuickCostGroups, supplierQuickCostIdentity, type QuickCostEntry } from "@/lib/phif-supplier-quick-cost.helpers";

const identity = { id: "raw-1", brand: "DRUG", active_ingredient: "Ingredient", strength: "160/25MG", metadata: { unit: "BOX", dosage_form: "TABS", package_quantity: "30", strips_quantity: "3" } };
const entry: QuickCostEntry = { item_id: "i1", invoice_id: "a", source: "phif", quick_cost_identity: supplierQuickCostIdentity(identity), active_ingredient: "Ingredient", strength: "160/25MG", quantity: 3, invoice_quantity_unit: "BOX", unit_purchase_price: null, match_status: "needs_purchase_price", can_edit_purchase_price: true };

describe("PHIF Supplier quick invoice-item costs", () => {
  it("groups repeats across invoices but preserves every invoice-item and leaves Actual out", () => {
    const second = { ...entry, item_id: "i2", invoice_id: "b", match_status: "matched", unit_purchase_price: 12 };
    const groups = supplierQuickCostGroups([{ items: [entry, { ...entry, source: "actual", item_id: "actual" }] }, { items: [second, entry] }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map(row => row.item_id)).toEqual(["i1", "i2"]);
    expect(groups[0].complete).toBe(false);
    expect(supplierQuickCostGroups([{ items: [{ ...entry, match_status: "matched", unit_purchase_price: 0 }, second] }])[0].complete).toBe(true);
  });

  it("renders the compact counts from current report data and updates them after a saved-cost refetch", () => {
    const render = (items: QuickCostEntry[]) => renderToStaticMarkup(createElement(QuickSupplierCosts, {
      invoices: [{ items }], onSave: async () => { throw new Error("Rendering must not save data"); },
    })).replace(/<[^>]*>/g, "");
    expect(render([entry])).toContain("1 صنف فريد · 0 مكتمل · 1 ناقص");
    const saved = { ...entry, match_status: "matched", unit_purchase_price: 60, purchase_cost_mode: "total_dispensed_cost" as const };
    expect(render([saved])).toContain("1 صنف فريد · 1 مكتمل · 0 ناقص");
    expect(render([saved])).toContain("البنود: 1 مكتمل · 0 ناقص");
    expect(render([saved, { ...entry, item_id: "i2", invoice_id: "b" }])).toContain("1 صنف فريد · 0 مكتمل · 1 ناقص");
  });

  it("distinguishes complete strengths, dosage forms, quantity units and packaging", () => {
    const base = supplierQuickCostIdentity(identity);
    expect(supplierQuickCostIdentity({ ...identity, id: "another-invoice-item", strength: "160 / 25 mg", active_ingredient: " INGREDIENT " })).toBe(base);
    for (const variant of [
      { ...identity, strength: "160MG" },
      { ...identity, strength: "160/12.5MG" },
      { ...identity, metadata: { ...identity.metadata, dosage_form: "CAPS" } },
      { ...identity, metadata: { ...identity.metadata, unit: "TAB" } },
      { ...identity, metadata: { ...identity.metadata, package_quantity: "60" } },
      { ...identity, metadata: { ...identity.metadata, strips_quantity: "2" } },
    ]) expect(supplierQuickCostIdentity(variant)).not.toBe(base);
    expect(supplierQuickCostIdentity({ ...identity, id: "a", metadata: {} })).not.toBe(supplierQuickCostIdentity({ ...identity, id: "b", metadata: {} }));
  });

  it("starts incomplete groups and invoice items first, without modifying incoming report rows", () => {
    const complete = { ...entry, item_id: "complete", quick_cost_identity: "other", match_status: "matched", unit_purchase_price: 0 };
    const input = [{ items: [complete, { ...entry, item_id: "saved", match_status: "matched" }, entry] }];
    const before = JSON.stringify(input);
    const groups = supplierQuickCostGroups(input);
    expect(groups[0].entries[0].item_id).toBe("i1");
    expect(groups[1].complete).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("sends total cost unchanged and unit cost with the original invoice quantity unit", () => {
    expect(quickCostInput(entry, "total_dispensed_cost", "60", false)).toEqual({ itemId: "i1", purchaseCostMode: "total_dispensed_cost", purchaseCostValue: 60 });
    expect(quickCostInput(entry, "unit_price", "20", false)).toEqual({ itemId: "i1", purchaseCostMode: "unit_price", purchaseCostValue: 20, purchaseCostUnit: "BOX" });
    expect(quickCostInput({ ...entry, unit: "OLD-SAVED-UNIT" }, "unit_price", "20", false).purchaseCostUnit).toBe("BOX");
    expect(quickCostInput({ ...entry, item_id: "i2" }, "total_dispensed_cost", "12", false).itemId).toBe("i2");
    expect(() => quickCostInput({ ...entry, invoice_quantity_unit: undefined }, "unit_price", "20", false)).toThrow("وحدة");
    expect(() => quickCostInput({ ...entry, quantity: 0 }, "unit_price", "20", false)).toThrow("كمية");
  });

  it("requires explicit confirmation even for an existing zero cost and respects server permissions", () => {
    expect(() => quickCostInput({ ...entry, unit_purchase_price: 0 }, "total_dispensed_cost", "60", false)).toThrow("أكد");
    expect(quickCostInput({ ...entry, unit_purchase_price: 0 }, "total_dispensed_cost", "60", true).purchaseCostValue).toBe(60);
    for (const item of [{ ...entry, source: "actual" }, { ...entry, can_edit_purchase_price: false }, { ...entry, cost_hidden: true }]) {
      expect(() => quickCostInput(item, "total_dispensed_cost", "60", true)).toThrow("صلاحية");
    }
    for (const raw of ["", " ", "-1", "NaN", "Infinity"]) expect(() => quickCostInput(entry, "total_dispensed_cost", raw, false)).toThrow();
  });

  it("waits for a successful save before advancing and blocks repeated Enter / clicks", async () => {
    const lock = { busy: false };
    const input = quickCostInput(entry, "total_dispensed_cost", "60", false);
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const events: string[] = [];
    const save = async () => { events.push("save"); await pending; };
    const first = saveQuickCostEntry(lock, input, save, () => events.push("next"));
    expect(events).toEqual(["save"]);
    expect(await saveQuickCostEntry(lock, input, save, () => events.push("duplicate"))).toBe(false);
    finish();
    expect(await first).toBe(true);
    expect(events).toEqual(["save", "next"]);
    expect(lock.busy).toBe(false);
  });

  it("keeps the same item and input on failure and permits retry", async () => {
    const lock = { busy: false };
    const input = quickCostInput(entry, "total_dispensed_cost", "60", false);
    let advanced = 0;
    await expect(saveQuickCostEntry(lock, input, async () => { throw new Error("Save failed"); }, () => advanced++)).rejects.toThrow("Save failed");
    expect(advanced).toBe(0);
    expect(input.purchaseCostValue).toBe(60);
    expect(lock.busy).toBe(false);
    await saveQuickCostEntry(lock, input, async () => ({ ok: true }), () => advanced++);
    expect(advanced).toBe(1);
  });

  it("reuses existing financial calculations for total cost, unit cost and mode changes", () => {
    const invoice = { id: "a", dispensing_date: "2026-10-19", invoice_number: "100" };
    const raw = { id: "i1", phif_invoice_id: "a", source_classification: "phif-supplier", quantity: 3, metadata: { unit: "BOX" }, phif_financial_fields: { total_amount: 100 } };
    const audit = (fields: Record<string, unknown>) => buildManagementAuditReport({ invoices: [invoice], items: [{ ...raw, phif_financial_fields: { ...raw.phif_financial_fields, ...fields } }], stocks: [] });
    expect(audit({}).financial.summary.phif_missing_cost_items).toBe(1);
    for (const mode of ["total_dispensed_cost", "unit_price"]) {
      const report = audit({ internal_purchase_cost_mode: mode, internal_purchase_cost_value: mode === "unit_price" ? 20 : 60, internal_purchase_cost_unit: mode === "unit_price" ? "BOX" : null });
      expect(report.financial.summary.complete_invoices).toBe(1);
      expect(report.financial.summary.phif_missing_cost_items).toBe(0);
    }
  });

  it("uses the existing save endpoint, refreshes reports, and keeps default total mode with overwrite confirmation", () => {
    const route = readFileSync("src/routes/management.treasury.tsx", "utf8");
    const ui = readFileSync("src/components/management/QuickSupplierCosts.tsx", "utf8");
    const server = readFileSync("src/lib/management.functions.ts", "utf8");
    expect(route).toContain("saveMutation.mutateAsync(input)");
    expect(route).toContain("await Promise.all");
    expect(route).toContain('["treasury_report"]');
    expect(route).toContain('["management_profit_analysis"]');
    expect(server).toContain('requireTiryaqPermission("phif_purchase_price_write")');
    expect(server).toContain("quick_cost_identity: profit.source === \"phif\" ? supplierQuickCostIdentity(item) : null");
    expect(ui).toContain('useState<SupplierCostMode>("total_dispensed_cost")');
    expect(ui).toContain("أؤكد استبدال التكلفة المحفوظة لهذا البند فقط");
    expect(ui).toContain("حفظ والتالي");
    expect(ui).toContain("onSubmit={submit}");
    expect(ui).toContain("setError(failure instanceof Error");
    expect(ui).not.toContain("supabase");
  });
});
