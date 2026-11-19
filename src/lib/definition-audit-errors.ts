export const auditFailureMessages = {
  budget: "توقف الفحص عند حد الذاكرة الآمن؛ لم يكتمل تقييم البيانات.",
  timeout: "انتهت مهلة إحدى خطوات الفحص؛ لم يكتمل تقييم البيانات.",
  interrupted: "انقطع طلب الفحص قبل اكتماله؛ لم يكتمل تقييم البيانات.",
  query: "تعذرت قراءة أحد مصادر البيانات؛ لم يُعتبر المصدر خاليًا من المشكلات.",
  scope: "تعذر التحقق من عزل بيانات الصيدلية؛ أوقف الفحص.",
  incomplete: "تعذر التأكد من اكتمال البيانات أو ثباتها أثناء الفحص.",
  processing: "تعذر إكمال معالجة التدقيق. راجع الدعم مع مرجع المحاولة.",
} as const;

export type AuditFailureCode = keyof typeof auditFailureMessages;

export function classifyAuditFailure(error: unknown): AuditFailureCode {
  const message = error instanceof Error ? error.message : "";
  if (message === "budget") return "budget";
  if (message === "scope") return "scope";
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  if (error instanceof Error && error.name === "AbortError") return "interrupted";
  if (message === "تعذر تحميل بيانات التقرير كاملة") return "query";
  if (["Missing completeness count", "تغيرت بيانات التقرير أثناء القراءة؛ أعد المحاولة", "بيانات التقرير غير مكتملة",
    "تغير ترتيب بيانات التقرير؛ أعد المحاولة"].includes(message)) return "incomplete";
  return "processing";
}

// Never render arbitrary RPC/network errors: they may contain internal diagnostics.
export function auditRequestErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const publicErrors = ["التدقيق الشامل يتطلب جلسة مدير موثقة", "لا تملك صلاحية تدقيق هذه الصيدلية",
    "يوجد فحص قيد التشغيل لهذه الصيدلية", "تغيرت الجلسة أثناء الفحص"];
  if (publicErrors.includes(message)) return message;
  return "تعذر إكمال طلب التدقيق أو الاتصال بالخادم. لم تُستبدل النتائج المحفوظة. إذا تكرر الخطأ، أرسل وقت المحاولة للدعم.";
}
