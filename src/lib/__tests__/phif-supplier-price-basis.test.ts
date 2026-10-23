import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { buildManagementAuditReport } from "../management.functions";
import { latestPhifSale } from "../items-reference-prices.helpers";
import {
  canManageSupplierBasis,
  supplierBasisCost,
  supplierBasisFields,
  supplierHistoricalCompatible,
  supplierPricePresets,
  supplierPriceVersion,
  supplierSavedCost,
  validateSupplierBasis,
} from "../phif-supplier-price-basis.helpers";
import {
  previewSupplierBasis,
  readSupplierPriceItem,
  writeSupplierBasis,
} from "../phif-supplier-price-basis.server";

const basis = { amount: 90, count: 60, unit: "TAB" };
const item = (id = "a", quantity = 30): any => ({
  id,
  phif_invoice_id: "invoice-a",
  source_classification: "phif-supplier",
  brand: "Supplier medicine",
  active_ingredient: "Ingredient",
  strength: "160/25MG",
  quantity,
  metadata: { quantity_unit: "TABLETS", dosage_form: "TABS", package_quantity: 60 },
  phif_financial_fields: { total_amount: 90, insurance_amount: 85, outside_insurance_amount: 5 },
  phif_invoices: { pharmacy_id: "tiryaq", invoice_number: "123", dispensing_date: "2026-09-01" },
});

function memoryContext(rows: any[], cap = 2) {
  const context: any = { pharmacyId: "tiryaq", userId: "manager", writes: 0 };
  context.db = {
    from: (table: string) => {
      expect(table).toBe("phif_invoice_items");
      let update: any,
        from = 0,
        to = Infinity;
      const filters: ((row: any) => boolean)[] = [];
      const value = (row: any, key: string) => key.split(".").reduce((o, k) => o?.[k], row);
      const equal = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
      const result = () => {
        const matches = rows
          .filter((row) => filters.every((filter) => filter(row)))
          .sort((a, b) => a.id.localeCompare(b.id));
        if (update) {
          matches.forEach((row) => {
            Object.assign(row, update);
            context.writes++;
          });
        }
        return { data: matches.slice(from, Math.min(to + 1, from + cap)), error: null };
      };
      const query: any = {
        select: () => query,
        eq: (key: string, expected: any) => {
          filters.push((row) =>
            equal(
              value(row, key),
              ["phif_financial_fields", "metadata"].includes(key) && typeof expected === "string"
                ? JSON.parse(expected)
                : expected,
            ),
          );
          return query;
        },
        is: (key: string, expected: any) => {
          filters.push((row) => value(row, key) === expected);
          return query;
        },
        update: (fields: any) => {
          update = fields;
          return query;
        },
        order: () => query,
        range: (a: number, b: number) => {
          from = a;
          to = b;
          return query;
        },
        then: (resolve: any) => Promise.resolve(result()).then(resolve),
      };
      const resultSingle = () => {
        // Only execute an update once.
        const pending = update;
        update = undefined;
        const match = rows.find((row) => filters.every((filter) => filter(row)));
        if (match && pending) {
          Object.assign(match, pending);
          context.writes++;
        }
        return match ?? null;
      };
      // maybeSingle must not evaluate the update through the paged result first.
      query.maybeSingle = async () => ({ data: resultSingle(), error: null });
      return query;
    },
  };
  return context;
}

