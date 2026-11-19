import { z } from "zod";
import { ACTUAL_UNITS } from "./actual-units.helpers";
import { summarizeReportBoxes } from "./report-box-quantity.helpers";
import type { AnalyticsRow, buildItemsAnalytics } from "./items-analytics.helpers";

const date = z
  .string()
  .refine(
    (v) =>
      v === "" ||
      (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
        !Number.isNaN(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v),
    "تاريخ غير صالح",
  );
export const trackingInput = z
  .object({
    item: z.string().max(1600).default(""),
    product: z.string().max(4000).default(""),
    mode: z.enum(["scientific", "brand"]).default("scientific"),
    source: z.enum(["all", "actual", "phif"]).default("all"),
    company: z.string().max(400).default(""),
    from: date.default(""),
    to: date.default(""),
    q: z.string().max(160).default(""),
    page: z.number().int().min(1).max(1_000_000).default(1),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, "بداية الفترة بعد نهايتها");
export type TrackingInput = z.infer<typeof trackingInput>;
export const trackingSourceLabel = (source: string) =>
  source === "phif" ? "PHIF Supplier" : source === "actual" ? "PHIF Actual Supplier" : "كل المصادر";
export const trackingText = (v: unknown) =>
  String(v ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
const originalText = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export type TrackingMovement = AnalyticsRow & {
  product: string | null;
  company: string | null;
  companyKey: string;
  legacyKey: string | null;
  identityComplete: boolean;
  quantityIssue: string | null;
};

/** Commercial attribution comes only from the saved invoice, never a current stock match. */
export function trackingMovements(
  report: ReturnType<typeof buildItemsAnalytics>,
  items: any[],
  financial: any[],
) {
  const originals = new Map(items.map((i) => [i.id, i]));
  const legacy = new Map(financial.map((r) => [r.item_id, r.identity_key]));
  const complete = new Set(report.items.map((i) => i.id));
  return report.historyMovements.map((r) => {
    const raw = originals.get(r.id);
    const brand = originalText(raw?.brand);
    const company =
      [raw?.supplier, raw?.metadata?.supplier_name, raw?.metadata?.company_name]
        .map(originalText)
        .find((value) => value && !/^(phif[\s_-]*)?(actual[\s_-]*)?supplier$/i.test(value)) || null;
    const companyKey = company ? trackingText(company) : "__unknown__";
    // Even when a supplier is recorded, a scientific-only movement has no commercial product.
    const product = brand ? JSON.stringify([r.identity, trackingText(brand), companyKey]) : null;
    return {
      ...r,
      brand,
      product,
      company,
      companyKey,
      legacyKey: legacy.get(r.id) ?? null,
      identityComplete: complete.has(r.identity),
      quantityIssue:
        r.quantity == null
          ? "الكمية غير محددة"
          : !r.unit || (r.unitIssue && r.unitIssue !== "undocumented_conversion")
            ? "وحدة الكمية غير موثقة أو متعارضة"
            : null,
    } satisfies TrackingMovement;
  });
}

const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
export function trackingSummary(rows: TrackingMovement[]) {
  const dates = rows
    .map((r) => r.date)
    .filter(validDate)
    .sort();
  const quantities = new Map<string, { unit: string; quantity: number }>();
  let unknownQuantity = 0;
  for (const r of rows) {
    if (r.quantityIssue || r.quantity == null || r.quantity < 0 || !r.unit) {
      unknownQuantity++;
      continue;
    }
    const packageUnit = r.unit === "box" || r.unit === "strip";
    if (
      packageUnit &&
      (!r.packageQuantity || !r.baseUnit || (r.unit === "strip" && !r.stripsPerPackage))
    ) {
      unknownQuantity++;
      continue;
    }
    const label =
      ACTUAL_UNITS[r.unit] +
      (packageUnit
        ? ` (${r.packageQuantity} ${ACTUAL_UNITS[r.baseUnit!]}${r.unit === "strip" ? ` / ${r.stripsPerPackage} أشرطة` : ""})`
        : "");
    const bucket = quantities.get(label) || { unit: label, quantity: 0 };
    bucket.quantity += r.quantity;
    quantities.set(label, bucket);
  }
  const sumMoney = (key: "revenue" | "cost" | "profit") =>
    rows.some((r) => r[key] != null) ? rows.reduce((sum, r) => sum + (r[key] ?? 0), 0) : null;
  return {
    items: rows.length,
    invoices: new Set(rows.map((r) => r.invoiceId)).size,
    beneficiaries: rows.every((r) => r.beneficiariesAvailable)
      ? new Set(rows.map((r) => r.card).filter(Boolean)).size
      : null,
    missingCards: rows.filter((r) => r.beneficiariesAvailable && !r.card).length,
    quantities: [...quantities.values()],
    unknownQuantity,
    boxes: summarizeReportBoxes(rows),
    first: dates[0] ?? null,
    last: dates.at(-1) ?? null,
    undated: rows.length - dates.length,
    revenue: sumMoney("revenue"),
    cost: sumMoney("cost"),
    profit: sumMoney("profit"),
    knownFinancialItems: rows.filter((r) => r.cost != null && r.profit != null).length,
  };
}
export const trackingQuantityLabel = (s: ReturnType<typeof trackingSummary>) =>
  [
    s.quantities
      .map((q) => `${q.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${q.unit}`)
      .join(" + "),
    s.unknownQuantity ? `${s.unknownQuantity} بند بكمية/تحويل غير محدد` : "",
  ]
    .filter(Boolean)
    .join(" · ") || "لا توجد كميات";

export function buildTrackingReport(all: TrackingMovement[], input: TrackingInput) {
  const catalogMap = new Map<
    string,
    {
      id: string;
      name: string;
      strength: string;
      form: string;
      complete: boolean;
      legacy: Set<string>;
      rows: TrackingMovement[];
    }
  >();
  for (const row of all) {
    const entry = catalogMap.get(row.identity) || {
      id: row.identity,
      name: row.ingredient,
      strength: row.strength,
      form: row.form,
      complete: row.identityComplete,
      legacy: new Set<string>(),
      rows: [],
    };
    entry.rows.push(row);
    if (row.legacyKey) entry.legacy.add(row.legacyKey);
    catalogMap.set(row.identity, entry);
  }
  const catalog = [...catalogMap.values()]
    .map(({ rows, legacy, ...entry }) => ({
      ...entry,
      history: trackingSummary(rows),
      products: [...new Set(rows.map((r) => r.product).filter((v): v is string => !!v))].map(
        (id) => {
          const related = rows.filter((r) => r.product === id),
            first = related[0];
          return {
            id,
            brand: first.brand!,
            company: first.company,
            history: trackingSummary(related),
          };
        },
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.strength.localeCompare(b.strength));
  const resolved = catalogMap.has(input.item)
    ? input.item
    : (() => {
        const aliases = [...catalogMap.values()].filter((c) => c.legacy.has(input.item));
        return aliases.length === 1 ? aliases[0].id : "";
      })();
  const scientific = all.filter((r) => r.identity === resolved);
  const inSource = scientific.filter((r) => input.source === "all" || r.source === input.source);
  const companies = [
    ...new Map(
      inSource.map((r) => [
        r.companyKey,
        { key: r.companyKey, name: r.company || "الشركة غير محددة" },
      ]),
    ).values(),
  ];
  const attributed = inSource.filter(
    (r) =>
      (!input.company || r.companyKey === input.company) &&
      (input.mode !== "brand" || (!!input.product && r.product === input.product)),
  );
  const periodRows = attributed
    .filter(
      (r) =>
        (!input.from && !input.to) ||
        (validDate(r.date) &&
          (!input.from || r.date >= input.from) &&
          (!input.to || r.date <= input.to)),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.invoiceId.localeCompare(b.invoiceId) ||
        a.id.localeCompare(b.id),
    );
  const group = (rows: TrackingMovement[], key: (row: TrackingMovement) => string) => {
    const groups = new Map<string, TrackingMovement[]>();
    for (const row of rows) {
      const k = key(row);
      const members = groups.get(k) || [];
      members.push(row);
      groups.set(k, members);
    }
    return [...groups].map(([key, rows]) => ({ key, summary: trackingSummary(rows) }));
  };
  const monthly = group(periodRows, (r) =>
    validDate(r.date) ? r.date.slice(0, 7) : "تاريخ غير محدد",
  );
  const byCompany = group(periodRows, (r) => r.companyKey).map((g) => ({
    ...g,
    key: periodRows.find((r) => r.companyKey === g.key)?.company || "الشركة غير محددة",
  }));
  const timelineMap = new Map<string, { date: string; actual: number; phif: number }>();
  for (const row of periodRows.filter((r) => validDate(r.date))) {
    const point = timelineMap.get(row.date) || { date: row.date, actual: 0, phif: 0 };
    point[row.source]++;
    timelineMap.set(row.date, point);
  }
  const chronology = group(periodRows, (r) =>
    JSON.stringify([r.date, r.company, r.brand, r.source]),
  ).map((g) => {
    const [date, company, brand, source] = JSON.parse(g.key);
    return { ...g, date, company, brand, source };
  });
  const products = group(periodRows, (r) => r.product || "__scientific__").map((g) => {
    const row = periodRows.find((r) => (r.product || "__scientific__") === g.key)!;
    return { ...g, brand: row.brand, company: row.product ? row.company : null };
  });
  return {
    catalog,
    selected: catalog.find((c) => c.id === resolved) || null,
    companies,
    summary: trackingSummary(periodRows),
    history: trackingSummary(attributed),
    scientificHistory: trackingSummary(scientific),
    undatedOutsidePeriod:
      input.from || input.to ? attributed.filter((r) => !validDate(r.date)).length : 0,
    products,
    monthly,
    byCompany,
    chronology,
    timeline: [...timelineMap.values()],
    movements: periodRows,
  };
}
