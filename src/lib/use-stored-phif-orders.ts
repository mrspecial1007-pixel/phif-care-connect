import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPhifOrders, getPhifOrdersStorageAccess } from "./phif-orders.functions";
import { ordersCacheOptions } from "./phif-orders.helpers";
import { ordersStore } from "./phif-orders.storage";
import { assertOrdersSnapshotReplacement, ordersSnapshotSchema, type OrdersSnapshot, type OrdersStorageAccess } from "./phif-orders-snapshot.helpers";

export async function refreshStoredOrders(
  access: OrdersStorageAccess, previous: OrdersSnapshot | null,
  read: () => ReturnType<typeof getPhifOrders>, write: (snapshot: OrdersSnapshot, access: OrdersStorageAccess) => Promise<void>,
) {
  const result = await read();
  if (!result.ok) return result;
  const parsed = ordersSnapshotSchema.safeParse(result.snapshot);
  if (!parsed.success) throw new Error("التحديث غير مكتمل أو غير صالح؛ احتُفظ بالنسخة السابقة");
  const snapshot = parsed.data;
  if (snapshot.pharmacyId !== access.pharmacyId || snapshot.subject !== access.subject) throw new Error("استجابة الطلبيات لا تخص الصيدلية والمستخدم الحاليين");
  assertOrdersSnapshotReplacement(previous, snapshot);
  await write(snapshot, access);
  return { ok: true as const, snapshot };
}

export function useStoredPhifOrders(scope: string) {
  const client = useQueryClient(), queryKey = ["phif_orders", scope] as const;
  const access = useQuery({ queryKey: ["phif_orders_access", scope], queryFn: () => getPhifOrdersStorageAccess(),
    staleTime: 30000, refetchInterval: 60000, refetchIntervalInBackground: false, refetchOnWindowFocus: false, retry: false });
  const stored = useQuery<OrdersSnapshot | null>({ ...ordersCacheOptions, queryKey, enabled: false, queryFn: async () => null });
  const [loading, setLoading] = useState(true), [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null), [expired, setExpired] = useState(false);
  const [source, setSource] = useState<"live" | "saved">("saved");
  const lock = useRef(false), mounted = useRef(true);
  const hydrated = useRef(false), accessRef = useRef(access.data); accessRef.current = access.data;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!access.data || hydrated.current) return;
    hydrated.current = true;
    const currentAccess = access.data;
    void ordersStore.load(currentAccess).then(snapshot => {
      if (!mounted.current) return;
      if (snapshot) {
        const cached = client.getQueryData<OrdersSnapshot>(queryKey);
        if (!cached || Date.parse(snapshot.report.fetchedAt) >= Date.parse(cached.report.fetchedAt)) client.setQueryData(queryKey, snapshot);
      }
    }).catch(() => { if (mounted.current) setError("تعذر فتح النسخة المحلية الآمنة. لم تُحذف البيانات المحفوظة."); })
      .finally(() => { if (mounted.current) setLoading(false); });
  }, [access.data, client, scope]);
  const snapshot = access.data && !access.error && stored.data?.pharmacyId === access.data.pharmacyId
    && stored.data.subject === access.data.subject ? stored.data : null;
  const sessionExpired = expired || Boolean(access.data && !access.data.sessionCheckFailed
    && (!access.data.sessionExpiresAt || Date.parse(access.data.sessionExpiresAt) <= Date.now()));
  async function refresh() {
    const currentAccess = accessRef.current;
    if (lock.current) return;
    if (!currentAccess || access.error) { void access.refetch(); return; }
    if (loading) return;
    lock.current = true; setUpdating(true); setError(null);
    try {
      const result = await refreshStoredOrders(currentAccess, client.getQueryData<OrdersSnapshot>(queryKey) || null,
        () => getPhifOrders({ data: { export: false } }), (next, rights) => ordersStore.save(next, rights));
      if (!mounted.current) return;
      if (!result.ok) { setError(result.error); setExpired(result.reason === "session_expired"); setSource("saved"); return; }
      client.setQueryData(queryKey, result.snapshot); setSource("live"); setExpired(false);
      void access.refetch();
      if (typeof navigator !== "undefined" && navigator.storage?.persist) void navigator.storage.persist().catch(() => {});
    } catch (error) { if (mounted.current) { setSource("saved"); setError(error instanceof Error ? error.message : "تعذر حفظ التحديث؛ احتُفظ بالنسخة السابقة"); } }
    finally { lock.current = false; if (mounted.current) setUpdating(false); }
  }
  return { snapshot, data: snapshot ? { ...snapshot.report, canExport: Boolean(access.data?.canExport) } : null,
    isLoading: !snapshot && !access.error && (loading || access.isLoading), isFetching: updating,
    canRefresh: Boolean(access.error || (access.data && !loading)), refresh, source,
    sessionExpired, error: access.error ? (access.error as Error).message : error };
}
