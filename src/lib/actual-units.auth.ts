import { isTreasuryManager } from "./treasury-financials.helpers";

export function actualUnitAdminId(context: any, sessionSecret: string | undefined) {
  const user = context?.session?.data;
  if (!isTreasuryManager(context) || user?.user_role !== "admin" || !user?.user_id) {
    throw new Error("توثيق الوحدات يتطلب تسجيل الدخول بحساب مدير؛ جلسة PIN القديمة لا تكفي");
  }
  if (!sessionSecret || sessionSecret.length < 32 || sessionSecret.startsWith("dev-only-")) {
    throw new Error("يجب تهيئة سر جلسات آمن على الخادم قبل اعتماد الوحدات");
  }
  return user.user_id as string;
}

export async function verifyActualUnitAdmin(db: any, context: any, sessionSecret: string | undefined) {
  const id = actualUnitAdminId(context, sessionSecret);
  const { data, error } = await db.from("pharmacy_users").select("id,display_name")
    .eq("id", id).eq("pharmacy_id", context.pharmacy_id).eq("role", "admin").eq("is_active", true).maybeSingle();
  if (error || !data?.id || !data.display_name?.trim()) throw new Error("صلاحية المدير غير متاحة؛ أعد تسجيل الدخول");
  return { db, pharmacyId: context.pharmacy_id, actorId: data.id as string, actor: data.display_name as string };
}
