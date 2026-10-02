import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ReportBackLink } from "@/components/management/ReportBackLink";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getPhifStockSummary, listPhifStockItems, syncPhifStock } from "@/lib/phif-stock.functions";
import { stockAvailability, stockQuantityBreakdown } from "@/lib/phif-stock.helpers";
import { CalendarDays, PackageSearch, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/management/inventory")({
  component: InventoryPage,
  head: () => ({ meta: [{ title: "مخزون PHIF — PHIF Tracker" }, { name: "description", content: "المخزون الحالي لصيدلية التأمين" }, { property: "og:title", content: "مخزون PHIF — PHIF Tracker" }, { property: "og:description", content: "المخزون الحالي لصيدلية التأمين" }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
});

function formatDateTime(value: string | null | undefined) {
  if (!value) return "لا توجد مزامنة ناجحة بعد";
  return new Date(value).toLocaleString("ar-LY", { dateStyle: "medium", timeStyle: "short" });
}

function formatExpiry(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ar-LY", { month: "2-digit", year: "numeric" });
}

function money(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return String(value);
  return numeric.toLocaleString("ar-LY", { maximumFractionDigits: 3 });
}

function InventoryPage() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<any | null>(null);
  const summaryFn = useServerFn(getPhifStockSummary);
  const listFn = useServerFn(listPhifStockItems);
  const syncFn = useServerFn(syncPhifStock);

  const summary = useQuery({
    queryKey: ["phif_stock_summary"],
    queryFn: () => summaryFn(),
  });
  const items = useQuery({
    queryKey: ["phif_stock_items", query],
    queryFn: () => listFn({ data: { query, limit: 120 } }),
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
    <div className="space-y-3" dir="rtl">
      <ReportBackLink to="/management" label="الإدارة" />
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-bold">مخزون PHIF</h1>
          <p className="text-sm text-muted-foreground">
            قراءة مخزون التأمين كما هو محفوظ في آخر Snapshot. لا يتم تعديل فواتير PHIF أو الصرف أو بيانات المستفيدين.
          </p>
        </div>
        <Button onClick={() => sync.mutate()} disabled={sync.isPending} className="h-10">
          <RefreshCw className="h-4 w-4 ml-2" />
          {sync.isPending ? "جاري المزامنة..." : "مزامنة المخزون"}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <CompactStat label="الأصناف" value={summary.data?.current_count ?? 0} />
        <CompactStat label="آخر تشغيل" value={lastRun?.status === "completed" ? "مكتمل" : (lastRun?.status ?? "—")} />
        <CompactStat label="مستورد" value={lastRun ? `${lastRun.imported_records}/${lastRun.total_records}` : "—"} />
      </div>

      <div className="rounded-lg border bg-card p-2 text-xs text-muted-foreground">
        آخر مزامنة: {formatDateTime(lastRun?.finished_at ?? lastRun?.started_at)}
        {lastRun?.error_message && <span className="block pt-1 text-destructive">{lastRun.error_message}</span>}
      </div>

      {!canViewCost && (
        <Card className="p-3 flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldAlert className="h-4 w-4 text-amber-600" />
          أسعار الشراء مخفية من الخادم لهذه الجلسة، ولا تظهر إلا لمن يملك صلاحية stock_cost_read.
        </Card>
      )}

      <div className="space-y-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="font-semibold flex items-center gap-2">
            <PackageSearch className="h-5 w-5 text-primary" />
            الأصناف الحالية
          </div>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="بحث بالاسم التجاري أو العلمي أو المورد أو التركيز"
            className="h-10 md:w-96"
            dir="rtl"
          />
        </div>

        {items.isLoading && <div className="p-4 text-center text-muted-foreground">جاري التحميل...</div>}
        {!items.isLoading && (items.data ?? []).length === 0 && (
          <div className="p-6 text-center text-muted-foreground">لا توجد سجلات مخزون مطابقة</div>
        )}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {(items.data ?? []).map((item: any) => (
            <StockCard key={item.id} item={item} onOpen={() => setSelected(item)} />
          ))}
        </div>
      </div>

      <StockDetailsSheet item={selected} canViewCost={canViewCost} onClose={() => setSelected(null)} />
    </div>
  );
}

function CompactStat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-sm font-bold">{value}</div>
    </Card>
  );
}

