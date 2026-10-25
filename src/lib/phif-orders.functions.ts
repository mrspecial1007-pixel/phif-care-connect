import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getPhifOrders = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => z.object({ export: z.boolean().default(false) }).parse(data))
  .handler(async ({ data }) => {
    const { readAuthorizedPhifOrders } = await import("./phif-orders-service.server");
    return readAuthorizedPhifOrders(data);
  });

// POST plus no-store prevents an encryption key from entering HTTP or service-worker caches.
export const getPhifOrdersStorageAccess = createServerFn({ method: "POST" }).handler(async () => {
  const { readOrdersStorageAccess } = await import("./phif-orders-service.server");
  return readOrdersStorageAccess();
});

/** Official exports recheck current permissions and the signed snapshot, without a PHIF session. */
export const authorizePhifOrdersSnapshot = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ snapshot: z.unknown() }).parse(data))
  .handler(async ({ data }) => {
    const { exportAuthorizedOrdersSnapshot } = await import("./phif-orders-service.server");
    return exportAuthorizedOrdersSnapshot(data.snapshot);
  });
