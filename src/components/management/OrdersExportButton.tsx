import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getPhifOrders } from "@/lib/phif-orders.functions";
import type { OrdersFilters } from "@/lib/phif-orders.helpers";

export function OrdersExportButton({ enabled, filters }: { enabled: boolean; filters: OrdersFilters }) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false), worker = useRef<Worker | null>(null), url = useRef<string | null>(null);
  const mounted = useRef(true), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; worker.current?.terminate();
    if (timer.current) clearTimeout(timer.current);
    if (url.current) URL.revokeObjectURL(url.current);
  }; }, []);
  async function run(format: "xlsx" | "pdf") {
    if (lock.current || !enabled) return;
    lock.current = true; setBusy(true);
    try {
      const report = await getPhifOrders({ data: { export: true } });
      if (!mounted.current) return;
      const w = new Worker(new URL("../../lib/phif-orders-export.worker.ts", import.meta.url), { type: "module" });
      worker.current = w;
      const result = await new Promise<{ bytes: ArrayBuffer; mime: string; filename: string }>((resolve, reject) => {
        timer.current = setTimeout(() => reject(new Error("انتهت مهلة إنشاء الملف")), 180000);
        w.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data);
        w.onerror = () => reject(new Error("تعذر تشغيل مولّد التصدير"));
        w.postMessage({ report, filters, format, fonts: {
          regular: new URL("/fonts/Amiri-Regular.ttf", location.origin).href,
          bold: new URL("/fonts/Amiri-Bold.ttf", location.origin).href,
        } });
      });
      if (!mounted.current) return;
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(new Blob([result.bytes], { type: result.mime }));
      const link = document.createElement("a");
      link.href = url.current; link.download = result.filename;
      document.body.appendChild(link); link.click(); link.remove();
      toast.success("تم إنشاء الكشف وبدء التحميل");
    } catch (error) { if (mounted.current) toast.error((error as Error).message || "تعذر تصدير الطلبيات"); }
    finally {
      if (timer.current) clearTimeout(timer.current);
      worker.current?.terminate(); worker.current = null; lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return <DropdownMenu dir="rtl"><DropdownMenuTrigger asChild>
    <Button variant="outline" disabled={!enabled || busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}{busy ? "جارٍ إنشاء الكشف" : "تصدير"}</Button>
  </DropdownMenuTrigger><DropdownMenuContent align="end">
    <DropdownMenuItem onSelect={() => void run("xlsx")}><FileSpreadsheet className="size-4" />Excel حسب الفلاتر</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => void run("pdf")}><FileText className="size-4" />PDF للأصناف غير المستلمة</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>;
}
