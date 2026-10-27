export type PhifConnectionStatus = {
  authenticated: boolean; expiresAt: string | null; checkedAt: string;
  sessionAvailable?: boolean;
  reason: "available" | "no_session" | "expired" | "not_configured" | "unreachable" | "not_authenticated" | "verification_required";
};

export function phifConnectionState(status: PhifConnectionStatus | undefined, {
  now = Date.now(), pending = false, failed = false, online = true,
}: { now?: number; pending?: boolean; failed?: boolean; online?: boolean } = {}) {
  if (pending && !status && online && !failed) return "checking" as const;
  if (!online) return "disconnected" as const;
  if (status?.expiresAt && Date.parse(status.expiresAt) <= now) return "disconnected" as const;
  if (failed || !status || status.reason === "unreachable" || status.reason === "verification_required") return "unknown" as const;
  if (!status.authenticated || !status.expiresAt) return "disconnected" as const;
  const checked = Date.parse(status.checkedAt), expires = Date.parse(status.expiresAt);
  return Number.isFinite(checked) && Number.isFinite(expires) && expires > now && checked <= now + 5000 && now - checked <= 60000
    ? "connected" as const : expires <= now ? "disconnected" as const : "unknown" as const;
}
