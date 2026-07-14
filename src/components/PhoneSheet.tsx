import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Phone, MessageSquare, Copy, X } from "lucide-react";
import { toast } from "sonner";

const SMS_TEMPLATE = `السلام عليكم،
نحيطكم علمًا بأن موعد صرف علاج التأمين الخاص بكم أصبح مستحقًا.
يرجى مراجعة الصيدلية في أقرب وقت.
شكراً لكم.`;

function normalizeIntl(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("00")) return "+" + digits.slice(2);
  if (digits.startsWith("09") && digits.length === 10) return "+963" + digits.slice(1);
  return null;
}

export function PhoneSheet({
  open,
  onOpenChange,
  phone,
  patientName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  phone: string | null | undefined;
  patientName?: string;
}) {
  if (!phone) return null;
  const intl = normalizeIntl(phone);
  const smsBody = encodeURIComponent(SMS_TEMPLATE);

  async function copy() {
    try {
      await navigator.clipboard.writeText(phone!);
      toast.success("تم نسخ رقم الهاتف");
      onOpenChange(false);
    } catch {
      toast.error("تعذر النسخ");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle className="text-right">
            {patientName ?? "الاتصال"}
            <div className="text-sm font-mono text-muted-foreground mt-1" dir="ltr">{phone}</div>
          </SheetTitle>
        </SheetHeader>
        <div className="grid gap-2 mt-4">
          <a href={`tel:${phone}`} onClick={() => onOpenChange(false)}>
            <Button variant="outline" className="w-full h-12 justify-start">
              <Phone className="h-5 w-5 ml-3 text-primary" /> اتصال
            </Button>
          </a>
          <a href={`sms:${phone}?body=${smsBody}`} onClick={() => onOpenChange(false)}>
            <Button variant="outline" className="w-full h-12 justify-start">
              <MessageSquare className="h-5 w-5 ml-3 text-info" /> إرسال SMS
            </Button>
          </a>
          {intl && (
            <a
              href={`https://wa.me/${intl.replace("+", "")}?text=${smsBody}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onOpenChange(false)}
            >
              <Button variant="outline" className="w-full h-12 justify-start">
                <MessageSquare className="h-5 w-5 ml-3 text-success" /> واتساب
              </Button>
            </a>
          )}
          <Button variant="outline" className="w-full h-12 justify-start" onClick={copy}>
            <Copy className="h-5 w-5 ml-3" /> نسخ الرقم
          </Button>
          <Button variant="ghost" className="w-full h-12 justify-start" onClick={() => onOpenChange(false)}>
            <X className="h-5 w-5 ml-3" /> إلغاء
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}