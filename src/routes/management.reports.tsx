import { createFileRoute, Link } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { BarChart3, LineChart, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/management/reports")({
  component: () => (
    <Gate>
      <ReportsLandingPage />
    </Gate>
  ),
});

const reportCards = [
  {
    to: "/management/reports/summary",
    title: "التقرير الشامل",
    desc: "تحليل الصرف والمستفيدين والأصناف",
    icon: BarChart3,
  },
  {
    to: "/management/reports/item-tracking",
    title: "تتبع صنف",
    desc: "تتبع حركة صنف ومستخدميه",
    icon: LineChart,
  },
  {
    to: "/management/reports/profit-analysis",
    title: "تحليل الأرباح",
    desc: "الإيراد والتكلفة والربحية",
    icon: TrendingUp,
  },
] as const;

function ReportsLandingPage() {
  return (
    <div className="space-y-4" dir="rtl">
      <div>
        <h1 className="text-xl font-bold">مركز التقارير</h1>
        <p className="text-sm text-muted-foreground">
          اختر التقرير المطلوب. كل تقرير يفتح صفحة مستقلة مخصصة له.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {reportCards.map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.to} to={card.to} className="block">
              <Card className="h-full p-4 transition-colors hover:bg-accent/40">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">{card.title}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">{card.desc}</p>
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
