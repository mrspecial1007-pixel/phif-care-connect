import { createFileRoute } from "@tanstack/react-router";
import { ReportsProfitAnalysisPage } from "@/components/management/ReportsViews";

export const Route = createFileRoute("/management/reports/profit-analysis")({
  component: ReportsProfitAnalysisPage,
  head: () => ({ meta: [{ title: "تحليل الأرباح — PHIF Tracker" }, { name: "description", content: "تحليل الإيراد والتكلفة والربحية للفواتير والأصناف" }, { property: "og:title", content: "تحليل الأرباح — PHIF Tracker" }, { property: "og:description", content: "تحليل الإيراد والتكلفة والربحية للفواتير والأصناف" }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
});
