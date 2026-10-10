import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { hasPermission } from "@/lib/user-permissions";

type Src = "Actual" | "PHIF Supplier";

function norm(v: unknown) {
  return String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}
function itemKey(ingredient: unknown, strength: unknown) {
  return `${norm(ingredient)}|${norm(strength).replace(/\s+/g, "")}`;
}
function formOf(meta: any) {
  return String(meta?.dosage_form ?? meta?.form ?? meta?.unit ?? meta?.dosage_unit ?? "").trim();
}
function toId(key: string) {
  return encodeURIComponent(key);
}

async function pagedAll(build: (from: number, to: number) => any) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const listReferenceInput = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).optional().default({});

function can(session: any, permission: any) {
  return hasPermission(session?.session?.data?.user_role, session?.session?.data?.user_permissions, permission);
}

async function loadAll(admin: any, pharmacyId: string, range?: { dateFrom?: string; dateTo?: string }) {
  const invoices = await pagedAll((a, b) => {
    let query = admin.from("phif_invoices").select("id, beneficiary_name, insurance_card_number, patient_id, dispensing_date")
      .eq("pharmacy_id", pharmacyId).order("dispensing_date", { ascending: false }).range(a, b);
    if (range?.dateFrom) query = query.gte("dispensing_date", range.dateFrom);
    if (range?.dateTo) query = query.lte("dispensing_date", range.dateTo);
    return query;
  });
  const items: any[] = [];
  const ids = invoices.map((i) => i.id);
  for (let i = 0; i < ids.length; i += 300) {
    const batch = ids.slice(i, i + 300);
    items.push(...(await pagedAll((a, b) =>
      admin.from("phif_invoice_items")
        .select("id, phif_invoice_id, active_ingredient, strength, brand, quantity, supplier, source_classification, phif_financial_fields, metadata")
        .in("phif_invoice_id", batch).range(a, b))));
  }
  const stock = await pagedAll((a, b) =>
    admin.from("phif_stock_items")
      .select("id, brand_name, active_ingredient, strength, dosage_unit, stock_quantity, source_quantity_unit, cost_price, sale_price, supplier_name, synced_at")
      .eq("pharmacy_id", pharmacyId).eq("is_current", true).range(a, b));
  return { invoices, items, stock };
}

function buildIndex(data: Awaited<ReturnType<typeof loadAll>>) {
  const invById = new Map(data.invoices.map((i) => [i.id, i]));
  const map = new Map<string, any>();
  const get = (ingredient: string, strength: string, form: string) => {
    const key = itemKey(ingredient, strength);
    let row = map.get(key);
    if (!row) {
      row = { key, id: toId(key), ingredient, strength, form, sources: new Set<Src>(), patients: new Set<string>(), items: [], stock: [] };
      map.set(key, row);
    }
    if (!row.form && form) row.form = form;
    return row;
  };
  for (const it of data.items) {
    if (!it.active_ingredient) continue;
    const row = get(String(it.active_ingredient).trim(), String(it.strength ?? "").trim(), formOf(it.metadata));
    row.sources.add(it.source_classification === "phif-supplier" ? "PHIF Supplier" : "Actual");
    const inv: any = invById.get(it.phif_invoice_id);
    if (inv) row.patients.add(inv.patient_id ?? inv.insurance_card_number ?? inv.beneficiary_name ?? inv.id);
    row.items.push({ ...it, invoice: inv });
  }
  for (const s of data.stock) {
    if (!s.active_ingredient) continue;
    const row = get(String(s.active_ingredient).trim(), String(s.strength ?? "").trim(), String(s.dosage_unit ?? "").trim());
    row.sources.add("Actual");
    row.stock.push(s);
  }
  return map;
}

async function session() {
  const { requireTiryaqPermission } = await import("@/lib/user-management.functions");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const s = await requireTiryaqPermission("reports_read");
  return { admin: supabaseAdmin, pharmacyId: s.pharmacy_id, session: s };
}

