import { createFileRoute } from "@tanstack/react-router";
import { ReportsItemTrackingPage } from "@/components/management/DispensingTrackingPage";
import { trackingInput } from "@/lib/dispensing-tracking.model";

export const Route = createFileRoute("/management/reports/item-tracking")({
  component: ReportsItemTrackingPage,
  validateSearch: (search: Record<string, unknown>) => trackingInput.parse(search),
  head: () => ({ meta: [{ title: "تتبع الصرف - PHIF Tracker" }, { name: "description", content: "تتبع الصرف التاريخي حسب الهوية العلمية والمنتج التجاري" }, { property: "og:title", content: "تتبع الصرف - PHIF Tracker" }, { property: "og:description", content: "حركات الصرف والشركات والفواتير عبر التاريخ المحفوظ" }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
});
