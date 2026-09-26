import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Gate } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getPhifInvoiceDetail } from "@/lib/phif-invoices.functions";
import {
  ArrowRight,
  Calendar,
  Clock,
  Copy,
  Package,
  Printer,
  ReceiptText,
  UserRound,
} from "lucide-react";

export const Route = createFileRoute("/phif-invoices/$id")({
  component: () => (
    <Gate>
      <PhifInvoiceDetailPage />
    </Gate>
  ),
});

function PhifInvoiceDetailPage() {
  const { id } = Route.useParams();
  const getDetail = useServerFn(getPhifInvoiceDetail);
  const { data: invoice, isLoading, error } = useQuery({
    queryKey: ["phif_invoice_detail", id],
    queryFn: () => getDetail({ data: { id } }),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="py-12 text-center text-muted-foreground" dir="rtl">
        جاري تحميل الفاتورة...
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="space-y-4" dir="rtl">
        <PageActions />
        <Card className="p-6 text-center text-destructive">
          تعذر تحميل فاتورة PHIF. {error ? (error as Error).message : ""}
        </Card>
      </div>
    );
  }

  const summary = invoiceFinancialSummary(invoice.items);

  return (
    <div className="mx-auto max-w-5xl space-y-3 pb-20 print:max-w-none print:pb-0 print:text-slate-950" dir="rtl">
      <PageActions />

      <Card className="border-cyan-100 bg-white p-3 shadow-sm print:border-slate-200 print:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <UserRound className="h-3.5 w-3.5 text-cyan-700" />
              المستفيد
            </div>
            <h1 className="break-words text-base font-bold leading-snug text-slate-950 sm:text-lg">
              {invoice.beneficiary_name || "مستفيد غير معروف"}
            </h1>
            <CopyField compact label="رقم البطاقة" value={invoice.insurance_card_number || "غير متوفر"} />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <ReceiptText className="h-4 w-4 text-cyan-800" />
            <span className="text-sm font-semibold">فاتورة PHIF</span>
            <MatchBadge matched={invoice.match_status === "matched"} />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 border-t pt-3">
          <HeaderMetric icon={<ReceiptText className="h-3.5 w-3.5" />} label="رقم الفاتورة" value={invoice.invoice_number || invoice.invoice_key} />
          <HeaderMetric icon={<Calendar className="h-3.5 w-3.5" />} label="تاريخ الصرف" value={formatDate(invoice.dispensing_date)} />
          <HeaderMetric icon={<Clock className="h-3.5 w-3.5" />} label="وقت الصرف" value={invoice.dispensing_time || "غير متوفر"} dir="ltr" />
        </div>

        <details className="mt-2 rounded-lg border bg-slate-50/60 px-3 py-2 print:hidden">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">تفاصيل إضافية</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <CopyField compact label="مفتاح الفاتورة" value={invoice.invoice_key} />
            <Info label="حالة PHIF" value={invoice.status || "غير متوفرة"} />
            <Info label="تاريخ الحفظ" value={formatDateTime(invoice.synced_at)} />
            <Info label="حالة المراجعة" value={invoice.review_status || "غير متوفرة"} />
          </div>
        </details>
      </Card>

      <Card className="p-3 shadow-sm print:shadow-none">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-cyan-900" />
            <h2 className="text-base font-bold">الأصناف المصروفة</h2>
          </div>
          <Badge variant="secondary">{invoice.items.length} أصناف</Badge>
        </div>

        {invoice.items.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            لا توجد أصناف محفوظة لهذه الفاتورة.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border print:overflow-visible">
            <table className="w-full min-w-[620px] table-fixed border-collapse text-xs sm:text-sm print:min-w-0">
              <colgroup>
                <col className="w-[52%]" />
                <col className="w-[12%]" />
                <col className="w-[18%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead className="bg-cyan-50/60 text-muted-foreground">
                <tr>
                  <th className="border-b p-2 text-right">الصنف</th>
                  <th className="border-b p-2 text-center">الكمية</th>
                  <th className="border-b p-2 text-center">المصدر</th>
                  <th className="border-b p-2 text-center">القيمة</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item, index) => (
                  <tr key={item.id} className="align-top border-b last:border-b-0">
                    <td className="p-2">
                      <div className="flex gap-2">
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-cyan-50 text-xs font-semibold text-cyan-900">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="whitespace-normal break-words text-sm font-semibold leading-snug text-slate-950 [overflow-wrap:anywhere]" dir="ltr">
                            {itemNameWithStrength(item)}
                          </div>
                          {item.brand && (
                            <div className="mt-0.5 whitespace-normal break-words text-xs leading-snug text-muted-foreground [overflow-wrap:anywhere]" dir="ltr">
                              {item.brand}
                            </div>
                          )}
                          <details className="mt-1 text-[11px] text-muted-foreground print:hidden">
                            <summary className="cursor-pointer">تفاصيل الصنف</summary>
                            <div className="mt-1 space-y-0.5">
                              {item.supplier && <div className="break-words">المورد: <span dir="ltr">{item.supplier}</span></div>}
                              {item.phif_item_id && <div className="break-words">معرف PHIF: <span dir="ltr">{item.phif_item_id}</span></div>}
                            </div>
                          </details>
                        </div>
                      </div>
                    </td>
                    <td className="p-2 text-center font-medium" dir="ltr">{item.quantity ?? "غير متوفر"}</td>
                    <td className="p-2 text-center"><SourceLabel item={item} /></td>
                    <td className="p-2 text-center font-semibold" dir="ltr">{formatMoney(itemFinancialAmount(item))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-3 shadow-sm print:shadow-none">
        <div className="grid gap-2 sm:grid-cols-3">
          <TotalPanel label="إجمالي الفاتورة" value={summary.total} tone="blue" />
          <TotalPanel label="مبلغ التأمين" value={summary.insurance} tone="green" />
          <TotalPanel label="خارج التأمين" value={summary.outside} tone="red" />
        </div>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <Button variant="outline" className="gap-2" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          طباعة الفاتورة
        </Button>
        <Button asChild className="gap-2">
          <Link to="/phif-invoices">
            العودة إلى فواتير PHIF
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function PageActions() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
      <Button asChild variant="ghost" size="sm" className="gap-2">
        <Link to="/phif-invoices">
          <ArrowRight className="h-4 w-4" />
          العودة إلى فواتير PHIF
        </Link>
      </Button>
      <Button variant="outline" size="sm" className="gap-2" onClick={() => window.print()}>
        <Printer className="h-4 w-4" />
        طباعة
      </Button>
    </div>
  );
}

function CopyField({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg bg-cyan-50/60 ${compact ? "p-2" : "p-3"}`}>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="mt-0.5 truncate text-sm font-semibold text-slate-950" dir="ltr">{value}</div>
      </div>
      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => navigator.clipboard?.writeText(value)}>
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function HeaderMetric({ icon, label, value, dir }: { icon: ReactNode; label: string; value: string; dir?: "rtl" | "ltr" }) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-50 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <span className="text-cyan-900">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-0.5 truncate text-sm font-bold text-slate-950" dir={dir ?? "ltr"}>{value}</div>
    </div>
  );
}

function SourceLabel({ item }: { item: any }) {
  const phif = item.source_classification === "phif-supplier";
  return (
    <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-semibold ${phif ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"}`}>
      {phif ? "التأمين" : "المورد الفعلي"}
    </span>
  );
}

function itemNameWithStrength(item: any) {
  return [item.active_ingredient || "صنف بدون اسم علمي", item.strength].filter(Boolean).join(" ");
}

function TotalPanel({ label, value, tone }: { label: string; value: number | null; tone: "blue" | "green" | "red" }) {
  const toneClass = {
    blue: "bg-blue-50 text-blue-800",
    green: "bg-emerald-50 text-emerald-800",
    red: "bg-red-50 text-red-700",
  }[tone];
  return (
    <div className={`rounded-lg p-3 text-center ${toneClass}`}>
      <div className="text-xs">{label}</div>
      <div className="mt-1 text-lg font-black sm:text-xl" dir="ltr">{formatMoney(value)}</div>
    </div>
  );
}

function MatchBadge({ matched }: { matched: boolean }) {
  return (
    <Badge className={`border-0 px-2 py-0.5 text-xs ${matched ? "bg-teal-600 text-white" : "bg-amber-100 text-amber-800"}`}>
      {matched ? "مطابق" : "غير مطابق"}
    </Badge>
  );
}

function Info({ label, value, dir }: { label: string; value: string; dir?: "rtl" | "ltr" }) {
  return (
    <div className="rounded-md border bg-background p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-words text-xs font-medium" dir={dir}>
        {value}
      </div>
    </div>
  );
}

function invoiceFinancialSummary(items: any[]) {
  return items.reduce(
    (sum, item) => {
      sum.total += itemFinancialAmount(item) ?? 0;
      sum.insurance += readMoney(item.phif_financial_fields, ["insurance_amount", "insuranceAmount", "phifValue", "phif_value"]) ?? 0;
      sum.outside += readMoney(item.phif_financial_fields, ["outside_insurance_amount", "outsideInsuranceAmount", "outsideValue", "outside_insurance"]) ?? 0;
      return sum;
    },
    { total: 0, insurance: 0, outside: 0 },
  );
}

function itemFinancialAmount(item: any) {
  return readMoney(item.phif_financial_fields, ["total_amount", "totalAmount", "total", "itemTotal", "phifValue", "insurance_amount"]);
}

function readMoney(fields: Record<string, unknown> | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = fields?.[key];
    if (value === undefined || value === null || value === "") continue;
    const number = Number(String(value).replace(/[^\d.-]/g, ""));
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function formatMoney(value: number | null) {
  if (value === null) return "غير متوفر";
  return `${value.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} د.ل`;
}

function formatDate(value: string | null) {
  if (!value) return "غير متوفر";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-GB");
}

function formatDateTime(value: string | null) {
  if (!value) return "غير متوفر";
  return new Date(value).toLocaleString("en-GB");
}
