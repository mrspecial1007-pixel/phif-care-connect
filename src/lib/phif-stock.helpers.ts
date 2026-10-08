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
};

type InvoiceItemLike = {
  brand?: string | null;
  active_ingredient?: string | null;
  strength?: string | null;
  quantity?: string | number | null;
  source_classification?: string | null;
  phif_financial_fields?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type ActualMatchResult =
  | { status: "matched"; stock: StockLike; reason: string }
  | { status: "needs_match_review"; reason: "no_match" | "ambiguous_match" | "not_actual" | "unsafe_identity"; candidates?: StockLike[] };

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
    .replace(/[^\p{L}\p{N}.+% -]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStrength(value: unknown) {
  const compact = normalizeText(value)
    .replace(/\s+/g, "")
    .replace(/mcg/g, "mcg")
    .replace(/iu\/?ml/g, "iu")
    .replace(/^u(\d+)/, "$1iu");
  return compact
    .replace(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)(mg|mcg|iu|g)\b/g, "$1$3/$2$3")
    .replace(/\bu(\d+)/g, "$1iu");
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
  return !left || !right || left === right || left.includes(right) || right.includes(left);
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
  return pickString(item.metadata, ["unit", "dosage_unit", "quantity_unit", "quantityUnit", "dosage_form", "dosageForm"])
    ?? pickString(item.phif_financial_fields, ["unit", "quantity_unit", "dosage_unit"]);
}

function sameStockIdentity(a: StockLike, b: StockLike) {
  return ["brand_product_id", "supplier_id", "generic_ingredient_id", "brand_name", "strength", "dosage_unit", "cost_price", "package_quantity", "strips_quantity"]
    .every((key) => normalizeText(a[key as keyof StockLike]) === normalizeText(b[key as keyof StockLike]));
}

export function matchActualInvoiceItemToStock(item: InvoiceItemLike, candidates: StockLike[]): ActualMatchResult {
  if (item.source_classification === "phif-supplier") {
    return { status: "needs_match_review", reason: "not_actual" };
  }

  const brand = normalizeText(item.brand);
  const strength = normalizeStrength(item.strength);
  const brandProductId = pickString(item.metadata, ["supplier_brand_name_id", "brand_product_id", "brand_id"])
    ?? pickString(item.phif_financial_fields, ["supplier_brand_name_id", "brand_product_id", "brand_id"]);
  const supplierId = pickString(item.metadata, ["supplier_id", "medical_suppliers_id"])
    ?? pickString(item.phif_financial_fields, ["supplier_id", "medical_suppliers_id"]);
  const genericId = pickString(item.metadata, ["generic_ingredient_id", "generic_id", "genaric_names_id"])
    ?? pickString(item.phif_financial_fields, ["generic_ingredient_id", "generic_id", "genaric_names_id"]);
  const supplier = normalizeText((item as InvoiceItemLike & { supplier?: string | null }).supplier);
  const packageQuantity = pickString(item.metadata, ["package_quantity", "packageQuantity"])
    ?? pickString(item.phif_financial_fields, ["package_quantity", "packageQuantity"]);
  const stripsQuantity = pickString(item.metadata, ["strips_quantity", "stripsQuantity"])
    ?? pickString(item.phif_financial_fields, ["strips_quantity", "stripsQuantity"]);

  if (!brand && !brandProductId && !genericId) return { status: "needs_match_review", reason: "unsafe_identity" };

  const itemPricingUnit = invoiceUnit(item);
  const matches = candidates.filter((stock) => {
    if (!idsMatchOrMissing(brandProductId, stock.brand_product_id)) return false;
    if (!idsMatchOrMissing(supplierId, stock.supplier_id)) return false;
    if (!idsMatchOrMissing(genericId, stock.generic_ingredient_id)) return false;
    if (supplier && stock.supplier_name && !tokenCompatibleText(stock.supplier_name, supplier)) return false;
    if (!idsMatchOrMissing(packageQuantity, stock.package_quantity)) return false;
    if (!idsMatchOrMissing(stripsQuantity, stock.strips_quantity)) return false;
    if (itemPricingUnit && stock.dosage_unit && normalizedUnit(itemPricingUnit) !== normalizedUnit(stock.dosage_unit)) return false;
    if (brand && !tokenCompatibleText(stock.brand_name, brand)) return false;
    if (strength && !compatibleStrength(stock.strength, strength) && !tokenCompatibleText(stock.brand_name, item.brand)) return false;
    return Boolean(brandProductId || brand || (genericId && strength));
  });

  // Repeated immutable snapshots of the same stock product are not competing products.
  const distinct = matches.filter((stock, index) => !matches.slice(0, index).some((other) => sameStockIdentity(stock, other)));
  if (distinct.length === 1) return { status: "matched", stock: matches[0], reason: "commercial_identity" };
  if (distinct.length > 1) return { status: "needs_match_review", reason: "ambiguous_match", candidates: distinct };
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
  const itemUnit = invoiceUnit(item);
  const stockUnit = match.stock.dosage_unit;
  const unitsAgree = itemUnit && stockUnit ? normalizedUnit(itemUnit) === normalizedUnit(stockUnit) : true;
  if (quantity === null || quantity <= 0 || costPrice === null || invoiceValue <= 0 || !unitsAgree) {
    return {
      status: "pricing_unit_unverified",
      invoiceValue,
      purchaseCost: null,
      grossMargin: null,
      stock: match.stock,
      reason: "pricing_unit_unverified",
    };
  }

  const purchaseCost = quantity * costPrice;
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
