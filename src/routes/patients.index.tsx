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

  const items = useMemo(() => {
    if (!rows) return [];
    const qn = normalizeArabicName(q);
    const list = rows.filter((r) => {
      if (!qn) return true;
      return (
        normalizeArabicName(r.patient_name).includes(qn) ||
        (r.insurance_card_number ?? "").includes(q.trim())
      );
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

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">المرضى</h1>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="بحث…"
        className="h-12 text-base"
      />
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