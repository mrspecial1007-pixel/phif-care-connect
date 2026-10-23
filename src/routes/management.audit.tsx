import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Link2, RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { ReportBackLink } from "@/components/management/ReportBackLink";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getManagementAuditReport } from "@/lib/management.functions";
import { ActualStockLinks } from "@/components/management/ActualStockLinkEditor";
import { ActualUnitEditor } from "@/components/management/ActualUnitEditor";
import { ActualUnitAccessNotice } from "@/components/management/ActualUnitAccessNotice";
import { ACTUAL_UNIT_REASONS } from "@/lib/actual-units.helpers";

export const Route = createFileRoute("/management/audit")({
  component: ManagementAuditPage,
  head: () => ({
    meta: [
      { title: "مركز التدقيق - PHIF Tracker" },
      { name: "description", content: "تدقيق قراءة فقط لمطابقة Actual واكتمال التسعير المالي" },
      { property: "og:title", content: "مركز التدقيق - PHIF Tracker" },
      { property: "og:description", content: "كشف مشاكل مطابقة Actual والتسعير المالي دون تعديل البيانات" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function percent(value: number | null | undefined) {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined) return "غير متاح";
  return `${Number(value).toLocaleString("ar-LY", { maximumFractionDigits: 3 })} د.ل`;
}

const reasonLabels: Record<string, string> = {
  NO_STOCK_MATCH: "لا يوجد صنف مطابق في مخزون PHIF الحالي",
  manual_target_unavailable: "المرجع اليدوي غير متاح حاليًا أو تغيرت بياناته؛ يلزم مراجعة الربط",
  STRENGTH_MISMATCH: "اختلاف في التركيز",
  UNIT_MISMATCH: "اختلاف أو غياب وحدة التسعير",
  SUPPLIER_MISMATCH: "اختلاف المورد",
  AMBIGUOUS_MATCHES: "أكثر من مرشح محتمل ولا يمكن الاختيار تلقائيًا",
  MISSING_IDENTIFIERS: "بيانات التعريف غير كافية للمطابقة الآمنة",
  SOURCE_MISMATCH: "مصدر الصنف غير مناسب للتدقيق",
  SOURCE_MISSING: "مصدر الصنف غير مصنف ولا يمكن اعتباره Actual تلقائيًا",
};

function reasonLabel(reason: string | null | undefined) {
  if (!reason) return "غير محدد";
  return reasonLabels[reason] ?? reason;
}

function auditErrorMessage(error: unknown) {
  const message = (error as Error)?.message ?? "";
  if (/internal server error/i.test(message)) {
    return "تعذر تشغيل التدقيق من الخادم. حاول مرة أخرى، وإذا تكرر الخطأ راجع سجلات Lovable لمعرفة السبب التقني.";
  }
  return message || "تعذر تشغيل التدقيق من الخادم.";
}

function MetricCard({ label, value, tone = "neutral", onClick }: { label: string; value: string | number; tone?: "success" | "warning" | "danger" | "neutral"; onClick?: () => void }) {
  const toneClass = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    danger: "border-red-200 bg-red-50 text-red-900",
    neutral: "border-border bg-card text-foreground",
  }[tone];
  const content = (
    <Card className={`h-full p-3 ${toneClass}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </Card>
  );
  if (!onClick) return content;
  return <button type="button" className="block h-full w-full text-right" onClick={onClick}>{content}</button>;
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === "matched" || status === "complete"
    ? "bg-emerald-100 text-emerald-800"
    : status === "ambiguous"
      ? "bg-amber-100 text-amber-800"
      : "bg-red-100 text-red-800";
  const label = status === "matched" ? "مطابق" : status === "ambiguous" ? "يحتاج مراجعة" : status === "complete" ? "مكتملة" : "غير مكتمل";
  return <span className={`rounded-full px-2 py-1 text-xs font-semibold ${cls}`}>{label}</span>;
}

function ActualIssueCard({ item, onLink, onUnits }: { item: any; onLink?: (ids: string[]) => void; onUnits?: (id: string) => void }) {
  return (
    <Card className={`space-y-3 p-3 ${item.status === "unmatched" ? "border-red-200" : "border-amber-200"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold leading-snug">{item.brand || item.active_ingredient || "صنف Actual"}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {item.active_ingredient || "اسم علمي غير متاح"} · {item.strength || "تركيز غير متاح"} · {item.unit || "وحدة غير متاحة"}
          </div>
        </div>
        <StatusBadge status={item.status} />
      </div>
      {item.manual_match && <span className="text-xs font-semibold text-teal-800">مطابقة يدوية</span>}
      <p className={`text-xs ${item.link_state === "review" ? "text-amber-800" : "text-muted-foreground"}`}>{item.link_state === "review" ? "الربط يحتاج مراجعة — توجد قرارات متعارضة" : item.link_state === "linked" ? `مرتبط: ${item.linked_stock_name || "صنف المخزون"}` : "غير مرتبط"}</p>
      {item.suggested_unit_count > 0 && <p className="text-xs font-semibold text-teal-800">{item.suggested_unit_count} بند بوحدة مقترحة بثقة عالية — بانتظار الاعتماد</p>}
      {onLink && <Button variant="outline" size="sm" onClick={() => onLink(item.item_ids)}><Link2 className="size-4" />{item.link_state === "linked" ? "مراجعة / تعديل الربط" : "ربط بصنف من المخزون"}</Button>}
      {onUnits && item.status === "matched" && item.unit_scopes.map((scope: any) => <Button key={scope.item_id} variant="outline" size="sm" className="h-auto whitespace-normal py-2" onClick={() => onUnits(scope.item_id)}>
        توثيق الوحدات · {scope.brand} · {scope.count} بند متوافق
      </Button>)}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md bg-muted/60 p-2">مرات الظهور<strong className="block text-base">{item.occurrence_count}</strong></div>
        <div className="rounded-md bg-muted/60 p-2">الفواتير المتأثرة<strong className="block text-base">{item.invoice_count}</strong></div>
      </div>
      {item.status === "matched"
        ? item.cost_review_count > 0 ? <div className="rounded-md bg-amber-50 p-2 text-sm text-amber-900">التكلفة تحتاج مراجعة · {item.cost_review_count} بند بدون تكلفة مؤكدة
          {item.cost_reasons?.map((reason: string) => <p key={reason}>{ACTUAL_UNIT_REASONS[reason] ?? reason}</p>)}</div>
          : <p className="text-sm text-emerald-800">الوحدات موثقة والتكلفة مكتملة</p>
        : <div className="rounded-md bg-red-50 p-2 text-sm text-red-800">{reasonLabel(item.reason)}</div>}
      {item.candidates?.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">{item.status === "matched" ? "الصنف المطابق في المخزون" : "مرشحون محتملون من المخزون"}</div>
          {item.candidates.map((candidate: any, index: number) => (
            <div key={`${candidate.stock_id ?? candidate.brand_name}-${index}`} className="rounded-lg border p-2 text-xs">
              <div className="font-semibold">{candidate.brand_name || "بدون اسم تجاري"}</div>
              <div className="text-muted-foreground">{candidate.generic || "بدون اسم علمي"} · {candidate.strength || "تركيز غير متاح"} · {candidate.unit || "وحدة غير متاحة"}</div>
              <div className="mt-1 grid grid-cols-2 gap-1">
                <span>المورد: {candidate.supplier || "غير متاح"}</span>
                <span>التكلفة: {money(candidate.cost_price)}</span>
                <span>Stock ID: {candidate.stock_id || "غير متاح"}</span>
                <span>Score: {candidate.match_score ?? "غير مدعوم"}</span>
              </div>
              {candidate.match_reasons?.length > 0 && <div className="mt-1 text-muted-foreground">الأسباب: {candidate.match_reasons.join(", ")}</div>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function InvoiceIssueCard({ invoice }: { invoice: any }) {
  return (
    <Card className="space-y-2 border-red-200 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">فاتورة {invoice.invoice_number || invoice.invoice_key || "غير محددة"}</div>
          <div className="text-xs text-muted-foreground">{invoice.beneficiary_name || "مستفيد غير محدد"} · {invoice.dispensing_date || "بدون تاريخ"}</div>
        </div>
        <StatusBadge status="incomplete" />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md bg-muted/60 p-2">الأصناف<strong className="block text-base">{invoice.item_count}</strong></div>
        <div className="rounded-md bg-red-50 p-2">Actual غير مطابق<strong className="block text-base">{invoice.actual_unmatched_count}</strong></div>
        <div className="rounded-md bg-amber-50 p-2">Actual مراجعة تكلفة<strong className="block text-base">{invoice.actual_cost_review_count}</strong></div>
        <div className="rounded-md bg-amber-50 p-2">PHIF تكلفة<strong className="block text-base">{invoice.phif_missing_cost_count}</strong></div>
      </div>
      <div className="space-y-1 text-sm">
        {invoice.reasons.map((reason: string) => <div key={reason} className="rounded-md bg-muted/50 px-2 py-1">{reason}</div>)}
      </div>
    </Card>
  );
}

function ManagementAuditPage() {
  const auditFn = useServerFn(getManagementAuditReport);
  const [nonce, setNonce] = useState(0);
  const [linkItems, setLinkItems] = useState<string[] | null>(null);
  const [unitItem, setUnitItem] = useState<string | null>(null);
  const [section, setSection] = useState<"actual" | "cost" | "financial">("actual");
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["management_audit", nonce],
    queryFn: () => auditFn({ data: { refreshNonce: nonce } }),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const actual = data?.actual;
  const financial = data?.financial;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-48">
          <ReportBackLink to="/management" label="الإدارة" />
          <h1 className="text-xl font-bold">مركز التدقيق</h1>
          <p className="text-sm text-muted-foreground">مطابقة Actual واكتمال التكلفة</p>
        </div>
        {data?.can_manage_links && <Button variant="outline" onClick={() => setLinkItems([])}><Link2 className="size-4" />الروابط اليدوية</Button>}
        <Button
          variant="outline"
          className="shrink-0 gap-2"
          disabled={isFetching}
          onClick={() => {
            setNonce((value) => value + 1);
            refetch();
          }}
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          إعادة التدقيق
        </Button>
      </div>

      {isLoading && <Card className="p-4 text-sm text-muted-foreground">جاري تشغيل التدقيق...</Card>}
      {error && <Card className="border-red-200 p-4 text-sm text-red-700">تعذر تشغيل التدقيق: {auditErrorMessage(error)}</Card>}

      {data?.profitability && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Link to="/management/reports/item-profit" search={{ month: "all", result: "loss" } as any}><Card className="border-red-200 p-3"><span className="text-xs">أصناف تُباع بخسارة</span><strong className="block text-xl text-red-700">{data.profitability.losingItems}</strong></Card></Link>
        <Link to="/management/reports/invoice-profit" search={{ month: "all", result: "loss" } as any}><Card className="border-red-200 p-3"><span className="text-xs">فواتير خاسرة</span><strong className="block text-xl text-red-700">{data.profitability.losingInvoices}</strong></Card></Link>
        <Link to="/management/reports/item-profit" search={{ month: "all", result: "incomplete" } as any}><Card className="border-amber-200 p-3"><span className="text-xs">بنود تنقصها تكلفة</span><strong className="block text-xl text-amber-800">{data.profitability.missingCosts}</strong></Card></Link>
      </div>}

      {data && actual && financial && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
            <MetricCard label="Actual فريدة" value={actual.summary.total_unique} />
            <MetricCard label="Matched" value={actual.summary.matched} tone="success" />
            <MetricCard label="Unmatched" value={actual.summary.unmatched} tone="danger" onClick={() => setSection("actual")} />
            <MetricCard label="Ambiguous" value={actual.summary.ambiguous} tone="warning" onClick={() => setSection("actual")} />
            <MetricCard label="مطابق · مراجعة تكلفة" value={actual.summary.cost_review} tone="warning" onClick={() => setSection("cost")} />
            <MetricCard label="نسبة المطابقة" value={percent(actual.summary.match_ratio)} tone={actual.summary.match_ratio === 1 ? "success" : "warning"} />
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <MetricCard label="فواتير مكتملة" value={financial.summary.complete_invoices} tone="success" />
            <MetricCard label="فواتير غير مكتملة" value={financial.summary.incomplete_invoices} tone="danger" onClick={() => setSection("financial")} />
            <MetricCard label="Actual غير مطابق" value={financial.summary.actual_unmatched_items} tone="danger" />
            <MetricCard label="بنود Actual · مراجعة تكلفة" value={financial.summary.actual_cost_review_items} tone="warning" onClick={() => setSection("cost")} />
            <MetricCard label="PHIF بلا تكلفة" value={financial.summary.phif_missing_cost_items} tone="warning" />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant={section === "actual" ? "default" : "outline"} onClick={() => setSection("actual")} className="gap-2">
              <AlertTriangle className="h-4 w-4" />
              تدقيق Actual
            </Button>
            <Button variant={section === "cost" ? "default" : "outline"} onClick={() => setSection("cost")}>
              مراجعة تكلفة Actual
            </Button>
            <Button variant={section === "financial" ? "default" : "outline"} onClick={() => setSection("financial")} className="gap-2">
              <ShieldCheck className="h-4 w-4" />
              التدقيق المالي
            </Button>
          </div>

          {section === "actual" && (
            <div className="space-y-3">
              {actual.issues.length === 0 ? (
                <Card className="flex items-center gap-2 border-emerald-200 p-4 text-emerald-800"><CheckCircle2 className="h-5 w-5" /> لا توجد مشاكل مطابقة Actual.</Card>
              ) : actual.issues.map((item: any) => <ActualIssueCard key={item.identity_key} item={item} onLink={data.can_manage_links ? setLinkItems : undefined} />)}
            </div>
          )}

          {section === "financial" && (
            <div className="space-y-3">
              {financial.incomplete_invoices.length === 0 ? (
                <Card className="flex items-center gap-2 border-emerald-200 p-4 text-emerald-800"><CheckCircle2 className="h-5 w-5" /> كل الفواتير مكتملة ماليًا.</Card>
              ) : financial.incomplete_invoices.map((invoice: any) => <InvoiceIssueCard key={invoice.invoice_id} invoice={invoice} />)}
            </div>
          )}
          {section === "cost" && (
            <div className="space-y-3">
              <ActualUnitAccessNotice access={data.unit_access} />
              <p className="text-sm text-teal-900">محسوب تلقائيًا بوحدة الأقراص المعتمدة أو التحقق المالي: {actual.summary.automatic_cost_items} بند. اقتراحات تحويل تحتاج اعتمادًا: {actual.summary.suggested_unit_items} بند.</p>
              <p className="text-xs text-muted-foreground">الحساب وفق أسعار المخزون المتاحة حاليًا، وليس إثباتًا لأسعار تاريخية.</p>
              {actual.cost_reviews.length === 0
                ? <Card className="p-4 text-sm text-emerald-800">لا توجد أصناف Actual مطابقة تحتاج مراجعة تكلفة.</Card>
                : actual.cost_reviews.map((item: any) => <ActualIssueCard key={item.identity_key} item={item} onLink={data.can_manage_links ? setLinkItems : undefined} onUnits={setUnitItem} />)}
              {actual.documented_units.length > 0 && <>
                <h2 className="font-semibold">مراجعة الوحدات المعتمدة وتعديلها أو إلغاؤها</h2>
                {actual.documented_units.map((item: any) => <ActualIssueCard key={`units-${item.identity_key}`} item={item} onUnits={setUnitItem} />)}
              </>}
              {actual.automatic_units.length > 0 && <details className="space-y-2">
                <summary className="cursor-pointer text-sm font-semibold">الأصناف المحسوبة تلقائيًا ومراجعة استثناءاتها</summary>
                {actual.automatic_units.map((item: any) => <ActualIssueCard key={`auto-${item.identity_key}`} item={item} onUnits={setUnitItem} />)}
              </details>}
            </div>
          )}
        </>
      )}
      {linkItems && data?.can_manage_links && <ActualStockLinks itemIds={linkItems} onClose={() => setLinkItems(null)} />}
      {unitItem && data && <ActualUnitEditor itemId={unitItem} access={data.unit_access} onClose={() => setUnitItem(null)} />}
    </div>
  );
}
