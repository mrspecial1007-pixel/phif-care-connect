import { createFileRoute } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { usePatientStatuses } from "@/lib/queries";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useMemo, useState } from "react";
import { normalizeArabicName } from "@/lib/name-normalize";
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

function List() {
  const { data: rows, isLoading } = usePatientStatuses();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "favorite">("all");

  const items = useMemo(() => {
    if (!rows) return [];
    const qn = normalizeArabicName(q);
    const list = rows.filter((r) => {
      const matchSearch = !qn || (
        normalizeArabicName(r.patient_name).includes(qn) ||
        (r.insurance_card_number ?? "").includes(q.trim())
      );
      const matchFilter = filter === "all" || r.is_favorite;
      return matchSearch && matchFilter;
    });
    return [...list].sort((a, b) => {
      const av = a.remaining_days;
      const bv = b.remaining_days;
      if (av === null && bv === null) return a.patient_name.localeCompare(b.patient_name, "ar");
      if (av === null) return 1;
      if (bv === null) return -1;
      return av - bv;
    });
  }, [rows, q]);

  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">المستفيدون</h1>
        <Button onClick={() => setAddOpen(true)} size="sm" className="gap-2">
          <Plus className="h-4 w-4" /> إضافة مستفيد
        </Button>
      </div>
      
      <div className="flex gap-2 mb-1 overflow-x-auto pb-1 no-scrollbar">
        <Button 
          variant={filter === "all" ? "default" : "outline"} 
          size="sm" 
          onClick={() => setFilter("all")}
          className="rounded-full px-4"
        >
          الكل
        </Button>
        <Button 
          variant={filter === "favorite" ? "default" : "outline"} 
          size="sm" 
          onClick={() => setFilter("favorite")}
          className="rounded-full px-4 gap-1.5"
        >
          <Star className={`h-3.5 w-3.5 ${filter === "favorite" ? "fill-current" : ""}`} />
          المفضلة
        </Button>
      </div>

      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ابحث بالاسم أو رقم البطاقة أو رقم الهاتف..."
        className="h-12 text-base"
      />
      {isLoading ? (
        <div className="text-center py-10 text-muted-foreground">جاري التحميل…</div>
      ) : (
        <div className="grid gap-2 pb-10">
          {items.slice(0, 500).map((r) => (
            <PatientCard key={r.patient_id} row={r} />
          ))}
          {items.length === 0 && (
            <div className="text-center py-10 text-muted-foreground">لا نتائج</div>
          )}
        </div>
      )}

      <AddBeneficiaryDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}