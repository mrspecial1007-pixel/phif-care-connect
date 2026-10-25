import { hasPermission } from "./user-permissions";

export const ORDER_STATES = {
  waiting: "بانتظار الاستلام",
  received: "تم الاستلام",
  not_approved: "بانتظار موافقة المورد",
  review: "الحالة تحتاج مراجعة",
} as const;
export type OrderState = keyof typeof ORDER_STATES;
export type OrderLine = {
  id: string; medicine: string; batch: string | null; supplier: string | null;
  approval: string; approvedQuantity: number | null; quantityMissing: boolean;
  status: OrderState; approvedAt: null; receivedAt: null;
};
export type PhifOrder = {
  id: string; number: string; createdAt: string | null; status: string;
  detailError: string | null; lines: OrderLine[];
};
export type PhifOrdersReport = {
  orders: PhifOrder[]; totalOrders: number; pages: number; excludedZero: number;
  complete: boolean; fetchedAt: string; pharmacy: string; canExport: boolean;
};
export type OrdersFilters = { status: "all" | OrderState; supplier: string; query: string };
export const defaultOrdersFilters: OrdersFilters = { status: "all", supplier: "all", query: "" };
export const ordersCacheOptions = { gcTime: 30 * 60_000, staleTime: 120_000,
  refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: 300_000,
  refetchIntervalInBackground: false, retry: false } as const;

export function ordersExportAllowed(user: { user_id?: string; user_role?: string; user_permissions?: Record<string, boolean> }) {
  return (!user.user_id && !user.user_role) || hasPermission(user.user_role, user.user_permissions, "reports_export");
}
export function orderAgeDays(createdAt: string | null, now = Date.now()) {
  if (!createdAt) return null;
  const age = now - Date.parse(createdAt);
  return Number.isFinite(age) && age >= 0 ? Math.floor(age / 86400000) : null;
}
export function ordersView(report: PhifOrdersReport, filters: OrdersFilters) {
  const query = filters.query.trim().toLocaleLowerCase();
  const rows = report.orders.flatMap(order => order.lines.map(line => ({ ...line,
    orderId: order.id, orderNumber: order.number, createdAt: order.createdAt,
  }))).filter(line => line.approvedQuantity !== 0
    && (filters.status === "all" || line.status === filters.status)
    && (filters.supplier === "all" || line.supplier === filters.supplier)
    && (!query || `${line.orderNumber} ${line.medicine} ${line.batch || ""}`.toLocaleLowerCase().includes(query)))
    .sort((a, b) => {
      const rank = (s: OrderState) => s === "waiting" ? 0 : s === "not_approved" ? 1 : s === "review" ? 2 : 3;
      return rank(a.status) - rank(b.status)
        || (a.createdAt ? Date.parse(a.createdAt) : Infinity) - (b.createdAt ? Date.parse(b.createdAt) : Infinity)
        || a.orderId.localeCompare(b.orderId, "en", { numeric: true }) || a.id.localeCompare(b.id, "en", { numeric: true });
    });
  return { rows, counts: Object.fromEntries(Object.keys(ORDER_STATES).map(state =>
    [state, rows.filter(row => row.status === state).length])) as Record<OrderState, number> };
}

export function ordersExportRows(report: PhifOrdersReport, filters: OrdersFilters, pendingOnly = false) {
  return ordersView(report, filters).rows.filter(row => !pendingOnly || row.status !== "received").map(row => ({
    orderNumber: row.orderNumber, createdAt: row.createdAt, medicine: row.medicine,
    supplier: row.supplier, batch: row.batch, quantity: row.approvedQuantity,
    status: ORDER_STATES[row.status], ageDays: orderAgeDays(row.createdAt, Date.parse(report.fetchedAt)),
  }));
}
