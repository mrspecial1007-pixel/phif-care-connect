import { createFileRoute } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { usePatientStatuses } from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Download, ChevronDown } from "lucide-react";
import { PatientCard } from "@/components/PatientCard";

export const Route = createFileRoute("/quality")({
  component: () => <Gate><QualityPage /></Gate>,
});

function QualityPage() {
  const { data: rows } = usePatientStatuses();
  const [open, setOpen] = useState<string | null>(null);

  const groups = useMemo(() => {
    const r = rows ?? [];
    const missingPhone = r.filter((x) => !x.phone || !x.phone.trim());
    const missingAddress = r.filter((x) => {
      // address not in view; fall back to filter using patients endpoint? we'll approximate via lack of phone; skip
      return false;
    });
    const cards = new Map<string, typeof r>();
    for (const x of r) {
      const c = (x.insurance_card_number ?? "").trim();
      if (!c) continue;
      if (!cards.has(c)) cards.set(c, [] as any);
      (cards.get(c) as any).push(x);
    }
    const dupCards = Array.from(cards.values()).filter((g) => g.length > 1).flat();
    const noLeadingZero = r.filter(
      (x) => x.insurance_card_number && /^\d+$/.test(x.insurance_card_number) && x.insurance_card_number.length < 13,
    );
    const suspicious = r.filter(
      (x) => x.insurance_card_number && (/^0+$/.test(x.insurance_card_number) || x.insurance_card_number.length < 6),
    );
    const shared = r.filter((x) => x.is_shared);
    const noHistory = r.filter((x) => !x.last_dispensing_date);

    return [
      { k: "phone", label: "بدون رقم هاتف", items: missingPhone },
      { k: "dup", label: "أرقام بطاقة مكررة", items: dupCards },
      { k: "zero", label: "بطاقة ناقصة الأصفار", items: noLeadingZero },
      { k: "suspect", label: "بطاقات مشبوهة", items: suspicious },
      { k: "shared", label: "مشترك بين صيدليات", items: shared },
      { k: "nohist", label: "بدون سجل صرف", items: noHistory },
    ];
  }, [rows]);

  function exportGroup(label: string, items: any[]) {
    const rows = items.map((x) => ({
      الاسم: x.patient_name,
      البطاقة: x.insurance_card_number ?? "",
      الهاتف: x.phone ?? "",
      "آخر صرف": x.last_dispensing_date ?? "",
      "الاستحقاق": x.next_due_date ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, label.slice(0, 30));
    XLSX.writeFile(wb, `quality-${label}.xlsx`);
  }

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">جودة البيانات</h1>
      {groups.map((g) => (
        <Card key={g.k} className="p-3">
          <button
            onClick={() => setOpen(open === g.k ? null : g.k)}
            className="w-full flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <ChevronDown className={`h-4 w-4 transition ${open === g.k ? "rotate-180" : ""}`} />
              <span className="font-semibold text-sm">{g.label}</span>
            </div>
            <span className="text-lg font-bold">{g.items.length}</span>
          </button>
          {open === g.k && (
            <div className="mt-3 space-y-2">
              <Button size="sm" variant="outline" onClick={() => exportGroup(g.label, g.items)} disabled={!g.items.length}>
                <Download className="h-4 w-4 ml-1" /> تصدير Excel
              </Button>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {g.items.slice(0, 100).map((x) => (
                  <PatientCard key={x.patient_id} row={x} />
                ))}
                {g.items.length > 100 && (
                  <div className="text-xs text-muted-foreground text-center">وأكثر…</div>
                )}
                {g.items.length === 0 && (
                  <div className="text-xs text-muted-foreground text-center">لا يوجد</div>
                )}
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}