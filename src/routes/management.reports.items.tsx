import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { ItemsAnalyticsPage } from "@/components/management/ItemsAnalyticsViews";
import { validateAnalyticsSearch } from "@/lib/items-analytics.helpers";

export const Route = createFileRoute("/management/reports/items")({
  component: ItemsReferenceLayout,
  validateSearch: validateAnalyticsSearch,
  head: () => ({ meta: [{ title: "تقرير الأصناف والاستهلاك — PHIF Tracker" }, { name: "description", content: "الاستهلاك الشهري والأصناف بالاسم العلمي والعلب" }] }),
});

function ItemsReferenceLayout() {
  const location = useLocation();
  return location.pathname === "/management/reports/items" ? <ItemsAnalyticsPage /> : <Outlet />;
}
