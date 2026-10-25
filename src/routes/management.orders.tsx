import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CalendarDays, CheckCircle2, Clock3, Loader2, Package, RefreshCw, Search, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReportBackLink } from "@/components/management/ReportBackLink";
import { OrdersExportButton } from "@/components/management/OrdersExportButton";
import { useSession } from "@/lib/queries";
import { itemsAnalyticsScope } from "@/lib/items-analytics-cache.helpers";
import { getPhifOrders } from "@/lib/phif-orders.functions";
import { ORDER_STATES, defaultOrdersFilters, orderAgeDays, ordersCacheOptions, ordersView, type OrdersFilters } from "@/lib/phif-orders.helpers";

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
  const report = useQuery({ queryKey: ["phif_orders", scope], queryFn: () => getPhifOrders({ data: { export: false } }), ...ordersCacheOptions });
  const change = (patch: Partial<OrdersFilters>) => { setFilters(value => ({ ...value, ...patch })); setLimit(40); };
  const view = useMemo(() => report.data ? ordersView(report.data, filters) : null, [report.data, filters]);
  const suppliers = useMemo(() => [...new Set(report.data?.orders.flatMap(order => order.lines.map(line => line.supplier).filter((s): s is string => Boolean(s))) || [])]
    .sort((a, b) => a.localeCompare(b, "ar")), [report.data]);
  return <div dir="rtl" className="min-w-0 space-y-3">
    <ReportBackLink to="/management" label="الإدارة" />
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="flex items-center gap-2 text-xl font-bold"><Truck className="size-5 shrink-0" />متابعة طلبيات PHIF</h1>
      <div className="flex gap-2">
        <Button variant="outline" disabled={report.isFetching} onClick={() => void report.refetch()}>
          <RefreshCw className={`size-4 ${report.isFetching ? "animate-spin" : ""}`} />تحديث
        </Button>
        <OrdersExportButton filters={filters} enabled={Boolean(report.data?.canExport && report.data.complete && !report.error)} />
      </div>
    </header>
    {report.data && <p className="text-xs text-muted-foreground">
      {report.data.totalOrders} طلبًا متاحًا · آخر قراءة: {new Date(report.data.fetchedAt).toLocaleString("ar-LY", { timeZone: "Africa/Tripoli" })}
    </p>}
    <div className="relative"><Search className="absolute right-3 top-3 size-4 text-muted-foreground" />
      <Input aria-label="رقم الطلب أو الدواء أو التشغيلة" placeholder="رقم الطلب أو الدواء أو التشغيلة" className="pr-9" value={filters.query} onChange={e => change({ query: e.target.value })} />
    </div>
    <div className="grid min-w-0 grid-cols-2 gap-2">
      <Select value={filters.status} onValueChange={status => change({ status: status as OrdersFilters["status"] })}>
        <SelectTrigger aria-label="حالة الصنف" className="min-w-0"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">جميع الحالات</SelectItem>{Object.entries(ORDER_STATES).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={filters.supplier} onValueChange={supplier => change({ supplier })}>
        <SelectTrigger aria-label="المورد" className="min-w-0"><SelectValue /></SelectTrigger>
        <SelectContent className="max-w-[calc(100vw-2rem)]"><SelectItem value="all">جميع الموردين</SelectItem>{suppliers.map(s => <SelectItem className="whitespace-normal break-words" key={s} value={s}>{s}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    {report.isLoading && <p role="status" className="flex items-center justify-center gap-2 py-10"><Loader2 className="size-4 animate-spin" />جارٍ قراءة الطلبات وتفاصيلها</p>}
    {report.error && <p role="alert" className="border-y border-red-200 py-3 text-sm text-red-800">
      {(report.error as Error).message}{report.data && "؛ المعروض آخر قراءة ناجحة، وليس تحديثًا مؤكدًا."}
    </p>}
    {report.data && report.isFetching && <p role="status" className="text-xs text-muted-foreground">جارٍ تحديث حالات الطلبات</p>}
    {report.data && view && <>
      {!report.data.complete && <div role="alert" className="space-y-1 border-y border-red-200 py-3 text-sm text-red-800">
        <p className="flex items-center gap-2"><AlertCircle className="size-4 shrink-0" />التفاصيل غير مكتملة؛ الإحصائيات تشمل البنود المقروءة فقط والتصدير موقوف.</p>
        {report.data.orders.filter(o => o.detailError).map(o => <p key={o.id}>طلب {o.number}: {o.detailError}</p>)}
      </div>}
      <div className="grid grid-cols-2 gap-2 border-y py-3 sm:grid-cols-4">
        {Object.entries(ORDER_STATES).map(([state, label]) => <div key={state} className="min-w-0 space-y-1 text-xs">
          <span>{label}</span><strong className="block text-lg">{view.counts[state as keyof typeof ORDER_STATES]}</strong>
        </div>)}
      </div>
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        {view.rows.slice(0, limit).map(row => {
          const age = orderAgeDays(row.createdAt);
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
              <span>{age == null ? "مدة غير محددة" : `${age} يوم منذ إنشاء الطلب`}</span>
            </div>
          </article>;
        })}
      </div>
      {view.rows.length > limit && <Button variant="outline" className="w-full" onClick={() => setLimit(value => value + 40)}>عرض المزيد</Button>}
      {!view.rows.length && report.data.complete && <p className="py-8 text-center text-sm text-muted-foreground">لا توجد أصناف مطابقة للفلاتر</p>}
      {report.data.orders.filter(o => !o.detailError && !o.lines.length).length > 0 && <details className="border-y py-2 text-xs text-muted-foreground">
        <summary>طلبات بلا أصناف ظاهرة بعد استبعاد الكميات المعتمدة صفرًا</summary>
        {report.data.orders.filter(o => !o.detailError && !o.lines.length).map(o => <p className="pt-1" key={o.id}><bdi>{o.number}</bdi> · {dateLabel(o.createdAt)} · {o.status}</p>)}
      </details>}
      <p className="text-xs leading-5 text-muted-foreground">استُبعد {report.data.excludedZero} بندًا بكمية معتمدة صفر. تواريخ موافقة المورد والاستلام الفعلي غير متاحة من المصدر. المدة المعروضة منذ إنشاء الطلب فقط.</p>
    </>}
  </div>;
}
