import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, CalendarDays, CheckCircle2, Clock3, Loader2, Package, RefreshCw, Search, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReportBackLink } from "@/components/management/ReportBackLink";
import { OrdersExportButton } from "@/components/management/OrdersExportButton";
import { OrderReceiptDateEditor } from "@/components/management/OrderReceiptDateEditor";
import { confirmedReceiptDate, receiptDateSource } from "@/lib/phif-order-receipts.helpers";
import { useSession } from "@/lib/queries";
import { itemsAnalyticsScope } from "@/lib/items-analytics-cache.helpers";
import { useStoredPhifOrders } from "@/lib/use-stored-phif-orders";
import { ORDER_DATE_BASES, ORDER_PERIODS, ORDER_STATES, ORDER_TABS, defaultOrdersFilters, ordersPeriodFilters, ordersStatisticFilters, ordersView, type OrdersFilters } from "@/lib/phif-orders.helpers";

export const Route = createFileRoute("/management/orders")({
  component: OrdersPage,
  head: () => ({ meta: [{ title: "متابعة طلبيات PHIF - PHIF Tracker" }] }),
});
const dateLabel = (value: string | null) => value
  ? new Date(value).toLocaleDateString("ar-LY", { timeZone: "Africa/Tripoli" }) : "التاريخ غير متاح";
const statusStyle = { received: "border-emerald-200 bg-emerald-50 text-emerald-800",
  waiting: "border-amber-200 bg-amber-50 text-amber-900", not_approved: "border-zinc-200 bg-zinc-50 text-zinc-700",
  review: "border-red-200 bg-red-50 text-red-800" };

