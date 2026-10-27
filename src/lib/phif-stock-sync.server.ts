import { beginManualSync, failManualSync, manualSyncError, readManualBridgeSession } from "./phif-manual-sync.server";

/** Called only by the stock-sync POST. All snapshot writes and completion are one DB transaction. */
export async function runManualStockSync(db: any, pharmacyId: string, actorId: string | undefined,
  read: (sessionId: string) => Promise<any>, normalize: (payload: unknown) => any[]) {
  const bridge = await readManualBridgeSession(db, pharmacyId);
  const op = await beginManualSync(db, pharmacyId, actorId, "stock", bridge.id);
  try {
    const payload = await read(bridge.bridge_session_id);
    if (payload?.ok !== true || !Array.isArray(payload.rows) || !Number.isInteger(payload.raw_count)
      || payload.raw_count !== payload.rows.length) throw new Error("استجابة مخزون غير مكتملة؛ لم يُستبدل المخزون المحفوظ");
    const rows = normalize({ data: payload.rows });
    if (rows.length !== payload.rows.length || new Set(rows.map(row => row.source_stock_id)).size !== rows.length)
      throw new Error("تعذر التحقق من جميع هويات المخزون؛ لم تتغير النسخة السابقة");
    const { data, error } = await db.rpc("replace_phif_stock_snapshots", { p_pharmacy_id: pharmacyId, p_sync_run_id: op.id, p_items: rows });
    const saved = await db.from("phif_stock_sync_runs").select("status,imported_records,total_records")
      .eq("pharmacy_id", pharmacyId).eq("id", op.id).single();
    if (saved.error || saved.data?.status !== "completed" || (!error && saved.data.imported_records !== Number(data))
      || !Number.isInteger(saved.data.imported_records) || saved.data.total_records !== rows.length) {
      if (error) throw manualSyncError(error);
      throw new Error("لم يمكن تأكيد نتيجة المزامنة المحفوظة؛ راجع آخر تشغيل قبل إعادة المحاولة");
    }
    return { ok: true, total_records: rows.length, imported_records: saved.data.imported_records, parsed_records: rows.length };
  } catch (error) {
    await failManualSync(db, pharmacyId, actorId!, op.id);
    throw error;
  }
}
