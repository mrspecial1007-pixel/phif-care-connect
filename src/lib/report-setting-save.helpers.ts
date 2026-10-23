import type { QueryClient, QueryKey } from "@tanstack/react-query";

export async function reportSettingRequest<T>(save: () => Promise<T>) {
  const start = performance.now();
  try {
    return await save();
  } finally {
    console.info("phif_report_setting_client_timing", {
      phase: "save_api",
      ms: Math.round(performance.now() - start),
    });
  }
}

/** A confirmed write must not wait for unrelated report reads. Never hide a refresh failure. */
export function refreshReportAfterSettingSave(
  client: QueryClient,
  key: QueryKey,
  onError: () => void,
) {
  const start = performance.now();
  void client
    .invalidateQueries({ queryKey: ["items_analytics"], refetchType: "none" })
    .then(() =>
      client.refetchQueries({ queryKey: key, exact: true, type: "active" }, { throwOnError: true }),
    )
    .catch(onError)
    .finally(() =>
      console.info("phif_report_setting_client_timing", {
        phase: "report_refresh",
        ms: Math.round(performance.now() - start),
      }),
    );
}
