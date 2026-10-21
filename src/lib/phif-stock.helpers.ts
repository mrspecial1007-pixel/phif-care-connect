import type { ActualStockLink } from "./actual-stock-links.helpers";
import { actualCostUnits, type ActualUnitDecision } from "./actual-units.helpers";

export type StockQuantityBreakdown = {
  originalQuantity: number | null;
  stripsPerBox: number | null;
  boxes: number | null;
  remainingStrips: number | null;
  canConvertToBoxes: boolean;
  label: string;
};

type StockLike = {
  brand_name?: string | null;
  active_ingredient?: string | null;
  strength?: string | null;
  dosage_unit?: string | null;
  package_quantity?: string | number | null;
  strips_quantity?: string | number | null;
  stock_quantity?: string | number | null;
  source_quantity_unit?: string | null;
  expiry_date?: string | null;
  cost_price?: string | number | null;
  sale_price?: string | number | null;
  source_stock_id?: string | null;
  brand_product_id?: string | null;
  supplier_id?: string | null;
  generic_ingredient_id?: string | null;
  synced_at?: string | null;
  supplier_name?: string | null;
  is_current?: boolean;
};

type InvoiceItemLike = {
  actual_unit_decision?: ActualUnitDecision;
  manual_stock_link?: ActualStockLink;
  brand?: string | null;
  active_ingredient?: string | null;
  strength?: string | null;
  quantity?: string | number | null;
  source_classification?: string | null;
  phif_financial_fields?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type ActualMatchResult =
  | { status: "matched"; stock: StockLike; reason: string; equivalentStocks?: StockLike[] }
  | { status: "needs_match_review"; reason: "no_match" | "ambiguous_match" | "not_actual" | "unknown_source" | "unsafe_identity" | "strength_mismatch" | "unit_mismatch" | "supplier_mismatch" | "manual_target_unavailable"; candidates?: StockLike[] };

export type ActualProfitResult = {
  status: "matched" | "needs_match_review" | "pricing_unit_unverified" | "phif_supplier_excluded";
  invoiceValue: number;
  purchaseCost: number | null;
  grossMargin: number | null;
  stock: StockLike | null;
  reason: string;
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function pluralBoxes(count: number) {
  if (count === 1) return "1 علبة";
  if (count === 2) return "2 علب";
  return `${count.toLocaleString("ar-LY", { maximumFractionDigits: 0 })} علب`;
}

function pluralStrips(count: number) {
  if (count === 1) return "1 شريط";
  if (count === 2) return "2 أشرطة";
  return `${count.toLocaleString("ar-LY", { maximumFractionDigits: 0 })} أشرطة`;
}

export function stockQuantityBreakdown(quantityValue: unknown, stripsQuantityValue: unknown, unit = "شريط"): StockQuantityBreakdown {
  const quantity = toNumber(quantityValue);
  const stripsPerBox = toNumber(stripsQuantityValue);
  if (quantity === null) {
    return {
      originalQuantity: null,
      stripsPerBox,
      boxes: null,
      remainingStrips: null,
      canConvertToBoxes: false,
      label: "—",
    };
  }
  if (!stripsPerBox || stripsPerBox <= 0) {
    return {
      originalQuantity: quantity,
      stripsPerBox: null,
      boxes: null,
      remainingStrips: null,
      canConvertToBoxes: false,
      label: `${quantity.toLocaleString("ar-LY", { maximumFractionDigits: 2 })} ${unit || "وحدة"}`,
    };
  }

  const boxes = Math.floor(quantity / stripsPerBox);
  const remainingStrips = quantity % stripsPerBox;
  const parts = [];
  if (boxes > 0) parts.push(pluralBoxes(boxes));
  if (remainingStrips > 0) parts.push(pluralStrips(remainingStrips));
  return {
    originalQuantity: quantity,
    stripsPerBox,
    boxes,
    remainingStrips,
    canConvertToBoxes: true,
    label: parts.length > 0 ? parts.join(" + ") : "نفد",
  };
}

export function stockAvailability(stock: Pick<StockLike, "stock_quantity" | "strips_quantity" | "expiry_date">) {
  const quantity = toNumber(stock.stock_quantity) ?? 0;
  const stripsPerBox = toNumber(stock.strips_quantity);
  if (quantity <= 0) return { status: "out" as const, label: "نفد", tone: "danger" as const };
  if (stripsPerBox && quantity <= stripsPerBox) return { status: "low" as const, label: "منخفض", tone: "warning" as const };
  return { status: "available" as const, label: "متوفر", tone: "success" as const };
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[µμ]/g, "mc")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}.+%/ -]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStrength(value: unknown) {
  const compact = normalizeText(value)
    .replace(/\s+/g, "")
    .replace(/mcg/g, "mcg")
    .replace(/iu\/?ml/g, "iu")
    .replace(/^u(\d+)/, "$1iu");
  const expandedCompound = compact.replace(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)(mg|mcg|iu|g)\b/g, "$1$3/$2$3");
  const withCanonicalMass = expandedCompound.replace(/(\d+(?:\.\d+)?)(mg|mcg)\b/g, (_match, amount, unit) => {
    const numeric = Number(amount);
    if (!Number.isFinite(numeric)) return `${amount}${unit}`;
    const mcg = unit === "mg" ? numeric * 1000 : numeric;
    return `${Number.isInteger(mcg) ? String(mcg) : String(mcg).replace(/0+$/, "").replace(/\.$/, "")}mcg`;
  });
  return withCanonicalMass.replace(/\bu(\d+)/g, "$1iu");
}

