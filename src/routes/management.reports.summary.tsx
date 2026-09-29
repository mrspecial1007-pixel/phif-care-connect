import { createFileRoute } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { ReportsSummaryPage } from "@/components/management/ReportsViews";

export const Route = createFileRoute("/management/reports/summary")({
  component: () => (
    <Gate>
      <ReportsSummaryPage />
    </Gate>
  ),
});
