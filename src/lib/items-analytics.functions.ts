import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  analyticsSearchSchema,
  authorizeAnalyticsRead,
  buildItemsAnalytics,
  type BoxSetting,
} from "./items-analytics.helpers";
import { ACTUAL_UNITS } from "./actual-units.helpers";

const request = analyticsSearchSchema.extend({
  export: z.boolean().default(false),
  financial: z.boolean().default(false),
});

export const getItemsAnalytics = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => request.parse(data))
  .handler(async ({ data }) => {
    const { loadItemAnalyticsDataset } = await import("./management.functions");
    let rights!: ReturnType<typeof authorizeAnalyticsRead>;
    const dataset = await loadItemAnalyticsDataset((context, access) => {
      rights = authorizeAnalyticsRead(context.session.data, access, data);
    });
    let settings: BoxSetting[] = [],
      missingTable = false;
    const { readReportPages } = await import("./report-pages.server");
    try {
      settings = (await readReportPages(() =>
        dataset.admin
          .from("phif_report_box_settings")
          .select("id,item_identity,units_per_box,base_unit,version", { count: "exact" })
          .eq("pharmacy_id", dataset.session.pharmacy_id)
          .order("id"),
      )) as BoxSetting[];
    } catch {
      const { error } = await dataset.admin
        .from("phif_report_box_settings")
        .select("id")
        .eq("pharmacy_id", dataset.session.pharmacy_id)
        .limit(1);
      missingTable = Boolean(error && ["42P01", "PGRST205"].includes(error.code));
      if (!missingTable) throw new Error("تعذر تحميل إعدادات أحجام العلب؛ حاول مجددًا");
    }
    return buildItemsAnalytics({
      ...dataset,
      settings,
      ...rights,
      filters: data,
      settingsAvailable: !missingTable,
    });
  });

const boxInput = z.object({
  identity: z.string().min(5).max(1500),
  unitsPerBox: z.number().int().min(1).max(10000),
  baseUnit: z.enum(
    Object.keys(ACTUAL_UNITS) as [keyof typeof ACTUAL_UNITS, ...(keyof typeof ACTUAL_UNITS)[]],
  ),
  version: z.number().int().min(0),
});

export const saveReportBoxSetting = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => boxInput.parse(data))
  .handler(async ({ data }) => {
    const { requireTiryaqPermission } = await import("./user-management.functions");
    const context = await requireTiryaqPermission("users_manage");
    const user = context.session.data;
    if (!user.user_id || user.user_role !== "admin")
      throw new Error("حفظ حجم العلبة متاح لحساب المدير فقط");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: manager, error: managerError } = await supabaseAdmin
      .from("pharmacy_users")
      .select("id")
      .eq("id", user.user_id)
      .eq("pharmacy_id", context.pharmacy_id)
      .eq("role", "admin")
      .eq("is_active", true)
      .maybeSingle();
    if (managerError || !manager) throw new Error("تعذر إثبات صلاحية المدير الحالية");
    // Validate identity against a fresh, pharmacy-scoped dataset, never trust a client-supplied scientific key.
    const { loadItemAnalyticsDataset } = await import("./management.functions");
    const dataset = await loadItemAnalyticsDataset();
    const view = buildItemsAnalytics({
      ...dataset,
      settings: [],
      filters: analyticsSearchSchema.parse({ month: "all" }),
      access: dataset.access,
    });
    const item = view.items.find((i) => i.id === data.identity && i.identityComplete);
    if (!item || data.baseUnit === "strip" || data.baseUnit === "box")
      throw new Error("هوية الصنف أو الوحدة الأساسية تحتاج مراجعة");
    const { actualUnit } = await import("./actual-units.helpers");
    const formUnit = actualUnit(item.form);
    if (formUnit && formUnit !== data.baseUnit)
      throw new Error("وحدة محتوى العلبة تتعارض مع الشكل الدوائي المسجل");
    const { readReportPages } = await import("./report-pages.server");
    const existing = await readReportPages(() =>
      supabaseAdmin
        .from("phif_report_box_settings")
        .select("id,item_identity,units_per_box,base_unit,version", { count: "exact" })
        .eq("pharmacy_id", context.pharmacy_id)
        .order("id"),
    );
    const { reportSettingKey } = await import("./report-medication-evidence.helpers");
    const aliases = existing.filter((s: any) => reportSettingKey(s.item_identity) === item.id);
    if (aliases.length > 1)
      throw new Error("إعدادات قديمة متعارضة لهذا الصنف؛ يلزم مراجعتها دون استبدال صامت");
    const stored = aliases.find((s: any) => s.item_identity === item.id) || aliases[0];
    const { data: saved, error } = await supabaseAdmin.rpc("set_phif_report_box_setting", {
      p_pharmacy_id: context.pharmacy_id,
      p_actor_id: user.user_id,
      p_identity: stored?.item_identity || item.id,
      p_units_per_box: data.unitsPerBox,
      p_base_unit: data.baseUnit,
      p_expected_version: data.version,
    });
    if (error)
      throw new Error(
        ["42P01", "PGRST202", "PGRST205"].includes(error.code)
          ? "يلزم تطبيق ترحيل إعدادات العلب المعتمد أولًا"
          : "تعذر حفظ حجم العلبة؛ ربما تغير الإعداد. حدّث الصفحة وأعد المحاولة",
      );
    return saved;
  });
