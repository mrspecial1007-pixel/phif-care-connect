import { applyActualStockLinks, type ActualStockLink } from "./actual-stock-links.helpers";

export function missingActualLinksMigration(error: any) {
  return ["42P01", "PGRST205"].includes(error?.code);
}

export const ACTUAL_LINK_SELECT = "id, version, phif_invoice_item_id, source_signature, is_active, updated_at, updated_actor, target:phif_stock_items!target_stock_item_id(id, source_stock_id, brand_product_id, brand_name, active_ingredient, strength, dosage_unit, package_quantity, strips_quantity)";

export async function loadActualStockLinks(db: any, pharmacyId: string, items: any[]) {
  const ids = [...new Set(items.filter(item => item.source_classification === "actual-supplier").map(item => item.id).filter(Boolean))];
  const links: ActualStockLink[] = [];
  for (let index = 0; index < ids.length; index += 300) {
    const { data, error } = await db.from("phif_actual_stock_links").select(ACTUAL_LINK_SELECT)
      .eq("pharmacy_id", pharmacyId).eq("is_active", true).in("phif_invoice_item_id", ids.slice(index, index + 300));
    if (error) {
      if (missingActualLinksMigration(error)) return { items, available: false };
      throw new Error("تعذر قراءة الروابط اليدوية للمخزون");
    }
    links.push(...(data ?? []));
  }
  return { items: applyActualStockLinks(items, links), available: true };
}
