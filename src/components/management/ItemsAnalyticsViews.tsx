import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownWideNarrow, ArrowRight, Download, Loader2, RefreshCw, Search, Settings2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ReportBackLink } from "./ReportBackLink";
import { SupplierPriceBasisEditor } from "./SupplierPriceBasisEditor";
import { SupplierReportUnitEditor } from "./SupplierReportUnitEditor";
import { getItemsAnalytics, saveReportBoxSetting } from "@/lib/items-analytics.functions";
import { ACTUAL_UNITS, actualUnit, type ActualUnit } from "@/lib/actual-units.helpers";
import {
  analyticsSearchSchema,
  type AnalyticsFilters,
  type AnalyticsRow,
} from "@/lib/items-analytics.helpers";
import {
  movementMatches,
  selectAnalyticsRows,
  summaryScope,
  type AnalyticsView,
} from "@/lib/items-analytics-export";
import { useSession } from "@/lib/queries";
import { itemsAnalyticsCacheOptions, itemsAnalyticsScope } from "@/lib/items-analytics-cache.helpers";
import { REPORT_BOX_REASONS } from "@/lib/report-box-quantity.helpers";
import { REPORT_REVIEW_FORMS, reportReviewIdentity, reportReviewRequest } from "@/lib/report-identity-review.helpers";
import {
  reportSettingRequest,
  refreshReportAfterSettingSave,
} from "@/lib/report-setting-save.helpers";
import { itemReportReturn, openItemIdentityReview, reportItemAnchor, reportReviewTarget, restoreItemReportPosition, type ItemReportReturn } from "@/lib/report-review-navigation.helpers";
import { reportSettingKey } from "@/lib/report-medication-evidence.helpers";

const money = (v: number | null | undefined) =>
  v == null
    ? "غير مكتمل / محجوب"
    : `${Number(v).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} د.ل`;
const number = (v: number | null | undefined) =>
  v == null ? "غير محدد" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 4 });
const titles: Record<AnalyticsView, string> = {
  consumption: "تقرير الأصناف والاستهلاك",
  items: "ربحية الأصناف",
  invoices: "ربحية الفواتير",
  beneficiaries: "ربحية المستفيدين",
};
const sources = { actual: "Actual", phif: "PHIF Supplier" };
export function ReportBoxQuantities({ row }: { row: any }) {
  const actualIssues: string[] = row.actualBoxIssues || [];
  const phifIssues: string[] = row.phifBoxIssues || [];
  const totalIssues: string[] = (row.boxIssues || []).filter((reason: string) =>
    !actualIssues.includes(reason) && !phifIssues.includes(reason));
  return (
    <div className="min-w-0 space-y-1">
      <div className="grid grid-cols-3 gap-2 text-xs">
        {[
          ["Actual", row.actualBoxes],
          ["PHIF Supplier", row.phifBoxes],
          ["الإجمالي", row.boxes],
        ].map(([label, value]) => (
          <div key={label as string} className="min-w-0 break-words">
            <span className="text-muted-foreground">{label}</span>
            <strong className="mt-1 block text-sm">
              {value == null ? "غير محدد" : `${number(value as number)} علبة`}
            </strong>
          </div>
        ))}
      </div>
      {[["Actual", actualIssues], ["PHIF Supplier", phifIssues], ["الإجمالي", totalIssues]]
        .map(([label, reasons]) => (reasons as string[]).length > 0 && (
          <p key={label as string} className="break-words text-[11px] leading-5 text-amber-800">
            {label}: {(reasons as string[]).map(reason => REPORT_BOX_REASONS[reason] || "التحويل يحتاج مراجعة").join("؛ ")}
          </p>
        ))}
    </div>
  );
}

