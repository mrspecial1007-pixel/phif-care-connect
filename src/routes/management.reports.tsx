import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { Gate } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  getMonthlyManagementReport,
  getOfficialMonthlyReportExport,
  getProfitAnalysisReport,
  getReportItemTracking,
  savePhifSupplierSalePrice,
  searchReportItems,
} from "@/lib/management.functions";

export const Route = createFileRoute("/management/reports")({
  component: () => <Gate><ReportsPage /></Gate>,
});

type SourceFilter = "all" | "actual" | "phif";
type GroupBy = "scientific" | "brand";
type SortBy = "quantity" | "beneficiaries" | "dispenses" | "value";
type Preset = "today" | "yesterday" | "week" | "this_month" | "previous_month" | "month" | "custom";
type ReportMode = "overview" | "item" | "profit";

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

function statusLabel(status: string, reason?: string) {
  if (status === "matched") return "محسوب";
  if (status === "needs_sale_price") return "يحتاج سعر بيع";
  if (status === "pricing_unit_unverified") return "وحدة السعر غير مؤكدة";
  if (reason === "ambiguous_match") return "مطابقة متعددة";
  if (reason === "unsafe_identity") return "هوية غير كافية";
  return "يحتاج مراجعة";
}

function ReportsPage() {
  const queryClient = useQueryClient();
  const monthlyFn = useServerFn(getMonthlyManagementReport);
  const exportFn = useServerFn(getOfficialMonthlyReportExport);
  const searchFn = useServerFn(searchReportItems);
  const trackingFn = useServerFn(getReportItemTracking);
  const profitFn = useServerFn(getProfitAnalysisReport);
  const saveSalePriceFn = useServerFn(savePhifSupplierSalePrice);
  const initial = defaultRange();
  const [mode, setMode] = useState<ReportMode>("overview");
  const [preset, setPreset] = useState<Preset>("this_month");
  const [month, setMonth] = useState(currentMonthValue());
  const [dateFrom, setDateFrom] = useState(initial.from);
  const [dateTo, setDateTo] = useState(initial.to);
  const [source, setSource] = useState<SourceFilter>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("scientific");
  const [sortBy, setSortBy] = useState<SortBy>("quantity");
  const [topLimit, setTopLimit] = useState<"10" | "20" | "50" | "all">("20");
  const [printMode, setPrintMode] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);
  const [selectedBeneficiary, setSelectedBeneficiary] = useState<any | null>(null);
  const [salePriceDraft, setSalePriceDraft] = useState<Record<string, string>>({});
  const filters = useMemo(() => ({
    dateFrom,
    dateTo,
    source,
    groupBy,
    sortBy,
    topLimit: topLimit === "all" ? "all" as const : Number(topLimit),
  }), [dateFrom, dateTo, source, groupBy, sortBy, topLimit]);

  const monthly = useQuery({
    queryKey: ["management_monthly_report", filters],
    queryFn: () => monthlyFn({ data: filters }),
  });
  const suggestions = useQuery({
    queryKey: ["report_item_search", itemSearch, dateFrom, dateTo],
    queryFn: () => searchFn({ data: { search: itemSearch, dateFrom, dateTo } }),
    enabled: itemSearch.trim().length >= 2,
  });
  const tracking = useQuery({
    queryKey: ["report_item_tracking", selectedItem?.identity_key, dateFrom, dateTo, groupBy],
    queryFn: () => trackingFn({ data: { search: itemSearch || "aa", identityKey: selectedItem.identity_key, dateFrom, dateTo, groupBy } }),
    enabled: Boolean(selectedItem),
  });
  const profit = useQuery({
    queryKey: ["management_profit_analysis", dateFrom, dateTo, source],
    queryFn: () => profitFn({ data: { dateFrom, dateTo, source } }),
    enabled: mode === "profit",
    retry: false,
  });
  const saveSale = useMutation({
    mutationFn: (input: { itemId: string; salePrice: number }) => saveSalePriceFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["management_profit_analysis"] });
      queryClient.invalidateQueries({ queryKey: ["report_item_tracking"] });
    },
  });

  const report = monthly.data;
  const maxDaily = Math.max(...(report?.daily ?? []).map((row: any) => row.invoice_count), 1);

  function applyPreset(value: Preset) {
    setPreset(value);
    const now = new Date();
    if (value === "custom") return;
    if (value === "today" || value === "yesterday") {
      const dayValue = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      if (value === "yesterday") dayValue.setUTCDate(dayValue.getUTCDate() - 1);
      const day = iso(dayValue);
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
      "الكمية": row.formatted_quantity ?? row.quantity,
      "عدد المستفيدين": row.unique_patient_count,
      "عدد مرات الصرف": row.dispense_count,
      "القيمة": row.total_value,
    })));
    addSheet("اليومي", payload.daily);
    addSheet("Actual vs PHIF", [
      { المصدر: "Actual Supplier", الأصناف: payload.source_split.actual.item_count, المستفيدون: payload.source_split.actual.patient_count, القيمة: payload.source_split.actual.value },
      { المصدر: "PHIF Supplier", الأصناف: payload.source_split.phif.item_count, المستفيدون: payload.source_split.phif.patient_count, القيمة: payload.source_split.phif.value },
    ]);
    addSheet("الجودة", [payload.quality]);
    addSheet("تقدير الاحتياج", payload.stock_consumption);
    XLSX.writeFile(workbook, `phif-monthly-report-${dateFrom}-${dateTo}.xlsx`);
  }

  function printOfficialReport() {
    setPrintMode(true);
    window.setTimeout(() => {
      window.print();
      setPrintMode(false);
    }, 50);
  }

  function saveSupplierPrice(row: any) {
    const raw = salePriceDraft[row.item_id];
    const salePrice = Number(raw);
    if (!Number.isFinite(salePrice) || salePrice < 0) return;
    saveSale.mutate({ itemId: row.item_id, salePrice });
  }

  return (
    <div className="space-y-4 print:bg-white" dir="rtl">
      <div className="print:hidden">
        <h1 className="text-xl font-bold">مركز التقارير</h1>
        <p className="text-sm text-muted-foreground">
          تقارير تشغيلية وإدارية من فواتير PHIF المحفوظة. التقرير الرسمي لا يكشف التكلفة أو الأرباح.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 print:hidden">
        <ModeButton active={mode === "overview"} title="التقرير الشامل" desc="ملخص الصرف والمصادر" onClick={() => setMode("overview")} />
        <ModeButton active={mode === "item"} title="تتبع صنف" desc="حركة صنف محدد" onClick={() => setMode("item")} />
        <ModeButton active={mode === "profit"} title="تحليل الأرباح" desc="داخلي ومحمي" onClick={() => setMode("profit")} />
      </div>

      <Card className="p-3 print:hidden">
        <div className="grid gap-3 md:grid-cols-4">
          <Select value={preset} onValueChange={(value: Preset) => applyPreset(value)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">اليوم</SelectItem>
              <SelectItem value="yesterday">أمس</SelectItem>
              <SelectItem value="week">آخر 7 أيام</SelectItem>
              <SelectItem value="this_month">هذا الشهر</SelectItem>
              <SelectItem value="previous_month">الشهر السابق</SelectItem>
              <SelectItem value="month">شهر محدد</SelectItem>
              <SelectItem value="custom">نطاق مخصص</SelectItem>
            </SelectContent>
          </Select>
          <Input type="month" value={month} onChange={(event) => updateMonth(event.target.value)} />
          <Input type="date" value={dateFrom} onChange={(event) => { setPreset("custom"); setDateFrom(event.target.value); }} />
          <Input type="date" value={dateTo} onChange={(event) => { setPreset("custom"); setDateTo(event.target.value); }} />
          <Select value={source} onValueChange={(value: SourceFilter) => setSource(value)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل المصادر</SelectItem>
              <SelectItem value="actual">Actual</SelectItem>
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
          <Button onClick={() => monthly.refetch()} disabled={monthly.isLoading}>تحديث</Button>
          <Button variant="outline" onClick={exportExcel} disabled={!report || monthly.isLoading}>تصدير Excel رسمي</Button>
          <Button variant="outline" onClick={printOfficialReport} disabled={!report || monthly.isLoading}>طباعة التقرير الرسمي</Button>
          <Button variant="secondary" asChild>
            <Link to="/management/treasury">الخزينة</Link>
          </Button>
        </div>
      </Card>

      {monthly.error && <Card className="p-4 text-destructive print:hidden">تعذر تحميل التقرير: {(monthly.error as Error).message}</Card>}
      {monthly.isLoading && <Card className="p-4 print:hidden">جاري تحميل البيانات...</Card>}

      {mode === "overview" && report && (
        <OverviewReport report={report} maxDaily={maxDaily} />
      )}

      {mode === "item" && (
        <ItemTrackingReport
          itemSearch={itemSearch}
          setItemSearch={setItemSearch}
          suggestions={suggestions.data ?? []}
          selectedItem={selectedItem}
          setSelectedItem={setSelectedItem}
          tracking={tracking}
        />
      )}

      {mode === "profit" && (
        <ProfitReport
          profit={profit}
          selectedInvoice={selectedInvoice}
          setSelectedInvoice={setSelectedInvoice}
          selectedBeneficiary={selectedBeneficiary}
          setSelectedBeneficiary={setSelectedBeneficiary}
          salePriceDraft={salePriceDraft}
          setSalePriceDraft={setSalePriceDraft}
          saveSupplierPrice={saveSupplierPrice}
          saving={saveSale.isPending}
        />
      )}

      {report && (
        <div className={printMode ? "block" : "hidden print:block"}>
          <OfficialReport report={report} />
        </div>
      )}
    </div>
  );
}

function ModeButton({ active, title, desc, onClick }: { active: boolean; title: string; desc: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-3 text-right transition ${active ? "border-primary bg-primary/10 text-primary" : "bg-card hover:bg-accent/50"}`}
    >
      <div className="text-sm font-bold">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{desc}</div>
    </button>
  );
}

function OverviewReport({ report, maxDaily }: { report: any; maxDaily: number }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 print:hidden">
        <Stat label="إجمالي الصرف" value={`${money(report.summary.total_dispensed_value)} د.ل`} />
        <Stat label="قيمة Actual" value={`${money(report.summary.actual_value)} د.ل`} />
        <Stat label="قيمة PHIF Supplier" value={`${money(report.summary.phif_value)} د.ل`} />
        <Stat label="الفواتير" value={report.summary.invoice_count} />
        <Stat label="المستفيدون" value={report.summary.unique_patient_count} />
        <Stat label="الأصناف" value={report.summary.item_count} />
        <Stat label="الأدوية الفريدة" value={report.summary.distinct_drug_count} />
        <Stat label="متوسط الأصناف/فاتورة" value={numberText(report.summary.average_items_per_invoice)} />
      </div>

      <Section title="Actual Supplier vs PHIF Supplier">
        <div className="grid gap-3 md:grid-cols-2">
          <SourceCard label="Actual Supplier" row={report.source_split.actual} />
          <SourceCard label="PHIF Supplier" row={report.source_split.phif} />
        </div>
      </Section>

      <Section title="الأدوية الأكثر صرفًا">
        <div className="space-y-2">
          {report.top_drugs.map((row: any) => (
            <DrugCard key={row.key} row={row} />
          ))}
          {report.top_drugs.length === 0 && <EmptyState text="لا توجد أصناف في الفترة المحددة." />}
        </div>
      </Section>

      <Section title="أعلى المستفيدين إيرادًا">
        <div className="grid gap-2 md:grid-cols-2">
          {report.beneficiary_stats.beneficiaries.slice(0, 10).map((row: any) => (
            <Card key={row.card} className="p-3">
              <div className="font-semibold">{row.name ?? "غير محدد"}</div>
              <div className="font-mono text-xs text-muted-foreground">{row.card}</div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <Mini label="الفواتير" value={row.invoice_count} />
                <Mini label="الأصناف" value={row.item_count} />
                <Mini label="الإيراد" value={`${money(row.total_value)} د.ل`} />
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="التقرير اليومي">
        <div className="space-y-2">
          {report.daily.map((row: any) => (
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

      <Section title="جودة البيانات والمطابقة">
        <div className="grid gap-2 md:grid-cols-3">
          <Mini label="بدون اسم علمي" value={report.quality.missing_generic} />
          <Mini label="بدون تركيز" value={report.quality.missing_strength} />
          <Mini label="بدون وحدة" value={report.quality.missing_unit} />
          <Mini label="فواتير ناقصة" value={report.quality.incomplete_invoices} />
          <Mini label="Actual يحتاج مطابقة" value={report.quality.unmatched_actual_items} />
          <Mini label="مصدر يحتاج مراجعة" value={report.quality.source_review_items} />
        </div>
      </Section>
    </>
  );
}

function ItemTrackingReport({ itemSearch, setItemSearch, suggestions, selectedItem, setSelectedItem, tracking }: any) {
  const data = tracking.data;
  return (
    <div className="space-y-3">
      <Card className="p-3">
        <label className="text-xs text-muted-foreground">ابحث باسم الصنف التجاري أو العلمي</label>
        <Input value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} placeholder="اكتب حرفين على الأقل..." className="mt-2" />
        {itemSearch.trim().length >= 2 && suggestions.length > 0 && (
          <div className="mt-2 grid gap-2">
            {suggestions.map((row: any) => (
              <button key={row.identity_key} type="button" onClick={() => setSelectedItem(row)} className="rounded-md border p-3 text-right hover:bg-accent">
                <div className="font-semibold">{[row.brand, row.active_ingredient, row.strength].filter(Boolean).join(" · ")}</div>
                <div className="text-xs text-muted-foreground">{sourceLabel(row.source)} · {row.occurrence_count} حركة</div>
              </button>
            ))}
          </div>
        )}
      </Card>

      {!selectedItem && <EmptyState text="اختر صنفًا من نتائج البحث لعرض تقرير التتبع." />}
      {tracking.isLoading && <Card className="p-4">جاري تحميل تتبع الصنف...</Card>}
      {data?.item && (
        <>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">{sourceLabel(data.item.source)}</div>
            <h2 className="text-lg font-bold">{[data.item.brand, data.item.active_ingredient, data.item.strength].filter(Boolean).join(" · ")}</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              <Mini label="إجمالي الكمية" value={numberText(data.summary.total_quantity)} />
              <Mini label="مرات الصرف" value={data.summary.dispense_count} />
              <Mini label="المستفيدون" value={data.summary.unique_patient_count} />
              <Mini label="الإيراد" value={`${money(data.summary.total_revenue)} د.ل`} />
              <Mini label="تكلفة معروفة" value={`${money(data.summary.known_cost)} د.ل`} />
              <Mini label="ربح معروف" value={`${money(data.summary.known_profit)} د.ل`} />
              <Mini label="التغطية" value={pct(data.summary.coverage_ratio)} />
            </div>
          </Card>
          <Section title="حركات الصرف">
            <MovementCards rows={data.movements} />
          </Section>
        </>
      )}
    </div>
  );
}

function ProfitReport({ profit, selectedInvoice, setSelectedInvoice, selectedBeneficiary, setSelectedBeneficiary, salePriceDraft, setSalePriceDraft, saveSupplierPrice, saving }: any) {
  const data = profit.data;
  if (profit.error) {
    return <Card className="p-4 text-destructive">تحليل الأرباح يتطلب صلاحية قراءة التكلفة: {(profit.error as Error).message}</Card>;
  }
  if (profit.isLoading) return <Card className="p-4">جاري تحميل تحليل الأرباح...</Card>;
  if (!data) return <EmptyState text="لا توجد بيانات تحليل أرباح." />;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="إجمالي الإيراد" value={`${money(data.summary.total_revenue)} د.ل`} />
        <Stat label="تكلفة معروفة" value={`${money(data.summary.known_cost)} د.ل`} />
        <Stat label="ربح معروف" value={`${money(data.summary.known_profit)} د.ل`} />
        <Stat label="نسبة التغطية" value={pct(data.summary.coverage_ratio)} />
        <Stat label="الفواتير" value={data.summary.invoice_count} />
        <Stat label="المستفيدون" value={data.summary.unique_patient_count} />
        <Stat label="الأصناف" value={data.summary.item_count} />
      </div>
      <Section title="Actual / PHIF Supplier">
        <div className="grid gap-3 md:grid-cols-2">
          <ProfitSourceCard label="Actual Supplier" row={data.source_split.actual} />
          <ProfitSourceCard label="PHIF Supplier" row={data.source_split.phif} />
        </div>
      </Section>
      <Section title="أعلى الأصناف ربحًا">
        <div className="grid gap-2">
          {data.top_profit_items.map((row: any) => (
            <Card key={row.key} className="p-3">
              <div className="font-semibold">{row.item_name}</div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <Mini label="الإيراد" value={`${money(row.revenue)} د.ل`} />
                <Mini label="الربح" value={`${money(row.known_profit)} د.ل`} />
                <Mini label="الكمية" value={numberText(row.quantity)} />
              </div>
            </Card>
          ))}
        </div>
      </Section>
      <Section title="أعلى المستفيدين">
        <div className="grid gap-2 md:grid-cols-2">
          {data.top_revenue_beneficiaries.map((row: any) => (
            <button key={row.key} type="button" onClick={() => setSelectedBeneficiary(row)} className="rounded-lg border p-3 text-right hover:bg-accent">
              <div className="font-semibold">{row.beneficiary_name ?? "غير محدد"}</div>
              <div className="font-mono text-xs text-muted-foreground">{row.insurance_card_number ?? "بدون بطاقة"}</div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <Mini label="الإيراد" value={`${money(row.revenue)} د.ل`} />
                <Mini label="الربح" value={`${money(row.known_profit)} د.ل`} />
                <Mini label="الفواتير" value={row.invoice_count} />
              </div>
            </button>
          ))}
        </div>
      </Section>
      <Section title="الفواتير والحركات">
        <div className="grid gap-2">
          {data.invoices.map((invoice: any) => (
            <button key={invoice.invoice_id} type="button" onClick={() => setSelectedInvoice(invoice)} className="rounded-lg border p-3 text-right hover:bg-accent">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{invoice.invoice_number ?? invoice.invoice_key}</div>
                  <div className="text-xs text-muted-foreground">{invoice.beneficiary_name ?? "غير محدد"} · {invoice.dispensing_date ?? "بدون تاريخ"}</div>
                </div>
                <div className="text-left text-xs">
                  <div>{invoice.item_count} صنف</div>
                  <div>{money(invoice.revenue)} د.ل</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </Section>
      <InvoiceSheet
        invoice={selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
        salePriceDraft={salePriceDraft}
        setSalePriceDraft={setSalePriceDraft}
        saveSupplierPrice={saveSupplierPrice}
        saving={saving}
      />
      <BeneficiarySheet beneficiary={selectedBeneficiary} invoices={data.invoices} onClose={() => setSelectedBeneficiary(null)} />
    </div>
  );
}

function MovementCards({ rows }: { rows: any[] }) {
  return (
    <div className="grid gap-2">
      {rows.map((row) => (
        <Card key={`${row.invoice_id}-${row.item_id}`} className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold">{row.beneficiary_name ?? "غير محدد"}</div>
              <div className="font-mono text-xs text-muted-foreground">{row.insurance_card_number ?? "بدون بطاقة"}</div>
              <div className="mt-1 text-xs text-muted-foreground">{row.invoice_number ?? row.invoice_key} · {row.dispensing_date}</div>
            </div>
            <div className="text-left text-xs">
              <div>{row.quantity_label ?? row.quantity}</div>
              <div>{sourceLabel(row.source)}</div>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
            <Mini label="السعر" value={`${money(row.invoice_value)} د.ل`} />
            <Mini label="التكلفة" value={row.purchase_cost === null ? "غير معروفة" : `${money(row.purchase_cost)} د.ل`} />
            <Mini label="الربح" value={row.gross_margin === null ? "غير محسوب" : `${money(row.gross_margin)} د.ل`} />
          </div>
        </Card>
      ))}
      {rows.length === 0 && <EmptyState text="لا توجد حركات لهذا الصنف ضمن الفترة." />}
    </div>
  );
}

function InvoiceSheet({ invoice, onClose, salePriceDraft, setSalePriceDraft, saveSupplierPrice, saving }: any) {
  return (
    <Sheet open={Boolean(invoice)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-2xl px-4 pb-6 pt-5 sm:mx-auto sm:max-w-3xl" dir="rtl">
        {invoice && (
          <>
            <SheetHeader className="text-right">
              <SheetTitle>تفاصيل الفاتورة {invoice.invoice_number ?? invoice.invoice_key}</SheetTitle>
            </SheetHeader>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <Mini label="الإجمالي" value={`${money(invoice.revenue)} د.ل`} />
              <Mini label="التكلفة" value={`${money(invoice.known_cost)} د.ل`} />
              <Mini label="الربح" value={`${money(invoice.known_profit)} د.ل`} />
            </div>
            <div className="mt-4 space-y-2">
              {invoice.items.map((item: any) => (
                <Card key={item.item_id} className="p-3">
                  <div className="font-semibold">{item.item_name}</div>
                  <div className="text-xs text-muted-foreground">{sourceLabel(item.source)} · {item.quantity_label ?? item.quantity}</div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <Mini label="القيمة" value={`${money(item.invoice_value)} د.ل`} />
                    <Mini label="التكلفة" value={item.purchase_cost === null ? "غير معروفة" : `${money(item.purchase_cost)} د.ل`} />
                    <Mini label="الربح" value={item.gross_margin === null ? "غير محسوب" : `${money(item.gross_margin)} د.ل`} />
                  </div>
                  {item.source === "phif" && (
                    <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                      <Input
                        inputMode="decimal"
                        placeholder="سعر البيع الداخلي للوحدة"
                        value={salePriceDraft[item.item_id] ?? item.unit_sale_price ?? ""}
                        onChange={(event) => setSalePriceDraft((current: any) => ({ ...current, [item.item_id]: event.target.value }))}
                      />
                      <Button size="sm" onClick={() => saveSupplierPrice(item)} disabled={saving}>حفظ</Button>
                    </div>
                  )}
                  <div className="mt-2 text-xs text-muted-foreground">{statusLabel(item.match_status, item.match_reason)}</div>
                </Card>
              ))}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function BeneficiarySheet({ beneficiary, invoices, onClose }: any) {
  const related = beneficiary
    ? invoices.filter((invoice: any) => invoice.insurance_card_number === beneficiary.insurance_card_number || invoice.beneficiary_name === beneficiary.beneficiary_name)
    : [];
  return (
    <Sheet open={Boolean(beneficiary)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-2xl px-4 pb-6 pt-5 sm:mx-auto sm:max-w-3xl" dir="rtl">
        {beneficiary && (
          <>
            <SheetHeader className="text-right">
              <SheetTitle>{beneficiary.beneficiary_name ?? "مستفيد غير محدد"}</SheetTitle>
            </SheetHeader>
            <div className="mt-3 font-mono text-sm text-muted-foreground">{beneficiary.insurance_card_number ?? "بدون بطاقة"}</div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <Mini label="الإيراد" value={`${money(beneficiary.revenue)} د.ل`} />
              <Mini label="الربح" value={`${money(beneficiary.known_profit)} د.ل`} />
              <Mini label="الفواتير" value={beneficiary.invoice_count} />
            </div>
            <div className="mt-4 space-y-2">
              {related.map((invoice: any) => (
                <Card key={invoice.invoice_id} className="p-3">
                  <div className="font-semibold">{invoice.invoice_number ?? invoice.invoice_key}</div>
                  <div className="text-xs text-muted-foreground">{invoice.dispensing_date} · {invoice.item_count} صنف</div>
                  <div className="mt-2 text-sm">{money(invoice.revenue)} د.ل · ربح {money(invoice.known_profit)} د.ل</div>
                </Card>
              ))}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DrugCard({ row }: { row: any }) {
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{[row.active_ingredient ?? row.brand ?? "غير محدد", row.strength, row.dosage_form].filter(Boolean).join(" · ")}</div>
          {row.brand && <div className="text-xs text-muted-foreground">{row.brand}</div>}
        </div>
        <div className="text-left text-xs">
          <div>{sourceLabel(row.source)}</div>
          <div>{row.formatted_quantity ?? numberText(row.quantity)}</div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <Mini label="المستفيدون" value={row.unique_patient_count} />
        <Mini label="مرات الصرف" value={row.dispense_count} />
        <Mini label="القيمة" value={`${money(row.total_value)} د.ل`} />
      </div>
    </Card>
  );
}

function ProfitSourceCard({ label, row }: { label: string; row: any }) {
  return (
    <Card className="p-3">
      <div className="font-semibold">{label}</div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <Mini label="الإيراد" value={`${money(row.revenue)} د.ل`} />
        <Mini label="التكلفة" value={`${money(row.known_cost)} د.ل`} />
        <Mini label="الربح" value={`${money(row.known_profit)} د.ل`} />
        <Mini label="الأصناف" value={row.item_count} />
      </div>
    </Card>
  );
}

function SourceCard({ label, row }: { label: string; row: any }) {
  return (
    <Card className="p-3">
      <div className="font-semibold">{label}</div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <Mini label="الأصناف" value={row.item_count} />
        <Mini label="الأدوية" value={row.drug_count} />
        <Mini label="المستفيدون" value={row.patient_count} />
        <Mini label="المساهمة" value={pct(row.contribution)} />
        <Mini label="الكمية" value={numberText(row.quantity)} />
        <Mini label="القيمة" value={`${money(row.value)} د.ل`} />
      </div>
    </Card>
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

function EmptyState({ text }: { text: string }) {
  return <Card className="p-4 text-center text-sm text-muted-foreground">{text}</Card>;
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
      <table className="w-full border-collapse text-sm">
        <thead><tr>{["الصنف", "المصدر", "الكمية", "المستفيدون", "القيمة"].map((header) => <th key={header} className="border p-2 text-right">{header}</th>)}</tr></thead>
        <tbody>
          {report.top_drugs.slice(0, 25).map((row: any) => (
            <tr key={row.key}>
              <td className="border p-2">{[row.active_ingredient ?? row.brand ?? "غير محدد", row.strength, row.dosage_form].filter(Boolean).join(" · ")}</td>
              <td className="border p-2">{sourceLabel(row.source)}</td>
              <td className="border p-2">{row.formatted_quantity ?? numberText(row.quantity)}</td>
              <td className="border p-2">{row.unique_patient_count}</td>
              <td className="border p-2">{money(row.total_value)} د.ل</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="list-inside list-disc text-sm">
        {report.official_notes.map((note: string) => <li key={note}>{note}</li>)}
      </ul>
    </div>
  );
}
