import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { ReportBackLink } from "@/components/management/ReportBackLink";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getPhifStockSummary, listPhifStockItems, syncPhifStock } from "@/lib/phif-stock.functions";
import { stockQuantityBreakdown } from "@/lib/phif-stock.helpers";
import { filterInventoryItems, inventoryAvailability, inventoryExpiry, inventoryExportRows, type InventoryMode, type LowStockUnit } from "@/lib/phif-inventory.helpers";
import { formatStockExpiry as formatExpiry, stockExpiryValue, stockScientificSubtitle } from "@/lib/phif-stock-details.helpers";
import { CalendarDays, Download, PackageSearch, RefreshCw, ShieldAlert, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/management/inventory")({
  component: InventoryPage,
  head: () => ({ meta: [{ title: "مخزون PHIF — PHIF Tracker" }, { name: "description", content: "المخزون الحالي لصيدلية التأمين" }, { property: "og:title", content: "مخزون PHIF — PHIF Tracker" }, { property: "og:description", content: "المخزون الحالي لصيدلية التأمين" }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
});

function formatDateTime(value: string | null | undefined) {
  if (!value) return "لا توجد مزامنة ناجحة بعد";
  return new Date(value).toLocaleString("ar-LY", { dateStyle: "medium", timeStyle: "short" });
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
  const [stockFilter, setStockFilter] = useState<InventoryMode>("available");
  const [lowThreshold, setLowThreshold] = useState("1");
  const [lowUnit, setLowUnit] = useState<LowStockUnit>("boxes");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expiryFilter, setExpiryFilter] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [formFilter, setFormFilter] = useState("all");
  const [selected, setSelected] = useState<any | null>(null);
  const summaryFn = useServerFn(getPhifStockSummary);
  const listFn = useServerFn(listPhifStockItems);
  const syncFn = useServerFn(syncPhifStock);

  const summary = useQuery({
    queryKey: ["phif_stock_summary"],
    queryFn: () => summaryFn(),
  });
  const items = useQuery({
    queryKey: ["phif_stock_items"],
    queryFn: () => listFn({ data: { query: "", limit: 5000 } }),
  });
  const sync = useMutation({
    mutationFn: () => syncFn(),
    onSuccess: (result: any) => {
      toast.success(`تمت مزامنة المخزون: ${result.imported_records} سجل جديد أو متغير`);
      qc.invalidateQueries({ queryKey: ["phif_stock_summary"] });
      qc.invalidateQueries({ queryKey: ["phif_stock_items"] });
      qc.invalidateQueries({ queryKey: ["items_analytics"] });
      qc.invalidateQueries({ queryKey: ["phif_connection_indicator"] });
      qc.invalidateQueries({ queryKey: ["phif_session_status"] });
    },
    onError: (error: any) => {
      toast.error(error?.message ?? "تعذرت مزامنة المخزون");
      qc.invalidateQueries({ queryKey: ["phif_stock_summary"] });
      qc.invalidateQueries({ queryKey: ["phif_connection_indicator"] });
    },
  });

  const lastRun = summary.data?.last_run;
  const canViewCost = summary.data?.can_view_cost === true;
  const allItems = items.data ?? [];
  const threshold = lowThreshold.trim() === "" || Number(lowThreshold) < 0 ? NaN : Number(lowThreshold);
  const extraFilterCount = [expiryFilter, supplierFilter, formFilter].filter(value => value !== "all").length;
  const supplierOptions = useMemo(() => [...new Set(allItems.map((item: any) => String(item.supplier_name ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar")), [allItems]);
  const formOptions = useMemo(() => [...new Set(allItems.map((item: any) => String(item.dosage_unit ?? item.source_quantity_unit ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar")), [allItems]);
  const filteredItems = useMemo(() => filterInventoryItems(allItems, {
    query, mode: stockFilter, lowThreshold: threshold, lowUnit,
    expiry: expiryFilter, supplier: supplierFilter, form: formFilter,
  }), [allItems, query, stockFilter, threshold, lowUnit, expiryFilter, supplierFilter, formFilter]);

  function exportInventory() {
    const rows = inventoryExportRows(filteredItems);
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "PHIF Inventory");
    XLSX.writeFile(workbook, "phif_inventory_filtered.xlsx");
  }

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
          أسعار الشراء مخفية من الخادم لهذه الجلسة، ولا تظهر إلا لمن يملك صلاحية عرض تكاليف Actual.
        </Card>
      )}

      <div className="space-y-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="font-semibold flex items-center gap-2">
            <PackageSearch className="h-5 w-5 text-primary" />
            الأصناف الحالية
          </div>
          <Input
            aria-label="بحث في المخزون"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="بحث بالاسم التجاري أو العلمي أو المورد أو التركيز"
            className="h-10"
            dir="rtl"
          />
          <Button type="button" variant="outline" onClick={exportInventory} disabled={filteredItems.length === 0}>
            <Download className="h-4 w-4 ml-2" />
            تصدير Excel
          </Button>
        </div>
        <ToggleGroup type="single" value={stockFilter} onValueChange={(value) => value && setStockFilter(value as InventoryMode)} dir="rtl" aria-label="حالة المخزون" className="grid grid-cols-4 gap-1 rounded-lg border bg-muted/40 p-1">
          {([["available", "المتوفر"], ["low", "المنخفض"], ["out", "النافد"], ["all", "الكل"]] as const).map(([value, label]) => (
            <ToggleGroupItem key={value} value={value} className="min-w-0 px-1 text-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">{label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{filteredItems.length.toLocaleString("ar-LY")} من {allItems.length.toLocaleString("ar-LY")} سجل تشغيلة</span>
          <Button variant="outline" size="sm" onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal className="ml-2 h-4 w-4" />فلاتر إضافية{extraFilterCount > 0 && <Badge variant="secondary" className="mr-2">{extraFilterCount}</Badge>}
          </Button>
        </div>
        {stockFilter === "low" && (
          <div className="rounded-lg border bg-amber-50/50 p-3 space-y-2">
            <Label htmlFor="low-stock-threshold">حد الكمية المنخفضة لكل تشغيلة</Label>
            <div className="flex gap-2">
              <Input id="low-stock-threshold" type="number" min="0" step="any" value={lowThreshold} onChange={event => setLowThreshold(event.target.value)} className="min-w-0 flex-1" aria-invalid={!Number.isFinite(threshold)} />
              <select aria-label="وحدة حد المخزون المنخفض" value={lowUnit} onChange={event => setLowUnit(event.target.value as LowStockUnit)} className="h-10 rounded-md border bg-background px-2 text-sm">
                <option value="boxes">علبة</option><option value="units">وحدة مخزون</option>
              </select>
            </div>
            {!Number.isFinite(threshold) && <p role="alert" className="text-xs text-destructive">أدخل حدًا صحيحًا لا يقل عن صفر</p>}
            {lowUnit === "boxes" && <p className="text-xs text-muted-foreground">السجلات دون بيانات تعبئة لا تُصنّف منخفضة بالعلب.</p>}
          </div>
        )}
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto sm:mx-auto sm:max-w-lg" dir="rtl">
            <SheetHeader className="text-right"><SheetTitle>فلاتر إضافية</SheetTitle></SheetHeader>
            <div className="mt-4 grid gap-3">
              <Label htmlFor="stock-expiry-filter">الصلاحية</Label>
              <select id="stock-expiry-filter" value={expiryFilter} onChange={(event) => setExpiryFilter(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm">
                <option value="all">كل الصلاحيات</option>
                <option value="valid">صالحة</option>
                <option value="soon">قريبة الانتهاء</option>
                <option value="expired">منتهية</option>
                <option value="missing">غير مسجلة / تحتاج مراجعة</option>
              </select>
              <Label htmlFor="stock-supplier-filter">المورد</Label>
              <select id="stock-supplier-filter" value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm">
                <option value="all">كل الموردين</option>
                {supplierOptions.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
              </select>
              <Label htmlFor="stock-form-filter">الشكل الدوائي</Label>
              <select id="stock-form-filter" value={formFilter} onChange={(event) => setFormFilter(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm">
                <option value="all">كل الأشكال</option>
                {formOptions.map((form) => <option key={form} value={form}>{form}</option>)}
              </select>
              <div className="flex gap-2 pt-2">
                <Button className="flex-1" onClick={() => setFiltersOpen(false)}>عرض النتائج</Button>
                <Button variant="outline" onClick={() => { setExpiryFilter("all"); setSupplierFilter("all"); setFormFilter("all"); }}>مسح الفلاتر</Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        {items.isLoading && <div className="p-4 text-center text-muted-foreground">جاري التحميل...</div>}
        {items.isError && <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">تعذر تحميل المخزون. <Button variant="link" onClick={() => items.refetch()}>إعادة المحاولة</Button></div>}
        {!items.isLoading && !items.isError && filteredItems.length === 0 && (
          <div className="p-6 text-center text-muted-foreground">لا توجد سجلات مخزون مطابقة</div>
        )}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {filteredItems.map((item: any) => (
            <StockCard key={item.id} item={item} threshold={threshold} lowUnit={lowUnit} onOpen={() => setSelected(item)} />
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

function stockCardTitle(item: any) {
  const parts = [item.brand_name || item.active_ingredient || "صنف غير مسمى"];
  const aliases: Record<string, string> = {
    tablet: "tab", tablets: "tab", tabs: "tab",
    capsules: "cap", capsule: "cap", caps: "cap",
    injection: "inj", injections: "inj",
  };
  const tokens = (value: string) => value.toLowerCase()
    .match(/[\p{L}]+|\d+(?:\.\d+)?|\//gu)?.map(token => aliases[token] ?? token) ?? [];
  for (const value of [item.strength, item.dosage_unit]) {
    if (!value) continue;
    const titleTokens = tokens(parts.join(" "));
    const valueTokens = tokens(String(value));
    const alreadyShown = valueTokens.length > 0 && titleTokens.some((_, index) => valueTokens.every((token, offset) => titleTokens[index + offset] === token));
    if (!alreadyShown) parts.push(String(value));
  }
  return parts.join(" ");
}

function StockCard({ item, threshold, lowUnit, onOpen }: { item: any; threshold: number; lowUnit: LowStockUnit; onOpen: () => void }) {
  const quantity = stockQuantityBreakdown(item.stock_quantity, item.strips_quantity, item.source_quantity_unit ?? "وحدة");
  const availability = inventoryAvailability(item, threshold, lowUnit);
  const quantityDisplay = availability.status === "unknown" ? { primary: "غير مسجلة", secondary: null } : compactQuantityDisplay(quantity);
  const expiry = formatExpiry(stockExpiryValue(item));
  const expiryInfo = inventoryExpiry(item);
  const scientificSubtitle = stockScientificSubtitle(item);
  const displayTitle = stockCardTitle(item);
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
      className={`min-w-0 rounded-lg border p-3 text-right shadow-sm transition hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${tone}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div dir="auto" className="break-words text-[15px] font-semibold leading-5 text-foreground">{displayTitle}</div>
          {scientificSubtitle && <div dir="auto" className="mt-1 break-words text-xs text-muted-foreground">{scientificSubtitle}</div>}
          {availability.status !== "available" && (
            <Badge variant={availability.tone === "danger" ? "destructive" : "secondary"} className="mt-2 h-5 px-2 text-[11px]">
              {availability.label}
            </Badge>
          )}
        </div>

        <div className="max-w-[42%] shrink-0 text-left">
          <div className={`break-words text-lg font-bold leading-6 ${quantityTone}`}>{quantityDisplay.primary}</div>
          {quantityDisplay.secondary && (
            <div className="mt-1 inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">
              {quantityDisplay.secondary}
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-current/10 pt-2 text-xs">
        <span className="min-w-0 break-all text-muted-foreground">التشغيلة: <bdi>{item.batch_number || "غير مسجلة"}</bdi></span>
        <span className={`inline-flex max-w-full items-center gap-1 rounded-md px-2 py-1 ${expiryInfo.tone === "danger" ? "bg-red-100 text-red-700" : expiryInfo.tone === "warning" ? "bg-amber-100 text-amber-700" : expiryInfo.tone === "success" ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span>{expiry ? `${expiry} · ${expiryInfo.label}` : expiryInfo.label}</span>
        </span>
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
  const quantity = item ? stockQuantityBreakdown(item.stock_quantity, item.strips_quantity, item.source_quantity_unit ?? "وحدة") : null;
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
                <DetailRow label="المادة العلمية" value={item.active_ingredient} />
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
                <DetailRow label="تاريخ الصلاحية" value={formatExpiry(stockExpiryValue(item)) ?? inventoryExpiry(item).label} />
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
