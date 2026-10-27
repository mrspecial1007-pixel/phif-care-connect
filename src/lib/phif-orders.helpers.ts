import { hasPermission } from "./user-permissions";
import { confirmedReceiptDate, receiptDateSource, type OrderReceiptRecord } from "./phif-order-receipts.helpers";

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
  status: OrderState; approvedAt: null; receivedAt: string | null; receipt?: OrderReceiptRecord;
};
export type PhifOrder = {
  id: string; number: string; createdAt: string | null; status: string;
  detailError: string | null; lines: OrderLine[];
};
export type PhifOrdersReport = {
  orders: PhifOrder[]; totalOrders: number; pages: number; excludedZero: number;
  complete: boolean; fetchedAt: string; pharmacy: string; canExport: boolean;
};
export const ORDER_TABS = { approved: "الأصناف المعتمدة", not_approved: "بانتظار الموافقة", review: "مراجعة الحالة", orders: "الطلبات" } as const;
export const ORDER_PERIODS = { this_month: "هذا الشهر", previous_month: "الشهر السابق", all: "كل التاريخ", custom: "نطاق مخصص" } as const;
export const ORDER_DATE_BASES = { creation: "تاريخ إنشاء الطلب", receipt: "تاريخ الاستلام المؤكد", observation: "تاريخ أول رصد للاستلام (غير مؤكد)" } as const;
export type OrdersFilters = {
  status: "all" | OrderState; supplier: string; query: string; tab: keyof typeof ORDER_TABS;
  period: keyof typeof ORDER_PERIODS; dateFrom: string; dateTo: string;
  dateBasis?: keyof typeof ORDER_DATE_BASES;
};
export const defaultOrdersFilters: OrdersFilters = {
  status: "all", supplier: "all", query: "", tab: "approved", period: "all", dateFrom: "", dateTo: "",
};
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit",
});
export function orderCreatedDate(value: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? dateFormatter.format(new Date(value)) : null;
}
export function ordersPeriodFilters(period: OrdersFilters["period"], now = Date.now()) {
  if (period === "all" || period === "custom") return { period, dateFrom: "", dateTo: "" };
  const [year, month] = orderCreatedDate(new Date(now).toISOString())!.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - (period === "previous_month" ? 2 : 1), 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return { period, dateFrom: start.toISOString().slice(0, 10), dateTo: end.toISOString().slice(0, 10) };
}
export function ordersPeriodError(filters: OrdersFilters) {
  if (filters.period === "all") return null;
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(filters.dateFrom) || !valid(filters.dateTo)) return "حدّد تاريخ البداية والنهاية بصورة صحيحة";
  return filters.dateFrom > filters.dateTo ? "تاريخ البداية يجب ألا يتجاوز تاريخ النهاية" : null;
}
export function ordersStatisticFilters(statistic: "orders" | OrderState): Partial<OrdersFilters> {
  return statistic === "orders" ? { tab: "orders", status: "all" }
    : statistic === "waiting" || statistic === "received" ? { tab: "approved", status: statistic }
      : { tab: statistic, status: "all" };
}
export const ordersCacheOptions = { gcTime: 30 * 60_000, staleTime: Infinity,
  refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: false,
  refetchIntervalInBackground: false, retry: false } as const;

