import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Phone, MessageSquare, Copy, X, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { logCommunication } from "@/lib/activity.functions";
import type { PatientStatusRow } from "@/lib/queries";

function normalizeLibyaIntl(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  
  // Already international with +
  if (raw.startsWith("+")) return raw.replace(/[^\d+]/g, "");
  
  // Already international without +
  if (digits.startsWith("218") && digits.length >= 12) return "+" + digits;
  
  // Local 09x
  if (digits.startsWith("09") && digits.length === 10) {
    return "+218" + digits.slice(1);
  }
  
  // Local 9x
  if (digits.startsWith("9") && digits.length === 9) {
    return "+218" + digits;
  }

  return null;
}

function generateMessage(row: Partial<PatientStatusRow>, pharmacy?: { name: string; address?: string }): string {
  const name = row.patient_name || "";
  const greeting = `السلام عليكم ${name}،\n\nنتمنى أن تكونوا بصحة وعافية.`;
  
  let body = "";
  const days = row.remaining_days;

  const getArabicDays = (n: number) => {
    const absN = Math.abs(n);
    if (absN === 1) return "يوم واحد";
    if (absN === 2) return "يومين";
    if (absN >= 3 && absN <= 10) return `${absN} أيام`;
    return `${absN} يومًا`;
  };

  if (days !== undefined && days !== null) {
    if (days === 0) {
      body = "نود إعلامكم بأن موعد صرف علاج التأمين الخاص بكم أصبح مستحقًا اليوم.\n\nنرجو التكرم بالحضور لاستلام العلاج، ويسعدنا تواصلكم معنا في حال وجود أي استفسار.";
    } else if (days < 0) {
      body = `نود إعلامكم بأن موعد صرف علاج التأمين الخاص بكم مستحق منذ ${getArabicDays(days)}.\n\nنرجو التكرم بالحضور لاستلام العلاج، ويسعدنا تواصلكم معنا في حال وجود أي استفسار.`;
    } else {
      body = `نود إعلامكم بأن موعد صرف علاج التأمين الخاص بكم سيكون بعد ${getArabicDays(days)}.\n\nنرجو التكرم بالحضور في موعد الاستحقاق لاستلام العلاج، ويسعدنا تواصلكم معنا في حال وجود أي استفسار.`;
    }
  } else {
    body = "نود إعلامكم بضرورة مراجعة الصيدلية بشأن علاج التأمين الخاص بكم.\n\nيسعدنا تواصلكم معنا في حال وجود أي استفسار.";
  }

  const signature = pharmacy?.name 
    ? `\n\n${pharmacy.name}${pharmacy.address ? `\n📍 ${pharmacy.address}` : ""}`
    : "";

  return `${greeting}\n\n${body}${signature}`;
}

