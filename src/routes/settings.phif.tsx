import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { ArrowRight, ReceiptText, RefreshCw, Wrench } from "lucide-react";

export const Route = createFileRoute("/settings/phif")({
  component: PhifSettingsPage,
  head: () => ({ meta: [{ title: "إعدادات PHIF — PHIF Tracker" }, { name: "description", content: "فواتير ومزامنة PHIF" }, { property: "og:title", content: "إعدادات PHIF — PHIF Tracker" }, { property: "og:description", content: "فواتير ومزامنة PHIF" }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
});

function PhifSettingsPage() {
  const items = [
    {
      to: "/phif-invoices",
      title: "فواتير PHIF",
      desc: "أرشيف الفواتير المحفوظة وتفاصيل الأصناف",
      icon: ReceiptText,
    },
    {
      to: "/phif-sync",
      title: "مزامنة PHIF",
      desc: "تسجيل الدخول وفحص الحركات الجديدة والتاريخية",
      icon: RefreshCw,
    },
    {
      to: "/phif-sync",
      title: "استكمال فواتير PHIF",
      desc: "استكمال أصناف الفواتير المحفوظة عند الحاجة",
      icon: Wrench,
    },
  ] as const;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">PHIF</h1>
          <p className="text-sm text-muted-foreground">فواتير ومزامنة واستكمال فواتير PHIF.</p>
        </div>
        <Link to="/settings" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowRight className="h-4 w-4" />
          العودة للإعدادات
        </Link>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={`${item.to}-${item.title}`} to={item.to as any} className="block">
              <Card className="p-4 h-full hover:bg-accent/40 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">{item.title}</h2>
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
