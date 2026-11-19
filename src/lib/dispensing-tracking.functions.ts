import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { trackingInput } from "./dispensing-tracking.model";

export const readDispensingTracking = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => trackingInput.parse(data))
  .handler(async ({ data }) => {
    const { loadTrackingReport } = await import("./dispensing-tracking.server");
    return loadTrackingReport(data, false);
  });

export const exportDispensingTracking = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({ filters: trackingInput, revision: z.string().length(64) })
      .strict()
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { loadTrackingReport } = await import("./dispensing-tracking.server");
    const result = await loadTrackingReport(data.filters, true);
    if (result.revision !== data.revision)
      throw new Error("تغيرت نتائج التقرير منذ عرضها؛ اضغط تحديث قبل التصدير");
    return result;
  });
