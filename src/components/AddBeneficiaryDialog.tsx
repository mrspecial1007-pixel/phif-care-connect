import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { upsertPatient, recordDispensing } from "@/lib/dispensing.functions";
import { usePharmacies, usePatientStatuses } from "@/lib/queries";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { todayISOLocal } from "@/lib/date";

export function AddBeneficiaryDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (v: boolean) => void }) {
  const [step, setStep] = useState<"form" | "review">("form");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const doUpsert = useServerFn(upsertPatient);
  const doRecord = useServerFn(recordDispensing);
  const { data: pharmacies } = usePharmacies();
  const { data: existingPatients } = usePatientStatuses();

  const [formData, setFormData] = useState({
    name: "",
    card: "",
    nationalId: "",
    phone: "",
    address: "",
    hasHistory: "no",
    lastDispenseDate: todayISOLocal(),
    pharmacyId: "",
    isFull: "yes",
  });

  const [duplicateId, setDuplicateId] = useState<string | null>(null);

  const handleSave = async () => {
    setLoading(true);
    try {
      // 1. Check for duplicates (local check first for speed)
      const dup = existingPatients?.find(p => p.insurance_card_number === formData.card);
      if (dup) {
        setDuplicateId(dup.patient_id);
        setLoading(false);
        return;
      }

      // 2. Create patient
      const res = await doUpsert({
        data: {
          patient_name: formData.name,
          insurance_card_number: formData.card,
          national_id: formData.nationalId || null,
          phone: formData.phone || null,
          address: formData.address || null,
        }
      });

      if (!res.ok) throw new Error(res.error || "Failed to create");
      
      const patientId = res.id!;

      // 3. If history, record historical dispensing
      if (formData.hasHistory === "yes") {
        await doRecord({
          data: {
            patient_id: patientId,
            transaction_type: formData.isFull === "yes" ? "Completed" : "Partial",
            dispensing_date: formData.lastDispenseDate,
            pharmacy_id: formData.pharmacyId || undefined,
            historical_mode: "append",
            notes: "تمت الإضافة عند إنشاء المستفيد يدويًا",
          }
        });
      }

      toast.success("تم حفظ المستفيد بنجاح");
      await qc.invalidateQueries({ queryKey: ["patient_status"] });
      navigate({ to: "/patients/$id", params: { id: patientId } });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "خطأ في الحفظ");
    } finally {
      setLoading(false);
    }
  };

  if (duplicateId) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <div className="py-6 text-center space-y-4">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
            <h3 className="text-lg font-bold">يوجد مستفيد مسجل مسبقًا بنفس رقم البطاقة.</h3>
            <Button onClick={() => navigate({ to: "/patients/$id", params: { id: duplicateId } })}>
              فتح بيانات المستفيد
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if(!v) setStep("form"); onOpenChange(v); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>إضافة مستفيد جديد</DialogTitle>
        </DialogHeader>

        {step === "form" ? (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>الاسم (إجباري)</Label>
              <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="الاسم الكامل" />
            </div>
            <div className="space-y-2">
              <Label>رقم البطاقة (إجباري - نص)</Label>
              <Input value={formData.card} onChange={e => setFormData({...formData, card: e.target.value})} placeholder="رقم البطاقة التأمينية" dir="ltr" />
            </div>
            <div className="space-y-2">
              <Label>الرقم الوطني (اختياري)</Label>
              <Input value={formData.nationalId} onChange={e => setFormData({...formData, nationalId: e.target.value})} placeholder="الرقم الوطني" dir="ltr" />
            </div>
            <div className="space-y-2">
              <Label>رقم الهاتف (اختياري)</Label>
              <Input value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} placeholder="09xxxxxxxx" dir="ltr" />
            </div>
            <div className="space-y-2">
              <Label>العنوان (اختياري)</Label>
              <Input value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} placeholder="السكن الحالي" />
            </div>

            <div className="pt-4 border-t">
              <h3 className="font-semibold mb-2 text-sm text-primary">بيانات الصرف السابقة</h3>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>هل سبق الصرف لهذا المستفيد؟</Label>
                  <RadioGroup value={formData.hasHistory} onValueChange={v => setFormData({...formData, hasHistory: v})} className="flex gap-4">
                    <div className="flex items-center space-x-2 space-x-reverse">
                      <RadioGroupItem value="yes" id="h-yes" />
                      <Label htmlFor="h-yes">نعم</Label>
                    </div>
                    <div className="flex items-center space-x-2 space-x-reverse">
                      <RadioGroupItem value="no" id="h-no" />
                      <Label htmlFor="h-no">لا</Label>
                    </div>
                  </RadioGroup>
                </div>

                {formData.hasHistory === "yes" && (
                  <div className="space-y-3 bg-muted/50 p-3 rounded-lg border animate-in fade-in slide-in-from-top-2">
                    <div className="space-y-2">
                      <Label>تاريخ آخر صرف</Label>
                      <Input type="date" value={formData.lastDispenseDate} onChange={e => setFormData({...formData, lastDispenseDate: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                      <Label>الصيدلية</Label>
                      <Select value={formData.pharmacyId} onValueChange={v => setFormData({...formData, pharmacyId: v})}>
                        <SelectTrigger>
                          <SelectValue placeholder="اختر الصيدلية" />
                        </SelectTrigger>
                        <SelectContent>
                          {pharmacies?.map(p => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>هل كان الصرف كاملًا؟</Label>
                      <RadioGroup value={formData.isFull} onValueChange={v => setFormData({...formData, isFull: v})} className="flex gap-4">
                        <div className="flex items-center space-x-2 space-x-reverse">
                          <RadioGroupItem value="yes" id="f-yes" />
                          <Label htmlFor="f-yes">نعم</Label>
                        </div>
                        <div className="flex items-center space-x-2 space-x-reverse">
                          <RadioGroupItem value="no" id="f-no" />
                          <Label htmlFor="f-no">لا، صرف جزئي</Label>
                        </div>
                      </RadioGroup>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-4">
             <div className="bg-muted p-4 rounded-lg space-y-3 text-sm">
                <ReviewItem label="الاسم" value={formData.name} />
                <ReviewItem label="رقم البطاقة" value={formData.card} />
                <ReviewItem label="الرقم الوطني" value={formData.nationalId || "—"} />
                <ReviewItem label="الهاتف" value={formData.phone || "—"} />
                <ReviewItem label="العنوان" value={formData.address || "—"} />
                {formData.hasHistory === "yes" && (
                  <>
                    <div className="h-px bg-border my-2" />
                    <ReviewItem label="آخر صرف" value={formData.lastDispenseDate} />
                    <ReviewItem label="الصيدلية" value={pharmacies?.find(p => p.id === formData.pharmacyId)?.name || "—"} />
                    <ReviewItem label="حالة الصرف" value={formData.isFull === "yes" ? "كامل" : "جزئي"} />
                    {formData.isFull === "yes" && (
                       <ReviewItem 
                        label="الاستحقاق القادم (تقديري)" 
                        value={new Date(new Date(formData.lastDispenseDate).getTime() + 28*24*60*60*1000).toISOString().slice(0, 10)} 
                        className="text-primary font-bold"
                       />
                    )}
                  </>
                )}
             </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "form" ? (
            <Button className="flex-1" onClick={() => {
              if(!formData.name || !formData.card) return toast.error("يرجى إكمال البيانات الإجبارية");
              setStep("review");
            }}>
              مراجعة البيانات
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep("form")} disabled={loading}>تعديل</Button>
              <Button className="flex-1" onClick={handleSave} disabled={loading}>
                {loading ? "جاري الحفظ..." : "حفظ المستفيد"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewItem({ label, value, className = "" }: { label: string, value: string, className?: string }) {
  return (
    <div className={`flex justify-between items-center ${className}`}>
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
