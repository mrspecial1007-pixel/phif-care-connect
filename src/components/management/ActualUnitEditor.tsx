import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getActualUnitEditor, saveActualUnits } from "@/lib/actual-units.functions";
import { ACTUAL_UNITS, ACTUAL_UNIT_REASONS, actualConversionFactor, type ActualUnit } from "@/lib/actual-units.helpers";

const queryKeys = ["actual_units", "management_audit", "treasury_report", "management_profit_analysis", "management_monthly_report",
  "report_item_tracking", "report_item_search", "reference_items", "reference_item"];
const money = (value: number) => value.toLocaleString("ar-LY", { maximumFractionDigits: 3 });

export function ActualUnitEditor({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const read = useServerFn(getActualUnitEditor), save = useServerFn(saveActualUnits), client = useQueryClient();
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const scope = useMemo(() => ({ itemId, dateFrom: from || undefined, dateTo: to || undefined }), [itemId, from, to]);
  const query = useQuery({ queryKey: ["actual_units", scope], queryFn: () => read({ data: scope }), retry: false });
  return <Sheet open onOpenChange={open => !open && onClose()}>
    <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto sm:mx-auto sm:max-w-2xl" dir="rtl">
      <SheetHeader className="text-right"><SheetTitle>توثيق وحدات صرف Actual</SheetTitle></SheetHeader>
      <div className="my-3 grid grid-cols-2 gap-2">
        <label className="text-xs">من تاريخ<Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-xs">إلى تاريخ<Input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      </div>
      {query.isFetching && <p className="text-sm">جارٍ تحديث المعاينة...</p>}
      {query.error && <p role="alert" className="text-sm text-destructive">{query.error.message}</p>}
      {query.data && !query.isFetching && <UnitForm key={query.dataUpdatedAt} data={query.data} scope={scope}
        onSave={async input => {
          const result = await save({ data: input });
          await Promise.all(queryKeys.map(key => client.invalidateQueries({ queryKey: [key] })));
          toast.success(`تم حفظ القرار لـ ${result.affected} بند`);
        }} />}
    </SheetContent>
  </Sheet>;
}

function UnitForm({ data, scope, onSave }: { data: any; scope: any; onSave: (input: any) => Promise<void> }) {
  const first = data.rows.find((row: any) => row.decision?.is_active)?.decision;
  const [dispensingUnit, setDispensing] = useState<ActualUnit | "">(first?.dispensing_unit ?? "");
  const [costUnit, setCost] = useState<ActualUnit | "">(first?.cost_unit ?? "");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
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
      await onSave({ scope, confirmed: true, revoke, dispensingUnit, costUnit,
        rows: rows.map(({ id, version, signature, stockSignature }: any) => ({ id, version, signature, stockSignature })) });
    } catch (err) { setError((err as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  const stock = data.stock;
  return <fieldset disabled={busy} className="min-w-0 space-y-3">
    {!data.available && <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">الميزة بانتظار تطبيق migration توثيق الوحدات. لم تُغيَّر بيانات الفواتير.</p>}
    <div className="rounded-md border p-3 text-sm">
      <h3 className="break-words font-bold">{stock.brand_name} · {stock.strength}</h3>
      <p>الشكل: {stock.dosage_unit || "غير موثق"} · العبوة: {stock.package_quantity ?? "—"} · أشرطة/علبة: {stock.strips_quantity ?? "—"}</p>
      <p>سعر المخزون: {stock.cost_price == null ? "غير متاح" : `${money(Number(stock.cost_price))} د.ل`} · {stock.dosage_unit}</p>
      <p className="mt-1 text-xs text-muted-foreground">سعر المخزون المتاح حاليًا، وليس سعرًا تاريخيًا مثبتًا وقت الصرف. اعتماد وحدة السعر أدناه تأكيد منك لمعناها الفعلي.</p>
    </div>
    <div className="grid grid-cols-2 gap-2 text-sm">
      <UnitSelect label="وحدة الكمية المصروفة" value={dispensingUnit} onChange={value => { setDispensing(value); setConfirmed(false); }} />
      <UnitSelect label="وحدة سعر التكلفة" value={costUnit} onChange={value => { setCost(value); setConfirmed(false); }} />
    </div>
    <div className="rounded-md bg-teal-50 p-3 text-sm text-teal-950">
      <strong>{rows.length} بند · {invoices} فاتورة</strong>
      <p>الكمية المختارة: {money(quantity)} {dispensingUnit && ACTUAL_UNITS[dispensingUnit]}</p>
      <p>{factor == null ? "اختر وحدتين موثقتين؛ لن تُحسب تكلفة بتحويل مجهول" : `معامل التحويل: ${factor} · كمية التسعير: ${money(quantity * factor)} ${costUnit && ACTUAL_UNITS[costUnit]}`}</p>
      {factor != null && Number(stock.cost_price) > 0 && <p>معاينة التكلفة وفق السعر الحالي: {money(quantity * factor * Number(stock.cost_price))} د.ل</p>}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => { setExcluded(new Set()); setConfirmed(false); }}>تحديد الكل</Button>
      <Button variant="outline" size="sm" onClick={() => { setExcluded(new Set(data.rows.map((r: any) => r.id))); setConfirmed(false); }}>إلغاء التحديد</Button>
    </div>
    <div className="max-h-64 space-y-2 overflow-y-auto">
      {data.rows.map((row: any) => <div key={row.id} className="rounded-md border p-2 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={!excluded.has(row.id)} onChange={e => {
            setExcluded(previous => { const next = new Set(previous); e.target.checked ? next.delete(row.id) : next.add(row.id); return next; }); setConfirmed(false);
          }} />
          <span className="min-w-0">فاتورة {row.invoice_number} · {row.date}<br />الكمية الأصلية: {row.quantity}
            <span className="block text-xs text-muted-foreground">{row.units.provenance === "manual" ? "موثق يدويًا" : row.units.provenance === "source" ? "وحدة مسجلة من المصدر" : "وحدة غير موثقة"}
              {row.units.dispensingUnit && ` · ${ACTUAL_UNITS[row.units.dispensingUnit as ActualUnit]}`}
              {row.units.issue && ` · ${ACTUAL_UNIT_REASONS[row.units.issue] ?? "التكلفة تحتاج مراجعة"}`}</span>
            {row.decision && <span className="block text-xs text-muted-foreground">{row.decision.is_active ? "آخر اعتماد" : "ملغى"}: {row.decision.updated_actor} · {new Date(row.decision.updated_at).toLocaleString("ar-LY")}</span>}
          </span>
        </label>
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
