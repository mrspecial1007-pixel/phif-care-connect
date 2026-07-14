import { createFileRoute, Link } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import {
  usePatient,
  usePatientHistory,
  usePatientCycles,
  usePatientStatuses,
  useSession,
} from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { upsertPatient } from "@/lib/dispensing.functions";
import { toast } from "sonner";
import { DispenseDialog, RemainingConfirmDialog } from "@/components/DispenseFlow";
import { PhoneSheet } from "@/components/PhoneSheet";
import {
  ArrowRight,
  Pill,
  Building2,
  Share2,
  AlertTriangle,
  Copy,
  Pencil,
  Plus,
  CheckCircle2,
  Clock,
  MapPin,
  Phone,
  CreditCard,
} from "lucide-react";

export const Route = createFileRoute("/patients/$id")({
  component: () => (
    <Gate>
      <Detail />
    </Gate>
  ),
});

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`تم نسخ ${label}`);
  } catch {
    toast.error("تعذر النسخ");
  }
}

function Detail() {
  const { id } = Route.useParams();
  const { data: patient, isLoading } = usePatient(id);
  const { data: history } = usePatientHistory(id);
  const { data: cycles } = usePatientCycles(id);
  const { data: statuses } = usePatientStatuses();
  const { data: session } = useSession();
  const status = statuses?.find((s) => s.patient_id === id);

  const currentCycle = cycles?.[0];
  const isPartial = currentCycle?.status === "Partial";

  const [editOpen, setEditOpen] = useState(false);
  const [editFocus, setEditFocus] = useState<string | null>(null);
  const [dispenseOpen, setDispenseOpen] = useState(false);
  const [remainingConfirmOpen, setRemainingConfirmOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);

  if (isLoading) return <div className="text-center py-10">جاري التحميل…</div>;
  if (!patient) return <div className="text-center py-10">المريض غير موجود</div>;

  return (
    <div className="space-y-4">
      <Link to="/" className="text-sm text-muted-foreground inline-flex items-center gap-1">
        <ArrowRight className="h-4 w-4 rotate-180" /> عودة
      </Link>

      {/* Client info card */}
      <Card className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Pill className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold">{patient.patient_name}</h1>
              {status?.is_shared && (
                <Badge variant="outline">
                  <Share2 className="h-3 w-3 ml-1" /> مشترك
                </Badge>
              )}
              {patient.review_status === "needs_review" && (
                <Badge className="bg-warning text-warning-foreground border-0">
                  <AlertTriangle className="h-3 w-3 ml-1" /> مراجعة
                </Badge>
              )}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditFocus(null);
              setEditOpen(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5 ml-1" /> تعديل البيانات
          </Button>
        </div>

        <div className="space-y-2 text-sm">
          <InfoRow
            icon={<CreditCard className="h-4 w-4" />}
            label="رقم البطاقة"
            value={patient.insurance_card_number}
            onCopy={() =>
              patient.insurance_card_number &&
              copy(patient.insurance_card_number, "رقم البطاقة")
            }
            onAdd={() => {
              setEditFocus("insurance_card_number");
              setEditOpen(true);
            }}
            emptyLabel="لا يوجد رقم بطاقة"
            addLabel="إضافة رقم البطاقة"
          />
          <InfoRow
            icon={<Phone className="h-4 w-4" />}
            label="رقم الهاتف"
            value={patient.phone}
            onAction={() => patient.phone && setPhoneOpen(true)}
            actionLabel="إجراءات الاتصال"
            onAdd={() => {
              setEditFocus("phone");
              setEditOpen(true);
            }}
            emptyLabel="لا يوجد رقم هاتف"
            addLabel="إضافة رقم الهاتف"
          />
          <InfoRow
            icon={<MapPin className="h-4 w-4" />}
            label="العنوان"
            value={patient.address}
            onAdd={() => {
              setEditFocus("address");
              setEditOpen(true);
            }}
            emptyLabel="لا يوجد عنوان"
            addLabel="إضافة العنوان"
          />
        </div>
      </Card>

      {/* Dispensing status card */}
      <Card className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">بيانات الصرف</h2>
          <StatusBadge status={currentCycle?.status ?? "Waiting"} />
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat label="آخر تاريخ صرف" value={fmtDate(status?.last_dispensing_date)} />
          <Stat label="الاستحقاق القادم" value={status?.next_due_date ?? "—"} />
          <Stat
            label="الأيام"
            value={
              status?.remaining_days == null
                ? "—"
                : status.remaining_days >= 0
                ? `متبقي ${status.remaining_days} يوم`
                : `متأخر ${Math.abs(status.remaining_days)} يوم`
            }
            tone={
              status?.remaining_days == null
                ? undefined
                : status.remaining_days < 0
                ? "danger"
                : status.remaining_days <= 3
                ? "warning"
                : "muted"
            }
          />
          <Stat
            label="آخر صيدلية"
            value={status?.last_pharmacy_name ?? "—"}
            icon={<Building2 className="h-3.5 w-3.5" />}
          />
        </div>

        {isPartial ? (
          <Button
            className="w-full h-14 text-base bg-info text-info-foreground hover:bg-info/90"
            onClick={() => setRemainingConfirmOpen(true)}
          >
            <Clock className="h-5 w-5 ml-2" /> صرف متبقي
          </Button>
        ) : (
          <Button
            className="w-full h-14 text-base"
            onClick={() => setDispenseOpen(true)}
          >
            <CheckCircle2 className="h-5 w-5 ml-2" /> تم الصرف
          </Button>
        )}
      </Card>

      {/* History */}
      <Card className="p-4">
        <h2 className="font-semibold mb-3">سجل الصرف</h2>
        <div className="space-y-2">
          {(history ?? []).map((h: any) => (
            <div key={h.id} className="border-b pb-2 last:border-0">
              <div className="flex items-center gap-2">
                <div className="text-xs w-24 text-muted-foreground shrink-0">
                  {new Date(h.dispensing_date).toLocaleDateString("en-GB")}
                </div>
                <Badge
                  className={`border-0 ${
                    h.transaction_type === "Partial"
                      ? "bg-info text-info-foreground"
                      : h.transaction_type === "Remaining"
                      ? "bg-warning text-warning-foreground"
                      : "bg-success text-success-foreground"
                  }`}
                >
                  {h.transaction_type === "Partial"
                    ? "صرف جزئي"
                    : h.transaction_type === "Remaining"
                    ? "صرف متبقي"
                    : "صرف كامل"}
                </Badge>
                <div className="flex-1 text-sm truncate">
                  <Building2 className="h-3.5 w-3.5 inline ml-1 text-muted-foreground" />
                  {h.pharmacies?.name ?? "—"}
                </div>
              </div>
              {h.notes && (
                <div className="text-xs text-muted-foreground mt-1 pr-24">{h.notes}</div>
              )}
            </div>
          ))}
          {(history ?? []).length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-4">لا توجد سجلات</div>
          )}
        </div>
      </Card>

      <EditPatientDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        patient={patient}
        focusField={editFocus}
      />

      <DispenseDialog
        open={dispenseOpen}
        onOpenChange={setDispenseOpen}
        patientId={patient.id}
        patientName={patient.patient_name}
        cardNumber={patient.insurance_card_number}
      />

      <RemainingConfirmDialog
        open={remainingConfirmOpen}
        onOpenChange={setRemainingConfirmOpen}
        patientId={patient.id}
        defaultPharmacyId={session?.unlocked ? session.pharmacy.id : undefined}
      />

      <PhoneSheet
        open={phoneOpen}
        onOpenChange={setPhoneOpen}
        phone={patient.phone}
        patientName={patient.patient_name}
      />
    </div>
  );
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB");
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { text: string; cls: string }> = {
    Completed: { text: "مكتمل", cls: "bg-success text-success-foreground" },
    Partial: { text: "صرف جزئي", cls: "bg-info text-info-foreground" },
    Waiting: { text: "بانتظار الصرف", cls: "bg-secondary text-secondary-foreground" },
  };
  const s = map[status] ?? map.Waiting;
  return <Badge className={`border-0 ${s.cls}`}>{s.text}</Badge>;
}

