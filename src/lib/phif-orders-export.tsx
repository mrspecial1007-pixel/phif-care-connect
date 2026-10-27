import React from "react";
import { ORDER_DATE_BASES, ORDER_PERIODS, ORDER_STATES, ORDER_TABS, orderCreatedDate, ordersExportRows, ordersView, type OrdersFilters, type PhifOrdersReport } from "./phif-orders.helpers";

export const orderDateLabel = (value: string | null) => orderCreatedDate(value) || "غير متاح";
export function ordersPeriodLabel(filters: OrdersFilters) {
  return `${ORDER_PERIODS[filters.period]}${filters.period === "all" ? "" : ` (${filters.dateFrom} - ${filters.dateTo})`}؛ حسب ${ORDER_DATE_BASES[filters.dateBasis || "creation"]}`;
}
export function ordersFilterLabel(filters: OrdersFilters) {
  return `${ORDER_TABS[filters.tab]}${filters.tab === "approved" && filters.status !== "all" ? `: ${ORDER_STATES[filters.status]}` : ""} | ${filters.supplier === "all" ? "جميع الموردين" : filters.supplier}${filters.query ? ` | بحث: ${filters.query}` : ""}`;
}

export async function buildOrdersWorkbook(report: PhifOrdersReport, filters: OrdersFilters, now = Date.now()) {
  const view = ordersView(report, filters, now);
  if (view.periodError) throw new Error(view.periodError);
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  workbook.creator = report.pharmacy;
  const summary = workbook.addWorksheet("الملخص", { views: [{ rightToLeft: true }] });
  summary.columns = [{ width: 38 }, { width: 75 }];
  summary.addRows([["متابعة طلبيات PHIF", report.pharmacy], ["آخر مزامنة ناجحة", report.fetchedAt],
    ["مصدر البيانات", "نسخة محفوظة من آخر مزامنة ناجحة، وليست تحققًا مباشرًا من PHIF الآن"],
    ["الفترة", ordersPeriodLabel(filters)], ["الفلاتر", ordersFilterLabel(filters)], ["عدد الطلبات ضمن الفترة والبحث والمورد", view.orderCount],
    ["بنود مستبعدة بكمية معتمدة صفر من المصدر لكل التاريخ قبل الفلاتر", report.excludedZero],
    ...Object.entries(view.counts).map(([state, count]) => [ORDER_STATES[state as keyof typeof ORDER_STATES], count]),
    ["تاريخ إصدار التقرير", new Date(now)],
    ["مرجع المدة", "لغير المستلم: من إنشاء الطلب حتى إصدار التقرير. للمستلم: حتى الاستلام الفعلي إن توفر، وإلا فلا تُحسب مدة. ليست مدة منذ موافقة المورد."],
  ]);
  const sheet = workbook.addWorksheet("أصناف الطلبات", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "رقم الطلب", key: "orderNumber", width: 26 },
    { header: "تاريخ إنشاء الطلب", key: "createdAt", width: 20 },
    { header: "الدواء", key: "medicine", width: 46 },
    { header: "الشركة الموردة", key: "supplier", width: 46 },
    { header: "التشغيلة", key: "batch", width: 22 },
    { header: "الكمية المعتمدة", key: "quantity", width: 20 },
    { header: "الحالة", key: "status", width: 28 },
    { header: "المدة بالأيام", key: "ageDays", width: 18 },
    { header: "بيان المدة", key: "durationLabel", width: 54 },
    { header: "تاريخ الاستلام الفعلي", key: "receivedAt", width: 22 },
    { header: "مصدر تاريخ الاستلام", key: "receiptSource", width: 24 },
    { header: "أول رصد للاستلام (ليس تاريخًا فعليًا)", key: "firstObservedAt", width: 30 },
  ];
  for (const row of ordersExportRows(report, filters, false, now)) sheet.addRow({ ...row,
    createdAt: row.createdAt ? new Date(`${orderDateLabel(row.createdAt)}T00:00:00Z`) : "غير متاح",
    quantity: row.quantity ?? "غير موثقة", batch: row.batch || "غير متاحة", supplier: row.supplier || "غير متاح",
    ageDays: row.ageDays,
    receivedAt: row.receivedAt && Number.isFinite(Date.parse(row.receivedAt))
      ? new Date(`${orderDateLabel(row.receivedAt)}T00:00:00Z`) : "غير متاح",
    firstObservedAt: row.firstObservedAt ? new Date(row.firstObservedAt) : "غير مرصود",
  });
  sheet.autoFilter = { from: "A1", to: "L1" };
  for (const page of [summary, sheet]) {
    page.eachRow((row, index) => {
      row.alignment = { vertical: "middle", horizontal: "right", wrapText: true, readingOrder: "rtl" };
      if (index === 1) {
        row.font = { bold: true, color: { argb: "FFFFFFFF" } };
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17685D" } };
      }
    });
  }
  sheet.getColumn("createdAt").numFmt = "yyyy-mm-dd";
  sheet.getColumn("receivedAt").numFmt = "yyyy-mm-dd";
  sheet.getColumn("firstObservedAt").numFmt = "yyyy-mm-dd hh:mm";
  sheet.getColumn("quantity").numFmt = "0.####";
  sheet.getColumn("batch").numFmt = "@";
  return workbook;
}

