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
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}.+% -]/gu, "");
}

function normalizeStrength(value: unknown) {
  return normalizeText(value).replace(/\s+/g, "");
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

export function matchActualInvoiceItemToStock(item: InvoiceItemLike, candidates: StockLike[]): ActualMatchResult {
  if (item.source_classification === "phif-supplier") {
    return { status: "needs_match_review", reason: "not_actual" };
  }

  const brand = normalizeText(item.brand);
  const strength = normalizeStrength(item.strength);
  const brandProductId = pickString(item.metadata, ["supplier_brand_name_id", "brand_product_id", "brand_id"]);
  const supplierId = pickString(item.metadata, ["supplier_id", "medical_suppliers_id"]);
  const packageQuantity = pickString(item.metadata, ["package_quantity", "packageQuantity"]);
  const stripsQuantity = pickString(item.metadata, ["strips_quantity", "stripsQuantity"]);

  if (!brand && !brandProductId) return { status: "needs_match_review", reason: "unsafe_identity" };

  const matches = candidates.filter((stock) => {
    if (!idsMatchOrMissing(brandProductId, stock.brand_product_id)) return false;
    if (!idsMatchOrMissing(supplierId, stock.supplier_id)) return false;
    if (!idsMatchOrMissing(packageQuantity, stock.package_quantity)) return false;
    if (!idsMatchOrMissing(stripsQuantity, stock.strips_quantity)) return false;
    if (brand && normalizeText(stock.brand_name) !== brand) return false;
    if (strength && normalizeStrength(stock.strength) !== strength) return false;
    return Boolean(brandProductId || brand);
  });

  if (matches.length === 1) return { status: "matched", stock: matches[0], reason: "commercial_identity" };
  if (matches.length > 1) return { status: "needs_match_review", reason: "ambiguous_match", candidates: matches };
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
  const unitPrice = invoiceUnitPrice(item);
  const costPrice = toNumber(match.stock.cost_price);
  const unitMatchesInvoice = quantity !== null && unitPrice > 0 && Math.abs(quantity * unitPrice - invoiceValue) < 0.01;
  if (quantity === null || costPrice === null || invoiceValue <= 0 || !unitMatchesInvoice) {
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
  return eligible.length > 0 ? eligible : [];
}
