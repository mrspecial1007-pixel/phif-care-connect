import { createFileRoute } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getManagementReport } from "@/lib/management.functions";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/management/reports")({
  component: () => <Gate><ReportsPage /></Gate>,
});

function today() {
  return new Date().toISOString().slice(0, 10);
}

function money(value: number) {
  return value.toLocaleString("ar-LY", { maximumFractionDigits: 3 });
}

function ReportsPage() {
  const reportFn = useServerFn(getManagementReport);
  const [dateFrom, setDateFrom] = useState(today());
  const [dateTo, setDateTo] = useState(today());
  const [source, setSource] = useState<"all" | "actual" | "phif">("all");
  const filters = useMemo(() => ({ dateFrom, dateTo, source }), [dateFrom, dateTo, source]);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["management_report", filters],
    queryFn: () => reportFn({ data: filters }),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">التقارير</h1>
        <p className="text-sm text-muted-foreground">تقارير فعلية من فواتير PHIF المحفوظة. لا يتم تخمين بيانات غير مسجلة.</p>
      </div>
      <Card className="p-4 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <Select value={source} onValueChange={(v: any) => setSource(v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل المصادر</SelectItem>
            <SelectItem value="actual">Actual</SelectItem>
            <SelectItem value="phif">PHIF</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => refetch()} disabled={isLoading}>تحديث</Button>
      </Card>
      {error && <Card className="p-4 text-destructive">تعذر تحميل التقرير: {(error as Error).message}</Card>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="عدد الفواتير" value={data?.invoice_count ?? 0} />
        <Stat label="المستفيدون الفريدون" value={data?.unique_patient_count ?? 0} />
        <Stat label="الأصناف المصروفة" value={data?.item_count ?? 0} />
        <Stat label="إجمالي قيمة الصرف" value={`${money(data?.total_dispensed_value ?? 0)} د.ل`} />
        <Stat label="Actual" value={`${money(data?.actual_value ?? 0)} د.ل`} />
        <Stat label="PHIF" value={`${money(data?.phif_value ?? 0)} د.ل`} />
        <Stat label="تفصيل الموظف" value={data?.employee_breakdown_available ? "متاح" : "غير مسجل تاريخيًا"} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold mt-1">{value}</div>
    </Card>
  );
}
