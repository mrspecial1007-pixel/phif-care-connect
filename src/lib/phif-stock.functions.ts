import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash } from "node:crypto";
import { hasPermission } from "@/lib/user-permissions";

const DEFAULT_BRIDGE_BASE_URL = "http://127.0.0.1:5174";
const DEFAULT_BRIDGE_PUBLIC_BASE_URL = "https://phif-bridge.altiryaq-pharma.com";

const listInput = z.object({
  query: z.string().trim().max(120).optional().default(""),
  limit: z.number().int().min(1).max(200).optional().default(100),
});

function pickString(obj: any, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj?.[key];
    if (value === undefined || value === null) continue;
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

function normalizeDate(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(text);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
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
    const batch = nested(row, ["patsh_numbers", "patch_numbers", "batch", "batch_number"]);
    const supplier = nested(row, ["medical_supplier", "medical_suppliers", "supplier"]);
    const generic = nested(row, ["genaric_name", "generic_name", "generic"]);
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
      active_ingredient: pickString(generic, ["name", "generic_name", "genaric_name", "active_ingredient"]),
      strength: pickString(brand, ["doses", "strength", "dose"]),
      dosage_unit: pickString(brand, ["unit", "dosage_unit", "form"]),
      package_quantity: pickDecimalString(brand, ["package_quantity", "packageQuantity"]),
      strips_quantity: pickDecimalString(brand, ["strips_quantity", "stripsQuantity"]),
      stock_quantity: pickDecimalString(row, ["quantity", "qty"]),
      source_quantity_unit: pickString(brand, ["unit", "quantity_unit"]),
      batch_number: pickString(batch, ["batch_number", "patsh_number", "patch_number", "number", "name"]),
      expiry_date: normalizeDate(pickString(batch, ["expiry_date", "expire_date", "expiration_date", "expireDate"])),
      cost_price: pickDecimalString(brand, ["cost_price", "costPrice"]),
      sale_price: pickDecimalString(brand, ["sale_price", "salePrice"]),
      factory_price: pickDecimalString(brand, ["factory_price", "factoryPrice"]),
      supplier_name: pickString(supplier, ["name", "supplier_name", "company_name"]),
      company_name: pickString(supplier, ["company_name", "companyName", "name"]),
      raw_metadata: {
        source_keys: Object.keys(row ?? {}),
      },
    };
    const hashSource = {
      ...normalized,
      raw_metadata: undefined,
    };
    return {
      ...normalized,
      content_hash: createHash("sha256").update(JSON.stringify(hashSource)).digest("hex"),
    };
  }).filter(Boolean) as NormalizedPhifStockRow[];
}

function bridgeBaseUrl() {
  const base = process.env.PHIF_BRIDGE_BASE_URL?.trim() || DEFAULT_BRIDGE_BASE_URL;
  return base.replace(/\/+$/, "");
}

function bridgePublicBaseUrl() {
  const base = process.env.PHIF_BRIDGE_PUBLIC_BASE_URL?.trim() || DEFAULT_BRIDGE_PUBLIC_BASE_URL;
  return base.replace(/\/+$/, "");
}

function bridgeSecret() {
  return process.env.PHIF_BRIDGE_SECRET?.trim() || null;
}

function publicForwardHeaders() {
  const publicBase = new URL(bridgePublicBaseUrl());
  return {
    "X-Forwarded-Proto": publicBase.protocol.replace(":", ""),
    "X-Forwarded-Host": publicBase.host,
  };
}

async function bridgeJson(path: string, pharmacyId: string) {
  const secret = bridgeSecret();
  if (!secret) throw new Error("PHIF bridge secret is not configured");
  const res = await fetch(`${bridgeBaseUrl()}${path}`, {
    headers: {
      "X-PHIF-Bridge-Secret": secret,
      "X-Pharmacy-Id": pharmacyId,
      ...publicForwardHeaders(),
    },
  });
  const text = await res.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { ok: false, error: "PHIF bridge returned a non-JSON response" };
  }
  if (!res.ok) throw new Error(payload?.error ?? `PHIF bridge request failed: ${res.status}`);
  return payload;
}

async function currentBridgeSession(db: any, pharmacyId: string) {
  const { data } = await db
    .from("phif_bridge_sessions")
    .select("bridge_session_id, expires_at")
    .eq("pharmacy_id", pharmacyId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

function canSeeCost(session: any) {
  return !session.session?.data?.user_id && !session.session?.data?.user_role
    ? true
    : hasPermission(session.session?.data?.user_role, session.session?.data?.user_permissions, "stock_cost_read");
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

  const { data: run } = await supabaseAdmin
    .from("phif_stock_sync_runs")
    .select("id, started_at, finished_at, status, total_records, imported_records, error_count, error_message")
    .eq("pharmacy_id", pharmacy_id)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { count, error } = await supabaseAdmin
    .from("phif_stock_items")
    .select("id", { count: "exact", head: true })
    .eq("pharmacy_id", pharmacy_id)
    .eq("is_current", true);
  if (error) throw new Error(error.message);

  return {
    last_run: run ?? null,
    current_count: count ?? 0,
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
      .select("id, brand_name, active_ingredient, strength, dosage_unit, package_quantity, strips_quantity, stock_quantity, source_quantity_unit, batch_number, expiry_date, sale_price, supplier_name, source_stock_id, generic_ingredient_id, supplier_id, brand_product_id, batch_id, synced_at, cost_price")
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
    return (rows ?? []).map((row: any) => {
      if (includeCost) return row;
      const { cost_price, ...safe } = row;
      return safe;
    });
  });

export const syncPhifStock = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const session = await requireInventory();
  const { pharmacy_id } = session;
  const bridge = await currentBridgeSession(supabaseAdmin, pharmacy_id);
  if (!bridge?.bridge_session_id) throw new Error("PHIF bridge session is not available");

  const { data: run, error: runError } = await supabaseAdmin
    .from("phif_stock_sync_runs")
    .insert({ pharmacy_id, status: "pending" })
    .select("id")
    .single();
  if (runError) throw new Error(runError.message);

  try {
    const payload = await bridgeJson(`/api/bridge-sessions/${encodeURIComponent(bridge.bridge_session_id)}/stock`, pharmacy_id);
    const rows = normalizePhifStockRows({ data: payload.rows ?? [] });

    const imported = await upsertStockSnapshots(supabaseAdmin, pharmacy_id, run.id, rows);
    await supabaseAdmin
      .from("phif_stock_sync_runs")
      .update({
        status: "completed",
        finished_at: new Date().toISOString(),
        total_records: payload.raw_count ?? rows.length,
        imported_records: imported,
        error_count: 0,
      })
      .eq("id", run.id);
    return {
      ok: true,
      total_records: payload.raw_count ?? rows.length,
      imported_records: imported,
      parsed_records: rows.length,
    };
  } catch (error: any) {
    await supabaseAdmin
      .from("phif_stock_sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_count: 1,
        error_message: error?.message ?? "PHIF stock sync failed",
      })
      .eq("id", run.id);
    throw error;
  }
});

async function upsertStockSnapshots(db: any, pharmacyId: string, runId: string, rows: NormalizedPhifStockRow[]) {
  const { data, error } = await db.rpc("replace_phif_stock_snapshots", {
    p_pharmacy_id: pharmacyId,
    p_sync_run_id: runId,
    p_items: rows,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}
