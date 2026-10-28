import { setResponseHeader } from "@tanstack/react-start/server";
import { requireTiryaqPermission } from "./user-management.functions";
import { ordersExportAllowed } from "./phif-orders.helpers";
import { ordersStorageIdentity, signOrdersSnapshot, verifyOrdersSnapshot } from "./phif-orders-snapshot.server";
import { readPhifOrders, OrdersSessionExpiredError } from "./phif-orders.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadOrderReceipts, persistOrderReceiptDate } from "./phif-order-receipts.server";
import { attachOrderReceipts } from "./phif-order-receipts.helpers";
import { loadCloudOrders, completeCloudOrders } from "./phif-orders-cloud.server";
import { beginManualSync, failManualSync, readManualBridgeSession } from "./phif-manual-sync.server";
import { assertOrdersSnapshotReplacement } from "./phif-orders-snapshot.helpers";
import { phifTrackerAccess, requirePhifTrackerUser } from "./phif-tracker-user.server";

const noStore = () => setResponseHeader("Cache-Control", "no-store, private");

export async function readAuthorizedPhifOrders(data: { export: boolean; previous?: unknown }) {
  noStore();
  const context = await requireTiryaqPermission("inventory_read");
  const canExport = ordersExportAllowed(context.session.data);
  if (data.export && !canExport) throw new Error("لا تملك صلاحية تصدير التقارير");
  ordersStorageIdentity(context.pharmacy_id, context.session.data.user_id);
  const previous = data.previous ? verifyOrdersSnapshot(data.previous, context.pharmacy_id, context.session.data.user_id) : null;
  let operation: Awaited<ReturnType<typeof beginManualSync>> | undefined;
  try {
    const actorId = await requirePhifTrackerUser(supabaseAdmin, context);
    const bridge = await readManualBridgeSession(supabaseAdmin, context.pharmacy_id);
    operation = await beginManualSync(supabaseAdmin, context.pharmacy_id, actorId, "orders", bridge.id);
    const report = await readPhifOrders(supabaseAdmin, context.pharmacy_id, fetch, bridge.id);
    if (data.export && !report.complete) throw new Error("لا يمكن إصدار كشف كامل قبل نجاح قراءة تفاصيل جميع الطلبات");
    if (!report.complete) throw new Error("تعذر جلب تفاصيل جميع الطلبات؛ احتُفظ بالنسخة السابقة");
    assertOrdersSnapshotReplacement(previous, signOrdersSnapshot({ ...report, pharmacy: context.session.data.pharmacy_name || "الصيدلية الحالية" },
      context.pharmacy_id, context.session.data.user_id));
    const saved = await completeCloudOrders(supabaseAdmin, context.pharmacy_id, context.session.data.user_id!, operation,
      { ...report, pharmacy: context.session.data.pharmacy_name || "الصيدلية الحالية" });
    return { ok: true as const, snapshot: signOrdersSnapshot(saved, context.pharmacy_id, context.session.data.user_id) };
  } catch (error) {
    if (operation) {
      try { await failManualSync(supabaseAdmin, context.pharmacy_id, context.session.data.user_id!, operation.id); }
      catch (closing) { return { ok: false as const, reason: "upstream", error: (closing as Error).message }; }
    }
    return { ok: false as const, reason: error instanceof OrdersSessionExpiredError ? error.reason : "upstream",
      error: error instanceof Error ? error.message : "تعذر تحديث الطلبيات بالكامل؛ احتُفظ بالنسخة السابقة" };
  }
}

/** Tracker authorization/key delivery only; never creates or contacts a PHIF session. */
export async function readOrdersStorageAccess() {
  noStore();
  const context = await requireTiryaqPermission("inventory_read");
  const identity = ordersStorageIdentity(context.pharmacy_id, context.session.data.user_id);
  const manualSyncAccess = await phifTrackerAccess(supabaseAdmin, context);
  if (context.session.data.user_id && !manualSyncAccess.ready) throw new Error(manualSyncAccess.reason === "forbidden" ? "Forbidden: لا تملك صلاحية قراءة الطلبيات" : manualSyncAccess.message!);
  const { data, error } = await supabaseAdmin.from("phif_bridge_sessions").select("expires_at")
    .eq("pharmacy_id", context.pharmacy_id).eq("status", "active").gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false }).limit(1).maybeSingle();
  const receipts = await loadOrderReceipts(supabaseAdmin, context.pharmacy_id);
  const cloud = await loadCloudOrders(supabaseAdmin, context.pharmacy_id);
  if (receipts.ready && !context.session.data.user_id) receipts.error = "التواريخ المحفوظة متاحة للقراءة؛ تسجيل الرصد وتوثيق التاريخ يتطلب حساب مستخدم Tracker موثقًا";
  return { ...identity, receipts, manualSyncAccess, cloudReady: cloud.ready, cloudError: cloud.error,
    cloudSnapshot: cloud.report ? signOrdersSnapshot(cloud.report, context.pharmacy_id, context.session.data.user_id) : null,
    canManageReceipts: Boolean(context.session.data.user_id && context.session.data.user_role === "admin"),
    canExport: ordersExportAllowed(context.session.data), sessionExpiresAt: error ? null : data?.expires_at || null, sessionCheckFailed: Boolean(error) };
}

/** Official exports require current permissions and a signed pharmacy/user-bound snapshot, not PHIF availability. */
export async function exportAuthorizedOrdersSnapshot(input: unknown) {
  noStore();
  const context = await requireTiryaqPermission("inventory_read");
  if (!ordersExportAllowed(context.session.data)) throw new Error("لا تملك صلاحية تصدير التقارير");
  if (context.session.data.user_id) await requirePhifTrackerUser(supabaseAdmin, context);
  const snapshot = verifyOrdersSnapshot(input, context.pharmacy_id, context.session.data.user_id);
  const receipts = await loadOrderReceipts(supabaseAdmin, context.pharmacy_id);
  if (!receipts.ready && !receipts.missing) throw new Error(receipts.error || "تعذر قراءة تواريخ الاستلام المعتمدة للتصدير");
  return { ...attachOrderReceipts({ ...snapshot.report, canExport: true }, receipts.rows),
    pharmacy: context.session.data.pharmacy_name || snapshot.report.pharmacy, canExport: true, dataSource: "saved" as const };
}

export async function saveAuthorizedOrderReceiptDate(input: unknown) {
  noStore();
  const context = await requireTiryaqPermission("inventory_read");
  return persistOrderReceiptDate(supabaseAdmin, context, input);
}
