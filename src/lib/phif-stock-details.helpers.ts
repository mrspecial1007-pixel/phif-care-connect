function text(value: unknown) {
  return typeof value === "string" ? value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim() : "";
}

export function parseStockExpiry(value: unknown): { date: string | null; month: string | null } {
  const raw = typeof value === "string" ? value.trim() : "";
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(raw);
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(raw);
  if (iso || dmy) {
    const [year, month, day] = iso ? iso.slice(1).map(Number) : [Number(dmy![3]), Number(dmy![2]), Number(dmy![1])];
    const date = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    return { date: Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null, month: null };
  }
  const ym = /^(\d{4})[-/](\d{1,2})$/.exec(raw);
  const my = /^(\d{1,2})[-/](\d{4})$/.exec(raw);
  if (ym || my) {
    const year = Number(ym ? ym[1] : my![2]);
    const month = Number(ym ? ym[2] : my![1]);
    if (year >= 1000 && month >= 1 && month <= 12) return { date: null, month: `${year}-${String(month).padStart(2, "0")}` };
  }
  return { date: null, month: null };
}

export function stockExpiryValue(item: { expiry_date?: string | null; expiry_month?: string | null }) {
  return item.expiry_date || item.expiry_month || null;
}

export function formatStockExpiry(value: unknown) {
  const { date, month } = parseStockExpiry(value);
  if (month) return `${month.slice(5)}/${month.slice(0, 4)}`;
  if (!date) return null;
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("ar-LY", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

export function stockExpiryState(value: unknown, now = new Date()) {
  const { date, month } = parseStockExpiry(value);
  if (!date && !month) return { status: "missing" as const, label: "الصلاحية غير مسجلة", tone: "muted" as const };
  // Month-only dates retain their precision; classification compares calendar months.
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (month) {
    if (month < currentMonth) return { status: "expired" as const, label: "منتهي الصلاحية", tone: "danger" as const };
    const months = (Number(month.slice(0, 4)) - now.getFullYear()) * 12 + Number(month.slice(5)) - now.getMonth() - 1;
    return months <= 3
      ? { status: "soon" as const, label: "قريب الانتهاء · الدقة شهر/سنة", tone: "warning" as const }
      : { status: "valid" as const, label: "صالح · الدقة شهر/سنة", tone: "success" as const };
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(`${date}T00:00:00`);
  const days = Math.ceil((end.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { status: "expired" as const, label: "منتهي الصلاحية", tone: "danger" as const };
  if (days <= 90) return { status: "soon" as const, label: `ينتهي خلال ${days} يوم`, tone: "warning" as const };
  return { status: "valid" as const, label: "صالح", tone: "success" as const };
}

const forms: Record<string, string> = {
  tablet: "tabs", tablets: "tabs", tab: "tabs", tabs: "tabs",
  capsule: "caps", capsules: "caps", cap: "caps", caps: "caps",
  injection: "inj", injections: "inj", inj: "inj", pen: "pen", pens: "pen",
};

function identityText(value: unknown) {
  return text(value).replace(/(\d)\s+(mg|mcg|ml|iu)\b/g, "$1$2")
    .replace(/[^\p{L}\p{N}./+%]+/gu, " ").trim();
}

function withoutDoseAndForm(value: unknown, strength: unknown, form: unknown) {
  let name = ` ${identityText(value)} `;
  const dose = identityText(strength);
  if (dose) name = name.replace(` ${dose} `, " ");
  const unit = text(form);
  const canonical = forms[unit] ?? unit;
  const words = name.trim().split(/\s+/);
  while (canonical && words.length && (forms[words[words.length - 1]] ?? words[words.length - 1]) === canonical) words.pop();
  return words.join(" ");
}

type IngredientIdentity = {
  brand_name?: string | null; strength?: string | null; dosage_unit?: string | null;
  active_ingredient?: string | null; brand_product_id?: string | null; generic_ingredient_id?: string | null;
};

function referenceKey(row: IngredientIdentity) {
  const brand = withoutDoseAndForm(row.brand_name, row.strength, row.dosage_unit);
  const strength = text(row.strength).replace(/\s+/g, "");
  const form = forms[text(row.dosage_unit)] ?? text(row.dosage_unit);
  return brand && strength && form ? `${brand}|${strength}|${form}` : null;
}

export function enrichStockIngredients<T extends IngredientIdentity>(stocks: T[], references: IngredientIdentity[]): T[] {
  const index = new Map<string, IngredientIdentity[]>();
  for (const row of references) {
    const key = referenceKey(row);
    if (!key || !text(row.active_ingredient)) continue;
    const entries = index.get(key) ?? [];
    entries.push(row);
    index.set(key, entries);
  }
  return stocks.map(row => {
    if (text(row.active_ingredient)) return row;
    const candidates = index.get(referenceKey(row) ?? "") ?? [];
    // Conflicting identifiers invalidate the fallback rather than selecting a convenient candidate.
    if (candidates.some(candidate => ["brand_product_id", "generic_ingredient_id"].some(key => {
      const field = key as "brand_product_id" | "generic_ingredient_id";
      return row[field] && candidate[field] && String(row[field]) !== String(candidate[field]);
    }))) return row;
    const names = new Set(candidates.map(candidate => withoutDoseAndForm(candidate.active_ingredient, row.strength, row.dosage_unit)));
    return names.size === 1 && !names.has("") ? { ...row, active_ingredient: candidates[0].active_ingredient } : row;
  });
}

export function stockScientificSubtitle(item: IngredientIdentity) {
  const ingredient = text(item.active_ingredient);
  if (!ingredient || !text(item.brand_name)) return null;
  const same = withoutDoseAndForm(item.brand_name, item.strength, item.dosage_unit)
    === withoutDoseAndForm(item.active_ingredient, item.strength, item.dosage_unit);
  return same ? null : item.active_ingredient;
}
