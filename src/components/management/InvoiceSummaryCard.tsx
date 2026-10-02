import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function formatMoney(value: number | null | undefined) {
  return value === null || value === undefined ? "غير مكتمل" : `${Number(value).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} د.ل`;
}
export function formatReportDate(value: string | null | undefined) {
  if (!value) return "بدون تاريخ";
  const parts = value.slice(0, 10).split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value;
}
export function InvoiceSummaryCard({ name, number, date, count, revenue, cost, profit, status, onClick, children }: {
  name?: string | null; number?: string | null; date?: string | null; count?: number;
  revenue?: number | null; cost?: number | null; profit?: number | null; status?: string;
  onClick?: () => void; children?: ReactNode;
}) {
  return <Button type="button" variant="outline" onClick={onClick} className="h-auto min-h-24 w-full min-w-0 flex-col items-stretch gap-2 whitespace-normal p-3 text-right">
    <span className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
      <span className="min-w-0 truncate font-bold">{name || "مستفيد غير محدد"}</span>
      {status && <span className="shrink-0 text-xs text-amber-700">{status}</span>}
    </span>
    <span className="text-xs text-muted-foreground">فاتورة {number || "—"} · {formatReportDate(date)} · {count ?? 0} صنف</span>
    <span className="grid grid-cols-3 gap-2 text-xs">
      <span>الإيراد<br /><strong>{formatMoney(revenue)}</strong></span>
      <span>التكلفة<br /><strong>{formatMoney(cost)}</strong></span>
      <span>الربح<br /><strong className={profit !== null && profit !== undefined && profit >= 0 ? "text-emerald-700" : ""}>{formatMoney(profit)}</strong></span>
    </span>
    {children}
  </Button>;
}
