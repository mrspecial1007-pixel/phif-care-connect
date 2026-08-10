import { createFileRoute, Link } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import {
  usePatient,
  usePatientHistory,
  usePatientDueTracks,
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
import { upsertPatient, archivePatient, setFollowUpStatus } from "@/lib/dispensing.functions";
import { EditDispenseDialog } from "@/components/EditDispenseDialog";
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
  Star,
  Trash2,
  MoreVertical,
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
  const { data: dueTracks } = usePatientDueTracks(id);
  const { data: statuses } = usePatientStatuses();
  const { data: session } = useSession();
  const status = statuses?.find((s) => s.patient_id === id);

  const nearestTrack = dueTracks?.[0];
  const isPartial = false; // Logic for Partial button will be updated inside DispenseFlow

  const [editOpen, setEditOpen] = useState(false);
  const [editFocus, setEditFocus] = useState<string | null>(null);
  const [dispenseOpen, setDispenseOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [suspendLoading, setSuspendLoading] = useState(false);
  const [editDispenseOpen, setEditDispenseOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<any>(null);
  const [favBusy, setFavBusy] = useState(false);
  const qc = useQueryClient();
  const updatePatient = useServerFn(upsertPatient);
  const archive = useServerFn(archivePatient);
  const setSuspension = useServerFn(setFollowUpStatus);
  const navigate = Route.useNavigate();

  if (isLoading) return <div className="text-center py-10">جاري التحميل…</div>;
  if (!patient) return <div className="text-center py-10">المستفيد غير موجود</div>;

  const isFavorite = (patient as any).is_favorite;

  async function toggleFavorite() {
    if (favBusy) return;
    setFavBusy(true);
    try {
      const res = await updatePatient({
        data: {
          id: patient!.id,
          patient_name: patient!.patient_name,
          is_favorite: !isFavorite,
        },
      });
      if (res.ok) {
        toast.success(isFavorite ? "تمت إزالة المستفيد من المفضلة" : "تمت إضافة المستفيد إلى المفضلة");
        qc.invalidateQueries({ queryKey: ["patient", patient!.id] });
        qc.invalidateQueries({ queryKey: ["patient_status"] });
      }
    } catch (err) {
      toast.error("حدث خطأ ما");
    } finally {
      setFavBusy(false);
    }
  }

  async function handleArchive() {
    setArchiveLoading(true);
    try {
      const res = await archive({ data: { id: patient!.id } });
      if (res.ok) {
        toast.success("تم حذف المستفيد بنجاح");
        qc.invalidateQueries({ queryKey: ["patient_status"] });
        navigate({ to: "/" });
      }
    } catch (err) {
      toast.error("حدث خطأ ما");
    } finally {
      setArchiveLoading(false);
    }
  }

  async function handleSuspension(suspended: boolean) {
    setSuspendLoading(true);
    try {
      const res = await setSuspension({ 
        data: { 
          id: patient!.id, 
          suspended, 
          reason: suspended ? suspendReason : null 
        } 
      });
      if (res.ok) {
        toast.success(suspended ? "تم تعليق المتابعة بنجاح" : "تم استئناف المتابعة بنجاح");
        qc.invalidateQueries({ queryKey: ["patient", patient!.id] });
        qc.invalidateQueries({ queryKey: ["patient_status"] });
        setSuspendOpen(false);
        setSuspendReason("");
      }
    } catch (err) {
      toast.error("حدث خطأ ما");
    } finally {
      setSuspendLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <Link to="/" className="text-sm text-muted-foreground inline-flex items-center gap-1">
          <ArrowRight className="h-4 w-4 rotate-180" /> عودة
        </Link>
        <div className="flex gap-2">
          {patient.is_follow_up_suspended ? (
            <Button variant="outline" size="sm" className="text-success hover:text-success hover:bg-success/10" onClick={() => handleSuspension(false)} disabled={suspendLoading}>
              <Clock className="h-4 w-4 ml-1" /> استئناف المتابعة
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="text-warning hover:text-warning hover:bg-warning/10" onClick={() => setSuspendOpen(true)}>
              <Clock className="h-4 w-4 ml-1" /> تعليق المتابعة
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setArchiveConfirmOpen(true)}>
            <Trash2 className="h-4 w-4 ml-1" /> حذف المستفيد
          </Button>
        </div>
      </div>

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
              {patient.is_follow_up_suspended && (
                <Badge className="bg-slate-500 text-white border-0">
                  <Clock className="h-3 w-3 ml-1" /> متابعة معلقة
                </Badge>
              )}
              {patient.review_status === "needs_review" && (
                <Badge className="bg-warning text-warning-foreground border-0">
                  <AlertTriangle className="h-3 w-3 ml-1" /> مراجعة
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className={isFavorite ? "text-amber-600 bg-amber-50 border-amber-200" : ""}
                onClick={toggleFavorite}
                disabled={favBusy}
              >
                {isFavorite ? (
                  <Star className="h-3.5 w-3.5 ml-1 fill-current" />
                ) : (
                  <Star className="h-3.5 w-3.5 ml-1" />
                )}
                {isFavorite ? "مفضل" : "إضافة للمفضلة"}
              </Button>
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
          </div>
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
            icon={<CreditCard className="h-4 w-4" />}
            label="الرقم الوطني"
            value={patient.national_id}
            onCopy={() =>
              patient.national_id &&
              copy(patient.national_id, "الرقم الوطني")
            }
            onAdd={() => {
              setEditFocus("national_id");
              setEditOpen(true);
            }}
            emptyLabel="لا يوجد رقم وطني"
            addLabel="إضافة الرقم الوطني"
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
            addLabel="إضافة رقم هاتف"
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
            addLabel="إضافة عنوان"
          />
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">بيانات الصرف</h2>
          <StatusBadge status={nearestTrack ? "Waiting" : "Completed"} />
        </div>
        
        <div className="space-y-3">
          {patient.is_follow_up_suspended && patient.follow_up_suspension_reason && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/30 p-2 rounded-md text-xs text-amber-800 dark:text-amber-200 mb-2">
              <strong>سبب التعليق:</strong> {patient.follow_up_suspension_reason}
            </div>
          )}
          {(dueTracks ?? []).slice(0, 2).map((track, idx) => (
            <div key={track.id} className="grid grid-cols-2 gap-3 text-sm border-b pb-3 last:border-0 last:pb-0">
              <Stat label={idx === 0 ? "أقرب استحقاق" : "موعد إضافي"} value={track.next_due_date} />
              <Stat
                label="الأيام"
                value={
                  (() => {
                    const diff = Math.ceil((new Date(track.next_due_date).getTime() - new Date().setHours(0,0,0,0)) / (1000 * 60 * 60 * 24));
                    return diff >= 0 ? `متبقي ${diff} يوم` : `متأخر ${Math.abs(diff)} يوم`;
                  })()
                }
                tone={
                  (() => {
                    const diff = Math.ceil((new Date(track.next_due_date).getTime() - new Date().setHours(0,0,0,0)) / (1000 * 60 * 60 * 24));
                    return diff < 0 ? "danger" : diff <= 3 ? "warning" : "muted";
                  })()
                }
              />
            </div>
          ))}
          
          {dueTracks && dueTracks.length > 2 && (
            <div className="text-xs text-center text-muted-foreground bg-muted/50 py-1 rounded">
              +{dueTracks.length - 2} مواعيد استحقاق أخرى نشطة
            </div>
          )}

          {(!dueTracks || dueTracks.length === 0) && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Stat label="آخر تاريخ صرف" value={fmtDate(status?.last_dispensing_date)} />
              <Stat label="الحالة" value="لا يوجد مواعيد نشطة" tone="muted" />
            </div>
          )}
        </div>

        <div className="space-y-2 pt-2">
          <Button
            className="w-full h-14 text-base"
            onClick={() => setDispenseOpen(true)}
          >
            <CheckCircle2 className="h-5 w-5 ml-2" /> تم الصرف
          </Button>
        </div>
      </Card>

      {/* History */}
      <Card className="p-4">
        <h2 className="font-semibold mb-3">سجل الصرف</h2>
        <div className="space-y-2">
          {(history ?? []).map((h: any) => (
            <div key={h.id} className={`border-b pb-2 last:border-0 ${h.is_cancelled ? 'opacity-50 grayscale' : ''}`}>
              <div className="flex items-center gap-2">
                <div className="text-xs w-20 text-muted-foreground shrink-0">
                  {new Date(h.dispensing_date).toLocaleDateString("en-GB")}
                </div>
                <Badge
                  className={`border-0 ${
                    h.is_cancelled
                      ? "bg-slate-500 text-white"
                      : h.transaction_type === "Partial"
                      ? "bg-info text-info-foreground"
                      : h.transaction_type === "Remaining"
                      ? "bg-warning text-warning-foreground"
                      : "bg-success text-success-foreground"
                  }`}
                >
                  {h.is_cancelled
                    ? "ملغاة"
                    : h.transaction_type === "Partial"
                    ? "صرف جزئي"
                    : h.transaction_type === "Remaining"
                    ? "صرف متبقي"
                    : "صرف كامل"}
                </Badge>
                <div className="flex-1 text-sm truncate">
                  <Building2 className="h-3.5 w-3.5 inline ml-1 text-muted-foreground" />
                  {h.pharmacies?.name ?? "—"}
                </div>
                {!h.is_cancelled && (
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => {
                    setSelectedTx(h);
                    setEditDispenseOpen(true);
                  }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              {h.notes && (
                <div className="text-xs text-muted-foreground mt-1 pr-20">{h.notes}</div>
              )}
              {h.is_cancelled && h.cancellation_reason && (
                <div className="text-[10px] text-destructive italic mt-0.5 pr-20">سبب الإلغاء: {h.cancellation_reason}</div>
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


      {patient?.phone && (
        <PhoneSheet 
          open={phoneOpen} 
          onOpenChange={setPhoneOpen} 
          patient={{
            patient_id: patient.id,
            patient_name: patient.patient_name,
            phone: patient.phone,
            remaining_days: status?.remaining_days,
            current_cycle_status: "Waiting",
          }}
          pharmacy={session?.unlocked ? { 
            id: session.pharmacy.id, 
            name: session.pharmacy.name, 
            address: (session.pharmacy as any).address 
          } : undefined}
        />
      )}

      {/* Suspend Follow-up Dialog */}
      <Dialog open={suspendOpen} onOpenChange={setSuspendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعليق متابعة المستفيد</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="suspend-reason">سبب تعليق المتابعة (اختياري)</Label>
              <Input
                id="suspend-reason"
                placeholder="مثال: يصرف حالياً من صيدلية أخرى"
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              سيتم استبعاد المستفيد من قوائم المتابعة اليومية والإحصائيات، مع الاحتفاظ بكافة بياناته وسجله التاريخي.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setSuspendOpen(false)}>إلغاء</Button>
            <Button 
              variant="outline" 
              onClick={() => handleSuspension(true)} 
              disabled={suspendLoading}
              className="text-warning border-warning hover:bg-warning/10"
            >
              {suspendLoading ? "جاري التعليق..." : "تعليق المتابعة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>حذف المستفيد</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-3 text-destructive">
              <AlertTriangle className="h-6 w-6" />
              <p className="font-semibold text-sm">سيتم حذف المستفيد وبياناته المرتبطة. هل أنت متأكد؟</p>
            </div>
            <p className="text-xs text-muted-foreground">
              هذا الإجراء سيقوم بأرشفة بيانات المستفيد، ولن يظهر في القوائم النشطة.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setArchiveConfirmOpen(false)}>إلغاء</Button>
            <Button variant="destructive" onClick={handleArchive} disabled={archiveLoading}>
              {archiveLoading ? "جاري الحذف..." : "نعم، متأكد"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedTx && (
        <EditDispenseDialog
          open={editDispenseOpen}
          onOpenChange={setEditDispenseOpen}
          transaction={selectedTx}
          patientId={id}
        />
      )}
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
  onAction,
  actionLabel,
  onAdd,
  emptyLabel,
  addLabel,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
  onCopy?: () => void;
  onAction?: () => void;
  actionLabel?: string;
  onAdd: () => void;
  emptyLabel: string;
  addLabel: string;
}) {
  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border p-2">
        <span className="text-muted-foreground">{icon}</span>
        <button
          onClick={onAction}
          disabled={!onAction}
          className="flex-1 min-w-0 text-right disabled:cursor-default"
        >
          <div className="text-[11px] text-muted-foreground">{label}</div>
          <div className={`text-sm font-medium truncate ${onAction ? "text-cyan-700 dark:text-cyan-400" : ""}`} dir="ltr">
            {value}
          </div>
        </button>
        {onCopy && (
          <Button size="icon" variant="ghost" onClick={onCopy} aria-label={`نسخ ${label}`}>
            <Copy className="h-4 w-4" />
          </Button>
        )}
        {actionLabel && onAction && (
          <Button size="icon" variant="ghost" onClick={onAction} aria-label={actionLabel}>
            <Phone className="h-4 w-4" />
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

