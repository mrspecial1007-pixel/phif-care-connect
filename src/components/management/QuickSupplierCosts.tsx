import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, ListChecks, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatMoney } from "@/components/management/InvoiceSummaryCard";
import { normalizeSupplierUnit, quickCostComplete, quickCostInput, saveQuickCostEntry, supplierQuantityLabel, supplierQuickCostGroups, type QuickCostEntry, type SupplierCostInput, type SupplierCostMode } from "@/lib/phif-supplier-quick-cost.helpers";

export function QuickSupplierCosts({ invoices, onSave, disabled = false }: {
  invoices: { items: QuickCostEntry[] }[]; onSave: (input: SupplierCostInput) => Promise<unknown>; disabled?: boolean;
}) {
  const groups = useMemo(() => supplierQuickCostGroups(invoices), [invoices]);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("missing");
  const [queue, setQueue] = useState<QuickCostEntry[]>([]);
  const [cursor, setCursor] = useState(0);
  const [working, setWorking] = useState(false);
  const [saved, setSaved] = useState<Record<string, SupplierCostInput>>({});
  const lock = useRef({ busy: false });
  const content = useRef<HTMLDivElement>(null);
  const complete = groups.filter(group => group.complete).length;
  const entries = groups.flatMap(group => group.entries);
  const editable = entries.filter(item => item.can_edit_purchase_price && !item.cost_hidden);
  const missing = entries.filter(item => !quickCostComplete(item)).length;
  const current = queue[cursor];
  const live = current ? entries.find(item => item.item_id === current.item_id) ?? current : null;
  const savedInput = live && saved[live.item_id];
  const item = live && savedInput ? { ...live, unit_purchase_price: savedInput.purchaseCostValue, purchase_cost_mode: savedInput.purchaseCostMode } : live;
  const currentGroup = groups.find(group => group.key === item?.quick_cost_identity);
  const groupQueue = current ? queue.filter(row => row.quick_cost_identity === current.quick_cost_identity) : [];
  const itemPosition = current ? groupQueue.findIndex(row => row.item_id === current.item_id) + 1 : 0;

  function start(nextView: string) {
    setView(nextView);
    // Freeze order for this round: a successful refetch must not skip the next missing item.
    setQueue(editable.filter(item => nextView === "all" || !quickCostComplete(item)));
    setCursor(0);
  }

  return <>
    <section aria-label="أسعار شراء PHIF Supplier" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">أسعار شراء PHIF Supplier</h2>
        <p className="mt-1 text-xs text-muted-foreground">{groups.length} صنف فريد · <span className="text-emerald-700">{complete} مكتمل</span> · <span className="text-amber-700">{groups.length - complete} ناقص</span></p>
        <p className="mt-1 text-xs text-muted-foreground">البنود: {entries.length - missing} مكتمل · {missing} ناقص</p>
      </div>
      <Button size="sm" variant="outline" disabled={disabled || editable.length === 0} onClick={() => { setSaved({}); start(editable.some(row => !quickCostComplete(row)) ? "missing" : "all"); setOpen(true); }}>
        <ListChecks className="ml-2 h-4 w-4" />إدخال التكاليف
      </Button>
    </section>
    <Sheet open={open} onOpenChange={next => { if (!lock.current.busy) setOpen(next); }}>
      <SheetContent ref={content} side="bottom" dir="rtl" className="max-h-[92dvh] overflow-y-auto rounded-t-lg px-4 pb-6 pt-4 sm:mx-auto sm:max-w-2xl" onOpenAutoFocus={event => { event.preventDefault(); content.current?.querySelector<HTMLInputElement>("[data-cost-input]")?.focus(); }}>
        <SheetHeader className="text-right">
          <SheetTitle>إدخال تكاليف PHIF Supplier</SheetTitle>
          <SheetDescription>كل تكلفة تخص بند الفاتورة المعروض فقط.</SheetDescription>
        </SheetHeader>
        <div className="mt-3 space-y-3">
          <ToggleGroup type="single" value={view} onValueChange={value => { if (value && !working) start(value); }} disabled={working} className="grid grid-cols-2 rounded-md bg-muted/50 p-1">
            <ToggleGroupItem value="missing">الناقصة</ToggleGroupItem><ToggleGroupItem value="all">جميع البنود</ToggleGroupItem>
          </ToggleGroup>
          {queue.length > 0 && <div className="space-y-1 text-xs text-muted-foreground" aria-live="polite">
            <span>{Math.min(cursor + 1, queue.length)} من {queue.length} · حُفظ {Object.keys(saved).length} بند</span>
            <Progress value={cursor / queue.length * 100} aria-label="تقدم التنقل بين البنود" />
          </div>}
          {item ? <>
            <Label htmlFor="quick-cost-drug">الصنف</Label>
            <select id="quick-cost-drug" disabled={working} className="h-10 w-full min-w-0 rounded-md border bg-background px-2 text-sm" value={currentGroup?.key ?? ""} onChange={event => setCursor(queue.findIndex(row => row.quick_cost_identity === event.target.value))}>
              {groups.filter(group => queue.some(row => row.quick_cost_identity === group.key)).map(group => <option key={group.key} value={group.key}>{[group.label, group.entries[0].strength, group.entries[0].invoice_dosage_form, group.entries[0].invoice_package_quantity ? `عبوة ${group.entries[0].invoice_package_quantity}` : null].filter(Boolean).join(" · ")}</option>)}
            </select>
            <QuickCostItemSummary item={item} position={itemPosition} count={groupQueue.length} />
            <QuickCostForm key={item.item_id} item={item} lock={lock.current} onBusy={setWorking} onSave={onSave} onNext={input => { setSaved(previous => ({ ...previous, [input.itemId]: input })); setCursor(index => index + 1); }} />
          </> : <p className="py-5 text-center text-sm" role="status">{queue.length ? "انتهت الجولة" : "لا توجد بنود متاحة في هذا العرض"}</p>}
          <div className="flex justify-between gap-2 border-t pt-3">
            <Button variant="outline" disabled={working || cursor === 0} onClick={() => setCursor(index => index - 1)}><ChevronRight className="ml-1 h-4 w-4" />السابق</Button>
            {item && <Button variant="ghost" disabled={working} onClick={() => setCursor(index => index + 1)}>تخطي<ChevronLeft className="mr-1 h-4 w-4" /></Button>}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  </>;
}

