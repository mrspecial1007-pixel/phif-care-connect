import { createFileRoute } from "@tanstack/react-router";
import { PhifAnalyticsPage } from "@/components/analytics/PhifAnalyticsPage";

export const Route = createFileRoute("/management/analytics")({
  component: PhifAnalyticsPage,
  head: () => ({ meta: [{ title: "PHIF Analytics — التحليلات الدوائية" }, { name: "description", content: "لوحة تحليلات الصرف الدوائي حسب المادة العلمية والمصدر والفترة" }, { property: "og:title", content: "PHIF Analytics — التحليلات الدوائية" }, { property: "og:description", content: "مؤشرات ورسوم بيانية لصرف PHIF Supplier وActual" }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
});