export function OrdersPage() {
  const session = useSession();
  if (session.error) return <p role="alert">تعذر التحقق من الجلسة الحالية</p>;
  if (!session.data?.unlocked) return <p role="status">جارٍ التحقق من الجلسة</p>;
  return <OrdersBody key={itemsAnalyticsScope(session.data)} scope={itemsAnalyticsScope(session.data)!} />;
}
function OrdersBody({ scope }: { scope: string }) {
  const [filters, setFilters] = useState<OrdersFilters>(defaultOrdersFilters);
  const [limit, setLimit] = useState(40);
  const report = useStoredPhifOrders(scope);
  const change = (patch: Partial<OrdersFilters>) => { setFilters(value => ({ ...value, ...patch })); setLimit(40); };
  const view = useMemo(() => report.data ? ordersView(report.data, filters) : null, [report.data, filters]);
  const suppliers = useMemo(() => [...new Set(report.data?.orders.flatMap(order => order.lines.map(line => line.supplier).filter((s): s is string => Boolean(s))) || [])]
    .sort((a, b) => a.localeCompare(b, "ar")), [report.data]);
  return <div dir="rtl" className="min-w-0 space-y-3">
    <ReportBackLink to="/management" label="الإدارة" />
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="flex items-center gap-2 text-xl font-bold"><Truck className="size-5 shrink-0" />متابعة طلبيات PHIF</h1>
      <div className="flex gap-2">
        <Button variant="outline" disabled={report.isFetching || !report.canRefresh} onClick={() => void report.refresh()}>
          <RefreshCw className={`size-4 ${report.isFetching ? "animate-spin" : ""}`} />تحديث
        </Button>
        <OrdersExportButton filters={filters} snapshot={report.snapshot} enabled={Boolean(report.data?.canExport && report.data.complete && !view?.periodError
          && (!report.receipts || report.receipts.ready || report.receipts.missing))} />
      </div>
    </header>
    {report.data && <p className="text-xs text-muted-foreground">
      {report.data.totalOrders} طلبًا متاحًا · آخر مزامنة ناجحة: <strong>{new Date(report.data.fetchedAt).toLocaleString("ar-LY", { timeZone: "Africa/Tripoli" })}</strong>
      {" · "}{report.source === "live" ? "جُلبت يدويًا من PHIF وحُفظت في Cloud" : report.central ? "نسخة مشتركة محفوظة في Cloud" : "نسخة مؤقتة على هذا الجهاز فقط"}
    </p>}
    {report.sessionExpired && <p role="status" className="border-y border-amber-200 py-2 text-xs text-amber-900">
      {report.data ? "انتهت جلسة PHIF، البيانات المعروضة من آخر مزامنة" : "لا توجد جلسة PHIF سارية. سجّل الدخول إلى PHIF ثم اضغط تحديث لحفظ أول نسخة."}
    </p>}
    {report.receipts?.error && <p role="status" className="border-y border-amber-200 py-2 text-xs text-amber-900">{report.receipts.error}</p>}
    <div className="space-y-2 border-y py-3">
      <Select value={filters.dateBasis || "creation"} onValueChange={value => change({ dateBasis: value as OrdersFilters["dateBasis"] })}>
        <SelectTrigger aria-label="مرجع الفترة"><SelectValue /></SelectTrigger>
        <SelectContent>{Object.entries(ORDER_DATE_BASES).map(([value,label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={filters.period} onValueChange={period => change(ordersPeriodFilters(period as OrdersFilters["period"]))}>
        <SelectTrigger aria-label="الفترة حسب تاريخ إنشاء الطلب"><SelectValue /></SelectTrigger>
        <SelectContent>{Object.entries(ORDER_PERIODS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
      </Select>
      {filters.period === "custom" && <div className="grid min-w-0 grid-cols-2 gap-2">
        <label className="min-w-0 text-xs">من تاريخ<Input className="mt-1 min-w-0 w-full" type="date" value={filters.dateFrom} onChange={e => change({ dateFrom: e.target.value })} /></label>
        <label className="min-w-0 text-xs">إلى تاريخ<Input className="mt-1 min-w-0 w-full" type="date" value={filters.dateTo} onChange={e => change({ dateTo: e.target.value })} /></label>
      </div>}
      {filters.period !== "all" && filters.period !== "custom" && <p dir="ltr" className="text-right text-xs text-muted-foreground">{filters.dateFrom} - {filters.dateTo}</p>}
      <p className="text-xs leading-5 text-muted-foreground">{!filters.dateBasis || filters.dateBasis === "creation"
        ? "الفترة والإحصائيات حسب تاريخ إنشاء الطلب، وليس تاريخ الموافقة أو الاستلام."
        : `الفترة والإحصائيات حسب ${ORDER_DATE_BASES[filters.dateBasis]}؛ الرصد لا يثبت تاريخ الاستلام الفعلي.`}</p>
      {view?.periodError && <p role="alert" className="text-xs text-red-800">{view.periodError}</p>}
    </div>
    <div className="relative"><Search className="absolute right-3 top-3 size-4 text-muted-foreground" />
      <Input aria-label="رقم الطلب أو الدواء أو التشغيلة" placeholder="رقم الطلب أو الدواء أو التشغيلة" className="pr-9" value={filters.query} onChange={e => change({ query: e.target.value })} />
    </div>
    <div className="grid min-w-0 grid-cols-2 gap-2">
      {filters.tab === "approved" && <Select value={filters.status} onValueChange={status => change({ status: status as OrdersFilters["status"] })}>
        <SelectTrigger aria-label="حالة الصنف" className="min-w-0"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">جميع الأصناف المعتمدة</SelectItem>{(["waiting", "received"] as const).map(value => <SelectItem key={value} value={value}>{ORDER_STATES[value]}</SelectItem>)}</SelectContent>
      </Select>}
      <Select value={filters.supplier} onValueChange={supplier => change({ supplier })}>
        <SelectTrigger aria-label="المورد" className={`min-w-0 ${filters.tab !== "approved" ? "col-span-2" : ""}`}><SelectValue /></SelectTrigger>
        <SelectContent className="max-w-[calc(100vw-2rem)]"><SelectItem value="all">جميع الموردين</SelectItem>{suppliers.map(s => <SelectItem className="whitespace-normal break-words" key={s} value={s}>{s}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    {report.isLoading && <p role="status" className="flex items-center justify-center gap-2 py-10"><Loader2 className="size-4 animate-spin" />جارٍ فتح النسخة المحفوظة بأمان</p>}
    {report.error && <p role="alert" className="border-y border-red-200 py-3 text-sm text-red-800">
      {report.error}{report.data && "؛ المعروض آخر نسخة محفوظة، ولم تُحذف أو تُستبدل."}
    </p>}
    {!report.isLoading && !report.data && !report.error && <p className="border-y py-5 text-sm text-muted-foreground">لا توجد نسخة طلبيات محفوظة لهذا الحساب على هذا الجهاز. اضغط تحديث عند توفر جلسة PHIF.</p>}
    {report.data && report.isFetching && <p role="status" className="text-xs text-muted-foreground">جارٍ تحديث حالات الطلبات</p>}
    {report.data && view && <>
      {!report.data.complete && <div role="alert" className="space-y-1 border-y border-red-200 py-3 text-sm text-red-800">
        <p className="flex items-center gap-2"><AlertCircle className="size-4 shrink-0" />التفاصيل غير مكتملة؛ الإحصائيات تشمل البنود المقروءة فقط والتصدير موقوف.</p>
        {report.data.orders.filter(o => o.detailError).map(o => <p key={o.id}>طلب {o.number}: {o.detailError}</p>)}
      </div>}
      <div aria-label="إحصائيات الفترة والبحث والمورد" className="grid grid-cols-2 gap-2 py-1 sm:grid-cols-4">
        {([
          { key: "orders", label: "عدد الطلبات", count: view.orderCount, icon: Truck },
          { key: "received", label: "أصناف مستلمة", count: view.counts.received, icon: CheckCircle2 },
          { key: "waiting", label: "معتمدة بانتظار الاستلام", count: view.counts.waiting, icon: Clock3 },
          { key: "not_approved", label: "بانتظار موافقة المورد", count: view.counts.not_approved, icon: Package },
        ] as const).map(({ key, label, count, icon: Icon }) => {
          const selected = key === "orders" || key === "not_approved" ? filters.tab === key
            : filters.tab === "approved" && filters.status === key;
          return <button type="button" key={key} aria-pressed={selected}
            onClick={() => change(ordersStatisticFilters(key))}
            className={`min-w-0 space-y-1 rounded-lg border p-3 text-right text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring ${selected ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/50"}`}>
            <span className="flex items-start gap-1.5"><Icon className="size-4 shrink-0" />{label}</span><strong className="block text-xl">{count}</strong>
          </button>;
        })}
      </div>
      <Tabs dir="rtl" value={filters.tab} onValueChange={tab => change({ tab: tab as OrdersFilters["tab"], status: "all" })}>
        <TabsList aria-label="مجموعات متابعة الطلبات" className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4">
          {Object.entries(ORDER_TABS).map(([value, label]) => <TabsTrigger key={value} value={value} className="min-w-0 whitespace-normal px-2 py-2 text-xs leading-5">
            {label}{value === "review" && view.counts.review > 0 ? ` (${view.counts.review})` : ""}
          </TabsTrigger>)}
        </TabsList>
      <TabsContent value={filters.tab} className="space-y-3">
      {(!filters.dateBasis || filters.dateBasis === "creation") && filters.period !== "all" && view.undatedOrders > 0 && !view.periodError && <p role="status" className="text-xs text-amber-900">
        {view.undatedOrders} طلبًا بلا تاريخ إنشاء موثق؛ لا تدخل ضمن الفترة المحددة.
      </p>}
      {filters.tab === "orders" ? <div className="grid min-w-0 gap-3 md:grid-cols-2">
        {view.orders.slice(0, limit).map(order => <article key={order.id} className="min-w-0 space-y-2 rounded-lg border bg-card p-3">
          <h2 className="break-all text-sm font-bold"><bdi>{order.number}</bdi></h2>
          <p className="text-xs text-muted-foreground">إنشاء: {dateLabel(order.createdAt)}</p>
          {order.detailError ? <p className="text-xs text-red-800">{order.detailError}</p> : <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {Object.entries(ORDER_STATES).map(([status, label]) => <span key={status}>{label}: {order.counts[status as keyof typeof ORDER_STATES]}</span>)}
          </div>}
        </article>)}
      </div> : <div className="grid min-w-0 gap-3 md:grid-cols-2">
        {view.rows.slice(0, limit).map(row => {
          const StatusIcon = row.status === "received" ? CheckCircle2 : row.status === "waiting" ? Clock3 : Package;
          return <article key={`${row.orderId}:${row.id}`} className="min-w-0 space-y-2 rounded-lg border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <bdi className="break-all font-semibold">{row.orderNumber}</bdi>
              <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 ${statusStyle[row.status]}`}><StatusIcon className="size-3" />{ORDER_STATES[row.status]}</span>
            </div>
            <h2 dir="auto" className="break-words text-base font-bold leading-6">{row.medicine}</h2>
            <p className="break-words text-xs text-muted-foreground">{row.supplier || "المورد غير مسجل"}</p>
            <div className="grid grid-cols-2 gap-2 border-y py-2 text-xs">
              <div>الكمية المعتمدة<strong className="mt-1 block text-xl">{row.approvedQuantity == null ? "غير موثقة" : row.approvedQuantity.toLocaleString("en-US")}</strong></div>
              <div>التشغيلة<bdi className="mt-1 block break-all font-semibold">{row.batch || "غير مسجلة"}</bdi></div>
            </div>
            <div className="flex flex-wrap justify-between gap-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><CalendarDays className="size-3" />إنشاء: {dateLabel(row.createdAt)}</span>
              {row.status === "received" && confirmedReceiptDate(row) && <span className="text-emerald-800">استلام: {dateLabel(confirmedReceiptDate(row))} · {receiptDateSource(row)}</span>}
              <span>{row.duration.label}</span>
            </div>
            {row.receipt?.first_received_observed_at && <p className="text-xs text-amber-900">أول رصد للاستلام: {dateLabel(row.receipt.first_received_observed_at)} · رصد آلي وليس تاريخ استلام فعليًا</p>}
            {row.status === "received" && report.canManageReceipts && <OrderReceiptDateEditor record={row.receipt} medicine={row.medicine}
              enabled={Boolean(report.receipts?.ready)} onSaved={report.receiptSaved} />}
          </article>;
        })}
      </div>}
      {(filters.tab === "orders" ? view.orders.length : view.rows.length) > limit && <Button variant="outline" className="w-full" onClick={() => setLimit(value => value + 40)}>عرض المزيد</Button>}
      {!(filters.tab === "orders" ? view.orders.length : view.rows.length) && report.data.complete && !view.periodError && <p className="py-8 text-center text-sm text-muted-foreground">{filters.tab === "orders" ? "لا توجد طلبات مطابقة للفلاتر" : "لا توجد أصناف مطابقة للفلاتر"}</p>}
      {view.orders.filter(o => !o.detailError && !o.lines.length).length > 0 && <details className="border-y py-2 text-xs text-muted-foreground">
        <summary>طلبات بلا أصناف ظاهرة بعد استبعاد الكميات المعتمدة صفرًا</summary>
        {view.orders.filter(o => !o.detailError && !o.lines.length).map(o => <p className="pt-1" key={o.id}><bdi>{o.number}</bdi> · {dateLabel(o.createdAt)} · {o.status}</p>)}
      </details>}
      </TabsContent>
      </Tabs>
      <p className="text-xs leading-5 text-muted-foreground">استُبعد {report.data.excludedZero} بندًا بكمية معتمدة صفر من قراءة المصدر لكل التاريخ، قبل تطبيق الفلاتر. المدة لغير المستلم من إنشاء الطلب حتى اليوم، وللمستلم حتى تاريخ الاستلام الفعلي فقط إن توفر؛ وليست مدة منذ موافقة المورد.</p>
    </>}
  </div>;
}
