import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
export function ReportBackLink({ to, label }: { to: "/management" | "/management/reports" | "/management/reports/items" | "/settings"; label: string }) {
  return <Link to={to} className="inline-flex min-h-10 items-center gap-2 text-sm text-primary hover:underline"><ArrowRight className="size-4" />{label}</Link>;
}