export async function buildOrdersPdf(report: PhifOrdersReport, filters: OrdersFilters, fonts: { regular: string; bold: string }, now = Date.now(), pendingOnly = true) {
  const view = ordersView(report, filters, now);
  if (view.periodError) throw new Error(view.periodError);
  const { Document, Page, Text, View, Font, pdf, StyleSheet } = await import("@react-pdf/renderer");
  Font.register({ family: "OrdersArabic", fonts: [{ src: fonts.regular }, { src: fonts.bold, fontWeight: 700 }] });
  Font.registerHyphenationCallback(word => word.length > 40 ? word.match(/.{1,24}/gu) || [word] : [word]);
  const style = StyleSheet.create({
    page: { paddingTop: 180, paddingBottom: 55, paddingHorizontal: 26, fontFamily: "OrdersArabic", fontSize: 10, color: "#20332f" },
    header: { position: "absolute", left: 26, right: 26, top: 20, textAlign: "right" },
    row: { flexDirection: "row-reverse", borderBottomWidth: .5, borderBottomColor: "#d0dbd7", minHeight: 28 },
    cell: { padding: 4, lineHeight: 1.4, textAlign: "right" },
    footer: { position: "absolute", bottom: 16, left: 26, right: 26, textAlign: "right", fontSize: 8, color: "#52645f" },
  });
  const columns = [
    ["رقم الطلب", 12], ["تاريخ الإنشاء", 9], ["الدواء", 20], ["المورد", 15],
    ["التشغيلة", 7], ["الكمية المعتمدة", 5], ["الحالة", 9], ["الاستلام المؤكد ومصدره", 10], ["أول رصد غير مؤكد", 8], ["المدة بالأيام", 5],
  ] as const;
  const rows = ordersExportRows(report, filters, pendingOnly, now);
  const title = pendingOnly ? "كشف أصناف الطلبيات غير المستلمة" : "كشف متابعة طلبيات PHIF";
  const document = <Document title={title} author={report.pharmacy} language="ar">
    <Page size="A4" orientation="landscape" style={style.page} wrap>
      <View style={style.header} fixed>
        <Text style={{ fontSize: 18, fontWeight: 700, color: "#17685d" }}>{report.pharmacy}</Text>
        <Text style={{ fontSize: 14, fontWeight: 700 }}>{title}</Text>
        <Text style={{ fontSize: 9 }}>{ordersPeriodLabel(filters)}</Text>
        <Text style={{ fontSize: 9 }}>{ordersFilterLabel(filters)}</Text>
        <Text style={{ fontSize: 9 }}>{`نسخة آخر مزامنة ناجحة: ${new Date(report.fetchedAt).toLocaleString("en-GB", { timeZone: "Africa/Tripoli", hour12: false })} | عدد البنود: ${rows.length}`}</Text>
        <Text style={{ fontSize: 9 }}>{`المدد محسوبة حتى إصدار التقرير: ${orderDateLabel(new Date(now).toISOString())}`}</Text>
      </View>
      <View fixed style={[style.row, { position: "absolute", top: 141, left: 26, right: 26, backgroundColor: "#e1eee8" }]}>
        {columns.map(([label, width]) => <Text key={label} style={[style.cell, { width: `${width}%`, fontSize: 9, fontWeight: 700 }]}>{label}</Text>)}
      </View>
      {rows.map((row, i) => <View key={i} wrap={false} style={[style.row, { backgroundColor: i % 2 ? "#f5f8f6" : "#ffffff" }]}>
        {[row.orderNumber, orderDateLabel(row.createdAt), row.medicine, row.supplier || "غير متاح", row.batch || "غير متاحة",
          row.quantity ?? "غير موثقة", row.status, `${orderDateLabel(row.receivedAt)}\n${row.receiptSource}`,
          row.firstObservedAt ? orderDateLabel(row.firstObservedAt) : "غير مرصود", row.ageDays ?? "غير متوفر"].map((cell, c) =>
          <Text key={c} style={[style.cell, { width: `${columns[c][1]}%`, fontSize: 8.5, direction: [0, 1, 4, 5, 8, 9].includes(c) ? "ltr" : "rtl" }]}>{String(cell)}</Text>)}
      </View>)}
      {!rows.length && <Text style={{ textAlign: "right", marginTop: 15 }}>لا توجد أصناف مطابقة ضمن الفلاتر المحددة</Text>}
      <Text fixed style={style.footer}>المدة حتى الاستلام المؤكد فقط للمستلم، وحتى إصدار التقرير لغير المستلم. أول رصد آلي ليس تاريخ استلام فعليًا ولا يدخل في حساب مدة الاستلام.</Text>
      <Text fixed style={{ position: "absolute", bottom: 34, left: 26, fontSize: 9 }} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </Page>
  </Document>;
  return pdf(document).toBlob();
}
