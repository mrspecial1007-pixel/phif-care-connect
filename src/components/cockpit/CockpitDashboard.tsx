import { useEffect, useState, type ReactNode } from "react";
import { Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// ⚠️ بيانات تجريبية للعرض فقط — غير مرتبطة بأي بيانات فعلية
const DEMO_DUE = [
  { name: "مستفيد تجريبي 1", due: "2026-11-27" },
  { name: "مستفيد تجريبي 2", due: "2026-11-28" },
  { name: "مستفيد تجريبي 3", due: "2026-11-28" },
  { name: "مستفيد تجريبي 4", due: "2026-11-29" },
];
const DEMO_CLAIMS = [
  { period: "08", tracker: 18400, settled: 17950 },
  { period: "09", tracker: 21200, settled: 20100 },
  { period: "10", tracker: 23850, settled: 23850 },
  { period: "11", tracker: 19600, settled: 18200 },
];
const DEMO_DUPES = { count: 3, inflation: 184.5, numbers: ["DEMO-1001", "DEMO-1047", "DEMO-1102"] };
const DEMO_MISSING_COST = 12;
const DEMO_SYNC = { ok: true, at: "2026-11-27 01:40" };
const DEMO_DAILY = Array.from({ length: 26 }, (_, i) => ({ d: i + 1, v: 600 + ((i * 137) % 500) }));

const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const dinar = (n: number) => `${fmt(n, 3)} دينار`;

function Panel({ n, title, loading, children, className = "" }: { n: number; title: string; loading: boolean; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-border bg-card p-3 flex flex-col min-w-0 ${className}`}>
      <header className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs text-primary">{String(n).padStart(2, "0")}</span>
          <h2 className="text-sm font-semibold truncate">{title}</h2>
        </div>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
          <span className={`h-1.5 w-1.5 rounded-full ${loading ? "bg-chart-4 animate-pulse" : "bg-success"}`} />
          {loading ? "جاري التحميل" : "جاهز"}
        </span>
      </header>
      {loading ? <div className="flex-1 min-h-24 rounded-md bg-muted animate-pulse" /> : <div className="flex-1 min-w-0">{children}</div>}
    </section>
  );
}

function Ring({ value, max }: { value: number; max: number }) {
  const r = 34, c = 2 * Math.PI * r, p = Math.min(value / max, 1);
  return (
    <svg viewBox="0 0 80 80" className="h-24 w-24">
      <circle cx="40" cy="40" r={r} fill="none" stroke="var(--muted)" strokeWidth="7" />
      <circle cx="40" cy="40" r={r} fill="none" stroke="var(--primary)" strokeWidth="7" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - p)} transform="rotate(-90 40 40)" />
      <text x="40" y="46" textAnchor="middle" className="fill-foreground" fontSize="20" fontWeight="700">{value}</text>
    </svg>
  );
}

const tip = { contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", fontSize: 11, direction: "rtl" as const } };

export function CockpitDashboard() {
  const [loading, setLoading] = useState(true);
  useEffect(() => { const t = setTimeout(() => setLoading(false), 700); return () => clearTimeout(t); }, []);
  const monthTotal = DEMO_DAILY.reduce((s, x) => s + x.v, 0);

  return (
    <div className="dark">
      <div className="rounded-2xl bg-background text-foreground p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold">لوحة القيادة</h1>
          <span className="rounded-full border border-chart-4/50 px-2 py-0.5 text-[10px] text-chart-4">بيانات تجريبية</span>
        </div>
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          <Panel n={1} title="المنتفعون المستحقون (3 أيام)" loading={loading}>
            <div className="flex items-center gap-3">
              <Ring value={DEMO_DUE.length} max={10} />
              <ul className="flex-1 space-y-1 text-xs min-w-0">
                {DEMO_DUE.map((p) => (
                  <li key={p.name} className="flex justify-between gap-2"><span className="truncate">{p.name}</span><span className="font-mono text-muted-foreground" dir="ltr">{p.due}</span></li>
                ))}
              </ul>
            </div>
          </Panel>

          <Panel n={2} title="المطالبات مقابل التسويات" loading={loading} className="md:col-span-2 xl:col-span-1">
            <div className="h-28" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={DEMO_CLAIMS}>
                  <XAxis dataKey="period" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip {...tip} formatter={(v: number) => dinar(v)} />
                  <Bar dataKey="tracker" name="المتتبع" fill="var(--primary)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="settled" name="التسوية" fill="var(--chart-2)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[10px]">
              {DEMO_CLAIMS.map((c) => {
                const diff = c.tracker - c.settled;
                return <div key={c.period} className="rounded bg-muted p-1"><div className="text-muted-foreground">شهر {c.period}</div><div className={`font-mono ${diff ? "text-destructive" : "text-success"}`}>{fmt(diff)}</div></div>;
              })}
            </div>
          </Panel>

          <Panel n={3} title="الفواتير المكررة" loading={loading}>
            <div className="flex items-end justify-between">
              <div><div className="text-3xl font-bold font-mono">{DEMO_DUPES.count}</div><div className="text-[10px] text-muted-foreground">فاتورة مكررة</div></div>
              <div className="text-left"><div className="text-sm font-semibold text-destructive">{dinar(DEMO_DUPES.inflation)}</div><div className="text-[10px] text-muted-foreground">قيمة التضخم</div></div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">{DEMO_DUPES.numbers.map((x) => <span key={x} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{x}</span>)}</div>
          </Panel>

          <Panel n={4} title="التكاليف الناقصة" loading={loading}>
            <div className="text-3xl font-bold font-mono text-chart-4">{DEMO_MISSING_COST}</div>
            <div className="text-xs text-muted-foreground">صنف بدون سعر تكلفة</div>
          </Panel>

          <Panel n={5} title="حالة المزامنة" loading={loading}>
            <div className="flex items-center gap-3">
              <span className={`h-4 w-4 rounded-full ${DEMO_SYNC.ok ? "bg-success" : "bg-destructive"}`} />
              <div><div className="text-sm font-semibold">{DEMO_SYNC.ok ? "آخر مزامنة ناجحة" : "فشلت المزامنة"}</div><div className="font-mono text-xs text-muted-foreground" dir="ltr">{DEMO_SYNC.at}</div></div>
            </div>
          </Panel>

          <Panel n={6} title="إجمالي الصرف هذا الشهر" loading={loading}>
            <div className="text-2xl font-bold">{dinar(monthTotal)}</div>
            <div className="h-12 mt-1" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={DEMO_DAILY}><Tooltip {...tip} formatter={(v: number) => dinar(v)} labelFormatter={(d) => `يوم ${d}`} /><Line dataKey="v" stroke="var(--primary)" strokeWidth={2} dot={false} /></LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