describe("PHIF Supplier price basis and frozen invoice costs", () => {
  it("24 per 30-tablet reference box costs 24 for 30 dispensed tablets, never 720", () => {
    const original = item();
    const saved = supplierBasisFields(
      original,
      { amount: 24, count: 30, unit: "TAB" },
      { id: "admin", at: "now" },
    );
    expect(saved.internal_purchase_cost_value).toBe(24);
    expect(original.phif_financial_fields.internal_purchase_cost_value).toBeUndefined();
    expect(() => validateSupplierBasis(original, { amount: 24, count: 1, unit: "BOX" })).toThrow();
  });
  it("saved historical oral-unit evidence cannot be relabeled as boxes or silently replaced", () => {
    const original = {
      ...item(),
      metadata: {},
      report_form: "tablet",
      phif_financial_fields: {
        total_amount: 33.06,
        internal_purchase_cost_value: 12,
        internal_purchase_cost_mode: "total_dispensed_cost",
        internal_purchase_import: {
          authorization: "explicit_pharmacy_owner_approval_historical_only",
          unit_confirmation: "pharmacy_owner_individual_oral_units_confirmation",
        },
      },
    };
    expect(validateSupplierBasis(original, { amount: 24, count: 30, unit: "TAB" })).toBe(24);
    expect(() =>
      validateSupplierBasis(original, {
        amount: 24,
        count: 1,
        unit: "BOX",
        confirmQuantityUnit: true,
      }),
    ).toThrow();
    expect(original.phif_financial_fields.internal_purchase_cost_value).toBe(12);
  });
  it("offers ready-made native-unit counts and computes 90 / 60 without changing Actual", () => {
    expect(supplierPricePresets("tablets")).toEqual([1, 28, 30, 56, 60]);
    expect(supplierPricePresets("CAPS")).toEqual([1, 28, 30, 56, 60]);
    expect(supplierPricePresets("PEN")).toEqual([1]);
    expect([28, 30, 56, 60].map((q) => supplierBasisCost(q, basis))).toEqual([42, 45, 84, 90]);
    expect(supplierBasisCost(3, { amount: 20, count: 1, unit: "PEN" })).toBe(60);
  });

  it("rounds the final item total, not a prematurely rounded unit price", () => {
    expect(supplierBasisCost(28, { amount: 88, count: 30, unit: "TAB" })).toBe(82.133);
    for (const bad of [0, -1, NaN, Infinity]) expect(() => supplierBasisCost(bad, basis)).toThrow();
    expect(() => supplierBasisCost(28, { ...basis, count: 0 })).toThrow();
  });

  it("uses existing Supplier financial fields and leaves all imported values intact", () => {
    const raw = item();
    const fields = supplierBasisFields(raw, basis, { id: "admin", at: "2026-10-22T00:00:00Z" });
    expect(raw.phif_financial_fields).toEqual({
      total_amount: 90,
      insurance_amount: 85,
      outside_insurance_amount: 5,
    });
    expect(fields.total_amount).toBe(90);
    expect(fields.internal_purchase_cost_mode).toBe("total_dispensed_cost");
    expect(fields.internal_purchase_cost_value).toBe(45);
    expect(fields.internal_purchase_price_basis.unit_price).toBe(1.5);
    expect(fields.internal_purchase_history[0].user_id).toBe("admin");
    const priced = { ...raw, phif_financial_fields: fields };
    expect(supplierSavedCost(priced)).toEqual({ total: 45, unitPrice: 1.5 });
    const report = buildManagementAuditReport({
      invoices: [{ id: "invoice-a" }],
      stocks: [],
      items: [priced],
    });
    expect(report.financial.summary.complete_invoices).toBe(1);
    expect(() =>
      supplierBasisFields({ ...raw, source_classification: "actual" }, basis, {
        id: null,
        at: "now",
      }),
    ).toThrow("PHIF Supplier");
  });

  it("never guesses unknown or conflicting quantity units, and never converts boxes to tablets", () => {
    expect(() => validateSupplierBasis({ ...item(), metadata: {} }, basis)).toThrow("أكد");
    expect(
      validateSupplierBasis({ ...item(), metadata: {} }, { ...basis, confirmQuantityUnit: true }),
    ).toBe(45);
    expect(() =>
      validateSupplierBasis({ ...item(), metadata: { quantity_unit: "BOX" } }, basis),
    ).toThrow("تتعارض");
    expect(() =>
      validateSupplierBasis(
        { ...item(), metadata: { quantity_unit: "TAB", quantityUnit: "PEN" } },
        { ...basis, confirmQuantityUnit: true },
      ),
    ).toThrow("تتعارض");
  });

  it("bulk matching requires exact scientific name, full strength, brand, form, unit and packaging", () => {
    const anchor = item();
    expect(supplierHistoricalCompatible(anchor, item("b", 56))).toBe(true);
    for (const change of [
      { strength: "160MG" },
      { brand: "Another brand" },
      { active_ingredient: "Another ingredient" },
      { metadata: {} },
      { metadata: { ...anchor.metadata, dosage_form: "CAP" } },
      { metadata: { ...anchor.metadata, quantity_unit: "STRIP" } },
      { metadata: { ...anchor.metadata, package_quantity: 30 } },
      { source_classification: "actual" },
    ])
      expect(supplierHistoricalCompatible(anchor, { ...item("b"), ...change })).toBe(false);
    expect(
      supplierHistoricalCompatible({ ...anchor, metadata: {} }, { ...item("b"), metadata: {} }),
    ).toBe(false);
  });

  it("preview reads all capped pages, is pharmacy-scoped, and writes nothing", async () => {
    const anchor = item();
    const wrongPharmacy = {
      ...item("other"),
      phif_invoices: { ...anchor.phif_invoices, pharmacy_id: "andalus" },
    };
    const rows = [
      anchor,
      item("b", 28),
      item("c", 56),
      item("d", 60),
      wrongPharmacy,
      { ...item("other-strength"), strength: "160MG" },
    ];
    const context = memoryContext(rows);
    const preview = await previewSupplierBasis(context, anchor, basis, true);
    expect(preview.map((row) => row.id).sort()).toEqual(["a", "b", "c", "d"]);
    expect(context.writes).toBe(0);
    await expect(readSupplierPriceItem(context, "other")).rejects.toThrow("الصيدلية الحالية");
  });

  it("freezes selected historical items, keeps future invoices unpriced, and records subsequent edits", async () => {
    const rows = [item(), item("b", 28)];
    const context = memoryContext(rows);
    const preview = await previewSupplierBasis(context, rows[0], basis, true);
    rows.push(item("new", 56));
    for (const target of preview)
      await writeSupplierBasis(
        context,
        rows.find((row) => row.id === target.id),
        basis,
        target.version,
      );
    expect(rows[0].phif_financial_fields.internal_purchase_cost_value).toBe(45);
    expect(rows[1].phif_financial_fields.internal_purchase_cost_value).toBe(42);
    expect(rows[2].phif_financial_fields.internal_purchase_cost_value).toBeUndefined();
    await writeSupplierBasis(
      context,
      rows[0],
      { ...basis, amount: 120 },
      supplierPriceVersion(rows[0]),
    );
    expect(rows[0].phif_financial_fields.internal_purchase_cost_value).toBe(60);
    expect(rows[1].phif_financial_fields.internal_purchase_cost_value).toBe(42);
    expect(rows[0].phif_financial_fields.internal_purchase_history).toHaveLength(2);
    expect(
      rows[0].phif_financial_fields.internal_purchase_history[1].previous
        .internal_purchase_cost_value,
    ).toBe(45);
  });

  it("rejects stale previews and concurrent updates without reporting a successful save", async () => {
    const row = item(),
      context = memoryContext([row]);
    const snapshot = supplierPriceVersion(row);
    row.quantity = 56;
    await expect(writeSupplierBasis(context, row, basis, snapshot)).rejects.toThrow("تغيّر البند");
    const stale = structuredClone(row);
    row.phif_financial_fields = { ...row.phif_financial_fields, internal_purchase_cost_value: 99 };
    await expect(
      writeSupplierBasis(context, stale, basis, supplierPriceVersion(stale)),
    ).rejects.toThrow("لم تُحفظ");
    expect(context.writes).toBe(0);
  });

  it("sends a valid PostgREST JSONB compare-and-swap, not [object Object], without a network request", async () => {
    const row = item();
    let captured: URL | undefined;
    const db = createClient("https://supplier-test.invalid", "test-only-key", {
      auth: { persistSession: false },
      global: {
        fetch: async (url, init) => {
          captured = new URL(String(url));
          expect(init?.method).toBe("PATCH");
          const payload = JSON.parse(String(init?.body));
          expect(Object.keys(payload)).toEqual(["phif_financial_fields"]);
          expect(payload.phif_financial_fields.total_amount).toBe(90);
          expect(payload.phif_financial_fields.internal_purchase_cost_value).toBe(45);
          return new Response(JSON.stringify({ id: row.id }), {
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    });
    await writeSupplierBasis(
      { db, pharmacyId: "tiryaq", userId: "admin" },
      row,
      basis,
      supplierPriceVersion(row),
    );
    expect(captured?.searchParams.get("phif_financial_fields")).toBe(
      `eq.${JSON.stringify(row.phif_financial_fields)}`,
    );
    expect(captured?.searchParams.get("phif_invoice_id")).toBe("eq.invoice-a");
    expect(captured?.searchParams.get("source_classification")).toBe("eq.phif-supplier");
  });

  it("keeps unknown costs unknown and supports existing total and unit prices", () => {
    expect(supplierSavedCost(item()).total).toBeNull();
    expect(
      supplierSavedCost({
        ...item(),
        phif_financial_fields: { internal_purchase_price: 2, internal_purchase_unit: "TAB" },
      }).total,
    ).toBe(60);
    expect(
      supplierSavedCost({
        ...item(),
        phif_financial_fields: {
          internal_purchase_cost_value: 88,
          internal_purchase_cost_mode: "total_dispensed_cost",
        },
      }).total,
    ).toBe(88);
  });

  it("shows latest Supplier sale price only, with no fabricated price from internal purchase fields", () => {
    expect(
      latestPhifSale([{ ...item(), phif_financial_fields: { internal_purchase_price: 90 } }]),
    ).toBeNull();
    const sale = (price: number, date: string, time?: string) => ({
      ...item(),
      phif_financial_fields: { total_amount: price * 30 },
      invoice: { dispensing_date: date, dispensing_time: time },
    });
    expect(latestPhifSale([sale(3, "2026-09-01"), sale(4, "2026-10-01")])).toMatchObject({
      price: 4,
      date: "2026-10-01",
    });
    expect(latestPhifSale([sale(3, "2026-10-01"), sale(4, "2026-10-01")])).toMatchObject({
      price: null,
      conflict: true,
    });
    expect(
      latestPhifSale([sale(3, "2026-10-01", "08:00:00"), sale(4, "2026-10-01", "09:00:00")])?.price,
    ).toBe(4);
    expect(
      latestPhifSale([
        { ...sale(9, "2026-10-02"), source_classification: "actual" },
        sale(4, "2026-10-01"),
      ])?.price,
    ).toBe(4);
  });

  it("keeps supplier write/read permissions and pharmacy scoping enforced on the server", () => {
    const server = readFileSync("src/lib/phif-supplier-price-basis.server.ts", "utf8");
    const endpoints = readFileSync("src/lib/phif-supplier-price-basis.functions.ts", "utf8");
    expect(server).toContain('requireTiryaqPermission("phif_purchase_price_write")');
    expect(server).toContain("canManageSupplierBasis(user)");
    expect(server).toContain('.eq("phif_invoices.pharmacy_id", context.pharmacyId)');
    expect(endpoints).toContain("supplierHistoricalCompatible(anchor, item)");
    expect(endpoints).toContain("data.historical");
    expect(server).not.toContain('.from("phif_stock_items")');
    expect(server).not.toContain('.from("phif_actual_cost_decisions")');
  });

  it("allows the existing admin/legacy writer and only explicitly authorized Supplier employees", () => {
    expect(canManageSupplierBasis({ user_id: "admin", user_role: "admin" })).toBe(true);
    expect(canManageSupplierBasis({})).toBe(true);
    expect(canManageSupplierBasis({ user_id: "employee", user_role: "employee" })).toBe(false);
    const rights = {
      phif_purchase_price_write: true,
      phif_items_read: true,
      phif_cost_read: true,
      phif_movements_read: true,
    };
    expect(
      canManageSupplierBasis({
        user_id: "employee",
        user_role: "employee",
        user_permissions: rights,
      }),
    ).toBe(true);
    for (const permission of Object.keys(rights))
      expect(
        canManageSupplierBasis({
          user_id: "employee",
          user_role: "employee",
          user_permissions: { ...rights, [permission]: false },
        }),
      ).toBe(false);
    expect(
      canManageSupplierBasis({
        user_id: "employee",
        user_role: "employee",
        user_permissions: { actual_cost_read: true, actual_items_read: true },
      }),
    ).toBe(false);
  });
});