export const listReferenceItems = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => listReferenceInput.parse(d))
  .handler(async ({ data }) => {
  const { admin, pharmacyId } = await session();
  const index = buildIndex(await loadAll(admin, pharmacyId, data));
  return [...index.values()]
    .map((r) => ({ id: r.id as string, ingredient: r.ingredient as string, strength: r.strength as string, form: r.form as string, beneficiaries: r.patients.size as number, sources: [...r.sources] as Src[] }))
    .sort((a, b) => a.ingredient.localeCompare(b.ingredient, "en"));
});

export const getReferenceItem = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().min(1).max(500) }).parse(d))
  .handler(async ({ data }) => {
    const { admin, pharmacyId, session: currentSession } = await session();
    const canSeeActualCost = can(currentSession, "actual_cost_read");
    const canSeeActualRevenue = can(currentSession, "actual_revenue_read");
    const canSeePhifCost = can(currentSession, "phif_cost_read");
    const canSeeMovements = can(currentSession, "actual_movements_read") || can(currentSession, "phif_movements_read");
    const index = buildIndex(await loadAll(admin, pharmacyId));
    const row = [...index.values()].find((r) => r.id === data.id);
    if (!row) return null;
    const beneficiaries = new Map<string, { name: string; count: number }>();
    for (const it of row.items) {
      const inv = it.invoice;
      if (!inv) continue;
      const k = inv.patient_id ?? inv.insurance_card_number ?? inv.beneficiary_name ?? inv.id;
      const b = beneficiaries.get(k) ?? { name: inv.beneficiary_name ?? "مستفيد غير معروف", count: 0 };
      b.count += 1;
      beneficiaries.set(k, b);
    }
    const phifItems = row.items.filter((it: any) => it.source_classification === "phif-supplier");
    const priced = phifItems.find((it: any) => it.phif_financial_fields?.internal_purchase_price != null);
    const movements = row.items
      .filter((it: any) => it.invoice)
      .sort((a: any, b: any) => String(b.invoice.dispensing_date ?? "").localeCompare(String(a.invoice.dispensing_date ?? "")))
      .slice(0, 50)
      .map((it: any) => ({
        id: it.id as string,
        date: it.invoice.dispensing_date as string | null,
        quantity: it.quantity as number | null,
        brand: it.brand as string | null,
        beneficiary: it.invoice.beneficiary_name as string | null,
        source: (it.source_classification === "phif-supplier" ? "PHIF Supplier" : "Actual") as Src,
      }));
    return {
      id: row.id as string,
      ingredient: row.ingredient as string,
      strength: row.strength as string,
      form: row.form as string,
      sources: [...row.sources] as Src[],
      beneficiaryCount: row.patients.size as number,
      dispenseCount: row.items.length as number,
      canSeeCost: canSeeActualCost,
      beneficiaries: canSeeMovements ? [...beneficiaries.values()].sort((a, b) => b.count - a.count) : [],
      phif: {
        count: phifItems.length as number,
        price: canSeePhifCost && priced ? Number(priced.phif_financial_fields.internal_purchase_price) : null,
        unit: priced?.phif_financial_fields?.internal_purchase_unit ?? null,
      },
      actualProducts: row.stock.map((s: any) => ({
        id: s.id as string,
        brand: (s.brand_name ?? "—") as string,
        supplier: (s.supplier_name ?? "—") as string,
        cost: canSeeActualCost && s.cost_price != null ? Number(s.cost_price) : null,
        sale: canSeeActualRevenue && s.sale_price != null ? Number(s.sale_price) : null,
        stock: s.stock_quantity != null ? Number(s.stock_quantity) : null,
        unit: (s.source_quantity_unit ?? s.dosage_unit ?? "") as string,
        synced: s.synced_at as string | null,
      })),
      movements: canSeeMovements ? movements : [],
    };
  });
