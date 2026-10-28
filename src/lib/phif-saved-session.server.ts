/** Saved login availability for manual sync controls, not a live PHIF connection check. */
export async function readSavedPhifSession(db: any, pharmacyId: string): Promise<{ expires_at: string } | null> {
  const { data, error } = await db.from("phif_bridge_sessions")
    .select("expires_at")
    .eq("pharmacy_id", pharmacyId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("تعذر قراءة جلسة PHIF المحفوظة");
  return data?.expires_at ? { expires_at: data.expires_at } : null;
}
