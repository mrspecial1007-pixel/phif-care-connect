import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash } from "node:crypto";
import { hasPermission } from "@/lib/user-permissions";
import { enrichStockIngredients, parseStockExpiry, extractStockBatchExpiry, stockBatchSource } from "@/lib/phif-stock-details.helpers";


const listInput = z.object({
  query: z.string().trim().max(120).optional().default(""),
  limit: z.number().int().min(1).max(5000).optional().default(100),
});

function pickString(obj: any, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj?.[key];
    if (value === undefined || value === null || typeof value === "object") continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function pickDecimalString(obj: any, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj?.[key];
    if (value === undefined || value === null || value === "") continue;
    const text = String(value).trim().replace(/,/g, "");
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return text;
  }
  return null;
}

function nested(obj: any, keys: string[]) {
  for (const key of keys) {
    if (obj?.[key] && typeof obj[key] === "object") return obj[key];
  }
  return {};
}

export type NormalizedPhifStockRow = {
  source_pharmacy_id: string | null;
  source_stock_id: string;
  generic_ingredient_id: string | null;
  supplier_id: string | null;
  brand_product_id: string | null;
  batch_id: string | null;
  brand_name: string | null;
  active_ingredient: string | null;
  strength: string | null;
  dosage_unit: string | null;
  package_quantity: string | null;
  strips_quantity: string | null;
  stock_quantity: string | null;
  source_quantity_unit: string | null;
  batch_number: string | null;
  expiry_date: string | null;
  cost_price: string | null;
  sale_price: string | null;
  factory_price: string | null;
  supplier_name: string | null;
  company_name: string | null;
  content_hash: string;
  raw_metadata: Record<string, unknown>;
};

export function normalizePhifStockRows(payload: unknown): NormalizedPhifStockRow[] {
  const rows = Array.isArray((payload as any)?.data)
    ? (payload as any).data
    : Array.isArray(payload)
      ? payload
      : [];

  return rows.map((row: any) => {
    const brand = nested(row, ["supplier_brand_name", "supplierBrandName", "brand"]);
    const batch = stockBatchSource(row).batch;
    const supplier = nested(row, ["medical_supplier", "medical_suppliers", "supplier"]);
    const generic = nested(row, ["genaric_name", "generic_name", "generic"]);
    const brandGeneric = nested(brand, ["genaric_name", "generic_name", "generic"]);
    const expiry = extractStockBatchExpiry(row);
    const source_stock_id = pickString(row, ["id", "stock_id", "stockId"]);
    if (!source_stock_id) return null;

    const normalized = {
      source_pharmacy_id: pickString(row, ["pharmacies_id", "pharmacy_id", "source_pharmacy_id"]),
      source_stock_id,
      generic_ingredient_id: pickString(row, ["genaric_names_id", "generic_names_id", "generic_id"]),
      supplier_id: pickString(row, ["medical_suppliers_id", "supplier_id"]),
      brand_product_id: pickString(row, ["supplier_brand_name_id", "brand_id", "product_id"]),
      batch_id: pickString(row, ["patsh_numbers_id", "patch_numbers_id", "batch_id"]),
      brand_name: pickString(brand, ["brand_name", "brandName", "name"]),
      active_ingredient: pickString(generic, ["name", "generic_name", "genaric_name", "active_ingredient"])
        ?? pickString(brandGeneric, ["name", "generic_name", "genaric_name", "active_ingredient"])
        ?? pickString(row, ["active_ingredient", "generic_name", "genaric_name", "generic"])
        ?? pickString(brand, ["active_ingredient", "generic_name", "genaric_name", "generic"]),
      strength: pickString(brand, ["doses", "strength", "dose"]),
      dosage_unit: pickString(brand, ["unit", "dosage_unit", "form"]),
      package_quantity: pickDecimalString(brand, ["package_quantity", "packageQuantity"]),
      strips_quantity: pickDecimalString(brand, ["strips_quantity", "stripsQuantity"]),
      stock_quantity: pickDecimalString(row, ["quantity", "qty"]),
      source_quantity_unit: pickString(brand, ["unit", "quantity_unit"]),
      batch_number: pickString(batch, ["batch_number", "patsh_number", "patch_number", "number", "name"])
        ?? pickString(row, ["batch_number", "patsh_number", "patch_number"]),
      expiry_date: expiry.date,
      cost_price: pickDecimalString(brand, ["cost_price", "costPrice"]),
      sale_price: pickDecimalString(brand, ["sale_price", "salePrice"]),
      factory_price: pickDecimalString(brand, ["factory_price", "factoryPrice"]),
      supplier_name: pickString(supplier, ["name", "supplier_name", "company_name"]),
      company_name: pickString(supplier, ["company_name", "companyName", "name"]),
      raw_metadata: {
        source_keys: Object.keys(row ?? {}),
        batch_source_keys: Object.keys(batch),
        ...(expiry.month ? { expiry_month: expiry.month } : {}),
        ...(["invalid", "conflict"].includes(expiry.status) ? { expiry_status: expiry.status } : {}),
      },
    };
    const hashSource = {
      ...normalized,
      raw_metadata: undefined,
      ...(expiry.month ? { expiry_month: expiry.month } : {}),
      ...(["invalid", "conflict"].includes(expiry.status) ? { expiry_status: expiry.status } : {}),
    };
    return {
      ...normalized,
      content_hash: createHash("sha256").update(JSON.stringify(hashSource)).digest("hex"),
    };
  }).filter(Boolean) as NormalizedPhifStockRow[];
}

