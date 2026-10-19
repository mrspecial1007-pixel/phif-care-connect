import { describe, expect, it } from "vitest";
import { enrichStockIngredients, extractStockBatchExpiry, formatStockExpiry, parseStockExpiry, stockExpiryState, stockExpiryValue, stockScientificSubtitle } from "@/lib/phif-stock-details.helpers";
import { loadStockIngredientReferences, normalizePhifStockRows } from "@/lib/phif-stock.functions";

const stock = { brand_name: "AMLOTENS 5MG", strength: "5MG", dosage_unit: "TABS", active_ingredient: null };
const reference = { brand_name: "AMLOTENS", strength: "5 mg", dosage_unit: "tablet", active_ingredient: "Amlodipine 5mg" };

describe("stock ingredient and expiry details", () => {
  it("extracts existing generic field names from direct and nested product records without stringifying objects", () => {
    const rows = normalizePhifStockRows([
      { id: 1, active_ingredient: "Amlodipine" },
      { id: 2, generic_name: "Allopurinol" },
      { id: 3, supplier_brand_name: { generic_name: { name: "Amiodarone Hydrochloride" } } },
      { id: 4, supplier_brand_name: { active_ingredient: "Metformin" } },
      { id: 5, generic_name: {} },
      { id: 6, genaric_name: { name: "Amlodipine" } },
    ]);
    expect(rows.map(row => row.active_ingredient)).toEqual(["Amlodipine", "Allopurinol", "Amiodarone Hydrochloride", "Metformin", null, "Amlodipine"]);
  });

  it("enriches only a unique complete commercial identity without mutating stored rows", () => {
    expect(enrichStockIngredients([stock], [reference])[0].active_ingredient).toBe("Amlodipine 5mg");
    expect(stock.active_ingredient).toBeNull();
    expect(enrichStockIngredients([stock], [reference, { ...reference }])[0].active_ingredient).toBe("Amlodipine 5mg");
    expect(enrichStockIngredients([{ ...stock, active_ingredient: "Original" }], [reference])[0].active_ingredient).toBe("Original");
  });

  it("rejects conflicting ingredient references, identifiers, forms, strengths and alternate brands", () => {
    for (const alternative of [
      { ...reference, strength: "10MG" },
      { ...reference, dosage_unit: "CAPS" },
      { ...reference, brand_name: "OTHER AMLOTENS" },
      { ...reference, brand_name: "TAB AMLOTENS" },
      { ...reference, dosage_unit: null },
    ]) expect(enrichStockIngredients([stock], [alternative])[0].active_ingredient).toBeNull();
    expect(enrichStockIngredients([stock], [reference, { ...reference, active_ingredient: "Other ingredient" }])[0].active_ingredient).toBeNull();
    expect(enrichStockIngredients([{ ...stock, brand_product_id: "1" }], [{ ...reference, brand_product_id: "2" }])[0].active_ingredient).toBeNull();
    expect(enrichStockIngredients([{ ...stock, brand_name: "TENSTAR", strength: "160/25MG" }], [{ ...reference, brand_name: "TENSTAR", strength: "160MG" }])[0].active_ingredient).toBeNull();
  });

  it("shows the scientific subtitle only when distinct from the displayed scientific name", () => {
    expect(stockScientificSubtitle({ ...stock, active_ingredient: "Amlodipine 5mg" })).toBe("Amlodipine 5mg");
    expect(stockScientificSubtitle({ ...stock, brand_name: "Allopurinol 100MG TABS", strength: "100MG", active_ingredient: "Allopurinol" })).toBeNull();
    expect(stockScientificSubtitle({ ...stock, brand_name: "Amiodarone Hydrochloride", active_ingredient: "AMIODARONE HYDROCHLORIDE" })).toBeNull();
    expect(stockScientificSubtitle(stock)).toBeNull();
  });

  it("validates full dates including leap days and supported timestamps", () => {
    for (const value of ["2028-02-29", "29/02/2028", "2028/2/29", "2028-02-29T12:00:00Z", "2028-02-29 00:00:00"]) {
      expect(parseStockExpiry(value)).toEqual({ date: "2028-02-29", month: null });
    }
    for (const value of ["2027-02-29", "31/04/2027", "2027-13-01", "batch-2027", "", null]) {
      expect(parseStockExpiry(value)).toEqual({ date: null, month: null });
    }
  });

  it("preserves month/year precision without manufacturing a day", () => {
    for (const value of ["05/2027", "5-2027", "2027-05", "2027/5"]) {
      expect(parseStockExpiry(value)).toEqual({ date: null, month: "2027-05" });
      expect(formatStockExpiry(value)).toBe("05/2027");
    }
    expect(parseStockExpiry("13/2027")).toEqual({ date: null, month: null });
    expect(formatStockExpiry(null)).toBeNull();
  });

  it("accepts localized digits and spaces without inventing a day or guessing short years", () => {
    expect(parseStockExpiry("٠٥ / ٢٠٢٧")).toEqual({ date: null, month: "2027-05" });
    expect(parseStockExpiry("۱۵ / ۰۶ / ۲۰۲۸")).toEqual({ date: "2028-06-15", month: null });
    expect(parseStockExpiry("05/27")).toEqual({ date: null, month: null });
  });

  it("does not let an invalid first alias swallow a valid explicit expiry", () => {
    expect(extractStockBatchExpiry({ patsh_numbers: { expiry_date: "not recorded", expireDate: "05/2027" } }))
      .toEqual({ date: null, month: "2027-05", status: "valid" });
    expect(extractStockBatchExpiry({ patsh_numbers: { expiry_date: "2028-06-15" }, expiration_date: "06/2028" }))
      .toEqual({ date: "2028-06-15", month: null, status: "valid" });
  });

  it("binds relation arrays to this stock batch id and never borrows another batch expiry", () => {
    const patsh_numbers = [{ id: 1, batch_number: "A", expiry_date: "05/2027" }, { id: 2, batch_number: "B", expiry_date: "2028-06-15" }];
    const rows = normalizePhifStockRows([
      { id: 1, patsh_numbers_id: 1, patsh_numbers },
      { id: 2, patsh_numbers_id: 2, patsh_numbers },
      { id: 3, patsh_numbers_id: 3, patsh_numbers },
      { id: 4, patsh_numbers },
    ]);
    expect(rows[0].batch_number).toBe("A");
    expect(rows[0].raw_metadata.expiry_month).toBe("2027-05");
    expect(rows[1].batch_number).toBe("B");
    expect(rows[1].expiry_date).toBe("2028-06-15");
    for (const row of rows.slice(2)) {
      expect(row.expiry_date).toBeNull();
      expect(row.raw_metadata.expiry_month).toBeUndefined();
      expect(row.raw_metadata.expiry_status).toBe("conflict");
    }
  });

  it("marks conflicting or invalid expiry for review rather than choosing a convenient date", () => {
    const row = { id: 1, patsh_numbers_id: 1, patsh_numbers: { id: 1, expiry_date: "2027-05-10" }, expire_date: "2027-06-10" };
    expect(extractStockBatchExpiry(row)).toEqual({ date: null, month: null, status: "conflict" });
    expect(extractStockBatchExpiry({ ...row, patsh_numbers_id: 2 }).status).toBe("conflict");
    expect(extractStockBatchExpiry({ expiry_date: "31/02/2027" }).status).toBe("invalid");
    expect(extractStockBatchExpiry({ batch_number: "2027-05-10", created_at: "2027-05-10" }).status).toBe("missing");
    const normalized = normalizePhifStockRows([row])[0];
    expect(normalized.raw_metadata.expiry_status).toBe("conflict");
    expect(normalized.raw_metadata.batch_source_keys).toContain("expiry_date");
    expect(JSON.stringify(normalized.raw_metadata)).not.toContain("2027-05-10");
  });

  it("stores batch-specific expiry and fingerprints changes in month-only expiry", () => {
    const normalized = normalizePhifStockRows([
      { id: 1, patsh_numbers: { batch_number: "A", expiry_date: "05/2027" } },
      { id: 2, patsh_numbers: { batch_number: "B", expiry_date: "2028-06-15" } },
      { id: 3, batch_number: "C", expire_date: "31/12/2027" },
      { id: 4, patsh_numbers: { batch_number: "2028-01-01" } },
    ]);
    expect(normalized[0].expiry_date).toBeNull();
    expect(normalized[0].raw_metadata.expiry_month).toBe("2027-05");
    expect(normalized[1].expiry_date).toBe("2028-06-15");
    expect(normalized[2].expiry_date).toBe("2027-12-31");
    expect(normalized[3].expiry_date).toBeNull();
    expect(normalized[3].raw_metadata.expiry_month).toBeUndefined();
    const changed = normalizePhifStockRows([{ id: 1, patsh_numbers: { batch_number: "A", expiry_date: "06/2027" } }]);
    expect(changed[0].content_hash).not.toBe(normalized[0].content_hash);
    expect(stockExpiryValue({ expiry_date: null, expiry_month: normalized[0].raw_metadata.expiry_month as string })).toBe("2027-05");
    expect(stockExpiryValue({ expiry_date: normalized[1].expiry_date })).toBe("2028-06-15");
  });

  it("preserves live get-pharmacy-stock patsh_numbers.expired_date for each batch", () => {
    // Field structure verified against the live PHIF stock response; identifiers are synthetic.
    const source = [
      { id: 1, patsh_numbers_id: 11, quantity: "3", patsh_numbers: { id: 11, supplier_brand_name_id: 21, patch_number: "A", expired_date: "2026-12-31", created_at: "2020-01-01" } },
      { id: 2, patsh_numbers_id: 12, quantity: "4", patsh_numbers: { id: 12, supplier_brand_name_id: 21, patch_number: "B", expired_date: "2028-11-30" } },
      { id: 3, patsh_numbers_id: 13, quantity: "5", patsh_numbers: { id: 13, supplier_brand_name_id: 21, patch_number: "C", expired_date: "05/2027" } },
      { id: 4, patsh_numbers_id: 14, quantity: "0", patsh_numbers: { id: 14, patch_number: "2029-01-01", expired_date: null } },
    ];
    const rows = normalizePhifStockRows(source);
    expect(rows.map(row => row.expiry_date)).toEqual(["2026-12-31", "2028-11-30", null, null]);
    expect(rows.map(row => row.batch_number)).toEqual(["A", "B", "C", "2029-01-01"]);
    expect(rows[2].raw_metadata.expiry_month).toBe("2027-05");
    expect(rows[3].raw_metadata.expiry_month).toBeUndefined();
    expect(rows[0].content_hash).not.toBe(normalizePhifStockRows([{ ...source[0], patsh_numbers: { ...source[0].patsh_numbers, expired_date: null } }])[0].content_hash);
    expect(extractStockBatchExpiry({ patsh_numbers: { expired_date: "31/02/2027" } }).status).toBe("invalid");
    expect(extractStockBatchExpiry({ patsh_numbers: { expired_date: "2027-05-01", expiry_date: "2027-06-01" } }).status).toBe("conflict");
  });

  it("classifies precise dates and month-only expiry without expiring it on an invented first day", () => {
    const now = new Date(2026, 9, 16, 12);
    expect(stockExpiryState("2026-09", now).status).toBe("expired");
    expect(stockExpiryState("2026-10", now).status).toBe("soon");
    expect(stockExpiryState("2027-05", now).status).toBe("valid");
    expect(stockExpiryState("2026-10-15", now).status).toBe("expired");
    expect(stockExpiryState(null, now).status).toBe("missing");
  });

  it("loads references through the current pharmacy invoice relation with stable pagination and no financial or beneficiary fields", async () => {
    const calls: any[] = [];
    const db = { from(table: string) {
      calls.push(["from", table]);
      const query: any = {
        select(fields: string) { calls.push(["select", fields]); return query; },
        eq(field: string, value: string) { calls.push(["eq", field, value]); return query; },
        order(field: string) { calls.push(["order", field]); return query; },
        async range() { return { data: [{ brand: "AMLOTENS", active_ingredient: "Amlodipine", strength: "5MG", metadata: { unit: "TABS" } }], error: null }; },
      };
      return query;
    } };
    const rows = await loadStockIngredientReferences(db, "pharmacy-a");
    expect(calls).toContainEqual(["eq", "phif_invoices.pharmacy_id", "pharmacy-a"]);
    expect(calls).toContainEqual(["eq", "source_classification", "actual-supplier"]);
    expect(calls).toContainEqual(["order", "id"]);
    const fields = calls.find(call => call[0] === "select")[1];
    expect(fields).not.toMatch(/cost|price|financial|beneficiary|insurance_card/);
    expect(rows[0].dosage_unit).toBe("TABS");
    expect(Object.keys(rows[0])).not.toContain("phif_invoices");
  });
});
