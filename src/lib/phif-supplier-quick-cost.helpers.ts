export type SupplierCostMode = "total_dispensed_cost" | "unit_price";
export type SupplierCostInput = { itemId: string; purchaseCostMode: SupplierCostMode; purchaseCostValue: number; purchaseCostUnit?: string };

const normalized = (value: unknown) => String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");

export function normalizeSupplierUnit(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = normalized(value).replace(/[\s._-]/g, "");
  const aliases: Record<string, string[]> = {
    TAB: ["tab", "tabs", "tablet", "tablets", "قرص", "قرصًا", "أقراص", "اقراص"],
    CAP: ["cap", "caps", "capsule", "capsules", "كبسولة", "كبسولات"],
    BOX: ["box", "boxes", "pack", "packs", "علبة", "علب"],
    STRIP: ["strip", "strips", "شريط", "أشرطة", "اشرطة"],
    PEN: ["pen", "pens", "قلم", "أقلام", "اقلام"],
    VIAL: ["vial", "vials", "فيال", "فيالات"],
    INJ: ["inj", "injection", "injections", "حقنة", "حقن"],
    AMP: ["amp", "amps", "ampoule", "ampoules", "ampule", "ampules", "أمبول", "امبول"],
    BOTTLE: ["bottle", "bottles", "زجاجة", "زجاجات"],
    ML: ["ml", "مل"], TUBE: ["tube", "tubes", "أنبوب", "انبوب"],
  };
  return Object.entries(aliases).find(([unit, names]) => unit.toLowerCase() === key || names.includes(key))?.[0] ?? null;
}

/** Imported quantity units only; a saved purchase-price unit is not evidence of dispensing units. */
export function supplierInvoiceUnit(item: any): { unit: string | null; issue: "missing" | "unknown" | "conflict" | null } {
  const meta = item.metadata ?? {};
  const fields = item.phif_financial_fields ?? {};
  for (const candidates of [
    [meta.quantity_unit, meta.quantityUnit, fields.quantity_unit, fields.quantityUnit],
    [meta.unit, fields.unit], [meta.dosage_unit, fields.dosage_unit],
  ]) {
    const values = candidates.filter(value => value !== null && value !== undefined && String(value).trim() !== "");
    if (!values.length) continue;
    const units = values.map(normalizeSupplierUnit);
    if (new Set(units).size > 1) return { unit: null, issue: "conflict" };
    return units[0] ? { unit: units[0], issue: null } : { unit: null, issue: "unknown" };
  }
  return { unit: null, issue: "missing" };
}

export function supplierInvoiceForm(item: any) {
  const meta = item.metadata ?? {};
  const raw = meta.dosage_form ?? meta.dosageForm ?? meta.form ?? meta.pharmaceuticalForm;
  if (typeof raw === "string" && raw.trim()) return normalizeSupplierUnit(raw) ?? normalized(raw);
  const unit = supplierInvoiceUnit(item).unit;
  return unit && ["TAB", "CAP", "INJ"].includes(unit) ? unit : null;
}

export function supplierQuantityLabel(quantity: unknown, unit: unknown) {
  const value = Number(quantity);
  const count = quantity === null || quantity === undefined || quantity === "" || !Number.isFinite(value) ? "—" : String(quantity);
  const canonical = normalizeSupplierUnit(unit);
  const words: Record<string, [string, string, string]> = {
    TAB: ["قرص", "أقراص", "قرصًا"], CAP: ["كبسولة", "كبسولات", "كبسولة"],
    BOX: ["علبة", "علب", "علبة"], STRIP: ["شريط", "أشرطة", "شريطًا"],
    PEN: ["قلم", "أقلام", "قلمًا"], VIAL: ["فيال", "فيالات", "فيال"],
    INJ: ["حقنة", "حقن", "حقنة"], AMP: ["أمبول", "أمبولات", "أمبول"],
    BOTTLE: ["زجاجة", "زجاجات", "زجاجة"], ML: ["مل", "مل", "مل"], TUBE: ["أنبوب", "أنابيب", "أنبوبًا"],
  };
  if (!canonical || count === "—") return count;
  const forms = words[canonical];
  return `${count} ${forms[value >= 3 && value <= 10 ? 1 : value >= 11 ? 2 : 0]}`;
}

