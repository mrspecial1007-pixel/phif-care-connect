import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuickCostForm, QuickCostItemSummary, QuickSupplierCosts } from "@/components/management/QuickSupplierCosts";
import { buildManagementAuditReport } from "@/lib/management.functions";
import { normalizeSupplierUnit, supplierInvoiceForm, supplierInvoiceUnit, supplierQuantityLabel, quickCostDraft, quickCostInput, quickCostUnchanged, saveQuickCostEntry, supplierQuickCostGroups, supplierQuickCostIdentity, type QuickCostEntry } from "@/lib/phif-supplier-quick-cost.helpers";

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

  it("reads explicit invoice units, skips empty aliases and never uses saved purchase units as dispensing evidence", () => {
    for (const value of ["TAB", "TABS", "TABLET", "tablets", "قرص", "أقراص"]) expect(normalizeSupplierUnit(value)).toBe("TAB");
    expect(supplierInvoiceUnit({ metadata: { unit: "", quantity_unit: "tablets" } })).toEqual({ unit: "TAB", issue: null });
    expect(supplierInvoiceUnit({ metadata: { quantityUnit: "strips", unit: "TABLETS" } }).unit).toBe("STRIP");
    expect(supplierInvoiceUnit({ phif_financial_fields: { unit: "BOX" } }).unit).toBe("BOX");
    expect(supplierInvoiceUnit({ metadata: {}, phif_financial_fields: { internal_purchase_cost_unit: "TAB" } })).toEqual({ unit: null, issue: "missing" });
    expect(supplierInvoiceUnit({ metadata: { quantity_unit: "TAB" }, phif_financial_fields: { quantity_unit: "BOX" } })).toEqual({ unit: null, issue: "conflict" });
    expect(supplierInvoiceUnit({ metadata: { unit: "MG" } })).toEqual({ unit: null, issue: "unknown" });
    expect(supplierInvoiceForm({ metadata: { quantity_unit: "BOX" } })).toBeNull();
    expect(supplierInvoiceForm({ metadata: { quantity_unit: "TABLETS" } })).toBe("TAB");
    expect(supplierQuickCostIdentity({ ...identity, metadata: { quantityUnit: "boxes", dosageForm: "tablets", packageQuantity: "30", stripsQuantity: "3" } })).toBe(supplierQuickCostIdentity(identity));
  });

  it("shows real quantity units without converting quantities or assuming tablets", () => {
    expect(supplierQuantityLabel(30, "TABLETS")).toBe("30 قرصًا");
    expect(supplierQuantityLabel(3, "BOX")).toBe("3 علب");
    expect(supplierQuantityLabel(3, "STRIPS")).toBe("3 أشرطة");
    expect(supplierQuantityLabel(30, "CAPSULES")).toBe("30 كبسولة");
    expect(supplierQuantityLabel(5, "PENS")).toBe("5 أقلام");
    expect(supplierQuantityLabel(30, null)).toBe("30");
    expect(supplierQuantityLabel(null, "TAB")).toBe("—");
  });

  it("renders prominent item, compound strength and sale value with a single expandable data warning", () => {
    const raw = { ...entry, active_ingredient: "Amlodipine + Valsartan", strength: "10MG/160MG", invoice_number: "1525611", dispensing_date: "2026-04-01", quantity: 30, invoice_quantity_unit: undefined, invoice_value: 90, quick_cost_identity: '["unresolved","i1"]' };
    const html = renderToStaticMarkup(createElement(QuickCostItemSummary, { item: raw, position: 1, count: 1 }));
    expect(html).toContain("text-xl font-bold");
    expect(html).toContain("text-2xl font-bold");
    expect(html).toContain("text-blue-950");
    expect(html).toContain("10MG/160MG");
    expect(html).toContain("90.000");
    expect(html.match(/<summary/g)).toHaveLength(1);
    expect(html).not.toContain("30 قرص");
    expect(html).not.toContain("30 وحدة غير مسجلة");
    expect(html).not.toContain("شكل دوائي غير مسجل");
    const confirmed = renderToStaticMarkup(createElement(QuickCostItemSummary, { item: { ...raw, invoice_quantity_unit: "TAB", invoice_dosage_form: "TAB", quick_cost_identity: "confirmed" }, position: 1, count: 1 }));
    expect(confirmed).toContain("30 قرصًا");
    expect(confirmed).not.toContain("<details");
    expect(quickCostInput(raw, "total_dispensed_cost", "60").purchaseCostValue).toBe(60);
    expect(() => quickCostInput(raw, "unit_price", "2")).toThrow("وحدة");
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
    expect(quickCostInput(entry, "total_dispensed_cost", "60")).toEqual({ itemId: "i1", purchaseCostMode: "total_dispensed_cost", purchaseCostValue: 60 });
    expect(quickCostInput(entry, "unit_price", "20")).toEqual({ itemId: "i1", purchaseCostMode: "unit_price", purchaseCostValue: 20, purchaseCostUnit: "BOX" });
    expect(quickCostInput({ ...entry, unit: "OLD-SAVED-UNIT" }, "unit_price", "20").purchaseCostUnit).toBe("BOX");
    expect(quickCostInput({ ...entry, item_id: "i2" }, "total_dispensed_cost", "12").itemId).toBe("i2");
    expect(() => quickCostInput({ ...entry, invoice_quantity_unit: undefined }, "unit_price", "20")).toThrow("وحدة");
    expect(() => quickCostInput({ ...entry, quantity: 0 }, "unit_price", "20")).toThrow("كمية");
  });

  it("allows direct changes to existing costs, including zero, while respecting server permissions", () => {
    expect(quickCostInput({ ...entry, unit_purchase_price: 0 }, "total_dispensed_cost", "60").purchaseCostValue).toBe(60);
    for (const item of [{ ...entry, source: "actual" }, { ...entry, can_edit_purchase_price: false }, { ...entry, cost_hidden: true }]) {
      expect(() => quickCostInput(item, "total_dispensed_cost", "60")).toThrow("صلاحية");
    }
    for (const raw of ["", " ", "-1", "NaN", "Infinity"]) expect(() => quickCostInput(entry, "total_dispensed_cost", raw)).toThrow();
  });

  it("restores each item's saved amount and mode without converting values between modes or items", () => {
    expect(quickCostDraft(entry)).toEqual({ mode: "total_dispensed_cost", value: "" });
    expect(quickCostDraft({ ...entry, unit_purchase_price: 60, purchase_cost_mode: "total_dispensed_cost" })).toEqual({ mode: "total_dispensed_cost", value: "60" });
    expect(quickCostDraft({ ...entry, item_id: "i2", unit_purchase_price: 20, purchase_cost_mode: "unit_price" })).toEqual({ mode: "unit_price", value: "20" });
    expect(quickCostDraft({ ...entry, unit_purchase_price: 0, purchase_cost_mode: "unit_price" })).toEqual({ mode: "unit_price", value: "0" });
    const saved = { ...entry, unit_purchase_price: 60, purchase_cost_mode: "total_dispensed_cost" as const };
    expect(quickCostUnchanged(saved, quickCostInput(saved, "total_dispensed_cost", "60.000"))).toBe(true);
    expect(quickCostUnchanged(saved, quickCostInput(saved, "unit_price", "60"))).toBe(false);
    expect(quickCostUnchanged(saved, quickCostInput(saved, "total_dispensed_cost", "61"))).toBe(false);
    expect(quickCostUnchanged({ ...saved, item_id: "other" }, quickCostInput(saved, "total_dispensed_cost", "60"))).toBe(false);
    expect(quickCostUnchanged(entry, quickCostInput(entry, "total_dispensed_cost", "0"))).toBe(false);
    const unit = { ...entry, unit_purchase_price: 20, purchase_cost_mode: "unit_price" as const, unit: "boxes" };
    expect(quickCostUnchanged(unit, quickCostInput(unit, "unit_price", "20"))).toBe(true);
    expect(quickCostUnchanged({ ...unit, unit: "STRIP" }, quickCostInput(unit, "unit_price", "20"))).toBe(false);
  });

  it("prefills the actual form with saved unit price and mode, without confirmation or a separate saved banner", () => {
    const render = (item: QuickCostEntry) => renderToStaticMarkup(createElement(QuickCostForm, {
      item, lock: { busy: false }, onBusy: () => {}, onNext: () => {}, onSave: async () => { throw new Error("Render cannot save"); },
    }));
    const html = render({ ...entry, quantity: 1, invoice_quantity_unit: "PEN", unit: "PEN", purchase_cost_mode: "unit_price", unit_purchase_price: 20 });
    expect(html).toContain('value="20"');
    expect(html).toMatch(/<option value="unit_price" selected=""/);
    expect(html).not.toContain("checkbox");
    expect(html).not.toContain("المحفوظ:");
    expect(html).toContain("حفظ والتالي");
    const missing = render({ ...entry, invoice_quantity_unit: undefined, purchase_cost_mode: "unit_price", unit_purchase_price: 20 });
    expect(missing).not.toContain("undefined");
    expect(missing).toContain("غير موثقة");
    expect(missing).toMatch(/<option value="unit_price" disabled="" selected=""/);
    expect(render(entry)).toMatch(/<option value="total_dispensed_cost" selected=""/);
  });

  it("skips unchanged updates, advances once, and never reports them as a new save", async () => {
    const lock = { busy: false };
    const current = { ...entry, unit_purchase_price: 60, purchase_cost_mode: "total_dispensed_cost" as const };
    const input = quickCostInput(current, "total_dispensed_cost", "60");
    const changes: boolean[] = [];
    let writes = 0;
    const save = async () => { writes++; };
    const first = saveQuickCostEntry(lock, input, save, changed => changes.push(changed), current);
    expect(await saveQuickCostEntry(lock, input, save, changed => changes.push(changed), current)).toBe(false);
    await first;
    expect(writes).toBe(0);
    expect(changes).toEqual([false]);
    await saveQuickCostEntry(lock, quickCostInput(current, "total_dispensed_cost", "65"), save, changed => changes.push(changed), current);
    expect(writes).toBe(1);
    expect(changes).toEqual([false, true]);
  });

  it("supports trustworthy single-unit pricing for pens, eye drops, vials, ampoules, bottles and tubes", () => {
    for (const [recorded, canonical] of [["Pen", "PEN"], ["Eye Drops", "EYE_DROPS"], ["Vial", "VIAL"], ["Ampoule", "AMP"], ["Bottle", "BOTTLE"], ["Tube", "TUBE"]]) {
      const unit = supplierInvoiceUnit({ metadata: { quantity_unit: recorded } }).unit;
      expect(unit).toBe(canonical);
      const item = { ...entry, quantity: 1, invoice_quantity_unit: unit! };
      expect(quickCostInput(item, "unit_price", "20")).toEqual({ itemId: "i1", purchaseCostMode: "unit_price", purchaseCostValue: 20, purchaseCostUnit: canonical });
      const report = buildManagementAuditReport({ invoices: [{ id: "a" }], stocks: [], items: [{ id: "i1", phif_invoice_id: "a", source_classification: "phif-supplier", quantity: 1,
        metadata: { quantity_unit: recorded }, phif_financial_fields: { total_amount: 50, internal_purchase_cost_mode: "unit_price", internal_purchase_cost_value: 20, internal_purchase_cost_unit: canonical } }] });
      expect(report.financial.summary.complete_invoices).toBe(1);
    }
    expect(supplierInvoiceUnit({ brand: "Product Pen Eye Drops Vial", metadata: { dosage_form: "Eye Drops" } }).unit).toBeNull();
    expect(normalizeSupplierUnit("Eye Drops")).not.toBe(normalizeSupplierUnit("Bottle"));
    expect(supplierQuantityLabel(1, "Eye Drops")).toBe("1 قطرة عين");
    expect(() => quickCostInput({ ...entry, quantity: 1, invoice_quantity_unit: undefined }, "unit_price", "20")).toThrow("وحدة");
    expect(quickCostInput({ ...entry, quantity: 1, invoice_quantity_unit: undefined }, "total_dispensed_cost", "20").purchaseCostValue).toBe(20);
  });

  it("waits for a successful save before advancing and blocks repeated Enter / clicks", async () => {
    const lock = { busy: false };
    const input = quickCostInput(entry, "total_dispensed_cost", "60");
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
    const input = quickCostInput(entry, "total_dispensed_cost", "60");
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

  it("keeps total-cost invoices complete without units, but requires a verified unit for unit-price costs", () => {
    const invoice = { id: "a", dispensing_date: "2026-04-01", invoice_number: "1525611" };
    const item = { id: "i1", phif_invoice_id: "a", source_classification: "phif-supplier", active_ingredient: "Amlodipine + Valsartan", strength: "10MG/160MG", quantity: 30, metadata: {}, phif_financial_fields: { total_amount: 90, internal_purchase_cost_mode: "total_dispensed_cost", internal_purchase_cost_value: 60 } };
    const report = (row: any) => buildManagementAuditReport({ invoices: [invoice], items: [row], stocks: [] }).financial;
    expect(report(item).summary.complete_invoices).toBe(1);
    const unitPrice = { ...item, phif_financial_fields: { ...item.phif_financial_fields, internal_purchase_cost_mode: "unit_price", internal_purchase_cost_value: 2, internal_purchase_cost_unit: "TABS" } };
    expect(report(unitPrice).incomplete_invoices[0].unit_review_count).toBe(1);
    expect(report({ ...unitPrice, metadata: { quantityUnit: "TABLETS" } }).summary.complete_invoices).toBe(1);
    expect(report({ ...unitPrice, metadata: { quantity_unit: "BOX" } }).summary.complete_invoices).toBe(0);
    expect(report({ ...unitPrice, metadata: { unit: "TABS" }, phif_financial_fields: { ...unitPrice.phif_financial_fields, unit: "BOX" } }).summary.complete_invoices).toBe(0);
  });

  it("uses the existing save endpoint, restores saved mode and cost, and removes confirmation and saved banners", () => {
    const route = readFileSync("src/routes/management.treasury.tsx", "utf8");
    const ui = readFileSync("src/components/management/QuickSupplierCosts.tsx", "utf8");
    const server = readFileSync("src/lib/management.functions.ts", "utf8");
    expect(route).toContain("saveMutation.mutateAsync(input)");
    expect(route).toContain("await Promise.all");
    expect(route).toContain('["treasury_report"]');
    expect(route).toContain('["management_profit_analysis"]');
    expect(server).toContain('requireTiryaqPermission("phif_purchase_price_write")');
    expect(server).toContain("quick_cost_identity: profit.source === \"phif\" ? supplierQuickCostIdentity(item) : null");
    expect(ui).toContain("quickCostDraft(item).mode");
    expect(ui).toContain("quickCostDraft(item).value");
    expect(ui).not.toContain("أؤكد استبدال");
    expect(ui).not.toContain("Checkbox");
    expect(ui).not.toContain("المحفوظ:");
    expect(ui).toContain('setMode(event.target.value as SupplierCostMode); setValue("")');
    expect(ui).toContain("حفظ والتالي");
    expect(ui).toContain("onSubmit={submit}");
    expect(ui).toContain("setError(failure instanceof Error");
    expect(ui).not.toContain("supabase");
  });
});
