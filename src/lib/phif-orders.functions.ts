import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ordersExportAllowed } from "./phif-orders.helpers";

export const getPhifOrders = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => z.object({ export: z.boolean().default(false) }).parse(data))
  .handler(async ({ data }) => {
    const { requireTiryaqPermission } = await import("./user-management.functions");
    const context = await requireTiryaqPermission("inventory_read");
    const canExport = ordersExportAllowed(context.session.data);
    if (data.export && !canExport) throw new Error("لا تملك صلاحية تصدير التقارير");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { readPhifOrders } = await import("./phif-orders.server");
    const report = await readPhifOrders(supabaseAdmin, context.pharmacy_id);
    if (data.export && !report.complete) throw new Error("لا يمكن إصدار كشف كامل قبل نجاح قراءة تفاصيل جميع الطلبات");
    return { ...report, pharmacy: context.session.data.pharmacy_name || "الصيدلية الحالية", canExport };
  });
