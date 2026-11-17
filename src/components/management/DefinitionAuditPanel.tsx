import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Search, ScanSearch, ExternalLink } from "lucide-react";
import { useSession } from "@/lib/queries";
import { runDefinitionAuditReport } from "@/lib/definition-audit.functions";
import type { runDefinitionAudit } from "@/lib/definition-audit.server";
import { definitionAuditStore, type CachedAuditReport } from "@/lib/definition-audit.local";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { DefinitionAuditExportButton } from "./DefinitionAuditExportButton";

const categories = { error: "خطأ مؤكد", review: "يحتاج مراجعة", unverified: "تعذر التحقق" };
const severities = { high: "عالية", medium: "متوسطة", low: "منخفضة" };
type AuditReport = Awaited<ReturnType<typeof runDefinitionAudit>>;
export function DefinitionAuditPanel() {
  const session = useSession();
  if (session.isFetching || session.error || session.data?.user?.role !== "admin" || !session.data.user.id || !session.data.pharmacy?.id) return null;
  return <DefinitionAuditBody key={`${session.data.pharmacy.id}:${session.data.user.id}`} pharmacyId={session.data.pharmacy.id} userId={session.data.user.id} />;
}

export function DefinitionAuditBody({ pharmacyId, userId }: { pharmacyId: string; userId: string }) {
  const run = useServerFn(runDefinitionAuditReport);
  const [lastComplete, setLastComplete] = useState<AuditReport | CachedAuditReport | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [code, setCode] = useState("");
  const [severity, setSeverity] = useState("");
  const [month, setMonth] = useState("");
  const [source, setSource] = useState("");
  const [limit, setLimit] = useState(40);
  const audit = useMutation<AuditReport, Error>({
    mutationFn: async () => await run({ data: {} }) as AuditReport,
    retry: false,
    gcTime: 0,
    onSuccess: async report => {
      if (report.coverage !== "observed_stable") return;
      setLastComplete(report);
      try {
        const saved = await definitionAuditStore.save({ pharmacyId, userId }, report);
        setLastComplete(Date.parse(saved.result.finishedAt) > Date.parse(report.finishedAt) ? saved.result : report);
        setSavedAt(saved.savedAt);
        setStorageError(null);
      } catch (error) {
        setStorageError(error instanceof Error ? error.message : "تعذر حفظ النتائج محليًا");
      }
    },
  });
  useEffect(() => {
    let active = true;
    definitionAuditStore.load({ pharmacyId, userId }).then(saved => {
      if (!active) return;
      if (saved) {
        setLastComplete(saved.result);
        setSavedAt(saved.savedAt);
      }
    }).catch(error => {
      if (active) setStorageError(error instanceof Error ? error.message : "تعذر استعادة النتائج المحفوظة");
    }).finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, [pharmacyId, userId]);
  const result = lastComplete || audit.data;
  const restoredOnly = !!result && "cached" in result;
  const attemptIncomplete = audit.data?.coverage === "incomplete";
  const findings: (AuditReport["findings"][number] | CachedAuditReport["findings"][number])[] = result?.findings || [];
  const findingMonths = (f: (typeof findings)[number]): string[] => "months" in f
    ? (f as CachedAuditReport["findings"][number]).months
    : f.invoices.map(i => i.month);
  const shown = findings.filter(f => (!q || `${f.name} ${f.reason}`.toLowerCase().includes(q.toLowerCase()))
    && (!code || f.code === code) && (!severity || f.severity === severity) && (!source || f.source === source)
    && (!month || findingMonths(f).includes(month)));
  const clearSaved = async () => {
    if (audit.isPending || exporting) return;
    setClearing(true);
    try {
      await definitionAuditStore.clear({ pharmacyId, userId });
      setLastComplete(null);
      setSavedAt(null);
      setStorageError(null);
      audit.reset();
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "تعذر مسح النتائج المحفوظة");
    } finally { setClearing(false); }
  };
  const select = (label: string, value: string, change: (v: string) => void, options: { value: string; label: string }[]) =>
    <label className="min-w-0 text-xs">{label}<select aria-label={label} value={value} onChange={e => { change(e.target.value); setLimit(40); }} className="mt-1 w-full rounded-md border bg-background p-2 text-sm">
      <option value="">الكل</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select></label>;
  return <section dir="rtl" className="space-y-3 border-t pt-4" aria-label="تدقيق تعريفات الأصناف والفواتير">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-semibold">تدقيق تعريفات الأصناف والفواتير</h2>
      <div className="flex flex-wrap gap-2">
        <Button disabled={audit.isPending || restoring || clearing || exporting} onClick={() => { setLimit(40); audit.mutate(); }}><ScanSearch className="size-4" />{audit.isPending ? "جارٍ فحص كامل التاريخ..." : lastComplete ? "إعادة الفحص" : "بدء فحص شامل"}</Button>
        <Button variant="outline" disabled={audit.isPending || clearing || restoring || exporting} onClick={clearSaved}>{clearing ? "جارٍ المسح..." : "مسح النتائج المحفوظة"}</Button>
        <DefinitionAuditExportButton report={lastComplete} disabled={audit.isPending || clearing || restoring} refresh={() => audit.mutateAsync()} onBusy={setExporting} />
      </div>
    </div>
    {restoring && <p role="status" className="text-sm text-muted-foreground">جارٍ استعادة نتائج هذا المستخدم والصيدلية...</p>}
    {!result && !restoring && !audit.isPending && !audit.isError && <p className="text-sm text-muted-foreground">لا توجد نتائج فحص محفوظة لهذا المستخدم والصيدلية.</p>}
    {audit.isPending && <p role="status" className="text-sm">قراءة الفواتير والتعريفات والروابط والتحقق من اكتمال المصادر...</p>}
    {audit.error && <p role="alert" className="text-sm text-destructive">{audit.error.message}</p>}
    {attemptIncomplete && result && <p role="alert" className="text-sm text-amber-800">لم تكتمل إعادة الفحص؛ احتُفظ بآخر نتيجة مكتملة ولم تُستبدل.</p>}
    {audit.isError && result && <p role="alert" className="text-sm text-amber-800">فشلت إعادة الفحص؛ ما زالت آخر نتيجة مكتملة معروضة.</p>}
    {storageError && <p role="alert" className="text-sm text-amber-800">{storageError}</p>}
    {result && <>
      <p className="text-xs text-muted-foreground">آخر فحص مكتمل: {new Date(result.finishedAt).toLocaleString("ar-LY")}</p>
      {savedAt && <p role="status" className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">النتائج محفوظة محليًا على هذا الجهاز، وقد لا تعكس تغييرات حدثت بعد وقت الفحص.</p>}
      {restoredOnly && <p className="text-xs text-muted-foreground">النسخة المحلية تحتوي الملخص وعينات المراجعة فقط؛ أرقام الفواتير ومعرفات البنود والتفاصيل غير محفوظة.</p>}
      <p role="status" className="text-sm text-amber-800">{result.coverage === "incomplete" ? "الفحص غير مكتمل؛ لم تُعلن نتائج قواعد التدقيق. " : "اكتملت القراءات دون تغيّر مرصود. "}{result.notice}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[["الفواتير", result.counts.invoices], ["البنود", result.counts.items], ["التعريفات", result.counts.definitions],
          ["أخطاء مؤكدة", result.counts.errors], ["تحتاج مراجعة", result.counts.reviews], ["تعذر التحقق", result.counts.unverified]].map(([label, value]) =>
          <div key={label} className="border-b py-2"><span className="text-xs text-muted-foreground">{label}</span><strong className="block text-lg">{result.coverage === "incomplete" && ["أخطاء مؤكدة", "تحتاج مراجعة"].includes(String(label)) ? "لم يُقيّم" : value}</strong></div>)}
      </div>
      <details className="text-xs"><summary>اكتمال مصادر البيانات</summary>{result.manifest.map(m => <p key={m.source}>{m.source}: {m.count} / {m.verificationCount} · {m.status === "observed_stable" ? "قراءتان متطابقتان" : m.reason || "تعذر التحميل الكامل"}</p>)}</details>
      {result.findingsTruncated && <p role="status" className="text-sm text-amber-800">القائمة مختصرة: تظهر {findings.length} من أصل {result.findingsTotal} مشكلة. لا تتوفر تفاصيل المشكلات الأخرى في هذه النسخة، والفلاتر تطبق على المعروض فقط.</p>}
      {!restoredOnly && findings.some(f => f.evidenceTruncated) && <p className="text-xs text-amber-800">فلتر الشهر يعتمد على الفواتير المعروضة في العينة، وقد لا يعرض جميع الأشهر المتأثرة.</p>}
      <div className="relative"><Search className="absolute right-3 top-3 size-4 text-muted-foreground" /><Input aria-label="بحث بالصنف" value={q} onChange={e => { setQ(e.target.value); setLimit(40); }} placeholder="بحث بالصنف" className="pr-9" /></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {select("المشكلة", code, setCode, [...new Set(findings.map(f => f.code))].map(value => ({ value, label: findings.find(f => f.code === value)!.reason })))}
        {select("الخطورة", severity, setSeverity, Object.entries(severities).map(([value, label]) => ({ value, label })))}
        {select("الشهر المتأثر", month, setMonth, [...new Set<string>(findings.flatMap(findingMonths))].sort().map(value => ({ value, label: value })))}
        {select("المصدر", source, setSource, [{ value: "phif", label: "PHIF Supplier" }, { value: "actual", label: "Actual" }, { value: "unknown", label: "غير محدد" }])}
      </div>
      <p className="text-xs">{shown.length} نتيجة مطابقة للفلاتر</p>
      {shown.slice(0, limit).map(f => <Card key={f.id} className="space-y-2 p-3">
        <h3 className="break-words text-sm font-semibold" dir="auto">{f.name}</h3>
        <p className="text-xs text-muted-foreground">{categories[f.category]} · خطورة {severities[f.severity]} · {f.source === "phif" ? "PHIF Supplier" : f.source}</p>
        <p className="text-sm">{f.reason}</p>
        <details className="text-xs"><summary>{f.itemCount} بند · {f.invoiceCount} فاتورة</summary>
          <p className="py-2">{f.action}</p>
          {f.evidenceTruncated && <p>تظهر عينة من الأدلة فقط؛ بقية التفاصيل غير متاحة في هذه النسخة.</p>}
          {restoredOnly ? <p className="py-2">تفاصيل الفواتير ومعرفات السجلات غير محفوظة محليًا.</p> : <>
            <div className="max-h-48 space-y-1 overflow-auto">{f.invoices.map(i => <p key={i.id}>فاتورة {i.number} · {i.month}</p>)}</div>
            <p className="break-all">معرفات السجلات: {f.records.join("، ") || "—"}</p>
          </>}
        </details>
        {f.identity && f.itemIds.length > 0 && <Button asChild size="sm" variant="outline"><Link to="/management/reports/items/identity-review/$identityId" params={{ identityId: f.identity }} search={{ month: "all", source: "all", q: "", sort: "profit_asc", result: "all", mode: "cumulative" }}><ExternalLink className="size-4" />فتح الصنف للمراجعة</Link></Button>}
      </Card>)}
      {shown.length > limit && <Button variant="outline" onClick={() => setLimit(n => n + 40)}>عرض المزيد</Button>}
    </>}
  </section>;
}
