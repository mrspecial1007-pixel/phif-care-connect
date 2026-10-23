import { createFileRoute } from "@tanstack/react-router";
import { ItemsAnalyticsPage } from "@/components/management/ItemsAnalyticsViews";
import { validateAnalyticsSearch } from "@/lib/items-analytics.helpers";

export const Route = createFileRoute("/management/reports/item-profit")({
  validateSearch: validateAnalyticsSearch,
  component: () => <ItemsAnalyticsPage view="items" />,
  head: () => ({ meta: [{ title: "ربحية الأصناف — PHIF Tracker" }] }),
});
