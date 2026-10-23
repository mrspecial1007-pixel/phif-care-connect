import { z } from "zod";
import { actualUnit, actualSourceUnit, type ActualUnit } from "./actual-units.helpers";
import {
  resolveReportIdentities,
  reportSettingKey,
} from "./report-medication-evidence.helpers";
export { reportStrength, scientificReportIdentity } from "./report-medication-evidence.helpers";
import { latestReportSupplierSale, reportSupplierUnit, type SupplierUnitSetting } from "./report-supplier-units.helpers";
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
export type BoxSetting = SupplierUnitSetting & {
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
  reportingBox: BoxSetting | null;
  unitIssue: string | null;
  boxSize?: number | null;
  baseUnit?: ActualUnit | null;
  unitProvenance?: string;
  packageQuantity?: number | null;
  stripsPerPackage?: number | null;
};

export const roundReport = (value: number) => Math.round((value + Number.EPSILON) * 1000) / 1000;
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
  rows.every((r) => r[key] != null) && (key !== "units" || new Set(rows.map(r=>r.baseUnit)).size < 2)
    && (key !== "boxes" || new Set(rows.map(r => r.source)).size < 2
    || (rows.every(r => r.boxSize && r.baseUnit) && new Set(rows.map(r => `${r.boxSize}:${r.baseUnit}`)).size === 1))
    ? ["units", "boxes"].includes(key)
      ? rows.reduce((n, r) => n + Number(r[key]), 0)
      : roundReport(rows.reduce((n, r) => n + Number(r[key]), 0))
    : null;
