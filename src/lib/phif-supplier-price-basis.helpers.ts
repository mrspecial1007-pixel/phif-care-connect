import { normalizeSupplierUnit, supplierInvoiceUnit, supplierQuickCostIdentity } from "./phif-supplier-quick-cost.helpers";
import { hasPermission, type TiryaqPermission } from "./user-permissions";
import { supplierQuantityEvidence } from "./report-medication-evidence.helpers";

export type SupplierPriceBasis = { amount: number; count: number; unit: string; confirmQuantityUnit?: boolean };

export function canManageSupplierBasis(user: { user_id?: string; user_role?: string; user_permissions?: Record<string, boolean> }) {
  const permissions: TiryaqPermission[] = ["phif_purchase_price_write", "phif_items_read", "phif_cost_read", "phif_movements_read"];
  return permissions.every(permission => !user.user_id && !user.user_role || hasPermission(user.user_role, user.user_permissions, permission));
}

export function supplierPricePresets(unit: unknown) {
  const canonical = normalizeSupplierUnit(unit);
  return canonical === "TAB" || canonical === "CAP" ? [1, 28, 30, 56, 60] : [1];
}

export function supplierBasisCost(quantity: unknown, basis: SupplierPriceBasis) {
  const q = Number(quantity);
  if (quantity == null || quantity === "" || !Number.isFinite(q) || q <= 0 || !Number.isFinite(basis.amount)
    || basis.amount < 0 || basis.amount > 1_000_000 || !Number.isSafeInteger(basis.count) || basis.count < 1 || basis.count > 10000
    || !normalizeSupplierUnit(basis.unit)) throw new Error("السعر أو كمية السعر أو الوحدة غير صحيحة");
  const total = Math.round((basis.amount * q / basis.count + Number.EPSILON) * 1000) / 1000;
  if (total > 1_000_000) throw new Error("تكلفة البند تتجاوز الحد المسموح");
  return total;
}

export function validateSupplierBasis(item: any, basis: SupplierPriceBasis) {
  if (item.source_classification !== "phif-supplier") throw new Error("هذا الإجراء خاص بـ PHIF Supplier فقط");
  const recorded = supplierQuantityEvidence(item);
  const unit = normalizeSupplierUnit(basis.unit);
  const imported = item.phif_financial_fields?.internal_purchase_import;
  if (imported?.authorization === "explicit_pharmacy_owner_approval_historical_only"
    && imported.unit_confirmation === "pharmacy_owner_individual_oral_units_confirmation"
    && unit !== "TAB" && unit !== "CAP") throw new Error("التوثيق التاريخي يثبت حبات مفردة؛ لا يجوز تفسيرها كعلب أو أشرطة");
  if (recorded.issue === "unknown" || recorded.issue === "conflict" || (recorded.unit && recorded.unit !== unit)) throw new Error("وحدة السعر تتعارض مع وحدة كمية الفاتورة أو غير موثقة");
  if (!recorded.unit && !basis.confirmQuantityUnit) throw new Error("أكد وحدة الكمية لهذا البند قبل اعتماد سعرها");
  return supplierBasisCost(item.quantity, basis);
}

export function supplierHistoricalCompatible(anchor: any, item: any) {
  const key = supplierQuickCostIdentity(anchor);
  return anchor.source_classification === "phif-supplier" && item.source_classification === "phif-supplier"
    && !key.startsWith('["unresolved"') && key === supplierQuickCostIdentity(item);
}

export function supplierPriceVersion(item: any) {
  return JSON.stringify([item.id, item.phif_invoice_id, item.quantity, item.brand, item.active_ingredient, item.strength,
    item.metadata ?? null, item.source_classification, item.phif_financial_fields ?? null]);
}

/** Store an invoice-item total: no product-wide default can affect future invoices. */
export function supplierBasisFields(item: any, basis: SupplierPriceBasis, actor: { id: string | null; at: string }) {
  const total = validateSupplierBasis(item, basis);
  const old = item.phif_financial_fields ?? {};
  const history = Array.isArray(old.internal_purchase_history) ? old.internal_purchase_history : [];
  const previous = Object.fromEntries(Object.entries(old).filter(([key]) => key.startsWith("internal_purchase_") && key !== "internal_purchase_history"));
  return { ...old, internal_purchase_cost_mode: "total_dispensed_cost", internal_purchase_cost_value: total,
    internal_purchase_cost_unit: null, internal_purchase_price: total, internal_purchase_unit: null, purchase_price_unit: null,
    internal_purchase_price_basis: { amount: basis.amount, count: basis.count, unit: normalizeSupplierUnit(basis.unit),
      quantity_unit_confirmed: Boolean(basis.confirmQuantityUnit), unit_price: basis.amount / basis.count },
    internal_purchase_price_updated_at: actor.at,
    internal_purchase_history: [...history, { user_id: actor.id, at: actor.at, previous,
      next: { mode: "total_dispensed_cost", value: total, basis: { amount: basis.amount, count: basis.count, unit: normalizeSupplierUnit(basis.unit) } } }],
  };
}

export function supplierSavedCost(item: any): { total: number | null; unitPrice: number | null } {
  const fields = item.phif_financial_fields ?? {};
  const raw = fields.internal_purchase_cost_value ?? fields.internal_purchase_price ?? fields.internalPurchasePrice;
  if (raw == null || raw === "" || !Number.isFinite(Number(raw)) || Number(raw) < 0) return { total: null, unitPrice: null };
  const value = Number(raw), quantity = Number(item.quantity);
  const mode = fields.internal_purchase_cost_mode || "unit_price";
  if (mode === "total_dispensed_cost") return { total: value, unitPrice: quantity > 0 ? value / quantity : null };
  const savedUnit = normalizeSupplierUnit(fields.internal_purchase_cost_unit ?? fields.internal_purchase_unit ?? fields.purchase_price_unit ?? fields.internalPurchaseUnit);
  return savedUnit && savedUnit === supplierInvoiceUnit(item).unit && quantity > 0
    ? { total: value * quantity, unitPrice: value } : { total: null, unitPrice: null };
}
