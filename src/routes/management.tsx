import { createFileRoute, Link } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, BriefcaseBusiness, PackageSearch } from "lucide-react";

export const Route = createFileRoute("/management")({
  component: () => <Gate><ManagementPage /></Gate>,
});

function ManagementPage() {
  const items = [
    { to: "/management/reports", title: "التقارير", desc: "تقارير الصرف والفواتير المحفوظة", icon: BarChart3 },
    { to: "/management/treasury", title: "خزينة الصرف", desc: "قيم الصرف Actual وPHIF دون افتراض تحصيل نقدي", icon: BriefcaseBusiness },
    { to: "/management/inventory", title: "المخزون", desc: "تجهيز فقط لهذه المرحلة", icon: PackageSearch, soon: true },
  ] as const;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">الإدارة</h1>
        <p className="text-sm text-muted-foreground">أدوات الترياق الإدارية حسب الصلاحيات.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.to} to={item.to} className="block">
              <Card className="p-4 h-full hover:bg-accent/40 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold">{item.title}</h2>
                      {item.soon && <Badge variant="secondary">قريبًا</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{item.desc}</p>
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
