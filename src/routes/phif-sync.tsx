import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Gate } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  completeSavedPhifInvoiceItemRange,
  createPhifLoginSession,
  getPhifSessionStatus,
  inspectSavedPhifInvoiceItemCompletion,
  inspectPhifTransactionsRange,
  saveNewPhifInvoices,
  type PhifInvoiceItemCompletionResult,
  type PhifInvoicePreview,
} from "@/lib/phif-sync.functions";
import { getPhifInvoiceArchiveStats } from "@/lib/phif-invoices.functions";
import { CheckCircle2, ClipboardCheck, Database, ExternalLink, Loader2, ReceiptText, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/phif-sync")({
  component: () => (
    <Gate>
      <PhifSyncPage />
    </Gate>
  ),
});

function PhifSyncPage() {
  const sessionStatus = useServerFn(getPhifSessionStatus);
  const createLoginSession = useServerFn(createPhifLoginSession);
  const inspect = useServerFn(inspectPhifTransactionsRange);
  const saveInvoices = useServerFn(saveNewPhifInvoices);
  const inspectItemCompletion = useServerFn(inspectSavedPhifInvoiceItemCompletion);
  const completeItemRange = useServerFn(completeSavedPhifInvoiceItemRange);
  const archiveStats = useServerFn(getPhifInvoiceArchiveStats);
  const today = new Date().toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [completionInvoiceKey, setCompletionInvoiceKey] = useState("");
  const [completionRangeFrom, setCompletionRangeFrom] = useState(today);
  const [completionRangeTo, setCompletionRangeTo] = useState(today);
  const [completionRangeLimit, setCompletionRangeLimit] = useState(100);
  const [completionResult, setCompletionResult] = useState<PhifInvoiceItemCompletionResult | null>(null);
  const [completionMode, setCompletionMode] = useState<"single" | "range" | null>(null);
  const [completionRunning, setCompletionRunning] = useState(false);
  const [preview, setPreview] = useState<PhifInvoicePreview[]>([]);
  const [summary, setSummary] = useState({
    total: 0,
    new_count: 0,
    duplicate_count: 0,
    failed_count: 0,
    needs_review_count: 0,
    completed_item_invoice_count: 0,
    completion_failed_count: 0,
  });
  const [checking, setChecking] = useState(false);
  const [creatingLogin, setCreatingLogin] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: status, refetch } = useQuery({
    queryKey: ["phif_session_status"],
    queryFn: () => sessionStatus(),
    staleTime: 15_000,
  });
  const { data: archive } = useQuery({
    queryKey: ["phif_invoice_archive_stats"],
    queryFn: () => archiveStats(),
    staleTime: 30_000,
  });

  const canSave = useMemo(() => preview.length > 0 && !saving, [preview.length, saving]);

  async function handleLogin() {
    setCreatingLogin(true);
    try {
      const result = await createLoginSession();
      if (!result.login_url) throw new Error("PHIF bridge did not return a login URL");
      window.open(result.login_url, "_blank", "noopener,noreferrer");
      await refetch();
    } catch (error: any) {
      toast.error(error?.message ?? "فشل إنشاء جلسة تسجيل دخول PHIF");
    } finally {
      setCreatingLogin(false);
    }
  }

  async function handleInspect() {
    if (!status?.authenticated) {
      toast.error("يجب تسجيل الدخول إلى PHIF أولاً");
      return;
    }
    setChecking(true);
    try {
      const result = await inspect({ data: { dateFrom, dateTo } });
      setSummary(result.summary);
      setPreview(result.preview);
      if (result.metadata?.historical_error) {
        toast.error(result.metadata.historical_error_message ?? "تعذر فحص حركات PHIF التاريخية.");
      } else if (result.metadata?.empty_day_server_response || result.summary.total === 0) {
        toast.info("لا توجد حركات PHIF في الفترة المحددة.");
      } else {
        toast.success("تم فحص حركات PHIF");
      }
      await refetch();
    } catch (error: any) {
      toast.error(error?.message ?? "تعذر فحص حركات PHIF الآن. تحقق من جلسة PHIF أو حاول لاحقًا.");
    } finally {
      setChecking(false);
    }
  }

  async function handleSave() {
    if (!preview.length) return;
    setSaving(true);
    try {
      const result = await saveInvoices({ data: { invoices: preview } });
      toast.success(`تم حفظ ${result.new_count} فاتورة جديدة`);
      setSummary((s) => ({
        ...s,
        new_count: result.new_count,
        duplicate_count: s.duplicate_count + result.duplicate_count,
        failed_count: result.failed_count,
        completed_item_invoice_count: result.completed_item_invoice_count,
        completion_failed_count: result.completion_failed_count,
      }));
      setPreview([]);
    } catch (error: any) {
      toast.error(error?.message ?? "فشل حفظ فواتير PHIF");
    } finally {
      setSaving(false);
    }
  }

  async function handleSingleCompletion(dryRun: boolean) {
    const invoiceKey = completionInvoiceKey.trim();
    if (!invoiceKey) {
      toast.error("أدخل مفتاح الفاتورة أولًا");
      return;
    }
    if (!status?.authenticated) {
      toast.error("يجب تسجيل الدخول إلى PHIF أولًا");
      return;
    }
    setCompletionRunning(true);
    try {
      const result = await inspectItemCompletion({ data: { invoice_key: invoiceKey, dry_run: dryRun } });
      setCompletionResult(result);
      setCompletionMode("single");
      toast.success(dryRun ? "تمت معاينة استكمال الأصناف" : `تمت إضافة ${result.added_item_count} صنف`);
    } catch (error: any) {
      toast.error(error?.message ?? "تعذر استكمال أصناف الفاتورة");
    } finally {
      setCompletionRunning(false);
    }
  }

  async function handleRangeCompletion(dryRun: boolean) {
    if (!status?.authenticated) {
      toast.error("يجب تسجيل الدخول إلى PHIF أولًا");
      return;
    }
    setCompletionRunning(true);
    try {
      const result = await completeItemRange({
        data: {
          dateFrom: completionRangeFrom,
          dateTo: completionRangeTo,
          limit: completionRangeLimit,
          dry_run: dryRun,
        },
      });
      setCompletionResult(result);
      setCompletionMode("range");
      toast.success(dryRun ? "تمت معاينة نطاق الاستكمال" : `تم استكمال ${result.completed_invoice_count} فاتورة`);
    } catch (error: any) {
      toast.error(error?.message ?? "تعذر استكمال نطاق الفواتير");
    } finally {
      setCompletionRunning(false);
    }
  }

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">مزامنة PHIF</h1>
          <p className="text-sm text-muted-foreground">
            فحص وحفظ فواتير PHIF الجديدة في جداول مستقلة بدون تعديل الصرف الحالي.
          </p>
        </div>
        <Badge variant={status?.authenticated ? "default" : "outline"} className="shrink-0">
          {status?.authenticated ? "جلسة متاحة" : "غير متصل"}
        </Badge>
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold">حالة جلسة PHIF</div>
            <div className="text-sm text-muted-foreground break-words">
              {status?.message ?? "جاري التحقق..."}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">من تاريخ</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">إلى تاريخ</span>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
          <Button variant="outline" onClick={handleLogin} disabled={creatingLogin} className="gap-2">
            {creatingLogin ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            تسجيل الدخول إلى PHIF
          </Button>
          <Button onClick={handleInspect} disabled={checking || !status?.authenticated} className="gap-2">
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            فحص الحركات الجديدة
          </Button>
          <Button variant="ghost" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            تحديث حالة الجلسة
          </Button>
          <Button onClick={handleSave} disabled={!canSave} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            مزامنة/حفظ الجديد فقط
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="الحركات في PHIF" value={summary.total} />
        <SummaryCard label="الجديدة" value={summary.new_count} tone="success" />
        <SummaryCard label="الموجودة مسبقًا" value={summary.duplicate_count} />
        <SummaryCard label="تحتاج مراجعة" value={summary.needs_review_count + summary.failed_count} tone="warning" />
        <SummaryCard label="استُكملت أصنافها" value={summary.completed_item_invoice_count} tone="success" />
        <SummaryCard label="تعذر استكمالها" value={summary.completion_failed_count} tone="warning" />
      </div>

      <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <ReceiptText className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold">أرشيف فواتير PHIF</div>
            <div className="text-sm text-muted-foreground">
              إجمالي الفواتير المحفوظة: <span className="font-medium text-foreground">{archive?.total ?? 0}</span>
            </div>
          </div>
        </div>
        <Button asChild variant="outline" className="gap-2">
          <Link to="/phif-invoices">
            <ReceiptText className="h-4 w-4" />
            فتح الأرشيف
          </Link>
        </Button>
        <Button asChild variant="outline" className="gap-2">
          <Link to="/phif-review">
            <ClipboardCheck className="h-4 w-4" />
            قائمة المراجعة
          </Link>
        </Button>
      </Card>

      <Card className="space-y-4 p-4">
        <div>
          <div className="font-semibold">استكمال أصناف فواتير PHIF المحفوظة</div>
          <div className="text-sm text-muted-foreground">
            يعيد جلب تفاصيل الفاتورة من PHIF Bridge ويضيف الأصناف الناقصة فقط دون حذف أو تكرار الأصناف الموجودة.
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto]">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">مفتاح الفاتورة</span>
            <input
              value={completionInvoiceKey}
              onChange={(event) => setCompletionInvoiceKey(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              dir="ltr"
              placeholder="2026-4193942-..."
            />
          </label>
          <Button
            variant="outline"
            onClick={() => handleSingleCompletion(true)}
            disabled={completionRunning || !status?.authenticated}
            className="gap-2 self-end"
          >
            {completionRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            معاينة فقط
          </Button>
          <Button
            onClick={() => handleSingleCompletion(false)}
            disabled={completionRunning || !status?.authenticated || completionMode !== "single" || !completionResult || completionResult.dry_run !== true || completionResult.added_item_count === 0}
            className="gap-2 self-end"
          >
            {completionRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            تأكيد الحفظ
          </Button>
        </div>

        <details className="rounded-lg border bg-muted/20 p-3">
          <summary className="cursor-pointer text-sm font-semibold">استكمال نطاق تاريخي لاحقًا</summary>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">من تاريخ</span>
              <input
                type="date"
                value={completionRangeFrom}
                onChange={(event) => setCompletionRangeFrom(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">إلى تاريخ</span>
              <input
                type="date"
                value={completionRangeTo}
                onChange={(event) => setCompletionRangeTo(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">الحد الأقصى</span>
              <input
                type="number"
                min={1}
                max={500}
                value={completionRangeLimit}
                onChange={(event) => setCompletionRangeLimit(Number(event.target.value) || 100)}
                className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm"
                dir="ltr"
              />
            </label>
            <Button
              variant="outline"
              onClick={() => handleRangeCompletion(true)}
              disabled={completionRunning || !status?.authenticated}
              className="gap-2"
            >
              معاينة النطاق
            </Button>
            <Button
              onClick={() => handleRangeCompletion(false)}
              disabled={completionRunning || !status?.authenticated || completionMode !== "range" || !completionResult || completionResult.dry_run !== true || completionResult.added_item_count === 0}
              className="gap-2"
            >
              تأكيد حفظ النطاق
            </Button>
          </div>
        </details>

        {completionResult && <CompletionResult result={completionResult} />}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold">Preview قبل الحفظ</div>
          <Badge variant="secondary" dir="ltr">{preview.length}</Badge>
        </div>

        {preview.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground border rounded-lg border-dashed">
            لا توجد حركات جديدة للعرض بعد.
          </div>
        ) : (
          <div className="grid gap-3">
            {preview.map((invoice) => (
              <Card key={invoice.invoice_key} className="p-3 border-r-4 border-r-primary">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="font-semibold truncate">{invoice.beneficiary_name ?? "مستفيد غير معروف"}</div>
                    <div className="text-xs text-muted-foreground" dir="ltr">
                      {invoice.insurance_card_number ?? "no-card"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      فاتورة: <span dir="ltr">{invoice.invoice_number ?? invoice.invoice_key}</span>
                    </div>
                  </div>
                  <Badge variant={invoice.patient_match === "matched" ? "default" : "outline"}>
                    {invoice.patient_match === "matched" ? "matched" : "not matched"}
                  </Badge>
                </div>

                <div className="mt-3 grid gap-2">
                  {invoice.items.map((item, index) => (
                    <div key={`${invoice.invoice_key}-${index}`} className="rounded-md bg-muted/50 p-2 text-sm">
                      <div className="font-medium">{item.brand ?? item.active_ingredient ?? "صنف بدون اسم"}</div>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                        {item.strength && <span>{item.strength}</span>}
                        {item.quantity !== null && <span>الكمية: {item.quantity}</span>}
                        {item.supplier && <span>المورد: {item.supplier}</span>}
                        {item.source_classification && <span>المصدر: {item.source_classification}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "success" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning-foreground"
        : "text-foreground";
  return (
    <Card className="p-3">
      <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </Card>
  );
}

function CompletionResult({ result }: { result: PhifInvoiceItemCompletionResult }) {
  return (
    <div className="space-y-3 rounded-lg border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">نتيجة الاستكمال</div>
        <Badge variant={result.dry_run ? "outline" : "default"}>
          {result.dry_run ? "معاينة فقط" : "تم الحفظ"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <MiniStat label="فواتير فُحصت" value={result.checked_count} />
        <MiniStat label="فواتير ستُستكمل" value={result.completed_invoice_count} />
        <MiniStat label="أصناف مضافة" value={result.added_item_count} />
        <MiniStat label="تعذر/فشل" value={result.unavailable.length + result.failed.length} />
      </div>

      {result.invoices.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="p-2 text-right">الفاتورة</th>
                <th className="p-2 text-center">التاريخ</th>
                <th className="p-2 text-center">الموجود</th>
                <th className="p-2 text-center">من المصدر</th>
                <th className="p-2 text-center">الناقص</th>
                <th className="p-2 text-center">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {result.invoices.map((invoice) => (
                <tr key={invoice.id} className="border-t">
                  <td className="p-2">
                    <div className="font-medium" dir="ltr">{invoice.invoice_number ?? invoice.invoice_key}</div>
                    <div className="text-xs text-muted-foreground" dir="ltr">{invoice.invoice_key}</div>
                  </td>
                  <td className="p-2 text-center" dir="ltr">{invoice.dispensing_date ?? "—"}</td>
                  <td className="p-2 text-center">{invoice.existing_item_count}</td>
                  <td className="p-2 text-center">{invoice.source_item_count}</td>
                  <td className="p-2 text-center">{invoice.missing_item_count}</td>
                  <td className="p-2 text-center">{completionStatusLabel(invoice.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(result.unavailable.length > 0 || result.failed.length > 0) && (
        <div className="grid gap-2 text-sm">
          {result.unavailable.map((invoice) => (
            <div key={`unavailable-${invoice.id}`} className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
              لم يرجع المصدر أصنافًا للفاتورة <span dir="ltr">{invoice.invoice_number ?? invoice.invoice_key}</span>: {invoice.reason}
            </div>
          ))}
          {result.failed.map((invoice) => (
            <div key={`failed-${invoice.id}`} className="rounded-md border border-destructive/20 bg-destructive/10 p-2 text-destructive">
              فشل استكمال الفاتورة <span dir="ltr">{invoice.invoice_number ?? invoice.invoice_key}</span>: {invoice.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/50 p-2 text-center">
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function completionStatusLabel(status: PhifInvoiceItemCompletionResult["invoices"][number]["status"]) {
  if (status === "dry_run") return "سيُستكمل";
  if (status === "completed") return "استُكمل";
  if (status === "already_complete") return "مكتملة";
  if (status === "source_empty") return "المصدر بلا أصناف";
  return status;
}
