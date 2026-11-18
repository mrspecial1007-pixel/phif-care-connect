import { actualUnit } from "./actual-units.helpers";
import { loadReportSettingScope, timedReportSetting } from "./report-setting-scope.server";
import { loadReportBoxSettings } from "./report-box-settings.server";
import { reportSettingKey } from "./report-medication-evidence.helpers";
import { supplierUnitInput, supplierSettingReceipt } from "./report-supplier-unit.model";

export async function requireSupplierUnitManager(db: any, context: any) {
  const actorId = context.session.data.user_id;
  if (!actorId || context.session.data.user_role !== "admin") throw new Error("توثيق وحدة PHIF Supplier متاح للمدير فقط");
  const { data, error } = await db.from("pharmacy_users").select("id").eq("id", actorId)
    .eq("pharmacy_id", context.pharmacy_id).eq("role", "admin").eq("is_active", true).maybeSingle();
  if (error || !data) throw new Error("تعذر إثبات صلاحية المدير الحالية");
}

/** The individual editor and bulk confirmation share the same authorization, validation and RPC. */
export async function saveSupplierUnit(db: any, context: any, input: unknown,
  beforeWrite?: (item: Awaited<ReturnType<typeof loadReportSettingScope>>, setting: any) => Promise<void>) {
  const data = supplierUnitInput.parse(input);
  return timedReportSetting("supplier_unit", async measure => {
    await requireSupplierUnitManager(db, context);
    const item = await loadReportSettingScope(db, context.pharmacy_id, data.identity, measure, undefined, { includeQuantity: !!beforeWrite });
    const stored = await measure("settings_read", () => loadReportBoxSettings(db, context.pharmacy_id));
    if (!stored.supplierUnitsAvailable) throw new Error("يلزم تطبيق ترحيل توثيق وحدات PHIF Supplier أولًا");
    const aliases = stored.settings.filter(s => reportSettingKey(s.item_identity) === item.id);
    if (!aliases.length) throw new Error("احفظ حجم علبة PHIF Supplier أولًا");
    if (aliases.length !== 1) throw new Error("توجد إعدادات قديمة متعددة للصنف؛ يلزم مراجعتها دون استبدال أي إعداد بصمت");
    if (aliases[0].version !== data.version) throw new Error("تغير إصدار التعريف؛ أعد المعاينة دون استبدال التعديل الأحدث");
    if (data.unit && !["box", "strip", actualUnit(item.form)].includes(data.unit)) throw new Error("وحدة الصرف تتعارض مع الشكل الدوائي");
    const relevant = new Map<string, number>();
    for (const row of item.items.filter(i => i.source_classification === "phif-supplier"))
      relevant.set(row.phif_invoice_id, (relevant.get(row.phif_invoice_id) || 0) + 1);
    const exceptions: Record<string, string> = {};
    for (const exception of data.exceptions) {
      if (relevant.get(exception.invoiceId) !== 1 || (exception.unit !== "unknown" &&
        (!actualUnit(exception.unit) || !["box", "strip", actualUnit(item.form)].includes(actualUnit(exception.unit)))) || exceptions[exception.invoiceId])
        throw new Error("استثناء الفاتورة غير متوافق أو مكرر");
      exceptions[exception.invoiceId] = exception.unit === "unknown" ? "unknown" : actualUnit(exception.unit)!;
    }
    await beforeWrite?.(item, aliases[0]);
    await requireSupplierUnitManager(db, context);
    const { data: saved, error } = await measure("database_rpc_roundtrip", () => db.rpc("set_phif_report_supplier_unit", {
      p_pharmacy_id: context.pharmacy_id, p_actor_id: context.session.data.user_id, p_identity: aliases[0].item_identity,
      p_unit: data.unit, p_exceptions: exceptions, p_expected_version: data.version,
    }));
    if (error) throw new Error("تعذر حفظ توثيق الوحدة؛ تحقق من الترحيل وحدّث الصفحة قبل إعادة المحاولة");
    const confirmed = supplierSettingReceipt.safeParse(saved);
    if (!confirmed.success || confirmed.data.id !== aliases[0].id || confirmed.data.item_identity !== aliases[0].item_identity)
      throw new Error("لم يؤكد الخادم حفظ توثيق الوحدة؛ يلزم التحقق قبل إعادة المحاولة");
    return confirmed.data;
  });
}
