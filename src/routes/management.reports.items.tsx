import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { ItemsAnalyticsPage } from "@/components/management/ItemsAnalyticsViews";
import { validateAnalyticsSearch } from "@/lib/items-analytics.helpers";

export const Route = createFileRoute("/management/reports/items")({
  component: ItemsReferenceLayout,
  validateSearch: validateAnalyticsSearch,
  head: () => ({ meta: [{ title: "تقرير الأصناف والاستهلاك — PHIF Tracker" }, { name: "description", content: "الاستهلاك الشهري للأدوية وترتيب الأصناف حسب العلب المصروفة" }, { property: "og:title", content: "تقرير الأصناف والاستهلاك — PHIF Tracker" }, { property: "og:description", content: "تقرير استهلاك الأدوية بالاسم العلمي والمصدر والفترة" }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
});

function ItemsReferenceLayout() {
  const location = useLocation();
  return location.pathname === "/management/reports/items" ? <ItemsAnalyticsPage /> : <Outlet />;
}
