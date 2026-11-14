import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({ inputValidator: (validate: any) => ({ handler: (fn: any) =>
    (input: any) => fn({ data: validate(input.data) }) }) }),
}));
const state = vi.hoisted(() => ({ session: {} as any, tables: {} as Record<string, any[]>, writes: [] as any[] }));
vi.mock("../pharmacy-session.server", () => ({ requirePharmacySession: async () => state.session }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from(table: string) {
    const filters: ((r: any) => boolean)[] = [];
    let insert: any, update: any;
    const result = () => {
      const rows = (state.tables[table] || []).filter(r => filters.every(f => f(r)));
      if (insert) { state.writes.push({ table, insert }); return { data: insert, error: null }; }
      if (update && rows.length) { state.writes.push({ table, update, ids: rows.map(r => r.id) }); }
      return { data: rows[0] ? { ...rows[0], ...update } : null, error: null };
    };
    const q: any = {
      select: () => q, eq: (k: string, v: any) => { filters.push(r => r[k] === v); return q; },
      is: (k: string, v: any) => { filters.push(r => r[k] === v); return q; },
      order: () => q, limit: () => q,
      then: (resolve: any, reject: any) => Promise.resolve({
        data: (state.tables[table] || []).filter(r => filters.every(f => f(r))), error: null,
      }).then(resolve, reject),
      insert: (row: any) => { insert = row; return q; }, update: (row: any) => { update = row; return q; },
      single: async () => result(), maybeSingle: async () => result(),
    }; return q;
  },
} }));
import { createMedication, createCommercialProduct, createProductMedicationMapping,
  closeProductMedicationMapping, setPrescriptionItemMedication, addPrescriptionItem,
  listProductMappings, searchMedications, searchCommercialProducts } from "../medications.functions";

