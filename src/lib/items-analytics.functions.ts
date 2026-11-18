import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  analyticsSearchSchema,
  authorizeAnalyticsRead,
  buildItemsAnalytics,
} from "./items-analytics.helpers";
import { ACTUAL_UNITS } from "./actual-units.helpers";
import { loadReportSettingScope, timedReportSetting } from "./report-setting-scope.server";
import { buildPhifAnalyticsPeriod } from "./phif-analytics-period.helpers";
import { supplierUnitInput } from "./report-supplier-unit.model";

const request = analyticsSearchSchema.extend({
  export: z.boolean().default(false),
  financial: z.boolean().default(false),
});

export const getPhifAnalyticsPeriod = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).parse(data))
  .handler(async ({ data }) => {
    const { loadItemAnalyticsDataset } = await import("./management.functions");
    let rights!: ReturnType<typeof authorizeAnalyticsRead>;
    const dataset = await loadItemAnalyticsDataset((context, access) => {
      rights = authorizeAnalyticsRead(context.session.data, access, { financial: false, export: false, source: "all" });
    });
    const { loadReportBoxSettings } = await import("./report-box-settings.server");
    const { settings, available, supplierUnitsAvailable } = await loadReportBoxSettings(dataset.admin, dataset.session.pharmacy_id);
    return buildPhifAnalyticsPeriod({ ...dataset, ...rights, pharmacyId: dataset.session.pharmacy_id,
      settings, settingsAvailable: available, supplierUnitsAvailable,
      filters: analyticsSearchSchema.parse({ month: data.month }) }, data.month);
  });

const readItemsAnalytics = createServerOnlyFn(async (data: z.infer<typeof request>) => timedReportSetting("report_refresh", async (measure) => {
    const { loadItemAnalyticsDataset } = await import("./management.functions");
    let rights!: ReturnType<typeof authorizeAnalyticsRead>;
    const dataset = await measure("report_data_read_and_profit", () => loadItemAnalyticsDataset((context, access) => {
      rights = authorizeAnalyticsRead(context.session.data, access, data);
    }));
    const { loadReportBoxSettings } = await import("./report-box-settings.server");
    const { settings, available, supplierUnitsAvailable } = await loadReportBoxSettings(
      dataset.admin,
      dataset.session.pharmacy_id,
    );
    return measure("report_rebuild", () => buildItemsAnalytics({
      ...dataset,
      pharmacyId: dataset.session.pharmacy_id,
      settings,
      ...rights,
      filters: data,
      settingsAvailable: available,
      supplierUnitsAvailable,
    }));
  }));

export const getItemsAnalytics = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => request.parse(data))
  .handler(({ data }) => readItemsAnalytics(data));

const analyticsExportInput = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  source: z.enum(["all", "actual", "phif"]), identity: z.string().min(1).max(1500) });
export const exportPhifAnalytics = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => analyticsExportInput.parse(data))
  .handler(async ({ data }) => {
    // Export authorization is mandatory here, independent of client flags or cached reads.
    const report = await readItemsAnalytics(request.parse({ month: data.month, source: data.source,
      q: "", sort: "consumption_desc", result: "all", mode: "cumulative", financial: false, export: true }));
    const { phifAnalyticsExportRows } = await import("./phif-analytics.model");
    return phifAnalyticsExportRows(report, data.source, data.identity);
  });

const boxInput = z.object({
  identity: z.string().min(5).max(1500),
  unitsPerBox: z.number().int().min(1).max(10000),
  baseUnit: z.enum(
    Object.keys(ACTUAL_UNITS) as [keyof typeof ACTUAL_UNITS, ...(keyof typeof ACTUAL_UNITS)[]],
  ),
  version: z.number().int().min(0),
  reviewItemId: z.string().uuid().optional(),
});
const settingReceipt = z.object({
  id: z.string().uuid(),
  item_identity: z.string(),
  units_per_box: z.number().int().positive(),
  base_unit: boxInput.shape.baseUnit,
  version: z.number().int().positive(),
  supplier_quantity_unit: boxInput.shape.baseUnit.nullable().optional(),
  supplier_unit_exceptions: z.record(z.string()).optional(),
});

