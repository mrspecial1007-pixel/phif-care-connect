import { createFileRoute, Link } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { usePatientStatuses, type PatientStatusRow } from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useMemo, useState } from "react";
import { Search, AlertTriangle, Clock, CheckCircle2, Users, Share2 } from "lucide-react";
import { normalizeArabicName } from "@/lib/name-normalize";

export const Route = createFileRoute("/")({ component: () => <Gate><Dashboard /></Gate> });

function statusMeta(row: PatientStatusRow) {
  // Priority: needs_review > overdue > partial > due soon > waiting/ok
  if (row.review_status === "needs_review") {
    return { key: "review", label: "يحتاج مراجعة", color: "bg-warning text-warning-foreground" };
  }
  if (row.current_cycle_status === "Partial") {
    return { key: "partial", label: "صرف جزئي", color: "bg-info text-info-foreground" };
  }
  if (row.remaining_days !== null) {
    if (row.remaining_days < 0)
      return { key: "overdue", label: "متأخر", color: "bg-destructive text-destructive-foreground" };
    if (row.remaining_days <= 3)
      return { key: "due", label: "قريب الاستحقاق", color: "bg-warning text-warning-foreground" };
  }
  if (row.current_cycle_status === "Waiting") {
    return { key: "waiting", label: "بانتظار الصرف", color: "bg-success text-success-foreground" };
  }
  return { key: "ok", label: "مكتمل", color: "bg-secondary text-secondary-foreground" };
}

function Dashboard() {
  const { data: rows, isLoading } = usePatientStatuses();
  const [q, setQ] = useState("");

  const stats = useMemo(() => {
    const r = rows ?? [];
    let review = 0, partial = 0, overdue = 0, due = 0, shared = 0;
    for (const x of r) {
      const m = statusMeta(x);
      if (m.key === "review") review++;
      else if (m.key === "partial") partial++;
      else if (m.key === "overdue") overdue++;
      else if (m.key === "due") due++;
      if (x.is_shared) shared++;
    }
    return { total: r.length, review, partial, overdue, due, shared };
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const qn = normalizeArabicName(q);
    if (!qn) return rows.slice(0, 100);
    return rows.filter(
      (r) =>
        normalizeArabicName(r.patient_name).includes(qn) ||
        (r.insurance_card_number ?? "").includes(q.trim()) ||
        (r.national_id ?? "").includes(q.trim())
    ).slice(0, 200);
  }, [rows, q]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">لوحة التحكم</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="إجمالي المرضى" value={stats.total} icon={Users} />
        <StatCard label="مشترك بين صيدليات" value={stats.shared} icon={Share2} tone="info" />
        <StatCard label="متأخر" value={stats.overdue} icon={AlertTriangle} tone="destructive" />
        <StatCard label="قريب الاستحقاق" value={stats.due} icon={Clock} tone="warning" />
        <StatCard label="صرف جزئي" value={stats.partial} icon={CheckCircle2} tone="info" />
        <StatCard label="يحتاج مراجعة" value={stats.review} icon={AlertTriangle} tone="warning" />
      </div>

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ابحث بالاسم أو رقم البطاقة…"
          className="pr-10 h-12 text-base"
        />
      </div>

      {isLoading ? (
        <div className="text-center py-10 text-muted-foreground">جاري التحميل…</div>
      ) : (
        <div className="grid gap-2">
          {filtered.map((r) => (
            <PatientCard key={r.patient_id} row={r} />
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-10 text-muted-foreground">لا توجد نتائج</div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number;
  icon: any;
  tone?: "default" | "destructive" | "warning" | "info";
}) {
  const toneCls =
    tone === "destructive"
      ? "bg-destructive/10 text-destructive"
      : tone === "warning"
      ? "bg-warning/15 text-warning-foreground/80"
      : tone === "info"
      ? "bg-info/10 text-info"
      : "bg-primary/10 text-primary";
  return (
    <Card className="p-3 flex items-center gap-3">
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${toneCls}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-xl font-bold leading-none">{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
      </div>
    </Card>
  );
}

export function PatientCard({ row }: { row: PatientStatusRow }) {
  const meta = statusMeta(row);
  return (
    <Link
      to="/patients/$id"
      params={{ id: row.patient_id }}
      className="block"
    >
      <Card className={`p-3 border-r-4 hover:shadow-md transition ${borderTone(meta.key)}`}>
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
              {row.insurance_card_number && <span>بطاقة: {row.insurance_card_number}</span>}
              {row.last_pharmacy_name && <span>آخر صرف: {row.last_pharmacy_name}</span>}
              {row.next_due_date && (
                <span>
                  {row.remaining_days !== null && row.remaining_days >= 0
                    ? `متبقي ${row.remaining_days} يوم`
                    : `متأخر ${Math.abs(row.remaining_days ?? 0)} يوم`}
                </span>
              )}
            </div>
          </div>
          <Badge className={`${meta.color} border-0`}>{meta.label}</Badge>
        </div>
      </Card>
    </Link>
  );
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
