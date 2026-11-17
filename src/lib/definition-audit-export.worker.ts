import { buildAuditReviewWorkbook } from "./definition-audit-export.xlsx";
import type { AuditReviewExport } from "./definition-audit-export.model";

self.onmessage = async (event: MessageEvent<AuditReviewExport>) => {
  try {
    const buffer = await buildAuditReviewWorkbook(event.data).xlsx.writeBuffer();
    const bytes = new Uint8Array(buffer).slice().buffer;
    self.postMessage({ bytes }, { transfer: [bytes] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "تعذر إنشاء ملف Excel" });
  }
};
