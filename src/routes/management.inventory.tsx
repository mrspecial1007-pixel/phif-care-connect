import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gate } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { getPhifStockSummary, listPhifStockItems, syncPhifStock } from "@/lib/phif-stock.functions";
import { PackageSearch, RefreshCw, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/management/inventory")({
  component: () => <Gate><InventoryPage /></Gate>,
});

function formatDateTime(value: string | null | undefined) {
  if (!value) return "لا توجد مزامنة ناجحة بعد";
  return new Date(value).toLocaleString("ar-LY", { dateStyle: "medium", timeStyle: "short" });
}

function InventoryPage() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const summaryFn = useServerFn(getPhifStockSummary);
  const listFn = useServerFn(listPhifStockItems);
  const syncFn = useServerFn(syncPhifStock);

  const summary = useQuery({
    queryKey: ["phif_stock_summary"],
    queryFn: () => summaryFn(),
  });
  const items = useQuery({
    queryKey: ["phif_stock_items", query],
    queryFn: () => listFn({ data: { query, limit: 100 } }),
  });
  const sync = useMutation({
    mutationFn: () => syncFn(),
    onSuccess: (result: any) => {
      toast.success(`تمت مزامنة المخزون: ${result.imported_records} سجل جديد أو متغير`);
      qc.invalidateQueries({ queryKey: ["phif_stock_summary"] });
      qc.invalidateQueries({ queryKey: ["phif_stock_items"] });
    },
    onError: (error: any) => {
      toast.error(error?.message ?? "تعذرت مزامنة المخزون");
    },
  });

  const lastRun = summary.data?.last_run;
  const canViewCost = summary.data?.can_view_cost === true;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-bold">مخزون PHIF</h1>
          <p className="text-sm text-muted-foreground">
            مزامنة قراءة فقط لمخزون التأمين. لا يتم تعديل فواتير PHIF أو الصرف أو مخزون الصيدلية المحلي.
          </p>
        </div>
        <Button onClick={() => sync.mutate()} disabled={sync.isPending} className="h-11">
          <RefreshCw className="h-4 w-4 ml-2" />
          {sync.isPending ? "جاري المزامنة..." : "مزامنة المخزون"}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">آخر مزامنة</div>
          <div className="font-semibold mt-1">{formatDateTime(lastRun?.finished_at ?? lastRun?.started_at)}</div>
          {lastRun?.status && <Badge variant={lastRun.status === "completed" ? "default" : "secondary"} className="mt-2">{lastRun.status}</Badge>}
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">السجلات الحالية</div>
          <div className="text-2xl font-bold mt-1">{summary.data?.current_count ?? 0}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">سجلات آخر تشغيل</div>
          <div className="font-semibold mt-1">
            {lastRun ? `${lastRun.imported_records} مستورد / ${lastRun.total_records} إجمالي` : "—"}
          </div>
          {lastRun?.error_message && <div className="text-xs text-destructive mt-2">{lastRun.error_message}</div>}
        </Card>
      </div>

      {!canViewCost && (
        <Card className="p-3 flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldAlert className="h-4 w-4 text-amber-600" />
          أسعار التكلفة مخفية عن هذه الجلسة. تظهر فقط لمن يملك صلاحية إدارية صريحة.
        </Card>
      )}

      <Card className="p-4 space-y-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="font-semibold flex items-center gap-2">
            <PackageSearch className="h-5 w-5 text-primary" />
            السجلات الحالية
          </div>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="بحث بالاسم التجاري أو العلمي أو المورد أو التركيز"
            className="md:w-96"
            dir="rtl"
          />
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                <th className="p-3 text-right">الصنف</th>
                <th className="p-3 text-right">الكمية</th>
                <th className="p-3 text-right">التشغيلة والانتهاء</th>
                <th className="p-3 text-right">المورد</th>
                <th className="p-3 text-right">المعرّفات</th>
                {canViewCost && <th className="p-3 text-right">التكلفة</th>}
                <th className="p-3 text-right">سعر البيع</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.isLoading && (
                <tr><td colSpan={canViewCost ? 7 : 6} className="p-4 text-center text-muted-foreground">جاري التحميل...</td></tr>
              )}
              {(items.data ?? []).map((item: any) => (
                <tr key={item.id} className="align-top">
                  <td className="p-3">
                    <div className="font-semibold">{item.brand_name || item.active_ingredient || "صنف غير مسمى"}</div>
                    <div className="text-xs text-muted-foreground">{[item.active_ingredient, item.strength, item.dosage_unit].filter(Boolean).join(" · ") || "—"}</div>
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {item.stock_quantity ?? "—"} {item.source_quantity_unit ?? ""}
                    <div className="text-xs text-muted-foreground">
                      عبوة {item.package_quantity ?? "—"} · شرائط {item.strips_quantity ?? "—"}
                    </div>
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    <div>{item.batch_number || "—"}</div>
                    <div className="text-xs text-muted-foreground">{item.expiry_date || "بدون تاريخ"}</div>
                  </td>
                  <td className="p-3">{item.supplier_name || "—"}</td>
                  <td className="p-3 text-xs text-muted-foreground">
                    <div>stock: {item.source_stock_id}</div>
                    <div>brand: {item.brand_product_id || "—"}</div>
                    <div>batch: {item.batch_id || "—"}</div>
                  </td>
                  {canViewCost && <td className="p-3 whitespace-nowrap">{item.cost_price ?? "—"}</td>}
                  <td className="p-3 whitespace-nowrap">{item.sale_price ?? "—"}</td>
                </tr>
              ))}
              {!items.isLoading && (items.data ?? []).length === 0 && (
                <tr><td colSpan={canViewCost ? 7 : 6} className="p-4 text-center text-muted-foreground">لا توجد سجلات مخزون مطابقة</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
