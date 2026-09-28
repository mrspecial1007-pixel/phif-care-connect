import { invoiceItemValue } from "@/lib/phif-stock.helpers";

export type ReportSource = "all" | "actual" | "phif";
export type DrugGrouping = "scientific" | "brand";
export type TopSort = "quantity" | "beneficiaries" | "dispenses" | "value";

export type ReportInvoice = {
  id: string;
  invoice_number?: string | null;
  invoice_key?: string | null;
  beneficiary_name?: string | null;
  insurance_card_number?: string | null;
  dispensing_date?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ReportItem = {
  id?: string | null;
  phif_invoice_id: string;
  active_ingredient?: string | null;
  strength?: string | null;
  brand?: string | null;
  quantity?: number | string | null;
  source_classification?: string | null;
  phif_financial_fields?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type ReportStock = {
  source_stock_id?: string | null;
  brand_name?: string | null;
  active_ingredient?: string | null;
  strength?: string | null;
  dosage_unit?: string | null;
  stock_quantity?: number | string | null;
  source_quantity_unit?: string | null;
  synced_at?: string | null;
};

type BuildReportInput = {
  dateFrom: string;
  dateTo: string;
  source: ReportSource;
  groupBy: DrugGrouping;
  sortBy: TopSort;
  topLimit: number | "all";
  invoices: ReportInvoice[];
  items: ReportItem[];
  firstDispensingByCard?: Map<string, string>;
  stockItems?: ReportStock[];
  previous?: {
    invoices: ReportInvoice[];
    items: ReportItem[];
  } | null;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeStrength(value: unknown) {
  return normalizeText(value).replace(/\s+/g, "");
}

function cardKey(invoice: ReportInvoice) {
  return String(invoice.insurance_card_number ?? invoice.beneficiary_name ?? invoice.id).trim();
}

function itemSource(item: ReportItem): "actual" | "phif" {
  return item.source_classification === "phif-supplier" ? "phif" : "actual";
}

function sourceMatches(item: ReportItem, source: ReportSource) {
  if (source === "all") return true;
  return itemSource(item) === source;
}

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function itemQuantity(item: ReportItem) {
  return numberValue(item.quantity);
}

function dosageForm(item: ReportItem) {
  const meta = item.metadata ?? {};
  return String(meta.dosage_form ?? meta.dosageForm ?? meta.form ?? meta.pharmaceuticalForm ?? "").trim();
}

function unitForItem(item: ReportItem) {
  const meta = item.metadata ?? {};
  return String(meta.unit ?? meta.dosage_unit ?? meta.quantity_unit ?? dosageForm(item) ?? "").trim();
}

function drugKey(item: ReportItem, groupBy: DrugGrouping) {
  const unit = unitForItem(item);
  const name = groupBy === "brand" ? item.brand : item.active_ingredient;
  return [
    groupBy,
    normalizeText(name),
    normalizeStrength(item.strength),
    normalizeText(unit),
    itemSource(item),
  ].join("|");
}

function fullMonthRange(dateFrom: string, dateTo: string) {
  const start = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return dateFrom === first.toISOString().slice(0, 10) && dateTo === last.toISOString().slice(0, 10);
}

function percentChange(current: number, previous: number) {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function valueFromInvoices(invoices: ReportInvoice[]) {
  return invoices.reduce((sum, invoice) => {
    const fields = invoice.metadata ?? {};
    return sum + numberValue(fields.total_amount ?? fields.totalAmount ?? fields.total ?? fields.invoiceTotal);
  }, 0);
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function summarizePeriod(invoices: ReportInvoice[], items: ReportItem[], source: ReportSource) {
  const filteredItems = items.filter((item) => sourceMatches(item, source));
  const invoiceIds = new Set(filteredItems.map((item) => item.phif_invoice_id));
  const filteredInvoices = source === "all" ? invoices : invoices.filter((invoice) => invoiceIds.has(invoice.id));
  const cards = new Set(filteredInvoices.map(cardKey).filter(Boolean));
  const actualValue = filteredItems.filter((item) => itemSource(item) === "actual").reduce((sum, item) => sum + invoiceItemValue(item), 0);
  const phifValue = filteredItems.filter((item) => itemSource(item) === "phif").reduce((sum, item) => sum + invoiceItemValue(item), 0);
  const days = new Set(filteredInvoices.map((invoice) => invoice.dispensing_date).filter(Boolean));
  return {
    invoice_count: filteredInvoices.length,
    unique_patient_count: cards.size,
    item_count: filteredItems.length,
    quantity_total: filteredItems.reduce((sum, item) => sum + itemQuantity(item), 0),
    actual_value: actualValue,
    phif_value: phifValue,
    total_value: actualValue + phifValue,
    dispensing_day_count: days.size,
  };
}

export function buildMonthlyReport(input: BuildReportInput) {
  const invoiceById = new Map(input.invoices.map((invoice) => [invoice.id, invoice]));
  const filteredItems = input.items.filter((item) => sourceMatches(item, input.source));
  const invoiceIdsWithItems = new Set(filteredItems.map((item) => item.phif_invoice_id));
  const filteredInvoices = input.source === "all" ? input.invoices : input.invoices.filter((invoice) => invoiceIdsWithItems.has(invoice.id));
  const beneficiaryByCard = new Map<string, { name: string | null; card: string; invoiceIds: Set<string>; itemCount: number; value: number; dates: string[] }>();

  for (const invoice of filteredInvoices) {
    const key = cardKey(invoice);
    if (!key) continue;
    const row = beneficiaryByCard.get(key) ?? {
      name: invoice.beneficiary_name ?? null,
      card: key,
      invoiceIds: new Set<string>(),
      itemCount: 0,
      value: 0,
      dates: [],
    };
    row.invoiceIds.add(invoice.id);
    if (invoice.dispensing_date) row.dates.push(invoice.dispensing_date);
    beneficiaryByCard.set(key, row);
  }

  const sourceSplit = {
    actual: { item_count: 0, drug_count: 0, patient_count: 0, quantity: 0, value: 0, contribution: 0 },
    phif: { item_count: 0, drug_count: 0, patient_count: 0, quantity: 0, value: 0, contribution: 0 },
  };
  const sourcePatients = { actual: new Set<string>(), phif: new Set<string>() };
  const sourceDrugs = { actual: new Set<string>(), phif: new Set<string>() };
  const drugGroups = new Map<string, any>();
  const daily = new Map<string, any>();
  const quality = {
    missing_generic: 0,
    missing_strength: 0,
    missing_unit: 0,
    unmatched_actual_items: 0,
    incomplete_invoices: 0,
    source_review_items: 0,
  };

  for (const item of filteredItems) {
    const invoice = invoiceById.get(item.phif_invoice_id);
    const source = itemSource(item);
    const value = invoiceItemValue(item);
    const quantity = itemQuantity(item);
    const card = invoice ? cardKey(invoice) : "";
    const key = drugKey(item, input.groupBy);
    const unit = unitForItem(item);

    sourceSplit[source].item_count += 1;
    sourceSplit[source].quantity += quantity;
    sourceSplit[source].value += value;
    if (card) sourcePatients[source].add(card);
    sourceDrugs[source].add(key);

    const group = drugGroups.get(key) ?? {
      key,
      active_ingredient: item.active_ingredient ?? null,
      strength: item.strength ?? null,
      dosage_form: dosageForm(item) || null,
      brand: item.brand ?? null,
      source,
      unit: unit || null,
      quantity: 0,
      unique_patients: new Set<string>(),
      dispense_count: 0,
      total_value: 0,
      products: new Map<string, { brand: string; quantity: number; value: number }>(),
    };
    group.quantity += quantity;
    group.dispense_count += 1;
    group.total_value += value;
    if (card) group.unique_patients.add(card);
    const brand = item.brand || "غير محدد";
    const product = group.products.get(brand) ?? { brand, quantity: 0, value: 0 };
    product.quantity += quantity;
    product.value += value;
    group.products.set(brand, product);
    drugGroups.set(key, group);

    if (invoice?.dispensing_date) {
      const day = daily.get(invoice.dispensing_date) ?? {
        date: invoice.dispensing_date,
        invoiceIds: new Set<string>(),
        patients: new Set<string>(),
        item_count: 0,
        actual_value: 0,
        phif_value: 0,
      };
      day.invoiceIds.add(invoice.id);
      if (card) day.patients.add(card);
      day.item_count += 1;
      if (source === "actual") day.actual_value += value;
      else day.phif_value += value;
      daily.set(invoice.dispensing_date, day);
    }

    const beneficiary = beneficiaryByCard.get(card);
    if (beneficiary) {
      beneficiary.itemCount += 1;
      beneficiary.value += value;
    }

    if (!item.active_ingredient) quality.missing_generic += 1;
    if (!item.strength) quality.missing_strength += 1;
    if (!unit) quality.missing_unit += 1;
    if (source === "actual" && !item.brand) quality.unmatched_actual_items += 1;
    if (!item.source_classification) quality.source_review_items += 1;
  }

  for (const key of Object.keys(sourceSplit) as Array<keyof typeof sourceSplit>) {
    sourceSplit[key].patient_count = sourcePatients[key].size;
    sourceSplit[key].drug_count = sourceDrugs[key].size;
  }
  const totalValue = sourceSplit.actual.value + sourceSplit.phif.value;
  sourceSplit.actual.contribution = totalValue ? sourceSplit.actual.value / totalValue : 0;
  sourceSplit.phif.contribution = totalValue ? sourceSplit.phif.value / totalValue : 0;

  for (const invoice of filteredInvoices) {
    if (!invoice.insurance_card_number || !invoice.dispensing_date) quality.incomplete_invoices += 1;
  }

  const firstDispensingByCard = input.firstDispensingByCard ?? new Map<string, string>();
  const beneficiaries = [...beneficiaryByCard.values()].map((row) => {
    const first = firstDispensingByCard.get(row.card);
    const sortedDates = [...row.dates].sort();
    return {
      name: row.name,
      card: row.card,
      dispensing_count: row.dates.length,
      invoice_count: row.invoiceIds.size,
      item_count: row.itemCount,
      total_value: row.value,
      last_dispensing_date: sortedDates.at(-1) ?? null,
      is_new: first ? first >= input.dateFrom && first <= input.dateTo : null,
    };
  }).sort((a, b) => b.invoice_count - a.invoice_count || String(b.last_dispensing_date).localeCompare(String(a.last_dispensing_date)));

  const newBeneficiaries = beneficiaries.filter((row) => row.is_new === true).length;
  const repeatBeneficiaries = beneficiaries.length - newBeneficiaries;
  const once = beneficiaries.filter((row) => row.invoice_count === 1).length;
  const twice = beneficiaries.filter((row) => row.invoice_count === 2).length;
  const threePlus = beneficiaries.filter((row) => row.invoice_count >= 3).length;

  const topDrugs = [...drugGroups.values()].map((group) => ({
    key: group.key,
    active_ingredient: group.active_ingredient,
    strength: group.strength,
    dosage_form: group.dosage_form,
    brand: group.brand,
    source: group.source,
    quantity: group.quantity,
    unit: group.unit,
    unique_patient_count: group.unique_patients.size,
    dispense_count: group.dispense_count,
    total_value: group.total_value,
    products: [...group.products.values()],
  })).sort((a, b) => {
    if (input.sortBy === "beneficiaries") return b.unique_patient_count - a.unique_patient_count;
    if (input.sortBy === "dispenses") return b.dispense_count - a.dispense_count;
    if (input.sortBy === "value") return b.total_value - a.total_value;
    return b.quantity - a.quantity;
  });

  const limitedTopDrugs = input.topLimit === "all" ? topDrugs : topDrugs.slice(0, input.topLimit);
  const dailyRows = [...daily.values()].map((day) => ({
    date: day.date,
    invoice_count: day.invoiceIds.size,
    unique_patient_count: day.patients.size,
    item_count: day.item_count,
    actual_value: day.actual_value,
    phif_value: day.phif_value,
    total_value: day.actual_value + day.phif_value,
  })).sort((a, b) => a.date.localeCompare(b.date));

  const summary = summarizePeriod(input.invoices, input.items, input.source);
  const previousSummary = input.previous ? summarizePeriod(input.previous.invoices, input.previous.items, input.source) : null;
  const comparison = fullMonthRange(input.dateFrom, input.dateTo) && previousSummary
    ? {
        available: previousSummary.invoice_count > 0 || previousSummary.item_count > 0,
        invoice_count: { current: summary.invoice_count, previous: previousSummary.invoice_count, delta: summary.invoice_count - previousSummary.invoice_count, percent: percentChange(summary.invoice_count, previousSummary.invoice_count) },
        unique_patient_count: { current: summary.unique_patient_count, previous: previousSummary.unique_patient_count, delta: summary.unique_patient_count - previousSummary.unique_patient_count, percent: percentChange(summary.unique_patient_count, previousSummary.unique_patient_count) },
        item_count: { current: summary.item_count, previous: previousSummary.item_count, delta: summary.item_count - previousSummary.item_count, percent: percentChange(summary.item_count, previousSummary.item_count) },
        quantity_total: { current: summary.quantity_total, previous: previousSummary.quantity_total, delta: summary.quantity_total - previousSummary.quantity_total, percent: percentChange(summary.quantity_total, previousSummary.quantity_total) },
        total_value: { current: summary.total_value, previous: previousSummary.total_value, delta: summary.total_value - previousSummary.total_value, percent: percentChange(summary.total_value, previousSummary.total_value) },
      }
    : null;

  const invoiceValueTotal = valueFromInvoices(filteredInvoices);
  const reconciliation = invoiceValueTotal > 0
    ? {
        available: true,
        invoice_total: invoiceValueTotal,
        item_total: totalValue,
        difference: round(invoiceValueTotal - totalValue),
        status: Math.abs(invoiceValueTotal - totalValue) < 0.01 ? "balanced" : "needs_review",
      }
    : {
        available: false,
        invoice_total: null,
        item_total: totalValue,
        difference: null,
        status: "invoice_totals_unavailable",
      };

  const activeDays = summary.dispensing_day_count;
  const stockConsumption = buildStockConsumption(input.stockItems ?? [], topDrugs, activeDays);

  return {
    period: { dateFrom: input.dateFrom, dateTo: input.dateTo, source: input.source, groupBy: input.groupBy },
    summary: {
      unique_patient_count: summary.unique_patient_count,
      invoice_count: summary.invoice_count,
      item_count: summary.item_count,
      distinct_drug_count: drugGroups.size,
      total_dispensed_value: totalValue,
      actual_value: sourceSplit.actual.value,
      phif_value: sourceSplit.phif.value,
      new_beneficiary_count: newBeneficiaries,
      repeat_beneficiary_count: repeatBeneficiaries,
      average_items_per_invoice: summary.invoice_count ? summary.item_count / summary.invoice_count : 0,
      dispensing_day_count: activeDays,
      average_daily_invoices: activeDays ? summary.invoice_count / activeDays : 0,
    },
    source_split: sourceSplit,
    beneficiary_stats: {
      unique_patient_count: beneficiaries.length,
      new_beneficiary_count: newBeneficiaries,
      repeat_beneficiary_count: repeatBeneficiaries,
      one_time_count: once,
      two_time_count: twice,
      three_plus_count: threePlus,
      beneficiaries,
    },
    top_drugs: limitedTopDrugs,
    all_top_drugs_count: topDrugs.length,
    daily: dailyRows,
    comparison,
    shortages: {
      available: false,
      message: "لا توجد بيانات نقص موثقة كافية في أرشيف PHIF لهذا التقرير.",
    },
    stock_consumption: stockConsumption,
    zero_movement_stock: stockConsumption.filter((row) => row.period_quantity === 0),
    quality,
    reconciliation,
    official_notes: [
      "يعتمد التقرير على فواتير PHIF المحفوظة وبنودها فقط.",
      "لا يتضمن التقرير الرسمي أسعار شراء الصيدلية أو الأرباح أو أي بيانات تقنية داخلية.",
    ],
  };
}

function buildStockConsumption(stockItems: ReportStock[], drugs: any[], activeDays: number) {
  return stockItems.slice(0, 100).map((stock) => {
    const stockKey = [
      normalizeText(stock.active_ingredient),
      normalizeStrength(stock.strength),
      normalizeText(stock.dosage_unit),
    ].join("|");
    const matchingDrugs = drugs.filter((drug) => [
      normalizeText(drug.active_ingredient),
      normalizeStrength(drug.strength),
      normalizeText(drug.unit),
    ].join("|") === stockKey);
    const periodQuantity = matchingDrugs.reduce((sum, drug) => sum + drug.quantity, 0);
    const avgDaily = activeDays ? periodQuantity / activeDays : 0;
    const currentStock = numberValue(stock.stock_quantity);
    const unitsComparable = Boolean(stock.dosage_unit) && matchingDrugs.length > 0;
    const daysOfStock = unitsComparable && avgDaily > 0 ? currentStock / avgDaily : null;
    return {
      source_stock_id: stock.source_stock_id,
      brand_name: stock.brand_name,
      active_ingredient: stock.active_ingredient,
      strength: stock.strength,
      unit: stock.dosage_unit ?? stock.source_quantity_unit ?? null,
      period_quantity: periodQuantity,
      average_daily_consumption: avgDaily,
      current_stock: currentStock,
      last_stock_sync: stock.synced_at ?? null,
      days_of_stock: daysOfStock,
      status: daysOfStock === null ? "unit_review" : daysOfStock < 15 ? "risk" : daysOfStock < 30 ? "watch" : "sufficient",
      next_month_need_estimate: avgDaily ? avgDaily * 30 : null,
    };
  });
}

export function officialReportPayload(report: ReturnType<typeof buildMonthlyReport>) {
  return {
    period: report.period,
    summary: report.summary,
    source_split: report.source_split,
    beneficiary_stats: report.beneficiary_stats,
    top_drugs: report.top_drugs.map(({ products, ...row }: any) => row),
    daily: report.daily,
    shortages: report.shortages,
    stock_consumption: report.stock_consumption,
    zero_movement_stock: report.zero_movement_stock,
    quality: report.quality,
    reconciliation: report.reconciliation,
    official_notes: report.official_notes,
  };
}
