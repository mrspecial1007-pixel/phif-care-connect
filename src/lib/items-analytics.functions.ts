import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  analyticsSearchSchema,
  authorizeAnalyticsRead,
  buildItemsAnalytics,
} from "./items-analytics.helpers";
import { ACTUAL_UNITS } from "./actual-units.helpers";
import { loadReportSettingScope, timedReportSetting } from "./report-setting-scope.server";

const request = analyticsSearchSchema.extend({
  export: z.boolean().default(false),
  financial: z.boolean().default(false),
});

export const getItemsAnalytics = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => request.parse(data))
  .handler(async ({ data }) => timedReportSetting("report_refresh", async (measure) => {
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

const boxInput = z.object({
  identity: z.string().min(5).max(1500),
  unitsPerBox: z.number().int().min(1).max(10000),
  baseUnit: z.enum(
    Object.keys(ACTUAL_UNITS) as [keyof typeof ACTUAL_UNITS, ...(keyof typeof ACTUAL_UNITS)[]],
  ),
  version: z.number().int().min(0),
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

const supplierUnitInput = z.object({
  identity: z.string().min(5).max(1500),
  unit: z
    .enum(
      Object.keys(ACTUAL_UNITS) as [keyof typeof ACTUAL_UNITS, ...(keyof typeof ACTUAL_UNITS)[]],
    )
    .nullable(),
  exceptions: z
    .array(z.object({ invoiceId: z.string().uuid(), unit: z.string().max(20) }))
    .max(200),
  version: z.number().int().min(1),
});
export const saveReportSupplierUnit = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => supplierUnitInput.parse(data))
  .handler(async ({ data }) =>
    timedReportSetting("supplier_unit", async (measure) => {
      const { requireTiryaqPermission } = await import("./user-management.functions");
      const context = await requireTiryaqPermission("users_manage");
      const user = context.session.data;
      const actorId = user.user_id;
      if (!actorId || user.user_role !== "admin")
        throw new Error("توثيق وحدة PHIF Supplier متاح للمدير فقط");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const item = await loadReportSettingScope(
        supabaseAdmin,
        context.pharmacy_id,
        data.identity,
        measure,
      );
      const { loadReportBoxSettings } = await import("./report-box-settings.server");
      const stored = await measure("settings_read", () =>
        loadReportBoxSettings(supabaseAdmin, context.pharmacy_id),
      );
      if (!stored.supplierUnitsAvailable)
        throw new Error("يلزم تطبيق ترحيل توثيق وحدات PHIF Supplier أولًا");
      const { reportSettingKey } = await import("./report-medication-evidence.helpers");
      const aliases = stored.settings.filter((s) => reportSettingKey(s.item_identity) === item.id);
      if (!aliases.length) throw new Error("احفظ حجم علبة PHIF Supplier أولًا");
      if (aliases.length !== 1)
        throw new Error("توجد إعدادات قديمة متعددة للصنف؛ يلزم مراجعتها دون استبدال أي إعداد بصمت");
      const { actualUnit } = await import("./actual-units.helpers");
      if (data.unit && !["box", "strip", actualUnit(item.form)].includes(data.unit))
        throw new Error("وحدة الصرف تتعارض مع الشكل الدوائي");
      const relevant = new Map<string, number>();
      for (const row of item.items.filter((i) => i.source_classification === "phif-supplier"))
        relevant.set(row.phif_invoice_id, (relevant.get(row.phif_invoice_id) || 0) + 1);
      const exceptions: Record<string, string> = {};
      for (const exception of data.exceptions) {
        if (
          relevant.get(exception.invoiceId) !== 1 ||
          (exception.unit !== "unknown" &&
            (!actualUnit(exception.unit) ||
              !["box", "strip", actualUnit(item.form)].includes(actualUnit(exception.unit)))) ||
          exceptions[exception.invoiceId]
        )
          throw new Error("استثناء الفاتورة غير متوافق أو مكرر");
        exceptions[exception.invoiceId] =
          exception.unit === "unknown" ? "unknown" : actualUnit(exception.unit)!;
      }
      const { data: saved, error } = await measure("database_rpc_roundtrip", () =>
        supabaseAdmin.rpc("set_phif_report_supplier_unit", {
          p_pharmacy_id: context.pharmacy_id,
          p_actor_id: actorId,
          p_identity: aliases[0].item_identity,
          p_unit: data.unit,
          p_exceptions: exceptions,
          p_expected_version: data.version,
        }),
      );
      if (error)
        throw new Error("تعذر حفظ توثيق الوحدة؛ تحقق من الترحيل وحدّث الصفحة قبل إعادة المحاولة");
      const confirmed = settingReceipt.safeParse(saved);
      if (!confirmed.success)
        throw new Error("لم يؤكد الخادم حفظ توثيق الوحدة");
      return confirmed.data;
    }),
  );