function pickString(fields: Record<string, unknown> | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = fields?.[key];
    if (value === null || value === undefined || value === "") continue;
    return String(value).trim();
  }
  return null;
}

function pickMoney(fields: Record<string, unknown> | null | undefined, keys: string[]) {
  for (const key of keys) {
    const parsed = toNumber(fields?.[key]);
    if (parsed !== null) return parsed;
  }
  return 0;
}

export function invoiceItemValue(item: InvoiceItemLike) {
  return pickMoney(item.phif_financial_fields, [
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
  ]);
}

function invoiceUnitPrice(item: InvoiceItemLike) {
  return pickMoney(item.phif_financial_fields, ["sale_price", "salePrice", "unit_price", "unitPrice", "price"]);
}

function idsMatchOrMissing(a: unknown, b: unknown) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  return !left || !right || left === right;
}

function compatibleText(a: unknown, b: unknown) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function canonicalTextToken(token: string) {
  const normalized = normalizeStrength(token).replace(/^[.\-]+|[.\-]+$/g, "");
  const aliases: Record<string, string> = {
    tab: "tabs",
    tablet: "tabs",
    tablets: "tabs",
    tabs: "tabs",
    cap: "caps",
    capsule: "caps",
    capsules: "caps",
    caps: "caps",
    inj: "inj",
    injection: "inj",
    injections: "inj",
    injectable: "inj",
    pen: "pen",
    pens: "pen",
    vial: "vial",
    vials: "vial",
    amp: "amp",
    ampoule: "amp",
    ampoules: "amp",
    solostar: "pen",
  };
  return aliases[normalized] ?? normalized;
}

function textTokens(value: unknown) {
  return normalizeText(value)
    .split(/[\s/+*,;:_-]+/)
    .map(canonicalTextToken)
    .filter((token) => token.length >= 2);
}

function descriptiveBrandTokens(value: unknown) {
  return new Set(textTokens(value).filter((token) => {
    if (["tabs", "caps", "inj", "pen", "vial", "amp", "strip"].includes(token)) return true;
    if (/^\d+(?:\.\d+)?(?:mcg|mg|g|iu|ml|%)$/.test(token)) return true;
    if (/^\d+x\d+(?:\.\d+)?(?:mcg|mg|g|iu|ml)?$/.test(token)) return true;
    return false;
  }));
}

