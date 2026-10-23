import ExcelJS from "exceljs";
import { profitExportNotes, profitSourceLabel, type ExportSection, type ProfitExport } from "./profit-analysis-export.model";

export async function buildProfitWorkbook(data: ProfitExport, progress: (message: string) => void = () => {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = data.meta.pharmacy;
  workbook.created = new Date(data.meta.issuedAt);
  const sections = [data.summary, data.sources, data.beneficiaries, data.revenueItems, data.profitItems, data.invoices, data.details];
  const titles = ["الملخص المالي", "مقارنة المصادر", "المستفيدون", "الأصناف حسب الإيراد", "الأصناف حسب الربح", "الفواتير", "تفاصيل البنود"];
  for (const [index, section] of sections.entries()) {
    progress(`إنشاء ورقة ${index + 1} من ${sections.length}`);
    const sheet = workbook.addWorksheet(titles[index], { views: [{ rightToLeft: true, state: "frozen", ySplit: 6 }], pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    sheet.columns = section.columns.map(c => ({ width: c.width || 18 }));
    const metadata = [section.title, data.meta.pharmacy, `الفترة: ${data.meta.dateFrom} إلى ${data.meta.dateTo} | المصدر: ${profitSourceLabel(data.meta.source)}`, `إصدار: ${data.meta.issuedAt.slice(0,10)}`, profitExportNotes];
    for (const title of metadata) {
      const row = sheet.addRow([title]);
      sheet.mergeCells(row.number, 1, row.number, section.columns.length);
      row.height = row.number === 5 ? 42 : 25;
      row.getCell(1).alignment = { horizontal: "right", vertical: "middle", wrapText: true, readingOrder: "rtl" };
      row.font = { name: "Arial", size: row.number === 1 ? 15 : 10, bold: row.number === 1, color: { argb: "FF263D38" } };
    }
    const header = sheet.addRow(section.columns.map(c => c.title));
    header.height = 32;
    header.eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF174B43" } }; cell.font = { name: "Arial", bold: true, size: 11, color: { argb: "FFFFFFFF" } }; cell.alignment = { horizontal: "right", vertical: "middle", wrapText: true, readingOrder: "rtl" }; });
    const add = (values: (string | number | null)[], rowIndex: number, total = false) => {
      const row = sheet.addRow(values.map((v, i) => section.columns[i].kind === "date" && v ? new Date(`${v}T00:00:00Z`) : v));
      let height = 25;
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const column = section.columns[colNumber - 1];
        const kind = section.id === "summary" && colNumber === 2 ? rowIndex < 3 ? "money" : rowIndex === 3 ? "percent" : "number" : column.kind;
        cell.font = { name: "Arial", size: 11, bold: total, color: { argb: "FF202E2B" } };
        cell.alignment = { horizontal: "right", vertical: "middle", wrapText: true, readingOrder: "rtl" };
        cell.numFmt = kind === "money" ? '#,##0.000;[Red]-#,##0.000;0.000' : kind === "date" ? "yyyy-mm-dd" : kind === "percent" ? "0.00%" : kind === "number" ? "0.####" : "@";
        if (typeof cell.value === "number" && /ربح/.test(column.title)) cell.font.color = { argb: cell.value < 0 ? "FFB42318" : "FF087443" };
        if (cell.value == null) cell.value = "غير مكتمل / غير متاح";
        const length = String(cell.text || "").length;
        height = Math.max(height, Math.ceil(length / Math.max(10, (column.width || 18) - 3)) * 16 + 8);
        if (total || rowIndex % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: total ? "FFE0EFEA" : "FFF3F6F5" } };
        cell.border = { bottom: { style: "hair", color: { argb: "FFD4DDDA" } } };
      });
      row.height = height;
    };
    section.rows.forEach((values, rowIndex) => add(values, rowIndex));
    sheet.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6 + section.rows.length, column: section.columns.length } };
    if (section.totals) add(section.totals, section.rows.length, true);
    sheet.pageSetup.printTitlesRow = "6:6";
    sheet.headerFooter.oddFooter = "&Rصفحة &P من &N&LPHIF Tracker";
  }
  return workbook;
}