function Options({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="min-w-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, t]) => (
          <SelectItem key={v} value={v}>
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function ItemTitle({ item }: { item: any }) {
  return (
    <h2 className="min-w-0 break-words font-bold leading-6" dir="auto">
      <bdi>{item.ingredient}</bdi>
      {item.strength && (
        <>
          {" "}
          <span
            dir="ltr"
            className="inline-block max-w-full rounded-md border border-primary/20 bg-accent px-1.5 py-0.5 align-middle text-xs font-semibold text-primary [overflow-wrap:anywhere]"
          >
            {item.strength}
          </span>
        </>
      )}
      {item.form && (
        <span className="mx-1 inline text-xs font-normal text-muted-foreground">{item.form}</span>
      )}
    </h2>
  );
}
export function ItemIdentityReviewAction({ item, onReview }: { item: any; onReview: (item: any) => void }) {
  if (item.latestSale?.price != null) return null;
  return <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => onReview(item)}>
    <Settings2 className="size-4" />مراجعة الهوية
  </Button>;
}
function Finance({ row, profitLabel = "الربح / الخسارة" }: { row: any; profitLabel?: string }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-2 text-xs sm:grid-cols-4">
      <div>
        قيمة البيع<strong className="block break-words">{money(row.revenue)}</strong>
      </div>
      <div>
        تكلفة الشراء<strong className="block break-words">{money(row.cost)}</strong>
      </div>
      <div>
        {profitLabel}
        <strong
          className={`block break-words ${row.profit == null ? "text-amber-700" : row.profit < 0 ? "text-red-700" : "text-emerald-700"}`}
        >
          {money(row.profit)}
        </strong>
      </div>
      <div>
        نسبة الربح
        <strong className="block">{row.margin == null ? "—" : `${number(row.margin)}%`}</strong>
      </div>
      {!row.complete && (
        <p className="col-span-full text-amber-700">
          تكلفة غير مكتملة أو بيانات محجوبة بالصلاحيات؛ لا يُعرض ربح نهائي.
        </p>
      )}
    </div>
  );
}
export function ReportIdentityReview({
  items,
  canManage,
  settingsAvailable,
  hasFilters,
  onEdit,
  onSelect,
  onShowAll,
}: {
  items: any[];
  canManage: boolean;
  settingsAvailable: boolean;
  hasFilters: boolean;
  onEdit: (item: any) => void;
  onSelect: (item: any) => void;
  onShowAll: () => void;
}) {
  return (
    <section aria-label="مراجعة هوية الأصناف" className="min-w-0 border-b py-3">
      <details open={items.length > 0}>
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          مراجعة هوية الأصناف ({items.length})
        </summary>
        <p className="py-2 text-xs text-muted-foreground">
          {items.length
            ? "حالات ضمن الفلاتر الحالية؛ افتح الصنف لمراجعة تعريفه."
            : "لا توجد حالات مراجعة ضمن الفلاتر الحالية."}
        </p>
        {hasFilters && (
          <Button type="button" variant="outline" size="sm" className="mb-2" onClick={onShowAll}>
            عرض المراجعة دون فلاتر
          </Button>
        )}
        {items.map(item => {
          const canEdit = canManage && settingsAvailable && item.sources?.includes("phif") && !item.settingConflict;
          return (
            <button
              key={item.id}
              type="button"
              className="block w-full border-t py-2 text-right text-sm"
              onClick={() => canEdit ? onEdit(item) : onSelect(item)}
            >
              <bdi>{item.ingredient} · {item.strength}</bdi>
              <span className="block text-xs text-muted-foreground">
                {item.dispenseCount} بند · {item.identityReviewReason || "هوية غير مكتملة"} ·{" "}
                {canEdit ? "تعديل التعريف" : "عرض التفاصيل"}
              </span>
            </button>
          );
        })}
      </details>
    </section>
  );
}

export function BoxEditor({
  item,
  rows,
  unitsAvailable,
  reportKey,
  onClose,
  onSaved,
  returnToReport = false,
}: {
  item: any;
  rows: AnalyticsRow[];
  unitsAvailable: boolean;
  reportKey: readonly unknown[];
  onClose: () => void;
  onSaved?: (setting: { item_identity: string }) => void;
  returnToReport?: boolean;
}) {
  const reviewing = item.identityComplete === false;
  const [form, setForm] = useState(item.form || "");
  const [count, setCount] = useState(String(item.setting?.units_per_box ?? ""));
  const [unit, setUnit] = useState<ActualUnit | "">(
    item.setting?.base_unit ?? actualUnit(item.form) ?? "",
  );
  const client = useQueryClient();
  const reviewItemId = rows.find(r => r.source === "phif")?.id;
  const reviewRequest = reviewing ? reportReviewRequest(item, form, count, unit, reviewItemId) : null;
  const saveLock = useRef(false);
  const [unitSaving, setUnitSaving] = useState(false);
  const save = useMutation({
    mutationFn: () => {
      if (reviewing && !reviewRequest) throw new Error("أكمل الشكل الدوائي وحجم العبوة ووحدة محتواها أولًا");
      return reportSettingRequest(() =>
        saveReportBoxSetting({
          data: reviewRequest || {
            identity: item.id,
            unitsPerBox: Number(count),
            baseUnit: unit as ActualUnit,
            version: item.setting?.version ?? 0,
          },
        }),
      );
    },
    onSuccess: (saved) => {
      onSaved?.(saved);
      toast.success(reviewing ? "تم حفظ تعريف الصنف وحجم عبوة PHIF Supplier" : "تم حفظ حجم العلبة");
      refreshReportAfterSettingSave(client, reportKey, () =>
        toast.error("حُفظ حجم العلبة، لكن تعذر تحديث التقرير. اضغط تحديث."),
        onClose,
      );
    },
  });
  return (
    <Sheet open onOpenChange={(open) => !open && !save.isPending && !unitSaving && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[90dvh] overflow-y-auto rounded-t-lg p-4 pt-10 sm:mx-auto sm:max-w-lg"
        dir="rtl"
      >
        <SheetHeader>
          <SheetTitle>{reviewing ? "تعريف صنف PHIF Supplier" : "إعدادات علبة ووحدة PHIF Supplier"}</SheetTitle>
          <SheetDescription>
            {item.ingredient} · {item.strength} · {item.form}
          </SheetDescription>
        </SheetHeader>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!saveLock.current && !save.isPending && !unitSaving && (!reviewing || reviewRequest)) {
              saveLock.current = true;
              save.mutate(undefined, {
                onSettled: () => {
                  saveLock.current = false;
                },
              });
            }
          }}
        >
          {reviewing && (
            <div className="space-y-2">
              <span className="block text-sm">الشكل الدوائي</span>
              <Options
                label="الشكل الدوائي"
                value={form}
                onChange={(value) => {
                  setForm(value);
                  setUnit(actualUnit(value) || (unit === actualUnit(form) ? "" : unit));
                }}
                options={REPORT_REVIEW_FORMS}
              />
              <p className="text-xs text-muted-foreground">
                يُستكمل الشكل الناقص لفواتير PHIF Supplier المطابقة، السابقة والجديدة. لا تُستبدل الأشكال الصريحة المختلفة، ولا تُعتمد وحدة الصرف تلقائيًا.
              </p>
              {!reportReviewIdentity(item.id, form || "tablet") && (
                <p role="alert" className="text-xs text-amber-800">
                  المادة العلمية أو التركيز ناقص؛ لا يمكن حل هذه الحالة بتحديد الشكل وحجم العبوة فقط.
                </p>
              )}
            </div>
          )}
          {reviewing && !reviewItemId && <p role="alert" className="text-xs text-amber-800">لا يوجد بند PHIF Supplier مؤهل لتوثيق هذا التعريف. لن تتغير بيانات Actual.</p>}
          <label className="block text-sm">
            عدد الوحدات في العلبة
            <Input
              autoFocus
              type="number"
              min="1"
              max="10000"
              step="1"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              required
            />
          </label>
          <Options
            label="وحدة محتوى العلبة"
            value={unit}
            onChange={(v) => setUnit(v as ActualUnit)}
            options={
              Object.entries(ACTUAL_UNITS).filter(([k]) => k !== "box" && k !== "strip") as [
                string,
                string,
              ][]
            }
          />
          <p className="text-xs text-muted-foreground">
            خاص بـPHIF Supplier فقط. لا يغيّر كمية الفاتورة أو بيانات Actual أو أي تكلفة محفوظة.
          </p>
          {save.error && (
            <p role="alert" className="text-sm text-destructive">
              {(save.error as Error).message}
            </p>
          )}
          <Button
            type="submit"
            disabled={
              save.isPending || unitSaving || !unit || !Number.isInteger(Number(count)) || Number(count) < 1
              || Number(count) > 10000 || (reviewing && !reviewRequest)
            }
          >
            {save.isPending && <Loader2 className="size-4 animate-spin" />}حفظ
          </Button>
        </form>
        {!reviewing && <div className="mt-4">
          <SupplierReportUnitEditor
            item={item}
            rows={rows}
            available={unitsAvailable}
            reportKey={reportKey}
            onSavingChange={setUnitSaving}
            disabled={save.isPending}
          />
        </div>}
        {returnToReport && <Button type="button" variant="outline" className="mt-4 w-full" disabled={save.isPending || unitSaving} onClick={onClose}>
          <ArrowRight className="size-4" />الرجوع إلى الصنف في التقرير
        </Button>}
      </SheetContent>
    </Sheet>
  );
}