function strengthDescriptorTokens(value: unknown) {
  const raw = normalizeText(value);
  const tokens = new Set(textTokens(raw));
  const compact = raw.replace(/\s+/g, "");
  for (const match of compact.matchAll(/(\d+(?:\.\d+)?)(mcg|mg|g|iu|ml|%)\b/g)) {
    tokens.add(match[1]);
    tokens.add(match[2]);
    tokens.add(canonicalTextToken(`${match[1]}${match[2]}`));
  }
  for (const match of compact.matchAll(/u(\d+)\b/g)) {
    tokens.add(`u${match[1]}`);
    tokens.add(`${match[1]}iu`);
  }
  return tokens;
}

function explicitPackageDescriptors(value: unknown) {
  // Parse explicit package counts from either imported name, even when invoice metadata is empty.
  // Do not strip arbitrary numbers: they may belong to the commercial brand.
  const packageDescriptors = new Set<string>();
  const counts = new Set<string>();
  const units = new Set<string>();
  const raw = normalizeText(value);
  for (const match of raw.matchAll(/\b(\d+)\s*(tabs?|tablets?|caps?|capsules?|pens?|vials?|amps?|ampoules?|strips?)\b/g)) {
    units.add(canonicalTextToken(match[2]));
    // In "5/1000 Tabs", 1000 is a strength component, not a pack count.
    if (/[\/+.]$/.test(raw.slice(0, match.index).trimEnd())) continue;
    packageDescriptors.add(match[1]);
    counts.add(match[1]);
    packageDescriptors.add(canonicalTextToken(match[0].replace(/\s+/g, "")));
  }
  for (const match of raw.matchAll(/\b(?:tabs?|tablets?|caps?|capsules?|pens?|vials?|amps?|ampoules?|strips?)\s+(\d+)(?=\s*(?:$|\d+(?:\.\d+)?\s*(?:mcg|mg|g|iu|ml)\b))/g)) {
    packageDescriptors.add(match[1]);
    counts.add(match[1]);
  }
  return { tokens: packageDescriptors, units, count: counts.size === 1 ? [...counts][0] : null };
}

function commercialBrandTokens(value: unknown, context: { strength?: unknown; unit?: unknown; packageQuantity?: unknown; stripsQuantity?: unknown } = {}) {
  const descriptors = new Set([
    ...descriptiveBrandTokens(value),
    ...strengthDescriptorTokens(context.strength),
    ...textTokens(context.unit),
    ...explicitPackageDescriptors(value).tokens,
  ]);
  return textTokens(value).filter((token) => !descriptors.has(token));
}

function commercialBrandCompatible(
  stockBrand: unknown,
  itemBrand: unknown,
  stockContext: { strength?: unknown; unit?: unknown; packageQuantity?: unknown; stripsQuantity?: unknown } = {},
  itemContext: { strength?: unknown; unit?: unknown; packageQuantity?: unknown; stripsQuantity?: unknown } = {},
) {
  const stockTokens = commercialBrandTokens(stockBrand, stockContext);
  const itemTokens = commercialBrandTokens(itemBrand, itemContext);
  if (stockTokens.length === 0 || itemTokens.length === 0) return false;
  const stockSet = new Set(stockTokens);
  const itemSet = new Set(itemTokens);
  if (stockSet.size !== itemSet.size) return false;
  return [...itemSet].every((token) => stockSet.has(token));
}

function tokenCompatibleText(a: unknown, b: unknown) {
  if (compatibleText(a, b)) return true;
  const leftTokens = new Set(textTokens(a));
  const rightTokens = textTokens(b);
  if (leftTokens.size === 0 || rightTokens.length === 0) return false;
  const matching = rightTokens.filter((token) => leftTokens.has(token) || [...leftTokens].some((left) => left.includes(token) || token.includes(left)));
  return matching.length >= Math.min(rightTokens.length, 2);
}

