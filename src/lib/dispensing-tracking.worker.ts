import { buildTrackingWorkbook } from "./dispensing-tracking.xlsx";
import type { TrackingReport } from "./dispensing-tracking.server";
self.onmessage = async (event: MessageEvent<TrackingReport>) => {
  try {
    const buffer = await (await buildTrackingWorkbook(event.data)).xlsx.writeBuffer();
    const bytes = new Uint8Array(buffer).slice().buffer;
    self.postMessage({ bytes }, { transfer: [bytes] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "تعذر إنشاء Excel" });
  }
};
