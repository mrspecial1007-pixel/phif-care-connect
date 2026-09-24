import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Gate } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { listPhifInvoices, type PhifInvoiceArchiveRow } from "@/lib/phif-invoices.functions";
import { CalendarDays, ChevronLeft, Loader2, ReceiptText, Search } from "lucide-react";

export const Route = createFileRoute("/phif-invoices/")({
  component: () => (
    <Gate>
      <PhifInvoicesPage />
    </Gate>
  ),
});

function PhifInvoicesPage() {
  const listInvoices = useServerFn(listPhifInvoices);
  const today = new Date().toISOString().slice(0, 10);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filters = useMemo(
    () => ({
      search: search.trim() || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
    [search, dateFrom, dateTo],
  );

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["phif_invoices_archive", filters],
    queryFn: () => listInvoices({ data: filters }),
    staleTime: 20_000,
  });

  return (
    <div className="space-y-4 pb-20" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">فواتير PHIF</h1>
          <p className="text-sm text-muted-foreground">
            أرشيف الفواتير المحفوظة من PHIF للترياق الشافي فقط.
          </p>
        </div>
        <Badge variant="secondary" className="gap-1">
          <ReceiptText className="h-3.5 w-3.5" />
          {data?.total ?? 0} فاتورة
        </Badge>
      </div>

      <Card className="p-3 space-y-3">
        <div className="grid gap-2 md:grid-cols-[1fr_170px_170px_auto]">
          <label className="relative block">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="بحث برقم البطاقة أو المستفيد أو الفاتورة"
              className="h-11 pr-9"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">من تاريخ</span>
            <Input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">إلى تاريخ</span>
            <Input type="date" value={dateTo} min={dateFrom || undefined} max={today} onChange={(event) => setDateTo(event.target.value)} />
          </label>
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching} className="self-end gap-2">
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
            تحديث
          </Button>
        </div>
      </Card>

      {isLoading ? (
        <Card className="p-10 text-center text-muted-foreground">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" />
          جاري تحميل فواتير PHIF...
        </Card>
      ) : error ? (
        <Card className="p-6 text-center text-destructive">
          تعذر تحميل فواتير PHIF. {(error as Error).message}
        </Card>
      ) : (data?.rows?.length ?? 0) === 0 ? (
        <Card className="p-10 text-center text-muted-foreground border-dashed">
          لا توجد فواتير محفوظة تطابق البحث الحالي.
        </Card>
      ) : (
        <div className="grid gap-2">
          {data!.rows.map((invoice) => (
            <InvoiceCard key={invoice.id} invoice={invoice} />
          ))}
        </div>
      )}
    </div>
  );
}

function InvoiceCard({ invoice }: { invoice: PhifInvoiceArchiveRow }) {
  return (
    <Link to="/phif-invoices/$id" params={{ id: invoice.id }} className="block">
      <Card className="p-3 transition-colors hover:bg-accent/50">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">
                {invoice.invoice_number || invoice.invoice_key}
              </span>
              <Badge variant={invoice.match_status === "matched" ? "default" : "outline"}>
                {invoice.match_status === "matched" ? "مطابق" : "غير مطابق"}
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground truncate">
              {invoice.beneficiary_name || "مستفيد غير معروف"}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span dir="ltr">{invoice.insurance_card_number || "بدون رقم بطاقة"}</span>
              <span>{formatDate(invoice.dispensing_date)}</span>
              <span>{invoice.item_count} صنف</span>
              {invoice.status && <span>{invoice.status}</span>}
            </div>
          </div>
          <ChevronLeft className="mt-2 h-5 w-5 shrink-0 text-muted-foreground" />
        </div>
      </Card>
    </Link>
  );
}

function formatDate(value: string | null) {
  if (!value) return "بدون تاريخ";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-GB");
}
