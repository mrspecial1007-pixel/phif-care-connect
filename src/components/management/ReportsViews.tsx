import { useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ReportBackLink } from "./ReportBackLink";
import { InvoiceSummaryCard, formatMoney, formatReportDate } from "./InvoiceSummaryCard";
import { getMonthlyManagementReport, getOfficialMonthlyReportExport, getProfitAnalysisReport, getReportItemTracking, savePhifSupplierPurchasePrice, searchReportItems } from "@/lib/management.functions";
import { toast } from "sonner";

const dateString = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const monthRange = (month: string) => { const [y, m] = month.split("-").map(Number); return { dateFrom: dateString(new Date(y, m - 1, 1)), dateTo: dateString(new Date(y, m, 0)) }; };
const thisMonth = () => dateString(new Date()).slice(0, 7);
const sourceLabel = (s: string) => s === "actual" ? "Actual" : s === "phif" ? "PHIF Supplier" : "كل المصادر";
const percent = (v: number) => `${Math.round(v * 100)}%`;
const number = (v: number) => Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const statusLabel = (row: any) => row.match_status === "matched" ? "مكتملة" : row.match_status === "needs_purchase_price" ? "تحتاج أسعار" : row.match_status === "pricing_unit_unverified" ? "وحدة التكلفة تحتاج مراجعة" : "تحتاج مطابقة Actual";
const sheetClass = "max-h-[90vh] overflow-y-auto rounded-t-lg px-4 pb-8 pt-5 sm:mx-auto sm:max-w-2xl";

function PeriodSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label="الفترة" className="min-w-0"><SelectValue /></SelectTrigger><SelectContent>
    <SelectItem value="this_month">هذا الشهر</SelectItem><SelectItem value="previous_month">الشهر السابق</SelectItem><SelectItem value="today">اليوم</SelectItem><SelectItem value="week">آخر 7 أيام</SelectItem><SelectItem value="month">شهر محدد</SelectItem><SelectItem value="custom">نطاق مخصص</SelectItem>
  </SelectContent></Select>;
}
function SourceSelect({ value, onChange }: { value: string; onChange: (v: "all" | "actual" | "phif") => void }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label="المصدر" className="min-w-0"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل المصادر</SelectItem><SelectItem value="actual">Actual</SelectItem><SelectItem value="phif">PHIF Supplier</SelectItem></SelectContent></Select>;
}
function usePeriod() {
  const [period, setPeriod] = useState("this_month");
  const [month, setMonth] = useState(thisMonth);
  const [range, setRange] = useState(() => monthRange(thisMonth()));
  function change(v: string) {
    setPeriod(v);
    const now = new Date();
    if (v === "custom") return;
    if (v === "today") setRange({ dateFrom: dateString(now), dateTo: dateString(now) });
    else if (v === "week") { const start = new Date(now); start.setDate(now.getDate() - 6); setRange({ dateFrom: dateString(start), dateTo: dateString(now) }); }
    else if (v === "previous_month") { const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1); const m = dateString(prev).slice(0, 7); setMonth(m); setRange(monthRange(m)); }
    else setRange(monthRange(v === "month" ? month : thisMonth()));
  }
  function changeMonth(m: string) { setMonth(m); setPeriod("month"); if (/^\d{4}-\d{2}$/.test(m)) setRange(monthRange(m)); }
  return { period, change, month, changeMonth, range, setRange, setPeriod };
}
function Heading({ title, description }: { title: string; description?: string }) {
  return <header className="space-y-1"><ReportBackLink to="/management/reports" label="مركز التقارير" /><h1 className="text-xl font-bold">{title}</h1>{description && <p className="text-sm text-muted-foreground">{description}</p>}</header>;
}
function Metric({ label, value, onClick, tone }: { label: string; value: string | number; onClick?: () => void; tone?: string }) {
  const inner = <><span className="block text-xs text-muted-foreground">{label}</span><strong className={`mt-1 block break-words text-base ${tone ?? ""}`}>{value}</strong></>;
  return onClick ? <Button variant="outline" onClick={onClick} className="h-auto min-h-20 w-full min-w-0 flex-col items-start whitespace-normal p-3 text-right">{inner}</Button> : <div className="min-w-0 border-b p-3">{inner}</div>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section className="space-y-2"><h2 className="text-base font-bold">{title}</h2>{children}</section>; }
