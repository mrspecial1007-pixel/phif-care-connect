import type { PhifOrdersReport } from "./phif-orders.helpers";
import { z } from "zod";
import { requestPhifBridgeRead, PhifBridgeRequestError } from "./phif-bridge-request.server";

const sourceReport = z.object({
  orders: z.array(z.object({
    id: z.string().regex(/^\d+$/), number: z.string().min(1), createdAt: z.string().datetime().nullable(),
    status: z.string(), detailError: z.string().nullable(), lines: z.array(z.object({
      id: z.string().regex(/^\d+$/), medicine: z.string().min(1), supplier: z.string().nullable(), batch: z.string().nullable(),
      approval: z.string(), approvedQuantity: z.number().finite().nonnegative().nullable(), quantityMissing: z.boolean(),
      status: z.enum(["waiting", "received", "not_approved", "review"]), approvedAt: z.null(), receivedAt: z.string().datetime().nullable(),
    })),
  })),
  totalOrders: z.number().int().nonnegative(), pages: z.number().int().positive(),
  excludedZero: z.number().int().nonnegative(), complete: z.boolean(), fetchedAt: z.string().datetime(),
}).refine(value => value.orders.length === value.totalOrders
  && new Set(value.orders.map(o => o.id)).size === value.orders.length
  && value.complete === value.orders.every(o => !o.detailError));

export class OrdersSessionExpiredError extends Error {
  constructor(message: string, public reason: "session_expired" | "bridge_session_missing" = "session_expired") { super(message); }
}

/** Reads an existing session only: no creation, expiry writes, sync or receipt actions. */
export async function readPhifOrders(db: any, pharmacyId: string, fetchImpl = fetch, sessionRecordId?: string): Promise<Omit<PhifOrdersReport, "pharmacy" | "canExport">> {
  let query = db.from("phif_bridge_sessions")
    .select("bridge_session_id,expires_at").eq("pharmacy_id", pharmacyId)
    .eq("status", "active").gt("expires_at", new Date().toISOString());
  if (sessionRecordId) query = query.eq("id", sessionRecordId);
  const { data, error } = await query
    .order("expires_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("تعذر قراءة جلسة PHIF للصيدلية الحالية");
  if (!data?.bridge_session_id || !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now())
    throw new OrdersSessionExpiredError("انتهت جلسة PHIF، البيانات المعروضة من آخر مزامنة");
  let payload: any;
  try {
    payload = await requestPhifBridgeRead("orders", pharmacyId, data.bridge_session_id, fetchImpl);
  } catch (error) {
    if (error instanceof PhifBridgeRequestError && ["BRIDGE_SESSION_MISSING", "PHIF_AUTH_REQUIRED"].includes(error.code))
      throw new OrdersSessionExpiredError(error.message, error.code === "BRIDGE_SESSION_MISSING" ? "bridge_session_missing" : "session_expired");
    throw error;
  }
  const parsed = sourceReport.safeParse(payload);
  if (!parsed.success) throw new Error("استجابة طلبيات PHIF غير مكتملة");
  payload = parsed.data;
  // Never return arbitrary upstream fields, action links, source IDs or session details.
  return {
    orders: payload.orders.map((order: any) => ({ id: String(order.id), number: String(order.number),
      createdAt: order.createdAt ?? null, status: String(order.status ?? ""),
      detailError: order.detailError ? "تعذر قراءة تفاصيل الطلب" : null,
      lines: (order.lines || []).map((line: any) => ({ id: String(line.id), medicine: String(line.medicine),
        supplier: line.supplier ?? null, batch: line.batch ?? null, approval: String(line.approval ?? ""),
        approvedQuantity: line.approvedQuantity ?? null, quantityMissing: line.quantityMissing === true,
        status: line.status, approvedAt: null, receivedAt: line.receivedAt })),
    })),
    totalOrders: payload.totalOrders, pages: payload.pages, excludedZero: payload.excludedZero,
    // This is the Tracker read timestamp, not an approval/receipt date from PHIF.
    complete: payload.complete, fetchedAt: new Date().toISOString(),
  };
}
