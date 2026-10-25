import test from "node:test";
import assert from "node:assert/strict";
import { parsePhifOrderDetails, readCompletePhifOrders } from "../phif/orders.js";
import { isAllowedReadPath, isAllowedPostFormPath } from "../phif/client.js";
import { isAllowedProxyGet, isAllowedProxyRequest } from "../phif/sessionBridge.js";
import { createPhifBridgeServer } from "../server.js";
import { BridgeSessionStore } from "../sessionStore.js";

const order = (id, patch = {}) => ({ id, pharmacies_id: 242, pharmacy_branch_id: 266,
  order_id: `ORD_242_266_${id}`, status: "تم القبول", created_at: "2026-10-13T02:38:20.000000Z", ...patch });
const page = (data, total = data.length) => ({ data, recordsTotal: total, recordsFiltered: total });
export const lineHtml = (id = "60686", quantity = "30", approval = "تم القبول", receipt = "waiting") => `<table><tr>
  <td>الدواء</td><td>Batch Number</td><td>المورد</td><td>الحالة</td><td>الكمية المحددة</td><td>الكمية المحددة من المورد</td><td>الاجراء</td></tr>
  <tr><td>Allopurinol / TABS / 300MG</td><td>00123</td><td>شركة المورد &amp; فرعها</td><td>${approval}</td><td>30</td>
  <td><input disabled id="qun_${id}" ${quantity == null ? "" : `value="${quantity}"`}></td>
  <td>${receipt === "received" ? "تم الاستلام" : receipt === "waiting" ? `<a href="http://his.phif.gov.ly/accept-pharmacy-order/${id}">استلام الطلب</a>` : ""}</td></tr></table>`;
const client = (getPage, detail = id => lineHtml(String(Number(id) + 10000))) => ({
  getJson: async path => ({ ok: true, json: await getPage(path) }),
  getHtml: async path => ({ ok: true, text: detail(path.split("/").at(-1)) }),
});

