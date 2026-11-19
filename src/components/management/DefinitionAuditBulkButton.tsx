import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { previewReadySupplierUnits, confirmReadySupplierUnit } from "@/lib/definition-audit-bulk.functions";
import { ACTUAL_UNITS, type ActualUnit } from "@/lib/actual-units.helpers";

type Preview = Awaited<ReturnType<typeof previewReadySupplierUnits>>;
type Outcome = { name: string; status: "confirmed" | "already_confirmed" | "failed" | "uncertain"; message: string };
export function selectedSupplierProposals(plan: Preview | null, reviewed: Record<string, boolean>, units: Record<string, string>) {
  return plan?.ready.filter(row => reviewed[row.identity] && row.options.some(o => o.unit === units[row.identity])) || [];
}
export function DefinitionAuditBulkButton({ disabled, onBusy, onChanged }: {
  disabled: boolean; onBusy: (busy: boolean) => void; onChanged: () => void;
}) {
  const preview = useServerFn(previewReadySupplierUnits), confirm = useServerFn(confirmReadySupplierUnit);
  const client = useQueryClient();
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [running, setRunning] = useState(false);
  const [plan, setPlan] = useState<Preview | null>(null), [consent, setConsent] = useState(false), [error, setError] = useState("");
  const [outcomes, setOutcomes] = useState<Outcome[]>([]), [done, setDone] = useState(false);
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const [units, setUnits] = useState<Record<string, string>>({});
  const selected = selectedSupplierProposals(plan, reviewed, units);
  const alive = useRef(true), lock = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const prepare = async () => {
    if (disabled || lock.current) return;
    lock.current = true; onBusy(true); setLoading(true); setOpen(true); setPlan(null); setError(""); setDone(false); setOutcomes([]); setConsent(false);
    setReviewed({}); setUnits({});
    try { const next = await preview({ data: {} }); if (alive.current) {
      setPlan(next); setUnits(Object.fromEntries(next.ready.map(row => [row.identity, row.unit])));
    } }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "تعذرت معاينة جميع الأصناف"); }
    finally { lock.current = false; if (alive.current) { setLoading(false); onBusy(false); } }
  };
  const execute = async () => {
    if (disabled || !plan || !consent || done || lock.current || !selected.length) return;
    lock.current = true; onBusy(true); setRunning(true); setError("");
    const results: Outcome[] = [];
    try {
      for (const item of selected) {
        if (!alive.current) break;
        let result: Omit<Outcome, "name">;
        try { result = await confirm({ data: { token: item.token, confirm: true, unit: units[item.identity] as ActualUnit } }); }
        catch (e) { result = { status: "uncertain", message: e instanceof Error ? e.message : "انقطع الطلب؛ تحقق من سجل العملية قبل إعادة المحاولة" }; }
        results.push({ name: item.name, ...result });
        if (alive.current) { setOutcomes([...results]); onChanged(); }
        if (result.status === "uncertain") break;
      }
    } finally {
      // Invalidate cached reports without launching another historical audit.
      try {
        await client.invalidateQueries({ predicate: query => ["items_analytics", "phif_analytics", "phif_analytics_period"].includes(String(query.queryKey[0])), refetchType: "none" });
      } catch {
        if (alive.current) setError("انتهت محاولة التوثيق، لكن تعذر إبطال التقارير القديمة؛ أعد تحميلها قبل الاعتماد عليها.");
      } finally {
        lock.current = false;
        if (alive.current) { setRunning(false); setDone(true); onBusy(false); }
      }
    }
  };
  const count = (status: Outcome["status"]) => outcomes.filter(r => r.status === status).length;
  return <>
    <Button variant="outline" className="h-auto min-h-9 whitespace-normal" disabled={disabled || loading || running} onClick={prepare}>
      {loading || running ? <Loader2 className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}توثيق جميع الأصناف الجاهزة
    </Button>
    <Dialog open={open} onOpenChange={value => { if (!loading && !running) setOpen(value); }}>
      <DialogContent dir="rtl" className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>توثيق أصناف PHIF Supplier الجاهزة</DialogTitle></DialogHeader>
        {loading && <p role="status">جارٍ فحص جميع أصناف المراجعة عبر كامل التاريخ...</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {plan && <>
          <p className="text-sm">قابلة للمراجعة: <strong>{plan.ready.length}</strong> · راجعها المدير: <strong>{selected.length}</strong> · مستبعدة: <strong>{plan.excluded.length}</strong></p>
          <p className="text-xs text-muted-foreground">المعاينة: {new Date(plan.checkedAt).toLocaleString("ar-LY")}</p>
          <p className="text-sm">راجع وحدة كمية Supplier لكل صنف ثم حدده للاعتماد. المقترح غير المحفوظ ليس توثيقًا. حجم العبوة ووحدتها محفوظان ويظلان دون تغيير، كما في حفظ توثيق الوحدة الفردي.</p>
          <div className="max-h-[45dvh] overflow-auto space-y-2">
            {plan.ready.map(row => <SupplierUnitReviewRow key={row.identity} row={row} unit={units[row.identity] || ""}
              reviewed={!!reviewed[row.identity]} disabled={running || done}
              onUnit={unit => { setUnits(previous => ({ ...previous, [row.identity]: unit }));
                setReviewed(previous => ({ ...previous, [row.identity]: false })); setConsent(false); }}
              onReviewed={value => { setReviewed(previous => ({ ...previous, [row.identity]: value })); setConsent(false); }} />)}
          </div>
          <details><summary className="text-sm">الأصناف المستبعدة وأسبابها</summary><div className="max-h-52 overflow-auto text-xs">
            {plan.excluded.map((row, index) => <p key={index} className="border-b py-2"><span dir="auto">{row.name}</span>: {row.reason}</p>)}
          </div></details>
          {!done && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} disabled={running || !selected.length} onChange={e => setConsent(e.target.checked)} />أوافق على حفظ وحدات Supplier التي راجعتها للأصناف المحددة وعددها {selected.length}، بما فيها المقترحات غير المحفوظة.</label>}
          <Button disabled={disabled || !consent || !selected.length || running || done} onClick={execute}>{running ? `جارٍ التوثيق ${outcomes.length} / ${selected.length}` : "تأكيد توثيق الأصناف المحددة"}</Button>
          {(done || outcomes.length > 0) && <div role="status" className="space-y-2 text-sm">
            <p>مؤكدة: {count("confirmed")} · سبق تنفيذها: {count("already_confirmed")} · فاشلة: {count("failed")} · غير مؤكدة: {count("uncertain")} · مستبعدة: {plan.excluded.length} · لم يحددها المدير: {plan.ready.length - selected.length} · محددة لم تُنفذ: {selected.length - outcomes.length}</p>
            <p className="text-amber-800">نتائج التدقيق السابقة تحتاج إعادة فحص. تأكيد الحفظ لا يثبت اختفاء كل أسباب المراجعة.</p>
            {count("uncertain") > 0 && <p className="text-destructive">توقف التنفيذ عند نتيجة غير مؤكدة؛ راجع السجل قبل إعادة المحاولة.</p>}
            <details><summary>سجل نتائج العملية</summary>{outcomes.map((r, index) => <p key={index} className="border-b py-2"><span dir="auto">{r.name}</span>: {r.message}</p>)}</details>
          </div>}
        </>}
      </DialogContent>
    </Dialog>
  </>;
}