export function QuickCostItemSummary({ item, position, count }: { item: QuickCostEntry; position: number; count: number }) {
  const unknownUnit = !normalizeSupplierUnit(item.invoice_quantity_unit);
  const unresolved = item.quick_cost_identity?.startsWith('["unresolved"');
  return <div className="space-y-2 border-y py-3">
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <h3 dir="auto" className="min-w-0 break-words text-xl font-bold leading-7 text-foreground">{item.active_ingredient || item.brand || item.item_name || "صنف غير محدد"}</h3>
      {item.strength && <span dir="ltr" className="max-w-full break-words rounded-md bg-teal-50 px-2 py-0.5 text-sm font-bold text-teal-800 dark:bg-teal-950 dark:text-teal-200">{item.strength}</span>}
    </div>
    <div className="grid grid-cols-2 gap-3 py-1">
      <div className="min-w-0"><p className="text-xs text-muted-foreground">الكمية المصروفة</p><p className="mt-1 break-words text-lg font-bold leading-7">{supplierQuantityLabel(item.quantity, item.invoice_quantity_unit)}</p></div>
      <div className="min-w-0"><p className="text-xs text-muted-foreground">قيمة البيع</p><p className="mt-1 break-words text-2xl font-bold leading-7 text-blue-950 dark:text-blue-100">{item.revenue_hidden ? "محجوب" : formatMoney(item.invoice_value)}</p></div>
    </div>
    {(item.invoice_package_quantity || item.invoice_strips_quantity) && <p className="text-xs text-muted-foreground">{[item.invoice_package_quantity ? `حجم العبوة: ${item.invoice_package_quantity}` : null, item.invoice_strips_quantity ? `أشرطة العبوة: ${item.invoice_strips_quantity}` : null].filter(Boolean).join(" · ")}</p>}
    <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>فاتورة <bdi>{item.invoice_number || "—"}</bdi> · <bdi>{item.dispensing_date?.slice(0, 10) || "—"}</bdi></span><span>البند {position} من {count}</span></div>
    {(unknownUnit || !item.invoice_dosage_form || unresolved) && <details className="rounded-md bg-amber-50/70 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <summary className="cursor-pointer font-medium">بيانات تحتاج تأكيد</summary>
      <ul className="mt-2 list-inside list-disc space-y-1 leading-5">
        {unknownUnit && <li>{item.invoice_unit_issue === "conflict" ? "بيانات وحدة الصرف متعارضة." : "لا توجد وحدة صرف موثقة في بيانات الفاتورة."} يمكن إدخال التكلفة الإجمالية دون تحويل الكمية.</li>}
        {!item.invoice_dosage_form && <li>الشكل الدوائي غير متوفر في بيانات الفاتورة.</li>}
        {unresolved && <li>يبقى هذا البند مستقلًا لأن بيانات الهوية لا تكفي لدمجه بأمان.</li>}
      </ul>
    </details>}
  </div>;
}

