import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { ItemsReferencePage } from "@/components/management/ItemsReferenceViews";

export const Route = createFileRoute("/management/reports/items")({
  component: ItemsReferenceLayout,
  head: () => ({ meta: [{ title: "الأصناف — PHIF Tracker" }, { name: "description", content: "مرجع مركزي للأدوية بالاسم العلمي" }, { property: "og:title", content: "الأصناف — PHIF Tracker" }, { property: "og:description", content: "مرجع الأدوية والمنتجات حسب الاسم العلمي" }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
});

function ItemsReferenceLayout() {
  const location = useLocation();
  return location.pathname === "/management/reports/items" ? <ItemsReferencePage /> : <Outlet />;
}