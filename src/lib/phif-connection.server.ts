import type { PhifConnectionStatus } from "./phif-connection.helpers";

/** DB metadata only. No Bridge/PHIF call, cookie refresh, session mutation or background verification. */
export async function readPhifConnectionStatus(db: any, pharmacyId: string): Promise<PhifConnectionStatus> {
  const result = (reason: PhifConnectionStatus["reason"], expiresAt: string | null = null, checkedAt = new Date().toISOString(), sessionAvailable = false): PhifConnectionStatus => ({
    authenticated: reason === "available", reason, expiresAt, checkedAt, sessionAvailable,
  });
  const secret = process.env.PHIF_BRIDGE_SECRET?.trim();
  if (!secret) return result("not_configured");
  const { data, error } = await db.from("phif_bridge_sessions").select("id,expires_at")
    .eq("pharmacy_id", pharmacyId).eq("status", "active").gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return result("unreachable");
  if (!data?.id) return result("no_session");
  const expiry = Date.parse(data.expires_at);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) return result("expired");
  const observed = await db.from("phif_manual_sync_operations").select("status,finished_at")
    .eq("pharmacy_id", pharmacyId).eq("session_record_id", data.id)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (observed.error || observed.data?.status !== "completed") return result("verification_required", data.expires_at, undefined, true);
  const checked = Date.parse(observed.data.finished_at);
  if (!Number.isFinite(checked) || checked > Date.now() + 5000 || Date.now() - checked > 60000)
    return result("verification_required", data.expires_at, undefined, true);
  return result("available", data.expires_at, observed.data.finished_at, true);
}
