import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, Boxes, FileSpreadsheet, FileText, FlaskConical, Lightbulb, Printer, Receipt, Users } from "lucide-react";
import { ReportBackLink } from "@/components/management/ReportBackLink";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useSession } from "@/lib/queries";
import { getItemsAnalytics } from "@/lib/items-analytics.functions";
import { currentReportMonth } from "@/lib/items-analytics.helpers";
import { itemsAnalyticsCacheOptions, itemsAnalyticsScope } from "@/lib/items-analytics-cache.helpers";

type Source = "all" | "actual" | "phif";
type Mv = { identity: string; ingredient: string; strength: string; form: string; brand: string | null; invoiceId: string; date: string; beneficiary: string | null; card: string | null; source: "actual" | "phif"; boxes: number | null };

const SUP = "var(--chart-2)";
const ACT = "var(--chart-1)";
const fmt = (v: number | null | undefined, d = 0) => (v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d }));
const monthLabel = (m: string) => new Intl.DateTimeFormat("ar-LY-u-nu-latn", { month: "short", year: "numeric" }).format(new Date(`${m}-15`));
const shiftMonth = (m: string, n: number) => { const [y, mo] = m.split("-").map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

function aggregate(mv: Mv[]) {
  const invoices = new Set<string>(), bens = new Set<string>(), generics = new Map<string, any>();
  let sup = 0, act = 0, unknown = 0;
  for (const r of mv) {
    invoices.add(r.invoiceId);
    const who = r.card || r.beneficiary; if (who) bens.add(who);
    const b = r.boxes ?? 0; if (r.boxes == null) unknown++;
    if (r.source === "phif") sup += b; else act += b;
    const g = generics.get(r.identity) ?? { id: r.identity, name: r.ingredient, strength: r.strength, form: r.form, sup: 0, act: 0, bens: new Set<string>(), brands: new Map<string, any>() };
    if (r.source === "phif") g.sup += b; else g.act += b;
    if (who) g.bens.add(who);
    const bk = `${r.brand || "بدون اسم تجاري"}|${r.source}`;
    const br = g.brands.get(bk) ?? { brand: r.brand || "بدون اسم تجاري", source: r.source, boxes: 0, bens: new Set<string>() };
    br.boxes += b; if (who) br.bens.add(who); g.brands.set(bk, br);
    generics.set(r.identity, g);
  }
  const list = [...generics.values()].map((g) => ({ ...g, total: g.sup + g.act, benCount: g.bens.size, brandList: [...g.brands.values()].map((b: any) => ({ ...b, benCount: b.bens.size })).sort((a: any, b: any) => b.boxes - a.boxes) })).sort((a, b) => b.total - a.total);
  return { invoices: invoices.size, beneficiaries: bens.size, generics: list, sup, act, total: sup + act, unknown, rows: mv.length };
}

function Panel({ title, hint, children, className = "" }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={`break-inside-avoid p-4 ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-2"><h2 className="text-sm font-bold">{title}</h2>{hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}</div>
      {children}
    </Card>
  );
}
const Empty = ({ text = "لا تتوفر بيانات صرف ضمن الفلاتر الحالية" }: { text?: string }) => (
  <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center text-sm text-muted-foreground"><Activity className="h-6 w-6 opacity-50" />{text}</div>
);
const Legendish = () => (
  <div className="flex gap-4 text-xs"><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: SUP }} />PHIF Supplier</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: ACT }} />PHIF Actual</span></div>
);
const tip = { contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, direction: "rtl" as const }, labelStyle: { color: "var(--foreground)", fontWeight: 600 } };

export function PhifAnalyticsPage() {
  const session = useSession();
  const scope = itemsAnalyticsScope(session.data as any);
  const nowMonth = currentReportMonth();
  const [year, setYear] = useState(nowMonth.slice(0, 4));
  const [mon, setMon] = useState(nowMonth.slice(5, 7));
  const [source, setSource] = useState<Source>("all");
  const [generic, setGeneric] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const month = `${year}-${mon}`;
  const months = useMemo(() => Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5)), [month]);

  const queries = useQueries({
    queries: months.map((m) => ({
      ...itemsAnalyticsCacheOptions,
      queryKey: ["phif_analytics", scope, m],
      enabled: !!scope,
      queryFn: () => getItemsAnalytics({ data: { month: m, source: "all", q: "", sort: "consumption_desc", result: "all", mode: "cumulative", financial: false, export: false } as any }),
    })),
  });
  const current = queries[5];
  const filterMv = (data: any): Mv[] => ((data?.movements ?? []) as Mv[]).filter((r) => (source === "all" || r.source === source) && (generic === "all" || r.identity === generic));
  const allGenerics = useMemo(() => aggregate((current.data?.movements ?? []) as Mv[]).generics, [current.data]);
  const agg = useMemo(() => aggregate(filterMv(current.data)), [current.data, source, generic]);
  const daily = useMemo(() => {
    const days = new Map<string, { day: string; sup: number; act: number }>();
    for (const r of filterMv(current.data)) { const d = r.date.slice(0, 10); const e = days.get(d) ?? { day: d.slice(8, 10), sup: 0, act: 0 }; if (r.source === "phif") e.sup += r.boxes ?? 0; else e.act += r.boxes ?? 0; days.set(d, e); }
    return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [current.data, source, generic]);
  const monthly = months.map((m, i) => { const q = queries[i]; if (!q.data) return { label: monthLabel(m), sup: null, act: null, ready: false }; const a = aggregate(filterMv(q.data)); return { label: monthLabel(m), sup: a.sup, act: a.act, ready: true }; });
  const prev = monthly[4];
  const top = agg.generics.slice(0, 10).map((g) => ({ id: g.id, name: `${g.name} ${g.strength}`.trim(), sup: g.sup, act: g.act }));
  const selected = agg.generics.find((g) => g.id === open);
  const loading = !scope || current.isLoading;
  const hasData = agg.rows > 0;

  const insights = useMemo(() => {
    if (!hasData) return [];
    const out: { t: string; d: string }[] = [];
    const g = agg.generics[0];
    if (g) out.push({ t: "المادة الأعلى صرفًا", d: `${g.name} ${g.strength} بإجمالي ${fmt(g.total, 1)} علبة (${fmt(agg.total ? (g.total / agg.total) * 100 : 0, 1)}% من الصرف).` });
    if (agg.total) out.push({ t: "توزيع المصدر", d: `PHIF Supplier يمثل ${fmt((agg.sup / agg.total) * 100, 1)}% مقابل ${fmt((agg.act / agg.total) * 100, 1)}% لـ Actual.` });
    if (prev.ready && prev.sup != null) { const p = (prev.sup ?? 0) + (prev.act ?? 0); if (p) { const ch = ((agg.total - p) / p) * 100; out.push({ t: ch >= 0 ? "نمو مقارنة بالشهر السابق" : "انخفاض مقارنة بالشهر السابق", d: `تغيّر إجمالي العلب بنسبة ${fmt(Math.abs(ch), 1)}% عن ${prev.label}.` }); } }
    const top3 = agg.generics.slice(0, 3).reduce((s, x) => s + x.total, 0);
    if (agg.total && agg.generics.length > 3) out.push({ t: "تركّز الصرف", d: `أعلى 3 مواد علمية تمثل ${fmt((top3 / agg.total) * 100, 1)}% — راجع مخزونها لتفادي النقص.` });
    if (agg.unknown) out.push({ t: "بيانات تحتاج مراجعة", d: `${fmt(agg.unknown)} حركة بلا عدد علب موثّق ولم تُحتسب في الإجماليات. راجعها من تقرير الأصناف.` });
    return out;
  }, [agg, prev, hasData]);

  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const rows = agg.generics.flatMap((g) => g.brandList.map((b: any) => ({ "المادة العلمية": g.name, "التركيز": g.strength, "الشكل": g.form, "الاسم التجاري": b.brand, "المصدر": b.source === "phif" ? "PHIF Supplier" : "PHIF Actual", "العلب": b.boxes, "المستفيدون": b.benCount })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Generics");
    XLSX.writeFile(wb, `phif-analytics-${month}.xlsx`);
  };

  const years = Array.from({ length: 4 }, (_, i) => String(Number(nowMonth.slice(0, 4)) - i));
  const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";

  return (
    <div className="space-y-4 print:space-y-3" dir="rtl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="print:hidden"><ReportBackLink to="/management" label="الإدارة" /></div>
          <h1 className="text-xl font-bold">PHIF Analytics <span className="font-normal text-muted-foreground">— التحليلات الدوائية</span></h1>
          <p className="text-xs text-muted-foreground">{monthLabel(month)} · {(session.data as any)?.pharmacy?.name ?? "الصيدلية الحالية"} · العلب الموثقة فقط</p>
        </div>
        <Legendish />
      </div>

      <Card className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-5 print:hidden">
        <label className="text-[11px] text-muted-foreground">الشهر<select className={sel} value={mon} onChange={(e) => setMon(e.target.value)}>{Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => <option key={m} value={m}>{monthLabel(`2026-${m}`).split(" ")[0]}</option>)}</select></label>
        <label className="text-[11px] text-muted-foreground">السنة<select className={sel} value={year} onChange={(e) => setYear(e.target.value)}>{years.map((y) => <option key={y}>{y}</option>)}</select></label>
        <label className="text-[11px] text-muted-foreground">الصيدلية<select className={sel} disabled><option>{(session.data as any)?.pharmacy?.name ?? "الصيدلية الحالية"}</option></select></label>
        <label className="text-[11px] text-muted-foreground">المادة العلمية<select className={sel} value={generic} onChange={(e) => setGeneric(e.target.value)}><option value="all">جميع المواد</option>{allGenerics.map((g) => <option key={g.id} value={g.id}>{g.name} {g.strength}</option>)}</select></label>
        <label className="col-span-2 text-[11px] text-muted-foreground sm:col-span-1">مصدر الصرف<select className={sel} value={source} onChange={(e) => setSource(e.target.value as Source)}><option value="all">الكل</option><option value="phif">PHIF Supplier</option><option value="actual">PHIF Actual</option></select></label>
      </Card>

      {current.error ? <Card className="p-6 text-center text-sm text-destructive">تعذر تحميل بيانات التحليلات. <Button variant="outline" size="sm" className="ms-2" onClick={() => current.refetch()}>إعادة المحاولة</Button></Card> : (
      <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          ["الفواتير", agg.invoices, Receipt, undefined],
          ["المستفيدون الفريدون", agg.beneficiaries, Users, undefined],
          ["المواد العلمية", agg.generics.length, FlaskConical, undefined],
          ["إجمالي الصرف (علب)", agg.total, Boxes, undefined],
          ["PHIF Supplier", agg.sup, Boxes, SUP],
          ["PHIF Actual", agg.act, Boxes, ACT],
        ].map(([label, value, Icon, color]: any) => (
          <Card key={label} className="relative overflow-hidden p-3">
            {color && <span className="absolute inset-y-0 right-0 w-1" style={{ background: color }} />}
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">{label}<Icon className="h-4 w-4" /></div>
            {loading ? <Skeleton className="mt-2 h-7 w-16" /> : <p className="mt-1 text-2xl font-bold tabular-nums">{fmt(value, 1)}</p>}
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="أعلى 10 مواد علمية صرفًا" hint="اضغط على المادة لعرض الأسماء التجارية" className="lg:col-span-2">
          {loading ? <Skeleton className="h-72" /> : !top.length ? <Empty /> : (
            <ResponsiveContainer width="100%" height={Math.max(240, top.length * 34)}>
              <BarChart data={top} layout="vertical" margin={{ left: 8, right: 8 }} onClick={(e: any) => e?.activePayload?.[0] && setOpen(e.activePayload[0].payload.id)}>
                <CartesianGrid horizontal={false} stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 11 }} reversed />
                <YAxis type="category" dataKey="name" width={130} orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip {...tip} cursor={{ fill: "var(--accent)" }} formatter={(v: any, n: any) => [fmt(v, 1) + " علبة", n]} />
                <Bar dataKey="sup" name="PHIF Supplier" stackId="a" fill={SUP} className="cursor-pointer" />
                <Bar dataKey="act" name="PHIF Actual" stackId="a" fill={ACT} radius={[4, 0, 0, 4]} className="cursor-pointer" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
        <Panel title="توزيع المصدر">
          {loading ? <Skeleton className="h-60" /> : !agg.total ? <Empty /> : (
            <div className="relative">
              <ResponsiveContainer width="100%" height={230}>
                <PieChart><Pie data={[{ name: "PHIF Supplier", value: agg.sup }, { name: "PHIF Actual", value: agg.act }]} dataKey="value" innerRadius={62} outerRadius={92} paddingAngle={2} stroke="none"><Cell fill={SUP} /><Cell fill={ACT} /></Pie><Tooltip {...tip} formatter={(v: any) => [`${fmt(v, 1)} علبة · ${fmt((v / agg.total) * 100, 1)}%`]} /></PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-xl font-bold tabular-nums">{fmt(agg.total, 1)}</span><span className="text-[11px] text-muted-foreground">علبة</span></div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-center text-xs"><div><b className="tabular-nums">{fmt((agg.sup / agg.total) * 100, 1)}%</b><p className="text-muted-foreground">Supplier</p></div><div><b className="tabular-nums">{fmt((agg.act / agg.total) * 100, 1)}%</b><p className="text-muted-foreground">Actual</p></div></div>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="الحركة اليومية" hint={monthLabel(month)}>
          {loading ? <Skeleton className="h-60" /> : !daily.length ? <Empty /> : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={daily} margin={{ left: 0, right: 8 }}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="day" tick={{ fontSize: 11 }} reversed /><YAxis tick={{ fontSize: 11 }} orientation="right" width={36} /><Tooltip {...tip} labelFormatter={(d) => `يوم ${d}`} formatter={(v: any, n: any) => [fmt(v, 1) + " علبة", n]} /><Line type="monotone" dataKey="sup" name="PHIF Supplier" stroke={SUP} strokeWidth={2.5} dot={false} /><Line type="monotone" dataKey="act" name="PHIF Actual" stroke={ACT} strokeWidth={2.5} dot={false} /></LineChart>
            </ResponsiveContainer>
          )}
        </Panel>
        <Panel title="المقارنة الشهرية" hint="آخر 6 أشهر">
          {monthly.every((m) => !m.ready) ? <Skeleton className="h-60" /> : monthly.every((m) => !m.sup && !m.act) ? <Empty /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={monthly}><CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="label" tick={{ fontSize: 10 }} reversed /><YAxis tick={{ fontSize: 11 }} orientation="right" width={36} /><Tooltip {...tip} cursor={{ fill: "var(--accent)" }} formatter={(v: any, n: any) => [v == null ? "جارٍ التحميل" : fmt(v, 1) + " علبة", n]} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="sup" name="PHIF Supplier" fill={SUP} radius={[4, 4, 0, 0]} /><Bar dataKey="act" name="PHIF Actual" fill={ACT} radius={[4, 4, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      <Panel title="تفاصيل المواد العلمية" hint={`${fmt(agg.generics.length)} مادة`}>
        {loading ? <Skeleton className="h-40" /> : !agg.generics.length ? <Empty /> : (
          <div className="divide-y text-sm">
            <div className="hidden grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] gap-2 pb-2 text-[11px] font-semibold text-muted-foreground md:grid"><span>المادة العلمية</span><span>Supplier</span><span>Actual</span><span>الإجمالي</span><span>المستفيدون</span></div>
            {agg.generics.map((g) => (
              <button key={g.id} type="button" onClick={() => setOpen(g.id)} className="grid w-full grid-cols-2 gap-2 py-2.5 text-right hover:bg-accent/50 md:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] md:items-center">
                <span className="col-span-2 min-w-0 md:col-span-1"><b className="block truncate">{g.name}</b><span className="text-xs text-muted-foreground">{[g.strength, g.form].filter(Boolean).join(" · ")} · {g.brandList.length} اسم تجاري</span></span>
                <span className="tabular-nums"><span className="text-[11px] text-muted-foreground md:hidden">Supplier: </span>{fmt(g.sup, 1)}</span>
                <span className="tabular-nums"><span className="text-[11px] text-muted-foreground md:hidden">Actual: </span>{fmt(g.act, 1)}</span>
                <span className="font-semibold tabular-nums"><span className="text-[11px] font-normal text-muted-foreground md:hidden">الإجمالي: </span>{fmt(g.total, 1)}</span>
                <span className="tabular-nums"><span className="text-[11px] text-muted-foreground md:hidden">المستفيدون: </span>{fmt(g.benCount)}</span>
              </button>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="الاستنتاجات والتوصيات" className="lg:col-span-2">
          {loading ? <Skeleton className="h-32" /> : !insights.length ? <Empty text="لا تتوفر بيانات كافية لاستخلاص استنتاجات" /> : (
            <div className="grid gap-2 sm:grid-cols-2">{insights.map((i) => <div key={i.t} className="rounded-lg border bg-accent/40 p-3"><p className="flex items-center gap-1.5 text-xs font-bold text-primary"><Lightbulb className="h-3.5 w-3.5" />{i.t}</p><p className="mt-1 text-xs leading-relaxed">{i.d}</p></div>)}</div>
          )}
        </Panel>
        <Panel title="التقارير والتصدير" className="print:hidden">
          <div className="space-y-2">
            <Button className="w-full justify-start gap-2" variant="outline" disabled={!hasData} onClick={() => window.print()}><FileText className="h-4 w-4" />تصدير PDF / طباعة</Button>
            <Button className="w-full justify-start gap-2" variant="outline" disabled={!hasData} onClick={exportExcel}><FileSpreadsheet className="h-4 w-4" />تصدير Excel</Button>
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><Printer className="h-3 w-3" />التصدير يطابق الفلاتر الحالية · بدون تكاليف أو أرباح</p>
          </div>
        </Panel>
      </div>
      </>)}

      <Sheet open={!!selected} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="bottom" dir="rtl" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader><SheetTitle className="text-right">{selected?.name} {selected?.strength}</SheetTitle></SheetHeader>
          <div className="mt-3 space-y-2">
            {selected?.brandList.map((b: any) => (
              <div key={b.brand + b.source} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                <div className="min-w-0"><p className="truncate font-semibold">{b.brand}</p><span className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground"><i className="h-2 w-2 rounded-full" style={{ background: b.source === "phif" ? SUP : ACT }} />{b.source === "phif" ? "PHIF Supplier" : "PHIF Actual"} · {fmt(b.benCount)} مستفيد</span></div>
                <b className="tabular-nums">{fmt(b.boxes, 1)} <span className="text-xs font-normal text-muted-foreground">علبة</span></b>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
