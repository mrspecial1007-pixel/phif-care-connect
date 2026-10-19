export type SupplierCostMode = "total_dispensed_cost" | "unit_price";
export type SupplierCostInput = { itemId: string; purchaseCostMode: SupplierCostMode; purchaseCostValue: number; purchaseCostUnit?: string };

const normalized = (value: unknown) => String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");

/** Navigation identity only. Costs are always saved separately by invoice-item id. */
export function supplierQuickCostIdentity(item: any) {
  const meta = item.metadata ?? {};
  const name = normalized(item.active_ingredient || item.brand);
  const strength = normalized(item.strength).replace(/\s+/g, "");
  const unit = normalized(meta.unit ?? meta.dosage_unit ?? meta.quantity_unit);
  const form = normalized(meta.dosage_form ?? meta.dosageForm ?? meta.form ?? meta.pharmaceuticalForm ?? unit);
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
  const unit = item.invoice_quantity_unit?.trim();
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
