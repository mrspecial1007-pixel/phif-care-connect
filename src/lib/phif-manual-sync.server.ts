import { z } from "zod";

const operation = z.object({ id: z.string().uuid(), snapshot_version: z.number().int().nonnegative(), expires_at: z.string() });
export function manualSyncError(error: any) {
  const message = String(error?.message || "");
  if (["42883", "PGRST202", "42P01", "PGRST205"].includes(error?.code))
    return new Error("يلزم تطبيق Migration التخزين المركزي والمزامنة اليدوية بعد الموافقة، قبل التحديث");
  if (/PHIF_LEGACY_PENDING/.test(message)) return new Error("توجد مزامنة مخزون قديمة معلّقة تحتاج مراجعة محددة؛ لم تُحذف البيانات ولم تُصفّر الحالة");
  if (/PHIF_SYNC_BUSY|23505/.test(message) || error?.code === "23505") return new Error("توجد مزامنة PHIF قيد التشغيل لهذه الصيدلية. انتظر اكتمالها");
  if (/PHIF_SYNC_COOLDOWN/.test(message)) return new Error("انتظر عشر ثوانٍ قبل إعادة طلب المزامنة");
  if (/Version conflict|LEASE_EXPIRED|Stale/.test(message)) return new Error("انتهت صلاحية العملية أو تغيرت النسخة المحفوظة؛ لم تُستبدل البيانات السابقة");
  return new Error("تعذر إتمام المزامنة بأمان؛ احتُفظ بالنسخة السابقة. تحقق من حساب المستخدم والاتصال");
}

/** Only explicit manual handlers call this. The DB lease also serializes different app domains. */
export async function beginManualSync(db: any, pharmacyId: string, actorId: string | undefined, kind: "orders" | "stock", sessionRecordId: string) {
  if (!actorId) throw new Error("المزامنة تتطلب حساب مستخدم Tracker موثقًا؛ العرض المحفوظ يبقى متاحًا");
  const { data, error } = await db.rpc("begin_phif_manual_sync", { p_pharmacy_id: pharmacyId, p_actor_id: actorId,
    p_kind: kind, p_session_record_id: sessionRecordId });
  if (error) throw manualSyncError(error);
  return operation.parse(data);
}

export async function failManualSync(db: any, pharmacyId: string, actorId: string, operationId: string) {
  const { data, error } = await db.rpc("fail_phif_manual_sync", { p_pharmacy_id: pharmacyId, p_actor_id: actorId, p_operation_id: operationId });
  if (error) throw new Error("لم يمكن تأكيد إغلاق العملية. لا تكررها الآن؛ يمنع قفل المزامنة أي كتابة متأخرة");
  return data as "completed" | "failed";
}

export async function readManualBridgeSession(db: any, pharmacyId: string) {
  const { data, error } = await db.from("phif_bridge_sessions").select("id,bridge_session_id,expires_at")
    .eq("pharmacy_id", pharmacyId).eq("status", "active").gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("تعذر قراءة جلسة PHIF للصيدلية الحالية");
  if (!data?.id || !data.bridge_session_id || !(Date.parse(data.expires_at) > Date.now()))
    throw new Error("لا توجد جلسة PHIF محفوظة سارية؛ سجّل الدخول أولًا");
  return data as { id: string; bridge_session_id: string; expires_at: string };
}