function StockCard({ item, onOpen }: { item: any; onOpen: () => void }) {
  const quantity = stockQuantityBreakdown(item.stock_quantity, item.strips_quantity, item.source_quantity_unit ?? "شريط");
  const availability = stockAvailability(item);
  const quantityDisplay = compactQuantityDisplay(quantity);
  const expiry = formatExpiry(item.expiry_date);
  const tone =
    availability.tone === "danger"
      ? "border-red-200 bg-red-50/80"
      : availability.tone === "warning"
        ? "border-amber-200 bg-amber-50/70"
        : "border-slate-200 bg-white";
  const quantityTone =
    availability.tone === "danger"
      ? "text-red-700"
      : availability.tone === "warning"
        ? "text-amber-700"
        : "text-emerald-700";

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`min-h-[94px] rounded-lg border px-3 py-2.5 text-right shadow-sm transition hover:border-primary/50 hover:shadow-md ${tone}`}
    >
      <div className="flex h-full items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 break-words text-[15px] font-semibold leading-5 text-foreground">
            {item.brand_name || item.active_ingredient || "صنف غير مسمى"}
          </div>
          <div className="mt-1 break-words text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {[item.strength, item.dosage_unit].filter(Boolean).join(" · ") || "بدون تركيز"}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {availability.status !== "available" && (
              <Badge variant={availability.tone === "danger" ? "destructive" : "secondary"} className="h-5 px-2 text-[11px]">
                {availability.label}
              </Badge>
            )}
            {expiry && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                <CalendarDays className="h-3 w-3" />
                {expiry}
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 text-left">
          <div className={`whitespace-nowrap text-lg font-extrabold leading-6 ${quantityTone}`}>{quantityDisplay.primary}</div>
          {quantityDisplay.secondary && (
            <div className="mt-1 inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">
              {quantityDisplay.secondary}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function compactQuantityDisplay(quantity: ReturnType<typeof stockQuantityBreakdown>) {
  if (quantity.canConvertToBoxes) {
    const boxes = quantity.boxes ?? 0;
    const strips = quantity.remainingStrips ?? 0;
    if (boxes <= 0 && strips <= 0) return { primary: "نفد", secondary: null };
    if (boxes <= 0) return { primary: stripLabel(strips), secondary: null };
    return {
      primary: boxLabel(boxes),
      secondary: strips > 0 ? `+ ${stripLabel(strips)}` : null,
    };
  }
  if ((quantity.originalQuantity ?? 0) <= 0) return { primary: "نفد", secondary: null };
  return { primary: quantity.label, secondary: null };
}

function boxLabel(count: number) {
  if (count === 1) return "1 علبة";
  if (count === 2) return "2 علب";
  return `${count.toLocaleString("ar-LY", { maximumFractionDigits: 0 })} علب`;
}

function stripLabel(count: number) {
  if (count === 1) return "1 شريط";
  if (count === 2) return "2 أشرطة";
  return `${count.toLocaleString("ar-LY", { maximumFractionDigits: 0 })} أشرطة`;
}

function DetailRow({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-md bg-muted/40 p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-medium break-words">{value ?? "—"}</div>
    </div>
  );
}

function StockDetailsSheet({ item, canViewCost, onClose }: { item: any | null; canViewCost: boolean; onClose: () => void }) {
  const quantity = item ? stockQuantityBreakdown(item.stock_quantity, item.strips_quantity, item.source_quantity_unit ?? "شريط") : null;
  const cost = Number(item?.cost_price ?? NaN);
  const sale = Number(item?.sale_price ?? NaN);
  const spread = Number.isFinite(cost) && Number.isFinite(sale) ? sale - cost : null;

  return (
    <Sheet open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl px-4 pb-6 pt-5 sm:mx-auto sm:max-w-2xl" dir="rtl">
        {item && quantity && (
          <>
            <SheetHeader className="text-right">
              <SheetTitle>{item.brand_name || item.active_ingredient || "تفاصيل الصنف"}</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                <DetailRow label="الاسم التجاري" value={item.brand_name} />
                <DetailRow label="التركيز" value={item.strength} />
                <DetailRow label="الوحدة" value={item.dosage_unit || item.source_quantity_unit} />
                <DetailRow label="إجمالي الأشرطة الحالية" value={item.stock_quantity} />
                <DetailRow label="الأشرطة داخل العلبة" value={item.strips_quantity} />
                <DetailRow label="الأقراص داخل العبوة" value={item.package_quantity} />
                <DetailRow label="عدد العلب" value={quantity.canConvertToBoxes ? quantity.boxes : "غير محسوب"} />
                <DetailRow label="باقي الأشرطة" value={quantity.canConvertToBoxes ? quantity.remainingStrips : "غير محسوب"} />
                <DetailRow label="المورد" value={item.supplier_name} />
                <DetailRow label="الشركة المصنعة" value={item.company_name} />
                <DetailRow label="رقم التشغيلة" value={item.batch_number} />
                <DetailRow label="تاريخ الصلاحية" value={item.expiry_date} />
                <DetailRow label="آخر تحديث للسجل" value={formatDateTime(item.synced_at)} />
                <DetailRow label="آخر وقت مزامنة" value={formatDateTime(item.synced_at)} />
              </div>

              <Card className="p-3">
                <div className="mb-2 font-semibold">بيانات Batch</div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <DetailRow label="معرف المخزون" value={item.source_stock_id} />
                  <DetailRow label="معرف العلامة" value={item.brand_product_id} />
                  <DetailRow label="معرف المورد" value={item.supplier_id} />
                  <DetailRow label="معرف المادة" value={item.generic_ingredient_id} />
                </div>
              </Card>

              {canViewCost && (
                <Card className="p-3">
                  <div className="mb-2 font-semibold">الأسعار المسجلة</div>
                  <div className="grid grid-cols-3 gap-2">
                    <DetailRow label="سعر الشراء" value={money(item.cost_price)} />
                    <DetailRow label="سعر البيع" value={money(item.sale_price)} />
                    <DetailRow label="فرق السعر" value={spread === null ? "—" : money(spread)} />
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">تعرض الأسعار كما جاءت من PHIF كسعر وحدة مسجل، ولا يتم افتراض سعر العلبة أو الشريط.</div>
                </Card>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
