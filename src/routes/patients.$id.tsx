import { createFileRoute, Link } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import {
  usePatient,
  usePatientHistory,
  usePatientCycles,
  usePatientStatuses,
} from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { recordDispensing } from "@/lib/dispensing.functions";
import { toast } from "sonner";
import {
  ArrowRight,
  Calendar,
  Pill,
  Building2,
  Share2,
  AlertTriangle,
  Check,
} from "lucide-react";

export const Route = createFileRoute("/patients/$id")({
  component: () => (
    <Gate>
      <Detail />
    </Gate>
  ),
});

function Detail() {
  const { id } = Route.useParams();
  const { data: patient, isLoading } = usePatient(id);
  const { data: history } = usePatientHistory(id);
  const { data: cycles } = usePatientCycles(id);
  const { data: statuses } = usePatientStatuses();
  const status = statuses?.find((s) => s.patient_id === id);

  const [txType, setTxType] = useState<"Partial" | "Remaining" | "Completed">("Completed");
  const [items, setItems] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const dispense = useServerFn(recordDispensing);

  async function onDispense() {
    if (!id) return;
    setBusy(true);
    try {
      const res = await dispense({
        data: {
          patient_id: id,
          transaction_type: txType,
          items_dispensed: items ? Number(items) : null,
          notes: notes || null,
        },
      });
      if (!res.ok) {
        toast.error("تعذر تسجيل الصرف");
      } else {
        toast.success("تم تسجيل الصرف");
        setItems("");
        setNotes("");
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["patient_history", id] }),
          qc.invalidateQueries({ queryKey: ["patient_cycles", id] }),
          qc.invalidateQueries({ queryKey: ["patient_status"] }),
        ]);
      }
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <div className="text-center py-10">جاري التحميل…</div>;
  if (!patient) return <div className="text-center py-10">المريض غير موجود</div>;

  return (
    <div className="space-y-4">
      <Link to="/" className="text-sm text-muted-foreground inline-flex items-center gap-1">
        <ArrowRight className="h-4 w-4 rotate-180" /> عودة
      </Link>

      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
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
            <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-3">
              {patient.insurance_card_number && <span>بطاقة: {patient.insurance_card_number}</span>}
              {patient.phone && <span>هاتف: {patient.phone}</span>}
              {patient.national_id && <span>وطني: {patient.national_id}</span>}
            </div>
            {status?.next_due_date && (
              <div className="text-sm mt-2">
                <Calendar className="h-4 w-4 inline ml-1" />
                الصرف القادم: <span className="font-semibold">{status.next_due_date}</span>
                {status.remaining_days !== null && (
                  <span className="text-muted-foreground">
                    {" "}
                    ({status.remaining_days >= 0
                      ? `متبقي ${status.remaining_days} يوم`
                      : `متأخر ${Math.abs(status.remaining_days)} يوم`})
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <h2 className="font-semibold">تسجيل صرف جديد</h2>
        <div className="grid grid-cols-3 gap-2">
          {(["Partial", "Remaining", "Completed"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTxType(t)}
              className={`rounded-lg border p-3 text-sm font-medium transition ${
                txType === t
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:border-primary/40"
              }`}
            >
              {t === "Partial" ? "جزئي" : t === "Remaining" ? "إكمال الباقي" : "صرف كامل"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>عدد الأصناف (اختياري)</Label>
            <Input
              type="number"
              value={items}
              onChange={(e) => setItems(e.target.value)}
              inputMode="numeric"
              min={0}
            />
          </div>
        </div>
        <div>
          <Label>ملاحظات</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
        </div>
        <Button className="w-full h-11" onClick={onDispense} disabled={busy}>
          <Check className="h-4 w-4 ml-2" /> {busy ? "جاري التسجيل…" : "تسجيل الصرف"}
        </Button>
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold mb-3">سجل الصرف</h2>
        <div className="space-y-2">
          {(history ?? []).map((h: any) => (
            <div key={h.id} className="flex items-center gap-3 border-b pb-2 last:border-0">
              <div className="text-xs w-24 text-muted-foreground shrink-0">
                {new Date(h.dispensing_date).toLocaleDateString("en-GB")}
              </div>
              <Badge
                className={`border-0 ${
                  h.transaction_type === "Partial"
                    ? "bg-info text-info-foreground"
                    : "bg-success text-success-foreground"
                }`}
              >
                {h.transaction_type === "Partial"
                  ? "جزئي"
                  : h.transaction_type === "Remaining"
                  ? "الباقي"
                  : "كامل"}
              </Badge>
              <div className="flex-1 text-sm truncate">
                <Building2 className="h-3.5 w-3.5 inline ml-1 text-muted-foreground" />
                {h.pharmacies?.name ?? "—"}
              </div>
              {h.items_dispensed != null && (
                <div className="text-xs text-muted-foreground">{h.items_dispensed} صنف</div>
              )}
            </div>
          ))}
          {(history ?? []).length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-4">لا توجد سجلات</div>
          )}
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold mb-3">دورات الصرف</h2>
        <div className="grid gap-2">
          {(cycles ?? []).map((c) => (
            <div key={c.id} className="flex items-center gap-3 text-sm border rounded-lg p-2">
              <Badge
                className={`border-0 ${
                  c.status === "Completed"
                    ? "bg-success text-success-foreground"
                    : c.status === "Partial"
                    ? "bg-info text-info-foreground"
                    : "bg-secondary text-secondary-foreground"
                }`}
              >
                {c.status === "Completed" ? "مكتملة" : c.status === "Partial" ? "جزئية" : "بانتظار"}
              </Badge>
              <div className="text-xs text-muted-foreground">
                بدأت: {c.started_at}
                {c.completed_at ? ` • اكتملت: ${c.completed_at}` : ""}
                {c.next_due_date ? ` • المستحق: ${c.next_due_date}` : ""}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}