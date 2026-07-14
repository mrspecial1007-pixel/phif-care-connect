import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Phone, Share2, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { useState, type MouseEvent } from "react";
import type { PatientStatusRow } from "@/lib/queries";
import { PhoneSheet } from "./PhoneSheet";
import { DispenseDialog, RemainingConfirmDialog } from "./DispenseFlow";
import { useSession } from "@/lib/queries";

export function statusMeta(row: PatientStatusRow) {
  if (row.review_status === "needs_review")
    return { key: "review", label: "يحتاج مراجعة", color: "bg-warning text-warning-foreground" };
  if (row.current_cycle_status === "Partial")
    return { key: "partial", label: "صرف جزئي", color: "bg-info text-info-foreground" };
  if (row.remaining_days !== null) {
    if (row.remaining_days < 0)
      return { key: "overdue", label: "متأخر", color: "bg-destructive text-destructive-foreground" };
    if (row.remaining_days <= 3)
      return { key: "due", label: "قريب الاستحقاق", color: "bg-warning text-warning-foreground" };
  }
  if (row.current_cycle_status === "Waiting")
    return { key: "waiting", label: "بانتظار الصرف", color: "bg-success text-success-foreground" };
  return { key: "ok", label: "مكتمل", color: "bg-secondary text-secondary-foreground" };
}

function borderTone(key: string) {
  switch (key) {
    case "overdue": return "border-r-destructive";
    case "due": return "border-r-warning";
    case "partial": return "border-r-info";
    case "review": return "border-r-warning";
    case "waiting": return "border-r-success";
    default: return "border-r-border";
  }
}

export function PatientCard({ row }: { row: PatientStatusRow }) {
  const meta = statusMeta(row);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [dispOpen, setDispOpen] = useState(false);
  const [remOpen, setRemOpen] = useState(false);
  const { data: session } = useSession();
  const isPartial = row.current_cycle_status === "Partial";

  const stop = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const daysNode = row.remaining_days !== null ? (
    row.remaining_days < 0 ? (
      <div className="flex items-center gap-1.5 text-red-700 dark:text-red-400 font-extrabold text-base mt-2">
        <AlertTriangle className="h-4 w-4" />
        متأخر {Math.abs(row.remaining_days)} {Math.abs(row.remaining_days) === 1 ? "يوم" : "أيام"}
      </div>
    ) : row.remaining_days <= 3 ? (
      <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-extrabold text-base mt-2">
        <Clock className="h-4 w-4" />
        متبقي {row.remaining_days} {row.remaining_days === 1 ? "يوم" : "أيام"}
      </div>
    ) : (
      <div className="flex items-center gap-1.5 text-foreground font-bold text-sm mt-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        متبقي {row.remaining_days} يوم
      </div>
    )
  ) : null;

  return (
    <>
      <Card className={`p-3 border-r-4 hover:shadow-md transition ${borderTone(meta.key)}`}>
        <Link to="/patients/$id" params={{ id: row.patient_id }} className="block">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="font-semibold text-base truncate">{row.patient_name}</div>
                {row.is_shared && (
                  <Badge variant="outline" className="text-[10px]">
                    <Share2 className="h-3 w-3 ml-1" /> مشترك
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {row.insurance_card_number && <span dir="ltr">بطاقة: {row.insurance_card_number}</span>}
                {row.last_pharmacy_name && <span>آخر صرف: {row.last_pharmacy_name}</span>}
              </div>
              {row.phone && (
                <button
                  onClick={(e) => { stop(e); setPhoneOpen(true); }}
                  className="inline-flex items-center gap-1.5 mt-1.5 text-cyan-700 dark:text-cyan-400 font-semibold text-sm hover:underline"
                  dir="ltr"
                  aria-label="اتصال بالمريض"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {row.phone}
                </button>
              )}
              {daysNode}
            </div>
            <Badge className={`${meta.color} border-0`}>{meta.label}</Badge>
          </div>
        </Link>

        <div className="mt-3">
          {isPartial ? (
            <Button
              className="w-full h-11 bg-info text-info-foreground hover:bg-info/90"
              onClick={(e) => { stop(e); setRemOpen(true); }}
            >
              <Clock className="h-4 w-4 ml-2" /> صرف متبقي
            </Button>
          ) : (
            <Button
              className="w-full h-11"
              onClick={(e) => { stop(e); setDispOpen(true); }}
            >
              <CheckCircle2 className="h-4 w-4 ml-2" /> تم الصرف
            </Button>
          )}
        </div>
      </Card>

      <PhoneSheet open={phoneOpen} onOpenChange={setPhoneOpen} phone={row.phone} patientName={row.patient_name} />
      <DispenseDialog
        open={dispOpen}
        onOpenChange={setDispOpen}
        patientId={row.patient_id}
        patientName={row.patient_name}
        cardNumber={row.insurance_card_number}
      />
      <RemainingConfirmDialog
        open={remOpen}
        onOpenChange={setRemOpen}
        patientId={row.patient_id}
        defaultPharmacyId={session?.unlocked ? session.pharmacy.id : undefined}
      />
    </>
  );
}