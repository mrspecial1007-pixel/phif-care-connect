import { profitExportFilename, type ProfitExport, type ProfitExportFormat } from "./profit-analysis-export.model";

self.onmessage = async (event: MessageEvent<{ data: ProfitExport; format: ProfitExportFormat; fonts: { regular: string; bold: string } }>) => {
  const { data, format, fonts } = event.data;
  const progress = (message: string) => self.postMessage({ progress: message });
  try {
    let bytes: ArrayBuffer;
    if (format === "xlsx") {
      const { buildProfitWorkbook } = await import("./profit-analysis-export.xlsx");
      const workbook = await buildProfitWorkbook(data, progress);
      progress("تجهيز مصنف Excel للتحميل");
      const buffer = await workbook.xlsx.writeBuffer();
      bytes = new Uint8Array(buffer).slice().buffer;
    } else {
      progress("تنسيق صفحات PDF العربية");
      const { buildProfitPdf } = await import("./profit-analysis-export.pdf");
      bytes = await (await buildProfitPdf(data, format === "pdf-full", fonts)).arrayBuffer();
    }
    self.postMessage({ bytes, filename: profitExportFilename(data, format), mime: format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf" }, { transfer: [bytes] });
  } catch {
    self.postMessage({ error: "تعذر إنشاء الملف. حاول مجددًا أو قلّل نطاق الفترة عند محدودية ذاكرة الجهاز." });
  }
};