export function SupplierUnitReviewRow({ row, unit, reviewed, disabled, onUnit, onReviewed }: {
  row: Preview["ready"][number]; unit: string; reviewed: boolean; disabled: boolean;
  onUnit: (unit: string) => void; onReviewed: (value: boolean) => void;
}) {
  const conversion = row.options.find(option => option.unit === unit);
  return <section className="space-y-2 border-b py-3 text-sm">
    <p dir="auto" className="font-medium break-words">{row.name}</p>
    <p>العبوة المحفوظة: {row.size} {ACTUAL_UNITS[row.baseUnit as ActualUnit]} · {row.itemCount} بند</p>
    <p className="text-xs text-muted-foreground">وحدة Supplier الحالية: {row.savedUnit ? ACTUAL_UNITS[row.savedUnit as ActualUnit] : "غير محفوظة؛ القيمة أدناه مقترحة وتحتاج موافقتك"}</p>
    <label className="block">وحدة كمية Supplier المعتمدة
      <select className="mt-1 w-full rounded-md border bg-background p-2" value={unit} disabled={disabled}
        onChange={event => onUnit(event.target.value)}>
        {!conversion && <option value={unit}>اختر وحدة قابلة للتحويل؛ المقترح الحالي يحتاج مراجعة</option>}
        {row.options.map(option => <option key={option.unit} value={option.unit}>{ACTUAL_UNITS[option.unit]}</option>)}
      </select>
    </label>
    <p className="text-xs">{conversion ? `معاينة جميع البنود: ${conversion.boxes.toLocaleString("en-US", { maximumFractionDigits: 4 })} علبة` : "لا يمكن اعتماد القيمة الحالية"}</p>
    {row.exceptionCount > 0 && <p className="text-xs">استثناءات محفوظة تُحفظ دون تغيير: {row.exceptionCount}</p>}
    <label className="flex items-start gap-2"><input type="checkbox" checked={reviewed} disabled={disabled || !conversion}
      onChange={event => onReviewed(event.target.checked)} />راجعت وحدة كمية هذا الصنف وأوافق على اعتمادها</label>
  </section>;
}
