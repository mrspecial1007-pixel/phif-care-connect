import { resultMatches, type AnalyticsFilters, type AnalyticsRow } from "./items-analytics.helpers";

export type AnalyticsView = "consumption" | "items" | "invoices" | "beneficiaries";

export function selectAnalyticsRows(report: any, view: AnalyticsView, filters: AnalyticsFilters) {
  const all: any[] =
    view === "consumption" || view === "items"
      ? report.items
      : view === "invoices"
        ? report.invoices
        : report.beneficiaries;
  return all
    .filter((row) => view === "consumption" || resultMatches(row, filters.result))
    .sort((a, b) => {
      if (view === "consumption") return a.ingredient.localeCompare(b.ingredient, "ar");
      const metric = (r: any) =>
        filters.sort === "sale_desc"
          ? r.revenue
          : view === "beneficiaries" && filters.mode === "single"
            ? r.bestInvoiceProfit
            : r.profit;
      if (filters.sort === "date_desc")
        return String(b.date ?? "").localeCompare(String(a.date ?? ""));
      const av = metric(a),
        bv = metric(b);
      if (av == null || bv == null) return av == null ? (bv == null ? 0 : 1) : -1;
      return filters.sort === "profit_asc" ? av - bv : bv - av;
    });
}

export function movementMatches(row: AnalyticsRow, selected: any, view: AnalyticsView) {
  return view === "consumption" || view === "items"
    ? row.identity === selected.id
    : view === "invoices"
      ? row.invoiceId === selected.id
      : row.card === selected.card;
}

/** The caller supplies a newly server-authorized export payload, not cached UI data. */
export async function buildAnalyticsWorkbook(
  report: any,
  view: AnalyticsView,
  filters: AnalyticsFilters,
) {
  const XLSX = await import("xlsx");
  const selected = selectAnalyticsRows(report, view, filters);
  const ids = new Set(selected.map((r) => r.id));
  if (view === "consumption" || view === "items")
    for (const row of report.reviewItems || []) ids.add(row.id);
  const movements: AnalyticsRow[] = report.movements.filter((r: AnalyticsRow) =>
    ids.has(
      view === "consumption" || view === "items"
        ? r.identity
        : view === "invoices"
          ? r.invoiceId
          : r.card,
    ),
  );
  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: any[]) => {
    const sheet = XLSX.utils.json_to_sheet(
      rows.length ? rows : [{ ملاحظة: "لا توجد نتائج مطابقة" }],
    );
    sheet["!cols"] = Object.keys(rows[0] ?? {}).map((key) => ({
      wch: /اسم|العلمي/.test(key) ? 34 : /بطاقة/.test(key) ? 24 : 19,
    }));
    sheet["!autofilter"] = { ref: sheet["!ref"] ?? "A1" };
    for (const [key, cell] of Object.entries(sheet))
      if (!key.startsWith("!") && (cell as { t: string }).t === "n")
        (cell as { z: string }).z = "#,##0.000";
    XLSX.utils.book_append_sheet(wb, sheet, name);
  };
  add(
    view === "consumption" ? "ملخص الأصناف" : "ملخص الربحية",
    selected.map((r) =>
      view === "consumption"
        ? {
            الاسم_العلمي: r.ingredient,
            التركيز: r.strength,
            الشكل_الدوائي: r.form,
            حجم_علبة_PHIF: r.setting?.units_per_box ?? null,
            وحدة_علبة_PHIF: r.setting?.base_unit ?? null,
            وحدة_صرف_PHIF_المعتمدة: r.setting?.supplier_quantity_unit ?? null,
            آخر_بيع_وحدة_PHIF: r.latestSale?.price ?? null,
            آخر_بيع_علبة_PHIF: r.boxSale,
            تاريخ_السعر: r.latestSale?.date ?? null,
            كمية_Actual: r.actualUnits,
            كمية_PHIF: r.phifUnits,
            إجمالي_الوحدات: r.units,
            علب_Actual: r.actualBoxes,
            علب_PHIF: r.phifBoxes,
            إجمالي_العلب: r.boxes,
            المستفيدون_بالبطاقة: r.beneficiaries,
            المستفيدون_تاريخيًا: r.historicalBeneficiaries,
            مرات_الصرف: r.dispenseCount,
            عدد_الفواتير: r.invoiceCount,
            متوسط_ثلاثة_أشهر_بالعلب: r.averageBoxes,
            متوسط_من: report.period.averageRange?.from ?? null,
            متوسط_إلى: report.period.averageRange?.to ?? null,
          }
        : {
            الاسم: r.ingredient ?? r.beneficiary,
            التركيز: r.strength ?? null,
            الشكل: r.form ?? null,
            الفاتورة: r.invoiceNumber ?? null,
            التاريخ: r.date ?? null,
            البطاقة: r.card == null ? null : String(r.card),
            قيمة_البيع: r.revenue,
            تكلفة_الشراء: r.cost,
            الربح: r.profit,
            نسبة_الربح: r.margin,
            الربح_بعد_خصم_موثق: r.afterDiscount,
            الحالة: r.complete ? "مكتمل" : "غير مكتمل أو محجوب بالصلاحيات",
            مرات_الصرف: r.dispenseCount ?? r.itemCount ?? null,
            الكمية_بوحدة_مشتركة: r.units ?? null,
            الفواتير_الخاسرة: r.losingInvoices ?? null,
            أعلى_ربح_فاتورة: r.bestInvoiceProfit ?? null,
            رقم_أعلى_فاتورة: r.bestInvoiceNumber ?? null,
          },
    ),
  );
  if ((view === "consumption" || view === "items") && report.reviewItems?.length)
    add(
      "مراجعة الهوية",
      report.reviewItems.map((r: any) => ({
        الاسم_العلمي: r.ingredient,
        التركيز: r.strength,
        الشكل: r.form || null,
        عدد_البنود: r.dispenseCount,
        قيمة_البيع: r.revenue,
        تكلفة_الشراء: r.cost,
        الربح: r.profit,
        السبب: r.identityReviewReason || "هوية غير مكتملة؛ لم تدمج تخمينيًا",
        معرّفات_البنود: report.movements
          .filter((m: AnalyticsRow) => m.identity === r.id)
          .map((m: AnalyticsRow) => m.id)
          .join(" | "),
      })),
    );
  add(
    "سجل الصرف",
    movements.map((r) => ({
      الاسم_العلمي: r.ingredient,
      الاسم_التجاري_الأصلي: r.brand,
      التركيز: r.strength,
      الشكل: r.form,
      التاريخ: r.date,
      الفاتورة: r.invoiceNumber,
      المستفيد: r.beneficiary,
      البطاقة: r.card == null ? null : String(r.card),
      المصدر: r.source === "actual" ? "Actual" : "PHIF Supplier",
      الكمية: r.quantity,
      الوحدة: r.unit,
      الكمية_بالعلب: r.boxes,
      قيمة_البيع: r.revenue,
      تكلفة_الشراء: r.cost,
      الربح: r.profit,
      الربح_بعد_الخصم: r.afterDiscount,
      سبب_نقص_التكلفة: r.cost == null ? r.financialReason : null,
    })),
  );
  wb.Workbook = { Views: [{ RTL: true }] };
  return wb;
}
