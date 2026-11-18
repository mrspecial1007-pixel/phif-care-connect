import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const previewReadySupplierUnits = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({}).strict().parse(data))
  .handler(async () => {
    const { requireTiryaqPermission } = await import("./user-management.functions");
    const context = await requireTiryaqPermission("users_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { previewBulkSupplierUnits } = await import("./definition-audit-bulk.server");
    return previewBulkSupplierUnits(supabaseAdmin, context);
  });

export const confirmReadySupplierUnit = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ token: z.string().min(1).max(12000), confirm: z.literal(true) }).strict().parse(data))
  .handler(async ({ data }) => {
    const { requireTiryaqPermission } = await import("./user-management.functions");
    const context = await requireTiryaqPermission("users_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { executeBulkSupplierUnit } = await import("./definition-audit-bulk.server");
    return executeBulkSupplierUnit(supabaseAdmin, context, data.token);
  });