const id = "11111111-1111-4111-8111-111111111111";
const drug = { active_ingredient: "Insulin", strength_value: 100, strength_unit: "IU", dosage_form: "pen" };
const actions = [
  () => createMedication({ data: drug }),
  () => createCommercialProduct({ data: { brand_name: "Brand" } }),
  () => createProductMedicationMapping({ data: { product_id: id, medication_id: id, source: "manual", confidence: "confirmed" } }),
  () => closeProductMedicationMapping({ data: { id } }),
  () => setPrescriptionItemMedication({ data: { id, medication_id: id } }),
  () => addPrescriptionItem({ data: { prescription_id: id, medication_id: id, raw_text: "Drug", line_number: 1 } }),
];
beforeEach(() => {
  state.session = { pharmacy_id: "own", session: { data: { user_id: id, user_role: "admin" } } };
  state.tables = {
    pharmacy_users: [{ id, pharmacy_id: "own", role: "admin", is_active: true }],
    medications: [{ id }], commercial_products: [{ id, is_active: true }],
    product_medication_mappings: [{ id, created_by_pharmacy_id: "own", effective_to: null }],
    prescription_items: [{ id, pharmacy_id: "own" }], prescriptions: [{ id, pharmacy_id: "own" }],
  }; state.writes = [];
});
describe("directory service-role write authorization", () => {
  it.each(["admin", "employee"])("isolates private reads for an active %s while sharing catalog records", async role => {
    state.session.session.data.user_role = role;
    state.tables.pharmacy_users[0].role = role;
    state.tables.product_medication_mappings = [
      { id: "own", product_id: id, created_by_pharmacy_id: "own", effective_to: null },
      { id: "foreign", product_id: id, created_by_pharmacy_id: "other", effective_to: null },
      { id: "unowned", product_id: id, created_by_pharmacy_id: null, effective_to: null },
      { id: "history", product_id: id, created_by_pharmacy_id: "own", effective_to: "2026-01-01" },
    ];
    expect((await listProductMappings({ data: { product_id: id } })).map((r: any) => r.id)).toEqual(["own"]);
    expect((await listProductMappings({ data: { product_id: id, active_only: false } })).map((r: any) => r.id)).toEqual(["own", "history"]);
    expect(await searchMedications({ data: {} })).toHaveLength(1);
    expect(await searchCommercialProducts({ data: {} })).toHaveLength(1);
    if (role === "employee") for (const action of actions) await expect(action()).rejects.toThrow("Forbidden");
    expect(state.writes).toEqual([]);
  });
  it.each(["admin", "employee"])("denies all directory reads for disabled or reassigned %s", async role => {
    state.session.session.data.user_role = role;
    state.tables.pharmacy_users[0].role = role;
    const reads = [() => listProductMappings({ data: { product_id: id } }),
      () => searchMedications({ data: {} }), () => searchCommercialProducts({ data: {} })];
    state.tables.pharmacy_users[0].is_active = false;
    for (const read of reads) await expect(read()).rejects.toThrow("Forbidden");
    state.tables.pharmacy_users[0].is_active = true;
    state.tables.pharmacy_users[0].pharmacy_id = "other";
    for (const read of reads) await expect(read()).rejects.toThrow("Forbidden");
  });
  it("does not treat unowned links or PIN-only sessions as shared mapping access", async () => {
    state.session.session.data = {};
    await expect(listProductMappings({ data: { product_id: id } })).rejects.toThrow("Forbidden");
    expect(await searchMedications({ data: {} })).toHaveLength(1);
    expect(state.writes).toEqual([]);
  });
  it.each(["employee", "legacy", undefined])("blocks every directory write for %s", async role => {
    state.session.session.data.user_role = role;
    for (const action of actions) await expect(action()).rejects.toThrow("Forbidden");
    expect(state.writes).toEqual([]);
  });
  it.each(["revoked", "foreign", "inactive", "missing-user"])("checks current manager record: %s", async mode => {
    if (mode === "revoked") state.tables.pharmacy_users[0].role = "employee";
    if (mode === "foreign") state.tables.pharmacy_users[0].pharmacy_id = "other";
    if (mode === "inactive") state.tables.pharmacy_users[0].is_active = false;
    if (mode === "missing-user") delete state.session.session.data.user_id;
    for (const action of actions) await expect(action()).rejects.toThrow("Forbidden");
    expect(state.writes).toEqual([]);
  });
  it.each(["other", null])("cannot close a foreign/unowned mapping: %s", async owner => {
    state.tables.product_medication_mappings[0].created_by_pharmacy_id = owner;
    await expect(actions[3]()).rejects.toThrow("not_found");
    expect(state.writes).toEqual([]);
  });
  it("checks pharmacy within the prescription update and creation predicates", async () => {
    state.tables.prescription_items[0].pharmacy_id = "other";
    state.tables.prescriptions[0].pharmacy_id = "other";
    await expect(actions[4]()).rejects.toThrow("not_found");
    await expect(actions[5]()).rejects.toThrow("not_found");
    expect(state.writes).toEqual([]);
  });
  it("does not replace another pharmacy's active relationship", async () => {
    state.tables.product_medication_mappings = [{ id, product_id: id, medication_id: id,
      created_by_pharmacy_id: "other", effective_to: null }];
    await expect(actions[2]()).rejects.toThrow("not_found");
    expect(state.writes).toEqual([]);
  });
  it("rejects inactive products and missing scientific identities before inserting", async () => {
    state.tables.commercial_products[0].is_active = false;
    await expect(actions[2]()).rejects.toThrow("not_found");
    state.tables.commercial_products[0].is_active = true;
    state.tables.medications = [];
    await expect(actions[2]()).rejects.toThrow("not_found");
    expect(state.writes).toEqual([]);
  });
  it("permits the verified manager and stamps ownership from the session", async () => {
    await actions[0](); await actions[1](); await actions[2](); await actions[3]();
    expect(state.writes).toHaveLength(4);
    expect(state.writes[2].insert.created_by_pharmacy_id).toBe("own");
    expect(state.writes[3].ids).toEqual([id]);
  });
});