export function ordersExportAllowed(user: { user_id?: string; user_role?: string; user_permissions?: Record<string, boolean> }) {
  return (!user.user_id && !user.user_role) || hasPermission(user.user_role, user.user_permissions, "reports_export");
}
export function orderAgeDays(createdAt: string | null, now = Date.now()) {
  if (!createdAt) return null;
  const age = now - Date.parse(createdAt);
  return Number.isFinite(age) && age >= 0 ? Math.floor(age / 86400000) : null;
}
export function orderDuration(row: Pick<OrderLine, "status" | "receivedAt" | "receipt"> & { createdAt: string | null }, now = Date.now()) {
  if (row.status === "received") {
    const actual = confirmedReceiptDate(row);
    if (!actual) return { days: null, label: "تم الاستلام — تاريخ الاستلام غير متوفر" };
    const received = Date.parse(actual), createdDay = orderCreatedDate(row.createdAt), today = orderCreatedDate(new Date(now).toISOString())!;
    const days = row.receipt?.confirmed_received_on
      ? createdDay && actual >= createdDay && actual <= today && new Date(received).toISOString().slice(0,10) === actual
        ? (received - Date.parse(createdDay)) / 86400000 : null
      : Number.isFinite(received) && received <= now ? orderAgeDays(row.createdAt, received) : null;
    return { days, label: days == null ? "تم الاستلام — تعذر تحديد المدة من تواريخ الإنشاء والاستلام"
      : `مدة من إنشاء الطلب حتى الاستلام: ${days} يومًا` };
  }
  const days = orderAgeDays(row.createdAt, now);
  return { days, label: days == null ? "مدة منذ إنشاء الطلب غير متوفرة" : `مدة منذ إنشاء الطلب: ${days} يومًا` };
}
export function ordersView(report: PhifOrdersReport, filters: OrdersFilters, now = Date.now()) {
  const query = filters.query.trim().toLocaleLowerCase();
  const periodError = ordersPeriodError(filters);
  const matchesLine = (line: OrderLine, order: PhifOrder) => line.approvedQuantity !== 0
    && (filters.supplier === "all" || line.supplier === filters.supplier)
    && (!query || `${order.number} ${line.medicine} ${line.batch || ""}`.toLocaleLowerCase().includes(query));
  const basis = filters.dateBasis || "creation";
  const lineDate = (line: OrderLine, order: PhifOrder) => basis === "creation" ? orderCreatedDate(order.createdAt)
    : line.status !== "received" ? null : basis === "receipt" ? orderCreatedDate(confirmedReceiptDate(line))
      : orderCreatedDate(line.receipt?.first_received_observed_at || null);
  const inPeriod = (order: PhifOrder, line?: OrderLine) => {
    if (periodError) return false;
    if (filters.period === "all") return true;
    const date = line ? lineDate(line, order) : orderCreatedDate(order.createdAt);
    return date != null && date >= filters.dateFrom && date <= filters.dateTo;
  };
  const matchesOrder = (order: PhifOrder) => order.lines.some(line => matchesLine(line, order))
    || (filters.supplier === "all" && (!query || order.number.toLocaleLowerCase().includes(query)));
  const orders = report.orders.filter(order => matchesOrder(order) && (basis === "creation" ? inPeriod(order)
    : order.lines.some(line => matchesLine(line, order) && inPeriod(order, line) && lineDate(line, order) != null)))
    .sort((a, b) => (a.createdAt ? Date.parse(a.createdAt) : Infinity) - (b.createdAt ? Date.parse(b.createdAt) : Infinity)
      || a.id.localeCompare(b.id, "en", { numeric: true }));
  // Statistics use the date/search/supplier scope, not the selected statistic or tab.
  const scopedRows = orders.flatMap(order => order.lines.filter(line => matchesLine(line, order)
    && (basis === "creation" || (lineDate(line, order) != null && inPeriod(order, line)))).map(line => ({ ...line,
    orderId: order.id, orderNumber: order.number, createdAt: order.createdAt,
  })));
  const rows = scopedRows.filter(line => filters.tab === "orders"
    || (filters.tab === "approved" ? (line.status === "waiting" || line.status === "received")
      && (filters.status === "all" || line.status === filters.status) : line.status === filters.tab))
    .map(row => ({ ...row, duration: orderDuration(row, now) }))
    .sort((a, b) => {
      const rank = (s: OrderState) => s === "waiting" ? 0 : s === "not_approved" ? 1 : s === "review" ? 2 : 3;
      return rank(a.status) - rank(b.status)
        || (a.createdAt ? Date.parse(a.createdAt) : Infinity) - (b.createdAt ? Date.parse(b.createdAt) : Infinity)
        || a.orderId.localeCompare(b.orderId, "en", { numeric: true }) || a.id.localeCompare(b.id, "en", { numeric: true });
    });
  const countsFor = (lines: OrderLine[]) => Object.fromEntries(Object.keys(ORDER_STATES).map(state =>
    [state, lines.filter(line => line.status === state).length])) as Record<OrderState, number>;
  return { rows, orders: orders.map(order => ({ ...order,
      counts: countsFor(scopedRows.filter(line => line.orderId === order.id)) })), orderCount: orders.length, periodError,
    undatedOrders: report.orders.filter(order => !orderCreatedDate(order.createdAt) && matchesOrder(order)).length,
    counts: countsFor(scopedRows) };
}

export function ordersExportRows(report: PhifOrdersReport, filters: OrdersFilters, pendingOnly = false, now = Date.now()) {
  return ordersView(report, filters, now).rows.filter(row => !pendingOnly || row.status !== "received").map(row => ({
    orderNumber: row.orderNumber, createdAt: row.createdAt, medicine: row.medicine,
    supplier: row.supplier, batch: row.batch, quantity: row.approvedQuantity,
    status: ORDER_STATES[row.status], ageDays: row.duration.days, durationLabel: row.duration.label,
    receivedAt: row.status === "received" ? confirmedReceiptDate(row) : null,
    receiptSource: row.status === "received" ? receiptDateSource(row) : "غير مستلم",
    firstObservedAt: row.receipt?.first_received_observed_at || null,
  }));
}