export function PhoneSheet({
  open,
  onOpenChange,
  patient,
  pharmacy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patient: Partial<PatientStatusRow> & { patient_id: string; patient_name: string; phone: string };
  pharmacy?: { id: string; name: string; address?: string };
}) {
  const [view, setView] = useState<"options" | "preview">("options");
  const [channel, setChannel] = useState<"WhatsApp" | "SMS" | "Call">("WhatsApp");
  const [message, setMessage] = useState("");
  const doLog = useServerFn(logCommunication);

  useEffect(() => {
    if (open) {
      setView("options");
      setMessage(generateMessage(patient, pharmacy));
    }
  }, [open, patient, pharmacy]);

  if (!patient.phone) return null;

  const intl = normalizeLibyaIntl(patient.phone);
  const phone = patient.phone;

  async function handleLog(chan: "WhatsApp" | "SMS" | "Call") {
    if (!pharmacy) return;
    try {
      const actionMap = {
        "Call": "تم بدء اتصال بالعميل",
        "WhatsApp": "تم فتح WhatsApp للتواصل مع العميل",
        "SMS": "تم فتح SMS للتواصل مع العميل"
      };
      
      await doLog({
        data: {
          patientId: patient.patient_id,
          pharmacyId: pharmacy.id,
          actionType: actionMap[chan],
          phoneNumber: phone,
          channel: chan,
          patientStatus: "Waiting",
          remainingDays: patient.remaining_days ?? undefined,
        }
      });
    } catch (e) {
      console.error("Failed to log activity", e);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(phone);
      toast.success("تم نسخ رقم الهاتف");
      onOpenChange(false);
    } catch {
      toast.error("تعذر النسخ");
    }
  }

  const handleCall = () => {
    handleLog("Call");
    window.location.href = `tel:${phone}`;
    onOpenChange(false);
  };

  const openWhatsApp = () => {
    if (!intl) {
      toast.error("رقم الهاتف غير صالح للواتساب");
      return;
    }
    handleLog("WhatsApp");
    const waUrl = `https://wa.me/${intl.replace("+", "")}?text=${encodeURIComponent(message)}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");
    onOpenChange(false);
  };

  const openSMS = () => {
    handleLog("SMS");
    const smsUrl = `sms:${phone}${window.navigator.userAgent.match(/iPhone/i) ? "&" : "?"}body=${encodeURIComponent(message)}`;
    window.location.href = smsUrl;
    onOpenChange(false);
  };

  if (view === "preview") {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto">
          <SheetHeader className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Button variant="ghost" size="icon" onClick={() => setView("options")}>
                <ArrowRight className="h-5 w-5" />
              </Button>
              <SheetTitle>معاينة الرسالة</SheetTitle>
            </div>
            <div className="text-right space-y-1">
              <div className="font-semibold text-lg">{patient.patient_name}</div>
              <div className="text-sm text-muted-foreground" dir="ltr">{phone}</div>
              <div className="text-xs bg-muted p-2 rounded-md mt-2">
                <div className="font-medium text-primary">حالة الاستحقاق:</div>
                <div>{patient.current_cycle_status === "Partial" ? "صرف جزئي" : 
                      patient.remaining_days === 0 ? "مستحق اليوم" :
                      (patient.remaining_days || 0) < 0 ? `متأخر (${Math.abs(patient.remaining_days || 0)} يوم)` :
                      `بعد ${patient.remaining_days} يوم`}</div>
                {pharmacy && (
                  <div className="mt-1 opacity-70">
                    {pharmacy.name} {pharmacy.address && `- ${pharmacy.address}`}
                  </div>
                )}
              </div>
            </div>
          </SheetHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">نص الرسالة</label>
              <Textarea 
                value={message} 
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMessage(e.target.value)}
                className="min-h-[150px] text-right"
                dir="rtl"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {channel === "WhatsApp" ? (
                <Button onClick={openWhatsApp} className="bg-success hover:bg-success/90 text-white col-span-2 h-12">
                  <MessageSquare className="h-5 w-5 ml-2" /> فتح في WhatsApp
                </Button>
              ) : (
                <Button onClick={openSMS} className="bg-info hover:bg-info/90 text-info-foreground col-span-2 h-12">
                  <MessageSquare className="h-5 w-5 ml-2" /> فتح في SMS
                </Button>
              )}
              <Button variant="outline" onClick={() => setView("options")} className="col-span-2 h-12">
                إلغاء
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle className="text-right">
            التواصل مع العميل
            <div className="text-sm font-mono text-muted-foreground mt-1" dir="ltr">{phone}</div>
          </SheetTitle>
        </SheetHeader>
        <div className="grid gap-2 mt-4">
          <Button variant="outline" className="w-full h-12 justify-start" onClick={handleCall}>
            <Phone className="h-5 w-5 ml-3 text-primary" /> اتصال
          </Button>
          
          <Button variant="outline" className="w-full h-12 justify-start" onClick={() => { setChannel("WhatsApp"); setView("preview"); }}>
            <MessageSquare className="h-5 w-5 ml-3 text-success" /> WhatsApp
          </Button>

          <Button variant="outline" className="w-full h-12 justify-start" onClick={() => { setChannel("SMS"); setView("preview"); }}>
            <MessageSquare className="h-5 w-5 ml-3 text-info" /> SMS
          </Button>

          <Button variant="outline" className="w-full h-12 justify-start" onClick={copy}>
            <Copy className="h-5 w-5 ml-3" /> نسخ الرقم
          </Button>
          
          <Button variant="ghost" className="w-full h-12 justify-start" onClick={() => onOpenChange(false)}>
            <X className="h-5 w-5 ml-3 text-muted-foreground" /> إلغاء
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}