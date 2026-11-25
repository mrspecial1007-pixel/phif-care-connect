import { afterEach, expect, it, vi } from "vitest";
import { readPhifOrders } from "../phif-orders.server";
import { ordersReportSchema } from "../phif-orders-snapshot.helpers";
import { ordersFixture } from "./fixtures/phif-orders.fixture";
import { ordersView, defaultOrdersFilters } from "../phif-orders.helpers";

afterEach(() => vi.unstubAllEnvs());

async function read(patch: Record<string, unknown> = {}) {
  vi.stubEnv("PHIF_BRIDGE_SECRET", "test-secret");
  vi.stubEnv("PHIF_BRIDGE_BASE_URL", "http://bridge-test");
  const report = ordersFixture();
  Object.assign(report.orders[0].lines[0], patch);
  const query: any = { select: () => query, eq: vi.fn(() => query), gt: () => query,
    order: () => query, limit: () => query, maybeSingle: async () => ({ error: null,
      data: { bridge_session_id: "test-session", expires_at: "2099-01-01T00:00:00Z" } }) };
  const fetcher = vi.fn(async () => Response.json({ ok: true, ...report }));
  const result = await readPhifOrders({ from: () => query }, "tiryaq", fetcher);
  expect(query.eq).toHaveBeenCalledWith("pharmacy_id", "tiryaq");
  expect(fetcher).toHaveBeenCalledTimes(1);
  return result.orders[0].lines[0];
}

it("reader accepts legacy null dates and absent optional fields without inventing values", async () => {
  const line = await read();
  expect(line.approvedAt).toBeNull();
  expect(line.receivedAt).toBeNull();
  for (const key of ["batchId", "requestedQuantity", "supplierQuantity", "receivedQuantity", "fulfillmentStage", "deliveredAt"])
    expect(JSON.parse(JSON.stringify(line))).not.toHaveProperty(key);
});

it("reader preserves all new fields and snapshot roundtrip without replacing receipt values", async () => {
  const patch = { batchId: "00123", requestedQuantity: 30, supplierQuantity: 20, receivedQuantity: 12.5,
    status: "received", fulfillmentStage: "received", approvedAt: "2026-11-12T14:51:00+02:00",
    deliveredAt: "2026-11-22T10:45:00Z", receivedAt: "2026-11-24T23:05:00Z" };
  const line = await read(patch);
  expect(line).toMatchObject(patch);
  const report = ordersFixture();
  report.orders[0].lines[0] = line;
  expect(ordersReportSchema.parse(JSON.parse(JSON.stringify(report))).orders[0].lines[0]).toMatchObject(patch);
});

it.each(["ready", "in_delivery"])("%s never turns supplier quantity/delivery into receipt", async fulfillmentStage => {
  const line = await read({ fulfillmentStage, supplierQuantity: 45,
    deliveredAt: "2026-11-22T12:45:00+02:00", receivedQuantity: null });
  expect(line.status).toBe("waiting");
  expect(line.receivedQuantity).toBeNull();
  expect(line.receivedAt).toBeNull();
});

it("reader preserves nulls and real zeros and omits arbitrary upstream fields", async () => {
  const line = await read({ batchId: null, approvedAt: null, deliveredAt: null,
    requestedQuantity: 0, supplierQuantity: null, receivedQuantity: 0, raw: "not-exportable" });
  expect(line).toMatchObject({ batchId: null, approvedAt: null, deliveredAt: null,
    requestedQuantity: 0, supplierQuantity: null, receivedQuantity: 0 });
  expect(line).not.toHaveProperty("raw");
});

it.each([
  { approvedAt: "invalid" }, { approvedAt: "2026-02-30T12:00:00Z" },
  { deliveredAt: "2026-11-25T25:00:00Z" }, { deliveredAt: 42 },
  { requestedQuantity: -1 }, { supplierQuantity: "20" }, { receivedQuantity: -1 },
  { batchId: 2199 }, { fulfillmentStage: "invented" },
])("rejects malformed new fields: %j", async patch => {
  await expect(read(patch)).rejects.toThrow("استجابة طلبيات PHIF غير مكتملة");
});

it("new optional detail fields survive snapshot validation without rejecting old snapshots", () => {
  const report = ordersFixture();
  expect(ordersReportSchema.safeParse(report).success).toBe(true);
  Object.assign(report.orders[0].lines[0], {
    batchId: "2199", requestedQuantity: 400, supplierQuantity: 400, receivedQuantity: null,
    fulfillmentStage: "ready", deliveredAt: "2026-11-22T10:45:00.000Z",
    approvedAt: "2026-11-16T09:54:00.000Z", receivedAt: null,
  });
  const parsed = ordersReportSchema.parse(report);
  expect(parsed.orders[0].lines[0]).toMatchObject({ batchId: "2199", requestedQuantity: 400,
    fulfillmentStage: "ready", approvedAt: "2026-11-16T09:54:00.000Z", receivedAt: null });
  expect(ordersView({ ...parsed, canExport: true }, defaultOrdersFilters).rows.find(r => r.id === report.orders[0].lines[0].id)?.status).toBe("waiting");
  expect(ordersReportSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
});