function canSeeCost(session: any) {
  return !session.session?.data?.user_id && !session.session?.data?.user_role
    ? true
    : hasPermission(session.session?.data?.user_role, session.session?.data?.user_permissions, "actual_cost_read");
}

async function requireInventory() {
  const { requireTiryaqPermission } = await import("@/lib/user-management.functions");
  const session = await requireTiryaqPermission("inventory_read");
  return session;
}

export const getPhifStockSummary = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const session = await requireInventory();
  const { pharmacy_id } = session;

  const { readPhifStockOverview } = await import("./phif-stock-overview.server");
  const { phifTrackerAccess } = await import("./phif-tracker-user.server");
  return {
    ...await readPhifStockOverview(supabaseAdmin, pharmacy_id),
    manual_sync_access: await phifTrackerAccess(supabaseAdmin, session),
    can_view_cost: canSeeCost(session),
  };
});

export const listPhifStockItems = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => listInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const session = await requireInventory();
    const { pharmacy_id } = session;
    const includeCost = canSeeCost(session);

    let query = supabaseAdmin
      .from("phif_stock_items")
      .select("id, brand_name, active_ingredient, strength, dosage_unit, package_quantity, strips_quantity, stock_quantity, source_quantity_unit, batch_number, expiry_date, raw_metadata, sale_price, supplier_name, company_name, source_stock_id, generic_ingredient_id, supplier_id, brand_product_id, batch_id, synced_at, cost_price")
      .eq("pharmacy_id", pharmacy_id)
      .eq("is_current", true)
      .order("brand_name", { ascending: true })
      .limit(data.limit);

    if (data.query) {
      const term = data.query.replace(/[%_]/g, "");
      query = query.or(`brand_name.ilike.%${term}%,active_ingredient.ilike.%${term}%,supplier_name.ilike.%${term}%,strength.ilike.%${term}%`);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    const references = (rows ?? []).some((row: any) => !row.active_ingredient?.trim())
      ? await loadStockIngredientReferences(supabaseAdmin, pharmacy_id) : [];
    const enriched = enrichStockIngredients(rows ?? [], [...(rows ?? []), ...references]);
    return enriched.map((item: any) => {
      const { raw_metadata, ...row } = item;
      const month = parseStockExpiry(raw_metadata?.expiry_month).month;
      if (month) row.expiry_month = month;
      if (["invalid", "conflict"].includes(raw_metadata?.expiry_status)) row.expiry_status = raw_metadata.expiry_status;
      if (includeCost) return row;
      const { cost_price, ...safe } = row;
      return safe;
    });
  });

export async function loadStockIngredientReferences(db: any, pharmacyId: string) {
  const references: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("phif_invoice_items")
      .select("id, brand, active_ingredient, strength, metadata, phif_invoices!inner(pharmacy_id)")
      .eq("phif_invoices.pharmacy_id", pharmacyId)
      .eq("source_classification", "actual-supplier")
      .order("id").range(from, from + 999);
    if (error) throw new Error("تعذر قراءة مرجع المواد العلمية للمخزون");
    for (const item of data ?? []) {
      const meta = item.metadata ?? {};
      references.push({
        brand_name: item.brand, active_ingredient: item.active_ingredient, strength: item.strength,
        dosage_unit: meta.dosage_form ?? meta.form ?? meta.unit ?? meta.dosage_unit,
        brand_product_id: meta.supplier_brand_name_id ?? meta.brand_product_id ?? meta.brand_id,
        generic_ingredient_id: meta.generic_ingredient_id ?? meta.generic_id ?? meta.genaric_names_id,
      });
    }
    if ((data?.length ?? 0) < 1000) break;
  }
  return references;
}

export const syncPhifStock = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const session = await requireInventory();
  const { pharmacy_id } = session;
  const { runManualStockSync } = await import("./phif-stock-sync.server");
  const { requirePhifTrackerUser } = await import("./phif-tracker-user.server");
  const { requestPhifBridgeRead } = await import("./phif-bridge-request.server");
  const actorId = await requirePhifTrackerUser(supabaseAdmin, session);
  return runManualStockSync(supabaseAdmin, pharmacy_id, actorId,
    id => requestPhifBridgeRead("stock", pharmacy_id, id), normalizePhifStockRows);
});
