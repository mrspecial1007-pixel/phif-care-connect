import type { QueryClient } from "@tanstack/react-query";

export const itemsAnalyticsCacheOptions = {
  gcTime: 60 * 60_000,
  staleTime: Infinity,
  // Infinity keeps unchanged results fresh; explicit invalidation still refreshes on return.
  refetchOnMount: true,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false,
} as const;

type ReportSession = {
  unlocked?: boolean;
  pharmacy?: { id: string };
  user?: { id?: string | null; role?: string; permissions?: unknown } | null;
};

export function itemsAnalyticsScope(session: ReportSession | undefined) {
  if (!session?.unlocked || !session.pharmacy?.id) return null;
  return JSON.stringify([
    session.pharmacy.id,
    session.user?.id,
    session.user?.role,
    session.user?.permissions,
  ]);
}

/** Retained reports must not survive logout, failed session verification or a permission change. */
export function bindItemsAnalyticsSessionCache(client: QueryClient) {
  return client.getQueryCache().subscribe(event => {
    if (event.type !== "updated" || event.query.queryKey.length !== 1 ||
        event.query.queryKey[0] !== "session") return;
    const state = event.query.state;
    if (state.status !== "success" && state.status !== "error") return;
    const scope = state.status === "success"
      ? itemsAnalyticsScope(state.data as ReportSession)
      : null;
    client.removeQueries({
      predicate: query => ["items_analytics", "phif_orders"].includes(String(query.queryKey[0])) && query.queryKey[1] !== scope,
    });
  });
}
