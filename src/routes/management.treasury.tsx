import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { InvoiceSummaryCard, formatMoney } from "@/components/management/InvoiceSummaryCard";
import { ReportBackLink } from "@/components/management/ReportBackLink";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getProfitAnalysisReport } from "@/lib/management.functions";
import { todayISOLocal } from "@/lib/date";

export const Route = createFileRoute("/management/treasury")({
  component: TreasuryPage,
  head: () => ({
    meta: [
      { title: "خزينة الصرف — PHIF Tracker" },
      { name: "description", content: "عرض فواتير الصرف وقيم Actual وPHIF Supplier والتكلفة والربح المعروف" },
      { property: "og:title", content: "خزينة الصرف — PHIF Tracker" },
      { property: "og:description", content: "عرض فواتير الصرف وقيم Actual وPHIF Supplier والتكلفة والربح المعروف" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function money(value: number | null | undefined) {
  return formatMoney(value);
}

function financialStatusLabel(invoice: any) {
  if (invoice?.financial_status === "complete") return "مكتملة";
  if (invoice?.financial_status === "incomplete_cost") return "تكلفة غير مكتملة";
  if (invoice?.financial_status === "actual_unmatched") return "Actual يحتاج مراجعة";
  if (invoice?.financial_status === "unit_review") return "وحدة تحتاج مراجعة";
  if ((invoice?.needs_match_count ?? 0) > 0) return "Actual يحتاج مراجعة";
  if ((invoice?.unit_review_count ?? 0) > 0) return "وحدة تحتاج مراجعة";
  if ((invoice?.needs_price_count ?? 0) > 0) return "تكلفة غير مكتملة";
  return "مكتملة";
}

function sourceLabel(source: string) {
  return source === "phif" ? "PHIF Supplier" : "Actual";
}

function TreasuryPage() {
  const reportFn = useServerFn(getProfitAnalysisReport);
  const [dateFrom, setDateFrom] = useState(todayISOLocal());
  const [dateTo, setDateTo] = useState(todayISOLocal());
  const [source, setSource] = useState<"all" | "actual" | "phif">("all");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const filters = useMemo(() => ({ dateFrom, dateTo, source }), [dateFrom, dateTo, source]);
  const { data, isLoading, error } = useQuery({
    queryKey: ["treasury_report", filters],
    queryFn: () => reportFn({ data: filters }),
    retry: false,
  });
  const selectedInvoice = data?.invoices?.find((invoice: any) => invoice.invoice_id === selectedInvoiceId) ?? null;

  return (
    <div className="space-y-4" dir="rtl">
      <ReportBackLink to="/management" label="الإدارة" />
      <div>
        <h1 className="text-xl font-bold">خزينة الصرف</h1>
        <p className="text-sm text-muted-foreground">
          هذه الصفحة تعرض فواتير الصرف وقيم الأصناف والتكلفة المعروفة، ولا تعرض رصيدًا نقديًا فعليًا.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Input aria-label="من تاريخ" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <Input aria-label="إلى تاريخ" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <Select value={source} onValueChange={(value) => setSource(value as "all" | "actual" | "phif")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل المصادر</SelectItem>
            <SelectItem value="actual">Actual</SelectItem>
            <SelectItem value="phif">PHIF Supplier</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && <Card className="p-4 text-destructive">تعذر تحميل الخزينة: {(error as Error).message}</Card>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="إجمالي قيمة الصرف" value={money(data?.summary?.total_revenue)} />
        <Stat label="قيمة Actual" value={money(data?.source_split?.actual?.revenue)} />
        <Stat label="قيمة PHIF Supplier" value={money(data?.source_split?.phif?.revenue)} />
        <Stat label="التكلفة المعروفة" value={money(data?.summary?.known_cost)} />
        <Stat label="الربح المعروف" value={money(data?.summary?.known_profit)} />
        <Stat label="تغطية التكلفة" value={`${Math.round((data?.summary?.coverage_ratio ?? 0) * 100)}%`} />
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold">الفواتير</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {isLoading && <div className="p-4 text-muted-foreground">جاري التحميل...</div>}
          {(data?.invoices ?? []).map((invoice: any) => (
            <InvoiceSummaryCard
              key={invoice.invoice_id}
              name={invoice.beneficiary_name}
              number={invoice.invoice_number || invoice.invoice_key}
              date={invoice.dispensing_date}
              count={invoice.item_count}
              revenue={invoice.revenue}
              cost={invoice.matched_count === invoice.item_count ? invoice.known_cost : null}
              profit={invoice.matched_count === invoice.item_count ? invoice.known_profit : null}
              status={financialStatusLabel(invoice)}
              onClick={() => setSelectedInvoiceId(invoice.invoice_id)}
            >
              <span className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <span>البطاقة: {invoice.insurance_card_number || "—"}</span>
                <span>Actual: {money(invoice.actual_value)}</span>
                <span>PHIF: {money(invoice.phif_value)}</span>
                <span>التغطية: {Math.round((invoice.cost_coverage_ratio ?? 0) * 100)}%</span>
              </span>
            </InvoiceSummaryCard>
          ))}
          {!isLoading && (data?.invoices ?? []).length === 0 && (
            <div className="p-4 text-center text-muted-foreground">لا توجد نتائج</div>
          )}
        </div>
      </section>

      <TreasuryInvoiceSheet invoice={selectedInvoice} onClose={() => setSelectedInvoiceId(null)} />
    </div>
  );
}

function TreasuryInvoiceSheet({ invoice, onClose }: { invoice: any; onClose: () => void }) {
  return (
    <Sheet open={Boolean(invoice)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-lg px-4 pb-8 pt-5 sm:mx-auto sm:max-w-2xl" dir="rtl">
        <SheetHeader className="text-right">
          <SheetTitle>تفاصيل الفاتورة {invoice?.invoice_number ?? invoice?.invoice_key}</SheetTitle>
        </SheetHeader>
        {invoice && (
          <div className="mt-4 space-y-4">
            <Card className="p-3 text-sm">
              <div className="font-semibold">{invoice.beneficiary_name || "مستفيد غير محدد"}</div>
              <div className="text-xs text-muted-foreground">
                {invoice.insurance_card_number || "بدون بطاقة"} · {invoice.dispensing_date || "بدون تاريخ"} · {financialStatusLabel(invoice)}
              </div>
            </Card>

            <div className="space-y-2">
              {invoice.items.map((item: any) => (
                <Card key={item.item_id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="break-words font-semibold">{item.brand || item.item_name || "صنف غير محدد"}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.active_ingredient || "—"} · {item.strength || "—"} · {sourceLabel(item.source)} · الكمية {item.quantity_label ?? item.quantity ?? "—"}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs">
                      {item.match_status === "matched" ? "مكتمل" : "مراجعة"}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                    <Stat label="قيمة الصرف" value={money(item.invoice_value)} />
                    <Stat label="سعر الشراء" value={item.unit_purchase_price === null ? "غير مدخل" : money(item.unit_purchase_price)} />
                    <Stat label="تكلفة الصنف" value={item.purchase_cost === null ? "غير مكتملة" : money(item.purchase_cost)} />
                    <Stat label="الربح" value={item.gross_margin === null ? "غير مكتمل" : money(item.gross_margin)} />
                    <Stat label="الوحدة" value={item.unit || "تحتاج مراجعة"} />
                    <Stat label="المصدر" value={sourceLabel(item.source)} />
                  </div>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Stat label="إجمالي الفاتورة" value={money(invoice.revenue)} />
              <Stat label="إجمالي التكلفة" value={invoice.matched_count === invoice.item_count ? money(invoice.known_cost) : "غير مكتملة"} />
              <Stat label="إجمالي الربح" value={invoice.matched_count === invoice.item_count ? money(invoice.known_profit) : "غير مكتمل"} />
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-base font-bold">{value}</div>
    </Card>
  );
}
