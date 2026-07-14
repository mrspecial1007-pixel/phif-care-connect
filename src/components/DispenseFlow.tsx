import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Building2, Check, Clock, AlertTriangle, ArrowRight } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { recordDispensing } from "@/lib/dispensing.functions";
import { usePharmacies, useSession } from "@/lib/queries";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, n: number) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function DispenseDialog({
  open,
  onOpenChange,
  patientId,
  patientName,
  cardNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patientId: string;
  patientName?: string;
  cardNumber?: string | null;
}) {
  const { data: pharmacies } = usePharmacies();
  const { data: session } = useSession();
  const defaultPharmacyId = session?.unlocked ? session.pharmacy.id : undefined;
  const qc = useQueryClient();
  const dispense = useServerFn(recordDispensing);

  const [step, setStep] = useState<"form" | "review">("form");
  const [pharmacyId, setPharmacyId] = useState<string>(defaultPharmacyId ?? "");
  const [date, setDate] = useState<string>(todayISO());
  const [allDispensed, setAllDispensed] = useState<boolean | null>(null);
  const [itemsDispensed, setItemsDispensed] = useState<string>("");
  const [itemsRemaining, setItemsRemaining] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>("");
  const [historical, setHistorical] = useState<{ latest: string } | null>(null);

  useEffect(() => {
    if (open) {
      setStep("form");
      setPharmacyId(defaultPharmacyId ?? pharmacies?.[0]?.id ?? "");
      setDate(todayISO());
      setAllDispensed(null);
      setItemsDispensed("");
      setItemsRemaining("");
      setNotes("");
      setHistorical(null);
      setIdempotencyKey(
        typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
      );
    }
  }, [open, defaultPharmacyId, pharmacies]);

  const pharmacyName = useMemo(
    () => pharmacies?.find((p) => p.id === pharmacyId)?.name ?? "—",
    [pharmacies, pharmacyId],
  );
  const canContinue = pharmacyId && date && allDispensed !== null && !busy;

  async function submit(historicalMode?: "append" | "recalc") {
    if (!pharmacyId || allDispensed === null) return;
    setBusy(true);
    try {
      const res: any = await dispense({
        data: {
          patient_id: patientId,
          transaction_type: allDispensed ? "Completed" : "Partial",
          pharmacy_id: pharmacyId,
          dispensing_date: date,
          notes: notes || null,
          items_dispensed: itemsDispensed ? Number(itemsDispensed) : null,
          items_remaining: itemsRemaining ? Number(itemsRemaining) : null,
          idempotency_key: idempotencyKey,
          historical_mode: historicalMode ?? null,
        },
      });
      if (!res.ok) {
        if (res.error === "historical_dispensing") {
          setHistorical({ latest: res.latest_date });
          return;
        }
        toast.error("تعذر تسجيل الصرف");
        return;
      }
      if (res.deduped) {
        toast.info("العملية مسجلة مسبقاً");
      } else {
        toast.success(allDispensed ? "تم تسجيل الصرف الكامل" : "تم تسجيل الصرف الجزئي");
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["patient_history", patientId] }),
        qc.invalidateQueries({ queryKey: ["patient_cycles", patientId] }),
        qc.invalidateQueries({ queryKey: ["patient_status"] }),
      ]);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  const nextDue = allDispensed && date ? addDays(date, 28) : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md max-h-[92vh] overflow-y-auto">
          {step === "form" ? (
            <>
              <DialogHeader>
                <DialogTitle>تم الصرف</DialogTitle>
                <DialogDescription>
                  {patientName ? `المريض: ${patientName}` : "سجل عملية الصرف"}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>الصيدلية</Label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {(pharmacies ?? []).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPharmacyId(p.id)}
                        className={`rounded-lg border p-3 text-sm font-medium transition ${
                          pharmacyId === p.id
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:border-primary/40"
                        }`}
                      >
                        <Building2 className="h-4 w-4 inline ml-1" />
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label>تاريخ الصرف</Label>
                  <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div>
                  <Label>هل تم صرف جميع الأصناف؟</Label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => setAllDispensed(true)}
                      className={`rounded-lg border p-3 text-sm font-medium transition ${
                        allDispensed === true
                          ? "border-success bg-success/10 text-success"
                          : "border-border hover:border-success/40"
                      }`}
                    >
                      <Check className="h-4 w-4 inline ml-1" /> نعم، اكتمل
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllDispensed(false)}
                      className={`rounded-lg border p-3 text-sm font-medium transition ${
                        allDispensed === false
                          ? "border-info bg-info/10 text-info"
                          : "border-border hover:border-info/40"
                      }`}
                    >
                      <Clock className="h-4 w-4 inline ml-1" /> صرف جزئي
                    </button>
                  </div>
                </div>
                {allDispensed === false && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>عدد الأصناف المصروفة</Label>
                      <Input
                        type="number"
                        min={0}
                        value={itemsDispensed}
                        onChange={(e) => setItemsDispensed(e.target.value)}
                        inputMode="numeric"
                      />
                    </div>
                    <div>
                      <Label>الأصناف المتبقية</Label>
                      <Input
                        type="number"
                        min={0}
                        value={itemsRemaining}
                        onChange={(e) => setItemsRemaining(e.target.value)}
                        inputMode="numeric"
                      />
                    </div>
                  </div>
                )}
                <div>
                  <Label>ملاحظات (اختياري)</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  إلغاء
                </Button>
                <Button onClick={() => setStep("review")} disabled={!canContinue}>
                  متابعة <ArrowRight className="h-4 w-4 mr-1 rotate-180" />
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>مراجعة الصرف</DialogTitle>
                <DialogDescription>راجع البيانات قبل التسجيل</DialogDescription>
              </DialogHeader>
              <div className="rounded-lg border divide-y">
                <ReviewRow label="المريض" value={patientName ?? "—"} />
                {cardNumber && <ReviewRow label="رقم البطاقة" value={cardNumber} ltr />}
                <ReviewRow label="الصيدلية" value={pharmacyName} />
                <ReviewRow label="تاريخ الصرف" value={date} ltr />
                <ReviewRow label="نوع الصرف" value={allDispensed ? "صرف كامل" : "صرف جزئي"} />
                {allDispensed === false && (
                  <>
                    <ReviewRow label="المصروفة" value={itemsDispensed || "—"} />
                    <ReviewRow label="المتبقية" value={itemsRemaining || "—"} />
                  </>
                )}
                {nextDue && <ReviewRow label="الاستحقاق القادم" value={nextDue} ltr />}
                {notes && <ReviewRow label="ملاحظات" value={notes} />}
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setStep("form")} disabled={busy}>
                  رجوع
                </Button>
                <Button onClick={() => submit()} disabled={busy}>
                  {busy ? "جاري التسجيل…" : "تأكيد تسجيل الصرف"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <HistoricalDialog
        open={!!historical}
        latest={historical?.latest ?? ""}
        selected={date}
        busy={busy}
        onCancel={() => setHistorical(null)}
        onAppend={async () => {
          setHistorical(null);
          await submit("append");
        }}
        onRecalc={async () => {
          setHistorical(null);
          await submit("recalc");
        }}
      />
    </>
  );
}

