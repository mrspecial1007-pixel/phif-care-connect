import { createFileRoute } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { usePatientStatuses } from "@/lib/queries";
import { Input } from "@/components/ui/input";
import { useMemo, useState } from "react";
import { normalizeArabicName } from "@/lib/name-normalize";
import { PatientCard } from "@/components/PatientCard";

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
  const [filter, setFilter] = useState<"all" | "shared" | "review" | "overdue" | "partial" | "has_phone" | "no_phone">("all");

  const items = useMemo(() => {
    if (!rows) return [];
    const qn = normalizeArabicName(q);
    return rows.filter((r) => {
      if (filter === "shared" && !r.is_shared) return false;
      if (filter === "review" && r.review_status !== "needs_review") return false;
      if (filter === "overdue" && !(r.remaining_days !== null && r.remaining_days < 0)) return false;
      if (filter === "partial" && r.current_cycle_status !== "Partial") return false;
      if (filter === "has_phone" && !(r.phone && r.phone.trim())) return false;
      if (filter === "no_phone" && r.phone && r.phone.trim()) return false;
      if (!qn) return true;
      return (
        normalizeArabicName(r.patient_name).includes(qn) ||
        (r.insurance_card_number ?? "").includes(q.trim())
      );
    });
  }, [rows, q, filter]);

  const chips = [
    { k: "all", label: `الكل (${rows?.length ?? 0})` },
    { k: "shared", label: "مشترك" },
    { k: "overdue", label: "متأخر" },
    { k: "partial", label: "جزئي" },
    { k: "review", label: "مراجعة" },
    { k: "has_phone", label: "لديه هاتف" },
    { k: "no_phone", label: "بدون هاتف" },
  ] as const;

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">المرضى</h1>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="بحث…"
        className="h-12 text-base"
      />
      <div className="flex gap-2 overflow-x-auto pb-1">
        {chips.map((c) => (
          <button
            key={c.k}
            onClick={() => setFilter(c.k as any)}
            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium border ${
              filter === c.k ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      {isLoading ? (
        <div className="text-center py-10 text-muted-foreground">جاري التحميل…</div>
      ) : (
        <div className="grid gap-2">
          {items.slice(0, 500).map((r) => (
            <PatientCard key={r.patient_id} row={r} />
          ))}
          {items.length === 0 && (
            <div className="text-center py-10 text-muted-foreground">لا نتائج</div>
          )}
        </div>
      )}
    </div>
  );
}