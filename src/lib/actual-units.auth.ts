import { isTreasuryManager } from "./treasury-financials.helpers";

export class ActualUnitAccessError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export function actualUnitAdminId(context: any, sessionSecret: string | undefined) {
  const user = context?.session?.data;
  if (!isTreasuryManager(context) || user?.user_role !== "admin" || !user?.user_id) {
    throw new ActualUnitAccessError("registered_admin_required", "توثيق الوحدات يتطلب حساب مدير شخصي فعّال في إدارة الموظفين. بريد دخول الصيدلية وحده لا يثبت هذا الحساب؛ أنشئ أول مدير من إدارة الموظفين ثم سجّل الدخول بحسابه.");
  }
  if (!sessionSecret || sessionSecret.length < 32 || sessionSecret.startsWith("dev-only-")) {
    throw new ActualUnitAccessError("session_secret_required", "يجب تهيئة سر جلسات آمن SESSION_SECRET على الخادم ثم إعادة تسجيل الدخول قبل اعتماد الوحدات");
  }
  return user.user_id as string;
}

export async function verifyActualUnitAdmin(db: any, context: any, sessionSecret: string | undefined) {
  const id = actualUnitAdminId(context, sessionSecret);
  const { data, error } = await db.from("pharmacy_users").select("id,display_name")
    .eq("id", id).eq("pharmacy_id", context.pharmacy_id).eq("role", "admin").eq("is_active", true).maybeSingle();
  if (error || !data?.id || !data.display_name?.trim()) throw new ActualUnitAccessError("admin_verification_failed", "صلاحية المدير غير متاحة؛ أعد تسجيل الدخول وتحقق من تفعيل حسابك في إدارة الموظفين");
  return { db, pharmacyId: context.pharmacy_id, actorId: data.id as string, actor: data.display_name as string };
}

export async function actualUnitAccess(db: any, context: any, secret: string | undefined) {
  try {
    const manager = await verifyActualUnitAdmin(db, context, secret);
    return { allowed: true, subject: manager.actorId, code: "ready", message: "حساب المدير موثّق؛ اعتماد الوحدات متاح", version: "unit-price-review-v1" };
  } catch (error) {
    if (!(error instanceof ActualUnitAccessError)) throw error;
    return { allowed: false, code: error.code, message: error.message, version: "unit-price-review-v1" };
  }
}
