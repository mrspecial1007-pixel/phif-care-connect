import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Route } from "@/routes/management.reports.item-tracking";
import { useSession } from "@/lib/queries";
import { itemsAnalyticsScope } from "@/lib/items-analytics-cache.helpers";
import {
  readDispensingTracking,
  exportDispensingTracking,
} from "@/lib/dispensing-tracking.functions";
import {
  trackingQuantityLabel,
  trackingSourceLabel,
  trackingText,
  type TrackingInput,
} from "@/lib/dispensing-tracking.model";
import { ACTUAL_UNITS } from "@/lib/actual-units.helpers";
import { REPORT_BOX_REASONS } from "@/lib/report-box-quantity.helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReportBackLink } from "./ReportBackLink";

const shown = (v: number | null) =>
  v == null ? "غير محدد / غير متاح" : v.toLocaleString("en-US", { maximumFractionDigits: 4 });
const day = (v: string | null) => v || "التاريخ غير محدد";
const selectClass = "min-w-0 w-full rounded-md border bg-background p-2 text-sm";
const cell = "border-b px-3 py-2 text-right align-top whitespace-normal break-words";

export function ReportsItemTrackingPage() {
  const session = useSession();
  const scope = itemsAnalyticsScope(session.data);
  if (session.error) return <p role="alert">تعذر التحقق من الجلسة الحالية</p>;
  if (!scope) return <p role="status">جارٍ التحقق من الجلسة...</p>;
  return <TrackingBody key={scope} scope={scope} />;
}

