import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { verifyActualUnitAdmin } from "./actual-units.auth";
import { actualUnitPreview, actualDecisionInput, actualImportedSnapshot, actualPricingSnapshot } from "./actual-units.preview";
import { actualUnitSourceSignature, actualStockUnitSignature, ACTUAL_UNITS, actualCostUnits } from "./actual-units.helpers";

const scopeSchema = z.object({ itemId: z.string().uuid(), dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional() }).refine(d => !d.dateFrom || !d.dateTo || d.dateFrom <= d.dateTo, "نطاق التاريخ غير صالح");
const units = z.enum(Object.keys(ACTUAL_UNITS) as [keyof typeof ACTUAL_UNITS, ...(keyof typeof ACTUAL_UNITS)[]]);

async function previewForManager(scope: z.infer<typeof scopeSchema>) {
  const { requirePharmacySession } = await import("./pharmacy-session.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const context = await verifyActualUnitAdmin(supabaseAdmin, await requirePharmacySession(), process.env.SESSION_SECRET);
  const { loadAllReportDataset, loadStockWithCosts } = await import("./management.functions");
  const { loadActualUnitDecisions } = await import("./actual-units.server");
  const dataset = await loadAllReportDataset(context.db, context.pharmacyId);
  const stocks = await loadStockWithCosts(context.db, context.pharmacyId);
  const loaded = await loadActualUnitDecisions(context.db, context.pharmacyId, dataset.items);
  return { ...context, available: loaded.available, ...actualUnitPreview({ ...dataset, items: loaded.items, stocks, scope, decisions: loaded.decisions }) };
}

export const getActualUnitEditor = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => scopeSchema.parse(input))
  .handler(async ({ data }) => {
    const preview = await previewForManager(data);
    let operations: any[] = [];
    const anchor = preview.rows.find(row => row.id === data.itemId)?.decision;
    if (anchor) {
      const result = await preview.db.from("user_operation_log").select("action,created_at,metadata")
        .eq("pharmacy_id", preview.pharmacyId).eq("entity", "phif_actual_unit_decision").eq("entity_id", anchor.id)
        .order("created_at", { ascending: false }).limit(50);
      if (result.error) throw new Error("تعذر تحميل سجل اعتماد الوحدات");
      operations = (result.data ?? []).map((operation: any) => ({ action: operation.action, at: operation.created_at,
        actor: operation.metadata?.actor, before: operation.metadata?.before?.dispensing_unit,
        after: operation.metadata?.after?.dispensing_unit, cost_unit: operation.metadata?.after?.cost_unit }));
    }
    // Never send the service client, context or imported patient data to the browser.
    return { available: preview.available, stock: preview.stock, rows: preview.rows, summary: preview.summary, operations };
  });

export const saveActualUnits = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ scope: scopeSchema, confirmed: z.literal(true), revoke: z.boolean(),
    dispensingUnit: units, costUnit: units, suggestedOnly: z.boolean().default(false),
    rows: z.array(z.object({ id: z.string().uuid(), version: z.number().int().min(0), signature: z.string(), stockSignature: z.string(), priceSignature: z.string().optional() })).min(1).max(1000),
  }).parse(input))
  .handler(async ({ data }) => {
    const preview = await previewForManager(data.scope);
    if (!preview.available) throw new Error("يلزم تطبيق migration توثيق وحدات Actual أولًا");
    const selected = actualDecisionInput(preview, data);
    const payload = selected.map(({ item, stock, row }: any) => {
      const decision = { phif_invoice_item_id: item.id, source_signature: actualUnitSourceSignature(item),
        stock_signature: actualStockUnitSignature(stock), dispensing_unit: data.dispensingUnit, cost_unit: data.costUnit,
        is_active: true, version: row.version + 1 };
      if (!data.revoke) {
        const check = actualCostUnits({ ...item, actual_unit_decision: decision }, stock);
        if (check.issue) throw new Error("تحويل الوحدة غير موثق؛ راجع وحدة السعر وبيانات العبوة");
      }
      return { item_id: item.id, stock_id: stock.id, expected_version: row.version,
        source_signature: decision.source_signature, stock_signature: decision.stock_signature,
        imported: actualImportedSnapshot(item), pricing: actualPricingSnapshot(stock),
        expected_link_version: item.manual_stock_link?.version ?? 0 };
    });
    const { data: affected, error } = await preview.db.rpc("set_phif_actual_units", { p_pharmacy_id: preview.pharmacyId,
      p_user_id: preview.actorId, p_actor: preview.actor, p_rows: payload,
      p_dispensing_unit: data.dispensingUnit, p_cost_unit: data.costUnit, p_revoke: data.revoke });
    if (error) throw new Error(error.code === "PGRST202" ? "دالة اعتماد الوحدات غير متاحة في الإصدار المنشور؛ تحقق من تطبيق migration وتحديث مخطط API"
      : error.code === "42501" ? "رفض الخادم صلاحية الاعتماد؛ تحقق من حساب المدير وصلاحية RPC للخادم فقط"
      : "لم يُحفظ القرار. قد تكون البيانات تغيرت؛ حدّث المعاينة وحاول مجددًا.");
    return { saved: true, affected: Number(affected) };
  });