function MoneyMetrics({ data }: { data: any }) { return <div className="grid grid-cols-2 gap-x-2 border-y sm:grid-cols-4"><Metric label="إجمالي الإيراد" value={formatMoney(data.total_revenue)} /><Metric label="إجمالي التكلفة المعروفة" value={data.matched_count ? formatMoney(data.known_cost) : "غير مكتمل"} /><Metric label="إجمالي الربح المعروف" value={data.matched_count ? formatMoney(data.known_profit) : "غير مكتمل"} tone="text-emerald-700" /><Metric label="تغطية التكلفة" value={data.item_count && !data.matched_count ? "غير مكتمل" : percent(data.coverage_ratio)} /><Metric label="الفواتير" value={data.invoice_count} /><Metric label="المستفيدون" value={data.unique_patient_count} /><Metric label="البنود المكتملة" value={data.matched_count} /><Metric label="تحتاج مراجعة" value={data.review_count} tone="text-amber-700" /></div>; }

export function ReportsSummaryPage() {
  const period = usePeriod();
  const [source, setSource] = useState<"all" | "actual" | "phif">("all");
  const [groupBy, setGroupBy] = useState<"scientific" | "brand">("scientific");
  const [sortBy, setSortBy] = useState<"quantity" | "beneficiaries" | "dispenses" | "value">("quantity");
  const [topLimit, setTopLimit] = useState<"10" | "20" | "50" | "all">("20");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const reportFn = useServerFn(getMonthlyManagementReport);
  const exportFn = useServerFn(getOfficialMonthlyReportExport);
  const filters = { ...period.range, source, groupBy, sortBy, topLimit: topLimit === "all" ? "all" as const : Number(topLimit) };
  const report = useQuery({ queryKey: ["management_monthly_report", filters], queryFn: () => reportFn({ data: filters }) });
  async function exportExcel() {
    try {
      const payload: any = await exportFn({ data: filters });
      const XLSX = await import("xlsx");
       const wb = XLSX.utils.book_new();
      const add = (name: string, rows: any[]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ ملاحظة: "لا توجد بيانات" }]), name);
      add("الملخص", [{ البند: "الفواتير", القيمة: payload.summary.invoice_count }, { البند: "المستفيدون", القيمة: payload.summary.unique_patient_count }, { البند: "قيمة الصرف", القيمة: payload.summary.total_dispensed_value }]);
      add("المستفيدون", payload.beneficiary_stats.beneficiaries.map((r: any) => ({ الاسم: r.name, البطاقة: r.card, الفواتير: r.invoice_count, القيمة: r.total_value })));
      add("الأصناف", payload.top_drugs.map((r: any) => ({ العلمي: r.active_ingredient, التجاري: r.brand, التركيز: r.strength, المصدر: sourceLabel(r.source), الكمية: r.quantity, القيمة: r.total_value })));
      add("اليومي", payload.daily);
      add("الجودة", [payload.quality]);
       XLSX.writeFile(wb, `phif-report-${period.range.dateFrom}-${period.range.dateTo}.xlsx`);
    } catch (error) { toast.error((error as Error).message); }
  }
  return <div className="space-y-5" dir="rtl">
    <Heading title="التقرير الشامل" description="تحليل الصرف والمستفيدين والأصناف" />
    <div className="space-y-3 border-b pb-4 print:hidden"><h2 className="font-semibold">الفترة والتصفية</h2><div className="grid grid-cols-2 gap-2"><label className="min-w-0 text-xs text-muted-foreground">الفترة<PeriodSelect value={period.period} onChange={period.change} /></label><label className="min-w-0 text-xs text-muted-foreground">المصدر<SourceSelect value={source} onChange={setSource} /></label></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setFiltersOpen(true)}>تغيير الفلاتر</Button><Button variant="outline" onClick={() => report.refetch()}>تحديث</Button><Button variant="outline" disabled={!report.data} onClick={exportExcel}>تصدير Excel رسمي</Button><Button variant="outline" disabled={!report.data} onClick={() => window.print()}>طباعة التقرير الرسمي</Button></div>
    </div>
    <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}><SheetContent side="bottom" className={sheetClass} dir="rtl"><SheetHeader className="text-right"><SheetTitle>الفترة والتصفية</SheetTitle></SheetHeader><div className="mt-5 grid grid-cols-2 gap-3">
      <label className="text-xs">شهر محدد<Input type="month" value={period.month} onChange={e => period.changeMonth(e.target.value)} /></label>
      <label className="text-xs">المصدر<SourceSelect value={source} onChange={setSource} /></label>
      <label className="text-xs">من تاريخ<Input type="date" value={period.range.dateFrom} onChange={e => { period.setPeriod("custom"); period.setRange(r => ({ ...r, dateFrom: e.target.value })); }} /></label>
      <label className="text-xs">إلى تاريخ<Input type="date" value={period.range.dateTo} onChange={e => { period.setPeriod("custom"); period.setRange(r => ({ ...r, dateTo: e.target.value })); }} /></label>
      <label className="text-xs">طريقة التجميع<Select value={groupBy} onValueChange={v => setGroupBy(v as typeof groupBy)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="scientific">الاسم العلمي</SelectItem><SelectItem value="brand">الاسم التجاري</SelectItem></SelectContent></Select></label>
      <label className="text-xs">الترتيب<Select value={sortBy} onValueChange={v => setSortBy(v as typeof sortBy)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="quantity">الكمية</SelectItem><SelectItem value="beneficiaries">المستفيدون</SelectItem><SelectItem value="dispenses">مرات الصرف</SelectItem><SelectItem value="value">القيمة</SelectItem></SelectContent></Select></label>
      <label className="text-xs">أعلى الأصناف<Select value={topLimit} onValueChange={v => setTopLimit(v as typeof topLimit)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="10">10</SelectItem><SelectItem value="20">20</SelectItem><SelectItem value="50">50</SelectItem><SelectItem value="all">الكل</SelectItem></SelectContent></Select></label>
    </div><Button className="mt-4 w-full" onClick={() => setFiltersOpen(false)}>عرض النتائج</Button></SheetContent></Sheet>
    {report.isLoading && <p>جاري تحميل التقرير...</p>}{report.error && <p className="text-destructive">تعذر تحميل التقرير: {(report.error as Error).message}</p>}
    {report.data && <><div className="grid grid-cols-2 gap-x-2 border-y sm:grid-cols-4"><Metric label="إجمالي الصرف" value={formatMoney(report.data.summary.total_dispensed_value)} /><Metric label="الفواتير" value={report.data.summary.invoice_count} /><Metric label="المستفيدون" value={report.data.summary.unique_patient_count} /><Metric label="الأصناف" value={report.data.summary.item_count} /></div>
      <Section title="المصادر"><div className="grid gap-2 sm:grid-cols-2">{(["actual", "phif"] as const).map(s => <Card key={s} className="p-3"><strong>{sourceLabel(s)}</strong><p>{report.data.source_split[s].item_count} صنف · {formatMoney(report.data.source_split[s].value)}</p></Card>)}</div></Section>
      <Section title="الأدوية الأكثر صرفًا"><div className="grid gap-2 sm:grid-cols-2">{report.data.top_drugs.map((r: any) => <Card key={r.key} className="p-3"><strong>{[r.active_ingredient || r.brand, r.strength].filter(Boolean).join(" · ")}</strong><p className="text-xs text-muted-foreground">{sourceLabel(r.source)} · {r.formatted_quantity ?? r.quantity} · {formatMoney(r.total_value)}</p></Card>)}</div></Section>
      <Section title="التقرير اليومي">{report.data.daily.map((r: any) => <div key={r.date} className="flex justify-between border-b py-2 text-sm"><span>{formatReportDate(r.date)}</span><span>{r.invoice_count} فاتورة · {formatMoney(r.total_value)}</span></div>)}</Section>
      <Section title="جودة البيانات"><p className="text-sm text-muted-foreground">{report.data.quality.missing_generic} بدون اسم علمي · {report.data.quality.missing_unit} بدون وحدة · {report.data.quality.incomplete_invoices} فواتير ناقصة</p></Section>
      <div className="hidden print:block"><h2>التقرير الرسمي · {formatReportDate(period.range.dateFrom)} — {formatReportDate(period.range.dateTo)}</h2><p>إجمالي قيمة الصرف: {formatMoney(report.data.summary.total_dispensed_value)}</p>{report.data.official_notes.map((n: string) => <p key={n}>{n}</p>)}</div>
    </>}
  </div>;
}

function ItemFinancials({ row }: { row: any }) {
  return <div className="grid grid-cols-3 gap-2 border-t pt-2 text-xs"><div>قيمة الصرف<strong className="block break-words">{formatMoney(row.invoice_value)}</strong></div><div>التكلفة<strong className="block break-words">{formatMoney(row.purchase_cost)}</strong></div><div>الربح<strong className="block break-words text-emerald-700">{formatMoney(row.gross_margin)}</strong></div></div>;
}
function Movement({ row }: { row: any }) { return <div className="space-y-2 border-b py-3 text-sm"><div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2"><div className="min-w-0"><strong>{row.beneficiary_name || "غير محدد"}</strong><p className="text-xs text-muted-foreground">{row.insurance_card_number || "بدون بطاقة"} · {row.invoice_number || row.invoice_key}</p></div><span className="shrink-0">{formatReportDate(row.dispensing_date)}</span></div><p className="text-xs text-muted-foreground">{row.quantity_label ?? row.quantity} · {sourceLabel(row.source)} · {statusLabel(row)}</p><ItemFinancials row={row} /></div>; }
export function ReportsItemTrackingPage() {
  const period = usePeriod();
  const params = useSearch({ strict: false }) as { item?: string };
  const [search, setSearch] = useState(""); const [selected, setSelected] = useState<any>(null);
  const [sheet, setSheet] = useState<"movements" | "beneficiaries" | null>(null);
  const searchFn = useServerFn(searchReportItems); const trackingFn = useServerFn(getReportItemTracking);
  const suggestions = useQuery({ queryKey: ["report_item_search", search, period.range], queryFn: () => searchFn({ data: { search, ...period.range } }), enabled: search.trim().length >= 2 });
  const identityKey = selected?.identity_key ?? (search ? undefined : params.item);
  const tracking = useQuery({ queryKey: ["report_item_tracking", identityKey, period.range], queryFn: () => trackingFn({ data: { identityKey: identityKey ?? "", search: search || "aa", groupBy: "scientific", ...period.range } }), enabled: Boolean(identityKey), retry: false });
  const data = tracking.data;
  return <div className="space-y-5" dir="rtl"><Heading title="تتبع صنف" description="ابحث عن صنف لمراجعة حركته ومستخدميه ومخزونه" />
    <div><Input aria-label="ابحث عن صنف" className="h-12 text-base" placeholder="الاسم التجاري أو العلمي أو التركيز" value={search} onChange={e => { setSearch(e.target.value); setSelected(null); }} />{search.trim().length >= 2 && !selected && <div className="mt-2 max-h-56 overflow-y-auto border">{suggestions.data?.map((r: any) => <Button key={r.identity_key} variant="ghost" className="h-auto w-full justify-start whitespace-normal border-b p-3 text-right" onClick={() => { setSelected(r); setSearch([r.brand, r.active_ingredient, r.strength].filter(Boolean).join(" · ")); }}>{[r.brand, r.active_ingredient, r.strength].filter(Boolean).join(" · ")} · {r.occurrence_count} حركة</Button>)}{suggestions.data?.length === 0 && <p className="p-3 text-sm">لا توجد نتائج</p>}</div>}</div>
    {tracking.isLoading && <p>جاري تحميل تتبع الصنف...</p>}{tracking.error && <p className="text-destructive">{(tracking.error as Error).message}</p>}
    {data?.item && <><div className="border-b pb-3"><h2 className="text-lg font-bold">{data.item.brand || data.item.active_ingredient}</h2><p className="text-sm text-muted-foreground">{data.item.active_ingredient} · {data.item.strength} · {data.item.unit || "وحدة غير محددة"}</p><p className="text-xs text-muted-foreground">المورد: {data.item.supplier || "غير محدد"} · المخزون: {data.item.stock_quantity ?? "غير متوفر"} · آخر مزامنة: {formatReportDate(data.item.stock_synced_at)}</p></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><Metric label="مرات الصرف" value={data.summary.dispense_count} onClick={() => setSheet("movements")} /><Metric label="المستفيدون" value={data.summary.unique_patient_count} onClick={() => setSheet("beneficiaries")} /><Metric label="الكمية المصروفة" value={number(data.summary.total_quantity)} /><Metric label="الإيراد" value={formatMoney(data.summary.total_revenue)} /><Metric label="التكلفة المعروفة" value={data.summary.coverage_ratio ? formatMoney(data.summary.known_cost) : "غير مكتمل"} /><Metric label="الربح المعروف" value={data.summary.coverage_ratio ? formatMoney(data.summary.known_profit) : "غير مكتمل"} /></div>
      {data.summary.coverage_ratio < 1 && <p className="text-sm text-amber-700">{data.movements.length - Math.round(data.summary.coverage_ratio * data.movements.length)} حركة تحتاج مراجعة</p>}
      <Sheet open={Boolean(sheet)} onOpenChange={open => !open && setSheet(null)}><SheetContent side="bottom" className={sheetClass} dir="rtl"><SheetHeader className="text-right"><SheetTitle>{sheet === "movements" ? "حركات الصرف" : "المستفيدون"}</SheetTitle></SheetHeader>{sheet === "movements" ? data.movements.map((r: any) => <Movement key={r.item_id} row={r} />) : data.beneficiaries.map((r: any) => <div key={r.card ?? r.name} className="border-b py-3"><strong>{r.name}</strong><p className="text-xs text-muted-foreground">{r.card}</p></div>)}</SheetContent></Sheet>
    </>}
  </div>;
}

function InvoiceDetails({ invoice, close, save, draft, setDraft, saving }: any) {
  return <Sheet open={Boolean(invoice)} onOpenChange={open => !open && close()}><SheetContent side="bottom" className={sheetClass} dir="rtl"><SheetHeader className="text-right"><SheetTitle>تفاصيل الفاتورة {invoice?.invoice_number ?? invoice?.invoice_key}</SheetTitle></SheetHeader>{invoice && <div className="mt-4 space-y-3"><p className="text-sm">{invoice.beneficiary_name} · {formatReportDate(invoice.dispensing_date)}</p>{invoice.items.map((r: any) => <div className="space-y-2 border-b pb-4" key={r.item_id}><strong>{r.brand || r.item_name}</strong><p className="text-xs text-muted-foreground">{r.active_ingredient} · {r.strength} · {sourceLabel(r.source)} · الكمية {r.quantity_label ?? r.quantity}</p><ItemFinancials row={r} /><p className="text-xs text-amber-700">{statusLabel(r)}</p>{r.source === "phif" && <div className="space-y-1"><label htmlFor={`price-${r.item_id}`} className="text-xs">سعر شراء الوحدة {r.unit ? `· سعر شراء ${r.unit}` : "· وحدة غير محددة"}</label><div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2"><Input id={`price-${r.item_id}`} inputMode="decimal" disabled={!r.unit} placeholder="سعر شراء الوحدة" value={draft[r.item_id] ?? r.unit_purchase_price ?? ""} onChange={e => setDraft((d: any) => ({ ...d, [r.item_id]: e.target.value }))} /><Button disabled={saving || !r.unit} onClick={() => save(r)}>{r.unit_purchase_price === null ? "حفظ" : "تعديل"}</Button></div>{!r.unit && <p className="text-xs text-amber-700">وحدة التكلفة تحتاج مراجعة</p>}</div>}</div>)}<div className="grid grid-cols-3 gap-2 border-t pt-4 text-xs"><Metric label="إجمالي الفاتورة" value={formatMoney(invoice.revenue)} /><Metric label="إجمالي التكلفة" value={invoice.matched_count === invoice.item_count ? formatMoney(invoice.known_cost) : "غير مكتمل"} /><Metric label="إجمالي الربح" value={invoice.matched_count === invoice.item_count ? formatMoney(invoice.known_profit) : "غير مكتمل"} /></div></div>}</SheetContent></Sheet>;
}
export function ReportsProfitAnalysisPage() {
  const period = usePeriod(); const [source, setSource] = useState<"all" | "actual" | "phif">("all");
  const [invoiceId, setInvoiceId] = useState<string | null>(null); const [beneficiary, setBeneficiary] = useState<any>(null); const [draft, setDraft] = useState<Record<string, string>>({});
  const navigate = useNavigate(); const qc = useQueryClient(); const profitFn = useServerFn(getProfitAnalysisReport); const saveFn = useServerFn(savePhifSupplierPurchasePrice);
  const profit = useQuery({ queryKey: ["management_profit_analysis", period.range, source], queryFn: () => profitFn({ data: { ...period.range, source } }), retry: false });
  const mutation = useMutation({ mutationFn: (input: { itemId: string; purchasePrice: number }) => saveFn({ data: input }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["management_profit_analysis"] }); qc.invalidateQueries({ queryKey: ["report_item_tracking"] }); toast.success("تم حفظ سعر الشراء"); }, onError: e => toast.error(e.message) });
  const data = profit.data; const invoice = data?.invoices.find((i: any) => i.invoice_id === invoiceId);
  function save(r: any) { const raw = draft[r.item_id] ?? r.unit_purchase_price; const value = Number(raw); if (raw === "" || raw === null || raw === undefined || !Number.isFinite(value) || value < 0) { toast.error("أدخل سعر شراء صحيحًا"); return; } mutation.mutate({ itemId: r.item_id, purchasePrice: value }); }
  const jump = (key: string) => navigate({ to: "/management/reports/item-tracking", search: { item: key } as any });
  const beneficiaries = (title: string, rows: any[]) => <Section title={title}><div className="grid gap-2 sm:grid-cols-2">{rows.map((r: any) => <Button key={r.key} variant="outline" className="h-auto min-w-0 flex-col items-start whitespace-normal p-3 text-right" onClick={() => setBeneficiary(r)}><strong>{r.beneficiary_name || "غير محدد"}</strong><span className="text-xs">{r.invoice_count} فاتورة · إيراد {formatMoney(r.revenue)} · ربح {r.known_profit || r.matched_count ? formatMoney(r.known_profit) : "غير مكتمل"}</span></Button>)}</div></Section>;
  const items = (title: string, rows: any[]) => <Section title={title}><div className="grid gap-2 sm:grid-cols-2">{rows.map((r: any) => <Button key={r.key} variant="outline" className="h-auto min-w-0 flex-col items-start whitespace-normal p-3 text-right" onClick={() => jump(r.key)}><strong>{r.item_name}</strong><span className="text-xs">{r.dispense_count} حركة · {formatMoney(r.revenue)} · ربح {r.matched_count ? formatMoney(r.known_profit) : "غير مكتمل"}</span></Button>)}</div></Section>;
  return <div className="space-y-5" dir="rtl"><Heading title="تحليل الأرباح" description="تحليل الإيراد والتكلفة والربحية للفواتير والأصناف" />
    {data && <MoneyMetrics data={data.summary} />}
    <div className="grid grid-cols-2 gap-2 border-b pb-4"><label className="min-w-0 text-xs text-muted-foreground">الفترة<PeriodSelect value={period.period} onChange={period.change} /></label><label className="min-w-0 text-xs text-muted-foreground">المصدر<SourceSelect value={source} onChange={setSource} /></label>{(period.period === "month" || period.period === "custom") && <><label className="text-xs">الشهر<Input type="month" value={period.month} onChange={e => period.changeMonth(e.target.value)} /></label>{period.period === "custom" && <><Input aria-label="من تاريخ" type="date" value={period.range.dateFrom} onChange={e => period.setRange(r => ({ ...r, dateFrom: e.target.value }))} /><Input aria-label="إلى تاريخ" type="date" value={period.range.dateTo} onChange={e => period.setRange(r => ({ ...r, dateTo: e.target.value }))} /></>}</>}</div>
    {profit.isLoading && <p>جاري تحميل تحليل الأرباح...</p>}{profit.error && <p className="text-destructive">تحليل الأرباح يتطلب صلاحية قراءة التكلفة: {(profit.error as Error).message}</p>}
    {data && <><Section title="المصادر"><div className="grid gap-2 sm:grid-cols-2">{(["actual", "phif"] as const).map(s => <Card key={s} className="p-3"><strong>{sourceLabel(s)}</strong><p className="text-sm">{data.source_split[s].item_count} صنف · إيراد {formatMoney(data.source_split[s].revenue)}</p><p className="text-xs text-muted-foreground">تكلفة معروفة {formatMoney(data.source_split[s].known_cost)} · ربح معروف {formatMoney(data.source_split[s].known_profit)}</p></Card>)}</div></Section>
      {beneficiaries("أعلى المستفيدين إيرادًا", data.top_revenue_beneficiaries)}{beneficiaries("أعلى المستفيدين ربحًا", data.top_profit_beneficiaries)}
      {items("أعلى الأصناف إيرادًا", data.top_revenue_items)}{items("أعلى الأصناف ربحًا", data.top_profit_items)}{items("أكثر الأصناف صرفًا", data.top_dispensed_items)}
      <Section title="الفواتير"><div className="grid gap-2 sm:grid-cols-2">{data.invoices.map((i: any) => <InvoiceSummaryCard key={i.invoice_id} name={i.beneficiary_name} number={i.invoice_number || i.invoice_key} date={i.dispensing_date} count={i.item_count} revenue={i.revenue} cost={i.matched_count === i.item_count ? i.known_cost : null} profit={i.matched_count === i.item_count ? i.known_profit : null} status={i.needs_match_count ? "تحتاج مطابقة Actual" : i.needs_price_count ? "تحتاج أسعار" : "مكتملة"} onClick={() => setInvoiceId(i.invoice_id)} />)}</div></Section>
      <InvoiceDetails invoice={invoice} close={() => setInvoiceId(null)} save={save} draft={draft} setDraft={setDraft} saving={mutation.isPending} />
      <Sheet open={Boolean(beneficiary)} onOpenChange={open => !open && setBeneficiary(null)}><SheetContent side="bottom" className={sheetClass} dir="rtl"><SheetHeader className="text-right"><SheetTitle>{beneficiary?.beneficiary_name}</SheetTitle></SheetHeader><p className="my-3">الإيراد {formatMoney(beneficiary?.revenue)} · الربح المعروف {formatMoney(beneficiary?.known_profit)}</p>{data.invoices.filter((i: any) => i.insurance_card_number === beneficiary?.insurance_card_number && beneficiary?.insurance_card_number || i.beneficiary_name === beneficiary?.beneficiary_name).map((i: any) => <InvoiceSummaryCard key={i.invoice_id} name={i.beneficiary_name} number={i.invoice_number || i.invoice_key} date={i.dispensing_date} count={i.item_count} revenue={i.revenue} cost={i.matched_count === i.item_count ? i.known_cost : null} profit={i.matched_count === i.item_count ? i.known_profit : null} onClick={() => { setBeneficiary(null); setInvoiceId(i.invoice_id); }} />)}</SheetContent></Sheet>
    </>}
  </div>;
}