function Stat({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone?: "danger" | "warning" | "muted";
  icon?: React.ReactNode;
}) {
  const toneCls =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
      ? "text-warning"
      : "text-foreground";
  return (
    <div className="rounded-lg border p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`font-semibold text-sm flex items-center gap-1 ${toneCls}`}>
        {icon}
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
  onCopy,
  onAdd,
  emptyLabel,
  addLabel,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
  onCopy?: () => void;
  onAdd: () => void;
  emptyLabel: string;
  addLabel: string;
}) {
  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border p-2">
        <span className="text-muted-foreground">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-muted-foreground">{label}</div>
          <div className="text-sm font-medium truncate" dir="ltr">
            {value}
          </div>
        </div>
        {onCopy && (
          <Button size="icon" variant="ghost" onClick={onCopy} aria-label={`نسخ ${label}`}>
            <Copy className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed p-2">
      <span className="text-muted-foreground">{icon}</span>
      <div className="flex-1 text-sm text-muted-foreground">{emptyLabel}</div>
      <Button size="sm" variant="outline" onClick={onAdd}>
        <Plus className="h-3.5 w-3.5 ml-1" /> {addLabel}
      </Button>
    </div>
  );
}

function EditPatientDialog({
  open,
  onOpenChange,
  patient,
  focusField,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patient: any;
  focusField: string | null;
}) {
  const [name, setName] = useState(patient.patient_name ?? "");
  const [card, setCard] = useState(patient.insurance_card_number ?? "");
  const [phone, setPhone] = useState(patient.phone ?? "");
  const [address, setAddress] = useState(patient.address ?? "");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const upsert = useServerFn(upsertPatient);

  useEffect(() => {
    if (open) {
      setName(patient.patient_name ?? "");
      setCard(patient.insurance_card_number ?? "");
      setPhone(patient.phone ?? "");
      setAddress(patient.address ?? "");
    }
  }, [open, patient]);

  async function save() {
    if (!name.trim()) {
      toast.error("الاسم مطلوب");
      return;
    }
    setBusy(true);
    try {
      const res = await upsert({
        data: {
          id: patient.id,
          patient_name: name.trim(),
          insurance_card_number: card.trim() || null,
          phone: phone.trim() || null,
          address: address.trim() || null,
        },
      });
      if (!res.ok) {
        toast.error("تعذر حفظ التعديلات");
        return;
      }
      toast.success("تم حفظ البيانات");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["patient", patient.id] }),
        qc.invalidateQueries({ queryKey: ["patient_status"] }),
      ]);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>تعديل البيانات</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>الاسم</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus={focusField === null || focusField === "patient_name"} />
          </div>
          <div>
            <Label>رقم البطاقة</Label>
            <Input
              value={card}
              onChange={(e) => setCard(e.target.value)}
              maxLength={60}
              dir="ltr"
              inputMode="numeric"
              autoFocus={focusField === "insurance_card_number"}
            />
          </div>
          <div>
            <Label>رقم الهاتف</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={40}
              dir="ltr"
              inputMode="tel"
              autoFocus={focusField === "phone"}
            />
          </div>
          <div>
            <Label>العنوان</Label>
            <Textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={500}
              autoFocus={focusField === "address"}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "جاري الحفظ…" : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DispenseDialog({
  open,
  onOpenChange,
  patientId,
  pharmacies,
  defaultPharmacyId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patientId: string;
  pharmacies: { id: string; name: string }[];
  defaultPharmacyId?: string;
}) {
  const [pharmacyId, setPharmacyId] = useState<string>(defaultPharmacyId ?? "");
  const [date, setDate] = useState<string>(todayISO());
  const [allDispensed, setAllDispensed] = useState<boolean | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const dispense = useServerFn(recordDispensing);

  useEffect(() => {
    if (open) {
      setPharmacyId(defaultPharmacyId ?? pharmacies[0]?.id ?? "");
      setDate(todayISO());
      setAllDispensed(null);
      setNotes("");
    }
  }, [open, defaultPharmacyId, pharmacies]);

  const canSave = pharmacyId && date && allDispensed !== null && !busy;

  async function save() {
    if (!pharmacyId || allDispensed === null) return;
    setBusy(true);
    try {
      const res = await dispense({
        data: {
          patient_id: patientId,
          transaction_type: allDispensed ? "Completed" : "Partial",
          pharmacy_id: pharmacyId,
          dispensing_date: date,
          notes: notes || null,
        },
      });
      if (!res.ok) {
        toast.error("تعذر تسجيل الصرف");
        return;
      }
      toast.success(allDispensed ? "تم تسجيل الصرف الكامل" : "تم تسجيل الصرف الجزئي");
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>تم الصرف</DialogTitle>
          <DialogDescription>سجل عملية الصرف الجديدة</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>الصيدلية</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {pharmacies.map((p) => (
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
            <Input
              type="date"
              value={date}
              max={todayISO()}
              onChange={(e) => setDate(e.target.value)}
            />
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
                <Check className="h-4 w-4 inline ml-1" /> نعم، اكتمل الصرف
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
                <Clock className="h-4 w-4 inline ml-1" /> لا، صرف جزئي
              </button>
            </div>
          </div>
          <div>
            <Label>ملاحظات (اختياري)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {busy ? "جاري التسجيل…" : "تسجيل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemainingConfirmDialog({
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
  const qc = useQueryClient();
  const dispense = useServerFn(recordDispensing);

  async function confirmYes() {
    setBusy(true);
    try {
      const res = await dispense({
        data: {
          patient_id: patientId,
          transaction_type: "Remaining",
          pharmacy_id: defaultPharmacyId,
          dispensing_date: todayISO(),
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