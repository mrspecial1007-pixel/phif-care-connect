import { createFileRoute, Link } from "@tanstack/react-router";
import { ReportBackLink } from "@/components/management/ReportBackLink";
import { InvoiceSummaryCard, formatMoney } from "@/components/management/InvoiceSummaryCard";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getActualProfitReport, getManagementReport } from "@/lib/management.functions";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/management/treasury")({
  component: TreasuryPage,
  head: () => ({ meta: [{ title: "خزينة الصرف — PHIF Tracker" }, { name: "description", content: "قيمة الفواتير والأصناف المصروفة" }, { property: "og:title", content: "خزينة الصرف — PHIF Tracker" }, { property: "og:description", content: "قيمة الفواتير والأصناف المصروفة" }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
});

function today() {
  return new Date().toISOString().slice(0, 10);
}

function money(value: number | null | undefined) {
  return (value ?? 0).toLocaleString("ar-LY", { maximumFractionDigits: 3 });
}

function TreasuryPage() {
  const reportFn = useServerFn(getManagementReport);
  const actualProfitFn = useServerFn(getActualProfitReport);
  const [dateFrom, setDateFrom] = useState(today());
  const [dateTo, setDateTo] = useState(today());
  const [source, setSource] = useState<"all" | "actual" | "phif">("all");
  const filters = useMemo(() => ({ dateFrom, dateTo, source }), [dateFrom, dateTo, source]);
  const profitFilters = useMemo(() => ({ dateFrom, dateTo }), [dateFrom, dateTo]);
  const { data, isLoading, error } = useQuery({
    queryKey: ["treasury_report", filters],
    queryFn: () => reportFn({ data: filters }),
  });
  const actualProfit = useQuery({
    queryKey: ["actual_profit_report", profitFilters],
    queryFn: () => actualProfitFn({ data: profitFilters }),
    retry: false,
  });
  const canShowActualProfit = Boolean(actualProfit.data) && !actualProfit.error;

  return (
    <div className="space-y-4" dir="rtl">
      <ReportBackLink to="/management" label="الإدارة" />
      <div>
        <h1 className="text-xl font-bold">خزينة الصرف</h1>
        <p className="text-sm text-muted-foreground">هذه الصفحة تعرض قيمة الأدوية المصروفة، ولا تعرض رصيدًا نقديًا فعليًا.</p>
      </div>
      <Card className="p-4 grid gap-3 md:grid-cols-3">
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <Select value={source} onValueChange={(v: any) => setSource(v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل المصادر</SelectItem>
            <SelectItem value="actual">Actual</SelectItem>
            <SelectItem value="phif">PHIF</SelectItem>
          </SelectContent>
        </Select>
      </Card>
      {error && <Card className="p-4 text-destructive">تعذر تحميل الخزينة: {(error as Error).message}</Card>}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="إجمالي قيمة الصرف" value={`${money(data?.total_dispensed_value)} د.ل`} />
        <Stat label="قيمة Actual" value={`${money(data?.actual_value)} د.ل`} />
        <Stat label="قيمة PHIF" value={`${money(data?.phif_value)} د.ل`} />
        <Stat label="عدد الفواتير" value={data?.invoice_count ?? 0} />
        <Stat label="عدد الأصناف" value={data?.item_count ?? 0} />
        <Stat label="المستفيدون" value={data?.unique_patient_count ?? 0} />
      </div>

      {canShowActualProfit && <ActualProfitSection data={actualProfit.data} isLoading={actualProfit.isLoading} />}

      <Card className="overflow-hidden">
        <div className="p-4 font-semibold border-b">تفاصيل الفواتير</div>
        <div className="divide-y">
          {isLoading && <div className="p-4 text-muted-foreground">جاري التحميل...</div>}
          {(data?.details ?? []).map((row: any) => (
            <Link key={row.id} to="/phif-invoices/$id" params={{ id: row.id }} className="block p-3 hover:bg-accent/40">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{row.invoice_number || row.invoice_key}</div>
                  <div className="text-xs text-muted-foreground">{row.beneficiary_name || "مستفيد غير مسجل"} · {row.dispensing_date || "بدون تاريخ"}</div>
                </div>
                <div className="text-left text-xs">
                  <div>{row.item_count} صنف</div>
                  <div>Actual {money(row.actual_value)} / PHIF {money(row.phif_value)}</div>
                </div>
              </div>
            </Link>
          ))}
          {!isLoading && (data?.details ?? []).length === 0 && <div className="p-4 text-center text-muted-foreground">لا توجد نتائج</div>}
        </div>
      </Card>
    </div>
  );
}

function ActualProfitSection({ data, isLoading }: { data: any; isLoading: boolean }) {
  return (
    <Card className="overflow-hidden border-emerald-100">
      <div className="border-b p-4">
        <div className="font-semibold">أرباح Actual</div>
        <div className="text-xs text-muted-foreground">حساب قراءة فقط للأصناف Actual المطابقة لمخزون PHIF، ولا يشمل PHIF Supplier.</div>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
        <Stat label="أصناف Actual" value={data?.total_actual_items ?? 0} />
        <Stat label="قيمة Actual" value={`${money(data?.total_actual_value)} د.ل`} />
        <Stat label="مرتبطة التكلفة" value={data?.matched_item_count ?? 0} />
        <Stat label="تحتاج مراجعة" value={data?.review_item_count ?? 0} />
        <Stat label="تكلفة معروفة" value={`${money(data?.known_purchase_cost)} د.ل`} />
        <Stat label="هامش معروف" value={`${money(data?.known_gross_margin)} د.ل`} />
        <Stat label="نسبة التغطية" value={`${Math.round((data?.coverage_ratio ?? 0) * 100)}%`} />
      </div>
      <div className="grid gap-2 p-4">
        {isLoading && <div className="p-4 text-center text-muted-foreground">جاري التحميل...</div>}
        {(data?.details ?? []).map((row: any, index: number) => (
          <Card key={`${row.invoice_id}-${index}`} className="p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold break-words">{row.item_name || "—"}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {row.invoice_number || "—"} · {row.dispensing_date || "—"} · {row.quantity ?? "—"}
                </div>
              </div>
              <div className="shrink-0 text-left text-xs text-muted-foreground">
                {statusLabel(row.match_status, row.match_reason)}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <Stat label="قيمة الفاتورة" value={`${money(row.invoice_value)} د.ل`} />
              <Stat label="تكلفة الشراء" value={row.purchase_cost === null ? "—" : `${money(row.purchase_cost)} د.ل`} />
              <Stat label="الربح" value={row.gross_margin === null ? "—" : `${money(row.gross_margin)} د.ل`} />
            </div>
          </Card>
        ))}
        {!isLoading && (data?.details ?? []).length === 0 && (
          <div className="p-4 text-center text-muted-foreground">لا توجد أصناف Actual في الفترة</div>
        )}
      </div>
    </Card>
  );
}

function statusLabel(status: string, reason: string) {
  if (status === "matched") return "مطابق";
  if (status === "pricing_unit_unverified") return "وحدة السعر غير مؤكدة";
  if (reason === "ambiguous_match") return "مطابقة متعددة";
  if (reason === "unsafe_identity") return "هوية غير كافية";
  return "يحتاج مراجعة مطابقة";
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold mt-1">{value}</div>
    </Card>
  );
}
