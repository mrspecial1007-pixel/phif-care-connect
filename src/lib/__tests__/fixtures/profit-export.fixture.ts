export function profitExportFixture(count = 35) {
  const invoices = Array.from({ length: count }, (_, i) => {
    const items = ["actual", "phif"].map((source, j) => {
      const known = i !== count - 1 || j === 0;
      const revenue = j ? 40 : 60, cost = known ? j ? 30 : 20 : null;
      return { item_id: `item-${i}-${j}`, identity_key: `identity-${i}-${j}`, source,
        active_ingredient: j ? "SITAGLIPTIN + METFORMIN HYDROCHLORIDE EXTENDED RELEASE" : "ACETYLSALICYLIC ACID",
        strength: j ? "50/1000MG" : "100MG", brand: j ? "اسم تجاري طويل مع كلمات إضافية للمراجعة المالية" : "ACETYLSALICYLIC ACID 100MG",
        quantity: 30, invoice_quantity_unit: "TAB", revenue, purchase_cost: cost, gross_margin: cost == null ? null : revenue - cost,
        match_status: known ? "matched" : "needs_purchase_price", match_reason: known ? "saved" : "phif_supplier_purchase_price_missing" };
    });
    const complete = i !== count - 1;
    return { invoice_id: `invoice-${i}`, invoice_number: String(4535700 + i), beneficiary_name: `مستفيد اختباري ${i} شركة الأدوية والصيدلية`, insurance_card_number: `0000${i}`,
      dispensing_date: "2026-09-15", items, revenue: 100, known_cost: complete ? 50 : 20, known_profit: complete ? 50 : 40,
      item_count: 2, matched_count: complete ? 2 : 1, financial_status: complete ? "complete" : "incomplete_cost" };
  });
  const items = invoices.flatMap(invoice => invoice.items.map(r => ({ key: r.identity_key, item_name: `${r.active_ingredient} ${r.strength}`, active_ingredient: r.active_ingredient,
    strength: r.strength, brand: r.brand, source: r.source, revenue: r.revenue, known_cost: r.purchase_cost ?? 0, known_profit: r.gross_margin ?? 0,
    dispense_count: 1, matched_count: r.match_status === "matched" ? 1 : 0 })));
  const beneficiaries = invoices.map(i => ({ key: i.insurance_card_number, insurance_card_number: i.insurance_card_number, beneficiary_name: i.beneficiary_name,
    invoice_count: 1, item_count: 2, revenue: i.revenue, known_cost: i.known_cost, known_profit: i.known_profit }));
  return {
    summary: { total_revenue: count * 100, known_cost: count * 50 - 30, known_profit: count * 50 - 10, invoice_count: count,
      unique_patient_count: count, item_count: count * 2, matched_count: count * 2 - 1, complete_invoice_count: count - 1, incomplete_invoice_count: 1,
      needs_price_item_count: 1, actual_unmatched_item_count: 0, unit_review_item_count: 0, review_count: 1, coverage_ratio: (count * 2 - 1) / (count * 2) },
    source_split: { actual: { item_count: count, revenue: count * 60, known_cost: count * 20, known_profit: count * 40 },
      phif: { item_count: count, revenue: count * 40, known_cost: (count - 1) * 30, known_profit: (count - 1) * 10 } },
    invoices, export_details: { items, beneficiaries },
    top_revenue_beneficiaries: beneficiaries.slice(0,20), top_revenue_items: items.slice(0,20), top_profit_items: items.slice(0,20),
  };
}
export const profitExportMeta = { pharmacy: "صيدلية الترياق الشافي", dateFrom: "2026-09-01", dateTo: "2026-09-30", source: "all" as const, issuedAt: "2026-10-23T12:00:00Z" };
