import test from "node:test";
import assert from "node:assert/strict";
import { readCompletePhifOrders } from "../phif/orders.js";

const html = `<table><tr><th>الدواء</th><th>Batch Number</th><th>المورد</th><th>الحالة</th><th>الكمية المحددة من المورد</th><th>الاجراء</th></tr>
<tr><td>PRIVATE_MEDICINE</td><td>PRIVATE_BATCH</td><td>PRIVATE_COMPANY</td><td>تم القبول</td><td><input id="qun_123" value="1"></td><td>تم الاستلام</td></tr></table>`;
function client(responses) {
  let calls = 0;
  return { timeoutMs: 100, calls: () => calls,
    getJson: async () => ({ ok: true, json: { recordsTotal: 1, recordsFiltered: 1,
      data: [{ id: 10128, order_id: "ORD_242_266_10128", pharmacies_id: 242, pharmacy_branch_id: 266, created_at: "2026-10-01T00:00:00Z" }] } }),
    getHtml: async () => { const r = responses[Math.min(calls++, responses.length - 1)]; if (r instanceof Error) throw r; return r; },
  };
}
async function capture(run) {
  const original = console.info, logs = [];
  console.info = (...args) => logs.push(args);
  try { return { value: await run(), logs }; } finally { console.info = original; }
}
test("details diagnostics are correlated, stage-specific and omit upstream content and secrets", async () => {
  const { value, logs } = await capture(() => readCompletePhifOrders(client([{ ok: true, status: 200, text: html }]), "242"));
  assert.equal(value.complete, true);
  assert.deepEqual(logs.map(([, e]) => [e.stage, e.event]), [["fetch", "started"], ["fetch", "finished"], ["parse_validate", "started"], ["parse_validate", "finished"], ["complete", "finished"]]);
  assert.equal(new Set(logs.map(([, e]) => e.runId)).size, 1);
  assert.ok(logs.every(([tag, e]) => tag === "phif_order_details" && e.orderId === "10128"));
  assert.equal(JSON.stringify(logs).includes("PRIVATE"), false);
});
test("unobserved changed HTML fails closed at parsing, never retries or returns complete", async () => {
  const c = client([{ ok: true, status: 200, text: "<h1>تفاصيل ومسار طلبية الأدوية</h1><p>PRIVATE_SESSION</p>" }]);
  const { value, logs } = await capture(() => readCompletePhifOrders(c, "242"));
  assert.equal(c.calls(), 1); assert.equal(value.complete, false); assert.ok(value.orders[0].detailError);
  assert.ok(logs.some(([, e]) => e.stage === "parse_validate" && e.type === "layout_unrecognized"));
  assert.equal(JSON.stringify(logs).includes("PRIVATE_SESSION"), false);
});
test("missing columns and duplicate IDs are distinct validation errors, not transient failures", async () => {
  for (const [text, type] of [[html.replace("الكمية المحددة من المورد", "unknown"), "columns_unrecognized"], [html + html, "duplicate_line"]]) {
    const c = client([{ ok: true, status: 200, text }]);
    const { value, logs } = await capture(() => readCompletePhifOrders(c, "242"));
    assert.equal(value.complete, false); assert.equal(c.calls(), 1); assert.ok(logs.some(([, e]) => e.type === type));
  }
});
test("retries only identified temporary GET failures once, within budget", async () => {
  for (const initial of [{ ok: false, status: 503 }, Object.assign(new Error("PRIVATE_COOKIE"), { code: "ECONNRESET" }),
    Object.assign(new Error("PRIVATE_COOKIE"), { code: "PHIF_UPSTREAM_TIMEOUT" })]) {
    const c = client([initial, { ok: true, status: 200, text: html }]);
    const { value, logs } = await capture(() => readCompletePhifOrders(c, "242"));
    assert.equal(c.calls(), 2); assert.equal(value.complete, true);
    assert.equal(logs.filter(([, e]) => e.event === "retry").length, 1);
    assert.equal(JSON.stringify(logs).includes("PRIVATE_COOKIE"), false);
  }
  const c = client([{ ok: false, status: 502 }]);
  const { value } = await capture(() => readCompletePhifOrders(c, "242"));
  assert.equal(c.calls(), 2); assert.equal(value.complete, false);
});
test("never retries authentication, permanent HTTP, cancellation or an unknown exception", async () => {
  for (const initial of [{ ok: false, status: 503, authRequired: true }, { ok: false, status: 404 },
    Object.assign(new Error("PRIVATE_TOKEN"), { name: "AbortError" }), new Error("PRIVATE_TOKEN")]) {
    const c = client([initial]);
    const { value, logs } = await capture(() => readCompletePhifOrders(c, "242"));
    assert.equal(c.calls(), 1); assert.equal(value.complete, false); assert.equal(JSON.stringify(logs).includes("PRIVATE"), false);
  }
});
test("logging failure cannot turn a complete snapshot into a failure", async () => {
  const original = console.info; console.info = () => { throw new Error("sink"); };
  try { assert.equal((await readCompletePhifOrders(client([{ ok: true, text: html }]), "242")).complete, true); }
  finally { console.info = original; }
});
