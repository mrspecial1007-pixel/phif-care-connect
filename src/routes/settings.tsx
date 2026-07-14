import { createFileRoute } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useServerFn } from "@tanstack/react-start";
import { exportAllData } from "@/lib/activity.functions";
import { Download, Database } from "lucide-react";
import { useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  component: () => <Gate><SettingsPage /></Gate>,
});

function SettingsPage() {
  const exportFn = useServerFn(exportAllData);
  const [busy, setBusy] = useState(false);

  async function fullBackup() {
    setBusy(true);
    try {
      const data: any = await exportFn();
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.patients), "Patients");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.cycles), "Cycles");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        (data.transactions ?? []).map((t: any) => ({
          ...t,
          patient_name: t.patients?.patient_name,
          pharmacy_name: t.pharmacies?.name,
          patients: undefined,
          pharmacies: undefined,
        })),
      ), "Transactions");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.audit), "Audit");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.pharmacies), "Pharmacies");
      XLSX.writeFile(wb, `phif-backup-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success("تم تنزيل النسخة الاحتياطية");
    } catch {
      toast.error("تعذر تصدير البيانات");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">الإعدادات</h1>
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold">تصدير قاعدة البيانات كاملة</div>
            <div className="text-xs text-muted-foreground">المرضى والصرف والسجل بصيغة Excel</div>
          </div>
        </div>
        <Button onClick={fullBackup} disabled={busy} className="w-full h-11">
          <Download className="h-4 w-4 ml-2" />
          {busy ? "جاري التحضير…" : "تنزيل النسخة الاحتياطية"}
        </Button>
      </Card>
    </div>
  );
}