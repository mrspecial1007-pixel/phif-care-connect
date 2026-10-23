import { createFileRoute } from "@tanstack/react-router";
import { ItemsAnalyticsPage } from "@/components/management/ItemsAnalyticsViews";
import { validateAnalyticsSearch } from "@/lib/items-analytics.helpers";

export const Route = createFileRoute("/management/reports/beneficiary-profit")({
  validateSearch: (search: Parameters<typeof validateAnalyticsSearch>[0]) =>
    validateAnalyticsSearch({ ...search, sort: search.sort ?? "profit_desc" }),
  component: () => <ItemsAnalyticsPage view="beneficiaries" />,
  head: () => ({ meta: [{ title: "ربحية المستفيدين — PHIF Tracker" }] }),
});
