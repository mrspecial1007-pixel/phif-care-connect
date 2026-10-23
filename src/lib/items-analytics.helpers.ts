import { z } from "zod";
import { normalizeActiveIngredient, normalizeDosageForm } from "./medication-normalize";
import { actualUnit, actualSourceUnit, type ActualUnit } from "./actual-units.helpers";
import { supplierInvoiceForm, supplierInvoiceUnit } from "./phif-supplier-quick-cost.helpers";
import { latestInvoiceSale } from "./items-reference-prices.helpers";
import type { SearchSchemaInput } from "@tanstack/react-router";
import { hasPermission, type TiryaqPermission } from "./user-permissions";

export const currentReportMonth = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tripoli",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
export const analyticsSearchSchema = z.object({
  month: z
    .string()
    .regex(/^(all|\d{4}-(0[1-9]|1[0-2]))$/)
    .catch(currentReportMonth),
  source: z.enum(["all", "actual", "phif"]).catch("all"),
  q: z.string().max(120).catch(""),
  sort: z.enum(["profit_asc", "profit_desc", "sale_desc", "date_desc"]).catch("profit_asc"),
  result: z.enum(["all", "loss", "zero", "positive", "incomplete"]).catch("all"),
  mode: z.enum(["cumulative", "single"]).catch("cumulative"),
});
export type AnalyticsFilters = z.infer<typeof analyticsSearchSchema>;
export const validateAnalyticsSearch = (search: Partial<AnalyticsFilters> & SearchSchemaInput) =>
  analyticsSearchSchema.parse(search);
export type AnalyticsAccess = Record<
  "actual" | "phif",
  {
    items: boolean;
    movements: boolean;
    revenue: boolean;
    cost: boolean;
    profit: boolean;
    purchasePriceWrite?: boolean;
  }
>;
export type BoxSetting = {
  id?: string;
  item_identity: string;
  units_per_box: number;
  base_unit: ActualUnit;
  version: number;
};
export function authorizeAnalyticsRead(
  user: { user_id?: string; user_role?: string; user_permissions?: Record<string, boolean> },
  base: AnalyticsAccess,
  request: { financial: boolean; export: boolean; source: AnalyticsFilters["source"] },
) {
  const legacy = !user.user_id && !user.user_role;
  const can = (permission: TiryaqPermission) =>
    legacy || hasPermission(user.user_role, user.user_permissions, permission);
  if (request.export && !can("reports_export")) throw new Error("لا تملك صلاحية تصدير التقارير");
  if (request.financial && !can("reports_read")) throw new Error("لا تملك صلاحية تقارير الربحية");
  const access = structuredClone(base);
  access.actual.cost &&= can("stock_cost_read");
  for (const source of ["actual", "phif"] as const)
    access[source].profit &&= access[source].cost && access[source].revenue;
  if (
    request.financial &&
    !(["actual", "phif"] as const).some(
      (s) =>
        access[s].items && access[s].profit && (request.source === "all" || request.source === s),
    )
  ) {
    throw new Error("لا تملك صلاحية عرض ربحية المصدر المختار");
  }
  return { access, canExport: can("reports_export"), canManageBoxes: user.user_role === "admin" };
}
export type AnalyticsRow = {
  id: string;
  identity: string;
  ingredient: string;
  strength: string;
  form: string;
  brand: string | null;
  invoiceId: string;
  invoiceNumber: string | null;
  date: string;
  beneficiary: string | null;
  card: string | null;
  source: "actual" | "phif";
  quantity: number | null;
  unit: ActualUnit | null;
  units: number | null;
  boxes: number | null;
  revenue: number | null;
  cost: number | null;
  profit: number | null;
  afterDiscount: number | null;
  manualMatch: boolean;
  financialReason: string | null;
  canEditCost: boolean;
  supplierBasis: any;
};

