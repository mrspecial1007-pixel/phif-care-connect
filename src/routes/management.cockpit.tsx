import { createFileRoute } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { CockpitDashboard } from "@/components/cockpit/CockpitDashboard";

const T = "لوحة القيادة — PHIF Tracker";
const D = "لوحة قيادة داكنة تجمع مؤشرات الاستحقاق والمطالبات والمزامنة والصرف (بيانات تجريبية).";

export const Route = createFileRoute("/management/cockpit")({
  component: () => <Gate><CockpitDashboard /></Gate>,
  head: () => ({ meta: [{ title: T }, { name: "description", content: D }, { property: "og:title", content: T }, { property: "og:description", content: D }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
});