function TrackingBody({ scope }: { scope: string }) {
  const filters = Route.useSearch();
  const navigate = useNavigate();
  const read = useServerFn(readDispensingTracking),
    exportRead = useServerFn(exportDispensingTracking);
  const request = { ...filters, q: "" };
  const report = useQuery({
    queryKey: ["report_item_tracking", scope, request],
    queryFn: () => read({ data: request }),
    staleTime: 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const data = report.data;
  const [from, setFrom] = useState(filters.from),
    [to, setTo] = useState(filters.to);
  const [limit, setLimit] = useState(40),
    [chronologyLimit, setChronologyLimit] = useState(30);
  const [exportStatus, setExportStatus] = useState("");
  const active = useRef(true),
    busy = useRef(false),
    cancel = useRef<(() => void) | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      cancel.current?.();
    };
  }, []);
  useEffect(() => {
    setFrom(filters.from);
    setTo(filters.to);
  }, [filters.from, filters.to]);
  useEffect(() => {
    setChronologyLimit(30);
  }, [filters.item, filters.product, filters.source, filters.from, filters.to, filters.company]);
  const change = (values: Partial<TrackingInput>) => {
    void navigate({
      to: "/management/reports/item-tracking",
      search: { ...filters, ...values, page: values.page ?? 1 },
      replace: true,
    });
  };
  const term = trackingText(filters.q).replace(/\s/g, "");
  const choices = (data?.catalog || [])
    .flatMap((entry) =>
      filters.mode === "scientific"
        ? [
            {
              item: entry.id,
              product: "",
              label: `${entry.name} · ${entry.strength} · ${entry.form}`,
              search: `${entry.name} ${entry.strength} ${entry.form} ${entry.products.map((p) => p.brand).join(" ")}`,
            },
          ]
        : entry.products.map((p) => ({
            item: entry.id,
            product: p.id,
            label: `${p.brand} · ${entry.strength} · ${entry.form} · ${p.company || "الشركة غير محددة"}`,
            search: `${p.brand} ${entry.name} ${entry.strength} ${p.company || ""}`,
          })),
    )
    .filter((entry) => trackingText(entry.search).replace(/\s/g, "").includes(term));
  function preset(value: string) {
    if (value === "all") {
      change({ from: "", to: "" });
      return;
    }
    const now = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Tripoli",
      year: "numeric",
      month: "2-digit",
    }).format(new Date());
    const [year, month] = now.split("-").map(Number),
      offset = value === "previous" ? -1 : 0;
    const start = new Date(Date.UTC(year, month - 1 + offset, 1)),
      end = new Date(Date.UTC(year, month + offset, 0));
    change({ from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) });
  }
  async function exportFile() {
    if (!data?.selected || !data.canExport || busy.current) return;
    busy.current = true;
    setExportStatus("قراءة جميع النتائج والتحقق من الصلاحيات...");
    try {
      const full = await exportRead({ data: { filters: request, revision: data.revision } });
      if (!active.current) return;
      setExportStatus("إنشاء Excel...");
      const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
        const worker = new Worker(
          new URL("../../lib/dispensing-tracking.worker.ts", import.meta.url),
          { type: "module" },
        );
        const timer = setTimeout(() => finish(new Error("انتهت مهلة إنشاء الملف")), 120_000);
        const finish = (error?: Error, bytes?: ArrayBuffer) => {
          clearTimeout(timer);
          worker.terminate();
          cancel.current = null;
          if (error) reject(error);
          else resolve(bytes!);
        };
        cancel.current = () => finish(new Error("أُلغي التصدير عند مغادرة الصفحة"));
        worker.onmessage = (event) =>
          event.data.error
            ? finish(new Error(event.data.error))
            : finish(undefined, event.data.bytes);
        worker.onerror = () => finish(new Error("تعذر إنشاء ملف Excel"));
        worker.postMessage(full);
      });
      if (!active.current) return;
      const url = URL.createObjectURL(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `PHIF-dispensing-${filters.from || "history"}-${filters.to || full.issuedAt.slice(0, 10)}.xlsx`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success(`تم تصدير ${full.totalMovements} بند صرف`);
    } catch (error) {
      if (active.current) toast.error(error instanceof Error ? error.message : "تعذر التصدير");
    } finally {
      busy.current = false;
      if (active.current) setExportStatus("");
    }
  }
  return (
    <div dir="rtl" className="space-y-5 min-w-0">
      <header className="space-y-2">
        <ReportBackLink to="/management/reports" label="مركز التقارير" />
        <h1 className="text-xl font-bold">تتبع الصرف</h1>
      </header>
      <section className="space-y-3 border-b pb-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
          <select
            aria-label="نوع البحث"
            className={selectClass}
            value={filters.mode}
            onChange={(e) =>
              change({
                mode: e.target.value as TrackingInput["mode"],
                item: "",
                product: "",
                company: "",
              })
            }
          >
            <option value="scientific">الاسم العلمي</option>
            <option value="brand">الاسم التجاري</option>
          </select>
          <div className="relative">
            <Search className="absolute right-3 top-3 size-4 text-muted-foreground" />
            <Input
              className="pr-10"
              aria-label="بحث الأصناف"
              value={filters.q}
              placeholder="الاسم أو التركيز"
              onChange={(e) => {
                change({ q: e.target.value });
                setLimit(40);
              }}
            />
          </div>
        </div>
        <details open={!filters.item}>
          <summary className="text-sm cursor-pointer">الأصناف المطابقة ({choices.length})</summary>
          <div className="max-h-64 overflow-auto divide-y">
            {choices.slice(0, limit).map((c) => (
              <Button
                key={c.product || c.item}
                variant="ghost"
                className="w-full h-auto justify-start whitespace-normal text-right py-3"
                onClick={() => change({ item: c.item, product: c.product, company: "" })}
              >
                <span dir="auto">{c.label}</span>
              </Button>
            ))}
            {choices.length > limit && (
              <Button variant="outline" onClick={() => setLimit((n) => n + 40)}>
                عرض المزيد
              </Button>
            )}
            {!choices.length && !report.isPending && (
              <p className="py-3 text-sm">لا توجد أسماء مطابقة ضمن التاريخ المسموح بقراءته</p>
            )}
          </div>
        </details>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="text-xs">
            المصدر
            <select
              className={selectClass}
              value={filters.source}
              onChange={(e) =>
                change({ source: e.target.value as TrackingInput["source"], company: "" })
              }
            >
              {["all", "phif", "actual"].map((s) => (
                <option value={s} key={s}>
                  {trackingSourceLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            الشركة المسجلة
            <select
              className={selectClass}
              value={filters.company}
              onChange={(e) => change({ company: e.target.value })}
            >
              <option value="">كل الشركات</option>
              {data?.companies.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            من تاريخ
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-xs">
            إلى تاريخ
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => preset("current")}>
            هذا الشهر
          </Button>
          <Button variant="outline" onClick={() => preset("previous")}>
            الشهر السابق
          </Button>
          <Button variant="outline" onClick={() => preset("all")}>
            كل التاريخ
          </Button>
          <Button
            onClick={() =>
              from && to && from > to
                ? toast.error("بداية الفترة بعد نهايتها")
                : change({ from, to })
            }
          >
            تطبيق الفترة
          </Button>
          <Button
            variant="outline"
            disabled={report.isFetching}
            onClick={() => void report.refetch()}
          >
            <RefreshCw className="size-4" />
            تحديث
          </Button>
          <Button
            variant="outline"
            disabled={!data?.selected || !data.canExport || !!exportStatus || report.isFetching}
            onClick={exportFile}
          >
            {exportStatus ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="size-4" />
            )}
            تصدير Excel
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          الفترة: {filters.from || "بداية التاريخ المحفوظ"} إلى{" "}
          {filters.to || "نهاية التاريخ المحفوظ"} · حسب تاريخ الصرف
        </p>
        {exportStatus && (
          <p role="status" className="text-sm">
            {exportStatus}
          </p>
        )}
      </section>
      {report.isFetching && (
        <p role="status" className="text-sm">
          جارٍ قراءة حركات الصرف...
        </p>
      )}
      {report.error && (
        <p role="alert" className="text-destructive">
          {report.error.message}
        </p>
      )}
      {data && (
        <>
          {!!data.hiddenSources.length && (
            <p className="text-amber-800 text-sm">
              المصادر غير المصرح بها غير مشمولة:{" "}
              {data.hiddenSources.map(trackingSourceLabel).join("، ")}
            </p>
          )}
          {!!data.unclassifiedItems && (
            <p className="text-amber-800 text-sm">
              {data.unclassifiedItems} بند في التاريخ مصدره غير مصنف؛ لم يُنسب تلقائيًا إلى Actual
              أو Supplier.
            </p>
          )}
          {filters.item && !data.selected && (
            <p role="alert">
              تعذر تحديد هوية الصنف من الرابط؛ اختره من القائمة دون مطابقة تخمينية.
            </p>
          )}
          {data.selected && (
            <>
              <header className="space-y-2">
                <h2 dir="auto" className="text-lg font-semibold break-words">
                  {data.selected.name} · {data.selected.strength} · {data.selected.form}
                </h2>
                {!data.selected.complete && (
                  <p className="text-amber-800 text-sm">
                    الهوية تحتاج مراجعة؛ لم تُدمج مع هوية أخرى
                  </p>
                )}
                {filters.mode === "brand" && (
                  <>
                    <p dir="auto">
                      {data.selected.products.find((p) => p.id === filters.product)?.brand ||
                        "المنتج التجاري غير محدد"}
                    </p>
                    <Button
                      variant="outline"
                      onClick={() =>
                        change({
                          item: data.selected!.id,
                          mode: "scientific",
                          product: "",
                          company: "",
                        })
                      }
                    >
                      عرض المادة العلمية وجميع منتجاتها
                    </Button>
                  </>
                )}
                <p className="text-xs text-muted-foreground">
                  تاريخ المادة العلمية الكامل عبر المصادر المصرح بها: أول صرف{" "}
                  {day(data.scientificHistory.first)} · آخر صرف {day(data.scientificHistory.last)}
                </p>
                <p className="text-xs text-muted-foreground">
                  تاريخ الاختيار عبر جميع الفترات مع فلتر المصدر والشركة: {day(data.history.first)}{" "}
                  إلى {day(data.history.last)}
                </p>
              </header>
              <div className="grid grid-cols-2 gap-3 border-y py-3 sm:grid-cols-4">
                {[
                  ["الفواتير", shown(data.summary.invoices)],
                  ["بنود الصرف", shown(data.summary.items)],
                  ["المستفيدون بالبطاقة", shown(data.summary.beneficiaries)],
                  ["العلب المتوافقة", shown(data.summary.boxes.value)],
                  ["أول صرف بالفترة", day(data.summary.first)],
                  ["آخر صرف بالفترة", day(data.summary.last)],
                  ["الإيراد المعروف", shown(data.summary.revenue)],
                  ["التكلفة المعروفة", shown(data.summary.cost)],
                  ["الربح المعروف", shown(data.summary.profit)],
                ].map(([title, value]) => (
                  <div key={title} className="min-w-0">
                    <span className="text-xs text-muted-foreground">{title}</span>
                    <strong className="block text-base break-words">{value}</strong>
                  </div>
                ))}
              </div>
              <p className="text-sm">الكميات الأصلية: {trackingQuantityLabel(data.summary)}</p>
              {data.summary.boxes.issues.length > 0 && (
                <p className="text-xs text-amber-800">
                  {data.summary.boxes.issues.map((i) => REPORT_BOX_REASONS[i] || i).join(" · ")}
                </p>
              )}
              {(data.summary.undated > 0 || data.undatedOutsidePeriod > 0) && (
                <p className="text-xs text-amber-800">
                  حركات بلا تاريخ: {data.summary.undated + data.undatedOutsidePeriod}. لا تُوزع
                  زمنيًا، وتظهر كاملة عند اختيار كل التاريخ.
                </p>
              )}
              {!!data.summary.missingCards && (
                <p className="text-xs text-amber-800">
                  {data.summary.missingCards} حركة دون بطاقة؛ لم يُستخدم الاسم لعدّ المستفيدين
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                المالية بالدينار الليبي، وفق الصلاحيات والحسابات الحالية. البنود ذات التكلفة والربح
                المعروفين: {data.summary.knownFinancialItems} / {data.summary.items}.
              </p>
              <section>
                <h3 className="mb-3 font-semibold">التسلسل الزمني لبنود الصرف</h3>
                <div className="h-64 w-full min-w-0" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.timeline}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" minTickGap={24} tick={{ fontSize: 10 }} />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="phif" name="PHIF Supplier" fill="#059669" />
                      <Bar dataKey="actual" name="PHIF Actual Supplier" fill="#2563eb" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-muted-foreground">
                  عدد بنود الصرف في الأيام المسجلة، وليس عدد العلب. الحركات بلا تاريخ غير ممثلة في
                  الرسم.
                </p>
              </section>
              <section className="space-y-2">
                <h3 className="font-semibold">الأسماء التجارية وأول وآخر صرف ضمن الفترة</h3>
                {data.products.map((p) => (
                  <div key={p.key} className="border-b py-3 text-sm">
                    <strong dir="auto">{p.brand || "صرف علمي غير منسوب إلى منتج تجاري"}</strong>
                    <p>
                      {p.company || "الشركة غير محددة"} · {p.summary.items} بند ·{" "}
                      {trackingQuantityLabel(p.summary)}
                    </p>
                    <p>
                      أول صرف: {day(p.summary.first)} · آخر صرف: {day(p.summary.last)}
                    </p>
                    {p.brand && (
                      <p className="text-xs text-muted-foreground">
                        عبر كامل التاريخ والمصادر المصرح بها:{" "}
                        {day(
                          data.selected!.products.find((product) => product.id === p.key)?.history
                            .first || null,
                        )}{" "}
                        إلى{" "}
                        {day(
                          data.selected!.products.find((product) => product.id === p.key)?.history
                            .last || null,
                        )}
                      </p>
                    )}
                    {p.brand && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          change({ item: data.selected!.id, mode: "brand", product: p.key })
                        }
                      >
                        تتبع هذا المنتج فقط
                      </Button>
                    )}
                  </div>
                ))}
              </section>
              <section className="space-y-2">
                <h3 className="font-semibold">سجل الصرف بين الشركات</h3>
                <p className="text-xs text-muted-foreground">
                  أحداث مرتبة بالتاريخ؛ قد تتزامن شركات في اليوم نفسه. لا يثبت السجل تغيير الشركة أو
                  صرف تشغيلة من المخزون الحالي.
                </p>
                {data.chronology.slice(0, chronologyLimit).map((g) => (
                  <div key={g.key} className="border-r-2 pr-3 py-2 text-sm">
                    <strong>{day(g.date)}</strong>
                    <p dir="auto">
                      {g.company || "الشركة غير محددة"} · {g.brand || "صرف علمي غير منسوب"}
                    </p>
                    <p>
                      {trackingSourceLabel(g.source)} · {trackingQuantityLabel(g.summary)}
                    </p>
                  </div>
                ))}
                {chronologyLimit < data.chronology.length && (
                  <Button variant="outline" onClick={() => setChronologyLimit((n) => n + 30)}>
                    عرض المزيد ({data.chronology.length})
                  </Button>
                )}
              </section>
              <section className="space-y-3">
                <h3 className="font-semibold">جميع الفواتير وبنود الصرف ({data.totalMovements})</h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead>
                      <tr>
                        {[
                          "الفاتورة",
                          "التاريخ",
                          "الاسم التجاري",
                          "الشركة",
                          "المصدر",
                          "الكمية الأصلية",
                          "الوحدة",
                          "العلب",
                          "الحالة",
                        ].map((t) => (
                          <th key={t} className={cell}>
                            {t}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.movements.map((r) => (
                        <tr key={r.id}>
                          <td className={cell}>
                            {r.invoiceNumber || r.invoiceId}
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs">تفاصيل الصرف</summary>
                              <p>{r.beneficiary || "الاسم غير متاح"}</p>
                              <p dir="ltr">{r.card || "البطاقة غير متاحة"}</p>
                              <p>الإيراد: {shown(r.revenue)}</p>
                              <p>التكلفة: {shown(r.cost)}</p>
                              <p>الربح: {shown(r.profit)}</p>
                              {r.financialReason && <p>{r.financialReason}</p>}
                            </details>
                          </td>
                          <td className={cell}>{day(r.date)}</td>
                          <td className={cell} dir="auto">
                            {r.brand || "صرف علمي غير منسوب"}
                          </td>
                          <td className={cell}>{r.company || "غير محددة"}</td>
                          <td className={cell}>{trackingSourceLabel(r.source)}</td>
                          <td className={cell}>{shown(r.quantity)}</td>
                          <td className={cell}>{r.unit ? ACTUAL_UNITS[r.unit] : "غير موثقة"}</td>
                          <td className={cell}>{shown(r.boxes)}</td>
                          <td className={cell}>
                            {r.quantityIssue ||
                              (r.boxIssue ? REPORT_BOX_REASONS[r.boxIssue] || r.boxIssue : "موثق")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!data.totalMovements && <p>لا توجد حركات مطابقة للفلاتر الحالية</p>}
                <div className="flex justify-between items-center">
                  <Button
                    title="الصفحة السابقة"
                    aria-label="الصفحة السابقة"
                    variant="outline"
                    size="icon"
                    disabled={data.page <= 1 || report.isFetching}
                    onClick={() => change({ page: data.page - 1 })}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                  <span className="text-sm">
                    {data.page} / {data.pageCount} · {data.totalMovements} بند
                  </span>
                  <Button
                    title="الصفحة التالية"
                    aria-label="الصفحة التالية"
                    variant="outline"
                    size="icon"
                    disabled={data.page >= data.pageCount || report.isFetching}
                    onClick={() => change({ page: data.page + 1 })}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
