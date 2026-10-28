import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPhifOrders, getPhifOrdersStorageAccess } from "./phif-orders.functions";
import { ordersCacheOptions } from "./phif-orders.helpers";
import { attachOrderReceipts, type OrderReceiptRecord } from "./phif-order-receipts.helpers";
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
  try { await write(snapshot, access); }
  catch { return { ok: true as const, snapshot, cacheWarning: "حُفظت البيانات في Cloud، لكن تعذر تحديث النسخة المؤقتة على هذا الجهاز" }; }
  return { ok: true as const, snapshot, cacheWarning: null };
}

export function useStoredPhifOrders(scope: string) {
  const client = useQueryClient(), queryKey = ["phif_orders", scope] as const;
  const access = useQuery({ queryKey: ["phif_orders_access", scope], queryFn: () => getPhifOrdersStorageAccess(),
    // This request reads Cloud only; it never probes Bridge or PHIF.
    staleTime: 30000, refetchInterval: false, refetchOnMount: true, refetchOnReconnect: false, refetchOnWindowFocus: false, retry: false });
  const stored = useQuery<OrdersSnapshot | null>({ ...ordersCacheOptions, queryKey, enabled: false, queryFn: async () => null });
  const [loading, setLoading] = useState(true), [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null), [expired, setExpired] = useState(false);
  const [source, setSource] = useState<"live" | "saved">("saved");
  const lock = useRef(false), mounted = useRef(true);
  const hydrated = useRef(false), accessRef = useRef(access.data); accessRef.current = access.data;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!access.data) return;
    if (access.data.cloudSnapshot) {
      client.setQueryData(queryKey, access.data.cloudSnapshot);
      setLoading(false); hydrated.current = true;
      void ordersStore.save(access.data.cloudSnapshot, access.data).catch(() => {});
      return;
    }
    if (hydrated.current) return;
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
  const accessDenied = access.error && /Unauthorized|Forbidden|غير مصرح|لا تملك صلاحية/i.test((access.error as Error).message);
  const candidate = access.data?.cloudSnapshot || stored.data;
  const snapshot = access.data && !accessDenied && candidate?.pharmacyId === access.data.pharmacyId
    && candidate.subject === access.data.subject ? candidate : null;
  const sessionExpired = expired || Boolean(access.data && !access.data.sessionCheckFailed
    && (!access.data.sessionExpiresAt || Date.parse(access.data.sessionExpiresAt) <= Date.now()));
  async function refresh() {
    const currentAccess = accessRef.current;
    if (lock.current) return;
    if (!currentAccess || access.error) { void access.refetch(); return; }
    if (loading) return;
    if (currentAccess.manualSyncAccess?.ready === false) { setError(currentAccess.manualSyncAccess.message); return; }
    lock.current = true; setUpdating(true); setError(null);
    try {
      const previous = client.getQueryData<OrdersSnapshot>(queryKey) || null;
      const result = await refreshStoredOrders(currentAccess, previous,
        () => getPhifOrders({ data: { export: false, previous } }), (next, rights) => ordersStore.save(next, rights));
      if (!mounted.current) return;
      if (!result.ok) { setError(result.error); setExpired(result.reason === "session_expired"); setSource("saved"); return; }
      client.setQueryData(queryKey, result.snapshot); setSource("live"); setExpired(false); setError(result.cacheWarning);
      client.setQueryData(["phif_orders_access", scope], (previous: typeof access.data) => previous
        ? { ...previous, cloudSnapshot: result.snapshot, cloudReady: true } : previous);
      void access.refetch();
    } catch (error) { if (mounted.current) { setSource("saved"); setError(error instanceof Error ? error.message : "تعذر حفظ التحديث؛ احتُفظ بالنسخة السابقة"); } }
    finally {
      lock.current = false;
      if (mounted.current) setUpdating(false);
      void client.invalidateQueries({ queryKey: ["phif_session_status"] });
    }
  }
  return { snapshot, data: snapshot ? attachOrderReceipts({ ...snapshot.report, canExport: Boolean(access.data?.canExport) }, access.data?.receipts?.rows || []) : null,
    receipts: access.data?.receipts, canManageReceipts: Boolean(access.data?.canManageReceipts),
    refreshReceipts: () => access.refetch(),
    receiptSaved: (row: OrderReceiptRecord) => {
      client.setQueryData(["phif_orders_access", scope], (previous: typeof access.data) => previous ? { ...previous,
        receipts: { ready: true, error: null, rows: [...(previous.receipts?.rows || []).filter(item => item.id !== row.id), row] } } : previous);
      void access.refetch();
    },
    isLoading: !snapshot && !access.error && (loading || access.isLoading), isFetching: updating,
    manualSyncAccess: access.data?.manualSyncAccess,
    canRefresh: Boolean(access.error || (access.data?.cloudReady && !loading && access.data.manualSyncAccess?.ready !== false)), refresh, source,
    central: Boolean(access.data?.cloudSnapshot) || source === "live",
    sessionExpired, error: access.error ? (access.error as Error).message : error || access.data?.cloudError };
}
