import { createFileRoute } from "@tanstack/react-router";
import { ItemReferenceDetailsPage } from "@/components/management/ItemsReferenceViews";

export const Route = createFileRoute("/management/reports/items/$itemId")({
  component: ItemDetailsRoute,
  head: () => ({ meta: [{ title: "تفاصيل الصنف — PHIF Tracker" }, { name: "description", content: "تفاصيل الصنف العلمي ومنتجاته وحركة صرفه" }, { property: "og:title", content: "تفاصيل الصنف — PHIF Tracker" }, { property: "og:description", content: "المستفيدون ومنتجات Actual وPHIF Supplier وحركة الصرف" }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
});

function ItemDetailsRoute() {
  const { itemId } = Route.useParams();
  return <ItemReferenceDetailsPage itemId={itemId} />;
}