import { ordersReportSchema } from "./phif-orders-snapshot.helpers";
import { manualSyncError } from "./phif-manual-sync.server";

/** The shared report contains no user key or session credentials. Each response is re-signed for its reader. */
export async function loadCloudOrders(db: any, pharmacyId: string) {
  const { data, error } = await db.from("phif_order_snapshots").select("pharmacy_id,report,version,fetched_at")
    .eq("pharmacy_id", pharmacyId).maybeSingle();
  if (error) return { ready: false, report: null, version: 0, error: manualSyncError(error).message };
  if (!data) return { ready: true, report: null, version: 0, error: null };
  const parsed = ordersReportSchema.safeParse(data.report);
  if (data.pharmacy_id !== pharmacyId || !parsed.success || !parsed.data.complete
    || parsed.data.orders.some(o => o.lines.some(l => l.approvedQuantity === 0))
    || !Number.isInteger(data.version) || data.version < 1
    || Date.parse(data.fetched_at) !== Date.parse(parsed.data.fetchedAt))
    return { ready: false, report: null, version: 0, error: "تعذر التحقق من نسخة الطلبيات المركزية؛ لم تُستبدل النسخة السابقة" };
  return { ready: true, report: parsed.data, version: data.version as number, error: null };
}

export async function completeCloudOrders(db: any, pharmacyId: string, actorId: string, op: { id: string; snapshot_version: number }, report: unknown) {
  const parsed = ordersReportSchema.parse(report);
  if (!parsed.complete || parsed.orders.some(o => o.lines.some(l => l.approvedQuantity === 0))) throw new Error("قراءة طلبيات غير مكتملة");
  const { error } = await db.rpc("complete_phif_orders_sync", { p_pharmacy_id: pharmacyId, p_actor_id: actorId,
    p_operation_id: op.id, p_expected_version: op.snapshot_version, p_report: parsed });
  // A network acknowledgement alone is not sufficient: read the committed report back.
  const saved = await loadCloudOrders(db, pharmacyId);
  if (!saved.ready || !saved.report || saved.report.fetchedAt !== parsed.fetchedAt
    || JSON.stringify(saved.report) !== JSON.stringify(parsed)) {
    if (error) throw manualSyncError(error);
    throw new Error("لم يمكن تأكيد النسخة المحفوظة بعد التحديث؛ أعد قراءة Cloud قبل تكرار المزامنة");
  }
  if (error) {
    const outcome = await db.from("phif_manual_sync_operations").select("status").eq("pharmacy_id", pharmacyId)
      .eq("actor_id", actorId).eq("id", op.id).maybeSingle();
    if (outcome.error || outcome.data?.status !== "completed" || saved.version !== op.snapshot_version + 1) throw manualSyncError(error);
  }
  return saved.report;
}
