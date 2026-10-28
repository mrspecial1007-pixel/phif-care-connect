const fields = "id,started_at,finished_at,status,total_records,imported_records,error_count,error_message";

export async function readPhifStockOverview(db: any, pharmacyId: string) {
  const latest = await db.from("phif_stock_sync_runs").select(fields).eq("pharmacy_id", pharmacyId)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  const successful = await db.from("phif_stock_sync_runs").select(fields).eq("pharmacy_id", pharmacyId).eq("status", "completed")
    .order("finished_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
  const count = await db.from("phif_stock_items").select("id", { count: "exact", head: true }).eq("pharmacy_id", pharmacyId).eq("is_current", true);
  if (latest.error || successful.error || count.error) throw new Error("تعذر قراءة حالة المخزون وآخر مزامنة ناجحة");
  return { last_run: latest.data ?? null, last_successful_run: successful.data ?? null, current_count: count.count ?? 0 };
}
