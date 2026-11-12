import { createFileRoute } from "@tanstack/react-router";
import { ItemsAnalyticsPage } from "@/components/management/ItemsAnalyticsViews";

export const Route = createFileRoute("/management/reports/items/identity-review/$identityId")({
  component: ItemIdentityReviewRoute,
  head: () => ({ meta: [{ title: "مراجعة هوية الأصناف - PHIF Tracker" }] }),
});

function ItemIdentityReviewRoute() {
  const { identityId } = Route.useParams();
  return <ItemsAnalyticsPage reviewIdentityId={identityId} />;
}
