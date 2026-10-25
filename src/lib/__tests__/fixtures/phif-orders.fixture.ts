import type { PhifOrdersReport } from "../../phif-orders.helpers";

export function ordersFixture(): PhifOrdersReport {
  const line = { id: "60686", medicine: "Allopurinol / TABS / 300MG", batch: "00123", supplier: "شركة المورد",
    approval: "تم القبول", approvedQuantity: 30, quantityMissing: false,
    status: "waiting" as const, approvedAt: null, receivedAt: null };
  return { pharmacy: "صيدلية الترياق الشافي", canExport: true, totalOrders: 2, pages: 1,
    fetchedAt: "2026-10-25T12:00:00.000Z", complete: true, excludedZero: 1, orders: [
      { id: "10326", number: "ORD_242_266_10326", createdAt: "2026-10-13T02:38:20.000Z", status: "تم القبول", detailError: null,
        lines: [line, { ...line, id: "60697", status: "received" },
          { ...line, id: "60687", status: "not_approved", approval: "قيد الاجراء", approvedQuantity: null },
          { ...line, id: "60688", approvedQuantity: null, quantityMissing: true, supplier: "شركة ثانية" }] },
      { id: "6123", number: "ORD_242_266_6123", createdAt: "2026-02-16T20:03:11.000Z", status: "تم القبول", detailError: null,
        lines: [{ ...line, id: "40000", approvedQuantity: 10 }] },
    ] };
}
