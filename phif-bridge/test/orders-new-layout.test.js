import test from "node:test";
import assert from "node:assert/strict";
import { parsePhifOrderDetails, readCompletePhifOrders } from "../phif/orders.js";
import { order10972Html } from "./fixtures/order-10972.js";

test("10972: all 17 batch records and four independent stages survive extraction", () => {
  const lines = parsePhifOrderDetails(order10972Html);
  assert.equal(lines.length, 17);
  const counts = Object.fromEntries(["received","ready","in_delivery","not_approved"].map(stage =>
    [stage, lines.filter(l => l.fulfillmentStage === stage).length]));
  assert.deepEqual(counts, { received: 3, ready: 8, in_delivery: 5, not_approved: 1 });
  const repeated = lines.filter(l => l.medicine.startsWith("SITAGLIMET"));
  assert.equal(repeated.length, 7);
  assert.equal(new Set(repeated.map(l => l.batch)).size, 7);
  assert.equal(new Set(repeated.map(l => l.batchId)).size, 7);
  assert.ok(lines.every(l => l.receivedQuantity === null));
  assert.equal(lines[2].supplierQuantity, 300);
  assert.equal(lines[2].approvedQuantity, null);
  assert.equal(lines[4].requestedQuantity, 30);
  assert.equal(lines[4].approvedQuantity, 0);
});

test("receipt and delivery dates are separate; approval is per line, not stepper", () => {
  const lines = parsePhifOrderDetails(order10972Html);
  assert.equal(lines[0].receivedAt, "2026-11-24T23:05:00.000Z");
  assert.equal(lines[0].approvedAt, "2026-11-15T08:22:00.000Z");
  assert.equal(lines[5].deliveredAt, "2026-11-22T10:45:00.000Z");
  assert.equal(lines[5].receivedAt, null);
  assert.equal(lines[3].receivedAt, null);
  assert.equal(lines[3].deliveredAt, null);
  assert.equal(parsePhifOrderDetails(order10972Html.replaceAll("2026-11-25 01:05 AM", "2026-02-30 01:05 AM"))[0].receivedAt, null);
});

test("missing values stay unknown and mismatched or duplicate record IDs reject the page", () => {
  const missing = parsePhifOrderDetails(order10972Html.replace('value="45" disabled', 'disabled'));
  assert.equal(missing[0].approvedQuantity, null);
  assert.equal(missing[0].quantityMissing, true);
  assert.throws(() => parsePhifOrderDetails(order10972Html.replace("status_container_66256", "status_container_66257")));
  assert.throws(() => parsePhifOrderDetails(order10972Html + order10972Html));
  assert.throws(() => parsePhifOrderDetails(order10972Html.replaceAll("تم الاستلام بنجاح", "حالة جديدة")));
  assert.equal(parsePhifOrderDetails(order10972Html.replaceAll("قيد الانتظار", "حالة جديدة"))[2].status, "review");
});

test("reader only uses detail GET; excludes 8 approved zeros, preserves pending and fails closed", async () => {
  const paths = [];
  const client = {
    getJson: async path => { paths.push(path); return { ok: true, json: { recordsTotal: 1, recordsFiltered: 1,
      data: [{ id: 10972, pharmacies_id: 242, pharmacy_branch_id: 266, order_id: "ORD_242_266_10972", created_at: "2026-11-11T11:35:00Z" }] } }; },
    getHtml: async path => { paths.push(path); return { ok: true, text: order10972Html }; },
  };
  const report = await readCompletePhifOrders(client, "242");
  assert.equal(report.complete, true);
  assert.equal(report.excludedZero, 8);
  assert.equal(report.orders[0].lines.length, 9);
  assert.deepEqual(paths, ["/get-pharmacy-request-index", "/show-pharmacy-order/10972"]);
  client.getHtml = async () => ({ ok: true, text: order10972Html.replace("med_container_66256", "missing") });
  const failed = await readCompletePhifOrders(client, "242");
  assert.equal(failed.complete, false);
  assert.ok(failed.orders[0].detailError);
  assert.equal(report.orders[0].lines.length, 9);
});
