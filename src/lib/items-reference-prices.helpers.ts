import { invoiceItemValue } from "./phif-stock.helpers";

export function latestPhifSale(items: any[]) {
  const priced = items.filter(i => i.source_classification === "phif-supplier").flatMap(item => {
    const fields = item.phif_financial_fields ?? {};
    const explicit = [fields.sale_price,fields.salePrice,fields.unit_price,fields.unitPrice,fields.price]
      .find(v => v != null && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0);
    const quantity = Number(item.quantity), value = invoiceItemValue(item);
    const hasSaleValue = ["total_amount", "totalAmount", "total", "itemTotal", "actual_value", "actualValue", "phifValue", "insurance_amount", "insuranceAmount", "outside_insurance_amount", "outsideInsuranceAmount"]
      .some(key => fields[key] != null && fields[key] !== "" && Number.isFinite(Number(fields[key])));
    const price = explicit != null ? Number(explicit) : quantity > 0 && value >= 0 && hasSaleValue
      ? Math.round(value / quantity * 1000000) / 1000000 : null;
    return price == null ? [] : [{ price, date: item.invoice?.dispensing_date ?? null, time: item.invoice?.dispensing_time ?? null,
      basis: explicit != null ? "recorded_unit_price" : "invoice_value_divided_by_quantity" }];
  });
  if (!priced.length) return null;
  const date = priced.map(p => p.date).filter(Boolean).sort().at(-1) ?? null;
  let latest = priced.filter(p => p.date === date);
  if (latest.every(p => p.time)) {
    const time = latest.map(p => p.time).sort().at(-1);
    latest = latest.filter(p => p.time === time);
  }
  const prices = [...new Set(latest.map(p => p.price))].sort((a,b) => a-b);
  return { price: prices.length === 1 ? prices[0] : null, prices, date, conflict: prices.length > 1,
    basis: latest.every(p => p.basis === "recorded_unit_price") ? "recorded_unit_price" : "invoice_value_divided_by_quantity" };
}
