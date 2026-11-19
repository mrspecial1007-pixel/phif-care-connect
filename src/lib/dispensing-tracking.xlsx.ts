import ExcelJS from "exceljs";
import type { TrackingReport } from "./dispensing-tracking.server";
import { trackingQuantityLabel, trackingSourceLabel } from "./dispensing-tracking.model";
import { ACTUAL_UNITS } from "./actual-units.helpers";

export async function buildTrackingWorkbook(data: TrackingReport) {
  if (data.movements.length !== data.totalMovements)
    throw new Error("نتائج التصدير غير مكتملة؛ لا تستخدم الصفحة المعروضة فقط");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = data.pharmacy;
  workbook.created = new Date(data.issuedAt);
  const add = (name: string, headers: string[], rows: (string | number | Date | null)[][]) => {
    const sheet = workbook.addWorksheet(name, {
      views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
    });
    sheet.columns = headers.map((h) => ({
      header: h,
      width: /الاسم|شركة|ملاحظة|كمية/.test(h) ? 32 : 22,
    }));
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF176B5B" } };
    rows.forEach((values) => {
      const row = sheet.addRow(values.map((v) => (v === null ? "غير محدد / غير متاح" : v)));
      row.eachCell((cell) => {
        cell.numFmt =
          cell.value instanceof Date
            ? "yyyy-mm-dd"
            : typeof cell.value === "number"
              ? "0.####"
              : "@";
        cell.alignment = { horizontal: "right", vertical: "middle", wrapText: true };
      });
    });
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: rows.length + 1, column: headers.length },
    };
  };
  const asDate = (v: string | null) =>
    v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
      ? new Date(`${v}T00:00:00Z`)
      : null;
  add(
    "نطاق التقرير",
    ["البيان", "القيمة"],
    [
      ["الصيدلية", data.pharmacy],
      ["وقت القراءة", data.issuedAt],
      ["الصنف", data.selected?.name || ""],
      ["التركيز", data.selected?.strength || ""],
      ["الشكل", data.selected?.form || ""],
      ["من", data.filters.from || "بداية التاريخ المحفوظ"],
      ["إلى", data.filters.to || "نهاية التاريخ المحفوظ"],
      ["المصدر", trackingSourceLabel(data.filters.source)],
      ["الشركة", data.filters.company || "كل الشركات"],
      [
        "نوع التتبع",
        data.filters.mode === "brand" ? "منتج تجاري محدد" : "الهوية العلمية وجميع منتجاتها",
      ],
      ["مفتاح المنتج", data.filters.product || ""],
      ["بنود الصرف", data.totalMovements],
      ["الفواتير", data.summary.invoices],
      ["أول صرف علمي تاريخيًا", asDate(data.scientificHistory.first)],
      ["آخر صرف علمي تاريخيًا", asDate(data.scientificHistory.last)],
      ["أول صرف للاختيار تاريخيًا", asDate(data.history.first)],
      ["آخر صرف للاختيار تاريخيًا", asDate(data.history.last)],
      ["الكميات", trackingQuantityLabel(data.summary)],
      ["العلب المتوافقة", data.summary.boxes.value],
      [
        "ملاحظة",
        "لا تُنسب الحركات العلمية إلى علامة أو تشغيلة من المخزون الحالي. سجل الشركات يوضح تواريخ الفواتير ولا يثبت الاستبدال أو ترتيب الحركات في اليوم نفسه.",
      ],
      ["بنود بلا تاريخ خارج الفترة", data.undatedOutsidePeriod],
      ["مصادر محجوبة", data.hiddenSources.map(trackingSourceLabel).join("، ") || "لا يوجد"],
      ["بنود بمصدر غير مصنف في التاريخ", data.unclassifiedItems],
    ],
  );
  add(
    "جميع حركات الصرف",
    [
      "معرف البند",
      "رقم الفاتورة",
      "التاريخ",
      "الاسم العلمي",
      "التركيز",
      "الشكل",
      "الاسم التجاري",
      "الشركة المسجلة",
      "المصدر",
      "الكمية الأصلية",
      "وحدة الكمية",
      "العلب",
      "حالة التحويل",
      "مفتاح الهوية",
      "مفتاح المنتج",
    ],
    data.movements.map((r) => [
      r.id,
      r.invoiceNumber || r.invoiceId,
      asDate(r.date),
      r.ingredient,
      r.strength,
      r.form,
      r.brand || "صرف علمي غير منسوب",
      r.company,
      trackingSourceLabel(r.source),
      r.quantity,
      r.unit ? ACTUAL_UNITS[r.unit] : null,
      r.boxes,
      r.quantityIssue || r.boxIssue || "موثق",
      r.identity,
      r.product,
    ]),
  );
  const summary = (rows: typeof data.monthly) =>
    rows.map((g) => [
      g.key,
      g.summary.items,
      g.summary.invoices,
      trackingQuantityLabel(g.summary),
      g.summary.boxes.value,
      g.summary.boxes.state,
      asDate(g.summary.first),
      asDate(g.summary.last),
    ]);
  const headers = [
    "المجموعة",
    "بنود الصرف",
    "الفواتير",
    "الكميات حسب الوحدة",
    "العلب المتوافقة",
    "حالة العلب",
    "أول صرف",
    "آخر صرف",
  ];
  add("الملخص الشهري", headers, summary(data.monthly));
  add("ملخص الشركات", headers, summary(data.byCompany));
  add(
    "الأسماء التجارية",
    ["الاسم التجاري", "الشركة", "بنود الصرف", "الكميات", "أول صرف", "آخر صرف"],
    data.products.map((g) => [
      g.brand || "صرف علمي غير منسوب",
      g.company,
      g.summary.items,
      trackingQuantityLabel(g.summary),
      asDate(g.summary.first),
      asDate(g.summary.last),
    ]),
  );
  add(
    "تاريخ المنتجات الكامل",
    ["مفتاح المنتج", "الاسم التجاري", "الشركة", "أول صرف تاريخيًا", "آخر صرف تاريخيًا"],
    (data.selected?.products || [])
      .filter((p) => data.filters.mode !== "brand" || p.id === data.filters.product)
      .map((p) => [p.id, p.brand, p.company, asDate(p.history.first), asDate(p.history.last)]),
  );
  add(
    "التسلسل الزمني للشركات",
    ["التاريخ", "الشركة", "الاسم التجاري", "المصدر", "بنود الصرف", "الكميات"],
    data.chronology.map((g) => [
      asDate(g.date),
      g.company,
      g.brand || "صرف علمي غير منسوب",
      trackingSourceLabel(g.source),
      g.summary.items,
      trackingQuantityLabel(g.summary),
    ]),
  );
  return workbook;
}
