import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isTreasuryManager } from "./treasury-financials.helpers";
import { actualItemSignature } from "./actual-stock-links.helpers";
import { validateActualStockLink } from "./phif-stock.helpers";

export async function actualManager() {
  const { requirePharmacySession } = await import("./pharmacy-session.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const context = await requirePharmacySession();
  if (!isTreasuryManager(context)) throw new Error("إدارة روابط المخزون متاحة للمدير فقط");
  const db: any = supabaseAdmin;
  const actorId = context.session.data.user_role === "admin" ? context.session.data.user_id ?? null : null;
  if (context.session.data.user_role === "admin") {
    if (!actorId) throw new Error("أعد تسجيل دخول المدير");
    const { data, error } = await db.from("pharmacy_users").select("id").eq("id", actorId)
      .eq("pharmacy_id", context.pharmacy_id).eq("role", "admin").eq("is_active", true).maybeSingle();
    if (error || !data) throw new Error("صلاحية المدير غير متاحة");
  }
  return { db, pharmacyId: context.pharmacy_id, actorId,
    actor: actorId ? context.session.data.user_name || "مدير الترياق" : "مدير الترياق (جلسة قديمة)" };
}

async function scopedItem(db: any, pharmacyId: string, itemId: string) {
  const { data, error } = await db.from("phif_invoice_items")
    .select("id, brand, active_ingredient, strength, quantity, source_classification, metadata, phif_financial_fields, invoice:phif_invoices!inner(invoice_number, dispensing_date, pharmacy_id)")
    .eq("id", itemId).eq("invoice.pharmacy_id", pharmacyId).eq("source_classification", "actual-supplier").maybeSingle();
  if (error || !data) throw new Error("بند Actual غير متاح في الصيدلية الحالية");
  return data;
}

export const getActualStockLinkEditor = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ itemId: z.string().uuid().optional() }).parse(input))
  .handler(async ({ data }) => {
    const { db, pharmacyId } = await actualManager();
    const { ACTUAL_LINK_SELECT, missingActualLinksMigration } = await import("./actual-stock-links.server");
    const history: any[] = [];
    for (let from = 0; ; ) {
      const { data: rows, error } = await db.from("phif_actual_stock_links").select(`${ACTUAL_LINK_SELECT}, source:phif_invoice_items!phif_invoice_item_id(brand, strength)`)
        .eq("pharmacy_id", pharmacyId).order("id").range(from, from + 499);
      if (error) {
        if (missingActualLinksMigration(error)) return { available: false, history: [], stocks: [], item: null, operations: [] };
        throw new Error("تعذر قراءة الروابط اليدوية");
      }
      if (!rows?.length) break;
      history.push(...rows); from += rows.length;
    }
    const item = data.itemId ? await scopedItem(db, pharmacyId, data.itemId) : null;
    const stocks: any[] = [];
    if (item) for (let from = 0; ; ) {
      const { data: rows, error } = await db.from("phif_stock_items")
        .select("id, source_stock_id, brand_product_id, brand_name, strength, dosage_unit, package_quantity, strips_quantity")
        .eq("pharmacy_id", pharmacyId).eq("is_current", true).order("id").range(from, from + 499);
      if (error) throw new Error("تعذر تحميل أصناف المخزون");
      if (!rows?.length) break;
      stocks.push(...rows); from += rows.length;
    }
    const link = item ? history.find(link => link.phif_invoice_item_id === item.id) : null;
    let operations: any[] = [];
    if (link) {
      const result = await db.from("user_operation_log").select("action, created_at, metadata")
        .eq("pharmacy_id", pharmacyId).eq("entity", "phif_actual_stock_link").eq("entity_id", link.id)
        .order("created_at", { ascending: false }).limit(50);
      if (result.error) throw new Error("تعذر قراءة سجل الربط");
      operations = (result.data ?? []).map((op: any) => ({ action: op.action, at: op.created_at, actor: op.metadata?.actor }));
    }
    return { available: true, history, stocks, item: item ? { id: item.id, brand: item.brand, strength: item.strength,
      unit: item.metadata?.dosage_form ?? item.metadata?.dosage_unit ?? item.metadata?.quantity_unit ?? item.metadata?.unit ?? item.phif_financial_fields?.unit ?? null,
      package_quantity: item.metadata?.package_quantity ?? null, strips_quantity: item.metadata?.strips_quantity ?? null,
      quantity: item.quantity, invoice: item.invoice } : null, operations };
  });

export const saveActualStockLink = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ itemId: z.string().uuid(), targetId: z.string().uuid().nullable(),
    expectedVersion: z.number().int().min(0), confirmed: z.literal(true), revoke: z.boolean().default(false) }).parse(input))
  .handler(async ({ data }) => {
    const { db, pharmacyId, actorId, actor } = await actualManager();
    const item = await scopedItem(db, pharmacyId, data.itemId);
    if (!data.revoke) {
      if (!data.targetId) throw new Error("اختر صنف المخزون أولًا");
      const { data: stock, error } = await db.from("phif_stock_items").select("*")
        .eq("pharmacy_id", pharmacyId).eq("id", data.targetId).eq("is_current", true).maybeSingle();
      if (error || !stock) throw new Error("صنف المخزون غير متاح في الصيدلية الحالية");
      validateActualStockLink(item, stock);
    }
    const { error } = await db.rpc("set_phif_actual_stock_link", {
      p_pharmacy_id: pharmacyId, p_item_id: item.id, p_target_id: data.targetId,
      p_signature: actualItemSignature(item), p_expected_version: data.expectedVersion,
      p_user_id: actorId, p_actor: actor, p_revoke: data.revoke,
    });
    if (error) throw new Error("لم يُحفظ التغيير. تأكد من تطبيق migration وأعد تحميل الربط قبل المحاولة مجددًا.");
    return { saved: true };
  });
