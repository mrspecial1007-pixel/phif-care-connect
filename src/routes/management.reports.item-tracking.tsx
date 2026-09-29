import { createFileRoute } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { ReportsItemTrackingPage } from "@/components/management/ReportsViews";

export const Route = createFileRoute("/management/reports/item-tracking")({
  component: () => (
    <Gate>
      <ReportsItemTrackingPage />
    </Gate>
  ),
});
