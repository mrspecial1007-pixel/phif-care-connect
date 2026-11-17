import ExcelJS from "exceljs";
import { ACTUAL_UNITS } from "./actual-units.helpers";
import type { AuditReviewExport } from "./definition-audit-export.model";

const unitLabel = (unit: string | null) => unit == null ? null : ACTUAL_UNITS[unit as keyof typeof ACTUAL_UNITS] || unit;
const sourceLabel = (source: string) => source === "phif" ? "PHIF Supplier" : source === "actual" ? "PHIF Actual" : "غير محدد";

export function buildAuditReviewWorkbook(data: AuditReviewExport) {
  const book = new ExcelJS.Workbook();
  book.creator = "PHIF Tracker";
  book.created = new Date(data.verifiedAt);
  const sheet = (name: string, headers: string[], widths: number[], rows: (string | number | null)[][], inputs: number[] = []) => {
    if (rows.length > 1_048_575) throw new Error("تجاوز عدد الصفوف سعة Excel؛ لم يُنشأ ملف مختصر.");
    const ws = book.addWorksheet(name, { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
    ws.columns = headers.map((header, index) => ({ header, width: widths[index] || 26 }));
    for (const values of rows) {
      if (values.some(v => typeof v === "string" && v.length > 32767)) throw new Error("تجاوز أحد الحقول سعة خلية Excel؛ لم تُحذف أي بيانات بصمت.");
      const row = ws.addRow(values);
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.alignment = { vertical: "top", wrapText: true, readingOrder: "rtl" };
        cell.font = { name: "Arial", size: 11 };
        cell.numFmt = typeof cell.value === "number" ? "0.###" : "@";
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: inputs.includes(col) ? "FFE3F2E8" : "FFF4F6F8" } };
      });
    }
    ws.getRow(1).eachCell(cell => {
      cell.font = { name: "Arial", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF24574B" } };
      cell.alignment = { wrapText: true, vertical: "middle", readingOrder: "rtl" };
    });
    ws.getRow(1).height = 48;
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, ws.rowCount), column: headers.length } };
    return ws;
  };
  const review = sheet("الأصناف للمراجعة", [
    "مفتاح الربط الثابت — لا تعدّل", "مفتاح الهوية الأصلي", "الاسم العلمي كما هو محفوظ", "التركيز", "الشكل الدوائي", "المصدر",
    "سبب المراجعة", "عدد البنود المتأثرة", "عدد الفواتير المتأثرة", "عدد الوحدات في العلبة الحالي", "وحدة العبوة الحالية", "وحدة PHIF Supplier الحالية",
    "عدد الوحدات في العلبة الجديد", "وحدة العبوة الجديدة", "وحدة PHIF Supplier الجديدة", "ملاحظات", "حالة التعريف الحالي",
  ], [42, 42, 48, 22, 20, 22, 60, 16, 16, 20, 20, 24, 22, 22, 26, 40, 54], data.rows.map(r => [
    r.key, r.identity, r.name, r.strength, r.form, sourceLabel(r.source), r.reasons.join("\n"), r.itemCount, r.invoiceCount,
    r.boxSize, unitLabel(r.baseUnit), unitLabel(r.supplierUnit), null, null, null, null, r.status,
  ]), [13, 14, 15, 16]);
  const units = Object.entries(ACTUAL_UNITS);
  const bases = units.filter(([code]) => code !== "box" && code !== "strip");
  sheet("الوحدات", ["رمز وحدة الكمية", "الاسم المعتمد", "رمز وحدة العبوة", "اسم وحدة العبوة"], [24, 26, 24, 26],
    units.map(([code, label], i) => [code, label, bases[i]?.[0] || null, bases[i]?.[1] || null]));
  book.definedNames.add(`'الوحدات'!$B$2:$B$${units.length + 1}`, "AuditQuantityUnits");
  book.definedNames.add(`'الوحدات'!$D$2:$D$${bases.length + 1}`, "AuditBoxUnits");
  data.rows.forEach((row, i) => {
    const r = i + 2;
    review.getCell(r, 13).dataValidation = { type: "whole", operator: "greaterThan", formulae: [0], allowBlank: true,
      showErrorMessage: true, errorStyle: "stop", error: "أدخل عددًا صحيحًا موجبًا، أو اتركه فارغًا دون تغيير." };
    for (const [col, range] of [[14, "AuditBoxUnits"], [15, "AuditQuantityUnits"]] as const) {
      if (col === 15 && row.source !== "phif") continue;
      review.getCell(r, col).dataValidation = { type: "list", formulae: [range], allowBlank: true,
        showErrorMessage: true, errorStyle: "stop", error: "اختر الوحدة المعتمدة من القائمة." };
    }
  });
  sheet("التعريفات المرجعية", ["مفتاح الربط", "معرف التعريف", "مفتاح الهوية المحفوظ", "الإصدار", "حجم العلبة", "رمز وحدة العبوة", "رمز وحدة Supplier"],
    [42, 40, 50, 14, 18, 22, 22], data.definitions.map(d => [d.rowKey, d.id, d.identity, d.version, d.boxSize, d.baseUnit, d.supplierUnit]));
  sheet("السجلات المرجعية", ["مفتاح الربط", "مصدر السجل", "معرف السجل الأصلي"], [42, 36, 40],
    data.records.map(r => [r.rowKey, r.table, r.id]));
  sheet("بيانات التصدير", ["البيان", "القيمة"], [40, 100], [
    ["الصيدلية", data.pharmacyId], ["بصمة مصادر الفحص", data.fingerprint], ["إصدار القواعد", data.ruleVersion], ["إصدار ملف المراجعة", data.schemaVersion],
    ["تاريخ الفحص المكتمل", data.auditFinishedAt], ["وقت التحقق للتصدير", data.verifiedAt], ["عدد صفوف الأصناف", data.rows.length], ["عدد المشكلات قبل التجميع", data.findingsCount],
    ["النطاق", "جميع نتائج المراجعة والأخطاء وتعذر التحقق؛ لا تطبق فلاتر الشاشة أو حدود عينتها."],
    ["الأعمدة الخضراء", "مدخلات للمراجعة فقط؛ الخلية الفارغة لا تعني صفرًا أو حذف القيمة الحالية."],
    ["البيانات الحالية", "القيم غير المحددة أو المتعارضة تظل فارغة. الشكل وحجم العبوة لا يثبتان وحدة كمية الفاتورة."],
    ["المصادر", "إعدادات Supplier لا تطبق على Actual؛ أي تغيير لاحق يتطلب مراجعة المصدر."],
    ["الاستيراد لاحقًا", "لا تغيّر مفاتيح الربط. يلزم التحقق من الصيدلية والمدير والإصدارات والتعارضات بالخادم قبل أي حفظ. الملف ليس إذنًا بالاستيراد."],
    ["اتساق القراءة", "تطابقت قراءتا المصادر مع بصمة آخر فحص؛ ليست لقطة قاعدة بيانات ذرّية."],
  ]);
  return book;
}
