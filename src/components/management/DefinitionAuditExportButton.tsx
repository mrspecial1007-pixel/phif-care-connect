import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportDefinitionAuditReview } from "@/lib/definition-audit.functions";

type ExportableScan = { coverage: string; ruleVersion: string; finishedAt: string; evidenceFingerprint?: string | null };
export function DefinitionAuditExportButton({ report, disabled, refresh, onBusy }: {
  report: ExportableScan | null; disabled: boolean; refresh: () => Promise<ExportableScan>; onBusy: (busy: boolean) => void;
}) {
  const request = useServerFn(exportDefinitionAuditReview);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const active = useRef(true), running = useRef(false), worker = useRef<Worker | null>(null);
  const cancelWorker = useRef<(() => void) | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; cancelWorker.current?.(); worker.current?.terminate(); };
  }, []);
  const exportFile = async () => {
    if (disabled || running.current || report?.coverage !== "observed_stable") return;
    running.current = true; onBusy(true); setError("");
    try {
      let scan = report;
      if (!scan.evidenceFingerprint) {
        setStatus("تحديث الفحص القديم للتحقق من جميع المعرفات...");
        scan = await refresh();
      }
      if (!active.current) return;
      if (scan.coverage !== "observed_stable" || !scan.evidenceFingerprint || scan.ruleVersion !== "definitions-2")
        throw new Error("يلزم فحص مكتمل بالإصدار الحالي قبل تصدير جميع الأصناف.");
      setStatus("قراءة جميع أصناف المراجعة والتحقق من تعريفاتها...");
      const data = await request({ data: { fingerprint: scan.evidenceFingerprint, ruleVersion: "definitions-2", finishedAt: scan.finishedAt } });
      if (!active.current) return;
      setStatus("إنشاء مصنف Excel...");
      const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
        const instance = new Worker(new URL("../../lib/definition-audit-export.worker.ts", import.meta.url), { type: "module" });
        worker.current = instance;
        const timer = setTimeout(() => finish(new Error("استغرق إنشاء الملف وقتًا أطول من المتوقع؛ أعد المحاولة.")), 120_000);
        const finish = (failure?: Error, value?: ArrayBuffer) => {
          clearTimeout(timer); instance.terminate(); worker.current = null; cancelWorker.current = null;
          if (failure) reject(failure); else resolve(value!);
        };
        cancelWorker.current = () => finish(new Error("أُلغي التصدير عند تغيير الجلسة أو الصفحة"));
        instance.onmessage = event => event.data.error ? finish(new Error(event.data.error)) : finish(undefined, event.data.bytes);
        instance.onerror = () => finish(new Error("تعذر إنشاء Excel في المتصفح"));
        instance.postMessage(data);
      });
      if (!active.current) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `PHIF-audit-review-${data.auditFinishedAt.slice(0, 10)}.xlsx`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success(`تم إنشاء الملف: ${data.rows.length} صف مراجعة`);
    } catch (failure) {
      if (active.current) setError(failure instanceof Error ? failure.message : "تعذر تصدير الأصناف");
    } finally {
      running.current = false;
      if (active.current) { setStatus(""); onBusy(false); }
    }
  };
  return <div className="min-w-0 space-y-1">
    <Button variant="outline" className="h-auto min-h-9 max-w-full whitespace-normal text-right" disabled={disabled || !!status || !report} onClick={exportFile}>
      {status ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <FileSpreadsheet className="size-4 shrink-0" />}
      تصدير الأصناف للمراجعة – Excel
    </Button>
    {status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}
    {error && <p role="alert" className="max-w-lg text-xs text-destructive">{error}</p>}
  </div>;
}
