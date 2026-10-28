const LOCAL = "http://127.0.0.1:5174";
const PUBLIC = "https://phif-bridge.altiryaq-pharma.com";
export const PHIF_MANUAL_READ_TIMEOUT_MS = 120000;

export class PhifBridgeRequestError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "PhifBridgeRequestError"; }
}
export function phifBridgeOrigin() {
  const value = process.env.PHIF_BRIDGE_BASE_URL?.trim() || process.env.PHIF_BRIDGE_PUBLIC_BASE_URL?.trim()
    || (process.env.NODE_ENV === "production" ? PUBLIC : LOCAL);
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !["http:", "https:"].includes(url.protocol))
    throw new PhifBridgeRequestError("BRIDGE_CONFIGURATION", "عنوان PHIF Bridge غير صالح على خادم Tracker");
  return url.toString().replace(/\/+$/, "");
}

/** Manual reads only. Never retries, follows redirects or logs session IDs, headers or bodies. */
export async function requestPhifBridgeRead(kind: "orders" | "stock", pharmacyId: string, sessionId: string, fetchImpl = fetch) {
  const secret = process.env.PHIF_BRIDGE_SECRET?.trim();
  if (!secret) throw new PhifBridgeRequestError("BRIDGE_CONFIGURATION", "إعداد سر PHIF Bridge غير متاح على خادم Tracker");
  const base = phifBridgeOrigin(), started = Date.now();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), PHIF_MANUAL_READ_TIMEOUT_MS);
  let status: number | undefined;
  try {
    const response = await fetchImpl(`${base}/api/bridge-sessions/${encodeURIComponent(sessionId)}/${kind}`, {
      method: "GET", headers: { "X-PHIF-Bridge-Secret": secret, "X-Pharmacy-Id": pharmacyId },
      signal: controller.signal, redirect: "manual", cache: "no-store",
    });
    status = response.status;
    // Workers rejects redirect: "error" before sending. Manual mode keeps credentials on this origin.
    if (response.status >= 300 && response.status < 400)
      throw new PhifBridgeRequestError("BRIDGE_REDIRECT", "أعاد عنوان PHIF Bridge توجيه الطلب؛ لم يُتبع التحويل حفاظًا على بيانات الاتصال. راجع عنوان الخدمة");
    const payload = await response.json().catch(() => { throw new PhifBridgeRequestError("BRIDGE_RESPONSE", "استجابة PHIF Bridge ليست بيانات صالحة؛ احتُفظ بالنسخة السابقة"); });
    if (response.status === 401 || response.status === 403)
      throw new PhifBridgeRequestError("BRIDGE_AUTHORIZATION", "رفض Bridge صلاحية الاتصال؛ راجع توافق السر وإعداد الصيدلية بين النطاقين");
    if (response.status === 404) throw new PhifBridgeRequestError(/session/i.test(payload?.error || "") ? "BRIDGE_SESSION_MISSING" : "BRIDGE_VERSION",
      /session/i.test(payload?.error || "") ? "جلسة Bridge غير موجودة أو لا تخص الصيدلية؛ أعد تسجيل الدخول إلى PHIF عند المزامنة اليدوية" : "مسار القراءة غير متاح؛ إصدار Bridge غير متوافق مع التطبيق");
    if (response.status === 409) throw new PhifBridgeRequestError("BRIDGE_BUSY", "يوجد طلب قراءة PHIF قيد التشغيل؛ لا تكرر الطلب الآن");
    if (payload?.authRequired === true || payload?.auth_required === true)
      throw new PhifBridgeRequestError("PHIF_AUTH_REQUIRED", "أفادت قراءة PHIF اليدوية بضرورة تسجيل الدخول؛ البيانات المحفوظة لم تتغير");
    if (!response.ok || payload?.ok !== true) throw new PhifBridgeRequestError(
      payload?.code === "PHIF_UPSTREAM_TIMEOUT" ? "PHIF_UPSTREAM_TIMEOUT" : "BRIDGE_UPSTREAM",
      payload?.code === "PHIF_UPSTREAM_TIMEOUT" ? "انتهت مهلة القراءة من PHIF داخل Bridge؛ احتُفظ بالنسخة السابقة" : "وصل الطلب إلى Bridge لكن قراءة PHIF لم تكتمل؛ احتُفظ بالنسخة السابقة");
    return payload;
  } catch (error: any) {
    const failure = controller.signal.aborted ? new PhifBridgeRequestError("BRIDGE_TIMEOUT", "انتهت مهلة اتصال Tracker بـBridge؛ لا تكرر الطلب قبل انتهاء العملية الحالية")
      : error instanceof PhifBridgeRequestError ? error : new PhifBridgeRequestError("BRIDGE_NETWORK", "تعذر وصول خادم Tracker إلى Bridge؛ راجع عنوان الخدمة والاتصال، وليس جلسة PHIF فقط");
    console.warn("[phif-bridge-read]", { kind, code: failure.code, httpStatus: status ?? null, elapsedMs: Date.now() - started,
      stage: status === undefined ? "request" : "response", exceptionName: ["TypeError", "AbortError", "TimeoutError"].includes(error?.name) ? error.name : null,
      origin: new URL(base).origin, transportCode: ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ERR_HTTP2_ERROR", "UND_ERR_CONNECT_TIMEOUT"].includes(error?.cause?.code) ? error.cause.code : null });
    throw failure;
  } finally { clearTimeout(timer); }
}
