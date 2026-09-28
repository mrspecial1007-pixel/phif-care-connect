import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { Gate } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getMonthlyManagementReport, getOfficialMonthlyReportExport } from "@/lib/management.functions";

export const Route = createFileRoute("/management/reports")({
  component: () => <Gate><ReportsPage /></Gate>,
});

type SourceFilter = "all" | "actual" | "phif";
type GroupBy = "scientific" | "brand";
type SortBy = "quantity" | "beneficiaries" | "dispenses" | "value";
type Preset = "today" | "week" | "this_month" | "previous_month" | "month" | "custom";

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthBounds(value: string) {
  const [year, month] = value.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { from: iso(start), to: iso(end) };
}

function currentMonthValue() {
  return iso(new Date()).slice(0, 7);
}

function defaultRange() {
  return monthBounds(currentMonthValue());
}

function money(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return numeric.toLocaleString("ar-LY", { maximumFractionDigits: 3 });
}

function numberText(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return numeric.toLocaleString("ar-LY", { maximumFractionDigits: 2 });
}

function pct(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return `${(numeric * 100).toLocaleString("ar-LY", { maximumFractionDigits: 1 })}%`;
}

function sourceLabel(value: string) {
  if (value === "phif") return "PHIF Supplier";
  if (value === "actual") return "Actual Supplier";
  return "كل المصادر";
}

