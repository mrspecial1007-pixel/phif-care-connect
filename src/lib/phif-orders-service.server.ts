import { setResponseHeader } from "@tanstack/react-start/server";
import { requireTiryaqPermission } from "./user-management.functions";
import { ordersExportAllowed } from "./phif-orders.helpers";
import { ordersStorageIdentity, signOrdersSnapshot, verifyOrdersSnapshot } from "./phif-orders-snapshot.server";
import { readPhifOrders, OrdersSessionExpiredError } from "./phif-orders.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const noStore = () => setResponseHeader("Cache-Control", "no-store, private");

export async function readAuthorizedPhifOrders(data: { export: boolean }) {
  noStore();
  const context = await requireTiryaqPermission("inventory_read");
  const canExport = ordersExportAllowed(context.session.data);
  if (data.export && !canExport) throw new Error("لا تملك صلاحية تصدير التقارير");
  ordersStorageIdentity(context.pharmacy_id, context.session.data.user_id);
  try {
    const report = await readPhifOrders(supabaseAdmin, context.pharmacy_id);
    if (data.export && !report.complete) throw new Error("لا يمكن إصدار كشف كامل قبل نجاح قراءة تفاصيل جميع الطلبات");
    if (!report.complete) return { ok: false as const, reason: "incomplete", error: "تعذر جلب تفاصيل جميع الطلبات؛ احتُفظ بالنسخة السابقة" };
    return { ok: true as const, snapshot: signOrdersSnapshot({ ...report,
      pharmacy: context.session.data.pharmacy_name || "الصيدلية الحالية" }, context.pharmacy_id, context.session.data.user_id) };
  } catch (error) {
    return { ok: false as const, reason: error instanceof OrdersSessionExpiredError ? "session_expired" : "upstream",
      error: error instanceof OrdersSessionExpiredError ? error.message : "تعذر تحديث الطلبيات بالكامل؛ احتُفظ بالنسخة السابقة" };
  }
}

/** Tracker authorization/key delivery only; never creates or contacts a PHIF session. */
export async function readOrdersStorageAccess() {
  noStore();
  const context = await requireTiryaqPermission("inventory_read");
  const identity = ordersStorageIdentity(context.pharmacy_id, context.session.data.user_id);
  const { data, error } = await supabaseAdmin.from("phif_bridge_sessions").select("expires_at")
    .eq("pharmacy_id", context.pharmacy_id).eq("status", "active").gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false }).limit(1).maybeSingle();
  return { ...identity, canExport: ordersExportAllowed(context.session.data), sessionExpiresAt: error ? null : data?.expires_at || null, sessionCheckFailed: Boolean(error) };
}

/** Official exports require current permissions and a signed pharmacy/user-bound snapshot, not PHIF availability. */
export async function exportAuthorizedOrdersSnapshot(input: unknown) {
  noStore();
  const context = await requireTiryaqPermission("inventory_read");
  if (!ordersExportAllowed(context.session.data)) throw new Error("لا تملك صلاحية تصدير التقارير");
  const snapshot = verifyOrdersSnapshot(input, context.pharmacy_id, context.session.data.user_id);
  return { ...snapshot.report, pharmacy: context.session.data.pharmacy_name || snapshot.report.pharmacy,
    canExport: true, dataSource: "saved" as const };
}
