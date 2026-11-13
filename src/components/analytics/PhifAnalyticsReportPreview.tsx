import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";
import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { analyticsBoxLabel, type BoxMetric } from "@/lib/phif-analytics.model";

/**
 * Presentation-only A4 preview of the monthly analytics report.
 * Receives values already computed by PhifAnalyticsPage; it never derives new figures.
 * The generics table is paginated by measured row heights, so long names wrap instead of being clipped.
 */
const SUP = "var(--chart-2)";
const ACT = "var(--chart-1)";
const PAGE_W = 794; // 210mm @96dpi
const CONTENT_W = 688; // 210mm minus 14mm side padding on both sides
const fmt = (v: number | null | undefined, d = 0) => (v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d }));
const boxText = (m: BoxMetric) => (m.value == null ? analyticsBoxLabel(m) : fmt(m.value, 3));
const benText = (v: number | null) => (v == null ? "غير متاح" : fmt(v));

export type ReportPreviewProps = {
  open: boolean;
  onClose: () => void;
  pharmacy: string;
  monthTitle: string;
  sourceLabel: string;
  genericLabel: string;
  agg: any;
  invoiceIdsComplete: boolean;
  top: { id: string; name: string; sup: number | null; act: number | null }[];
  daily: any[];
  monthly: { label: string; sup: number | null; act: number | null; ready: boolean; status: string }[];
  comparable: boolean;
  insights: { t: string; d: string }[];
};

function Sheet({ n, total, pharmacy, monthTitle, children }: { n: number; total: number; pharmacy: string; monthTitle: string; children: React.ReactNode }) {
  return (
    <section className="phif-a4 relative flex flex-col bg-card text-card-foreground" dir="rtl">
      <div className="flex items-center justify-between border-b-2 border-primary pb-2 text-[10px] text-muted-foreground">
        <span className="font-bold text-primary">صندوق التأمين الصحي العام — PHIF</span>
        <span>{pharmacy} · {monthTitle}</span>
      </div>
      <div className="min-h-0 flex-1 pt-4">{children}</div>
      <div className="mt-2 flex items-center justify-between border-t pt-2 text-[9px] text-muted-foreground">
        <span>التقرير الشهري للتحليلات الدوائية · العلب الموثقة فقط · بدون تكاليف أو أرباح</span>
        <span className="tabular-nums">صفحة {n} من {total}</span>
      </div>
    </section>
  );
}
const H = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mb-2 flex items-center gap-2 text-[13px] font-bold text-foreground"><i className="h-3.5 w-1 rounded bg-primary" />{children}</h2>
);
const Na = ({ text }: { text: string }) => (
  <div className="flex h-full min-h-24 items-center justify-center rounded border border-dashed text-[11px] text-muted-foreground">{text}</div>
);
const Key = () => (
  <div className="flex gap-3 text-[10px]"><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm" style={{ background: SUP }} />PHIF Supplier</span><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm" style={{ background: ACT }} />PHIF Actual</span></div>
);

