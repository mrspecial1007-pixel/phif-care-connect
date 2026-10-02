import { createFileRoute } from "@tanstack/react-router";
import { ReportsSummaryPage } from "@/components/management/ReportsViews";

export const Route = createFileRoute("/management/reports/summary")({
  component: ReportsSummaryPage,
  head: () => ({ meta: [{ title: "التقرير الشامل — PHIF Tracker" }, { name: "description", content: "تحليل الصرف والمستفيدين والأصناف" }, { property: "og:title", content: "التقرير الشامل — PHIF Tracker" }, { property: "og:description", content: "تحليل الصرف والمستفيدين والأصناف" }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
});
