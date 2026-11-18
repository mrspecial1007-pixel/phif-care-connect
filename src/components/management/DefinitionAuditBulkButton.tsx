import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { previewReadySupplierUnits, confirmReadySupplierUnit } from "@/lib/definition-audit-bulk.functions";
import { ACTUAL_UNITS } from "@/lib/actual-units.helpers";

type Preview = Awaited<ReturnType<typeof previewReadySupplierUnits>>;
type Outcome = { name: string; status: "confirmed" | "already_confirmed" | "failed" | "uncertain"; message: string };
export function DefinitionAuditBulkButton({ disabled, onBusy, onChanged }: {
  disabled: boolean; onBusy: (busy: boolean) => void; onChanged: () => void;
}) {
  const preview = useServerFn(previewReadySupplierUnits), confirm = useServerFn(confirmReadySupplierUnit);
  const client = useQueryClient();
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [running, setRunning] = useState(false);
  const [plan, setPlan] = useState<Preview | null>(null), [consent, setConsent] = useState(false), [error, setError] = useState("");
  const [outcomes, setOutcomes] = useState<Outcome[]>([]), [done, setDone] = useState(false);
  const alive = useRef(true), lock = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const prepare = async () => {
    if (disabled || lock.current) return;
    lock.current = true; onBusy(true); setLoading(true); setOpen(true); setPlan(null); setError(""); setDone(false); setOutcomes([]); setConsent(false);
    try { const next = await preview({ data: {} }); if (alive.current) setPlan(next); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "تعذرت معاينة جميع الأصناف"); }
    finally { lock.current = false; if (alive.current) { setLoading(false); onBusy(false); } }
  };
  const execute = async () => {
    if (disabled || !plan || !consent || done || lock.current || !plan.ready.length) return;
    lock.current = true; onBusy(true); setRunning(true); setError("");
    const results: Outcome[] = [];
    try {
      for (const item of plan.ready) {
        if (!alive.current) break;
        let result: Omit<Outcome, "name">;
        try { result = await confirm({ data: { token: item.token, confirm: true } }); }
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
          <p className="text-sm">جاهزة: <strong>{plan.ready.length}</strong> · مستبعدة: <strong>{plan.excluded.length}</strong></p>
          <p className="text-xs text-muted-foreground">المعاينة: {new Date(plan.checkedAt).toLocaleString("ar-LY")}</p>
          <p className="text-sm">ستُرسل القيم المحفوظة كما هي إلى دالة التوثيق الفردية. لا تُعتمد قيم افتراضية أو وحدات ناقصة، ولا تُعدّل الفواتير أو Actual.</p>
          <details><summary className="text-sm">الأصناف الجاهزة وقيمها</summary><div className="max-h-52 overflow-auto text-xs">
            {plan.ready.map(row => <p key={row.identity} className="border-b py-2"><span dir="auto">{row.name}</span> · {row.size} {ACTUAL_UNITS[row.baseUnit as keyof typeof ACTUAL_UNITS]} · وحدة Supplier: {ACTUAL_UNITS[row.unit as keyof typeof ACTUAL_UNITS]} · {row.itemCount} بند</p>)}
          </div></details>
          <details><summary className="text-sm">الأصناف المستبعدة وأسبابها</summary><div className="max-h-52 overflow-auto text-xs">
            {plan.excluded.map((row, index) => <p key={index} className="border-b py-2"><span dir="auto">{row.name}</span>: {row.reason}</p>)}
          </div></details>
          {!done && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} disabled={running || !plan.ready.length} onChange={e => setConsent(e.target.checked)} />أوافق على توثيق القيم المحفوظة للأصناف الجاهزة وعددها {plan.ready.length} دون تغييرها.</label>}
          <Button disabled={disabled || !consent || !plan.ready.length || running || done} onClick={execute}>{running ? `جارٍ التوثيق ${outcomes.length} / ${plan.ready.length}` : "تأكيد توثيق الأصناف الجاهزة"}</Button>
          {(done || outcomes.length > 0) && <div role="status" className="space-y-2 text-sm">
            <p>مؤكدة: {count("confirmed")} · سبق تنفيذها: {count("already_confirmed")} · فاشلة: {count("failed")} · غير مؤكدة: {count("uncertain")} · مستبعدة: {plan.excluded.length} · لم تُنفذ: {plan.ready.length - outcomes.length}</p>
            <p className="text-amber-800">نتائج التدقيق السابقة تحتاج إعادة فحص. تأكيد الحفظ لا يثبت اختفاء كل أسباب المراجعة.</p>
            {count("uncertain") > 0 && <p className="text-destructive">توقف التنفيذ عند نتيجة غير مؤكدة؛ راجع السجل قبل إعادة المحاولة.</p>}
            <details><summary>سجل نتائج العملية</summary>{outcomes.map((r, index) => <p key={index} className="border-b py-2"><span dir="auto">{r.name}</span>: {r.message}</p>)}</details>
          </div>}
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