export const saveReportBoxSetting = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => boxInput.parse(data))
  .handler(async ({ data }) =>
    timedReportSetting("box", async (measure) => {
      const { requireTiryaqPermission } = await import("./user-management.functions");
      const context = await requireTiryaqPermission("users_manage");
      const user = context.session.data;
      const actorId = user.user_id;
      if (!actorId || user.user_role !== "admin")
        throw new Error("حفظ حجم العلبة متاح لحساب المدير فقط");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: manager, error: managerError } = await supabaseAdmin
        .from("pharmacy_users")
        .select("id")
        .eq("id", actorId)
        .eq("pharmacy_id", context.pharmacy_id)
        .eq("role", "admin")
        .eq("is_active", true)
        .maybeSingle();
      if (managerError || !manager) throw new Error("تعذر إثبات صلاحية المدير الحالية");
      const item = await loadReportSettingScope(
        supabaseAdmin,
        context.pharmacy_id,
        data.identity,
        measure,
        data.reviewItemId ? { itemId: data.reviewItemId, baseUnit: data.baseUnit } : undefined,
      );
      if (!item || data.baseUnit === "strip" || data.baseUnit === "box")
        throw new Error("هوية الصنف أو الوحدة الأساسية تحتاج مراجعة");
      const { actualUnit } = await import("./actual-units.helpers");
      const formUnit = actualUnit(item.form);
      if (formUnit && formUnit !== data.baseUnit)
        throw new Error("وحدة محتوى العلبة تتعارض مع الشكل الدوائي المسجل");
      const { readReportPages } = await import("./report-pages.server");
      const existing = await measure("settings_read", () =>
        readReportPages(() =>
          supabaseAdmin
            .from("phif_report_box_settings")
            .select("id,item_identity,units_per_box,base_unit,version", { count: "exact" })
            .eq("pharmacy_id", context.pharmacy_id)
            .order("id"),
        ),
      );
      const { reportSettingKey } = await import("./report-medication-evidence.helpers");
      const aliases = existing.filter((s: any) => reportSettingKey(s.item_identity) === item.id);
      if (aliases.length > 1)
        throw new Error("إعدادات قديمة متعارضة لهذا الصنف؛ يلزم مراجعتها دون استبدال صامت");
      const stored = aliases.find((s: any) => s.item_identity === item.id) || aliases[0];
      const { data: saved, error } = await measure("database_rpc_roundtrip", () =>
        supabaseAdmin.rpc("set_phif_report_box_setting", {
          p_pharmacy_id: context.pharmacy_id,
          p_actor_id: actorId,
          p_identity: stored?.item_identity || item.id,
          p_units_per_box: data.unitsPerBox,
          p_base_unit: data.baseUnit,
          p_expected_version: data.version,
        }),
      );
      if (error)
        throw new Error(
          ["42P01", "PGRST202", "PGRST205"].includes(error.code)
            ? "يلزم تطبيق ترحيل إعدادات العلب المعتمد أولًا"
            : "تعذر حفظ حجم العلبة؛ ربما تغير الإعداد. حدّث الصفحة وأعد المحاولة",
        );
      const confirmed = settingReceipt.safeParse(saved);
      if (!confirmed.success)
        throw new Error("لم يؤكد الخادم حفظ الإعداد");
      return confirmed.data;
    }),
  );

export const saveReportSupplierUnit = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => supplierUnitInput.parse(data))
  .handler(async ({ data }) => {
    const { requireTiryaqPermission } = await import("./user-management.functions");
    const context = await requireTiryaqPermission("users_manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { saveSupplierUnit } = await import("./report-supplier-unit-save.server");
    return saveSupplierUnit(supabaseAdmin, context, data);
  });
