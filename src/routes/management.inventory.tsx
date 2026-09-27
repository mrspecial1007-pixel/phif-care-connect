import { createFileRoute } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PackageSearch } from "lucide-react";

export const Route = createFileRoute("/management/inventory")({
  component: () => <Gate><InventoryPage /></Gate>,
});

function InventoryPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold">المخزون</h1>
        <Badge variant="secondary">قريبًا</Badge>
      </div>
      <Card className="p-5 space-y-3">
        <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <PackageSearch className="h-6 w-6" />
        </div>
        <p className="text-sm text-muted-foreground">
          تم تجهيز مكان وحدة المخزون فقط. لن يتم جلب مخزون PHIF أو خصم أي كمية في هذه المرحلة.
        </p>
        <ul className="text-sm list-disc pr-5 space-y-1 text-muted-foreground">
          <li>مخزون التأمين سيبقى منفصلًا عن مخزون الصيدلية.</li>
          <li>لا توجد API أو بيانات مفترضة قبل اعتماد مصدر PHIF الرسمي.</li>
          <li>إظهار هذه الصفحة لا يمنح صلاحية تشغيل مستقبلية دون إذن منفصل.</li>
        </ul>
      </Card>
    </div>
  );
}
