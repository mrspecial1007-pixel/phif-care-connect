import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Wifi, WifiOff } from "lucide-react";
import { getPhifConnectionIndicator } from "@/lib/phif-connection.functions";
import { phifConnectionState } from "@/lib/phif-connection.helpers";

export function PhifConnectionBadge({ state }: { state: "connected" | "disconnected" | "checking" | "unknown" }) {
  const connected = state === "connected", checking = state === "checking", unknown = state === "unknown";
  const Icon = checking ? Loader2 : connected ? Wifi : WifiOff;
  return <span role="status" aria-live="polite" title={checking ? "قراءة آخر حالة محفوظة، دون الاتصال بـPHIF" : connected ? "نجحت آخر مزامنة يدوية مؤخرًا؛ لا يجري فحص دوري للجلسة" : unknown ? "صلاحية جلسة PHIF غير مؤكدة؛ تتحقق عند المزامنة اليدوية فقط" : "لا توجد جلسة PHIF محفوظة سارية أو لا يوجد اتصال بالإنترنت"}
    className={`inline-flex min-w-[4.5rem] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-4 ${checking || unknown
      ? "border-zinc-200 bg-zinc-50 text-zinc-600" : connected
        ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-800"}`}>
    <Icon aria-hidden="true" className={`size-3 shrink-0 ${checking ? "animate-spin" : ""}`} />
    {checking ? "جارٍ القراءة" : unknown ? "غير مؤكد" : connected ? "متصل" : "غير متصل"}
  </span>;
}

export function PhifConnectionIndicator({ scope }: { scope: string }) {
  const [now, setNow] = useState(Date.now), [online, setOnline] = useState(true);
  useEffect(() => {
    const network = () => setOnline(navigator.onLine);
    network(); window.addEventListener("online", network); window.addEventListener("offline", network);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(timer); window.removeEventListener("online", network); window.removeEventListener("offline", network); };
  }, []);
  const query = useQuery({ queryKey: ["phif_connection_indicator", scope], queryFn: () => getPhifConnectionIndicator(),
    staleTime: Infinity, gcTime: 60000, refetchInterval: false, refetchOnMount: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false });
  return <PhifConnectionBadge state={phifConnectionState(query.data, { now, online, pending: query.isPending, failed: query.isError })} />;
}