function ReportsPage() {
  const reportFn = useServerFn(getMonthlyManagementReport);
  const exportFn = useServerFn(getOfficialMonthlyReportExport);
  const initial = defaultRange();
  const [preset, setPreset] = useState<Preset>("this_month");
  const [month, setMonth] = useState(currentMonthValue());
  const [dateFrom, setDateFrom] = useState(initial.from);
  const [dateTo, setDateTo] = useState(initial.to);
  const [source, setSource] = useState<SourceFilter>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("scientific");
  const [sortBy, setSortBy] = useState<SortBy>("quantity");
  const [topLimit, setTopLimit] = useState<"10" | "20" | "50" | "all">("20");
  const [printMode, setPrintMode] = useState(false);
  const filters = useMemo(() => ({
    dateFrom,
    dateTo,
    source,
    groupBy,
    sortBy,
    topLimit: topLimit === "all" ? "all" as const : Number(topLimit),
  }), [dateFrom, dateTo, source, groupBy, sortBy, topLimit]);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["management_monthly_report", filters],
    queryFn: () => reportFn({ data: filters }),
  });

  const maxDaily = Math.max(...(data?.daily ?? []).map((row: any) => row.invoice_count), 1);

  function applyPreset(value: Preset) {
    setPreset(value);
    const now = new Date();
    if (value === "custom") return;
    if (value === "today") {
      const day = iso(now);
      setDateFrom(day);
      setDateTo(day);
      return;
    }
    if (value === "week") {
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const start = new Date(end);
      start.setUTCDate(end.getUTCDate() - 6);
      setDateFrom(iso(start));
      setDateTo(iso(end));
      return;
    }
    if (value === "previous_month") {
      const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const valueMonth = iso(previous).slice(0, 7);
      setMonth(valueMonth);
      const range = monthBounds(valueMonth);
      setDateFrom(range.from);
      setDateTo(range.to);
      return;
    }
    const selectedMonth = value === "month" ? month : currentMonthValue();
    const range = monthBounds(selectedMonth);
    setMonth(selectedMonth);
    setDateFrom(range.from);
    setDateTo(range.to);
  }

  function updateMonth(value: string) {
    setMonth(value);
    setPreset("month");
    const range = monthBounds(value);
    setDateFrom(range.from);
    setDateTo(range.to);
  }

  async function exportExcel() {
    const payload: any = await exportFn({ data: filters });
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const addSheet = (name: string, rows: Record<string, unknown>[]) => {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.length ? rows : [{ ملاحظة: "لا توجد بيانات" }]), name);
    };
    addSheet("الملخص", [
      { البند: "عدد الفواتير", القيمة: payload.summary.invoice_count },
      { البند: "المستفيدون الفريدون", القيمة: payload.summary.unique_patient_count },
      { البند: "عدد الأصناف", القيمة: payload.summary.item_count },
      { البند: "إجمالي قيمة الصرف", القيمة: payload.summary.total_dispensed_value },
    ]);
    addSheet("المستفيدون", payload.beneficiary_stats.beneficiaries.map((row: any) => ({
      "رقم البطاقة": row.card,
      "اسم المستفيد": row.name,
      "عدد الفواتير": row.invoice_count,
      "عدد الأصناف": row.item_count,
      "آخر صرف": row.last_dispensing_date,
      "مستفيد جديد": row.is_new === true ? "نعم" : row.is_new === false ? "لا" : "غير محدد",
    })));
    addSheet("الأصناف الأكثر صرفًا", payload.top_drugs.map((row: any) => ({
      "الاسم العلمي": row.active_ingredient,
      "التركيز": row.strength,
      "الشكل": row.dosage_form,
      "المصدر": sourceLabel(row.source),
      "الكمية": row.quantity,
      "عدد المستفيدين": row.unique_patient_count,
      "عدد مرات الصرف": row.dispense_count,
      "القيمة": row.total_value,
    })));
    addSheet("اليومي", payload.daily.map((row: any) => ({
      التاريخ: row.date,
      الفواتير: row.invoice_count,
      المستفيدون: row.unique_patient_count,
      الأصناف: row.item_count,
      "Actual Supplier": row.actual_value,
      "PHIF Supplier": row.phif_value,
      الإجمالي: row.total_value,
    })));
    addSheet("Actual vs PHIF", [
      { المصدر: "Actual Supplier", الأصناف: payload.source_split.actual.item_count, المستفيدون: payload.source_split.actual.patient_count, القيمة: payload.source_split.actual.value },
      { المصدر: "PHIF Supplier", الأصناف: payload.source_split.phif.item_count, المستفيدون: payload.source_split.phif.patient_count, القيمة: payload.source_split.phif.value },
    ]);
    addSheet("النقص", [{ الحالة: payload.shortages.available ? "متاح" : "غير متاح", ملاحظة: payload.shortages.message }]);
    addSheet("الجودة", [payload.quality]);
    addSheet("تقدير الاحتياج", payload.stock_consumption.map((row: any) => ({
      الصنف: row.brand_name ?? row.active_ingredient,
      التركيز: row.strength,
      "استهلاك الفترة": row.period_quantity,
      "المخزون الحالي": row.current_stock,
      "أيام التغطية": row.days_of_stock,
      "احتياج 30 يوم": row.next_month_need_estimate,
      الحالة: row.status,
    })));
    XLSX.writeFile(workbook, `phif-monthly-report-${dateFrom}-${dateTo}.xlsx`);
  }

  function printOfficialReport() {
    setPrintMode(true);
    window.setTimeout(() => {
      window.print();
      setPrintMode(false);
    }, 50);
  }

  return (
    <div className="space-y-4 print:bg-white">
      <div className="print:hidden">
        <h1 className="text-xl font-bold">التقارير التشغيلية</h1>
        <p className="text-sm text-muted-foreground">
          تقارير شهرية مبنية على فواتير PHIF المحفوظة فقط. الأرباح وسعر التكلفة تبقى في خزينة الصرف.
        </p>
      </div>

      <Card className="p-3 print:hidden">
        <div className="grid gap-3 md:grid-cols-4">
          <Select value={preset} onValueChange={(value: Preset) => applyPreset(value)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">اليوم</SelectItem>
              <SelectItem value="week">آخر 7 أيام</SelectItem>
              <SelectItem value="this_month">الشهر الحالي</SelectItem>
              <SelectItem value="previous_month">الشهر السابق</SelectItem>
              <SelectItem value="month">شهر محدد</SelectItem>
              <SelectItem value="custom">فترة مخصصة</SelectItem>
            </SelectContent>
          </Select>
          <Input type="month" value={month} onChange={(event) => updateMonth(event.target.value)} />
          <Input type="date" value={dateFrom} onChange={(event) => { setPreset("custom"); setDateFrom(event.target.value); }} />
          <Input type="date" value={dateTo} onChange={(event) => { setPreset("custom"); setDateTo(event.target.value); }} />
          <Select value={source} onValueChange={(value: SourceFilter) => setSource(value)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل المصادر</SelectItem>
              <SelectItem value="actual">Actual Supplier</SelectItem>
              <SelectItem value="phif">PHIF Supplier</SelectItem>
            </SelectContent>
          </Select>
          <Select value={groupBy} onValueChange={(value: GroupBy) => setGroupBy(value)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="scientific">حسب الاسم العلمي</SelectItem>
              <SelectItem value="brand">حسب الاسم التجاري</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(value: SortBy) => setSortBy(value)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="quantity">الأعلى كمية</SelectItem>
              <SelectItem value="beneficiaries">الأكثر مستفيدين</SelectItem>
              <SelectItem value="dispenses">الأكثر صرفًا</SelectItem>
              <SelectItem value="value">الأعلى قيمة</SelectItem>
            </SelectContent>
          </Select>
          <Select value={topLimit} onValueChange={(value: typeof topLimit) => setTopLimit(value)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="10">Top 10</SelectItem>
              <SelectItem value="20">Top 20</SelectItem>
              <SelectItem value="50">Top 50</SelectItem>
              <SelectItem value="all">كل الأصناف</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => refetch()} disabled={isLoading}>تحديث التقرير</Button>
          <Button variant="outline" onClick={exportExcel} disabled={!data || isLoading}>تصدير Excel</Button>
          <Button variant="outline" onClick={printOfficialReport} disabled={!data || isLoading}>إصدار التقرير الرسمي PDF</Button>
          <Button variant="secondary" asChild>
            <Link to="/management/treasury">عرض التحليل المالي</Link>
          </Button>
        </div>
      </Card>

      {error && (
        <Card className="p-4 text-destructive print:hidden">
          تعذر تحميل التقرير: {(error as Error).message}
        </Card>
      )}

      {isLoading && <Card className="p-4 print:hidden">جاري تحميل التقرير...</Card>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 print:hidden">
            <Stat label="المستفيدون" value={data.summary.unique_patient_count} />
            <Stat label="الفواتير" value={data.summary.invoice_count} />
            <Stat label="الأصناف" value={data.summary.item_count} />
            <Stat label="الأدوية الفريدة" value={data.summary.distinct_drug_count} />
            <Stat label="إجمالي الصرف" value={`${money(data.summary.total_dispensed_value)} د.ل`} />
            <Stat label="Actual Supplier" value={`${money(data.summary.actual_value)} د.ل`} />
            <Stat label="PHIF Supplier" value={`${money(data.summary.phif_value)} د.ل`} />
            <Stat label="مستفيدون جدد" value={data.summary.new_beneficiary_count} />
            <Stat label="متكررون" value={data.summary.repeat_beneficiary_count} />
            <Stat label="متوسط الأصناف/فاتورة" value={numberText(data.summary.average_items_per_invoice)} />
            <Stat label="أيام الصرف" value={data.summary.dispensing_day_count} />
            <Stat label="متوسط الفواتير اليومي" value={numberText(data.summary.average_daily_invoices)} />
          </div>

          <Section title="Actual Supplier vs PHIF Supplier">
            <div className="grid gap-3 md:grid-cols-2">
              <SourceCard label="Actual Supplier" row={data.source_split.actual} />
              <SourceCard label="PHIF Supplier" row={data.source_split.phif} />
            </div>
          </Section>

          <Section title="الأدوية الأكثر صرفًا">
            <CompactTable
              headers={["الصنف", "المصدر", "الكمية", "المستفيدون", "مرات الصرف", "القيمة"]}
              rows={data.top_drugs.map((row: any) => [
                <div key="drug">
                  <div className="font-semibold">{[row.active_ingredient ?? row.brand ?? "غير محدد", row.strength, row.dosage_form].filter(Boolean).join(" · ")}</div>
                  {row.brand && <div className="text-xs text-muted-foreground">{row.brand}</div>}
                </div>,
                sourceLabel(row.source),
                numberText(row.quantity),
                row.unique_patient_count,
                row.dispense_count,
                `${money(row.total_value)} د.ل`,
              ])}
            />
          </Section>

          <Section title="المستفيدون">
            <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs md:text-sm">
              <Mini label="مرة واحدة" value={data.beneficiary_stats.one_time_count} />
              <Mini label="مرتان" value={data.beneficiary_stats.two_time_count} />
              <Mini label="3 مرات فأكثر" value={data.beneficiary_stats.three_plus_count} />
            </div>
            <CompactTable
              headers={["المستفيد", "رقم البطاقة", "الفواتير", "الأصناف", "آخر صرف"]}
              rows={data.beneficiary_stats.beneficiaries.slice(0, 25).map((row: any) => [
                row.name ?? "غير محدد",
                <span key="card" className="font-mono">{row.card}</span>,
                row.invoice_count,
                row.item_count,
                row.last_dispensing_date ?? "—",
              ])}
            />
          </Section>

          <Section title="التقرير اليومي">
            <div className="space-y-2">
              {data.daily.map((row: any) => (
                <div key={row.date} className="grid grid-cols-[92px_1fr_64px] items-center gap-2 text-sm">
                  <span className="font-mono">{row.date}</span>
                  <div className="h-3 overflow-hidden rounded bg-muted">
                    <div className="h-full rounded bg-primary" style={{ width: `${Math.max(5, (row.invoice_count / maxDaily) * 100)}%` }} />
                  </div>
                  <span className="text-left">{row.invoice_count} فاتورة</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="المقارنة مع الشهر السابق">
            {data.comparison?.available ? (
              <div className="grid gap-2 md:grid-cols-5">
                <Compare label="الفواتير" row={data.comparison.invoice_count} />
                <Compare label="المستفيدون" row={data.comparison.unique_patient_count} />
                <Compare label="الأصناف" row={data.comparison.item_count} />
                <Compare label="الكمية" row={data.comparison.quantity_total} />
                <Compare label="القيمة" row={data.comparison.total_value} moneyValue />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">لا توجد بيانات كافية للمقارنة أو أن الفترة ليست شهرًا كاملًا.</p>
            )}
          </Section>

          <Section title="النقص وتقدير الاحتياج">
            <p className="mb-3 text-sm text-muted-foreground">{data.shortages.message}</p>
            <CompactTable
              headers={["الصنف", "استهلاك الفترة", "المخزون", "أيام التغطية", "الحالة"]}
              rows={data.stock_consumption.slice(0, 25).map((row: any) => [
                [row.brand_name ?? row.active_ingredient ?? "غير محدد", row.strength].filter(Boolean).join(" · "),
                numberText(row.period_quantity),
                numberText(row.current_stock),
                row.days_of_stock === null ? "تحتاج مراجعة وحدة" : numberText(row.days_of_stock),
                row.status === "risk" ? "خطر" : row.status === "watch" ? "مراقبة" : row.status === "sufficient" ? "كاف" : "مراجعة",
              ])}
            />
          </Section>

          <Section title="جودة البيانات والمطابقة">
            <div className="grid gap-2 md:grid-cols-3">
              <Mini label="بدون اسم علمي" value={data.quality.missing_generic} />
              <Mini label="بدون تركيز" value={data.quality.missing_strength} />
              <Mini label="بدون وحدة" value={data.quality.missing_unit} />
              <Mini label="فواتير ناقصة" value={data.quality.incomplete_invoices} />
              <Mini label="Actual يحتاج مطابقة" value={data.quality.unmatched_actual_items} />
              <Mini label="مصدر يحتاج مراجعة" value={data.quality.source_review_items} />
            </div>
            <div className="mt-3 rounded-md border p-3 text-sm">
              {data.reconciliation.available
                ? `مطابقة الفواتير: ${data.reconciliation.status === "balanced" ? "متوازنة" : "تحتاج مراجعة"} · الفرق ${money(data.reconciliation.difference ?? 0)} د.ل`
                : "لا تتوفر إجماليات فواتير موثقة كافية لإجراء المطابقة المالية الرسمية."}
            </div>
          </Section>

          <div className={printMode ? "block" : "hidden print:block"}>
            <OfficialReport report={data} />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border bg-background p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-4 print:hidden">
      <h2 className="mb-3 text-base font-bold">{title}</h2>
      {children}
    </Card>
  );
}

function SourceCard({ label, row }: { label: string; row: any }) {
  return (
    <div className="rounded-md border p-3">
      <div className="font-semibold">{label}</div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <Mini label="الأصناف" value={row.item_count} />
        <Mini label="الأدوية" value={row.drug_count} />
        <Mini label="المستفيدون" value={row.patient_count} />
        <Mini label="المساهمة" value={pct(row.contribution)} />
        <Mini label="الكمية" value={numberText(row.quantity)} />
        <Mini label="القيمة" value={`${money(row.value)} د.ل`} />
      </div>
    </div>
  );
}

function Compare({ label, row, moneyValue = false }: { label: string; row: any; moneyValue?: boolean }) {
  const delta = row.delta ?? 0;
  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-semibold">{moneyValue ? `${money(row.current)} د.ل` : numberText(row.current)}</div>
      <div className={delta >= 0 ? "text-emerald-700" : "text-destructive"}>
        {delta >= 0 ? "+" : ""}{moneyValue ? money(delta) : numberText(delta)}
        {row.percent !== null ? ` · ${row.percent.toLocaleString("ar-LY", { maximumFractionDigits: 1 })}%` : ""}
      </div>
    </div>
  );
}

function CompactTable({ headers, rows }: { headers: string[]; rows: Array<Array<ReactNode>> }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[680px] text-sm">
        <thead className="bg-muted/70">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 text-right font-semibold">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td className="px-3 py-4 text-center text-muted-foreground" colSpan={headers.length}>لا توجد بيانات</td></tr>
          ) : rows.map((row, index) => (
            <tr key={index} className="border-t">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2 align-top">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OfficialReport({ report }: { report: any }) {
  return (
    <div dir="rtl" className="mx-auto hidden max-w-4xl space-y-4 bg-white p-8 text-black print:block">
      <div className="border-b pb-4 text-center">
        <h1 className="text-xl font-bold">التقرير الشهري الرسمي لصيدلية الترياق الشافي</h1>
        <p className="text-sm">الفترة: {report.period.dateFrom} إلى {report.period.dateTo}</p>
      </div>
      <div className="grid grid-cols-4 gap-3 text-center text-sm">
        <Mini label="الفواتير" value={report.summary.invoice_count} />
        <Mini label="المستفيدون" value={report.summary.unique_patient_count} />
        <Mini label="الأصناف" value={report.summary.item_count} />
        <Mini label="القيمة الإجمالية" value={`${money(report.summary.total_dispensed_value)} د.ل`} />
      </div>
      <div>
        <h2 className="mb-2 font-bold">الأدوية الأكثر صرفًا</h2>
        <table className="w-full border-collapse text-sm">
          <thead><tr>{["الصنف", "المصدر", "الكمية", "المستفيدون", "القيمة"].map((header) => <th key={header} className="border p-2 text-right">{header}</th>)}</tr></thead>
          <tbody>
            {report.top_drugs.slice(0, 25).map((row: any) => (
              <tr key={row.key}>
                <td className="border p-2">{[row.active_ingredient ?? row.brand ?? "غير محدد", row.strength, row.dosage_form].filter(Boolean).join(" · ")}</td>
                <td className="border p-2">{sourceLabel(row.source)}</td>
                <td className="border p-2">{numberText(row.quantity)}</td>
                <td className="border p-2">{row.unique_patient_count}</td>
                <td className="border p-2">{money(row.total_value)} د.ل</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h2 className="mb-2 font-bold">ملاحظات رسمية</h2>
        <ul className="list-inside list-disc text-sm">
          {report.official_notes.map((note: string) => <li key={note}>{note}</li>)}
        </ul>
      </div>
    </div>
  );
}
