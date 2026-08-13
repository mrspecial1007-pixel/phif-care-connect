import { createFileRoute } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { usePatientStatuses } from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useMemo, useState } from "react";
import { Search, AlertTriangle, Clock, CheckCircle2, Users, Share2, Phone, PhoneOff, Star } from "lucide-react";
import { nameMatchesQuery } from "@/lib/name-normalize";
import { PatientCard, statusMeta } from "@/components/PatientCard";

export const Route = createFileRoute("/")({ component: () => <Gate><Dashboard /></Gate> });

function Dashboard() {
  const { data: rows, isLoading } = usePatientStatuses();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "suspended" | "shared" | "review" | "overdue" | "partial" | "has_phone" | "no_phone" | "favorite" | "old_follow_up">("active");

  const stats = useMemo(() => {
    const r = rows ?? [];
    let review = 0, partial = 0, overdue = 0, due = 0, shared = 0, withPhone = 0, noPhone = 0;
    for (const x of r) {
      if (x.is_follow_up_suspended) continue;
      const m = statusMeta(x);
      if (m.key === "review") review++;
      else if (m.key === "partial") partial++;
      else if (m.key === "overdue" && x.remaining_days !== null && x.remaining_days >= -50) overdue++;
      else if (m.key === "due") due++;
      if (x.is_shared) shared++;
      if (x.phone && x.phone.trim()) withPhone++; else noPhone++;
    }
    return { total: r.length, review, partial, overdue, due, shared, withPhone, noPhone };
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const searching = !!q.trim();
    const list = rows.filter((r) => {
      const matchSearch =
        !searching ||
        nameMatchesQuery(r.patient_name, q) ||
        (r.insurance_card_number ?? "").includes(q.trim()) ||
        (r.national_id ?? "").includes(q.trim()) ||
        (r.phone ?? "").includes(q.trim());
      if (!matchSearch) return false;
      if (searching) return true;
      if (filter === "shared" && !r.is_shared) return false;
      if (filter === "review" && r.review_status !== "needs_review") return false;
      if (filter === "overdue" && !(r.remaining_days !== null && r.remaining_days < 0 && r.remaining_days >= -50)) return false;
      if (filter === "old_follow_up" && !(r.remaining_days !== null && r.remaining_days < -50)) return false;
      if (filter === "partial" && r.current_cycle_status !== "Partial") return false;
      if (filter === "has_phone" && !(r.phone && r.phone.trim())) return false;
      if (filter === "no_phone" && r.phone && r.phone.trim()) return false;
      if (filter === "favorite" && !r.is_favorite) return false;
      if (filter === "suspended" && !r.is_follow_up_suspended) return false;
      
      if (filter === "active") {
        if (r.is_follow_up_suspended) return false;
        if (r.remaining_days !== null && r.remaining_days < -50) return false;
        if (r.remaining_days !== null && r.remaining_days < -2 && r.remaining_days >= -50) return false;
        return true;
      }
      
      if (filter === "all") return true;

      return true;
    });

    const sorted = [...list].sort((a, b) => {
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
        if (pa === 0 || pa === 1) {
          // Both are high-priority overdue (-1 or -2)
          // We want the closest to being due first (least negative absolute value)
          // -1 (overdue 1 day) should come before -2 (overdue 2 days)
          return b.remaining_days - a.remaining_days; 
        }
        if (pa === 4) {
          // General overdue (days < -2)
          // Closest first: -3, -4, -5...
          // Higher numeric value (closer to 0) first
          return b.remaining_days - a.remaining_days;
        }
        return a.remaining_days - b.remaining_days;
      }
      return a.patient_name.localeCompare(b.patient_name, "ar");
    });

    return sorted.slice(0, 500);
  }, [rows, q, filter]);

  const chips = [
    { k: "active", label: "نشط" },
    { k: "all", label: "الكل" },
    { k: "overdue", label: "متأخر" },
    { k: "old_follow_up", label: "متابعة قديمة" },
    { k: "suspended", label: "معلقة" },
    { k: "favorite", label: "المفضلة" },
    { k: "partial", label: "جزئي" },
    { k: "review", label: "مراجعة" },
    { k: "shared", label: "مشترك" },
    { k: "has_phone", label: "لديه هاتف" },
    { k: "no_phone", label: "بدون هاتف" },
  ] as const;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">لوحة التحكم</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="إجمالي المستفيدين" value={stats.total} icon={Users} />
        <StatCard label="مشترك بين صيدليات" value={stats.shared} icon={Share2} tone="info" />
        <StatCard label="متأخر" value={stats.overdue} icon={AlertTriangle} tone="destructive" />
        <StatCard label="قريب الاستحقاق" value={stats.due} icon={Clock} tone="warning" />
        <StatCard label="صرف جزئي" value={stats.partial} icon={CheckCircle2} tone="info" />
        <StatCard label="يحتاج مراجعة" value={stats.review} icon={AlertTriangle} tone="warning" />
        <StatCard label="لديه رقم هاتف" value={stats.withPhone} icon={Phone} tone="info" />
        <StatCard label="بدون رقم هاتف" value={stats.noPhone} icon={PhoneOff} tone="warning" />
      </div>

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ابحث بالاسم أو رقم البطاقة أو رقم الهاتف..."
          className="pr-10 h-12 text-base"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {chips.map((c) => (
          <button
            key={c.k}
            onClick={() => setFilter(c.k as any)}
            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1 ${
              filter === c.k ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground"
            }`}
          >
            {c.k === "favorite" && <Star className={`h-3 w-3 ${filter === "favorite" ? "fill-current" : ""}`} />}
            {c.label}
          </button>
        ))}
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