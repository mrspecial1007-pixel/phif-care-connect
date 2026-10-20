import { applyActualUnitDecisions } from "./actual-units.helpers";

export async function loadActualReportDecisions(db: any, pharmacyId: string, items: any[]) {
  const { loadActualStockLinks } = await import("./actual-stock-links.server");
  const linked = await loadActualStockLinks(db, pharmacyId, items);
  return loadActualUnitDecisions(db, pharmacyId, linked.items);
}

export async function loadActualUnitDecisions(db: any, pharmacyId: string, items: any[]) {
  const ids = [...new Set(items.filter(i => i.source_classification === "actual-supplier").map(i => i.id).filter(Boolean))];
  const decisions: any[] = [];
  for (let offset = 0; offset < ids.length; offset += 300) {
    const { data, error } = await db.from("phif_actual_unit_decisions").select("*")
      .eq("pharmacy_id", pharmacyId).in("phif_invoice_item_id", ids.slice(offset, offset + 300));
    if (error) {
      if (["42P01", "PGRST205"].includes(error.code)) return { items: applyActualUnitDecisions(items, []), available: false, decisions: [] };
      throw new Error("تعذر قراءة توثيق وحدات Actual");
    }
    decisions.push(...(data ?? []));
  }
  return { items: applyActualUnitDecisions(items, decisions), decisions, available: true };
}
