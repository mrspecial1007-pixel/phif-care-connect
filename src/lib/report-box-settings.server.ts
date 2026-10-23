import { readReportPages } from "./report-pages.server";
import type { BoxSetting } from "./items-analytics.helpers";

export async function loadReportBoxSettings(db: any, pharmacyId: string) {
  const probe = await db
    .from("phif_report_box_settings")
    .select("supplier_quantity_unit")
    .eq("pharmacy_id", pharmacyId)
    .limit(1);
  if (["42P01", "PGRST205"].includes(probe.error?.code))
    return { settings: [] as BoxSetting[], available: false, supplierUnitsAvailable: false };
  const supplierUnitsAvailable = !probe.error;
  if (probe.error && !["42703", "PGRST204"].includes(probe.error.code))
    throw new Error("تعذر تحميل إعدادات وحدات PHIF Supplier");
  const fields =
    "id,item_identity,units_per_box,base_unit,version" +
    (supplierUnitsAvailable ? ",supplier_quantity_unit,supplier_unit_exceptions" : "");
  const settings = (await readReportPages(() =>
    db
      .from("phif_report_box_settings")
      .select(fields, { count: "exact" })
      .eq("pharmacy_id", pharmacyId)
      .order("id"),
  )) as BoxSetting[];
  return { settings, available: true, supplierUnitsAvailable };
}
