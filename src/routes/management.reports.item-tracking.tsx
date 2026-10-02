import { createFileRoute } from "@tanstack/react-router";
import { ReportsItemTrackingPage } from "@/components/management/ReportsViews";

export const Route = createFileRoute("/management/reports/item-tracking")({
  component: ReportsItemTrackingPage,
  head: () => ({ meta: [{ title: "تتبع صنف — PHIF Tracker" }, { name: "description", content: "تتبع حركة صنف ومستخدميه ومخزونه" }, { property: "og:title", content: "تتبع صنف — PHIF Tracker" }, { property: "og:description", content: "حركة الصنف ومستخدميه ومخزونه" }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
});