function compatibleStrength(a: unknown, b: unknown) {
  const left = normalizeStrength(a);
  const right = normalizeStrength(b);
  if (!left || !right) return !left || !right;
  if (left === right) return true;

  const splitComponents = (value: string) =>
    value
      .split(/[+/]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .sort();
  const leftComponents = splitComponents(left);
  const rightComponents = splitComponents(right);
  if (leftComponents.length !== rightComponents.length) return false;
  return leftComponents.every((part, index) => part === rightComponents[index]);
}

function normalizedUnit(value: unknown) {
  const unit = normalizeText(value);
  const aliases: Record<string, string> = {
    tab: "tabs", tablet: "tabs", tablets: "tabs", tabs: "tabs", "قرص": "tabs", "أقراص": "tabs",
    cap: "caps", capsule: "caps", capsules: "caps", caps: "caps", "كبسولة": "caps",
    pen: "pen", pens: "pen", "قلم": "pen", inj: "inj", injection: "inj", injections: "inj", "حقنة": "inj",
    vial: "vial", vials: "vial", amp: "amp", ampoule: "amp", strip: "strip", strips: "strip", "شريط": "strip",
  };
  return aliases[unit] ?? unit;
}

function invoiceUnit(item: InvoiceItemLike) {
  const explicit = pickString(item.metadata, ["unit", "dosage_unit", "quantity_unit", "quantityUnit", "dosage_form", "dosageForm"])
    ?? pickString(item.phif_financial_fields, ["unit", "quantity_unit", "dosage_unit"]);
  if (explicit) return explicit;
  const units = new Set([...textTokens(item.brand), ...explicitPackageDescriptors(item.brand).units]
    .filter(token => ["tabs", "caps", "inj", "pen", "vial", "amp", "strip"].includes(token)));
  return units.size === 1 ? [...units][0] : null;
}

function invoiceDosageUnit(item: InvoiceItemLike) {
  const form = pickString(item.metadata, ["dosage_form", "dosageForm", "dosage_unit"])
    ?? pickString(item.phif_financial_fields, ["dosage_form", "dosageForm", "dosage_unit"]);
  const unit = form ?? invoiceUnit(item);
  if (!unit || ["box", "boxes", "pack", "packs", "strip"].includes(normalizedUnit(unit))) {
    return invoiceUnit({ ...item, metadata: null, phif_financial_fields: null });
  }
  return unit;
}

function sameStockIdentity(a: StockLike, b: StockLike) {
  return ["brand_product_id", "generic_ingredient_id", "brand_name", "strength", "dosage_unit", "cost_price", "package_quantity", "strips_quantity"]
    .every((key) => normalizeText(a[key as keyof StockLike]) === normalizeText(b[key as keyof StockLike]));
}

export function validateActualStockLink(item: InvoiceItemLike, stock: StockLike) {
  if (item.source_classification !== "actual-supplier") throw new Error("الربط متاح لبنود Actual فقط");
  if (!item.strength || !stock.strength || !compatibleStrength(item.strength, stock.strength)) throw new Error("التركيز غير مؤكد أو مختلف");
  if (!stock.brand_name || !stock.dosage_unit) throw new Error("هوية صنف المخزون غير مكتملة");
  const form = invoiceDosageUnit(item);
  if (form && normalizedUnit(form) !== normalizedUnit(stock.dosage_unit)) throw new Error("الشكل الدوائي مختلف");
  for (const key of ["package_quantity", "strips_quantity"] as const) {
    const value = item.metadata?.[key] ?? item.phif_financial_fields?.[key]
      ?? (key === "package_quantity" ? explicitPackageDescriptors(item.brand).count : null);
    if (!idsMatchOrMissing(value, stock[key])) throw new Error("بيانات العبوة مختلفة");
  }
}

function manualActualMatch(item: InvoiceItemLike, candidates: StockLike[]): ActualMatchResult | null {
  const link = item.manual_stock_link;
  if (!link?.is_active) return null;
  const target = link.target;
  try { validateActualStockLink(item, target); } catch { return { status: "needs_match_review", reason: "manual_target_unavailable" }; }
  const matches = candidates.filter(stock => stock.is_current !== false
    && (target.brand_product_id ? stock.brand_product_id === target.brand_product_id : stock.source_stock_id === target.source_stock_id)
    && normalizeText(stock.brand_name) === normalizeText(target.brand_name)
    && compatibleStrength(stock.strength, target.strength)
    && normalizedUnit(stock.dosage_unit) === normalizedUnit(target.dosage_unit)
    && idsMatchOrMissing(stock.package_quantity, target.package_quantity)
    && idsMatchOrMissing(stock.strips_quantity, target.strips_quantity));
  if (!matches.length) return { status: "needs_match_review", reason: "manual_target_unavailable" };
  // Identity is confirmed, but competing current costs are never chosen arbitrarily.
  const prices = new Set(matches.map(stock => toNumber(stock.cost_price)));
  return { status: "matched", reason: "manual_link", equivalentStocks: matches, stock: { ...matches[0], cost_price: prices.size === 1 ? matches[0].cost_price : null } };
}

export function matchActualInvoiceItemToStock(item: InvoiceItemLike, candidates: StockLike[]): ActualMatchResult {
  if (item.source_classification === "phif-supplier") {
    return { status: "needs_match_review", reason: "not_actual" };
  }
  if (item.source_classification !== "actual-supplier") {
    return { status: "needs_match_review", reason: item.source_classification ? "not_actual" : "unknown_source" };
  }

  const manual = manualActualMatch(item, candidates);
  if (manual) return manual;

  const brand = normalizeText(item.brand);
  const strength = normalizeStrength(item.strength);
  const brandProductId = pickString(item.metadata, ["supplier_brand_name_id", "brand_product_id", "brand_id"])
    ?? pickString(item.phif_financial_fields, ["supplier_brand_name_id", "brand_product_id", "brand_id"]);
  const genericId = pickString(item.metadata, ["generic_ingredient_id", "generic_id", "genaric_names_id"])
    ?? pickString(item.phif_financial_fields, ["generic_ingredient_id", "generic_id", "genaric_names_id"]);
  const packageQuantity = pickString(item.metadata, ["package_quantity", "packageQuantity"])
    ?? pickString(item.phif_financial_fields, ["package_quantity", "packageQuantity"])
    ?? explicitPackageDescriptors(item.brand).count;
  const stripsQuantity = pickString(item.metadata, ["strips_quantity", "stripsQuantity"])
    ?? pickString(item.phif_financial_fields, ["strips_quantity", "stripsQuantity"]);

  if (!brand && !brandProductId && !genericId) return { status: "needs_match_review", reason: "unsafe_identity" };

  const itemPricingUnit = invoiceUnit(item);
  const itemDosageUnit = invoiceDosageUnit(item);
  let sawBrandLike = false;
  let sawStrengthMismatch = false;
  let sawUnitMismatch = false;
  const matches = candidates.filter((stock) => {
    if (!idsMatchOrMissing(brandProductId, stock.brand_product_id)) return false;
    if (!idsMatchOrMissing(genericId, stock.generic_ingredient_id)) return false;
    if (!idsMatchOrMissing(packageQuantity, stock.package_quantity ?? explicitPackageDescriptors(stock.brand_name).count)) return false;
    if (!idsMatchOrMissing(stripsQuantity, stock.strips_quantity)) return false;
    const brandMatches = !brand || commercialBrandCompatible(
      stock.brand_name,
      item.brand,
      {
        strength: stock.strength,
        unit: stock.dosage_unit,
        packageQuantity: stock.package_quantity,
        stripsQuantity: stock.strips_quantity,
      },
      {
        strength: item.strength,
        unit: itemPricingUnit,
        packageQuantity,
        stripsQuantity,
      },
    );
    if (!brandMatches) return false;
    sawBrandLike = true;
    if (strength && stock.strength && !compatibleStrength(stock.strength, strength)) {
      sawStrengthMismatch = true;
      return false;
    }
    if (strength && !stock.strength && !tokenCompatibleText(stock.brand_name, item.brand)) {
      sawStrengthMismatch = true;
      return false;
    }
    if (itemDosageUnit && stock.dosage_unit && normalizedUnit(itemDosageUnit) !== normalizedUnit(stock.dosage_unit)) {
      sawUnitMismatch = true;
      return false;
    }
    return Boolean(brandProductId || brand || (genericId && strength));
  });

  // Repeated immutable snapshots of the same stock product are not competing products.
  const distinct = matches.filter((stock, index) => !matches.slice(0, index).some((other) => sameStockIdentity(stock, other)));
  if (distinct.length === 1) return { status: "matched", stock: matches[0], equivalentStocks: matches, reason: "commercial_identity" };
  if (distinct.length > 1) return { status: "needs_match_review", reason: "ambiguous_match", candidates: distinct };
  if (sawUnitMismatch) return { status: "needs_match_review", reason: "unit_mismatch" };
  if (sawStrengthMismatch) return { status: "needs_match_review", reason: "strength_mismatch" };
  if (sawBrandLike) return { status: "needs_match_review", reason: "no_match" };
  return { status: "needs_match_review", reason: "no_match" };
}

export function calculateActualGrossMargin(item: InvoiceItemLike, candidates: StockLike[]): ActualProfitResult {
  const invoiceValue = invoiceItemValue(item);
  if (item.source_classification === "phif-supplier") {
    return {
      status: "phif_supplier_excluded",
      invoiceValue,
      purchaseCost: null,
      grossMargin: null,
      stock: null,
      reason: "PHIF Supplier uses a separate margin model",
    };
  }

  const match = matchActualInvoiceItemToStock(item, candidates);
  if (match.status !== "matched") {
    return {
      status: "needs_match_review",
      invoiceValue,
      purchaseCost: null,
      grossMargin: null,
      stock: null,
      reason: match.reason,
    };
  }

  const quantity = toNumber(item.quantity);
  const costPrice = toNumber(match.stock.cost_price);
  const units = actualCostUnits(item, match.stock);
  if (quantity === null || quantity <= 0 || costPrice === null || costPrice < 0 || invoiceValue <= 0 || units.issue || units.factor === null) {
    return {
      status: "pricing_unit_unverified",
      invoiceValue,
      purchaseCost: null,
      grossMargin: null,
      stock: match.stock,
      reason: units.issue ?? "invalid_cost_or_quantity",
    };
  }

  const purchaseCost = quantity * units.factor * costPrice;
  return {
    status: "matched",
    invoiceValue,
    purchaseCost,
    grossMargin: invoiceValue - purchaseCost,
    stock: match.stock,
    reason: "verified_unit_price",
  };
}

export function stockSnapshotCandidatesForInvoice(item: InvoiceItemLike, stocks: StockLike[], dispensingDate?: string | null) {
  const invoiceTime = dispensingDate ? new Date(`${dispensingDate}T23:59:59.999Z`).getTime() : Number.POSITIVE_INFINITY;
  const eligible = stocks.filter((stock) => {
    if (!stock.synced_at) return false;
    const synced = new Date(stock.synced_at).getTime();
    return Number.isFinite(synced) && synced <= invoiceTime;
  });
  // A current snapshot cannot establish an invoice-date cost. Keep historical
  // invoices unmatched rather than silently passing a later cost as historical.
  return eligible;
}

export function currentStockCandidatesForActual(item: InvoiceItemLike, stocks: StockLike[]) {
  return stocks.filter(stock => stock.is_current !== false);
}
