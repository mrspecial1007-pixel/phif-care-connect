import { z } from "zod";
import type { PhifOrdersReport } from "./phif-orders.helpers";

export const receiptRecordSchema = z.object({
  id: z.string().uuid(), pharmacy_id: z.string(), order_id: z.string().regex(/^\d+$/), line_id: z.string().regex(/^\d+$/),
  order_number: z.string(), order_created_at: z.string().nullable(), medicine: z.string(), batch: z.string().nullable(),
  status: z.enum(["waiting", "received", "not_approved", "review"]),
  first_received_observed_at: z.string().nullable(), confirmed_received_on: z.string().nullable(),
  confirmed_by: z.string().nullable(), confirmed_at: z.string().nullable(), version: z.number().int().positive(),
});
export type OrderReceiptRecord = z.infer<typeof receiptRecordSchema>;
export type OrderReceiptState = { ready: boolean; rows: OrderReceiptRecord[]; error: string | null; missing?: boolean };
export const receiptDateInput = z.object({ orderId: z.string().regex(/^\d+$/), lineId: z.string().regex(/^\d+$/),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), expectedVersion: z.number().int().positive() });

export function attachOrderReceipts(report: PhifOrdersReport, rows: OrderReceiptRecord[]): PhifOrdersReport {
  const index = new Map(rows.map(row => [`${row.order_id}:${row.line_id}`, row]));
  return { ...report, orders: report.orders.map(order => ({ ...order, lines: order.lines.map(line => {
    const receipt = index.get(`${order.id}:${line.id}`);
    return { ...line, receipt: receipt && receipt.order_number === order.number && receipt.medicine === line.medicine
      && receipt.batch === line.batch ? receipt : undefined };
  }) })) };
}

export function confirmedReceiptDate(line: { receivedAt: string | null; receipt?: OrderReceiptRecord }) {
  return line.receipt?.confirmed_received_on || line.receivedAt;
}
export function receiptDateSource(line: { receivedAt: string | null; receipt?: OrderReceiptRecord }) {
  return line.receipt?.confirmed_received_on ? "مؤكد يدويًا" : line.receivedAt ? "تاريخ فعلي من PHIF" : "غير متوفر";
}
