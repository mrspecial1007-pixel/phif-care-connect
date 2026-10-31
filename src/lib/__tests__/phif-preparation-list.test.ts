import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildPhifMedicationProfileFromRows, phifMedicationIdentityKey } from "../phif-invoices.functions";
import { buildPreparationItems, preparationIdentityContext, groupPreparationItems, preparationNumber, preparationEstimatedBoxes, preparationTotalLabel, type PreparationItem } from "../phif-preparation-list.helpers";
import { buildPhifPreparationIndex } from "../phif-preparation.helpers";

const invoice = { id: "invoice", invoice_key: "invoice", dispensing_date: "2026-10-01" };
const source = (overrides: any = {}) => ({ id: "line", phif_invoice_id: "invoice", phif_item_id: "drug",
  active_ingredient: "Amlodipine", strength: "5MG", source_classification: "phif-supplier", quantity: 45,
  metadata: { dosage_form: "tablet", quantity_unit: "TAB", package_quantity: 30 }, ...overrides });
function project(rows = [source()], invoices: any[] = [invoice], settings: any[] = [], stopped = false) {
  const profile = buildPhifMedicationProfileFromRows(invoices, rows);
  if (stopped) profile.items[0].follow_up_status = "stopped";
  return { profile, details: buildPreparationItems(profile.items, rows, phifMedicationIdentityKey, "tiryaq", settings, invoices) };
}
const setting = { pharmacy_id: "tiryaq", item_identity: JSON.stringify(["amlodipine", "5mg", "tablet"]),
  base_unit: "tablet", units_per_box: 30, supplier_quantity_unit: "tablet" };
const dto = (overrides: Partial<PreparationItem> = {}): PreparationItem => ({ id: "medication", name: "Amlodipine",
  strength: "5MG", form: "tablet", dueDate: "2026-10-29", latestDate: "2026-10-01", sourceItemIds: ["a"],
  quantity: 45, quantityUnit: "tablet", packageSize: 30, packageUnit: "tablet", lastDispensingBoxes: 1.5, issue: null,
  identityComplete: true, lastDispensingPartial: null, scientificName: overrides.name || "Amlodipine", ...overrides });
const person = (id: string, items = [dto()], card: string | null = `00${id}`) => ({ patient_id: id, patient_name: `Patient ${id}`,
  insurance_card_number: card, phif_preparation_items: items,
  phif_due_summaries: [{ next_due_date: "2026-10-29", item_count: items.length }] });

