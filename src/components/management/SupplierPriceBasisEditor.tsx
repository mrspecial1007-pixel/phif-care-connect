import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  applyPhifSupplierPrice,
  previewPhifSupplierPrice,
} from "@/lib/phif-supplier-price-basis.functions";
import { supplierPricePresets } from "@/lib/phif-supplier-price-basis.helpers";
import {
  supplierQuantityLabel,
  normalizeSupplierUnit,
} from "@/lib/phif-supplier-quick-cost.helpers";

type Preview = Awaited<ReturnType<typeof previewPhifSupplierPrice>>;
export function SupplierPriceBasisEditor({
  itemId,
  label,
  unit,
  savedBasis,
  quantity,
  reportingBox,
}: {
  itemId: string;
  label: string;
  unit: string | null;
  savedBasis?: { amount: number; count: number; unit: string } | null;
  quantity?: number | null;
  reportingBox?: { units_per_box: number; base_unit: string } | null;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [count, setCount] = useState("1");
  const [selectedUnit, setUnit] = useState(normalizeSupplierUnit(unit) || "");
  const [confirmed, setConfirmed] = useState(false);
  const [historical, setHistorical] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const lock = useRef(false);
  const basis = {
    amount: Number(amount),
    count: Number(count),
    unit: selectedUnit,
    confirmQuantityUnit: !unit && confirmed,
  };
  const reset = () => {
    setPreview(null);
    setMessage("");
    setError("");
  };
  async function examine() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    reset();
    try {
      if (!amount.trim()) throw new Error("أدخل سعر الشراء");
      const rows = await previewPhifSupplierPrice({ data: { itemId, basis, historical } });
      setPreview(rows);
      setSelected(
        rows.filter((row) => row.id === itemId || overwrite || !row.hasCost).map((row) => row.id),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذرت المعاينة");
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  async function save() {
    if (!preview || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const targets = preview.filter((row) => selected.includes(row.id));
    const completed = new Set<string>();
    const failures: string[] = [];
    try {
      for (let offset = 0; offset < targets.length; offset += 50) {
        const result = await applyPhifSupplierPrice({
          data: {
            itemId,
            basis,
            historical,
            targets: targets.slice(offset, offset + 50).map(({ id, version }) => ({ id, version })),
          },
        });
        result.results.forEach((row) =>
          row.ok ? completed.add(row.id) : failures.push(row.error || "تعذر حفظ بند"),
        );
      }
    } catch (failure) {
      failures.push(failure instanceof Error ? failure.message : "تعذر إكمال الحفظ");
    } finally {
      setMessage(`حُفظت تكلفة ${completed.size} بند بصورة مستقلة.`);
      setPreview((previous) => previous?.filter((row) => !completed.has(row.id)) ?? null);
      setSelected((previous) => previous.filter((id) => !completed.has(id)));
      if (failures.length)
        setError(
          `تعذر حفظ بعض البنود: ${[...new Set(failures)].join(" · ")} أعد المعاينة قبل المحاولة مجددًا.`,
        );
      try {
        await Promise.all(
          [
            "reference_items",
            "reference_item",
            "treasury_report",
            "management_profit_analysis",
            "report_item_tracking",
            "management_audit",
            "items_analytics",
          ].map((key) => client.invalidateQueries({ queryKey: [key] })),
        );
      } finally {
        setBusy(false);
        lock.current = false;
      }
    }
  }
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setAmount(savedBasis ? String(savedBasis.amount) : "");
          setCount(
            savedBasis
              ? String(savedBasis.count)
              : reportingBox &&
                  normalizeSupplierUnit(reportingBox.base_unit) === normalizeSupplierUnit(unit)
                ? String(reportingBox.units_per_box)
                : "1",
          );
          setUnit(normalizeSupplierUnit(unit) || normalizeSupplierUnit(savedBasis?.unit) || "");
          setConfirmed(false);
          setHistorical(false);
          setOverwrite(false);
          reset();
          setOpen(true);
        }}
      >
        إدخال سعر الشراء
      </Button>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <SheetContent
          side="bottom"
          dir="rtl"
          className="max-h-[92dvh] overflow-y-auto rounded-t-lg sm:mx-auto sm:max-w-2xl"
        >
          <SheetHeader className="text-right">
            <SheetTitle>سعر شراء PHIF Supplier</SheetTitle>
            <SheetDescription>{label}</SheetDescription>
          </SheetHeader>
          <fieldset disabled={busy} className="mt-4 min-w-0 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="basis-amount">السعر المدخل (د.ل)</Label>
                <Input
                  id="basis-amount"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    reset();
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="basis-unit">وحدة الكمية المصروفة</Label>
                <select
                  id="basis-unit"
                  className="h-10 w-full rounded-md border bg-background px-2 text-sm"
                  disabled={Boolean(unit) || busy}
                  value={selectedUnit}
                  onChange={(e) => {
                    setUnit(e.target.value);
                    setCount("1");
                    reset();
                  }}
                >
                  <option value="">اختر وحدة موثقة</option>
                  {[
                    "TAB",
                    "CAP",
                    "BOX",
                    "STRIP",
                    "PEN",
                    "VIAL",
                    "AMP",
                    "BOTTLE",
                    "EYE_DROPS",
                    "INJ",
                    "ML",
                    "TUBE",
                  ].map((value) => (
                    <option key={value} value={value}>
                      {supplierQuantityLabel(1, value)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {!unit && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => {
                    setConfirmed(e.target.checked);
                    reset();
                  }}
                />
                أؤكد أن كمية هذا البند مسجلة بهذه الوحدة. هذا توثيق لتكلفته فقط، ولا يعدّل بيانات
                الفاتورة.
              </label>
            )}
            <div className="space-y-1">
              <Label htmlFor="basis-count">السعر مقابل</Label>
              <select
                id="basis-count"
                className="h-10 w-full rounded-md border bg-background px-2 text-sm"
                value={count}
                onChange={(e) => {
                  setCount(e.target.value);
                  reset();
                }}
              >
                {[
                  ...new Set([
                    ...supplierPricePresets(selectedUnit),
                    ...(reportingBox &&
                    normalizeSupplierUnit(reportingBox.base_unit) ===
                      normalizeSupplierUnit(selectedUnit)
                      ? [reportingBox.units_per_box]
                      : []),
                    Number(savedBasis?.unit === selectedUnit ? savedBasis.count : 1),
                  ]),
                ]
                  .sort((a, b) => a - b)
                  .map((value) => (
                    <option key={value} value={value}>
                      {supplierQuantityLabel(value, selectedUnit)}
                      {reportingBox?.units_per_box === value &&
                      normalizeSupplierUnit(reportingBox.base_unit) ===
                        normalizeSupplierUnit(selectedUnit)
                        ? " — علبة التقرير"
                        : ""}
                    </option>
                  ))}
              </select>
            </div>
            {amount.trim() && Number.isFinite(basis.amount) && (
              <p className="text-sm">
                سعر الوحدة المحسوب: <bdi>{(basis.amount / basis.count).toFixed(6)}</bdi> د.ل
              </p>
            )}
            {quantity != null && (
              <p className="text-sm">
                كمية الفاتورة: {supplierQuantityLabel(quantity, unit)}
                {unit && amount.trim() && (
                  <span className="block font-semibold" dir="auto">
                    {quantity} × ({amount} ÷ {count}) ={" "}
                    {((quantity * basis.amount) / basis.count).toFixed(3)} د.ل
                  </span>
                )}
              </p>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={historical}
                onChange={(e) => {
                  setHistorical(e.target.checked);
                  reset();
                }}
              />
              تطبيق لمرة واحدة على الفواتير السابقة المطابقة
            </label>
            {historical && (
              <>
                <p className="text-xs text-muted-foreground">
                  تُعرض البنود المؤكدة الهوية والشكل والوحدة والعبوة فقط. البنود ناقصة الهوية لا
                  تُدمج. لا يشمل القرار أي فواتير تصل بعد المعاينة.
                </p>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={overwrite}
                    onChange={(e) => {
                      setOverwrite(e.target.checked);
                      reset();
                    }}
                  />
                  تضمين البنود ذات التكلفة المحفوظة واستبدالها بهذا السعر
                </label>
              </>
            )}
            <Button
              variant="outline"
              onClick={examine}
              disabled={busy || !selectedUnit || (!unit && !confirmed)}
            >
              معاينة البنود والتكلفة
            </Button>
            {preview && (
              <div className="space-y-2 border-t pt-3">
                <p className="text-sm font-bold">
                  {selected.length} بند محدد من {preview.length}
                </p>
                <div className="max-h-52 space-y-2 overflow-y-auto">
                  {preview.map((row) => (
                    <label
                      key={row.id}
                      className="flex items-start gap-2 rounded-md border p-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(row.id)}
                        disabled={row.hasCost && row.id !== itemId && !overwrite}
                        onChange={(e) =>
                          setSelected((previous) =>
                            e.target.checked
                              ? [...previous, row.id]
                              : previous.filter((id) => id !== row.id),
                          )
                        }
                      />
                      <span className="min-w-0 break-words">
                        فاتورة {row.invoiceNumber} · {row.date}
                        <span className="block">
                          {supplierQuantityLabel(row.quantity, row.unit || selectedUnit)} · التكلفة
                          الإجمالية: <bdi>{row.cost.toFixed(3)}</bdi> د.ل
                          {row.hasCost ? " · لها تكلفة محفوظة" : ""}
                        </span>
                        <bdi className="block text-xs">
                          {row.quantity} × ({basis.amount} ÷ {basis.count}) = {row.cost.toFixed(3)}
                        </bdi>
                      </span>
                    </label>
                  ))}
                </div>
                <Button className="w-full" disabled={!selected.length || busy} onClick={save}>
                  {busy ? "جارٍ الحفظ..." : `تأكيد حفظ ${selected.length} بند`}
                </Button>
              </div>
            )}
            {message && (
              <p role="status" className="text-sm text-emerald-700">
                {message}
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </fieldset>
        </SheetContent>
      </Sheet>
    </>
  );
}
