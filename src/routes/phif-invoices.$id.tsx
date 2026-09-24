import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Gate } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getPhifInvoiceDetail } from "@/lib/phif-invoices.functions";
import { ArrowRight, Loader2, Package, ReceiptText } from "lucide-react";

export const Route = createFileRoute("/phif-invoices/$id")({
  component: () => (
    <Gate>
      <PhifInvoiceDetailPage />
    </Gate>
  ),
});

function PhifInvoiceDetailPage() {
  const { id } = Route.useParams();
  const getDetail = useServerFn(getPhifInvoiceDetail);
  const { data: invoice, isLoading, error } = useQuery({
    queryKey: ["phif_invoice_detail", id],
    queryFn: () => getDetail({ data: { id } }),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="py-12 text-center text-muted-foreground" dir="rtl">
        <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" />
        جاري تحميل الفاتورة...
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="space-y-4" dir="rtl">
        <BackLink />
        <Card className="p-6 text-center text-destructive">
          تعذر تحميل فاتورة PHIF. {error ? (error as Error).message : ""}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-20" dir="rtl">
      <BackLink />

      <Card className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <ReceiptText className="h-4 w-4" />
              فاتورة PHIF
            </div>
            <h1 className="mt-1 text-xl font-bold break-words" dir="ltr">
              {invoice.invoice_number || invoice.invoice_key}
            </h1>
          </div>
          <Badge variant={invoice.match_status === "matched" ? "default" : "outline"}>
            {invoice.match_status === "matched" ? "مطابق" : "غير مطابق"}
          </Badge>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Info label="المستفيد" value={invoice.beneficiary_name || "غير معروف"} />
          <Info label="رقم البطاقة" value={invoice.insurance_card_number || "غير متوفر"} dir="ltr" />
          <Info label="تاريخ الصرف" value={formatDate(invoice.dispensing_date)} />
          <Info label="وقت الصرف" value={invoice.dispensing_time || "غير متوفر"} dir="ltr" />
          <Info label="حالة PHIF" value={invoice.status || "غير متوفرة"} />
          <Info label="عدد الأصناف" value={`${invoice.item_count}`} />
          <Info label="تاريخ الحفظ" value={formatDateTime(invoice.synced_at)} />
          <Info label="مفتاح الفاتورة" value={invoice.invoice_key} dir="ltr" />
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">الأصناف المستوردة</h2>
          <Badge variant="secondary">{invoice.items.length}</Badge>
        </div>

        {invoice.items.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
            لا توجد أصناف محفوظة لهذه الفاتورة.
          </div>
        ) : (
          <div className="grid gap-3">
            {invoice.items.map((item, index) => (
              <Card key={item.id} className="p-3 bg-muted/30">
                <div className="flex items-start gap-3">
                  <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-background text-primary">
                    <Package className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div>
                      <div className="text-xs text-muted-foreground">#{index + 1}</div>
                      <div className="font-semibold break-words">
                        {item.brand || item.active_ingredient || "صنف بدون اسم"}
                      </div>
                      {item.active_ingredient && item.brand && (
                        <div className="text-sm text-muted-foreground break-words">{item.active_ingredient}</div>
                      )}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <Info label="التركيز" value={item.strength || "غير متوفر"} compact />
                      <Info label="الكمية" value={item.quantity === null ? "غير متوفرة" : `${item.quantity}`} compact />
                      <Info label="المورد" value={item.supplier || "غير متوفر"} compact />
                      <Info label="المصدر" value={item.source_classification || "غير مصنف"} compact />
                      {item.phif_item_id && <Info label="معرف PHIF" value={item.phif_item_id} dir="ltr" compact />}
                    </div>
                    {Object.keys(item.phif_financial_fields ?? {}).length > 0 && (
                      <div className="rounded-md bg-background p-2">
                        <div className="mb-2 text-xs font-medium text-muted-foreground">الحقول المالية</div>
                        <div className="grid gap-1 sm:grid-cols-2">
                          {Object.entries(item.phif_financial_fields).map(([key, value]) => (
                            <div key={key} className="flex items-center justify-between gap-3 text-xs">
                              <span className="text-muted-foreground" dir="ltr">{key}</span>
                              <span className="font-medium" dir="ltr">{String(value)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function BackLink() {
  return (
    <Button asChild variant="ghost" size="sm" className="gap-2">
      <Link to="/phif-invoices">
        <ArrowRight className="h-4 w-4" />
        العودة إلى فواتير PHIF
      </Link>
    </Button>
  );
}

function Info({ label, value, dir, compact = false }: { label: string; value: string; dir?: "rtl" | "ltr"; compact?: boolean }) {
  return (
    <div className={`rounded-md border bg-background ${compact ? "p-2" : "p-3"}`}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-medium" dir={dir}>
        {value}
      </div>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return "غير متوفر";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-GB");
}

function formatDateTime(value: string | null) {
  if (!value) return "غير متوفر";
  return new Date(value).toLocaleString("en-GB");
}
