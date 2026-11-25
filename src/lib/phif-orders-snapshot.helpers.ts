import { z } from "zod";

export const ordersLineSchema = z.object({
  id: z.string().regex(/^\d+$/), medicine: z.string().min(1), supplier: z.string().nullable(), batch: z.string().nullable(),
  approval: z.string(), approvedQuantity: z.number().finite().nonnegative().nullable(), quantityMissing: z.boolean(),
  status: z.enum(["waiting", "received", "not_approved", "review"]), approvedAt: z.string().datetime({ offset: true }).nullable(), receivedAt: z.string().datetime().nullable(),
  batchId: z.string().regex(/^\d+$/).nullable().optional(),
  requestedQuantity: z.number().finite().nonnegative().nullable().optional(),
  supplierQuantity: z.number().finite().nonnegative().nullable().optional(),
  receivedQuantity: z.number().finite().nonnegative().nullable().optional(),
  fulfillmentStage: z.enum(["received", "ready", "in_delivery", "not_approved", "review"]).optional(),
  deliveredAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export const ordersReportSchema = z.object({
  orders: z.array(z.object({ id: z.string().regex(/^\d+$/), number: z.string().min(1), createdAt: z.string().datetime().nullable(),
    status: z.string(), detailError: z.string().nullable(), lines: z.array(ordersLineSchema),
  })).max(50000),
  totalOrders: z.number().int().nonnegative(), pages: z.number().int().positive(), excludedZero: z.number().int().nonnegative(),
  complete: z.boolean(), fetchedAt: z.string().datetime(), pharmacy: z.string().min(1),
}).refine(report => report.orders.length === report.totalOrders
  && new Set(report.orders.map(order => order.id)).size === report.orders.length
  && new Set(report.orders.flatMap(order => order.lines.map(line => line.id))).size === report.orders.reduce((sum, order) => sum + order.lines.length, 0)
  && report.complete === report.orders.every(order => !order.detailError));

export const ordersSnapshotSchema = z.object({
  version: z.literal(1), pharmacyId: z.string().min(1).max(100), subject: z.string().min(1).max(300),
  report: ordersReportSchema, signature: z.string().regex(/^[a-f0-9]{64}$/),
}).refine(snapshot => snapshot.report.complete && snapshot.report.orders.every(order => order.lines.every(line => line.approvedQuantity !== 0)));
export type OrdersSnapshot = z.infer<typeof ordersSnapshotSchema>;
export type OrdersStorageAccess = { pharmacyId: string; subject: string; storageKey: string; canExport: boolean; sessionExpiresAt: string | null; sessionCheckFailed?: boolean;
  manualSyncAccess?: import("./phif-tracker-user.server").PhifTrackerAccess };

export function assertOrdersSnapshotReplacement(previous: OrdersSnapshot | null, next: OrdersSnapshot) {
  if (!previous) return;
  if (previous.pharmacyId !== next.pharmacyId || previous.subject !== next.subject) throw new Error("نسخة الطلبيات تخص حسابًا أو صيدلية أخرى");
  if (Date.parse(next.report.fetchedAt) < Date.parse(previous.report.fetchedAt)) throw new Error("وصل تحديث أقدم؛ احتُفظ بالنسخة الأحدث");
  const ids = new Set(next.report.orders.map(order => order.id));
  if (previous.report.orders.some(order => !ids.has(order.id))) throw new Error("التحديث لا يتضمن جميع الطلبات المحفوظة؛ لم تُستبدل النسخة السابقة");
}
