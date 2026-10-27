import { useEffect, useRef, useState } from "react";
import { CalendarCheck2, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { setPhifOrderReceiptDate } from "@/lib/phif-orders.functions";
import { orderCreatedDate } from "@/lib/phif-orders.helpers";
import type { OrderReceiptRecord } from "@/lib/phif-order-receipts.helpers";

export function OrderReceiptDateEditor({ record, medicine, enabled, onSaved }: {
  record?: OrderReceiptRecord; medicine: string; enabled: boolean; onSaved: (row: OrderReceiptRecord) => void;
}) {
  const [open, setOpen] = useState(false), [date, setDate] = useState("");
  const [version, setVersion] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const lock = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function toggle(value: boolean) {
    if (lock.current) return;
    if (value) { setDate(record?.confirmed_received_on || ""); setVersion(record?.version || 0); setError(null); }
    setOpen(value);
  }
  async function save(receivedOn: string | null) {
    if (lock.current || !record || !enabled) return;
    if (receivedOn === record.confirmed_received_on) { setOpen(false); return; }
    lock.current = true; setBusy(true); setError(null);
    try {
      const saved = await setPhifOrderReceiptDate({ data: { orderId: record.order_id, lineId: record.line_id,
        receivedOn, expectedVersion: version } });
      if (!mounted.current) return;
      onSaved(saved); setOpen(false); toast.success(receivedOn ? "حُفظ تاريخ الاستلام المؤكد" : "أُلغي التاريخ المؤكد مع الاحتفاظ بسجل الرصد والتعديلات");
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : "تعذر حفظ التاريخ؛ لم تتغير القيمة المدخلة"); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={toggle}>
    <Button variant="outline" size="sm" disabled={!enabled || !record} onClick={() => toggle(true)}
      title={!record ? "حدّث الطلبات مرة واحدة لتهيئة سجل هذا البند" : "تاريخ يدوي مستقل لا يغيّر حالة PHIF"}>
      <CalendarCheck2 className="size-4" />{record?.confirmed_received_on ? "تعديل تاريخ الاستلام" : "تحديد تاريخ الاستلام"}
    </Button>
    <DialogContent dir="rtl" className="max-w-sm">
      <DialogHeader><DialogTitle>تاريخ الاستلام الفعلي</DialogTitle></DialogHeader>
      <p dir="auto" className="break-words text-sm font-semibold">{medicine}</p>
      <p className="text-xs text-muted-foreground">{record?.order_number} · إنشاء: {orderCreatedDate(record?.order_created_at || null) || "غير موثق"}</p>
      {record?.first_received_observed_at && <div className="space-y-2 border-y py-2 text-xs text-amber-900">
        <p>أول رصد للاستلام: {new Date(record.first_received_observed_at).toLocaleString("ar-LY", { timeZone: "Africa/Tripoli" })} — ليس تاريخ الاستلام الفعلي.</p>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setDate(orderCreatedDate(record.first_received_observed_at)!)}>استخدام هذا اليوم بعد التحقق</Button>
      </div>}
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (date) void save(date); }}>
        <label className="block space-y-1 text-sm"><span>تاريخ الاستلام المؤكد</span>
          <Input type="date" required value={date} disabled={busy} min={orderCreatedDate(record?.order_created_at || null) || undefined}
            max={orderCreatedDate(new Date().toISOString())!} onChange={event => setDate(event.target.value)} />
        </label>
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || !date || !record?.order_created_at}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}حفظ التاريخ المؤكد</Button>
          {record?.confirmed_received_on && <Button type="button" variant="outline" disabled={busy} onClick={() => void save(null)}>إلغاء التاريخ المؤكد</Button>}
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
