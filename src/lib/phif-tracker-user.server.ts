import { hasPermission, adminPermissions, normalizePermissions } from "./user-permissions";

export type PhifTrackerAccess = { ready: boolean; reason: "verified" | "identity_required" | "forbidden" | "unavailable" | "configuration"; message: string | null };
type Context = { pharmacy_id: string; pharmacy_name: string; session: { data: any; update?: (data: any) => Promise<unknown> } };
const secureSession = () => Boolean(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32 && !process.env.SESSION_SECRET.startsWith("dev-only-"));

export async function phifTrackerAccess(db: any, context: Context): Promise<PhifTrackerAccess> {
  if (!secureSession()) return { ready: false, reason: "configuration", message: "يلزم إعداد SESSION_SECRET ثابت وآمن على خادم Tracker قبل توثيق المستخدم" };
  if (context.pharmacy_name !== "صيدلية الترياق الشافي") return { ready: false, reason: "forbidden", message: "هذه الخدمة غير متاحة للصيدلية الحالية" };
  const id = context.session.data.user_id;
  if (!id || !["admin", "employee"].includes(context.session.data.user_role)) return { ready: false, reason: "identity_required", message: "جلسة PIN تتيح العرض؛ المزامنة تحتاج توثيق حساب مستخدم Tracker لهذه الصيدلية" };
  const { data, error } = await db.from("pharmacy_users").select("id,pharmacy_id,is_active,role,permissions")
    .eq("id", id).eq("pharmacy_id", context.pharmacy_id).maybeSingle();
  if (error) return { ready: false, reason: "unavailable", message: "تعذر التحقق من صلاحيات مستخدم Tracker؛ لم تبدأ المزامنة" };
  if (!data || data.id !== id || data.pharmacy_id !== context.pharmacy_id || !data.is_active || !["admin", "employee"].includes(data.role)
    || !hasPermission(data.role, data.permissions, "inventory_read"))
    return { ready: false, reason: "forbidden", message: "حساب Tracker غير نشط أو لا يملك صلاحية المخزون لهذه الصيدلية" };
  return { ready: true, reason: "verified", message: null };
}

export async function requirePhifTrackerUser(db: any, context: Context) {
  const access = await phifTrackerAccess(db, context);
  if (!access.ready) throw new Error(access.message!);
  return context.session.data.user_id as string;
}

/** A shared pharmacy PIN cannot identify a person. Verify an existing scoped account instead. */
export async function confirmPhifTrackerUser(db: any, context: Context, input: { identifier: string; pin: string }, verify: (pin: string, hash: string) => boolean) {
  if (!secureSession() || context.pharmacy_name !== "صيدلية الترياق الشافي") throw new Error("تعذر توثيق الجلسة بأمان؛ راجع إعداد خادم Tracker والصيدلية الحالية");
  const { data, error } = await db.from("pharmacy_users").select("id,pharmacy_id,display_name,password_hash,role,permissions,is_active")
    .eq("pharmacy_id", context.pharmacy_id).eq("login_identifier", input.identifier.trim().toLowerCase()).maybeSingle();
  if (error) throw new Error("تعذر التحقق من حساب Tracker الآن");
  if (!data || data.pharmacy_id !== context.pharmacy_id || !data.is_active || !["admin", "employee"].includes(data.role) || !verify(input.pin, data.password_hash))
    throw new Error("معرّف المستخدم أو PIN غير صحيح لهذه الصيدلية");
  if (!hasPermission(data.role, data.permissions, "inventory_read")) throw new Error("الحساب لا يملك صلاحية المخزون والطلبات");
  await context.session.update!({ ...context.session.data, user_id: data.id, user_name: data.display_name,
    user_role: data.role, user_permissions: data.role === "admin" ? adminPermissions() : normalizePermissions(data.permissions) });
  return { ok: true as const };
}
