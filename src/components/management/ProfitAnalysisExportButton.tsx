import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getProfitAnalysisExport } from "@/lib/management.functions";
import type { ProfitExportFormat } from "@/lib/profit-analysis-export.model";

export function ProfitAnalysisExportButton({ range, source, enabled }: {
  range: { dateFrom: string; dateTo: string }; source: "all" | "actual" | "phif"; enabled: boolean;
}) {
  const [stage, setStage] = useState("");
  const busy = useRef(false), worker = useRef<Worker | null>(null), downloadUrl = useRef<string | null>(null);
  const mounted = useRef(true), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; worker.current?.terminate(); if (timer.current) clearTimeout(timer.current); if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); }; }, []);
  async function run(format: ProfitExportFormat) {
    if (busy.current || !enabled) return;
    busy.current = true;
    setStage("جلب التقرير المصرح به");
    try {
      const data = await getProfitAnalysisExport({ data: { ...range, source } });
      if (!mounted.current) return;
      const w = new Worker(new URL("../../lib/profit-analysis-export.worker.ts", import.meta.url), { type: "module" });
      worker.current = w;
      const result = await new Promise<{ bytes: ArrayBuffer; filename: string; mime: string }>((resolve, reject) => {
        timer.current = setTimeout(() => reject(new Error("انتهت مهلة إنشاء الملف")), 300000);
        w.onmessage = ({ data: message }) => {
          if (message.progress) setStage(message.progress);
          else if (message.error) reject(new Error(message.error));
          else resolve(message);
        };
        w.onerror = () => reject(new Error("تعذر تشغيل مولّد التصدير على هذا المتصفح"));
        w.postMessage({ data, format, fonts: {
          regular: new URL("/fonts/Amiri-Regular.ttf", location.origin).href,
          bold: new URL("/fonts/Amiri-Bold.ttf", location.origin).href,
        } });
      });
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
      const url = URL.createObjectURL(new Blob([result.bytes], { type: result.mime }));
      downloadUrl.current = url;
      const link = document.createElement("a");
      link.href = url; link.download = result.filename; document.body.appendChild(link); link.click(); link.remove();
      toast.success("تم إنشاء التقرير وبدء التحميل", format === "xlsx" ? undefined : { action: { label: "معاينة PDF", onClick: () => window.open(url, "_blank", "noopener,noreferrer") } });
    } catch {
      toast.error("تعذر التصدير. تحقق من الصلاحيات والاتصال وحاول مجددًا؛ قد تحتاج إلى اختيار مصدر مسموح به فقط.");
    } finally {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null; worker.current?.terminate(); worker.current = null; busy.current = false;
      if (mounted.current) setStage("");
    }
  }
  return <div className="min-w-0 space-y-1">
    <DropdownMenu dir="rtl"><DropdownMenuTrigger asChild><Button variant="outline" disabled={!enabled || !!stage}>
      {stage ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} {stage ? "جارٍ إنشاء الملف" : "تصدير"}
    </Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]">
      <DropdownMenuItem onSelect={() => void run("pdf-summary")}><FileText className="size-4" />PDF مختصر — تقرير إداري</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void run("pdf-full")}><FileText className="size-4" />PDF شامل — تقرير مالي تفصيلي</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void run("xlsx")}><FileSpreadsheet className="size-4" />Excel — مصنف تحليلي متعدد الأوراق</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>
    {stage && <p role="status" className="text-xs text-muted-foreground">{stage}</p>}
  </div>;
}
