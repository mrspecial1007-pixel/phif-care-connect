import { actualItemSignature } from "./actual-stock-links.helpers";
import { matchActualInvoiceItemToStock, currentStockCandidatesForActual, calculateActualGrossMargin } from "./phif-stock.helpers";
import { actualUnitSourceSignature, actualStockUnitSignature, actualCostUnits, actualCostUnitAllowed, type ActualUnit } from "./actual-units.helpers";

export const actualImportedSnapshot = (item: any) => ({ brand: item.brand ?? null, strength: item.strength ?? null,
  quantity: item.quantity ?? null, metadata: item.metadata ?? {}, source_classification: item.source_classification });
export const actualPricingSnapshot = (stock: any) => ({ brand_product_id: stock.brand_product_id ?? null,
  source_stock_id: stock.source_stock_id ?? null, brand_name: stock.brand_name ?? null, strength: stock.strength ?? null,
  dosage_unit: stock.dosage_unit ?? null, package_quantity: stock.package_quantity ?? null, strips_quantity: stock.strips_quantity ?? null });

export function actualUnitPreview(input: { invoices: any[]; items: any[]; stocks: any[]; decisions: any[];
  scope: { itemId: string; dateFrom?: string; dateTo?: string } }) {
  const anchor = input.items.find(i => i.id === input.scope.itemId && i.source_classification === "actual-supplier");
  if (!anchor) throw new Error("بند Actual غير متاح في الصيدلية الحالية");
  const matched = matchActualInvoiceItemToStock(anchor, currentStockCandidatesForActual(anchor, input.stocks));
  if (matched.status !== "matched") throw new Error("يجب تأكيد هوية الصنف قبل توثيق وحدة الصرف");
  const stock: any = matched.stock;
  const invoices = new Map(input.invoices.map(i => [i.id, i]));
  const decisions = new Map(input.decisions.map(d => [d.phif_invoice_item_id, d]));
  const eligible: any[] = [];
  const rows: any[] = [];
  for (const item of input.items) {
    if (item.source_classification !== "actual-supplier" || actualItemSignature(item) !== actualItemSignature(anchor)) continue;
    const invoice = invoices.get(item.phif_invoice_id);
    if (!invoice || (input.scope.dateFrom && invoice.dispensing_date < input.scope.dateFrom)
      || (input.scope.dateTo && invoice.dispensing_date > input.scope.dateTo)) continue;
    const match = matchActualInvoiceItemToStock(item, currentStockCandidatesForActual(item, input.stocks));
    if (match.status !== "matched" || actualStockUnitSignature(match.stock) !== actualStockUnitSignature(stock)) continue;
    const decision = decisions.get(item.id);
    const units = actualCostUnits(item, match.stock);
    const row = { id: item.id, invoice_id: invoice.id, invoice_number: invoice.invoice_number, date: invoice.dispensing_date,
      quantity: item.quantity, version: decision?.version ?? 0, signature: actualUnitSourceSignature(item),
      stockSignature: actualStockUnitSignature(match.stock), decision: decision ?? null,
      units, complete: calculateActualGrossMargin(item, [match.stock]).status === "matched" };
    eligible.push({ item, stock: match.stock, row }); rows.push(row);
  }
  return { stock, rows, eligible, summary: { items: rows.length, invoices: new Set(rows.map(r => r.invoice_id)).size,
    quantity: rows.reduce((sum, r) => sum + Number(r.quantity || 0), 0) } };
}

export function actualDecisionInput(preview: { eligible: any[] }, data: { rows: any[]; dispensingUnit: ActualUnit; costUnit: ActualUnit; revoke: boolean }) {
  if (new Set(data.rows.map(r => r.id)).size !== data.rows.length) throw new Error("بنود مكررة في الطلب");
  return data.rows.map(requested => {
    const found = preview.eligible.find(e => e.row.id === requested.id);
    if (!found || ["version", "signature", "stockSignature"].some(key => requested[key] !== found.row[key])) throw new Error("تغيرت المعاينة؛ أعد تحميلها");
    if (!data.revoke) {
      if (!actualCostUnitAllowed(found.stock, data.costUnit)) throw new Error("وحدة التكلفة لا تتوافق مع بيانات المخزون؛ يلزم توثيق مصدرها أولًا");
    }
    return found;
  });
}