function ReviewRow({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold" dir={ltr ? "ltr" : undefined}>
        {value}
      </span>
    </div>
  );
}

function HistoricalDialog({
  open,
  latest,
  selected,
  busy,
  onCancel,
  onAppend,
  onRecalc,
}: {
  open: boolean;
  latest: string;
  selected: string;
  busy: boolean;
  onCancel: () => void;
  onAppend: () => void;
  onRecalc: () => void;
}) {
  const [confirmRecalc, setConfirmRecalc] = useState(false);
  useEffect(() => {
    if (!open) setConfirmRecalc(false);
  }, [open]);
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            صرف بتاريخ سابق
          </AlertDialogTitle>
          <AlertDialogDescription>
            يوجد لهذا العميل عملية صرف أحدث من التاريخ الذي اخترته ({selected}).
            آخر تاريخ مسجل: {latest}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2">
          <Button variant="outline" className="justify-start h-auto py-3 text-right" onClick={onAppend} disabled={busy}>
            <div>
              <div className="font-semibold">إضافة العملية إلى السجل فقط</div>
              <div className="text-xs text-muted-foreground">لن يتغير تاريخ الاستحقاق الحالي</div>
            </div>
          </Button>
          {!confirmRecalc ? (
            <Button
              variant="outline"
              className="justify-start h-auto py-3 text-right border-warning/40"
              onClick={() => setConfirmRecalc(true)}
              disabled={busy}
            >
              <div>
                <div className="font-semibold text-warning">إعادة احتساب دورة الصرف</div>
                <div className="text-xs text-muted-foreground">قد يؤثر على تاريخ الاستحقاق</div>
              </div>
            </Button>
          ) : (
            <Button
              variant="destructive"
              className="h-auto py-3"
              onClick={onRecalc}
              disabled={busy}
            >
              تأكيد إعادة الاحتساب
            </Button>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>إلغاء</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function RemainingConfirmDialog({
  open,
  onOpenChange,
  patientId,
  defaultPharmacyId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patientId: string;
  defaultPharmacyId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const qc = useQueryClient();
  const dispense = useServerFn(recordDispensing);

  useEffect(() => {
    if (open) {
      setIdempotencyKey(
        typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
      );
    }
  }, [open]);

  async function confirmYes() {
    setBusy(true);
    try {
      const res: any = await dispense({
        data: {
          patient_id: patientId,
          transaction_type: "Remaining",
          pharmacy_id: defaultPharmacyId,
          dispensing_date: todayISO(),
          idempotency_key: idempotencyKey,
        },
      });
      if (!res.ok) {
        toast.error("تعذر تسجيل الصرف");
        return;
      }
      toast.success("تم إكمال الصرف وبدء دورة جديدة");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["patient_history", patientId] }),
        qc.invalidateQueries({ queryKey: ["patient_cycles", patientId] }),
        qc.invalidateQueries({ queryKey: ["patient_status"] }),
      ]);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>هل تم الآن صرف باقي الأصناف؟</AlertDialogTitle>
          <AlertDialogDescription>
            عند التأكيد يكتمل الصرف وتبدأ دورة الـ28 يوماً القادمة.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel disabled={busy}>لا</AlertDialogCancel>
          <AlertDialogAction onClick={confirmYes} disabled={busy}>
            {busy ? "جاري التسجيل…" : "نعم"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}