import { applyActualStockLinks, type ActualStockLink } from "./actual-stock-links.helpers";

export function missingActualLinksMigration(error: any) {
  return ["42P01", "PGRST205"].includes(error?.code);
}

export const ACTUAL_LINK_SELECT = "id, version, phif_invoice_item_id, source_signature, is_active, updated_at, updated_actor, source:phif_invoice_items!phif_invoice_item_id(id,brand,active_ingredient,strength,source_classification,metadata), target:phif_stock_items!target_stock_item_id(id, source_stock_id, brand_product_id, brand_name, active_ingredient, strength, dosage_unit, package_quantity, strips_quantity)";

export async function readActualStockLinks(db: any, pharmacyId: string, scopeAvailable?: boolean) {
  if (scopeAvailable === undefined) {
    const probe = await db.from("phif_actual_stock_links").select("source_identity").eq("pharmacy_id",pharmacyId).limit(1);
    if (probe.error && !["42703","PGRST204"].includes(probe.error.code)) throw new Error("تعذر قراءة نطاق الروابط اليدوية");
    scopeAvailable = !probe.error;
  }
  const { readReportPages } = await import("./report-pages.server");
  return await readReportPages(() => db.from("phif_actual_stock_links").select(ACTUAL_LINK_SELECT+(scopeAvailable ? ",source_identity" : ""),{ count: "exact" })
    .eq("pharmacy_id",pharmacyId).order("id")) as ActualStockLink[];
}

export async function loadActualStockLinks(db: any, pharmacyId: string, items: any[]) {
  if (!items.some(item=>item.source_classification === "actual-supplier")) return { items, available: true };
  const probe = await db.from("phif_actual_stock_links").select("id").eq("pharmacy_id",pharmacyId).limit(1);
  if (probe.error) {
    if (missingActualLinksMigration(probe.error)) return { items, available: false };
    throw new Error("تعذر قراءة الروابط اليدوية للمخزون");
  }
  const links = await readActualStockLinks(db,pharmacyId);
  return { items: applyActualStockLinks(items,links), available: true };
}