test("observed HTML distinguishes supplier acceptance, receipt and missing quantities", () => {
  const result = parsePhifOrderDetails(lineHtml() + lineHtml("2", "99", "تم القبول", "received")
    + lineHtml("3", "30", "قيد الاجراء", "none") + lineHtml("4", null));
  assert.deepEqual(result.map(r => r.status), ["waiting", "received", "not_approved", "waiting"]);
  assert.deepEqual(result.map(r => r.approvedQuantity), [30, 99, null, null]);
  assert.equal(result[3].quantityMissing, true);
  assert.equal(result[0].supplier, "شركة المورد & فرعها");
  assert.equal(result[0].batch, "00123");
  assert.equal(JSON.stringify(result).includes("accept-pharmacy-order"), false);
  assert.ok(result.every(r => r.approvedAt == null && r.receivedAt == null));
});
test("unknown/contradictory states are not accepted; incomplete layouts fail visibly", () => {
  assert.equal(parsePhifOrderDetails(lineHtml("1", "30", "unknown"))[0].status, "review");
  assert.equal(parsePhifOrderDetails(lineHtml("1", "30", "قيد الاجراء", "received"))[0].status, "review");
  assert.throws(() => parsePhifOrderDetails("<h1>Server failure</h1>"));
  assert.throws(() => parsePhifOrderDetails(lineHtml() + lineHtml()));
  assert.deepEqual(parsePhifOrderDetails("<h4>قم بتحديد كميات الادوية</h4>"), []);
});
test("reads more than 25 orders and follows DataTables pagination until the declared total", async () => {
  const paths = [];
  const report = await readCompletePhifOrders(client(path => {
    paths.push(path);
    return page(path.includes("start=25") ? Array.from({ length: 35 }, (_, i) => order(i + 26))
      : Array.from({ length: 25 }, (_, i) => order(i + 1)), 60);
  }), "242");
  assert.equal(report.orders.length, 60); assert.equal(report.pages, 2); assert.equal(report.complete, true);
  assert.ok(paths[1].includes("start=25&length=100"));
});
test("supports an unpaginated complete list and excludes only explicitly approved zero", async () => {
  const report = await readCompletePhifOrders(client(() => page([order(1)]), () =>
    lineHtml("1", "0") + lineHtml("2", null) + lineHtml("3", "0", "قيد الاجراء", "none")), "242");
  assert.equal(report.excludedZero, 1);
  assert.deepEqual(report.orders[0].lines.map(l => l.id), ["2", "3"]);
  assert.ok(report.orders[0].lines.every(l => l.approvedQuantity === null));
});
test("rejects incomplete pagination, changing totals, forged identities and cross-pharmacy/branch rows", async () => {
  await assert.rejects(readCompletePhifOrders(client(() => page([order(1)], 2)), "242"), /no progress/);
  await assert.rejects(readCompletePhifOrders(client(path => page([order(path.includes("start") ? 2 : 1)], path.includes("start") ? 3 : 2)), "242"), /changed/);
  for (const rows of [[order(1, { pharmacies_id: 999 })], [order("../1")], [order(1, { pharmacy_branch_id: null })],
    [order(1), order(2, { pharmacy_branch_id: 267 })]])
    await assert.rejects(readCompletePhifOrders(client(() => page(rows)), "242"));
  await assert.rejects(readCompletePhifOrders(client(() => page([])), ""));
  await assert.rejects(readCompletePhifOrders(client(() => ({ data: [order(1)] })), "242"));
});
test("a failed detail remains an explicit incomplete order, never an empty successful report", async () => {
  const c = client(() => page([order(1), order(2)]));
  c.getHtml = async path => path.endsWith("/2") ? { ok: false, status: 500 } : { ok: true, text: lineHtml() };
  const report = await readCompletePhifOrders(c, "242");
  assert.equal(report.complete, false); assert.equal(report.totalOrders, 2);
  assert.ok(report.orders[1].detailError); assert.equal(report.orders[0].lines.length, 1);
});
test("details concurrency is bounded and response caches are never shared between calls", async () => {
  let active = 0, maximum = 0;
  const c = client(() => page(Array.from({ length: 8 }, (_, i) => order(i + 1))));
  c.getHtml = async path => {
    active++; maximum = Math.max(active, maximum);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    return { ok: true, text: lineHtml(String(Number(path.split("/").at(-1)) + 10000)) };
  };
  const a = await readCompletePhifOrders(c, "242");
  assert.equal(maximum, 3);
  a.orders[0].lines[0].supplier = "changed locally";
  const b = await readCompletePhifOrders(c, "242");
  assert.notEqual(b.orders[0].lines[0].supplier, "changed locally");
});
test("allows only numeric read routes and never exposes orders through login proxy or permits receipt", () => {
  assert.equal(isAllowedReadPath("/get-pharmacy-request-index?start=25&length=100"), true);
  assert.equal(isAllowedReadPath("/show-pharmacy-order/10326"), true);
  for (const path of ["/accept-pharmacy-order/60686", "/create-new-order", "/show-pharmacy-order/1/receive", "/show-pharmacy-order/../1"])
    assert.equal(isAllowedReadPath(path), false);
  for (const path of ["/get-pharmacy-request-index", "/show-pharmacy-order/10326", "/accept-pharmacy-order/60686"]) {
    assert.equal(isAllowedProxyGet(path), false);
    assert.equal(isAllowedPostFormPath(path), false);
    assert.equal(isAllowedProxyRequest("POST", path), false);
  }
});
test("rejects a depleted read budget before fetching and duplicate line identities across orders", async () => {
  let fetched = false;
  await assert.rejects(readCompletePhifOrders(client(() => { fetched = true; return page([]); }), "242", { budgetMs: 0 }), /budget/);
  assert.equal(fetched, false);
  await assert.rejects(readCompletePhifOrders(client(() => page([order(1), order(2)]), () => lineHtml()), "242"), /multiple orders/);
});
test("Bridge orders API requires its secret and correct session pharmacy and only issues upstream GETs", async () => {
  const previous = process.env.PHIF_TIRYAQ_SOURCE_PHARMACY_ID;
  process.env.PHIF_TIRYAQ_SOURCE_PHARMACY_ID = "242";
  const store = new BridgeSessionStore(), created = store.create("local-tiryaq");
  const session = store.get(created.bridge_session_id, "local-tiryaq");
  session.cookieJar.set("phif_session", "private-test-cookie");
  const calls = [];
  const server = createPhifBridgeServer({ secret: "test-secret", store, fetchImpl: async (url, options) => {
    calls.push({ path: new URL(url).pathname, method: options.method });
    return new URL(url).pathname === "/get-pharmacy-request-index"
      ? Response.json(page([order(10326)])) : new Response(lineHtml());
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/bridge-sessions/${created.bridge_session_id}/orders`;
  try {
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(base, { headers: { "X-PHIF-Bridge-Secret": "test-secret" } })).status, 403);
    assert.equal((await fetch(base, { headers: { "X-PHIF-Bridge-Secret": "test-secret", "X-Pharmacy-Id": "andalus" } })).status, 404);
    assert.equal(calls.length, 0);
    const headers = { "X-PHIF-Bridge-Secret": "test-secret", "X-Pharmacy-Id": "local-tiryaq" };
    assert.equal((await fetch(base, { method: "POST", headers })).status, 404);
    const response = await fetch(base, { headers });
    const body = await response.json(); assert.equal(body.ok, true);
    assert.deepEqual(calls.map(c => c.method), ["GET", "GET"]);
    assert.ok(calls.every(c => !c.path.includes("accept")));
    assert.equal(JSON.stringify(body).includes("private-test-cookie"), false);
    assert.equal(JSON.stringify(body).includes(created.bridge_session_id), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete process.env.PHIF_TIRYAQ_SOURCE_PHARMACY_ID;
    else process.env.PHIF_TIRYAQ_SOURCE_PHARMACY_ID = previous;
  }
});
