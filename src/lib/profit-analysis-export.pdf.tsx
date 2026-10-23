import React from "react";
import { Document, Page, Text, View, Font, pdf, StyleSheet } from "@react-pdf/renderer";
import { profitExportNotes, profitSourceLabel, type ExportCell, type ExportSection, type ProfitExport } from "./profit-analysis-export.model";

const styles = StyleSheet.create({
  page: { fontFamily: "ReportArabic", fontSize: 10, paddingTop: 158, paddingBottom: 52, paddingHorizontal: 30, color: "#202c29" },
  header: { position: "absolute", top: 20, left: 30, width: 781.89 },
  pharmacy: { fontSize: 18, fontWeight: 700, color: "#174b43", textAlign: "right", width: "100%" },
  title: { fontSize: 14, fontWeight: 700, textAlign: "right", width: "100%" },
  subtitle: { fontSize: 9, marginTop: 2, color: "#455a53", textAlign: "right", width: "100%" },
  tableHeader: { position: "absolute", top: 112, left: 30, right: 30, backgroundColor: "#e0ece7", flexDirection: "row-reverse", borderBottomWidth: 1, borderBottomColor: "#9aafa4" },
  row: { flexDirection: "row-reverse", borderBottomWidth: .5, borderBottomColor: "#d2dbd6", alignItems: "stretch", minHeight: 26 },
  cell: { padding: 5, textAlign: "right", lineHeight: 1.4, fontSize: 10 },
  footer: { position: "absolute", bottom: 16, left: 30, width: 781.89, fontSize: 8, textAlign: "right", color: "#455a53" },
});
const amount = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function pdfSection(section: ExportSection): ExportSection {
  if (section.id !== "details") return section;
  const originalName = (r: ExportCell[]) => {
    const name = `${r[2] || ""} ${r[3] || ""}`.trim();
    const key = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
    return name + (r[4] && key(String(r[4])) !== key(name) ? `\n${r[4]}` : "");
  };
  return { ...section, columns: [section.columns[0], section.columns[1], { title: "الصنف والاسم الأصلي", width: 45 }, section.columns[5], { title: "الكمية والوحدة", width: 20 }, ...section.columns.slice(8,12)],
    rows: section.rows.map(r => [r[0], r[1], originalName(r), r[5], `${r[6] ?? "غير محدد"} ${r[7] || "وحدة غير موثقة"}`, ...r.slice(8,11), `${r[11]}${r[12] ? `\n${r[12]}` : ""}`]) };
}
function valueText(section: ExportSection, value: ExportCell, column: number, row: number) {
  if (value == null) return "غير مكتمل / غير متاح";
  const kind = section.id === "summary" && column === 1 ? row < 3 ? "money" : row === 3 ? "percent" : "number" : section.columns[column].kind;
  return typeof value === "number" ? kind === "money" ? amount(value) : kind === "percent" ? `${(value * 100).toFixed(2)}%` : String(value) : value;
}
function ExecutivePage({ data, format }: { data: ProfitExport; format: string }) {
  return <Page size="A4" orientation="landscape" style={[styles.page, { paddingTop: 112 }]}>
    <View style={styles.header} fixed>
      <Text style={styles.pharmacy}>{data.meta.pharmacy}</Text>
      <Text style={styles.title}>تقرير تحليل الأرباح - {format}</Text>
      <Text style={styles.subtitle}>{`${data.meta.dateFrom} - ${data.meta.dateTo} | ${profitSourceLabel(data.meta.source)} | إصدار ${data.meta.issuedAt.slice(0,10)}`}</Text>
    </View>
    <Text style={{ fontWeight: 700, textAlign: "right", fontSize: 13, marginBottom: 8 }}>الملخص المالي</Text>
    <View style={{ flexDirection: "row-reverse", flexWrap: "wrap" }}>
      {data.summary.rows.map((row, i) => <View key={i} wrap={false} style={{ width: "50%", flexDirection: "row-reverse", borderBottomWidth: .5, borderBottomColor: "#d2dbd6", paddingVertical: 5, paddingHorizontal: 8 }}>
        <Text style={{ width: "68%", textAlign: "right" }}>{row[0]}</Text>
        <Text style={{ width: "32%", direction: "ltr", textAlign: "left", fontWeight: 700 }}>{valueText(data.summary,row[1],1,i)}</Text>
      </View>)}
    </View>
    <Text style={{ fontWeight: 700, textAlign: "right", fontSize: 13, marginTop: 16, marginBottom: 6 }}>مقارنة المصادر</Text>
    <View wrap={false}>
      <View style={[styles.row, { backgroundColor: "#e0ece7" }]}>{data.sources.columns.map((c, i) => <Text key={i} style={[styles.cell, { width: `${100 / data.sources.columns.length}%`, fontWeight: 700, fontSize: 9 }]}>{c.title}</Text>)}</View>
      {data.sources.rows.map((row, r) => <View key={r} style={styles.row}>{row.map((v, c) => <Text key={c} style={[styles.cell, { width: `${100 / row.length}%`, direction: typeof v === "number" ? "ltr" : "rtl" }]}>{valueText(data.sources,v,c,r)}</Text>)}</View>)}
    </View>
    <Text style={styles.footer} fixed>{profitExportNotes}</Text>
    <Text fixed style={{ position: "absolute", bottom: 34, left: 30, fontSize: 9 }} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
  </Page>;
}
function ReportPage({ data, section, format }: { data: ProfitExport; section: ExportSection; format: string }) {
  const table = pdfSection(section);
  const weight = table.columns.reduce((n, c) => n + (c.width || 18), 0);
  const widths = table.columns.map(c => `${(c.width || 18) / weight * 100}%` as `${number}%`);
  const rows = table.totals ? [...table.rows, table.totals] : table.rows;
  return <Page size="A4" orientation="landscape" style={styles.page} wrap>
    <View style={styles.header} fixed>
      <Text style={styles.pharmacy}>{data.meta.pharmacy}</Text>
      <Text style={styles.title}>تقرير تحليل الأرباح - {format}</Text>
      <Text style={styles.subtitle}>{`${data.meta.dateFrom} - ${data.meta.dateTo} | ${profitSourceLabel(data.meta.source)} | إصدار ${data.meta.issuedAt.slice(0,10)}`}</Text>
      <Text style={{ fontWeight: 700, marginTop: 4, textAlign: "right", width: "100%" }}>{table.title}</Text>
    </View>
    <View style={styles.tableHeader} fixed>{table.columns.map((c, i) => <Text key={i} style={[styles.cell, { width: widths[i], fontSize: 9, fontWeight: 700, direction: "rtl" }]}>{c.title}</Text>)}</View>
    {rows.map((row, ri) => <View key={ri} wrap={false} style={[styles.row, { backgroundColor: ri >= table.rows.length ? "#e0ece7" : ri % 2 ? "#f5f7f6" : "#ffffff" }]}>
      {row.map((value, ci) => <Text key={ci} style={[styles.cell, { width: widths[ci], direction: typeof value === "number" || table.columns[ci].kind === "date" ? "ltr" : "rtl",
        color: typeof value === "number" && /ربح/.test(table.columns[ci].title) ? value < 0 ? "#ad271b" : "#087443" : "#202c29", fontWeight: ri >= table.rows.length ? 700 : 400 }]}>{valueText(table,value,ci,ri)}</Text>)}
    </View>)}
    {!rows.length && <Text style={{ textAlign: "right", margin: 16 }}>لا توجد بيانات مطابقة للفلاتر</Text>}
    <Text style={styles.footer} fixed>{profitExportNotes}</Text>
    <Text fixed style={{ position: "absolute", bottom: 34, left: 30, fontSize: 9 }} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
  </Page>;
}
export async function buildProfitPdf(data: ProfitExport, full: boolean, fonts: { regular: string; bold: string }) {
  Font.register({ family: "ReportArabic", fonts: [{ src: fonts.regular }, { src: fonts.bold, fontWeight: 700 }] });
  Font.registerHyphenationCallback(word => word.length > 40 ? word.match(/.{1,24}/gu) || [word] : [word]);
  const top = (section: ExportSection, title: string) => ({ ...section, title, rows: section.rows.slice(0,10), totals: undefined });
  const sections: ExportSection[] = [top(data.beneficiaries,"أعلى 10 مستفيدين إيرادًا"), top(data.revenueItems,"أعلى 10 أصناف إيرادًا"), top(data.profitItems,"أعلى 10 أصناف ربحًا")];
  if (full) sections.push(data.beneficiaries, data.revenueItems, data.profitItems, data.invoices, data.details);
  const document = <Document title="تقرير تحليل الأرباح" author={data.meta.pharmacy} subject={`${data.meta.dateFrom} - ${data.meta.dateTo}`} language="ar">
    <ExecutivePage data={data} format={full ? "مالي تفصيلي" : "إداري مختصر"} />
    {sections.map((s, i) => <ReportPage key={`${s.id}-${i}`} data={data} section={s} format={full ? "مالي تفصيلي" : "إداري مختصر"} />)}
  </Document>;
  return pdf(document).toBlob();
}
