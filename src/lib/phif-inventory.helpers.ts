import { stockQuantityBreakdown } from "@/lib/phif-stock.helpers";
import { stockExpiryState, stockExpiryValue } from "@/lib/phif-stock-details.helpers";

export type InventoryMode = "available" | "low" | "out" | "all";
export type LowStockUnit = "boxes" | "units";

function numeric(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

export function inventoryAvailability(item: any, threshold = 1, thresholdUnit: LowStockUnit = "boxes") {
  const quantity = numeric(item.stock_quantity);
  if (quantity === null) return { status: "unknown", label: "الكمية غير مسجلة", tone: "muted" } as const;
  if (quantity <= 0) return { status: "out", label: "نافد", tone: "danger" } as const;
  const strips = numeric(item.strips_quantity);
  const comparable = thresholdUnit === "units" ? quantity : strips && strips > 0 ? quantity / strips : null;
  if (comparable !== null && Number.isFinite(threshold) && threshold >= 0 && comparable <= threshold) {
    return { status: "low", label: "منخفض", tone: "warning" } as const;
  }
  return { status: "available", label: "متوفر", tone: "success" } as const;
}

export function inventoryExpiry(item: any) {
  if (["invalid", "conflict"].includes(item.expiry_status)) {
    return { status: "missing", label: item.expiry_status === "conflict" ? "الصلاحية متعارضة · للمراجعة" : "صيغة الصلاحية تحتاج مراجعة", tone: "warning" } as const;
  }
  return stockExpiryState(stockExpiryValue(item));
}

export function filterInventoryItems<T extends Record<string, any>>(items: readonly T[], filters: {
  query: string; mode: InventoryMode; lowThreshold: number; lowUnit: LowStockUnit;
  expiry: string; supplier: string; form: string;
}) {
  const term = filters.query.trim().toLowerCase();
  return items.filter((item) => {
    if (term && ![item.brand_name, item.active_ingredient, item.supplier_name, item.strength, item.dosage_unit, item.batch_number]
      .some((value) => String(value ?? "").toLowerCase().includes(term))) return false;
    const status = inventoryAvailability(item, filters.lowThreshold, filters.lowUnit).status;
    const quantity = numeric(item.stock_quantity);
    if (filters.mode === "available" && (quantity === null || quantity <= 0)) return false;
    if (filters.mode === "low" && status !== "low") return false;
    if (filters.mode === "out" && status !== "out") return false;
    if (filters.expiry !== "all" && inventoryExpiry(item).status !== filters.expiry) return false;
    if (filters.supplier !== "all" && String(item.supplier_name ?? "") !== filters.supplier) return false;
    return filters.form === "all" || String(item.dosage_unit ?? item.source_quantity_unit ?? "") === filters.form;
  });
}

export function inventoryExportRows(items: readonly Record<string, any>[]) {
  return items.map((item, index) => ({
    "ر.م": index + 1,
    "الاسم الكامل": [item.brand_name, item.strength, item.dosage_unit].filter(Boolean).join(" "),
    "الاسم العلمي": item.active_ingredient ?? "",
    "الكمية": stockQuantityBreakdown(item.stock_quantity, item.strips_quantity, item.source_quantity_unit ?? "وحدة").label,
    "إجمالي الأشرطة/الوحدات": item.stock_quantity ?? "",
    "الوحدة": item.source_quantity_unit ?? item.dosage_unit ?? "",
    "الصلاحية": stockExpiryValue(item) ?? "",
    "دقة الصلاحية": item.expiry_date ? "يوم" : item.expiry_month ? "شهر/سنة" : "غير مسجلة",
    "حالة الصلاحية": inventoryExpiry(item).label,
    "المورد": item.supplier_name ?? "",
    "الشكل الدوائي": item.dosage_unit ?? "",
    "رقم التشغيلة": item.batch_number ?? "",
  }));
}
