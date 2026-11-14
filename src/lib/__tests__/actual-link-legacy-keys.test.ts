import { beforeEach, describe, expect, it, vi } from "vitest";
import { actualItemSignature, actualLinkGroups, actualLinkIdentity, applyActualStockLinks } from "../actual-stock-links.helpers";
import { scientificReportIdentity } from "../report-medication-evidence.helpers";
import { TIRYAQ_PHARMACY_NAME } from "../pharmacy-isolation";

vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({ inputValidator: (validate: any) => ({
  handler: (fn: any) => (input: any) => fn({ data: validate(input.data) }),
}) }) }));
const state = vi.hoisted(() => ({ context: {} as any, item: {} as any, stocks: [] as any[], history: [] as any[], calls: [] as any[] }));
vi.mock("../pharmacy-session.server", () => ({ requirePharmacySession: async () => state.context }));
vi.mock("../actual-stock-links.server", () => ({ readActualStockLinks: async () => structuredClone(state.history) }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from(table: string) {
    let rows = table === "pharmacy_users" ? [{ id: state.context.session.data.user_id, pharmacy_id: "own", role: "admin", is_active: true }]
      : table === "phif_invoice_items" ? [state.item] : table === "phif_stock_items" ? state.stocks : [];
    const q: any = { select: () => q, eq: (k: string, v: any) => {
      rows = rows.filter(r => (k === "invoice.pharmacy_id" ? r.invoice.pharmacy_id : r[k]) === v); return q;
    }, maybeSingle: async () => ({ data: rows[0] || null, error: null }) }; return q;
  },
  async rpc(name: string, args: any) {
    state.calls.push({ name, args });
    const old = state.history[0];
    // Mirror the persisted-key guard, not a new normalized comparison.
    if (old && old.source_identity !== args.p_identity) return { error: { message: "Link identity conflict" } };
    if (args.p_revoke) old.is_active = false;
    else if (old) { old.is_active = true; old.target = state.stocks.find(s => s.id === args.p_target_id); }
    else state.history.push({ id: decisionId, version: 0, source: structuredClone(state.item),
      phif_invoice_item_id: state.item.id, source_signature: args.p_signature, source_identity: args.p_identity,
      is_active: true, target: state.stocks.find(s => s.id === args.p_target_id) });
    state.history[0].version++;
    return { error: null };
  },
} }));
import { saveActualStockLink } from "../actual-stock-links.functions";
const itemId = "11111111-1111-4111-8111-111111111111";
const stockId = "22222222-2222-4222-8222-222222222222";
const secondId = "33333333-3333-4333-8333-333333333333";
const decisionId = "44444444-4444-4444-8444-444444444444";
// Representative pre-change wire keys, intentionally literal rather than generated
// by the implementation under test. No production identifiers or patient data.
const cases = [
  ['INSULIN(HUMAN RECOMBINANT RAPID ACTING ANALOGUE)', '[["insulin(human recombinant rapid acting analogue)","100iu","pen"],"example"]'],
  ['INSULIN (HUMAN RECOMBINANT RAPID ACTING ANALOGUE)', '[["insulin (human recombinant rapid acting analogue)","100iu","pen"],"example"]'],
];
beforeEach(() => {
  state.context = { pharmacy_id: "own", pharmacy_name: TIRYAQ_PHARMACY_NAME,
    session: { data: { user_id: itemId, user_role: "admin" } } };
  state.item = { id: itemId, brand: "Example", strength: "100IU", source_classification: "actual-supplier",
    quantity: 2, metadata: { dosage_form: "PEN" }, phif_financial_fields: { total_amount: 50 }, invoice: { pharmacy_id: "own" } };
  state.stocks = [stockId, secondId].map(id => ({ id, source_stock_id: id, brand_product_id: id,
    pharmacy_id: "own", is_current: true, brand_name: "Example", strength: "100IU", dosage_unit: "PEN" }));
  state.history = []; state.calls = [];
});
const save = (targetId: string | null, revoke = false) => saveActualStockLink({ data: { itemId, targetId, revoke,
  confirmed: true, expectedVersion: state.history[0]?.version || 0,
  expectedMembers: state.history.map(l => ({ id: l.id, version: l.version })) } });

describe("Actual persisted identity compatibility", () => {
  it.each(cases)("preserves %s through creation, reload, edit, revoke and restore", async (name, persisted) => {
    state.item.active_ingredient = name;
    expect(actualLinkIdentity(state.item, state.stocks[0])).toBe(persisted);
    const before = JSON.stringify(state.item);
    await save(stockId);
    expect(state.history[0].source_identity).toBe(persisted);
    state.history = structuredClone(state.history);
    expect(actualLinkGroups(state.history)[0]).toMatchObject({ identity: persisted, status: "linked" });
    expect(applyActualStockLinks([state.item], state.history)[0].manual_stock_link).toBeDefined();
    await save(secondId);
    expect(state.history[0].target.id).toBe(secondId);
    await save(null, true);
    expect(actualLinkGroups(state.history)[0].status).toBe("unlinked");
    expect(applyActualStockLinks([state.item], state.history)[0].manual_stock_link).toBeUndefined();
    await save(stockId);
    expect(actualLinkGroups(state.history)[0].status).toBe("linked");
    expect(state.calls).toHaveLength(4);
    expect(state.calls.every(c => c.args.p_identity === persisted)).toBe(true);
    expect(JSON.stringify(state.item)).toBe(before);
  });
  it.each(cases)("opens a literal historical key for %s without migrating it", async (name, persisted) => {
    state.item.active_ingredient = name;
    state.history = [{ id: decisionId, version: 7, source: structuredClone(state.item),
      phif_invoice_item_id: itemId, source_identity: persisted, source_signature: actualItemSignature(state.item),
      is_active: true, target: state.stocks[0] }];
    await save(secondId);
    expect(state.calls[0].args.p_identity).toBe(persisted);
    expect(state.calls[0].args.p_expected_members).toEqual([{ id: decisionId, version: 7 }]);
  });
  it("does not merge historical whitespace variants or different strengths/forms/products", () => {
    const a = { ...state.item, active_ingredient: cases[0][0] };
    const b = { ...a, active_ingredient: cases[1][0] };
    expect(scientificReportIdentity(a).key).toBe(scientificReportIdentity(b).key);
    expect(actualLinkIdentity(a, state.stocks[0])).not.toBe(actualLinkIdentity(b, state.stocks[0]));
    for (const change of [{ strength: "200IU" }, { metadata: { dosage_form: "VIAL" } }, { brand: "Other" }])
      expect(actualLinkIdentity({ ...a, ...change }, state.stocks[0])).not.toBe(cases[0][1]);
    const link = { id: decisionId, version: 1, source: a, phif_invoice_item_id: itemId,
      source_identity: cases[0][1], source_signature: actualItemSignature(a), is_active: true, target: state.stocks[0] };
    expect(actualLinkGroups([link, { ...link, id: "other", target: state.stocks[1] }])[0].conflict).toBe(true);
    for (const change of [{ strength: "200IU" }, { brand: "Other" }, { metadata: { dosage_form: "VIAL" } },
      { active_ingredient: cases[1][0] }])
      expect(applyActualStockLinks([{ ...a, ...change, id: "future" }], [link])[0].manual_stock_link).toBeUndefined();
  });
});
