import { buildOrdersPdf, buildOrdersWorkbook } from "./phif-orders-export";

self.onmessage = async ({ data: { report, filters, format, fonts } }) => {
  try {
    const bytes = format === "xlsx"
      ? await (await buildOrdersWorkbook(report, filters)).xlsx.writeBuffer()
      : await (await buildOrdersPdf(report, filters, fonts)).arrayBuffer();
    const buffer = new Uint8Array(bytes as ArrayBuffer).buffer;
    self.postMessage({ bytes: buffer, mime: format === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf",
      filename: `phif-orders-${report.fetchedAt.slice(0, 10)}.${format}` }, { transfer: [buffer] });
  } catch { self.postMessage({ error: "تعذر إنشاء كشف الطلبيات" }); }
};
