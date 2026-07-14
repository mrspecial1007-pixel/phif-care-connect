import { createFileRoute } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getRecentActivity } from "@/lib/activity.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Building2, Pill, Pencil, FileSpreadsheet, Upload, Download } from "lucide-react";

export const Route = createFileRoute("/activity")({
  component: () => <Gate><ActivityPage /></Gate>,
});

type Filter = "today_all" | "all" | "dispensing" | "edits" | "imports";

function ActivityPage() {
  const fetchFn = useServerFn(getRecentActivity);
  const { data, isLoading } = useQuery({
    queryKey: ["recent_activity"],
    queryFn: () => fetchFn(),
    staleTime: 30_000,
  });
  const [filter, setFilter] = useState<Filter>("today_all");

  const items = useMemo(() => {
    if (!data) return [];
    const txItems = data.transactions.map((t: any) => ({
      kind: "tx" as const,
      at: t.created_at,
      tx: t,
    }));
    const auditItems = data.audit
      .filter((a: any) => a.action !== "record_dispensing" && a.action !== "record_dispensing_historical_append" && a.action !== "record_dispensing_recalc")
      .map((a: any) => ({ kind: "audit" as const, at: a.created_at, audit: a }));
    const all = [...txItems, ...auditItems].sort((a, b) => (a.at > b.at ? -1 : 1));
    const today = new Date().toISOString().slice(0, 10);
    return all.filter((it) => {
      const isToday = (it.at ?? "").slice(0, 10) === today;
      if (filter === "today_all") return isToday;
      if (filter === "dispensing") return it.kind === "tx";
      if (filter === "edits") return it.kind === "audit" && it.audit.action?.includes("patient");
      if (filter === "imports") return it.kind === "audit" && it.audit.action === "import_excel";
      return true;
    });
  }, [data, filter]);

  function exportXlsx() {
    const rows = items.map((it) => {
      if (it.kind === "tx") {
        const t = it.tx;
        return {
          الوقت: new Date(t.created_at).toLocaleString("en-GB"),
          النوع: t.transaction_type === "Completed" ? "صرف كامل" : t.transaction_type === "Partial" ? "صرف جزئي" : "صرف متبقي",
          المريض: t.patients?.patient_name ?? "",
          البطاقة: t.patients?.insurance_card_number ?? "",
          الصيدلية: t.pharmacies?.name ?? "",
          مصروف: t.items_dispensed ?? "",
          متبقي: t.items_remaining ?? "",
          ملاحظات: t.notes ?? "",
        };
      }
      const a = it.audit;
      return {
        الوقت: new Date(a.created_at).toLocaleString("en-GB"),
        النوع: a.action,
        الكيان: a.entity,
        المعرف: a.entity_id ?? "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Activity");
    XLSX.writeFile(wb, `activity-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const chips: { k: Filter; label: string }[] = [
    { k: "today_all", label: "نشاط اليوم" },
    { k: "dispensing", label: "الصرف" },
    { k: "edits", label: "تعديلات المرضى" },
    { k: "imports", label: "استيراد Excel" },
    { k: "all", label: "الكل (30 يوم)" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">نشاط اليوم</h1>
        <Button variant="outline" size="sm" onClick={exportXlsx} disabled={!items.length}>
          <Download className="h-4 w-4 ml-1" /> Excel
        </Button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {chips.map((c) => (
          <button
            key={c.k}
            onClick={() => setFilter(c.k)}
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
      ) : items.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">لا يوجد نشاط</div>
      ) : (
        <div className="space-y-2">
          {items.map((it, i) => (
            <Card key={i} className="p-3">
              {it.kind === "tx" ? (
                <TxRow tx={it.tx} />
              ) : (
                <AuditRow a={it.audit} />
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TxRow({ tx }: { tx: any }) {
  const t = new Date(tx.created_at);
  const kind =
    tx.transaction_type === "Completed" ? { label: "صرف كامل", cls: "text-success" } :
    tx.transaction_type === "Partial" ? { label: "صرف جزئي", cls: "text-info" } :
    { label: "صرف متبقي", cls: "text-warning" };
  return (
    <div className="flex items-start gap-3">
      <div className="text-xs text-muted-foreground w-14 shrink-0">
        {t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
      </div>
      <Pill className="h-4 w-4 mt-0.5 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm">{tx.patients?.patient_name ?? "—"}</div>
        <div className={`text-xs font-medium ${kind.cls}`}>{kind.label}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
          <Building2 className="h-3 w-3" />
          {tx.pharmacies?.name ?? "—"}
        </div>
      </div>
    </div>
  );
}

function AuditRow({ a }: { a: any }) {
  const t = new Date(a.created_at);
  const isImport = a.action === "import_excel";
  const label = isImport
    ? `استيراد Excel — ${a.after?.rows ?? 0} سجل`
    : a.action === "create_patient"
    ? "إضافة مريض"
    : a.action === "update_patient"
    ? "تعديل بيانات مريض"
    : a.action;
  return (
    <div className="flex items-start gap-3">
      <div className="text-xs text-muted-foreground w-14 shrink-0">
        {t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
      </div>
      {isImport ? <FileSpreadsheet className="h-4 w-4 mt-0.5 text-info shrink-0" /> : <Pencil className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm">{label}</div>
      </div>
    </div>
  );
}