function Movements({ rows }: { rows: AnalyticsRow[] }) {
  const [source, setSource] = useState("all"),
    [month, setMonth] = useState("all"),
    [order, setOrder] = useState("date_desc");
  const shown = rows
    .filter(
      (r) =>
        (source === "all" || r.source === source) && (month === "all" || r.date.startsWith(month)),
    )
    .sort((a, b) =>
      order === "loss"
        ? (a.profit ?? Infinity) - (b.profit ?? Infinity)
        : order === "date_asc"
          ? a.date.localeCompare(b.date)
          : b.date.localeCompare(a.date),
    );
  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Options
          label="مصدر السجل"
          value={source}
          onChange={setSource}
          options={[
            ["all", "كل المصادر"],
            ["actual", "Actual"],
            ["phif", "PHIF Supplier"],
          ]}
        />
        <Options
          label="شهر السجل"
          value={month}
          onChange={setMonth}
          options={[
            ["all", "كل الأشهر"],
            ...[...new Set(rows.map((r) => r.date.slice(0, 7)))]
              .sort()
              .reverse()
              .map((m) => [m, m] as [string, string]),
          ]}
        />
        <Options
          label="ترتيب السجل"
          value={order}
          onChange={setOrder}
          options={[
            ["date_desc", "الأحدث"],
            ["date_asc", "الأقدم"],
            ["loss", "الخسائر أولًا"],
          ]}
        />
      </div>
      {shown.map((r) => (
        <article
          key={r.id}
          className={`space-y-2 border-b py-3 ${r.profit != null && r.profit < 0 ? "border-red-200 bg-red-50/40" : ""}`}
        >
          <p className="break-words font-semibold">
            {r.ingredient} · {r.strength}
          </p>
          <p className="text-sm">
            {r.beneficiary || "المستفيد محجوب بالصلاحيات"}{" "}
            <bdi className="text-xs text-muted-foreground">{r.card}</bdi>
          </p>
          <p className="text-xs text-muted-foreground">
            فاتورة {r.invoiceNumber || "—"} · {r.date} · {sources[r.source]}
            {r.manualMatch && " · مطابقة يدوية"}
          </p>
          {r.brand && (
            <p dir="auto" className="break-words text-xs text-muted-foreground">
              {r.brand}
            </p>
          )}
          <p className="text-sm">
            {number(r.quantity)} {r.unit ? ACTUAL_UNITS[r.unit] : "وحدة غير موثقة"} ·{" "}
            {r.boxes == null ? REPORT_BOX_REASONS[r.boxIssue || ""] || "التحويل إلى علب غير موثق" : `${number(r.boxes)} علبة`}
            {r.source === "phif" && r.unit && r.unitProvenance && r.unitProvenance !== "source" && <span className="mr-1 text-xs text-teal-800">وحدة موثقة يدويًا</span>}
          </p>
          {r.source === "actual" && r.boxSize && r.baseUnit && (
            <p className="text-xs text-muted-foreground">
              عبوة Actual: {number(r.boxSize)} {ACTUAL_UNITS[r.baseUnit]} / علبة
            </p>
          )}
          <Finance
            row={{
              revenue: r.revenue,
              cost: r.cost,
              profit: r.profit,
              complete: r.profit != null && r.cost != null,
              margin: r.profit != null && r.revenue ? (r.profit / r.revenue) * 100 : null,
            }}
          />
          {r.source === "phif" && r.canEditCost && (
            <SupplierPriceBasisEditor
              itemId={r.id}
              label={`${r.ingredient} · ${r.strength} · فاتورة ${r.invoiceNumber || "—"}`}
              unit={r.unit}
              savedBasis={r.supplierBasis}
              quantity={r.quantity}
              reportingBox={r.reportingBox}
            />
          )}
          {r.source === "actual" && (
            <p className="text-xs text-muted-foreground">
              تكلفة Actual وفق سعر المخزون المتاح، وليست سعرًا تاريخيًا مثبتًا.
            </p>
          )}
        </article>
      ))}
      {!shown.length && (
        <p className="py-6 text-center text-sm text-muted-foreground">لا توجد حركات مطابقة</p>
      )}
    </div>
  );
}