const text = (value: unknown) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim();
export const roundReport = (value: number) => Math.round((value + Number.EPSILON) * 1000) / 1000;
function supplierReportEvidence(item: any) {
  const source = supplierInvoiceUnit(item);
  const basis = item.phif_financial_fields?.internal_purchase_price_basis;
  // Only an explicit saved confirmation documents the quantity unit. A price
  // denominator or a purchase unit alone is not dispensing evidence.
  const confirmed =
    source.issue === "missing" && basis?.quantity_unit_confirmed === true
      ? actualUnit(basis.unit)
      : null;
  return confirmed ? { unit: confirmed, issue: null } : source;
}
export function reportStrength(value: unknown) {
  const raw = text(value).toLowerCase().replace(/\s+/g, "").replace(/[µμ]g/g, "mcg");
  // Only a full, unambiguous dose chain shares a trailing unit. Keep all components.
  const chain = /^(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*)\s*(mg|mcg|g)$/.exec(raw);
  if (chain)
    return chain[1]
      .split("/")
      .map((n) => `${Number(n) * (chain[2] === "g" ? 1000 : chain[2] === "mcg" ? 0.001 : 1)}mg`)
      .join("/");
  return raw.replace(
    /(\d+(?:\.\d+)?)(mcg|mg|g)(?=\/|$)/g,
    (_, n, unit) => `${Number(n) * (unit === "g" ? 1000 : unit === "mcg" ? 0.001 : 1)}mg`,
  );
}
export function scientificReportIdentity(item: any, formHint?: unknown) {
  const ingredient = normalizeActiveIngredient(text(item.active_ingredient));
  const strength = reportStrength(item.strength);
  const confirmed = supplierReportEvidence(item);
  const confirmedForm = [
    "tablet",
    "capsule",
    "pen",
    "vial",
    "ampoule",
    "drops",
    "inhaler",
  ].includes(actualUnit(confirmed.unit) || "")
    ? confirmed.unit
    : null;
  const rawForm = text(formHint || supplierInvoiceForm(item) || confirmedForm);
  const form =
    actualUnit(rawForm) ||
    (/^(inj|injection|injections)$/i.test(rawForm) ? "injection" : normalizeDosageForm(rawForm));
  // Missing identity components never merge potentially different products.
  return {
    key: JSON.stringify([
      ingredient,
      strength,
      form,
      ...(!ingredient || !strength || !form ? ["unresolved", item.id] : []),
    ]),
    ingredient: text(item.active_ingredient) || "اسم علمي غير مسجل",
    strength: text(item.strength),
    form,
  };
}
export function monthWindow(month: string, offset = 0) {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1 + offset, 1)),
    to = new Date(Date.UTC(y, m + offset, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}
const inWindow = (date: string, range: { from: string; to: string }) =>
  date >= range.from && date <= range.to;
const total = (
  rows: AnalyticsRow[],
  key: "revenue" | "cost" | "profit" | "afterDiscount" | "units" | "boxes",
) =>
  rows.every((r) => r[key] != null)
    ? roundReport(rows.reduce((n, r) => n + Number(r[key]), 0))
    : null;
export function financialSummary(rows: AnalyticsRow[]) {
  const revenue = total(rows, "revenue"),
    cost = total(rows, "cost"),
    profit = total(rows, "profit");
  return {
    revenue,
    cost,
    profit,
    margin: revenue != null && revenue !== 0 && profit != null ? (profit / revenue) * 100 : null,
    afterDiscount: total(rows, "afterDiscount"),
    complete: rows.length > 0 && profit != null && cost != null && revenue != null,
    incomplete: rows.filter((r) => r.cost == null || r.profit == null).length,
  };
}
export function resultMatches(
  row: ReturnType<typeof financialSummary>,
  filter: AnalyticsFilters["result"],
) {
  if (filter === "all") return true;
  if (filter === "incomplete") return !row.complete;
  return (
    row.complete &&
    row.profit != null &&
    (filter === "loss" ? row.profit < 0 : filter === "zero" ? row.profit === 0 : row.profit > 0)
  );
}

/** Consumes the existing engine's results; does not calculate Actual purchase prices. */
export function buildItemsAnalytics(input: {
  items: any[];
  invoices: any[];
  rows: any[];
  stocks: any[];
  settings: BoxSetting[];
  access: AnalyticsAccess;
  filters: AnalyticsFilters;
  canExport?: boolean;
  canManageBoxes?: boolean;
  settingsAvailable?: boolean;
}) {
  const invoiceMap = new Map(input.invoices.map((i) => [i.id, i]));
  const financial = new Map(input.rows.map((r) => [r.item_id, r]));
  const settings = new Map(input.settings.map((s) => [s.item_identity, s]));
  const seen = new Set<string>();
  const groups = new Map<string, any>();
  for (const item of input.items) {
    if (!item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    const source =
      item.source_classification === "phif-supplier"
        ? "phif"
        : item.source_classification === "actual-supplier"
          ? "actual"
          : null;
    if (
      !source ||
      !input.access[source].items ||
      (input.filters.source !== "all" && input.filters.source !== source)
    )
      continue;
    const rights = input.access[source],
      f = financial.get(item.id);
    const invoice = invoiceMap.get(item.phif_invoice_id);
    if (!invoice || !f) continue;
    const stock =
      source === "actual"
        ? input.stocks.find((s) => s.source_stock_id === f.matched_stock_id)
        : null;
    const evidence =
      source === "actual"
        ? { unit: actualUnit(f.invoice_quantity_unit), issue: null }
        : supplierReportEvidence(item);
    const confirmedForm = [
      "tablet",
      "capsule",
      "pen",
      "vial",
      "ampoule",
      "drops",
      "inhaler",
    ].includes(actualUnit(evidence.unit) || "")
      ? evidence.unit
      : null;
    const identity = scientificReportIdentity(
      item,
      supplierInvoiceForm(item) || stock?.dosage_unit || confirmedForm,
    );
    const term = input.filters.q.toLowerCase().replace(/\s+/g, "");
    if (
      term &&
      !`${identity.ingredient}${identity.strength}`.toLowerCase().replace(/\s+/g, "").includes(term)
    )
      continue;
    const setting = settings.get(identity.key);
    const unit =
      actualUnit(evidence.unit) || (source === "actual" ? actualSourceUnit(item).unit : null);
    const quantity = item.quantity == null || item.quantity === "" ? NaN : Number(item.quantity);
    const baseUnit = setting?.base_unit || actualUnit(identity.form);
    let units: number | null =
      Number.isFinite(quantity) && quantity >= 0 && !evidence.issue && unit && unit === baseUnit
        ? quantity
        : null;
    // The configured reporting box is not proof of a historical product's pack size.
    const uniqueCount = (values: unknown[]) => {
      const counts = values.filter((v) => v != null && v !== "").map(Number);
      return counts.length &&
        new Set(counts).size === 1 &&
        Number.isSafeInteger(counts[0]) &&
        counts[0] > 0
        ? counts[0]
        : null;
    };
    const packageQuantity = uniqueCount([
      item.metadata?.package_quantity,
      item.metadata?.packageQuantity,
    ]);
    const strips = uniqueCount([item.metadata?.strips_quantity, item.metadata?.stripsQuantity]);
    if (
      unit === "box" &&
      ["tablet", "capsule"].includes(baseUnit || "") &&
      actualUnit(identity.form) === baseUnit &&
      packageQuantity &&
      Number.isFinite(quantity) &&
      quantity >= 0 &&
      !evidence.issue
    )
      units = quantity * packageQuantity;
    // A strip conversion requires explicit package metadata; never assume ten tablets.
    if (
      unit === "strip" &&
      ["tablet", "capsule"].includes(baseUnit || "") &&
      actualUnit(identity.form) === baseUnit &&
      packageQuantity &&
      strips &&
      packageQuantity % strips === 0 &&
      Number.isFinite(quantity) &&
      quantity >= 0 &&
      !evidence.issue
    ) {
      units = (quantity * packageQuantity) / strips;
    }
    // Reuse conversions already verified by Actual's engine, without recomputing its cost.
    if (
      source === "actual" &&
      f.match_status === "matched" &&
      actualUnit(f.actual_cost_unit) === baseUnit &&
      Number(f.actual_conversion_factor) > 0 &&
      Number.isFinite(Number(f.actual_conversion_factor)) &&
      Number.isFinite(quantity) &&
      quantity >= 0 &&
      !evidence.issue
    ) {
      units = quantity * Number(f.actual_conversion_factor);
    }
    let boxes: number | null = units != null && setting ? units / setting.units_per_box : null;
    if (units != null && !Number.isFinite(units)) {
      units = null;
      boxes = null;
    }
    if (boxes != null && !Number.isFinite(boxes)) boxes = null;
    const row: AnalyticsRow = {
      id: item.id,
      identity: identity.key,
      ingredient: identity.ingredient,
      strength: identity.strength,
      form: identity.form,
      brand: item.brand ?? null,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      date: String(invoice.dispensing_date || ""),
      beneficiary: rights.movements ? invoice.beneficiary_name : null,
      card: rights.movements ? String(invoice.insurance_card_number ?? "").trim() || null : null,
      source,
      quantity: Number.isFinite(quantity) ? quantity : null,
      unit,
      units,
      boxes,
      revenue: rights.revenue ? f.revenue : null,
      cost: rights.cost ? f.purchase_cost : null,
      profit: rights.revenue && rights.cost && rights.profit ? f.gross_margin : null,
      // No verified per-item discount model exists in the current data contract.
      afterDiscount: null,
      manualMatch: Boolean(f.manual_match),
      financialReason: f.match_reason ?? null,
      canEditCost:
        source === "phif" && rights.cost && rights.movements && Boolean(rights.purchasePriceWrite),
      supplierBasis:
        source === "phif" && rights.cost
          ? (item.phif_financial_fields?.internal_purchase_price_basis ?? null)
          : null,
    };
    const group = groups.get(identity.key) ?? {
      id: identity.key,
      ...identity,
      setting: setting || null,
      rows: [],
      saleItems: [],
      actualSaleItems: [],
    };
    group.rows.push(row);
    // Only a verified dispensing unit can turn a recorded price into a box price.
    if (
      source === "phif" &&
      rights.revenue &&
      setting &&
      units != null &&
      units > 0 &&
      f.revenue != null
    ) {
      group.saleItems.push({
        ...item,
        invoice,
        quantity: units,
        phif_financial_fields: { total_amount: f.revenue },
      });
    }
    if (
      source === "actual" &&
      rights.revenue &&
      setting &&
      units != null &&
      units > 0 &&
      f.revenue != null
    ) {
      group.actualSaleItems.push({
        ...item,
        invoice,
        quantity: units,
        phif_financial_fields: { total_amount: f.revenue },
      });
    }
    groups.set(identity.key, group);
  }
  const selectedRange = input.filters.month === "all" ? null : monthWindow(input.filters.month);
  const comparisonRange = selectedRange ? monthWindow(input.filters.month, -1) : null;
  const averageRange = selectedRange
    ? {
        from: monthWindow(input.filters.month, -3).from,
        to: monthWindow(input.filters.month, -1).to,
      }
    : null;
  const summaries: any[] = [];
  const movements: AnalyticsRow[] = [];
  for (const g of groups.values()) {
    const rows = g.rows.filter(
      (r: AnalyticsRow) => !selectedRange || inWindow(r.date, selectedRange),
    );
    if (!rows.length) continue;
    const sourceTotal = (src: string, metric: "units" | "boxes") =>
      total(
        rows.filter((r: AnalyticsRow) => r.source === src),
        metric,
      );
    const previous = comparisonRange
      ? total(
          g.rows.filter((r: AnalyticsRow) => inWindow(r.date, comparisonRange)),
          "boxes",
        )
      : null;
    const lastThree = averageRange
      ? total(
          g.rows.filter((r: AnalyticsRow) => inWindow(r.date, averageRange)),
          "boxes",
        )
      : null;
    const boxes = total(rows, "boxes");
    const lastSale = latestInvoiceSale(g.saleItems, "phif-supplier", false);
    const lastActualSale = latestInvoiceSale(g.actualSaleItems, "actual-supplier", false);
    const invoiceGroups = new Map<string, AnalyticsRow[]>();
    for (const r of rows)
      invoiceGroups.set(r.invoiceId, [...(invoiceGroups.get(r.invoiceId) ?? []), r]);
    summaries.push({
      id: g.id,
      ingredient: g.ingredient,
      strength: g.strength,
      form: g.form,
      identityComplete: !g.key.includes('"unresolved"'),
      setting: g.setting,
      sources: [...new Set(rows.map((r: AnalyticsRow) => r.source))],
      actualUnits: sourceTotal("actual", "units"),
      phifUnits: sourceTotal("phif", "units"),
      actualBoxes: sourceTotal("actual", "boxes"),
      phifBoxes: sourceTotal("phif", "boxes"),
      units: total(rows, "units"),
      boxes,
      beneficiaries: rows.every((r: AnalyticsRow) => input.access[r.source].movements)
        ? new Set(rows.map((r: AnalyticsRow) => r.card).filter(Boolean)).size
        : null,
      beneficiariesWithoutCard: new Set(
        rows
          .filter((r: AnalyticsRow) => !r.card && input.access[r.source].movements)
          .map((r: AnalyticsRow) => r.invoiceId),
      ).size,
      previousBoxes: previous,
      changePercent:
        boxes != null && previous != null && previous !== 0
          ? ((boxes - previous) / previous) * 100
          : null,
      averageBoxes: lastThree == null ? null : lastThree / 3,
      latestSale: lastSale,
      boxSale:
        lastSale?.price != null && g.setting
          ? roundReport(lastSale.price * g.setting.units_per_box)
          : null,
      latestActualSale: lastActualSale,
      actualBoxSale:
        lastActualSale?.price != null && g.setting
          ? roundReport(lastActualSale.price * g.setting.units_per_box)
          : null,
      dispenseCount: rows.length,
      invoiceCount: invoiceGroups.size,
      losingInvoices: [...invoiceGroups.values()].filter((r) => {
        const s = financialSummary(r);
        return s.complete && s.profit! < 0;
      }).length,
      ...financialSummary(rows),
    });
    movements.push(...rows);
  }
  const invoiceGroups = new Map<string, AnalyticsRow[]>();
  for (const r of movements)
    invoiceGroups.set(r.invoiceId, [...(invoiceGroups.get(r.invoiceId) ?? []), r]);
  const invoices = [...invoiceGroups.entries()].map(([id, rows]) => ({
    id,
    invoiceNumber: rows[0].invoiceNumber,
    date: rows[0].date,
    beneficiary: rows[0].beneficiary,
    card: rows[0].card,
    sources: [...new Set(rows.map((r) => r.source))],
    itemCount: rows.length,
    ...financialSummary(rows),
  }));
  const byCard = new Map<string, typeof invoices>();
  for (const i of invoices) {
    if (!i.card) continue; // Missing cards never merge beneficiaries by name.
    byCard.set(i.card, [...(byCard.get(i.card) ?? []), i]);
  }
  const beneficiaries = [...byCard.entries()].map(([card, list]) => {
    const ids = new Set(list.map((i) => i.id));
    const rows = movements.filter((r) => ids.has(r.invoiceId));
    const best = list.filter((i) => i.complete).sort((a, b) => b.profit! - a.profit!)[0];
    return {
      id: card,
      card,
      beneficiary: list[0].beneficiary,
      invoiceCount: ids.size,
      losingInvoices: list.filter((i) => i.complete && i.profit! < 0).length,
      bestInvoiceProfit: best?.profit ?? null,
      bestInvoiceNumber: best?.invoiceNumber ?? null,
      ...financialSummary(rows),
    };
  });
  return {
    items: summaries,
    invoices,
    beneficiaries,
    movements,
    summary: {
      actualBoxes: total(
        movements.filter((r) => r.source === "actual"),
        "boxes",
      ),
      phifBoxes: total(
        movements.filter((r) => r.source === "phif"),
        "boxes",
      ),
      boxes: total(movements, "boxes"),
      beneficiaries: movements.every((r) => input.access[r.source].movements)
        ? new Set(movements.map((r) => r.card).filter(Boolean)).size
        : null,
    },
    period: { month: input.filters.month, selectedRange, averageRange },
    canExport: Boolean(input.canExport),
    canManageBoxes: Boolean(input.canManageBoxes),
    settingsAvailable: input.settingsAvailable !== false,
    audit: {
      losingItems: summaries.filter((i) => i.complete && i.profit < 0).length,
      losingInvoices: invoices.filter((i) => i.complete && i.profit! < 0).length,
      missingCosts: movements.filter((i) => i.cost == null).length,
    },
    notes: {
      actual: "تكلفة Actual وفق محركه المعتمد وسعر المخزون المتاح، وليست تكلفة تاريخية مثبتة.",
      discount: "الربح بعد الخصومات غير متاح دون خصم موثق قابل للتطبيق على البند.",
    },
  };
}
