import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Phone, Share2, AlertTriangle, CheckCircle2, Clock, Star } from "lucide-react";
import { useState, type MouseEvent } from "react";
import type { PatientStatusRow } from "@/lib/queries";
import { PhoneSheet } from "./PhoneSheet";
import { DispenseDialog, RemainingConfirmDialog } from "./DispenseFlow";
import { useSession } from "@/lib/queries";
import { useServerFn } from "@tanstack/react-start";
import { upsertPatient } from "@/lib/dispensing.functions";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export function statusMeta(row: PatientStatusRow) {
  if (row.review_status === "needs_review")
    return { key: "review", label: "يحتاج مراجعة", color: "bg-warning text-warning-foreground" };
  
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
  const qc = useQueryClient();
  const updatePatient = useServerFn(upsertPatient);
  const [favBusy, setFavBusy] = useState(false);

  const stop = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const toggleFavorite = async (e: MouseEvent) => {
    stop(e);
    if (favBusy) return;
    setFavBusy(true);
    try {
      const res = await updatePatient({
        data: {
          id: row.patient_id,
          patient_name: row.patient_name,
          is_favorite: !row.is_favorite,
        },
      });
      if (res.ok) {
        toast.success(row.is_favorite ? "تمت إزالة المستفيد من المفضلة" : "تمت إضافة المستفيد إلى المفضلة");
        qc.invalidateQueries({ queryKey: ["patient_status"] });
        qc.invalidateQueries({ queryKey: ["patient", row.patient_id] });
      }
    } catch (err) {
      toast.error("حدث خطأ ما");
    } finally {
      setFavBusy(false);
    }
  };

  const daysNode = row.tracks && row.tracks.length > 0 ? (
    <div className="mt-2 space-y-1">
      {row.tracks.slice(0, 2).map((track, i) => {
        const days = track.remaining_days;
        let colorClass = "text-emerald-700 dark:text-emerald-400"; // Default green/turquoise
        let fontClass = "font-extrabold text-sm";
        
        if (days < 0) {
          colorClass = "text-red-700 dark:text-red-500";
          fontClass = "font-extrabold text-base";
        } else if (days === 0) {
          colorClass = "text-green-800 dark:text-green-600";
          fontClass = "font-extrabold text-base";
        }

        return (
          <div key={i} className={`flex items-center gap-1.5 ${colorClass} ${fontClass}`}>
            <Clock className="h-4 w-4 shrink-0" />
            <span>
              {days === 0 ? "مستحق اليوم" : 
               days < 0 ? `متأخر ${Math.abs(days)} ${Math.abs(days) === 1 ? "يوم" : "أيام"}` :
               `متبقي ${days} ${days === 1 ? "يوم" : "يومًا"}`}
            </span>
          </div>
        );
      })}
      {row.active_tracks_count > 2 && (
        <Link 
          to="/patients/$id" 
          params={{ id: row.patient_id }}
          onClick={(e) => e.stopPropagation()}
          className="block text-[11px] text-muted-foreground font-medium pr-6 hover:underline"
        >
          +{row.active_tracks_count - 2} مواعيد أخرى
        </Link>
      )}
    </div>
  ) : null;

  return (
    <>
      <Card className={`p-3 border-r-4 hover:shadow-md transition ${borderTone(meta.key)}`}>
        <Link to="/patients/$id" params={{ id: row.patient_id }} className="block">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="font-semibold text-base truncate">{row.patient_name}</div>
                <button
                  onClick={toggleFavorite}
                  className="p-1 -m-1 text-amber-500 hover:scale-110 transition-transform"
                >
                  {row.is_favorite ? (
                    <Star className="h-4 w-4 fill-current" />
                  ) : (
                    <Star className="h-4 w-4" />
                  )}
                </button>
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
                  aria-label="اتصال بالمستفيد"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {row.phone}
                </button>
              )}
              {daysNode}
            </div>
            <div className="flex flex-col gap-1 items-end">
              <Badge className={`${meta.color} border-0`}>{meta.label}</Badge>
              {isPartial && (
                <Badge variant="outline" className="text-[10px] border-info text-info">
                  صرف جزئي
                </Badge>
              )}
            </div>
          </div>
        </Link>

        <div className="mt-3">
          {isPartial ? (
            <Button
              className="w-full h-11 bg-info text-info-foreground hover:bg-info/90"
              onClick={(e: MouseEvent) => { stop(e); setRemOpen(true); }}
            >
              <Clock className="h-4 w-4 ml-2" /> صرف متبقي
            </Button>
          ) : (
            <Button
              className="w-full h-11"
              onClick={(e: MouseEvent) => { stop(e); setDispOpen(true); }}
            >
              <CheckCircle2 className="h-4 w-4 ml-2" /> تم الصرف
            </Button>
          )}
        </div>
      </Card>

      <PhoneSheet 
        open={phoneOpen} 
        onOpenChange={setPhoneOpen} 
        patient={{ ...row, patient_id: row.patient_id, patient_name: row.patient_name, phone: row.phone! }} 
        pharmacy={session?.unlocked ? { 
          id: session.pharmacy.id, 
          name: session.pharmacy.name, 
          address: (session.pharmacy as any).address 
        } : undefined}
      />
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