/** Navigation identity only. Costs are always saved separately by invoice-item id. */
export function supplierQuickCostIdentity(item: any) {
  const meta = item.metadata ?? {};
  const name = normalized(item.active_ingredient || item.brand);
  const strength = normalized(item.strength).replace(/\s+/g, "");
  const unit = supplierInvoiceUnit(item).unit;
  const form = supplierInvoiceForm(item);
  if (!name || !strength || !form || !unit) return JSON.stringify(["unresolved", item.id]);
  return JSON.stringify([name, normalized(item.brand), strength, form, unit,
    normalized(meta.package_quantity ?? meta.packageQuantity), normalized(meta.strips_quantity ?? meta.stripsQuantity)]);
}

export type QuickCostEntry = {
  item_id: string; invoice_id: string; quick_cost_identity?: string; source: string;
  match_status?: string; can_edit_purchase_price?: boolean; cost_hidden?: boolean;
  invoice_number?: string; dispensing_date?: string; brand?: string; active_ingredient?: string;
  item_name?: string; strength?: string; invoice_quantity_unit?: string; quantity?: string | number;
  invoice_dosage_form?: string | null; invoice_package_quantity?: string | number | null; invoice_strips_quantity?: string | number | null;
  invoice_unit_issue?: "missing" | "unknown" | "conflict" | null;
  unit?: string; unit_purchase_price?: number | null; purchase_cost_mode?: SupplierCostMode;
  invoice_value?: number | null; revenue_hidden?: boolean;
};

export function quickCostComplete(item: QuickCostEntry) {
  return item.match_status === "matched";
}

export function supplierQuickCostGroups(invoices: { items: QuickCostEntry[] }[]) {
  const groups = new Map<string, { key: string; label: string; entries: QuickCostEntry[] }>();
  const seen = new Set<string>();
  for (const invoice of invoices) for (const item of invoice.items) {
    if (item.source !== "phif" || seen.has(item.item_id)) continue;
    seen.add(item.item_id);
    const key = item.quick_cost_identity || JSON.stringify(["unresolved", item.item_id]);
    const group: { key: string; label: string; entries: QuickCostEntry[] } = groups.get(key) ?? { key, label: item.active_ingredient || item.brand || item.item_name || "صنف غير محدد", entries: [] };
    group.entries.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({ ...group,
    complete: group.entries.every(quickCostComplete),
    entries: group.entries.sort((a, b) => Number(quickCostComplete(a)) - Number(quickCostComplete(b)) || String(a.dispensing_date).localeCompare(String(b.dispensing_date)) || a.item_id.localeCompare(b.item_id)),
  })).sort((a, b) => Number(a.complete) - Number(b.complete) || a.label.localeCompare(b.label, "ar"));
}

export function quickCostInput(item: QuickCostEntry, mode: SupplierCostMode, raw: string, confirmed: boolean): SupplierCostInput {
  if (item.source !== "phif" || !item.can_edit_purchase_price || item.cost_hidden) throw new Error("لا تملك صلاحية تعديل تكلفة هذا البند");
  if (item.unit_purchase_price !== null && item.unit_purchase_price !== undefined && !confirmed) throw new Error("أكد استبدال التكلفة المحفوظة لهذا البند فقط");
  const value = Number(raw);
  if (!raw.trim() || !Number.isFinite(value) || value < 0) throw new Error("أدخل تكلفة صحيحة لا تقل عن صفر");
  const unit = normalizeSupplierUnit(item.invoice_quantity_unit);
  if (mode === "unit_price" && (!unit || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0)) throw new Error("سعر الوحدة يحتاج كمية ووحدة صرف موثقتين");
  return { itemId: item.item_id, purchaseCostMode: mode, purchaseCostValue: value, ...(mode === "unit_price" ? { purchaseCostUnit: unit } : {}) };
}

export async function saveQuickCostEntry(lock: { busy: boolean }, input: SupplierCostInput,
  save: (input: SupplierCostInput) => Promise<unknown>, advance: () => void) {
  if (lock.busy) return false;
  lock.busy = true;
  try {
    await save(input);
    advance();
    return true;
  } finally {
    lock.busy = false;
  }
}
