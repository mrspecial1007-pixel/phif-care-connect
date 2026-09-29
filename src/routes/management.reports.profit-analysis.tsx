import { createFileRoute } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { ReportsProfitAnalysisPage } from "@/components/management/ReportsViews";

export const Route = createFileRoute("/management/reports/profit-analysis")({
  component: () => (
    <Gate>
      <ReportsProfitAnalysisPage />
    </Gate>
  ),
});
