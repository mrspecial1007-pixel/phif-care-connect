import { createFileRoute } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { usePatientStatuses } from "@/lib/queries";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useState } from "react";
import { nameMatchesQuery } from "@/lib/name-normalize";
import { PatientCard } from "@/components/PatientCard";
import { Plus, Star } from "lucide-react";
import { AddBeneficiaryDialog } from "@/components/AddBeneficiaryDialog";

export const Route = createFileRoute("/patients/")({
  component: () => (
    <Gate>
      <List />
    </Gate>
  ),
});

type Filter =
  | "active"
  | "all"
  | "favorite"
  | "overdue"
  | "old_follow_up"
  | "partial"
  | "shared"
  | "has_phone"
  | "no_phone"
  | "review";

const CHIPS: { k: Filter; label: string }[] = [
  { k: "active", label: "نشط" },
  { k: "all", label: "الكل" },
  { k: "favorite", label: "المفضلة" },
  { k: "overdue", label: "متأخر" },
  { k: "old_follow_up", label: "متابعة قديمة" },
  { k: "partial", label: "صرف جزئي" },
  { k: "shared", label: "مشترك" },
  { k: "has_phone", label: "لديه هاتف" },
  { k: "no_phone", label: "بدون هاتف" },
  { k: "review", label: "يحتاج مراجعة" },
];

const PAGE_SIZE = 100;

function List() {
  const { data: rows, isLoading } = usePatientStatuses();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("active");
  const [visible, setVisible] = useState(PAGE_SIZE);

  // Any change to search or filter resets pagination
  useEffect(() => setVisible(PAGE_SIZE), [q, filter]);

  const total = rows?.length ?? 0;

  const items = useMemo(() => {
    if (!rows) return [];
    const qd = q.trim();
    const list = rows.filter((r) => {
      const matchSearch =
        !qd ||
        nameMatchesQuery(r.patient_name, q) ||
        (r.insurance_card_number ?? "").includes(qd) ||
        (r.national_id ?? "").includes(qd) ||
        (r.phone ?? "").includes(qd);
      if (!matchSearch) return false;

      // While searching, show every match regardless of the active chip filter.
      if (qd) return true;

      // "الكل" = no status/favorite/phone/pharmacy filtering at all
      switch (filter) {
        case "all":
          return true;
        case "active":
          return !r.is_follow_up_suspended && (r.remaining_days === null || r.remaining_days >= -2);
        case "favorite":
          return !!r.is_favorite;
        case "overdue":
          return r.remaining_days !== null && r.remaining_days < 0 && r.remaining_days >= -50;
        case "old_follow_up":
          return r.remaining_days !== null && r.remaining_days < -50;
        case "partial":
          return r.current_cycle_status === "Partial";
        case "shared":
          return !!r.is_shared;
        case "has_phone":
          return !!(r.phone && r.phone.trim());
        case "no_phone":
          return !(r.phone && r.phone.trim());
        case "review":
          return r.review_status === "needs_review";
        default:
          return true;
      }
    });

    return [...list].sort((a, b) => {
      const getPriority = (row: any) => {
        const days = row.remaining_days;
        if (days === -1) return 0;
        if (days === -2) return 1;
        if (days === 0) return 2;
        if (days > 0) return 3;
        if (days !== null && days < -2) return 4;
        return 5;
      };

      const pa = getPriority(a);
      const pb = getPriority(b);

      if (pa !== pb) return pa - pb;

      if (a.remaining_days !== null && b.remaining_days !== null) {
        if (pa === 0 || pa === 1) return b.remaining_days - a.remaining_days; // -1 before -2
        return a.remaining_days - b.remaining_days;
      }
      return a.patient_name.localeCompare(b.patient_name, "ar");
    });
  }, [rows, q, filter]);

  const [addOpen, setAddOpen] = useState(false);
  const shown = Math.min(visible, items.length);

  return (
    <div className="space-y-3 w-full min-w-0">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">المستفيدون</h1>
        <Button onClick={() => setAddOpen(true)} size="sm" className="gap-2">
          <Plus className="h-4 w-4" /> إضافة مستفيد
        </Button>
      </div>

      <div className="flex gap-2 mb-1 overflow-x-auto pb-1 no-scrollbar">
        {CHIPS.map((c) => (
          <Button
            key={c.k}
            variant={filter === c.k ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(c.k)}
            className="rounded-full px-4 gap-1.5 shrink-0"
          >
            {c.k === "favorite" && (
              <Star className={`h-3.5 w-3.5 ${filter === "favorite" ? "fill-current" : ""}`} />
            )}
            {c.label}
          </Button>
        ))}
      </div>

      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ابحث بالاسم أو رقم البطاقة أو رقم الهاتف..."
        className="h-12 text-base"
      />

      {!isLoading && (
        <div className="text-xs text-muted-foreground px-1">
          عرض {shown} من {items.length} مستفيد
          {items.length !== total && <span> (الإجمالي {total})</span>}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-10 text-muted-foreground">جاري التحميل…</div>
      ) : (
        <div className="grid gap-2 pb-10 w-full min-w-0">
          {items.slice(0, visible).map((r) => (
            <PatientCard key={r.patient_id} row={r} />
          ))}
          {items.length === 0 && (
            <div className="text-center py-10 text-muted-foreground">لا نتائج</div>
          )}
          {items.length > visible && (
            <Button
              variant="outline"
              className="mt-2"
              onClick={() => setVisible((v) => v + PAGE_SIZE)}
            >
              عرض المزيد ({items.length - visible} متبقٍ)
            </Button>
          )}
        </div>
      )}

      <AddBeneficiaryDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
