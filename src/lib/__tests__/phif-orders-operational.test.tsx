import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultOperationalOrdersFilters as filters, orderStage, orderStageDuration, ordersView, ordersExportRows, type OrderLine, type PhifOrdersReport } from "../phif-orders.helpers";
import { ordersLineSchema } from "../phif-orders-snapshot.helpers";
import { ordersFilterLabel } from "../phif-orders-export";
import { OrdersPage } from "@/routes/management.orders";

const now = Date.parse("2026-11-26T12:00:00Z");
function line(id: string, stage: OrderLine["fulfillmentStage"], patch: Partial<OrderLine> = {}): OrderLine {
  return { id, medicine: `MEDICINE-${id} / TABS / 20MG`, batch: `B-${id}`, batchId: id,
    supplier: "Supplier", approval: "approved", approvedQuantity: 10, quantityMissing: false,
    status: stage === "received" ? "received" : stage === "not_approved" ? "not_approved" : "waiting",
    fulfillmentStage: stage, requestedQuantity: 20, supplierQuantity: 10, receivedQuantity: null,
    approvedAt: "2026-11-16T09:00:00Z", deliveredAt: "2026-11-22T09:00:00Z",
    receivedAt: stage === "received" ? "2026-11-25T09:00:00Z" : null, ...patch };
}
function report(): PhifOrdersReport {
  return { complete: true, canExport: false, totalOrders: 2, pages: 1, excludedZero: 0, pharmacy: "test", fetchedAt: new Date(now).toISOString(),
    orders: [{ id: "10972", number: "ORD_10972", status: "received", createdAt: "2026-11-11T09:00:00Z", detailError: null,
      lines: [line("1", "ready"), line("2", "ready", { supplierQuantity: 0 }), line("3", "in_delivery"),
        line("4", "not_approved", { approvedAt: null }), line("5", "received"), line("6", undefined)] },
    { id: "2", number: "ORD_2", status: "قيد الانتظار", createdAt: null, detailError: null, lines: [] }] };
}
vi.mock("@/lib/queries", () => ({ useSession: () => ({ data: { unlocked: true, pharmacy: { id: "test" }, user: { id: "admin", role: "admin" } } }) }));
vi.mock("@/components/management/ReportBackLink", () => ({ ReportBackLink: () => null }));
vi.mock("@/components/management/OrdersExportButton", () => ({ OrdersExportButton: () => null }));
vi.mock("@/components/management/PhifTrackerIdentityNotice", () => ({ PhifTrackerIdentityNotice: () => null }));
vi.mock("@/lib/use-stored-phif-orders", () => ({ useStoredPhifOrders: () => ({ data: report(), central: true, canRefresh: false }) }));

describe("operational orders display", () => {
  it("defaults to ready lines only, excludes supplier zero, retains batches and never mutates the snapshot", () => {
    const data = report(), before = JSON.stringify(data);
    data.orders[0].lines[1].medicine = data.orders[0].lines[0].medicine;
    const frozen = JSON.stringify(data);
    const view = ordersView(data, filters, now);
    expect(view.rows.map(r => r.id)).toEqual(["1"]);
    expect(view.orderCount).toBe(2);
    expect(view.stageCounts).toEqual({ ready: 1, in_delivery: 1, not_approved: 1, received: 1, review: 1 });
    expect(ordersView(data, { ...filters, stage: "all" }, now).rows).toHaveLength(6);
    expect(JSON.stringify(data)).toBe(frozen);
    expect(before).not.toBe(frozen);
  });
  it("filters every stage and keeps statistics independent of the chosen stage", () => {
    for (const stage of ["ready", "in_delivery", "not_approved", "received", "review"] as const) {
      const view = ordersView(report(), { ...filters, stage }, now);
      expect(view.rows).toHaveLength(1);
      expect(view.rows[0].stage).toBe(stage);
      expect(view.averages.completed).toEqual({ count: 1, days: 9 });
      expect(view.averages.ongoing).toEqual({ count: 2, days: 10 });
    }
    expect(orderStage(line("1", undefined))).toBe("review");
    expect(orderStage(line("1", "ready", { status: "not_approved" }))).toBe("review");
  });
  it("keeps positive batches of the same medicine separate and uses the PHIF receipt before a manual fallback", () => {
    const data = report();
    data.orders[0].lines.push({ ...data.orders[0].lines[0], id: "7", batch: "ANOTHER-BATCH" });
    expect(ordersView(data, filters, now).rows.map(row => row.batch)).toEqual(["B-1", "ANOTHER-BATCH"]);
    const received = line("8", "received");
    received.receipt = { id: "record", pharmacy_id: "test", order_id: "10972", line_id: "8", order_number: "ORD_10972",
      order_created_at: null, medicine: received.medicine, batch: received.batch, status: "received",
      first_received_observed_at: null, confirmed_received_on: "2026-11-20", confirmed_by: "admin", confirmed_at: null, version: 1 };
    expect(orderStageDuration(received, now).days).toBe(9);
    expect(orderStageDuration({ ...received, receivedAt: null }, now).days).toBe(4);
  });
  it("uses approval to actual receipt, not delivery or creation, and keeps ongoing waits separate", () => {
    const received = line("1", "received");
    expect(orderStageDuration(received, now)).toMatchObject({ days: 9, kind: "completed" });
    expect(orderStageDuration(received, now + 86400000).days).toBe(9);
    expect(orderStageDuration(line("2", "ready"), now)).toMatchObject({ days: 10, kind: "ongoing" });
    expect(orderStageDuration(line("2", "ready"), now + 86400000).days).toBe(11);
    expect(orderStageDuration(line("3", "not_approved"), now).days).toBeNull();
    expect(orderStageDuration(line("4", "received", { receivedAt: null }), now).days).toBeNull();
  });
  it("rejects missing, invalid, future and reversed dates while retaining valid zero-day intervals", () => {
    for (const approvedAt of [null, "invalid", "2026-12-01T09:00:00Z", "2026-11-25T10:00:00Z"]) {
      expect(orderStageDuration(line("1", "received", { approvedAt }), now).days).toBeNull();
    }
    expect(orderStageDuration(line("1", "received", { receivedAt: "2026-11-16T10:00:00Z" }), now).days).toBe(0);
    expect(orderStageDuration(line("1", "received", { receivedAt: "2026-12-01T10:00:00Z" }), now).days).toBeNull();
  });
  it("preserves all saved stage dates and quantity meanings through the existing schema", () => {
    const row = line("1", "received"), parsed = ordersLineSchema.parse(row);
    expect(parsed).toMatchObject({ approvedAt: row.approvedAt, deliveredAt: row.deliveredAt, receivedAt: row.receivedAt,
      requestedQuantity: 20, supplierQuantity: 10, receivedQuantity: null, batchId: "1" });
    expect(ordersExportRows(report(), filters, false, now)).toHaveLength(1);
    expect(ordersFilterLabel(filters)).toContain("جاهز للاستلام");
  });
  it("renders the default ready card with distinct quantities and dates without showing other-stage cards", () => {
    const html = renderToStaticMarkup(<OrdersPage />);
    expect(html).toContain("MEDICINE-1");
    for (const id of [2, 3, 4, 5, 6]) expect(html).not.toContain(`MEDICINE-${id}`);
    for (const label of ["الكمية المطلوبة", "الكمية المحددة من المورد", "موافقة المورد:", "تسليم المورد:", "متوسط مدة الاستلام الفعلية", "قيد التوصيل"]) expect(html).toContain(label);
    expect(html).not.toContain("تأكيد استلام الصيدلية:");
  });
});
