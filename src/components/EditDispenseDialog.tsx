import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerFn } from "@tanstack/react-start";
import { updateDispensing, cancelDispensing } from "@/lib/dispensing.functions";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePharmacies } from "@/lib/queries";
import { AlertTriangle, Trash2 } from "lucide-react";
import { todayISOLocal } from "@/lib/date";

export function EditDispenseDialog({
  open,
  onOpenChange,
  transaction,
  patientId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  transaction: any;
  patientId: string;
}) {
  const [date, setDate] = useState("");
  const [type, setType] = useState<any>("");
  const [pharmacyId, setPharmacyId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  
  const { data: pharmacies } = usePharmacies();
  const updateTx = useServerFn(updateDispensing);
  const cancelTx = useServerFn(cancelDispensing);
  const qc = useQueryClient();

  useEffect(() => {
    if (open && transaction) {
      setDate(transaction.dispensing_date.slice(0, 10));
      setType(transaction.transaction_type);
      setPharmacyId(transaction.pharmacy_id);
      setNotes(transaction.notes || "");
    }
  }, [open, transaction]);

  async function handleUpdate() {
    setBusy(true);
    try {
      const res = await updateTx({
        data: {
          id: transaction.id,
          dispensing_date: date,
          transaction_type: type,
          pharmacy_id: pharmacyId,
          notes,
        },
      });
      if (res.ok) {
        toast.success("تم تحديث عملية الصرف");
        qc.invalidateQueries({ queryKey: ["patient_history", patientId] });
        qc.invalidateQueries({ queryKey: ["patient_due_tracks", patientId] });
        qc.invalidateQueries({ queryKey: ["patient", patientId] });
        onOpenChange(false);
      }
    } catch (err: any) {
      toast.error(err.message || "حدث خطأ أثناء التحديث");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!cancelReason.trim()) {
      toast.error("يرجى ذكر سبب الإلغاء");
      return;
    }
    setBusy(true);
    try {
      const res = await cancelTx({
        data: {
          id: transaction.id,
          reason: cancelReason,
        },
      });
      if (res.ok) {
        toast.success("تم إلغاء عملية الصرف");
        qc.invalidateQueries({ queryKey: ["patient_history", patientId] });
        qc.invalidateQueries({ queryKey: ["patient_due_tracks", patientId] });
        qc.invalidateQueries({ queryKey: ["patient", patientId] });
        setCancelOpen(false);
        onOpenChange(false);
      }
    } catch (err: any) {
      toast.error(err.message || "حدث خطأ أثناء الإلغاء");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={open && !cancelOpen} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعديل عملية الصرف</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label>تاريخ الصرف</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={todayISOLocal()} />
            </div>
            <div className="grid gap-2">
              <Label>نوع الصرف</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Completed">صرف كامل</SelectItem>
                  <SelectItem value="Partial">صرف جزئي</SelectItem>
                  <SelectItem value="Remaining">صرف متبقي</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>الصيدلية</Label>
              <Select value={pharmacyId} onValueChange={setPharmacyId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pharmacies?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>ملاحظات</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800 flex gap-2 text-sm text-amber-800 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>تعديل تاريخ أو نوع الصرف سيؤدي إلى إعادة حساب مواعيد الاستحقاق لهذا المستفيد تلقائياً.</p>
            </div>
          </div>
          <DialogFooter className="flex-row gap-2">
            <Button variant="destructive" onClick={() => setCancelOpen(true)} className="ml-auto">
              <Trash2 className="h-4 w-4 ml-2" /> إلغاء العملية
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>تراجع</Button>
            <Button onClick={handleUpdate} disabled={busy}>حفظ التعديلات</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إلغاء عملية الصرف</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">هل أنت متأكد من إلغاء هذه العملية؟ سيتم استبعادها من حسابات الاستحقاق ولكنها ستبقى ظاهرة في السجل كعملية ملغاة.</p>
            <div className="grid gap-2">
              <Label>سبب إلغاء عملية الصرف</Label>
              <Textarea 
                placeholder="يرجى كتابة سبب الإلغاء..." 
                value={cancelReason} 
                onChange={(e) => setCancelReason(e.target.value)} 
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>تراجع</Button>
            <Button variant="destructive" onClick={handleCancel} disabled={busy}>تأكيد الإلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
