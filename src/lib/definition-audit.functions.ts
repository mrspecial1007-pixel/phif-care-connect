import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { runAuthorizedDefinitionAudit } from "./definition-audit.request";

export const runDefinitionAuditReport = createServerFn({ method: "POST" })
  .inputValidator((value: unknown) => z.object({}).strict().parse(value))
  .handler(async () => {
    const { requirePharmacySession } = await import("./pharmacy-session.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requireDefinitionAuditAdmin, runDefinitionAudit } = await import("./definition-audit.server");
    return runAuthorizedDefinitionAudit(requirePharmacySession, supabaseAdmin, requireDefinitionAuditAdmin, runDefinitionAudit);
  });