const hasRecordedSale = (item: any) =>
  [
    "total_amount",
    "totalAmount",
    "total",
    "itemTotal",
    "actual_value",
    "actualValue",
    "phifValue",
    "insurance_amount",
    "insuranceAmount",
    "outside_insurance_amount",
    "outsideInsuranceAmount",
  ].some(
    (key) =>
      item.phif_financial_fields?.[key] != null &&
      item.phif_financial_fields[key] !== "" &&
      Number.isFinite(Number(item.phif_financial_fields[key])),
  );
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
  referenceForms?: any[];
  settings: BoxSetting[];
  access: AnalyticsAccess;
  filters: AnalyticsFilters;
  canExport?: boolean;
  canManageBoxes?: boolean;
  settingsAvailable?: boolean;
  supplierUnitsAvailable?: boolean;
}) {
  const invoiceMap = new Map(input.invoices.map((i) => [i.id, i]));
  const visibleSetting = (setting: BoxSetting | undefined) => {
    if (!setting) return null;
    const { supplier_unit_exceptions, ...publicSetting } = setting;
    return input.canManageBoxes ? setting : publicSetting;
  };
  const financial = new Map(input.rows.map((r) => [r.item_id, r]));
  const settingGroups = new Map<string, BoxSetting[]>();
  for (const setting of input.settings) {
    const key = reportSettingKey(setting.item_identity);
    if (key) settingGroups.set(key, [...(settingGroups.get(key) || []), setting]);
  }
  const identities = resolveReportIdentities(
    input.items,
    input.rows,
    input.stocks,
    input.referenceForms,
  );
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
    if (!source || !input.access[source].items) continue;
    const rights = input.access[source],
      f = financial.get(item.id);
    const invoice = invoiceMap.get(item.phif_invoice_id);
    if (!invoice || !f) continue;
    const identity = identities.get(item.id)!;
    const term = input.filters.q.toLowerCase().replace(/\s+/g, "");
    if (
      term &&
      !`${identity.ingredient}${identity.strength}`.toLowerCase().replace(/\s+/g, "").includes(term)
    )
      continue;
    const candidates = settingGroups.get(identity.key) || [];
    const settingConflict =
      new Set(candidates.map((s) => JSON.stringify([s.units_per_box,s.base_unit,s.supplier_quantity_unit ?? null,
        Object.entries(s.supplier_unit_exceptions || {}).sort(([a],[b])=>a.localeCompare(b))]))).size > 1;
    const setting = settingConflict
      ? undefined
      : candidates.find((s) => s.item_identity === identity.key) || candidates[0];
    const evidence = source === "actual"
      ? { unit: actualUnit(f.invoice_quantity_unit), issue: null, provenance: "actual_engine" }
      : reportSupplierUnit({ ...item, report_form: identity.form }, setting);
    const unit =
      actualUnit(evidence.unit) || (source === "actual" ? actualSourceUnit(item).unit : null);
    const quantity = item.quantity == null || item.quantity === "" ? NaN : Number(item.quantity);
    const baseUnit = source === "phif" ? setting?.base_unit || actualUnit(identity.form)
      : actualUnit(f.actual_cost_unit) || actualUnit(identity.form);
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
    const boxSize: number | null = source === "phif" ? setting?.units_per_box ?? null : packageQuantity;
    let boxes: number | null = units != null && boxSize ? units / boxSize : null;
    if (source === "actual" && unit === "box" && !evidence.issue && Number.isFinite(quantity) && quantity >= 0) boxes = quantity;
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
      card: rights.movements
        ? String(invoice.insurance_card_number ?? "")
            .normalize("NFKC")
            .replace(/[\s\u200e\u200f]/g, "") || null
        : null,
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
      reportingBox: source === "phif" ? visibleSetting(setting) : null,
      unitIssue: evidence.issue || (units == null ? "undocumented_conversion" : null),
      unitProvenance: evidence.provenance,
      boxSize,
      baseUnit,
      packageQuantity,
      stripsPerPackage: strips,
    };
    const group = groups.get(identity.key) ?? {
      id: identity.key,
      ...identity,
      setting: visibleSetting(setting),
      settingConflict,
      rows: [],
      saleItems: [],
    };
    group.rows.push(row);
    // Only a verified dispensing unit can turn a recorded price into a box price.
    if (
      source === "phif" &&
      rights.revenue &&
      units != null &&
      units > 0 &&
      f.revenue != null &&
      hasRecordedSale(item)
    ) {
      group.saleItems.push({
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
  const historyMovements: AnalyticsRow[] = [];
  for (const g of groups.values()) {
    const scoped = g.rows.filter(
      (r: AnalyticsRow) => input.filters.source === "all" || input.filters.source === r.source,
    );
    const rows = scoped.filter(
      (r: AnalyticsRow) => !selectedRange || inWindow(r.date, selectedRange),
    );
    if (!rows.length) continue;
    historyMovements.push(...scoped);
    const sourceTotal = (src: string, metric: "units" | "boxes") =>
      total(
        rows.filter((r: AnalyticsRow) => r.source === src),
        metric,
      );
    const previous = comparisonRange
      ? total(
          scoped.filter((r: AnalyticsRow) => inWindow(r.date, comparisonRange)),
          "boxes",
        )
      : null;
    const lastThree = averageRange
      ? total(
          scoped.filter((r: AnalyticsRow) => inWindow(r.date, averageRange)),
          "boxes",
        )
      : null;
    const boxes = total(rows, "boxes");
    const lastSale = latestReportSupplierSale(g.saleItems);
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
      settingConflict: g.settingConflict,
      sources: [...new Set(rows.map((r: AnalyticsRow) => r.source))],
      actualUnits: sourceTotal("actual", "units"),
      actualQuantities: [...new Set(rows.filter((r: AnalyticsRow) => r.source === "actual").map((r: AnalyticsRow) => r.unit))]
        .map(unit => ({ unit, quantity: unit ? rows.filter((r: AnalyticsRow) => r.source === "actual" && r.unit === unit)
          .reduce((n: number, r: AnalyticsRow) => r.quantity == null ? NaN : n + r.quantity, 0) : null })),
      phifUnits: sourceTotal("phif", "units"),
      actualBoxes: sourceTotal("actual", "boxes"),
      phifBoxes: sourceTotal("phif", "boxes"),
      units: total(rows, "units"),
      boxes,
      beneficiaries: rows.every((r: AnalyticsRow) => input.access[r.source].movements)
        ? new Set(rows.map((r: AnalyticsRow) => r.card).filter(Boolean)).size
        : null,
      historicalBeneficiaries: scoped.every((r: AnalyticsRow) => input.access[r.source].movements)
        ? new Set(scoped.map((r: AnalyticsRow) => r.card).filter(Boolean)).size
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
      latestActualSale: null,
      actualBoxSale: null,
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
    items: summaries.filter((s) => s.identityComplete),
    reviewItems: summaries.filter((s) => !s.identityComplete),
    invoices,
    beneficiaries,
    movements,
    historyMovements,
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
    supplierUnitsAvailable: input.supplierUnitsAvailable === true,
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
