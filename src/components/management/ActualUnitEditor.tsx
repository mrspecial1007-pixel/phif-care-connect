import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getActualUnitEditor, saveActualUnits } from "@/lib/actual-units.functions";
import { ACTUAL_UNITS, ACTUAL_UNIT_REASONS, actualConversionFactor, type ActualUnit } from "@/lib/actual-units.helpers";
import { UNIT_SUGGESTION_REASONS } from "@/lib/actual-unit-suggestions.helpers";
import { ActualUnitAccessNotice } from "./ActualUnitAccessNotice";

const queryKeys = ["actual_units", "management_audit", "treasury_report", "management_profit_analysis", "management_monthly_report",
  "report_item_tracking", "report_item_search", "reference_items", "reference_item"];
const money = (value: number) => value.toLocaleString("ar-LY", { maximumFractionDigits: 3 });

export function ActualUnitEditor({ itemId, onClose, access }: { itemId: string; onClose: () => void; access?: { allowed: boolean; subject?: string; code: string; message: string } }) {
  const read = useServerFn(getActualUnitEditor), save = useServerFn(saveActualUnits), client = useQueryClient();
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const scope = useMemo(() => ({ itemId, dateFrom: from || undefined, dateTo: to || undefined }), [itemId, from, to]);
  const query = useQuery({ queryKey: ["actual_units", access?.subject, scope], queryFn: () => read({ data: scope }), retry: false, enabled: access?.allowed === true, staleTime: 0 });
  return <Sheet open onOpenChange={open => !open && onClose()}>
    <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto sm:mx-auto sm:max-w-2xl" dir="rtl">
      <SheetHeader className="text-right"><SheetTitle>توثيق وحدات صرف Actual</SheetTitle></SheetHeader>
      <ActualUnitAccessNotice access={access} />
      <div className="my-3 grid grid-cols-2 gap-2">
        <label className="text-xs">من تاريخ<Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-xs">إلى تاريخ<Input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      </div>
      {query.isFetching && <p className="text-sm">جارٍ تحديث المعاينة...</p>}
      {query.error && <p role="alert" className="text-sm text-destructive">{query.error.message}</p>}
      {access?.allowed && query.data && !query.isFetching && <UnitForm key={query.dataUpdatedAt} data={query.data} scope={scope}
        onSave={async input => {
          const result = await save({ data: input });
          await Promise.all(queryKeys.map(key => client.invalidateQueries({ queryKey: [key] })));
          toast.success(`تم حفظ القرار لـ ${result.affected} بند`);
        }} />}
    </SheetContent>
  </Sheet>;
}