function QuickCostForm({ item, lock, onBusy, onSave, onNext }: {
  item: QuickCostEntry; lock: { busy: boolean }; onBusy: (busy: boolean) => void;
  onSave: (input: SupplierCostInput) => Promise<unknown>; onNext: (input: SupplierCostInput) => void;
}) {
  const [mode, setMode] = useState<SupplierCostMode>("total_dispensed_cost");
  const [value, setValue] = useState(item.purchase_cost_mode === "total_dispensed_cost" ? String(item.unit_purchase_price ?? "") : "");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const hasSaved = item.unit_purchase_price !== null && item.unit_purchase_price !== undefined;
  useEffect(() => { field.current?.focus(); field.current?.select(); }, [item.item_id]);
  useEffect(() => { setConfirmed(false); }, [item.unit_purchase_price, item.purchase_cost_mode]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.busy) return;
    setError("");
    try {
      const input = quickCostInput(item, mode, value, confirmed);
      setSaving(true); onBusy(true);
      await saveQuickCostEntry(lock, input, onSave, () => onNext(input));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر حفظ التكلفة. حاول مرة أخرى.");
    } finally {
      setSaving(false); onBusy(false);
    }
  }

  return <form onSubmit={submit} className="space-y-3">
    {hasSaved && <p className="rounded-md bg-muted/50 p-2 text-xs">المحفوظ: {formatMoney(item.unit_purchase_price)} · {item.purchase_cost_mode === "unit_price" ? `سعر الوحدة (${item.unit || "—"})` : "تكلفة الكمية المصروفة"}</p>}
    <Label htmlFor="quick-cost-mode">طريقة الاحتساب</Label>
    <select id="quick-cost-mode" className="h-10 w-full rounded-md border bg-background px-2 text-sm" disabled={saving} value={mode} onChange={event => { setMode(event.target.value as SupplierCostMode); setValue(""); setConfirmed(false); field.current?.focus(); }}>
      <option value="total_dispensed_cost">تكلفة الكمية المصروفة</option>
      <option value="unit_price" disabled={!normalizeSupplierUnit(item.invoice_quantity_unit) || !(Number(item.quantity) > 0)}>سعر الوحدة{normalizeSupplierUnit(item.invoice_quantity_unit) ? ` (${item.invoice_quantity_unit})` : " — تحتاج تأكيد"}</option>
    </select>
    <Label htmlFor="quick-cost-value">{mode === "total_dispensed_cost" ? "تكلفة كامل الكمية المصروفة في هذه الفاتورة (د.ل)" : `سعر الوحدة (${item.invoice_quantity_unit}) بالدينار الليبي`}</Label>
    <Input ref={field} data-cost-input id="quick-cost-value" type="number" min="0" step="any" inputMode="decimal" dir="ltr" disabled={saving} value={value} onChange={event => { setValue(event.target.value); setConfirmed(false); }} aria-invalid={Boolean(error)} aria-describedby={error ? "quick-cost-error" : undefined} />
    {hasSaved && <Label className="flex items-start gap-2 text-xs leading-5"><Checkbox checked={confirmed} disabled={saving} onCheckedChange={checked => setConfirmed(checked === true)} />أؤكد استبدال التكلفة المحفوظة لهذا البند فقط</Label>}
    {error && <p id="quick-cost-error" role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" className="w-full" disabled={saving || (hasSaved && !confirmed)}><Save className="ml-2 h-4 w-4" />{saving ? "جارٍ الحفظ..." : "حفظ والتالي"}</Button>
  </form>;
}
