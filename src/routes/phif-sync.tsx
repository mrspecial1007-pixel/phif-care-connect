import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Gate } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  createPhifLoginSession,
  getPhifSessionStatus,
  inspectPhifTransactionsRange,
  saveNewPhifInvoices,
  type PhifInvoicePreview,
} from "@/lib/phif-sync.functions";
import { CheckCircle2, Database, ExternalLink, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
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
  const today = new Date().toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [preview, setPreview] = useState<PhifInvoicePreview[]>([]);
  const [summary, setSummary] = useState({
    total: 0,
    new_count: 0,
    duplicate_count: 0,
    failed_count: 0,
    needs_review_count: 0,
  });
  const [checking, setChecking] = useState(false);
  const [creatingLogin, setCreatingLogin] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: status, refetch } = useQuery({
    queryKey: ["phif_session_status"],
    queryFn: () => sessionStatus(),
    staleTime: 15_000,
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
      if (result.metadata?.empty_day_server_response || result.summary.total === 0) {
        toast.info("لا توجد حركات PHIF في الفترة المحددة.");
      } else {
        toast.success("تم فحص حركات PHIF");
      }
      await refetch();
    } catch {
      toast.error("تعذر فحص حركات PHIF الآن. تحقق من جلسة PHIF أو حاول لاحقًا.");
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
      }));
      setPreview([]);
    } catch (error: any) {
      toast.error(error?.message ?? "فشل حفظ فواتير PHIF");
    } finally {
      setSaving(false);
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
      </div>

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
