import { createFileRoute, Link } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getManagementReport } from "@/lib/management.functions";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/management/treasury")({
  component: () => <Gate><TreasuryPage /></Gate>,
});

function today() {
  return new Date().toISOString().slice(0, 10);
}

function money(value: number) {
  return value.toLocaleString("ar-LY", { maximumFractionDigits: 3 });
}

function TreasuryPage() {
  const reportFn = useServerFn(getManagementReport);
  const [dateFrom, setDateFrom] = useState(today());
  const [dateTo, setDateTo] = useState(today());
  const [source, setSource] = useState<"all" | "actual" | "phif">("all");
  const filters = useMemo(() => ({ dateFrom, dateTo, source }), [dateFrom, dateTo, source]);
  const { data, isLoading, error } = useQuery({
    queryKey: ["treasury_report", filters],
    queryFn: () => reportFn({ data: filters }),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">خزينة الصرف</h1>
        <p className="text-sm text-muted-foreground">هذه الصفحة تعرض قيمة الأدوية المصروفة، ولا تعرض رصيدًا نقديًا فعليًا.</p>
      </div>
      <Card className="p-4 grid gap-3 md:grid-cols-3">
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
      </Card>
      {error && <Card className="p-4 text-destructive">تعذر تحميل الخزينة: {(error as Error).message}</Card>}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="إجمالي قيمة الصرف" value={`${money(data?.total_dispensed_value ?? 0)} د.ل`} />
        <Stat label="قيمة Actual" value={`${money(data?.actual_value ?? 0)} د.ل`} />
        <Stat label="قيمة PHIF" value={`${money(data?.phif_value ?? 0)} د.ل`} />
        <Stat label="عدد الفواتير" value={data?.invoice_count ?? 0} />
        <Stat label="عدد الأصناف" value={data?.item_count ?? 0} />
        <Stat label="المستفيدون" value={data?.unique_patient_count ?? 0} />
      </div>
      <Card className="overflow-hidden">
        <div className="p-4 font-semibold border-b">تفاصيل الفواتير</div>
        <div className="divide-y">
          {isLoading && <div className="p-4 text-muted-foreground">جاري التحميل...</div>}
          {(data?.details ?? []).map((row: any) => (
            <Link key={row.id} to="/phif-invoices/$id" params={{ id: row.id }} className="block p-3 hover:bg-accent/40">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{row.invoice_number || row.invoice_key}</div>
                  <div className="text-xs text-muted-foreground">{row.beneficiary_name || "مستفيد غير مسجل"} · {row.dispensing_date || "بدون تاريخ"}</div>
                </div>
                <div className="text-left text-xs">
                  <div>{row.item_count} صنف</div>
                  <div>Actual {money(row.actual_value)} / PHIF {money(row.phif_value)}</div>
                </div>
              </div>
            </Link>
          ))}
          {!isLoading && (data?.details ?? []).length === 0 && <div className="p-4 text-center text-muted-foreground">لا توجد نتائج</div>}
        </div>
      </Card>
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