describe("read-only preparation quantities from saved invoice data", () => {
  it("uses latest invoice quantities rather than historical totals and keeps fractions", () => {
    const old = { ...invoice, id: "old", dispensing_date: "2026-09-03" };
    const { details, profile } = project([source({ id: "old-line", phif_invoice_id: "old", quantity: 300 }), source()], [old, invoice]);
    expect(profile.items[0].total_quantity).toBe(345);
    expect(details[0]).toMatchObject({ quantity: 45, lastDispensingBoxes: 1.5, sourceItemIds: ["line"], dueDate: "2026-10-29" });
  });
  it("sums split lines of one latest invoice without counting old invoices again", () => {
    expect(project([source({ quantity: 15 }), source({ id: "line-2", quantity: 30 })]).details[0]).toMatchObject({ quantity: 45, lastDispensingBoxes: 1.5 });
  });
  it("does not guess a quantity when different invoices share the latest dispensing day", () => {
    expect(project([source(), source({ id: "b", phif_invoice_id: "b" })], [invoice, { ...invoice, id: "b" }]).details[0])
      .toMatchObject({ lastDispensingBoxes: null, quantity: null, issue: expect.stringContaining("حركات متعددة") });
  });
  it.each([null, undefined, "", " ", -1, true, Number.NaN, Number.POSITIVE_INFINITY])("does not turn missing or invalid quantity %s into zero", quantity => {
    expect(project([source({ quantity })]).details[0]).toMatchObject({ quantity: null, lastDispensingBoxes: null });
  });
  it("preserves an explicitly recorded zero as an estimate, not confirmed need", () => {
    const item = project([source({ quantity: 0 })]).details[0];
    expect(item.lastDispensingBoxes).toBe(0); expect(preparationEstimatedBoxes(item).boxes).toBe(0);
  });
  it("does not infer a dispensing unit from tablet form, quantity 30, or a purchase-price unit", () => {
    const { details } = project([source({ quantity: 30, metadata: { dosage_form: "tablet", package_quantity: 30 },
      phif_financial_fields: { unit_purchase_price: 24, unit: null, internal_purchase_price_basis: { unit: "TAB" } } })]);
    expect(details[0]).toMatchObject({ lastDispensingBoxes: null, quantityUnit: null, quantity: 30 });
  });
  it("does not assume every pack has 30 units or use strength as a pack size", () => {
    expect(project([source({ metadata: { dosage_form: "tablet", quantity_unit: "TAB" }, strength: "5/1000MG" })]).details[0])
      .toMatchObject({ packageSize: null, lastDispensingBoxes: null });
    expect(project([source({ quantity: 56, metadata: { dosage_form: "tablet", quantity_unit: "TAB", package_quantity: 28 } })]).details[0].lastDispensingBoxes).toBe(2);
  });
  it("uses a scoped saved Supplier unit and pack definition without changing imported metadata", () => {
    const rows = [source({ quantity: 30, metadata: {} })], before = JSON.stringify(rows);
    expect(project(rows, [invoice], [setting]).details[0]).toMatchObject({ form: "tablet", quantityUnit: "tablet", lastDispensingBoxes: 1 });
    expect(JSON.stringify(rows)).toBe(before);
    expect(project(rows, [invoice], [{ ...setting, pharmacy_id: "andalus" }]).details[0].lastDispensingBoxes).toBeNull();
  });
  it("respects a documented invoice-unit exception instead of assuming tablets", () => {
    const rows = [source({ quantity: 1, metadata: { dosage_form: "tablet" } })];
    expect(project(rows, [invoice], [{ ...setting, supplier_unit_exceptions: { invoice: "box" } }]).details[0].lastDispensingBoxes).toBe(1);
    expect(project(rows, [invoice], [{ ...setting, supplier_unit_exceptions: { invoice: "unknown" } }]).details[0].lastDispensingBoxes).toBeNull();
    expect(project([source()], [invoice], [{ ...setting, supplier_unit_exceptions: { invoice: "box" } }]).details[0].lastDispensingBoxes).toBeNull();
  });
  it("never applies a Supplier definition to Actual", () => {
    expect(project([source({ source_classification: "actual-supplier", metadata: {} })], [invoice], [setting]).details[0])
      .toMatchObject({ lastDispensingBoxes: null, quantityUnit: null, packageSize: null });
  });
  it("requires documented strip counts and supports pens, vials, and partial boxes", () => {
    const strip = { dosage_form: "tablet", quantity_unit: "STRIP", package_quantity: 30, strips_quantity: 3 };
    expect(project([source({ quantity: 2, metadata: strip })]).details[0].lastDispensingBoxes).toBeCloseTo(2 / 3);
    expect(project([source({ quantity: 2, metadata: { ...strip, strips_quantity: null } })]).details[0].lastDispensingBoxes).toBeNull();
    for (const form of ["pen", "vial", "capsule", "inhaler"]) {
      expect(project([source({ quantity: 1, metadata: { dosage_form: form, quantity_unit: form, package_quantity: 5 } })]).details[0].lastDispensingBoxes).toBe(0.2);
    }
  });
  it("rejects conflicting pack sizes and explicit unit conflicts", () => {
    expect(project([source()], [invoice], [{ ...setting, units_per_box: 28 }]).details[0].lastDispensingBoxes).toBeNull();
    expect(project([source({ metadata: { dosage_form: "tablet", quantity_unit: "TAB", unit: "BOX", package_quantity: 30 } })]).details[0].lastDispensingBoxes).toBeNull();
  });
  it("excludes stopped items and does not expose costs or raw imported metadata", () => {
    expect(project([source()], [invoice], [], true).details).toEqual([]);
    const rows = [source({ phif_financial_fields: { total_amount: 90, unit_purchase_price: 24 } })], before = JSON.stringify(rows);
    const { details } = project(rows);
    expect(JSON.stringify(details)).not.toMatch(/total_amount|unit_purchase_price|cost_price|metadata/);
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe("preparation estimates use only verified last-dispensing conversions", () => {
  it("uses last dispensing without requiring independent need and always labels the result as estimated", () => {
    for (const quantity of [15, 30, 45, 0]) {
      const item = project([source({ quantity })]).details[0];
      const row = person("1", [item]);
      const result = groupPreparationItems([row], buildPhifPreparationIndex([row], "2026-10-29", "2026-10-29"));
      expect(result.groups[0]).toMatchObject({ boxes: quantity / 30, knownBoxes: quantity / 30, knownItemCount: 1, unresolvedCount: 0 });
      expect(result.groups[0].beneficiaries).toHaveLength(1);
      expect(preparationTotalLabel(result.groups[0])).toBe(`${preparationNumber(quantity / 30)} علبة تقديرية`);
      expect(item.quantity).toBe(quantity);
    }
  });
  it("keeps a partial invoice estimate and flags it without topping up to a full box or inferring full need", () => {
    const item = project([source({ quantity: 15 })], [{ ...invoice, status: "صرف جزئي" }]).details[0];
    const row = person("1", [item]), before = JSON.stringify(row);
    const group = groupPreparationItems([row], buildPhifPreparationIndex([row], "2026-10-29", "2026-10-29")).groups[0];
    expect(item).toMatchObject({ quantity: 15, lastDispensingBoxes: 0.5, lastDispensingPartial: true });
    expect(group).toMatchObject({ boxes: 0.5, partialCount: 1 });
    expect(JSON.stringify(row)).toBe(before);
  });
  it("does not infer partial or complete status from box fractions, whole boxes or a generic completed invoice", () => {
    for (const quantity of [15, 30, 45]) {
      expect(project([source({ quantity })]).details[0].lastDispensingPartial).toBeNull();
      expect(project([source({ quantity })], [{ ...invoice, status: "Completed" }]).details[0].lastDispensingPartial).toBeNull();
    }
    const old = { ...invoice, id: "old", dispensing_date: "2026-09-03", status: "Partial" };
    expect(project([source({ id: "old-line", phif_invoice_id: "old" }), source()], [old, invoice]).details[0].lastDispensingPartial).toBeNull();
    expect(project([source()], [{ ...invoice, status: " Partial " }]).details[0].lastDispensingPartial).toBe(true);
  });
  it("does not use known totals when original quantities, units or documented package sizes are missing", () => {
    for (const patch of [{ quantity: null }, { quantity: -1 }, { quantityUnit: null }, { packageSize: null },
      { packageSize: 0 }, { packageUnit: null }, { lastDispensingBoxes: null },
      { lastDispensingBoxes: Number.POSITIVE_INFINITY }, { lastDispensingBoxes: -1 }, { issue: "conflict" }]) {
      expect(preparationEstimatedBoxes(dto(patch)).boxes).toBeNull();
    }
  });
  it("ignores legacy required-quantity values and never mixes them into a dispensing estimate", () => {
    const item = { ...dto({ quantity: 15, lastDispensingBoxes: 0.5 }), boxes: 100,
      requirement: { quantity: 3000, unitsPerBox: 30 } };
    const row = person("1", [item]);
    expect(groupPreparationItems([row], buildPhifPreparationIndex([row], "2026-10-29", "2026-10-29")).groups[0].boxes).toBe(0.5);
    expect(preparationEstimatedBoxes({ ...item, lastDispensingBoxes: undefined } as any).boxes).toBeNull();
  });
  it("shows only the known subtotal with an explicit incomplete label in either row order", () => {
    const rows = [person("1"), person("2", [dto({ quantityUnit: null, lastDispensingBoxes: null, sourceItemIds: ["b"] })])];
    for (const ordered of [rows, [...rows].reverse()]) {
      const group = groupPreparationItems(ordered, buildPhifPreparationIndex(ordered, "2026-10-29", "2026-10-29")).groups[0];
      expect(group).toMatchObject({ boxes: null, knownBoxes: 1.5, knownItemCount: 1, unresolvedCount: 1 });
      expect(group.beneficiaries).toHaveLength(2);
      expect(preparationTotalLabel(group)).toBe(`${preparationNumber(1.5)} علبة تقديرية؛ الإجمالي غير مكتمل`);
      expect(group.beneficiaries.find(p => p.card === "002")?.boxes).toBeNull();
      expect(group.beneficiaries.find(p => p.card === "001")?.boxes).toBe(1.5);
    }
  });
  it("distinguishes recorded zero from missing quantity in incomplete totals", () => {
    const item = dto({ quantity: 0, lastDispensingBoxes: 0 });
    const row = person("1", [item, dto({ id: "unknown", quantity: null, lastDispensingBoxes: null, sourceItemIds: ["b"] })]);
    const group = groupPreparationItems([row], buildPhifPreparationIndex([row], "2026-10-29", "2026-10-29")).groups[0];
    expect(group).toMatchObject({ knownBoxes: 0, knownItemCount: 1, unresolvedCount: 1, boxes: null });
    expect(preparationTotalLabel(group)).toBe("0 علبة تقديرية؛ الإجمالي غير مكتمل");
  });
  it("uses verified strip, pen and vial conversions without substituting tablet units", () => {
    const strip = { dosage_form: "tablet", quantity_unit: "STRIP", package_quantity: 30, strips_quantity: 3 };
    expect(preparationEstimatedBoxes(project([source({ quantity: 2, metadata: strip })]).details[0]).boxes).toBeCloseTo(2 / 3);
    expect(preparationEstimatedBoxes(project([source({ quantity: 2, metadata: { ...strip, strips_quantity: null } })]).details[0]).boxes).toBeNull();
    for (const form of ["pen", "vial"] as const) {
      expect(preparationEstimatedBoxes(project([source({ quantity: 2, metadata: { dosage_form: form, quantity_unit: form, package_quantity: 5 } })]).details[0]).boxes).toBe(0.4);
    }
  });
});

describe("preparation grouping follows visible beneficiaries and dates", () => {
  it("keeps each beneficiary's own latest quantity and documented pack when estimating the same medicine", () => {
    const aInvoice = { ...invoice, id: "a-invoice" }, bInvoice = { ...invoice, id: "b-invoice" };
    const a = project([source({ id: "a-line", phif_invoice_id: aInvoice.id, quantity: 15 })], [aInvoice]).details[0];
    const b = project([source({ id: "b-line", phif_invoice_id: bInvoice.id, quantity: 56,
      metadata: { dosage_form: "tablet", quantity_unit: "TAB", package_quantity: 28 } })], [bInvoice]).details[0];
    const rows = [person("1", [a]), person("2", [b])];
    const group = groupPreparationItems(rows, buildPhifPreparationIndex(rows, "2026-10-29", "2026-10-29")).groups[0];
    expect(group).toMatchObject({ boxes: 2.5, itemCount: 2 });
    expect(group.beneficiaries[0]).toMatchObject({ card: "001", boxes: 0.5 });
    expect(group.beneficiaries[0].items[0].quantity).toBe(15);
    expect(group.beneficiaries[1]).toMatchObject({ card: "002", boxes: 2 });
    expect(group.beneficiaries[1].items[0].quantity).toBe(56);
  });
  it("keeps the original item count, distinct medicine count, unique beneficiaries and fractional boxes", () => {
    const rows = [person("1"), person("2", [dto({ name: " AMLODIPINE ", form: "TAB", sourceItemIds: ["b"] })]),
      person("3", [dto({ strength: "10MG", sourceItemIds: ["c"] })])];
    const result = groupPreparationItems(rows, buildPhifPreparationIndex(rows, "2026-10-29", "2026-10-29"));
    expect(result.originalCount).toBe(3); expect(result.groups).toHaveLength(2);
    expect(result.groups[0]).toMatchObject({ boxes: 3, itemCount: 2 });
    expect(result.groups[0].beneficiaries).toHaveLength(2);
  });
  it("keeps combination strengths, dosage forms, and different medicine names separate", () => {
    const rows = [person("1", [dto({ name: "TENSTAR", strength: "160/25MG" }), dto({ id: "2", name: "TENSTAR", strength: "160MG" }),
      dto({ id: "3", name: "TENSTAR", strength: "160/12.5MG" }), dto({ id: "4", name: "TENSTAR", strength: "160/25MG", form: "capsule" }),
      dto({ id: "5", name: "GLYFORMIN", strength: "500MG" }), dto({ id: "6", name: "FORMIN", strength: "500MG" })])];
    expect(groupPreparationItems(rows, buildPhifPreparationIndex(rows, "2026-10-29", "2026-10-29")).groups).toHaveLength(6);
  });
  it("normalizes full strengths including mg/mcg and combinations without altering originals", () => {
    const rows = [person("1", [dto({ strength: "0.4MG" })]), person("2", [dto({ strength: "400 MCG", sourceItemIds: ["b"] })])];
    const before = JSON.stringify(rows);
    expect(groupPreparationItems(rows, buildPhifPreparationIndex(rows, "2026-10-29", "2026-10-29")).groups).toHaveLength(1);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("preserves leading zeros, counts people by card, and does not double-count repeated rows or the same source line", () => {
    const a = person("1", [dto()], "00123"), b = person("2", [dto()], "00123"), c = person("3", [dto({ sourceItemIds: ["c"] })], "123");
    const rows = [a, a, b, c], result = groupPreparationItems(rows, buildPhifPreparationIndex(rows, "2026-10-29", "2026-10-29"));
    expect(result.originalCount).toBe(3); expect(result.groups[0].beneficiaries.map(p => p.card)).toEqual(["00123", "123"]);
    expect(result.groups[0].boxes).toBe(3);
  });
  it("never identifies people by name when cards are absent", () => {
    const rows = [person("1", [dto()], null), { ...person("2", [dto({ sourceItemIds: ["b"] })], null), patient_name: "Patient 1" }];
    expect(groupPreparationItems(rows, buildPhifPreparationIndex(rows, "2026-10-29", "2026-10-29")).groups[0].beneficiaries).toHaveLength(2);
  });
  it("does not invent totals for unknown quantities or merge incomplete identities", () => {
    const rows = [person("1", [dto({ lastDispensingBoxes: null })]), person("2", [dto({ sourceItemIds: ["b"] })])];
    const result = groupPreparationItems(rows, buildPhifPreparationIndex(rows, "2026-10-29", "2026-10-29"));
    expect(result.groups[0]).toMatchObject({ boxes: null, knownBoxes: 1.5, unresolvedCount: 1 });
    const unknown = rows.map(r => ({ ...r, phif_preparation_items: r.phif_preparation_items.map(i => ({ ...i, form: "", quantityUnit: null, identityComplete: false })) }));
    expect(groupPreparationItems(unknown, buildPhifPreparationIndex(rows, "2026-10-29", "2026-10-29")).groups).toHaveLength(2);
  });
  it("uses only visible rows and matching due dates and exposes incomplete cached details", () => {
    const a = person("1"), b = person("2", [dto({ dueDate: "2026-11-26" })]);
    const index = buildPhifPreparationIndex([a, b], "2026-10-29", "2026-10-29");
    expect(groupPreparationItems([a], index).originalCount).toBe(1);
    expect(groupPreparationItems([b], index)).toMatchObject({ groups: [], missingCount: 1 });
    expect(groupPreparationItems([{ ...a, phif_preparation_items: undefined }], index).missingCount).toBe(1);
    expect(groupPreparationItems([a], new Map()).groups).toEqual([]);
  });
  it("marks nonterminating and very small fractions without silently rounding to whole boxes", () => {
    expect(preparationNumber(1.5)).not.toContain("≈");
    expect(preparationNumber(1 / 3)).toContain("≈");
    expect(preparationNumber(1e-8)).toBe("< 0.000001");
  });
  it("keeps the existing pharmacy guard, invoice scoping and read-only projection", () => {
    const server = readFileSync("src/lib/reads.functions.ts", "utf8");
    expect(server.indexOf('if (pharmacy_name !== TIRYAQ_PHARMACY_NAME) return filtered')).toBeLessThan(server.indexOf('loadPhifStatusProfiles(admin, pharmacy_id, filtered)'));
    expect(server).toContain('.eq("pharmacy_id", pharmacyId).order("item_identity"');
    const helper = readFileSync("src/lib/phif-preparation-list.helpers.ts", "utf8");
    expect(helper).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
    expect(server).toContain("phif_due_summaries: profile.due_summaries");
  });
});

describe("scientific spelling and evidence-based preparation grouping", () => {
  const group = (items: PreparationItem[]) => {
    const rows = items.map((item, index) => person(String(index + 1), [item]));
    return groupPreparationItems(rows, buildPhifPreparationIndex(rows, "2026-10-29", "2026-10-29"));
  };
  it("combines ACETYL SALICYLIC ACID 75MG and ACETYLSALICYLIC ACID 75MG without losing quantities or beneficiaries", () => {
    const result = group([dto({ name: " ACETYL  SALICYLIC ACID ", strength: "75 MG" }),
      dto({ name: "acetylsalicylic acid", strength: "0.075G", form: "TAB", sourceItemIds: ["b"] })]);
    expect(result).toMatchObject({ originalCount: 2, missingCount: 0 });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ itemCount: 2, boxes: 3 });
    expect(result.groups[0].beneficiaries).toHaveLength(2);
  });
  it("fills a missing form only from a documented quantity unit", () => {
    expect(group([dto({ name: "ACETYL SALICYLIC ACID", strength: "75MG" }),
      dto({ name: "ACETYLSALICYLIC ACID", strength: "75MG", form: "", identityComplete: false, sourceItemIds: ["b"] })]).groups).toHaveLength(1);
  });
  it("uses evidenced scientific form even without a shared product ID, but never overrides a conflict", () => {
    const known = dto({ sourceProductIds: ["product"] });
    const missing = dto({ form: "", quantityUnit: null, identityComplete: false, sourceProductIds: ["product"], sourceItemIds: ["b"] });
    expect(group([known, missing]).groups).toHaveLength(1);
    expect(group([known, { ...missing, sourceProductIds: ["different"] }]).groups).toHaveLength(1);
    expect(group([known, { ...missing, sourceProductIds: [] }]).groups).toHaveLength(1);
    expect(group([known, { ...missing, formIssue: "conflicting_saved_forms" }]).groups).toHaveLength(2);
  });
  it("does not infer a missing form when the same product ID has contradictory explicit forms", () => {
    const a = dto({ sourceProductIds: ["product"] });
    const b = dto({ form: "capsule", sourceProductIds: ["product"], sourceItemIds: ["b"] });
    const c = dto({ form: "", quantityUnit: null, identityComplete: false, sourceProductIds: ["product"], sourceItemIds: ["c"] });
    expect(group([a, b, c]).groups).toHaveLength(3);
  });
  it("does not discard contradictory form evidence when another beneficiary is hidden by filters", () => {
    const a = person("1", [dto({ sourceProductIds: ["product"] })]);
    const b = person("2", [dto({ form: "capsule", sourceProductIds: ["product"], sourceItemIds: ["b"] })]);
    const c = person("3", [dto({ form: "", quantityUnit: null, identityComplete: false, sourceProductIds: ["product"], sourceItemIds: ["c"] })]);
    const all = [a, b, c], result = groupPreparationItems([a, c], buildPhifPreparationIndex(all, "2026-10-29", "2026-10-29"), all);
    expect(result.groups).toHaveLength(2); expect(result.originalCount).toBe(2);
    expect(result.groups.flatMap(g => g.beneficiaries).some(p => p.patientId === "2")).toBe(false);
  });
  it("does not fill a missing form when its quantity unit contradicts the same product's explicit form", () => {
    const a = dto({ form: "capsule", sourceProductIds: ["product"] });
    const b = dto({ form: "tablet", sourceProductIds: ["another"], sourceItemIds: ["b"] });
    const c = dto({ form: "", quantityUnit: "tablet", identityComplete: false, sourceProductIds: ["product"], sourceItemIds: ["c"] });
    expect(group([a, b, c]).groups).toHaveLength(3);
  });
  it("keeps the scientific grouping key stable across a cached DTO refresh", () => {
    const cached = dto({ name: "ACETYL SALICYLIC ACID", scientificName: undefined, strength: "75MG", id: "medication|acetylsalicylicacid|75mg|tablet" });
    expect(group([cached]).groups[0].key).toBe(group([{ ...cached, scientificName: cached.name }]).groups[0].key);
  });
  it("retains distinct strengths, forms, chemical combination separators, and unproven brand spellings", () => {
    expect(group([dto({ name: "ACETYL SALICYLIC ACID", strength: "75MG" }),
      dto({ name: "ACETYLSALICYLIC ACID", strength: "100MG", sourceItemIds: ["b"] }),
      dto({ name: "ACETYLSALICYLIC ACID", strength: "75MG", form: "capsule", sourceItemIds: ["c"] })]).groups).toHaveLength(3);
    expect(group([dto({ name: "A + B" }), dto({ name: "AB", sourceItemIds: ["b"] })]).groups).toHaveLength(2);
    expect(group([dto({ name: "BRAND NAME", scientificName: null }), dto({ name: "BRANDNAME", scientificName: null, sourceItemIds: ["b"] })]).groups).toHaveLength(2);
  });
  it("does not count the same source lines twice when spelling variants join the same beneficiary", () => {
    const items = [dto({ name: "ACETYL SALICYLIC ACID", strength: "75MG" }), dto({ name: "ACETYLSALICYLIC ACID", strength: "75MG", id: "variant" })];
    const row = person("1", items), result = groupPreparationItems([row], buildPhifPreparationIndex([row], "2026-10-29", "2026-10-29"));
    expect(result.originalCount).toBe(2); expect(result.groups[0]).toMatchObject({ itemCount: 2, boxes: 1.5 });
    expect(result.groups[0].beneficiaries).toHaveLength(1);
  });
});

describe("preparation identity is independent of quantity and beneficiary IDs", () => {
  const saved = (name: string, strength: string, form = "tablet", pharmacy = "tiryaq") => ({
    pharmacy_id: pharmacy, item_identity: JSON.stringify([name, strength, form]), base_unit: form, units_per_box: 28,
  });
  const aggregate = (rows: ReturnType<typeof person>[]) => groupPreparationItems(rows, buildPhifPreparationIndex(rows, "2026-10-29", "2026-10-29"));

  it("joins the reported ACETYL variants with null, blank or absent form and quantity, retaining all beneficiaries", () => {
    const rows = [person("1", [dto({ name: "ACETYL SALICYLIC ACID", strength: "75MG", sourceItemIds: ["a"] })]),
      ...["", "  ", null, undefined].map((form, index) => person(String(index + 2), [dto({
        id: `medication|acetylsalicylicacid|75mg|${index}`, name: " ACETYLSALICYLIC  ACID ", strength: "75 MG",
        form: form as any, identityComplete: false, formIssue: "missing_form", quantity: null, quantityUnit: null,
        lastDispensingBoxes: null, sourceProductIds: [], sourceItemIds: [`line-${index}`],
      })]))];
    const before = JSON.stringify(rows), result = aggregate(rows);
    expect(result.groups).toHaveLength(1);
    expect(result).toMatchObject({ originalCount: 5, missingCount: 0 });
    expect(result.groups[0]).toMatchObject({ itemCount: 5, boxes: null, knownBoxes: 1.5, unresolvedCount: 4, form: "tablet" });
    expect(result.groups[0].beneficiaries).toHaveLength(5);
    expect(result.groups[0].key).toBe('["acetylsalicylicacid","75mg","tablet"]');
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("completes ACETYL 75MG identity from its saved definition even when every source has empty metadata", () => {
    const settings = [saved("acetylsalicylic acid", "75mg")];
    const rows = ["ACETYL SALICYLIC ACID", "ACETYLSALICYLIC ACID"].map((name, index) => {
      const details = project([source({ id: `acid-${index}`, active_ingredient: name, strength: "75MG", phif_item_id: null,
        metadata: {}, quantity: null })], [invoice], settings).details;
      expect(details[0]).toMatchObject({ form: "tablet", identityComplete: true, quantityUnit: null, lastDispensingBoxes: null });
      return person(String(index), details);
    });
    expect(aggregate(rows).groups).toHaveLength(1);
    expect(aggregate(rows).groups[0]).toMatchObject({ itemCount: 2, knownItemCount: 0, unresolvedCount: 2, boxes: null });
  });

  it("uses whole-pharmacy historical form evidence once, without requiring a latest quantity or product ID", () => {
    const sources = [source({ id: "known", metadata: { dosage_form: "tablet" } }),
      source({ id: "missing", phif_item_id: null, phif_invoice_id: "other", metadata: {}, quantity: null })];
    const context = preparationIdentityContext(sources, "tiryaq");
    const profile = buildPhifMedicationProfileFromRows([{ ...invoice, id: "other" }], [sources[1]]);
    const before = JSON.stringify({ sources, profile });
    const details = buildPreparationItems(profile.items, [sources[1]], phifMedicationIdentityKey, "tiryaq", [], [], context);
    expect(details[0]).toMatchObject({ form: "tablet", identityComplete: true, quantity: null, quantityUnit: null, lastDispensingBoxes: null });
    expect(JSON.stringify({ sources, profile })).toBe(before);
  });

  it("keeps ATORVASTATIN 10MG and 20MG as two groups, not one group per source ID or beneficiary", () => {
    const settings = [saved("atorvastatin", "10MG"), saved("atorvastatin", "20MG")];
    const rows = [10, 20, 10, 20].map((dose, index) => person(String(index), project([source({
      id: `ator-${index}`, active_ingredient: index % 2 ? " atorvastatin " : "ATORVASTATIN", strength: `${dose} MG`,
      phif_item_id: index % 2 ? null : `product-${index}`, source_classification: index < 2 ? "phif-supplier" : "actual-supplier",
      metadata: {}, quantity: 30,
    })], [invoice], settings).details));
    const result = aggregate(rows);
    expect(result.groups).toHaveLength(2);
    expect(result.groups.map(g => g.itemCount)).toEqual([2, 2]);
    expect(result.groups.every(g => g.form === "tablet" && g.beneficiaries.length === 2)).toBe(true);
    expect(new Set(result.groups.map(g => JSON.parse(g.key)[1]))).toEqual(new Set(["10mg", "20mg"]));
  });

  it("does not let incomplete flags split an otherwise evidenced identity or let forms mix", () => {
    const rows = [person("1", [dto({ identityComplete: false })]), person("2", [dto({ sourceItemIds: ["b"] })]),
      person("3", [dto({ form: "capsule", sourceItemIds: ["c"] })]),
      person("4", [dto({ form: "", quantityUnit: null, identityComplete: false, sourceItemIds: ["d"] })])];
    expect(aggregate(rows).groups).toHaveLength(3);
    expect(aggregate(rows).groups.find(g => g.form === "tablet")?.beneficiaries).toHaveLength(2);
  });

  it("leaves an all-missing form unresolved without evidence, and rejects conflicting definitions", () => {
    const missing = () => dto({ form: "", quantityUnit: null, identityComplete: false });
    expect(aggregate([person("1", [missing()]), person("2", [missing()])]).groups).toHaveLength(2);
    const result = project([source({ metadata: {}, phif_item_id: null })], [invoice],
      [saved("amlodipine", "5MG"), saved("amlodipine", "5MG", "capsule")]).details[0];
    expect(result).toMatchObject({ form: "", identityComplete: false, formIssue: "conflicting_saved_forms" });
  });

  it("does not use another pharmacy's definitions or context and never derives quantity units from identity", () => {
    const sources = [source({ metadata: {}, phif_item_id: null })], settings = [saved("amlodipine", "5MG", "tablet", "andalus")];
    const context = preparationIdentityContext(sources, "andalus", settings);
    const profile = buildPhifMedicationProfileFromRows([invoice], sources);
    const result = buildPreparationItems(profile.items, sources, phifMedicationIdentityKey, "tiryaq", settings, [invoice], context)[0];
    expect(result).toMatchObject({ form: "", identityComplete: false, quantityUnit: null, lastDispensingBoxes: null });
  });

  it("keeps real cross-beneficiary form conflicts unresolved, retaining explicit tablet and capsule forms", () => {
    const sources = [source({ id: "tablet", metadata: { dosage_form: "tablet" } }),
      source({ id: "capsule", metadata: { dosage_form: "capsule" } }), source({ id: "unknown", metadata: {} }),
      source({ id: "foreign", pharmacy_id: "andalus", metadata: { dosage_form: "vial" } })];
    const context = preparationIdentityContext(sources, "tiryaq");
    expect(context.identities.has("foreign")).toBe(false);
    const items = sources.slice(0, 3).map(row => {
      const profile = buildPhifMedicationProfileFromRows([invoice], [row]);
      return buildPreparationItems(profile.items, [row], phifMedicationIdentityKey, "tiryaq", [], [invoice], context)[0];
    });
    expect(items.map(i => i.form)).toEqual(["tablet", "capsule", ""]);
    expect(items[2].formIssue).toBe("conflicting_form_evidence");
  });

  it("retains identity even if multiple latest invoices make the quantity ambiguous", () => {
    const sources = [source({ id: "a", metadata: {} }), source({ id: "b", metadata: {}, phif_invoice_id: "second" })];
    const details = project(sources, [invoice, { ...invoice, id: "second" }], [saved("amlodipine", "5MG")]).details;
    expect(details[0]).toMatchObject({ form: "tablet", identityComplete: true, lastDispensingBoxes: null,
      issue: expect.stringContaining("حركات متعددة") });
  });

  it("does not turn a malformed saved base unit into valid identity evidence", () => {
    const invalid = { ...saved("amlodipine", "5MG"), base_unit: "pen" };
    const details = project([source({ metadata: {} })], [invoice], [invalid]).details;
    expect(details[0]).toMatchObject({ form: "", identityComplete: false, formIssue: "invalid_saved_definition" });
  });

  it("retains shared-card deduplication, exact source-line deduplication and partial warnings after a merge", () => {
    const a = dto({ name: "ACETYL SALICYLIC ACID", strength: "75MG", lastDispensingPartial: true });
    const b = dto({ ...a, id: "variant", name: "ACETYLSALICYLIC ACID", form: "", quantityUnit: null, identityComplete: false });
    const c = dto({ ...a, id: "new-line", sourceItemIds: ["new"], quantity: 15, lastDispensingBoxes: 0.5 });
    const result = aggregate([person("1", [a], "00123"), person("2", [b, c], "00123"), person("3", [a], "123")]);
    expect(result.groups).toHaveLength(1);
    expect(result.originalCount).toBe(4);
    expect(result.groups[0]).toMatchObject({ boxes: 3.5, itemCount: 4, knownItemCount: 3, partialCount: 3 });
    expect(result.groups[0].beneficiaries.map(p => p.card)).toEqual(["00123", "123"]);
  });
});