export function PhifAnalyticsReportPreview(p: ReportPreviewProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useLayoutEffect(() => {
    if (!p.open) return;
    const el = scroller.current; if (!el) return;
    const fit = () => setScale(Math.min(1, (el.clientWidth - 16) / PAGE_W));
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, [p.open, mounted]);
  useEffect(() => {
    if (!p.open) return;
    document.body.classList.add("phif-report-open");
    const k = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    window.addEventListener("keydown", k);
    return () => { document.body.classList.remove("phif-report-open"); window.removeEventListener("keydown", k); };
  }, [p.open, p.onClose]);
  const generics: any[] = p.agg?.generics ?? [];
  const probe = useRef<HTMLDivElement>(null);
  const [chunks, setChunks] = useState<{ start: number; rows: any[] }[]>([{ start: 0, rows: [] }]);
  useLayoutEffect(() => {
    if (!p.open || !mounted) return;
    const el = probe.current; if (!el) return;
    const area = el.querySelector<HTMLElement>("[data-area]");
    const head = el.querySelector<HTMLElement>("[data-head]");
    const rows = Array.from(el.querySelectorAll<HTMLElement>("tbody tr"));
    if (!area || !head || !rows.length) { setChunks([{ start: 0, rows: [] }]); return; }
    const title = area.querySelector<HTMLElement>("h2");
    const avail = area.clientHeight - (title?.offsetHeight ?? 0) - 8 - head.offsetHeight - 12;
    const out: { start: number; rows: any[] }[] = [];
    let start = 0, used = 0;
    rows.forEach((r, i) => {
      const h = r.offsetHeight;
      if (i > start && used + h > avail) { out.push({ start, rows: generics.slice(start, i) }); start = i; used = 0; }
      used += h;
    });
    out.push({ start, rows: generics.slice(start) });
    setChunks(out);
  }, [p.open, mounted, generics]);
  if (!p.open || !mounted) return null;

  const { agg } = p;
  const total = 2 + chunks.length + 1;
  const prepared = new Intl.DateTimeFormat("ar-LY-u-nu-latn", { dateStyle: "long", timeStyle: "short" }).format(new Date());
  const totalOk = agg.total.state === "complete" && agg.total.value > 0;
  const pct = (m: BoxMetric) => (totalOk && m.value != null ? `${fmt((m.value / agg.total.value) * 100, 1)}%` : "—");
  const dailyGaps = p.daily.some((d) => !d.complete);
  const sheet = { total, pharmacy: p.pharmacy, monthTitle: p.monthTitle };
  const kpis: [string, string, string?][] = [
    ...(p.invoiceIdsComplete ? [["الفواتير", fmt(agg.invoices)] as [string, string]] : []),
    ["بنود الصرف", fmt(agg.rows)],
    ["العبوات المؤكدة", boxText(agg.total)],
    ["المستفيدون الفريدون", benText(agg.beneficiaries.count)],
    ["المواد العلمية المؤكدة", fmt(agg.confirmedGenerics)],
  ];
  const quality = [
    `حالة العبوات: ${analyticsBoxLabel(agg.total)}${agg.total.state !== "complete" ? " — لا تُعرض النسب والترتيب حتى اكتمالها." : "."}`,
    `هويات علمية تحتاج مراجعة: ${fmt(agg.reviewGenerics)}.`,
    agg.beneficiaries.count == null ? "بيانات المستفيدين غير متاحة لبعض البنود، لذا لا يُعرض عدد المستفيدين." : `بنود دون بطاقة: ${fmt(agg.beneficiaries.missing)} · بطاقات غير صالحة: ${fmt(agg.beneficiaries.invalid)}.`,
    ...(dailyGaps ? ["الفجوات في الحركة اليومية تمثل بيانات غير متاحة أو غير متوافقة، وليست صفرًا."] : []),
    ...(!p.comparable ? ["المقارنة الشهرية غير متاحة لعدم توافق العبوات في بعض الأشهر."] : []),
    ...(!p.invoiceIdsComplete ? ["عدد الفواتير غير معروض لعدم اكتمال معرفات الفواتير؛ يُعتمد عدد بنود الصرف."] : []),
  ];

  const table = (rows: any[], offset: number) => (
                  <table className="w-full table-fixed border-collapse text-[10px]">
                    <colgroup><col style={{ width: "4%" }} /><col style={{ width: "28%" }} /><col style={{ width: "11%" }} /><col style={{ width: "11%" }} /><col style={{ width: "12%" }} /><col style={{ width: "12%" }} /><col style={{ width: "12%" }} /><col style={{ width: "10%" }} /></colgroup>
                    <thead data-head><tr className="bg-accent text-right">{["#", "المادة العلمية", "التركيز", "الشكل", "Supplier", "Actual", "الإجمالي", "المستفيدون"].map((h) => <th key={h} className="border px-1.5 py-1.5 font-bold">{h}</th>)}</tr></thead>
                    <tbody>{rows.map((g, i) => (
                      <tr key={g.id} className="even:bg-muted/40">
                        <td className="border px-1.5 py-1 tabular-nums">{offset + i + 1}</td>
                        <td className="border px-1.5 py-1 break-words font-semibold">{g.name}{!g.identityComplete && <span className="block text-[8px] font-normal text-muted-foreground">تحتاج مراجعة</span>}</td>
                        <td className="border px-1.5 py-1 break-words">{g.strength || "—"}</td>
                        <td className="border px-1.5 py-1 break-words">{g.form || "—"}</td>
                        <td className="border px-1.5 py-1 tabular-nums">{boxText(g.sup)}</td>
                        <td className="border px-1.5 py-1 tabular-nums">{boxText(g.act)}</td>
                        <td className="border px-1.5 py-1 font-bold tabular-nums">{boxText(g.total)}</td>
                        <td className="border px-1.5 py-1 tabular-nums">{benText(g.beneficiaries.count)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
  );

  return createPortal(
    <div className="phif-report-root fixed inset-0 z-[60] flex flex-col bg-muted" role="dialog" aria-modal="true" aria-label="معاينة التقرير الشهري" dir="rtl">
      <div className="phif-report-toolbar flex items-center justify-between gap-2 border-b bg-background px-3 py-2">
        <div className="min-w-0"><p className="truncate text-sm font-bold">معاينة التقرير الشهري</p><p className="text-[11px] text-muted-foreground">A4 عمودي · {total} صفحات</p></div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" className="gap-1.5" onClick={() => window.print()}><Printer className="h-4 w-4" />طباعة / PDF</Button>
          <Button size="icon" variant="ghost" aria-label="إغلاق" onClick={p.onClose}><X className="h-4 w-4" /></Button>
        </div>
      </div>
      <div ref={probe} aria-hidden className="pointer-events-none fixed top-0 opacity-0" style={{ left: -10000, width: PAGE_W }}>
        <Sheet n={0} {...sheet}><div data-area className="h-full"><H>جدول المواد العلمية (0/0)</H>{generics.length ? table(generics, 0) : null}</div></Sheet>
      </div>
      <div ref={scroller} className="phif-report-scroll flex-1 overflow-auto py-4">
        <div className="phif-report-pages mx-auto" style={{ width: PAGE_W * scale }}>
          <div className="phif-report-scale space-y-4" style={{ width: PAGE_W, transform: `scale(${scale})`, transformOrigin: "top right" }}>

            <Sheet n={1} {...sheet}>
              <div className="rounded-lg border-2 border-primary/30 bg-accent/40 p-4">
                <p className="text-[11px] font-semibold text-primary">صندوق التأمين الصحي العام</p>
                <h1 className="mt-1 text-[22px] font-bold leading-tight">التقرير الشهري للتحليلات الدوائية</h1>
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
                  <div className="flex gap-2"><dt className="text-muted-foreground">الصيدلية:</dt><dd className="font-semibold">{p.pharmacy}</dd></div>
                  <div className="flex gap-2"><dt className="text-muted-foreground">الفترة:</dt><dd className="font-semibold">{p.monthTitle}</dd></div>
                  <div className="flex gap-2"><dt className="text-muted-foreground">مصدر الصرف:</dt><dd className="font-semibold">{p.sourceLabel}</dd></div>
                  <div className="flex gap-2"><dt className="text-muted-foreground">المادة العلمية:</dt><dd className="font-semibold">{p.genericLabel}</dd></div>
                  <div className="col-span-2 flex gap-2"><dt className="text-muted-foreground">تاريخ الإعداد:</dt><dd className="font-semibold tabular-nums">{prepared}</dd></div>
                </dl>
              </div>
              <div className="mt-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${kpis.length}, minmax(0,1fr))` }}>
                {kpis.map(([l, v]) => <div key={l} className="rounded-md border p-2.5"><p className="text-[10px] text-muted-foreground">{l}</p><p className="mt-1 break-words text-[17px] font-bold tabular-nums leading-tight">{v}</p></div>)}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {[["PHIF Supplier", agg.sup, SUP], ["PHIF Actual", agg.act, ACT]].map(([l, m, c]: any) => (
                  <div key={l} className="flex items-center justify-between rounded-md border p-2.5" style={{ borderInlineStartWidth: 4, borderInlineStartColor: c }}>
                    <span className="text-[11px] font-semibold">{l}</span><span className="text-[13px] font-bold tabular-nums">{boxText(m)} <span className="text-[10px] font-normal text-muted-foreground">علبة · {pct(m)}</span></span>
                  </div>
                ))}
              </div>
              <div className="mt-5 grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4">
                <div className="min-w-0 overflow-hidden"><div className="flex items-baseline justify-between"><H>أعلى 10 مواد علمية صرفًا</H><Key /></div>
                  {!agg.rankingComplete ? <Na text="الترتيب غير متاح: العبوات أو الهويات العلمية تحتاج مراجعة" /> : !p.top.length ? <Na text="لا تتوفر بيانات صرف" /> : (
                    <BarChart width={410} height={Math.max(220, p.top.length * 30)} data={p.top} layout="vertical" margin={{ left: 4, right: 4 }}>
                      <CartesianGrid horizontal={false} stroke="var(--border)" />
                      <XAxis type="number" tick={{ fontSize: 9 }} reversed />
                      <YAxis type="category" dataKey="name" width={140} orientation="right" tick={{ fontSize: 9 }} interval={0} />
                      <Bar isAnimationActive={false} dataKey="sup" stackId="a" fill={SUP} />
                      <Bar isAnimationActive={false} dataKey="act" stackId="a" fill={ACT} />
                    </BarChart>
                  )}
                </div>
                <div className="min-w-0 overflow-hidden"><H>توزيع المصدر</H>
                  {!totalOk ? <Na text={agg.total.state === "complete" ? "لا تتوفر بيانات صرف" : `غير متاح: ${analyticsBoxLabel(agg.total)}`} /> : (
                    <div className="relative mx-auto w-[240px]">
                      <PieChart width={240} height={200}><Pie isAnimationActive={false} data={[{ v: agg.sup.value }, { v: agg.act.value }]} dataKey="v" innerRadius={55} outerRadius={85} paddingAngle={2} stroke="none"><Cell fill={SUP} /><Cell fill={ACT} /></Pie></PieChart>
                      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[200px] flex-col items-center justify-center"><b className="text-[16px] tabular-nums">{boxText(agg.total)}</b><span className="text-[9px] text-muted-foreground">علبة</span></div>
                      <div className="mt-1 grid grid-cols-2 text-center text-[10px]"><div><b className="tabular-nums">{pct(agg.sup)}</b><p className="text-muted-foreground">Supplier</p></div><div><b className="tabular-nums">{pct(agg.act)}</b><p className="text-muted-foreground">Actual</p></div></div>
                    </div>
                  )}
                </div>
              </div>
            </Sheet>

            <Sheet n={2} {...sheet}>
              <div className="flex items-baseline justify-between"><H>الحركة اليومية — {p.monthTitle}</H><Key /></div>
              {dailyGaps && <p className="mb-1 text-[10px] text-muted-foreground">الفجوات تمثل بيانات غير متاحة أو غير متوافقة، وليست صفرًا.</p>}
              {!p.daily.length ? <Na text="لا تتوفر بيانات" /> : (
                <LineChart width={CONTENT_W} height={300} data={p.daily} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="day" interval={0} tick={{ fontSize: 8 }} reversed />
                  <YAxis tick={{ fontSize: 9 }} orientation="right" width={34} />
                  <Line isAnimationActive={false} type="linear" connectNulls={false} dataKey="sup" stroke={SUP} strokeWidth={2} dot={false} />
                  <Line isAnimationActive={false} type="linear" connectNulls={false} dataKey="act" stroke={ACT} strokeWidth={2} dot={false} />
                </LineChart>
              )}
              <div className="mt-6"><H>المقارنة الشهرية — آخر 6 أشهر</H>
                <p className="mb-1 text-[10px] text-muted-foreground">{p.monthly.map((m) => `${m.label}: ${m.status}`).join(" · ")}</p>
                {!p.comparable ? <Na text="المقارنة غير متاحة: بيانات العبوات غير مكتملة أو غير متوافقة" /> : p.monthly.every((m) => !m.ready) ? <Na text="بيانات المقارنة غير متاحة" /> : (
                  <BarChart width={CONTENT_W} height={300} data={p.monthly} margin={{ top: 8 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} reversed />
                    <YAxis tick={{ fontSize: 9 }} orientation="right" width={34} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar isAnimationActive={false} dataKey="sup" name="PHIF Supplier" fill={SUP} radius={[3, 3, 0, 0]} />
                    <Bar isAnimationActive={false} dataKey="act" name="PHIF Actual" fill={ACT} radius={[3, 3, 0, 0]} />
                  </BarChart>
                )}
              </div>
            </Sheet>

            {chunks.map(({ rows, start }, ci) => (
              <Sheet key={ci} n={3 + ci} {...sheet}>
                <H>جدول المواد العلمية{chunks.length > 1 ? ` (${ci + 1}/${chunks.length})` : ""}</H>
                {!rows.length ? <Na text="لا تتوفر مواد علمية ضمن الفلاتر" /> : (
                  table(rows, start)
                )}
              </Sheet>
            ))}

            <Sheet n={total} {...sheet}>
              <H>الاستنتاجات</H>
              {!p.insights.length ? <Na text="لا تتوفر بيانات كافية لاستخلاص استنتاجات" /> : (
                <ul className="space-y-2">{p.insights.map((i) => <li key={i.t} className="rounded-md border-s-4 border-primary bg-accent/40 p-2.5 text-[11px]"><b>{i.t}</b><p className="mt-0.5 leading-relaxed">{i.d}</p></li>)}</ul>
              )}
              <div className="mt-6"><H>ملاحظات جودة البيانات</H>
                <ul className="list-disc space-y-1 ps-5 text-[11px] leading-relaxed">{quality.map((q) => <li key={q}>{q}</li>)}</ul>
              </div>
              <div className="mt-10 w-1/2 rounded-md border p-3 text-[11px]">
                <p className="font-bold">إعداد ومراجعة التقرير — الصيدلي المسؤول</p>
                <p className="mt-6 border-b border-dashed pb-1 text-muted-foreground">الاسم:</p>
                <p className="mt-5 border-b border-dashed pb-1 text-muted-foreground">التاريخ:</p>
              </div>
            </Sheet>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