export function UnitForm({ data, scope, onSave }: { data: any; scope: any; onSave: (input: any) => Promise<void> }) {
  const first = data.rows.find((row: any) => row.decision?.is_active)?.decision;
  const [dispensingUnit, setDispensing] = useState<ActualUnit | "">(first?.dispensing_unit ?? "");
  const [costUnit, setCost] = useState<ActualUnit | "">(first?.cost_unit ?? "");
  const [excluded, setExcluded] = useState<Set<string>>(new Set(data.rows.map((r: any) => r.id)));
  const [suggestedOnly, setSuggestedOnly] = useState(false);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const rows = data.rows.filter((row: any) => !excluded.has(row.id));
  const quantity = rows.reduce((sum: number, row: any) => sum + Number(row.quantity), 0);
  const factor = dispensingUnit && costUnit ? actualConversionFactor(dispensingUnit, costUnit, data.stock) : null;
  const invoices = new Set(rows.map((row: any) => row.invoice_id)).size;
  async function submit(revoke: boolean) {
    if (lock.current || !confirmed || !rows.length || rows.length > 1000) return;
    lock.current = true; setBusy(true); setError("");
    try {
      await onSave({ scope, confirmed: true, revoke, dispensingUnit, costUnit, suggestedOnly: suggestedOnly && !revoke,
        rows: rows.map(({ id, version, signature, stockSignature, suggestion }: any) => ({ id, version, signature, stockSignature, priceSignature: suggestion.priceSignature })) });
    } catch (err) { setError((err as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  const stock = data.stock;
  return <fieldset disabled={busy} className="min-w-0 space-y-3">
    {!data.available && <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">الميزة بانتظار تطبيق migration توثيق الوحدات. لم تُغيَّر بيانات الفواتير.</p>}
    <div className="rounded-md border p-3 text-sm">
      <h3 className="break-words font-bold">{stock.brand_name} · {stock.strength}</h3>
      <p>الشكل: {stock.dosage_unit || "غير موثق"} · العبوة: {stock.package_quantity ?? "—"} · أشرطة/علبة: {stock.strips_quantity ?? "—"}</p>
      <p>شراء الوحدة: {stock.cost_price == null ? "غير متاح" : `${money(Number(stock.cost_price))} د.ل`} · بيع الوحدة: {stock.sale_price == null ? "غير متاح" : `${money(Number(stock.sale_price))} د.ل`} · {stock.dosage_unit}</p>
      <p className="mt-1 text-xs text-muted-foreground">سعر المخزون المتاح حاليًا، وليس سعرًا تاريخيًا مثبتًا وقت الصرف. اعتماد وحدة السعر أدناه تأكيد منك لمعناها الفعلي.</p>
    </div>
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">التحقق يقرب الناتج النهائي إلى 0.001 د.ل فقط. الحساب التلقائي يتطلب وحدة مخزون محددة وتوافقًا ماليًا وحيدًا. تحويلات الكمية غير الموثقة تبقى للمراجعة.</p>
      {[...new Set<ActualUnit>(data.rows.filter((r: any) => !r.complete && r.suggestion.status === "high_confidence").map((r: any) => r.suggestion.dispensingUnit))].map(unit => {
        const compatible = data.rows.filter((r: any) => !r.complete && r.suggestion.status === "high_confidence" && r.suggestion.dispensingUnit === unit);
        return <Button key={unit} variant="outline" className="h-auto whitespace-normal py-2" onClick={() => {
          setDispensing(unit); setCost(compatible[0].suggestion.costUnit);
          setExcluded(new Set(data.rows.filter((r: any) => !compatible.includes(r)).map((r: any) => r.id)));
          setSuggestedOnly(true); setConfirmed(false);
        }}>اعتماد الوحدات المتوافقة · {ACTUAL_UNITS[unit]} ({compatible.length})</Button>;
      })}
      {suggestedOnly && <p className="text-xs text-teal-800">تم تحديد البنود المتوافقة فقط؛ راجع الحساب ثم أكد الاعتماد أدناه.</p>}
    </div>
    <div className="grid grid-cols-2 gap-2 text-sm">
      <UnitSelect label="وحدة الكمية المصروفة" value={dispensingUnit} onChange={value => { setDispensing(value); setSuggestedOnly(false); setConfirmed(false); }} />
      <UnitSelect label="وحدة سعر التكلفة" value={costUnit} onChange={value => { setCost(value); setSuggestedOnly(false); setConfirmed(false); }} />
    </div>
    <div className="rounded-md bg-teal-50 p-3 text-sm text-teal-950">
      <strong>{rows.length} بند · {invoices} فاتورة</strong>
      <p>الكمية المختارة: {money(quantity)} {dispensingUnit && ACTUAL_UNITS[dispensingUnit]}</p>
      <p>{factor == null ? "اختر وحدتين موثقتين؛ لن تُحسب تكلفة بتحويل مجهول" : `معامل التحويل: ${factor} · كمية التسعير: ${money(quantity * factor)} ${costUnit && ACTUAL_UNITS[costUnit]}`}</p>
      {factor != null && Number(stock.cost_price) > 0 && <p>معاينة التكلفة وفق السعر الحالي: {money(quantity * factor * Number(stock.cost_price))} د.ل</p>}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => { setExcluded(new Set()); setSuggestedOnly(false); setConfirmed(false); }}>تحديد الكل للمراجعة اليدوية</Button>
      <Button variant="outline" size="sm" onClick={() => { setExcluded(new Set(data.rows.map((r: any) => r.id))); setConfirmed(false); }}>إلغاء التحديد</Button>
    </div>
    <div className="max-h-64 space-y-2 overflow-y-auto">
      {data.rows.map((row: any) => <div key={row.id} className="rounded-md border p-2 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={!excluded.has(row.id)} onChange={e => {
            setExcluded(previous => { const next = new Set(previous); e.target.checked ? next.delete(row.id) : next.add(row.id); return next; }); setConfirmed(false);
          }} />
          <span className="min-w-0">فاتورة {row.invoice_number} · {row.date}<br />الكمية الأصلية: {row.quantity}
            <span className="block text-xs text-muted-foreground">{row.units.provenance === "manual" ? "موثق يدويًا" : row.units.provenance === "pharmacy_tablet_policy" ? "كمية بالأقراص وفق اعتماد الصيدلية" : row.units.provenance === "stock_price_check" ? "محسوب آليًا بوحدة المخزون والتحقق المالي" : row.units.provenance === "source" ? "وحدة مسجلة من المصدر" : "وحدة غير موثقة"}
              {row.units.dispensingUnit && ` · ${ACTUAL_UNITS[row.units.dispensingUnit as ActualUnit]}`}
              {row.units.issue && ` · ${ACTUAL_UNIT_REASONS[row.units.issue] ?? "التكلفة تحتاج مراجعة"}`}</span>
            {row.decision && <span className="block text-xs text-muted-foreground">{row.decision.is_active ? "آخر اعتماد" : "ملغى"}: {row.decision.updated_actor} · {new Date(row.decision.updated_at).toLocaleString("ar-LY")}</span>}
          </span>
        </label>
        <div className={`mt-2 rounded-md p-2 text-xs ${row.complete || row.suggestion.status === "high_confidence" ? "bg-teal-50 text-teal-950" : "bg-amber-50 text-amber-950"}`}>
          <p>قيمة الصرف: {money(row.saleValue)} د.ل</p>
          {row.units.provenance === "pharmacy_tablet_policy" ? <>
            <p>تكلفة القرص معتمدة؛ اختلاف سعر البيع الحالي لا يمنع الحساب.</p>
            {row.purchaseCost != null && <p>التكلفة: {money(row.purchaseCost)} · المكسب: {money(row.profit)} د.ل وفق تكلفة المخزون الحالية</p>}
          </> : <p>{UNIT_SUGGESTION_REASONS[row.suggestion.reason]}</p>}
          {row.suggestion.status === "high_confidence" && <>
            <p>الوحدة المقترحة: {ACTUAL_UNITS[row.suggestion.dispensingUnit as ActualUnit]} · معامل التحويل: {row.suggestion.factor}</p>
            <p dir="ltr">{row.quantity} × {row.suggestion.factor} × {money(row.suggestion.salePrice)} = {money(row.suggestion.expectedValue)} LYD</p>
            <p>بعد الاعتماد: تكلفة {money(row.suggestion.projectedCost)} · مكسب {money(row.suggestion.projectedProfit)} د.ل وفق السعر الحالي</p>
          </>}
        </div>
        <button type="button" className="mt-1 text-xs text-teal-800 underline" onClick={() => {
          setExcluded(previous => new Set([...previous, ...data.rows.filter((r: any) => r.invoice_id === row.invoice_id).map((r: any) => r.id)])); setConfirmed(false);
        }}>استثناء هذه الفاتورة</button>
      </div>)}
    </div>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
      أؤكد وحدة الكمية ووحدة السعر وبيانات العبوة للبنود المحددة فقط ({rows.length} بند). لن يعمّم القرار على فواتير أخرى أو جديدة.</label>
    {rows.length > 1000 && <p className="text-sm text-amber-800">حد الدفعة 1000 بند؛ ضيّق الفترة أو استثنِ بعض الفواتير.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button disabled={!data.available || !confirmed || !rows.length || rows.length > 1000 || factor == null} onClick={() => submit(false)}>اعتماد / تعديل الوحدات</Button>
      <Button variant="outline" disabled={!data.available || !confirmed || rows.length > 1000 || !rows.some((r: any) => r.decision?.is_active)} onClick={() => submit(true)}>إلغاء اعتماد المحدد</Button>
    </div>
    {data.operations.length > 0 && <details className="text-xs"><summary>سجل قرارات البند المرجعي</summary>
      {data.operations.map((operation: any, index: number) => <p key={index} className="border-b py-2">
        {operation.action === "actual_unit_revoke" ? "إلغاء" : "اعتماد / تعديل"} · {operation.actor} · {new Date(operation.at).toLocaleString("ar-LY")}
        <br />{operation.before ?? "—"} ← {operation.after} · وحدة التكلفة: {operation.cost_unit}
      </p>)}
    </details>}
  </fieldset>;
}

function UnitSelect({ label, value, onChange }: { label: string; value: ActualUnit | ""; onChange: (value: ActualUnit) => void }) {
  return <label className="min-w-0 space-y-1">{label}<select className="h-10 w-full rounded-md border bg-background px-2" value={value} onChange={e => onChange(e.target.value as ActualUnit)}>
    <option value="" disabled>اختر الوحدة الموثقة</option>
    {Object.entries(ACTUAL_UNITS).map(([unit, name]) => <option key={unit} value={unit}>{name}</option>)}
  </select></label>;
}
