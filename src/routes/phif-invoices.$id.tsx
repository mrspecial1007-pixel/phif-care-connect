import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Gate } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { getPhifInvoiceDetail } from "@/lib/phif-invoices.functions";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Package,
  Printer,
  ReceiptText,
  UserRound,
  WalletCards,
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
    <div className="mx-auto max-w-5xl space-y-4 pb-20 print:max-w-none print:pb-0" dir="rtl">
      <PageActions />

      <Card className="overflow-hidden border-cyan-100 bg-gradient-to-br from-white via-cyan-50/40 to-white p-4 shadow-sm print:shadow-none">
        <div className="grid gap-4 md:grid-cols-[1fr_260px] md:items-start">
          <div className="min-w-0 space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <UserRound className="h-4 w-4 text-cyan-700" />
              المستفيد
            </div>
            <h1 className="break-words text-2xl font-bold leading-tight text-slate-950">
              {invoice.beneficiary_name || "مستفيد غير معروف"}
            </h1>
            <div className="grid gap-2 sm:grid-cols-2">
              <CopyField label="رقم البطاقة" value={invoice.insurance_card_number || "غير متوفر"} />
              <CopyField label="مفتاح الفاتورة" value={invoice.invoice_key} />
            </div>
          </div>

          <div className="rounded-xl border border-cyan-100 bg-white/80 p-4 md:text-left print:border-slate-200">
            <div className="flex items-center justify-between gap-2 md:flex-row-reverse">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ReceiptText className="h-4 w-4 text-cyan-800" />
                فاتورة PHIF
              </div>
              <MatchBadge matched={invoice.match_status === "matched"} />
            </div>
            <div className="mt-2 break-words text-4xl font-black tracking-normal text-slate-950" dir="ltr">
              {invoice.invoice_number || invoice.invoice_key}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <IconMetric icon={<CreditCard className="h-4 w-4" />} label="تاريخ الصرف" value={formatDate(invoice.dispensing_date)} />
              <IconMetric icon={<Clock className="h-4 w-4" />} label="وقت الصرف" value={invoice.dispensing_time || "غير متوفر"} dir="ltr" />
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="عدد الأصناف" value={`${invoice.items.length} صنف`} icon={<Package className="h-5 w-5" />} />
        <SummaryCard label="إجمالي الفاتورة" value={formatMoney(summary.total)} tone="blue" icon={<WalletCards className="h-5 w-5" />} />
        <SummaryCard label="مبلغ التأمين" value={formatMoney(summary.insurance)} tone="green" icon={<CheckCircle2 className="h-5 w-5" />} />
        <SummaryCard label="خارج التأمين" value={formatMoney(summary.outside)} tone="red" icon={<WalletCards className="h-5 w-5" />} />
      </div>

      <Card className="p-4 shadow-sm print:shadow-none">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-cyan-900" />
            <h2 className="text-lg font-bold">الأصناف المصروفة</h2>
          </div>
          <Badge variant="secondary">{invoice.items.length} أصناف</Badge>
        </div>

        {invoice.items.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
            لا توجد أصناف محفوظة لهذه الفاتورة.
          </div>
        ) : (
          <div className="grid gap-3 md:hidden">
            {invoice.items.map((item, index) => (
              <InvoiceItemCard key={item.id} item={item} index={index} />
            ))}
          </div>
        )}

        {invoice.items.length > 0 && (
          <div className="hidden overflow-hidden rounded-xl border md:block">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-cyan-50/60 text-muted-foreground">
                <tr>
                  <th className="w-14 border-b p-3 text-right">#</th>
                  <th className="border-b p-3 text-right">الاسم العلمي / التجاري</th>
                  <th className="border-b p-3 text-right">التركيز</th>
                  <th className="border-b p-3 text-right">الكمية</th>
                  <th className="border-b p-3 text-right">المصدر</th>
                  <th className="border-b p-3 text-right">المبلغ</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item, index) => (
                  <tr key={item.id} className="border-b last:border-b-0">
                    <td className="p-3">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-50 font-semibold text-cyan-900">
                        {index + 1}
                      </span>
                    </td>
                    <td className="min-w-0 p-3">
                      <div className="font-semibold text-slate-950" dir="ltr">{item.active_ingredient || "صنف بدون اسم علمي"}</div>
                      <ItemSubline item={item} />
                    </td>
                    <td className="p-3 font-medium" dir="ltr">{item.strength || "غير متوفر"}</td>
                    <td className="p-3 font-medium" dir="ltr">{item.quantity ?? "غير متوفر"}</td>
                    <td className="p-3"><SourceBadge item={item} /></td>
                    <td className="p-3 font-semibold" dir="ltr">{formatMoney(itemFinancialAmount(item))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-4 shadow-sm print:shadow-none">
        <div className="mb-3 flex items-center gap-2">
          <WalletCards className="h-5 w-5 text-cyan-900" />
          <h2 className="text-lg font-bold">ملخص الفاتورة</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <TotalPanel label="إجمالي الفاتورة" value={summary.total} tone="blue" />
          <TotalPanel label="مبلغ التأمين" value={summary.insurance} tone="green" />
          <TotalPanel label="خارج التأمين" value={summary.outside} tone="red" />
        </div>
      </Card>

      <Card className="p-4 print:hidden">
        <Accordion type="single" collapsible>
          <AccordionItem value="extra" className="border-0">
            <AccordionTrigger className="py-0 text-base font-semibold hover:no-underline">
              تفاصيل إضافية
            </AccordionTrigger>
            <AccordionContent className="pt-4">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Info label="حالة PHIF" value={invoice.status || "غير متوفرة"} />
                <Info label="تاريخ الحفظ" value={formatDateTime(invoice.synced_at)} />
                <Info label="معرّف الفاتورة" value={invoice.id} dir="ltr" />
                <Info label="حالة المراجعة" value={invoice.review_status || "غير متوفرة"} />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>
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
        طباعة الفاتورة
      </Button>
    </div>
  );
}

function InvoiceItemCard({ item, index }: { item: any; index: number }) {
  return (
    <div className="rounded-xl border bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">#{index + 1}</div>
          <div className="mt-1 break-words font-bold text-slate-950" dir="ltr">
            {item.active_ingredient || "صنف بدون اسم علمي"}
          </div>
          <ItemSubline item={item} />
        </div>
        <SourceBadge item={item} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <MiniMetric label="التركيز" value={item.strength || "غير متوفر"} />
        <MiniMetric label="الكمية" value={item.quantity === null ? "غير متوفرة" : String(item.quantity)} />
        <MiniMetric label="المبلغ" value={formatMoney(itemFinancialAmount(item))} />
      </div>
    </div>
  );
}

function ItemSubline({ item }: { item: any }) {
  if (item.source_classification === "phif-supplier") {
    return <div className="mt-1 text-sm text-cyan-800">PHIF Supplier</div>;
  }
  return (
    <div className="mt-1 break-words text-sm text-muted-foreground" dir="ltr">
      {item.brand || "اسم تجاري غير متوفر"}
    </div>
  );
}

function SourceBadge({ item }: { item: any }) {
  const phif = item.source_classification === "phif-supplier";
  return (
    <Badge className={`border-0 ${phif ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"}`}>
      {phif ? "PHIF Supplier" : "Actual Supplier"}
    </Badge>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-cyan-50/60 p-3">
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 truncate font-semibold text-slate-950" dir="ltr">{value}</div>
      </div>
      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => navigator.clipboard?.writeText(value)}>
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}

function IconMetric({ icon, label, value, dir }: { icon: ReactNode; label: string; value: string; dir?: "rtl" | "ltr" }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-cyan-900">{icon}</span>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="font-semibold text-slate-950" dir={dir}>{value}</div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tone?: "neutral" | "blue" | "green" | "red";
}) {
  const toneClass = {
    neutral: "bg-slate-50 text-slate-900",
    blue: "bg-blue-50 text-blue-900",
    green: "bg-emerald-50 text-emerald-900",
    red: "bg-red-50 text-red-900",
  }[tone];
  return (
    <div className={`rounded-xl border p-4 ${toneClass}`}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/70">{icon}</span>
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-1 truncate text-lg font-bold" dir="ltr">{value}</div>
        </div>
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-cyan-50/60 p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-semibold" dir="ltr">{value}</div>
    </div>
  );
}

function TotalPanel({ label, value, tone }: { label: string; value: number | null; tone: "blue" | "green" | "red" }) {
  const toneClass = {
    blue: "bg-blue-50 text-blue-800",
    green: "bg-emerald-50 text-emerald-800",
    red: "bg-red-50 text-red-700",
  }[tone];
  return (
    <div className={`rounded-xl p-4 text-center ${toneClass}`}>
      <div className="text-sm">{label}</div>
      <div className="mt-1 text-2xl font-black" dir="ltr">{formatMoney(value)}</div>
      <div className="text-sm">دينار ليبي</div>
    </div>
  );
}

function MatchBadge({ matched }: { matched: boolean }) {
  return (
    <Badge className={`border-0 px-3 py-1 text-sm ${matched ? "bg-teal-600 text-white" : "bg-amber-100 text-amber-800"}`}>
      {matched ? "مطابق" : "غير مطابق"}
    </Badge>
  );
}

function Info({ label, value, dir }: { label: string; value: string; dir?: "rtl" | "ltr" }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-medium" dir={dir}>
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
