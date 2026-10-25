import { createHmac, timingSafeEqual } from "node:crypto";
import { ordersReportSchema, ordersSnapshotSchema, type OrdersSnapshot } from "./phif-orders-snapshot.helpers";

function secretValue(secret = process.env.SESSION_SECRET) {
  if (!secret || secret.length < 32 || secret.startsWith("dev-only-"))
    throw new Error("حفظ نسخة الطلبيات الآمنة يتطلب إعداد SESSION_SECRET ثابت وآمن على خادم Tracker");
  return secret;
}
const subjectFor = (pharmacyId: string, userId?: string) => JSON.stringify([pharmacyId, userId || "legacy-pin"]);
export function ordersStorageIdentity(pharmacyId: string, userId?: string, secret?: string) {
  const subject = subjectFor(pharmacyId, userId);
  const storageKey = createHmac("sha256", secretValue(secret)).update(`phif-orders-encryption-v1:${subject}`).digest("hex");
  return { pharmacyId, subject, storageKey };
}
function signature(snapshot: Omit<OrdersSnapshot, "signature">, secret?: string) {
  return createHmac("sha256", secretValue(secret)).update("phif-orders-snapshot-v1:").update(JSON.stringify(snapshot)).digest("hex");
}
export function signOrdersSnapshot(report: unknown, pharmacyId: string, userId?: string, secret?: string): OrdersSnapshot {
  const snapshot = { version: 1 as const, pharmacyId, subject: subjectFor(pharmacyId, userId), report: ordersReportSchema.parse(report) };
  return ordersSnapshotSchema.parse({ ...snapshot, signature: signature(snapshot, secret) });
}
export function verifyOrdersSnapshot(input: unknown, pharmacyId: string, userId?: string, secret?: string) {
  const parsed = ordersSnapshotSchema.safeParse(input);
  if (!parsed.success) throw new Error("نسخة الطلبيات غير مكتملة أو غير صالحة");
  const { signature: actual, ...snapshot } = parsed.data;
  const expected = signature(snapshot, secret);
  if (snapshot.pharmacyId !== pharmacyId || snapshot.subject !== subjectFor(pharmacyId, userId)
    || !timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex")))
    throw new Error("تعذر التحقق من نسخة الطلبيات وصلاحيتها للصيدلية والمستخدم الحاليين");
  return parsed.data;
}
