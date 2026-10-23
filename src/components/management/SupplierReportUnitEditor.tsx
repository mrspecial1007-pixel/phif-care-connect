import { memo, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ACTUAL_UNITS, actualUnit } from "@/lib/actual-units.helpers";
import { saveReportSupplierUnit } from "@/lib/items-analytics.functions";
import { supplierBoxPreview } from "@/lib/report-supplier-units.helpers";
import type { AnalyticsRow } from "@/lib/items-analytics.helpers";
import {
  reportSettingRequest,
  refreshReportAfterSettingSave,
} from "@/lib/report-setting-save.helpers";
import { toast } from "sonner";

export const SupplierReportUnitEditor = memo(function SupplierReportUnitEditor({
  item,
  rows,
  available,
  reportKey = ["items_analytics"],
}: {
  item: any;
  rows: AnalyticsRow[];
  available: boolean;
  reportKey?: readonly unknown[];
}) {
  const [unit, setUnit] = useState(
    () => item.setting?.supplier_quantity_unit ?? actualUnit(item.form) ?? "",
  );
  const [exceptions, setExceptions] = useState<Record<string, string>>(
    item.setting?.supplier_unit_exceptions || {},
  );
  const [invoice, setInvoice] = useState("");
  const [override, setOverride] = useState("unknown");
  const client = useQueryClient();
  const saveLock = useRef(false);
  const sourceRows = useMemo(() => rows.filter((r) => r.source === "phif"), [rows]);
  const choices = Object.entries(ACTUAL_UNITS).filter(([key]) =>
    ["box", "strip", actualUnit(item.form)].includes(key),
  );
  const save = useMutation({
    mutationFn: () =>
      reportSettingRequest(() =>
        saveReportSupplierUnit({
          data: {
            identity: item.id,
            unit: unit || null,
            exceptions: Object.entries(exceptions).map(([invoiceId, unit]) => ({
              invoiceId,
              unit,
            })),
            version: item.setting.version,
          },
        }),
      ),
    onSuccess: () => {
      refreshReportAfterSettingSave(client, reportKey, () =>
        toast.error("حُفظ توثيق الوحدة، لكن تعذر تحديث التقرير. اضغط تحديث."),
      );
    },
  });
  const preview = useMemo(() => {
    if (!item.setting) return [];
    const start = performance.now();
    const result = sourceRows.map((r) => {
      const choice = exceptions[r.invoiceId];
      const chosen =
        choice === "unknown" || r.unitIssue === "conflict"
          ? null
          : r.unitProvenance === "source" && r.unit
            ? r.unit
            : actualUnit(choice || unit);
      const conflict =
        choice &&
        choice !== "unknown" &&
        r.unitProvenance === "source" &&
        r.unit !== actualUnit(choice);
      const boxes =
        !conflict && chosen && r.quantity != null
          ? chosen === r.unit && r.units != null
            ? r.units / item.setting.units_per_box
            : supplierBoxPreview(
                r.quantity,
                chosen,
                item.setting.base_unit,
                item.setting.units_per_box,
                r.packageQuantity,
                r.stripsPerPackage,
              )
          : null;
      return { row: r, chosen, boxes };
    });
    console.info("phif_report_setting_client_timing", {
      phase: "conversion_preview",
      ms: Math.round(performance.now() - start),
    });
    return result;
  }, [sourceRows, exceptions, unit, item.setting]);
  if (!available)
    return (
      <p className="border-t pt-3 text-sm text-amber-800">
        توثيق وحدة PHIF Supplier غير مفعّل: يلزم تطبيق الترحيل الجديد. إعداد حجم العلبة الحالي
        محفوظ.
      </p>
    );
  if (!item.setting)
    return (
      <p className="text-sm text-muted-foreground">
        احفظ حجم علبة PHIF Supplier أولًا لفتح توثيق الوحدة.
      </p>
    );
  return (
    <section className="space-y-3 border-t pt-3">
      <h3 className="text-sm font-semibold">وحدة كمية PHIF Supplier</h3>
      <select
        aria-label="وحدة صرف PHIF Supplier"
        className="w-full rounded-md border bg-background p-2"
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        disabled={save.isPending}
      >
        <option value="">بدون اعتماد عام</option>
        {choices.map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        للفواتير المطابقة الحالية والقادمة فقط. تبقى الوحدة الأصلية الموثقة أولوية، ولا تتغير تكلفة
        أي بند.
      </p>
      <details>
        <summary className="text-sm">استثناء فاتورة</summary>
        <div className="mt-2 space-y-2">
          <select
            aria-label="الفاتورة المستثناة"
            className="w-full rounded-md border bg-background p-2"
            value={invoice}
            onChange={(e) => setInvoice(e.target.value)}
          >
            <option value="">اختر فاتورة</option>
            {[...new Map(sourceRows.map((r) => [r.invoiceId, r])).values()].map((r) => (
              <option key={r.invoiceId} value={r.invoiceId}>
                {r.invoiceNumber} · {r.date}
              </option>
            ))}
          </select>
          <select
            aria-label="وحدة استثناء الفاتورة"
            className="w-full rounded-md border bg-background p-2"
            value={override}
            onChange={(e) => setOverride(e.target.value)}
          >
            <option value="unknown">تحتاج مراجعة — لا تحويل</option>
            {choices.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            type="button"
            disabled={!invoice || save.isPending}
            onClick={() => {
              setExceptions((x) => ({ ...x, [invoice]: override }));
              setInvoice("");
            }}
          >
            إضافة الاستثناء
          </Button>
          {Object.entries(exceptions).map(([id, value]) => (
            <div key={id} className="flex items-center justify-between gap-2 text-xs">
              <span>
                فاتورة {sourceRows.find((r) => r.invoiceId === id)?.invoiceNumber || id} ·{" "}
                {ACTUAL_UNITS[value as keyof typeof ACTUAL_UNITS] || "تحتاج مراجعة"}
              </span>
              <Button
                size="icon"
                variant="ghost"
                title="إزالة الاستثناء"
                aria-label="إزالة الاستثناء"
                onClick={() =>
                  setExceptions((x) =>
                    Object.fromEntries(Object.entries(x).filter(([key]) => key !== id)),
                  )
                }
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      </details>
      <details open>
        <summary className="text-sm font-semibold">
          معاينة التحويل ({sourceRows.length} بند)
        </summary>
        <div className="max-h-48 overflow-y-auto text-xs">
          {preview.map(({ row: r, chosen, boxes }) => (
            <p key={r.id} className="border-b py-2">
              فاتورة {r.invoiceNumber}: {r.quantity}{" "}
              {chosen ? ACTUAL_UNITS[chosen] : "وحدة غير موثقة"} ={" "}
              {boxes == null
                ? "يحتاج مراجعة"
                : `${boxes.toLocaleString("en-US", { maximumFractionDigits: 4 })} علبة`}
            </p>
          ))}
        </div>
      </details>
      {save.error && (
        <p role="alert" className="text-sm text-destructive">
          {(save.error as Error).message}
        </p>
      )}
      {save.isSuccess && (
        <p role="status" className="text-sm text-emerald-800">
          حُفظ توثيق الوحدة. أعد فتح الإعدادات قبل تعديل آخر.
        </p>
      )}
      <Button
        type="button"
        disabled={save.isPending || save.isSuccess}
        onClick={() => {
          if (saveLock.current) return;
          saveLock.current = true;
          save.mutate(undefined, {
            onSettled: () => {
              saveLock.current = false;
            },
          });
        }}
      >
        <Save className="size-4" />
        حفظ توثيق الوحدة
      </Button>
    </section>
  );
});
