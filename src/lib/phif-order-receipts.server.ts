import { readReportPages } from "./report-pages.server";
import { receiptDateInput, receiptRecordSchema, type OrderReceiptState } from "./phif-order-receipts.helpers";
import { ordersReportSchema } from "./phif-orders-snapshot.helpers";

export async function loadOrderReceipts(db: any, pharmacyId: string): Promise<OrderReceiptState> {
  const probe = await db.from("phif_order_receipts").select("id").eq("pharmacy_id", pharmacyId).limit(1);
  if (["42P01", "PGRST205"].includes(probe.error?.code)) return { ready: false, missing: true, rows: [], error: "حفظ تواريخ الاستلام عبر الأجهزة يحتاج تطبيق Migration المعتمد أولًا" };
  if (probe.error) return { ready: false, rows: [], error: "تعذر تحميل تواريخ الاستلام المحفوظة؛ لم تتغير البيانات" };
  try {
    const rows = await readReportPages(() => db.from("phif_order_receipts").select("*", { count: "exact" }).eq("pharmacy_id", pharmacyId).order("id"));
    const parsed = receiptRecordSchema.array().parse(rows);
    if (parsed.some(row => row.pharmacy_id !== pharmacyId)) throw new Error("scope");
    return { ready: true, rows: parsed, error: null };
  } catch { return { ready: false, rows: [], error: "تعذر تحميل جميع تواريخ الاستلام؛ التعديل والتصدير موقوفان حتى اكتمال القراءة" }; }
}

export async function observeOrderReceipts(db: any, pharmacyId: string, actorId: string | undefined, report: unknown) {
  const parsed = ordersReportSchema.parse(report);
  if (!parsed.complete) throw new Error("لا تُسجل تواريخ رصد من قراءة جزئية");
  const state = await loadOrderReceipts(db, pharmacyId);
  if (!state.ready) { if (!state.missing) throw new Error(state.error || "تعذر قراءة سجل الطلبات السابق"); return state; }
  // Legacy PIN retains read access, but may not attribute writes to a fabricated manager.
  if (!actorId) return { ...state, error: "تسجيل الرصد يتطلب حساب مستخدم Tracker موثقًا" };
  const { error } = await db.rpc("observe_phif_order_receipts", { p_pharmacy_id: pharmacyId, p_actor_id: actorId, p_report: parsed });
  if (error) throw new Error("تعذر حفظ سجل رصد الطلبات كاملًا؛ احتُفظ بالنسخة السابقة. أعد التحديث");
  return state;
}

export async function persistOrderReceiptDate(db: any, context: any, input: unknown) {
  const data = receiptDateInput.parse(input), actorId = context.session.data.user_id;
  if (!actorId || context.session.data.user_role !== "admin") throw new Error("توثيق تاريخ الاستلام متاح للمدير المسجل فقط");
  const { data: saved, error } = await db.rpc("set_phif_order_receipt_date", { p_pharmacy_id: context.pharmacy_id,
    p_actor_id: actorId, p_order_id: data.orderId, p_line_id: data.lineId, p_received_on: data.receivedOn, p_expected_version: data.expectedVersion });
  if (error) throw new Error(/Version conflict/i.test(error.message || "") ? "تغير السجل؛ حدّث التواريخ ثم حاول مجددًا"
    : "تعذر حفظ تاريخ الاستلام. تحقق من التاريخ وصلاحية المدير وتطبيق Migration");
  const row = receiptRecordSchema.parse(saved);
  if (row.pharmacy_id !== context.pharmacy_id || row.order_id !== data.orderId || row.line_id !== data.lineId) throw new Error("استجابة حفظ غير متوافقة مع البند");
  return row;
}