export function ItemsAnalyticsPage({ view = "consumption", reviewIdentityId }: { view?: AnalyticsView; reviewIdentityId?: string }) {
  const session = useSession();
  if (session.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        تعذر التحقق من الجلسة الحالية
      </p>
    );
  if (!session.data?.unlocked)
    return (
      <p role="status" className="py-8 text-center text-sm">
        جارٍ التحقق من الجلسة
      </p>
    );
  const scope = itemsAnalyticsScope(session.data)!;
  if (reviewIdentityId) return <ItemIdentityReviewBody key={`${scope}:${reviewIdentityId}`} scope={scope} identityId={reviewIdentityId} />;
  return <ItemsAnalyticsBody key={scope} view={view} scope={scope} />;
}

function ItemIdentityReviewBody({ scope, identityId }: { scope: string; identityId: string }) {
  const filters = analyticsSearchSchema.parse(useSearch({ strict: false }));
  const state = useLocation({ select: location => location.state }) as any;
  const navigate = useNavigate();
  const context = itemReportReturn(state?.itemReportReturn, scope, filters);
  const targetId = useRef(identityId);
  // Read both permitted sources for this exact identity; retain the original report filters for return.
  const reviewFilters = { ...filters, source: "all" as const };
  const reportKey = ["items_analytics", scope, "consumption", reviewFilters] as const;
  const report = useQuery({ ...itemsAnalyticsCacheOptions, queryKey: reportKey,
    queryFn: () => getItemsAnalytics({ data: { ...reviewFilters, financial: false, export: false } }),
  });
  const item = report.data ? reportReviewTarget(report.data, identityId) : null;
  const back = () => navigate({ to: "/management/reports/items", search: filters, resetScroll: false,
    state: { itemReportReturn: { ...(context || { scope, filters, scrollY: 0, cardTop: null, limit: 40 }),
      identityId: targetId.current === identityId ? item?.id || identityId : targetId.current } },
  } as any);
  return <div dir="rtl" className="min-w-0 space-y-3">
    <Button type="button" variant="outline" onClick={() => void back()}><ArrowRight className="size-4" />الرجوع إلى التقرير</Button>
    <h1 className="text-xl font-bold">مراجعة هوية الأصناف</h1>
    {report.isLoading && <p role="status">جارٍ تحميل تعريف الصنف</p>}
    {report.error && <div role="alert" className="space-y-2 text-sm text-destructive">
      <p>تعذر تحديث تعريف الصنف. أعد المحاولة قبل الحفظ.</p>
      <Button type="button" variant="outline" disabled={report.isFetching} onClick={() => void report.refetch()}><RefreshCw className="size-4" />إعادة المحاولة</Button>
    </div>}
    {item && <ItemTitle item={item} />}
    {report.data && !item && <p role="alert" className="text-sm text-amber-800">لم يعد معرّف الصنف متاحًا ضمن صلاحياتك وفلاتر التقرير؛ لم يُنشأ تعريف بديل.</p>}
    {item && (!report.data?.canManageBoxes || !report.data?.settingsAvailable || item.settingConflict) && <p role="alert" className="text-sm text-amber-800">
      {!report.data?.canManageBoxes ? "تعديل التعريف متاح لحساب المدير فقط."
        : item.settingConflict ? "توجد إعدادات متعارضة لهذا الصنف؛ لم يُستبدل أي تعريف."
          : "حفظ إعدادات الأصناف غير متاح حاليًا."}
    </p>}
    {item && !report.error && report.data?.canManageBoxes && report.data.settingsAvailable && !item.settingConflict && <BoxEditor
      key={`${item.id}:${item.setting?.version ?? 0}`}
      item={item} rows={report.data.historyMovements.filter(row => row.identity === item.id)}
      reportKey={reportKey} unitsAvailable={report.data.supplierUnitsAvailable} returnToReport
      onSaved={saved => { targetId.current = reportSettingKey(saved.item_identity) || item.id; }} onClose={() => void back()}
    />}
  </div>;
}

