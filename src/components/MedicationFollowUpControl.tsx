import { useId, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { setPatientMedicationFollowUp, type PhifMedicationProfileItem } from "@/lib/phif-invoices.functions";
import { hasPermission } from "@/lib/user-permissions";
import { useSession } from "@/lib/queries";

export function MedicationFollowUpControl({ patientId, item, available }: {
  patientId: string; item: PhifMedicationProfileItem; available: boolean;
}) {
  const { data: session } = useSession();
  const changeFollowUp = useServerFn(setPatientMedicationFollowUp);
  const qc = useQueryClient();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stopped = item.follow_up_status === "stopped";
  const allowed = session?.pharmacy?.name === "صيدلية الترياق الشافي" &&
    ((!session.user || session.user.role === "legacy") || hasPermission(session.user.role, session.user.permissions, "dispensing_write"));
  if (!allowed) return null;

  async function save() {
    if (busy || !available || (!stopped && !reason.trim())) return;
    setBusy(true);
    setError("");
    try {
      await changeFollowUp({ data: { patientId, identityKey: item.identity_key, isStopped: !stopped, reason: stopped ? undefined : reason.trim() } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["patient_phif_medication_profile", patientId] }),
        qc.invalidateQueries({ queryKey: ["patient_due_tracks", patientId] }),
        qc.invalidateQueries({ queryKey: ["patient_status"] }),
      ]);
      setOpen(false);
      setReason("");
      toast.success(stopped ? "تمت إعادة تفعيل متابعة الصنف" : "تم إيقاف متابعة الصنف");
    } catch (err) {
      setError(err instanceof Error && /Lovable Cloud|تعذر حفظ|أدخل سبب|غير موجود|غير متاح/.test(err.message)
        ? err.message : "تعذر حفظ حالة المتابعة. تحقق من الصلاحية والاتصال وحاول مجددًا.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Button variant="outline" size="sm" disabled={!available || busy} onClick={() => { setError(""); setOpen(true); }}>
      {stopped ? <Play className="ml-1 h-3.5 w-3.5" /> : <Pause className="ml-1 h-3.5 w-3.5" />}
      {stopped ? "إعادة تفعيل المتابعة" : "إيقاف متابعة الصنف"}
    </Button>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
      <DialogContent dir="rtl" className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{stopped ? "إعادة تفعيل متابعة الصنف" : "إيقاف متابعة الصنف"}</DialogTitle></DialogHeader>
        <p className="break-words text-sm" dir="ltr">{[item.active_ingredient, item.strength, item.dosage_form].filter(Boolean).join(" ")}</p>
        <p className="text-sm text-muted-foreground">
          {stopped ? "سيُعاد احتساب الاستحقاق من آخر صرف موثق في PHIF، وليس من تاريخ إعادة التفعيل." : "سيُستبعد هذا الصنف من الاستحقاقات، مع الاحتفاظ بجميع حركاته وفواتيره التاريخية."}
        </p>
        {!stopped && <div className="space-y-2">
          <Label htmlFor={reasonId}>سبب الإيقاف</Label>
          <Textarea id={reasonId} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} disabled={busy} />
        </div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2">
          <Button onClick={save} disabled={busy || (!stopped && !reason.trim())}>{busy ? "جار الحفظ..." : "تأكيد"}</Button>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>إلغاء</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
