import { createServerFn } from "@tanstack/react-start";

export const getPhifConnectionIndicator = createServerFn({ method: "GET" }).handler(async () => {
  const { setResponseHeader } = await import("@tanstack/react-start/server");
  setResponseHeader("Cache-Control", "no-store, private");
  const { requirePharmacySession } = await import("./pharmacy-session.server");
  const { pharmacy_id } = await requirePharmacySession();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { readPhifConnectionStatus } = await import("./phif-connection.server");
  return readPhifConnectionStatus(supabaseAdmin, pharmacy_id);
});