function ItemsAnalyticsBody({ view, scope }: { view: AnalyticsView; scope: string }) {
  const filters = analyticsSearchSchema.parse(useSearch({ strict: false }));
  const navigate = useNavigate();
  const state = useLocation({ select: location => location.state }) as any;
  const returnContext = itemReportReturn(state?.itemReportReturn, scope, filters);
  const positionRestored = useRef(false);
  const navigationPending = useRef(false);
  const [search, setSearch] = useState(filters.q);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestFilters = useRef(filters);
  latestFilters.current = filters;
  useEffect(() => {
    setSearch(filters.q);
  }, [filters.q]);
  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );
  const [selected, setSelected] = useState<any>(null),
    [editing, setEditing] = useState<any>(null),
    [limit, setLimit] = useState(returnContext?.limit || 40),
    [exporting, setExporting] = useState(false);
  const change = (patch: Partial<AnalyticsFilters>) => {
    setLimit(40);
    navigate({ to: ".", search: { ...filters, ...patch }, replace: true } as any);
  };
  const reportReceivedAt = useRef<number | null>(null);
  const report = useQuery({
    ...itemsAnalyticsCacheOptions,
    queryKey: ["items_analytics", scope, view, filters],
    queryFn: async () => {
      const data = await getItemsAnalytics({ data: { ...filters, financial: view !== "consumption", export: false } });
      reportReceivedAt.current = performance.now();
      return data;
    },
  });
  useEffect(() => {
    if (reportReceivedAt.current != null) {
      console.info("phif_report_setting_client_timing", { phase: "report_ui_commit", ms: Math.round(performance.now() - reportReceivedAt.current) });
      reportReceivedAt.current = null;
    }
  }, [report.dataUpdatedAt]);
  const shown = useMemo(
    () => (report.data ? selectAnalyticsRows(report.data, view, filters) : []),
    [report.data, view, JSON.stringify(filters)],
  );
  useEffect(() => {
    if (!returnContext || !report.data || positionRestored.current) return;
    const index = shown.findIndex(row => row.id === returnContext.identityId);
    if (index >= limit) { setLimit(index + 1); return; }
    const frame = requestAnimationFrame(() => {
      restoreItemReportPosition(returnContext, document.getElementById(reportItemAnchor(returnContext.identityId)),
        window.scrollY, y => window.scrollTo({ top: y, behavior: "instant" }));
      if (!report.isFetching) positionRestored.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [JSON.stringify(returnContext), report.data, report.isFetching, shown, limit]);
  const reviewIdentity = (row: any) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const element = document.getElementById(reportItemAnchor(row.id));
    const context: ItemReportReturn = { scope, filters, identityId: row.id, scrollY: window.scrollY,
      cardTop: element?.getBoundingClientRect().top ?? null, limit };
    if (navigationPending.current) return;
    navigationPending.current = true;
    void openItemIdentityReview(navigate as any, context)
      .catch(() => toast.error("تعذر فتح مراجعة الصنف"))
      .finally(() => { navigationPending.current = false; });
  };
  const selectedRows = useMemo(
    () =>
      selected && report.data
        ? (view === "consumption" || view === "items"
            ? report.data.historyMovements
            : report.data.movements
          ).filter((r) => movementMatches(r, selected, view))
        : [],
    [selected, report.data, view],
  );
  const summaryItemScope = useMemo(
    () => (report.data ? summaryScope(report.data) : null),
    [report.data],
  );
  async function exportExcel() {
    if (exporting) return;
    setExporting(true);
    try {
      const fresh = await getItemsAnalytics({
        data: { ...filters, financial: view !== "consumption", export: true },
      });
      const { buildAnalyticsWorkbook } = await import("@/lib/items-analytics-export");
      const XLSX = await import("xlsx");
      XLSX.writeFile(
        await buildAnalyticsWorkbook(fresh, view, filters),
        `phif-${view}-${filters.month}.xlsx`,
      );
    } catch (error) {
      toast.error((error as Error).message || "تعذر تصدير التقرير");
    } finally {
      setExporting(false);
    }
  }
  return (
    <div dir="rtl" className="min-w-0 space-y-4">
      <header className="min-w-0 space-y-3">
        <ReportBackLink to="/management/reports" label="مركز التقارير" />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <h1 className="min-w-0 text-xl font-bold leading-8">{titles[view]}</h1>
          {view === "consumption" && <div className="flex shrink-0 gap-1">
            <Button size="icon" variant="ghost" title="تحديث التقرير" aria-label="تحديث التقرير" disabled={report.isFetching} onClick={() => report.refetch()}>
              <RefreshCw className={`size-4 ${report.isFetching ? "animate-spin" : ""}`} />
            </Button>
            <Button size="icon" variant="ghost" title="تصدير Excel" aria-label="تصدير Excel" onClick={exportExcel} disabled={!report.data?.canExport || exporting}>
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            </Button>
          </div>}
        </div>
        {view === "consumption" && <p className="text-xs text-muted-foreground">
          {filters.month === "all" ? "كل التاريخ" : new Intl.DateTimeFormat("ar-LY", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${filters.month}-01T12:00:00Z`))}
          {" · "}{filters.source === "all" ? "كل المصادر" : sources[filters.source]}
        </p>}
      </header>
      {view !== "consumption" && <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
        <Input
          type="month"
          aria-label="الشهر والسنة"
          value={filters.month === "all" ? "" : filters.month}
          onChange={(e) => change({ month: e.target.value || "all" })}
          className="min-w-0"
        />
        <Options
          label="المصدر"
          value={filters.source}
          onChange={(v) => change({ source: v as AnalyticsFilters["source"] })}
          options={[
            ["all", "الكل"],
            ["actual", "Actual"],
            ["phif", "PHIF Supplier"],
          ]}
        />
        <Button
          variant={filters.month === "all" ? "default" : "outline"}
          onClick={() => change({ month: "all" })}
        >
          كل التاريخ
        </Button>
        <Button variant="outline" disabled={report.isFetching} onClick={() => report.refetch()}>
          <RefreshCw className={`size-4 ${report.isFetching ? "animate-spin" : ""}`} />
          تحديث
        </Button>
      </div>}
      <div className="relative">
        <Search className="absolute right-3 top-3 size-4 text-muted-foreground" />
        <Input
          aria-label="البحث العلمي والتركيز"
          placeholder="الاسم العلمي أو التركيز"
          value={search}
          onChange={(e) => {
            const value = e.target.value;
            setSearch(value);
            if (searchTimer.current) clearTimeout(searchTimer.current);
            searchTimer.current = setTimeout(() => {
              setLimit(40);
              navigate({
                to: ".",
                search: { ...latestFilters.current, q: value },
                replace: true,
              } as any);
            }, 300);
          }}
          className="pr-9"
        />
      </div>
      {view === "consumption" && <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="relative min-w-0">
          <ArrowDownWideNarrow className="pointer-events-none absolute right-3 top-3 z-10 size-4 text-primary" />
          <Select value={["consumption_desc", "consumption_asc", "beneficiaries_desc", "name_asc"].includes(filters.sort) ? filters.sort : "consumption_desc"} onValueChange={(sort) => change({ sort: sort as AnalyticsFilters["sort"] })}>
            <SelectTrigger aria-label="ترتيب الاستهلاك" className="min-w-0 pr-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="consumption_desc">الأكثر استهلاكًا بالعلب</SelectItem>
              <SelectItem value="consumption_asc">الأقل استهلاكًا بالعلب</SelectItem>
              <SelectItem value="beneficiaries_desc">الأكثر حسب عدد المستفيدين</SelectItem>
              <SelectItem value="name_asc">الاسم العلمي</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" className="shrink-0" onClick={() => setFiltersOpen(true)}>
          <SlidersHorizontal className="size-4" />الفلاتر
        </Button>
      </div>}
      {view !== "consumption" && (
        <div className="grid grid-cols-2 gap-2">
          <Options
            label="حالة الربح"
            value={filters.result}
            onChange={(v) => change({ result: v as AnalyticsFilters["result"] })}
            options={[
              ["all", "كل الحالات"],
              ["loss", "الخاسرة"],
              ["zero", "ربح صفري"],
              ["positive", "الرابحة"],
              ["incomplete", "تكلفة غير مكتملة"],
            ]}
          />
          <Options
            label="ترتيب الربحية"
            value={filters.sort}
            onChange={(v) => change({ sort: v as AnalyticsFilters["sort"] })}
            options={[
              ["profit_asc", "الأقل ربحًا / الأكثر خسارة"],
              ["profit_desc", "الأعلى ربحًا"],
              ["sale_desc", "أعلى قيمة بيع"],
              ["date_desc", "الأحدث"],
            ]}
          />
          {view === "beneficiaries" && (
            <Options
              label="نوع ربح المستفيد"
              value={filters.mode}
              onChange={(v) => change({ mode: v as AnalyticsFilters["mode"] })}
              options={[
                ["cumulative", "الربح التراكمي"],
                ["single", "أعلى ربح فاتورة منفردة"],
              ]}
            />
          )}
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b pb-3 text-xs text-muted-foreground">
        <span>{shown.length} {view === "consumption" ? "صنف" : "نتيجة"}</span>
        {view === "consumption" ? <span>الاستهلاك خلال الفترة المحددة</span> : <Button
          size="sm"
          variant="outline"
          onClick={exportExcel}
          disabled={!report.data?.canExport || exporting}
        >
          <Download className="size-4" />
          {exporting ? "جارٍ التصدير" : "تصدير Excel"}
        </Button>}
      </div>
      {report.isLoading && (
        <p role="status" className="flex items-center justify-center gap-2 py-8 text-sm">
          <Loader2 className="size-4 animate-spin" />
          جارٍ تحميل التقرير
        </p>
      )}
      {report.data && report.isFetching && (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          جارٍ تحديث نتائج التقرير
        </p>
      )}
      {report.error && (
        <p role="alert" className="border-y py-6 text-sm text-destructive">
          {report.data && "تعذر تحديث النتائج؛ البيانات المعروضة من آخر تحميل ناجح. "}
          {(report.error as Error).message || "تعذر تحميل التقرير"}
        </p>
      )}
      {report.data && (
        <>
          {!report.data.settingsAvailable && view === "consumption" && (
            <p className="border-y border-amber-200 py-2 text-xs text-amber-800">
              حفظ حجم العلبة غير مفعّل: يلزم اعتماد وتطبيق ترحيل الإعدادات. لا تُعرض تحويلات غير
              موثقة.
            </p>
          )}
          {(view === "consumption" || view === "items") && (
            <ReportIdentityReview
              items={report.data.reviewItems}
              canManage={report.data.canManageBoxes}
              settingsAvailable={report.data.settingsAvailable}
              hasFilters={filters.month !== "all" || filters.source !== "all" || Boolean(filters.q.trim())}
              onEdit={setEditing}
              onSelect={setSelected}
              onShowAll={() => change({ month: "all", source: "all", q: "", result: "all" })}
            />
          )}
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {shown.slice(0, limit).map((row, index) => (
              <Card key={row.id} id={reportItemAnchor(row.id)} className="min-w-0 gap-0 space-y-2 rounded-lg border-border p-4 shadow-none">
                <Button
                  type="button"
                  variant="ghost"
                  className="block h-auto w-full min-w-0 space-y-3 whitespace-normal p-0 text-right font-normal hover:bg-transparent"
                  onClick={() => setSelected(row)}
                >
                  {view === "consumption" || view === "items" ? (
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                      <ItemTitle item={row} />
                      {view === "consumption" && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{index + 1}</span>}
                    </div>
                  ) : (
                    <>
                      <h2 className="break-words font-bold">
                        {view === "invoices"
                          ? `فاتورة ${row.invoiceNumber || "—"}`
                          : row.beneficiary || "مستفيد"}
                      </h2>
                      <p className="break-words text-xs text-muted-foreground">
                        {view === "invoices" && `${row.date} · ${row.beneficiary || ""} · `}
                        <bdi>{row.card}</bdi>
                      </p>
                    </>
                  )}
                  {view !== "consumption" && row.sources && (
                    <div className="flex flex-wrap gap-1">
                      {row.sources.map((s: "actual" | "phif") => (
                        <span
                          key={s}
                          className={`rounded-md px-2 py-0.5 text-[11px] ${s === "actual" ? "bg-blue-50 text-blue-800" : "bg-teal-50 text-teal-800"}`}
                        >
                          {sources[s]}
                        </span>
                      ))}
                    </div>
                  )}
                  {view === "consumption" ? (
                    <>
                      <ReportBoxQuantities row={row} />
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-t pt-3">
                        <span className="text-xs text-muted-foreground">سعر بيع علبة PHIF</span>
                        <strong className="min-w-0 break-words text-sm text-primary">
                          {row.boxSale != null ? `${money(row.boxSale)} / علبة`
                            : !row.latestSale ? "لا يوجد سعر بيع PHIF Supplier مسجل" : "حدد حجم علبة PHIF Supplier"}
                        </strong>
                      </div>
                        <p className="text-[11px] leading-5 text-muted-foreground">
                          {row.setting &&
                            `${row.setting.units_per_box} ${ACTUAL_UNITS[row.setting.base_unit as ActualUnit]} / علبة · `}
                          PHIF Supplier
                          {row.latestSale?.date && ` · ${row.latestSale.date}`}
                          {row.latestSale?.date?.slice(0, 7) !== filters.month && row.latestSale
                            ? " · سعر تاريخي"
                            : ""}
                        </p>
                      <p className="text-xs text-muted-foreground">
                        {row.beneficiaries == null
                          ? "عدد المستفيدين محجوب"
                          : `${row.beneficiaries} مستفيد برقم بطاقة`}{" "}
                        {filters.month === "all" ? " · كل التاريخ" : " · خلال الشهر"}
                        {(row.units == null || row.settingConflict) && (
                          <span className="mr-2 inline-block rounded border border-amber-200 px-1 text-amber-800">
                            مراجعة
                          </span>
                        )}
                      </p>
                    </>
                  ) : (
                    <>
                      <Finance
                        row={row}
                        profitLabel={view === "beneficiaries" ? "الربح التراكمي" : undefined}
                      />
                      <p className="text-xs text-muted-foreground">
                        {row.dispenseCount != null
                          ? `${row.dispenseCount} صرفية · ${number(row.units)} وحدة متوافقة · `
                          : ""}
                        {row.invoiceCount != null ? `${row.invoiceCount} فاتورة · ` : ""}
                        {row.losingInvoices != null ? `${row.losingInvoices} فواتير خاسرة` : ""}
                      </p>
                      {view === "beneficiaries" && filters.mode === "single" && (
                        <p className="text-base font-bold text-emerald-700">
                          أعلى ربح فاتورة: {money(row.bestInvoiceProfit)} · {row.bestInvoiceNumber}
                        </p>
                      )}
                    </>
                  )}
                </Button>
                {view === "consumption" && <ItemIdentityReviewAction item={row} onReview={reviewIdentity} />}
              </Card>
            ))}
          </div>
          {shown.length > limit && (
            <Button variant="outline" className="w-full" onClick={() => setLimit((v) => v + 40)}>
              عرض المزيد
            </Button>
          )}
          {!shown.length && !report.data.reviewItems.length && (
            <p className="border-y py-8 text-center text-sm text-muted-foreground">
              لا توجد نتائج ضمن الفلاتر المحددة
            </p>
          )}
          {view !== "consumption" && (
            <p className="text-xs text-muted-foreground">
              {report.data.notes.actual} {report.data.notes.discount}
            </p>
          )}
        </>
      )}
      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent
          side="bottom"
          dir="rtl"
          className="max-h-[92dvh] overflow-y-auto rounded-t-lg p-4 pt-10 sm:mx-auto sm:max-w-3xl"
        >
          <SheetHeader>
            <SheetTitle>
              {selected?.ingredient ||
                selected?.beneficiary ||
                `فاتورة ${selected?.invoiceNumber || ""}`}
            </SheetTitle>
            <SheetDescription>
              سجل الصرف · {selected?.strength} · {selectedRows.length} بند
            </SheetDescription>
          </SheetHeader>
          {selected && (view === "consumption" || view === "items") && (
            <div className="mt-3 space-y-2 border-y py-3 text-xs">
              <p>
                مرات الصرف في الفترة: {selected.dispenseCount} · الفواتير: {selected.invoiceCount}
              </p>
              <p>
                مستفيدو الفترة: {number(selected.beneficiaries)} · تاريخيًا:{" "}
                {number(selected.historicalBeneficiaries)}
              </p>
              <p>
                الشهر السابق: {number(selected.previousBoxes)} علبة · متوسط 3 أشهر مكتملة:{" "}
                {number(selected.averageBoxes)} علبة
              </p>
              {report.data?.period.averageRange && (
                <p>
                  {report.data.period.averageRange.from} — {report.data.period.averageRange.to}
                </p>
              )}
              {selected.changePercent != null && <p>التغير: {number(selected.changePercent)}%</p>}
              {selected.units == null && (
                <p className="text-amber-800">
                  توجد وحدة صرف أو تحويل غير موثق؛ الكمية غير المحددة ليست صفرًا.
                </p>
              )}
              {selected.settingConflict && (
                <p className="text-red-700">
                  تعارض بين إعدادات أحجام العلب القديمة؛ لم يُستبدل أي إعداد.
                </p>
              )}
              {(selected.identityComplete || selected.sources?.includes("phif")) && report.data?.canManageBoxes && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!report.data.settingsAvailable || selected.settingConflict}
                  onClick={() => {
                    setEditing(selected);
                    setSelected(null);
                  }}
                >
                  <Settings2 className="size-4" />
                  {selected.identityComplete ? "إعدادات PHIF Supplier" : "تعديل هوية وحجم عبوة PHIF Supplier"}
                </Button>
              )}
              <Finance row={selected} />
            </div>
          )}
          {selected && <Movements key={`${view}:${selected.id}`} rows={selectedRows} />}
        </SheetContent>
      </Sheet>
      {view === "consumption" && <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="bottom" dir="rtl" className="max-h-[85dvh] overflow-y-auto rounded-t-lg p-4 pt-10 sm:mx-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>فلاتر الاستهلاك</SheetTitle>
            <SheetDescription>الفترة والمصدر</SheetDescription>
          </SheetHeader>
          <div className="mt-5 space-y-4">
            <label className="block space-y-2 text-sm">
              <span>الشهر والسنة</span>
              <Input type="month" aria-label="الشهر والسنة" value={filters.month === "all" ? "" : filters.month} onChange={(e) => change({ month: e.target.value || "all" })} className="w-full min-w-0" />
            </label>
            <Button className="w-full" variant={filters.month === "all" ? "default" : "outline"} onClick={() => change({ month: "all" })}>كل التاريخ</Button>
            <div className="space-y-2">
              <span className="text-sm">المصدر</span>
              <Options label="المصدر" value={filters.source} onChange={(source) => change({ source: source as AnalyticsFilters["source"] })} options={[["all", "كل المصادر"], ["actual", "Actual"], ["phif", "PHIF Supplier"]]} />
            </div>
            {report.data && <div className="border-t pt-4">
              <p className="text-xs text-muted-foreground">{summaryItemScope?.item ? "الصنف" : "الأصناف"}</p>
              {summaryItemScope?.item ? (
                <div className="mt-1 rounded-lg border border-primary/20 bg-accent px-3 py-2">
                  <ItemTitle item={summaryItemScope.item} />
                </div>
              ) : (
                <p className="mt-1 text-sm font-semibold">
                  {summaryItemScope?.count ? `${number(summaryItemScope.count)} صنف` : "لا حركات ضمن الفترة"}
                  {filters.q.trim() && <span className="text-xs font-normal text-muted-foreground"> · البحث: {filters.q.trim()}</span>}
                </p>
              )}
              <dl className="mt-3 space-y-3 text-sm">
                {[["علب Actual", report.data.summary.actualBoxes], ["علب PHIF Supplier", report.data.summary.phifBoxes], ["إجمالي العلب", report.data.summary.boxes], ["المستفيدون", report.data.summary.beneficiaries]].map(([label, value]) => <div key={String(label)} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{number(value as number | null)}</dd></div>)}
              </dl>
            </div>}
            <Button className="w-full" onClick={() => setFiltersOpen(false)}>عرض النتائج</Button>
          </div>
        </SheetContent>
      </Sheet>}
      {editing && (
        <BoxEditor
          item={editing}
          rows={report.data?.historyMovements.filter((r) => r.identity === editing.id) || []}
          unitsAvailable={Boolean(report.data?.supplierUnitsAvailable)}
          reportKey={["items_analytics", scope, view, filters]}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
