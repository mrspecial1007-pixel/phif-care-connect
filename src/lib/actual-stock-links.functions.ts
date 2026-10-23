import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isTreasuryManager } from "./treasury-financials.helpers";
import { actualItemSignature, actualLinkGroups, actualLinkIdentity, actualLinkTargetKey, resolveActualStockLink } from "./actual-stock-links.helpers";
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
    const { readActualStockLinks, missingActualLinksMigration } = await import("./actual-stock-links.server");
    const probe = await db.from("phif_actual_stock_links").select("source_identity").eq("pharmacy_id",pharmacyId).limit(1);
    if (missingActualLinksMigration(probe.error)) return { available: false, scopeAvailable: false, history: [], groups: [], stocks: [], item: null, operations: [], existing: null, conflict: false, itemException: false, members: [] };
    if (probe.error && !["42703","PGRST204"].includes(probe.error.code)) throw new Error("تعذر قراءة الروابط اليدوية");
    const scopeAvailable = !probe.error;
    const history = await readActualStockLinks(db,pharmacyId,scopeAvailable);
    const groups = actualLinkGroups(history);
    const item = data.itemId ? await scopedItem(db, pharmacyId, data.itemId) : null;
    const stocks: any[] = [];
    if (item) for (let from = 0; ; ) {
      const { data: rows, error } = await db.from("phif_stock_items")
        .select("id, source_stock_id, brand_product_id, brand_name, active_ingredient, strength, dosage_unit, package_quantity, strips_quantity")
        .eq("pharmacy_id", pharmacyId).eq("is_current", true).order("id").range(from, from + 499);
      if (error) throw new Error("تعذر تحميل أصناف المخزون");
      if (!rows?.length) break;
      stocks.push(...rows); from += rows.length;
    }
    const resolution = item ? resolveActualStockLink(item,history) : null;
    const related = item ? groups.filter(g=>g.members.some(l=>l.is_active && actualLinkIdentity(item,l.target)===g.identity)) : [];
    const link = resolution?.link || (related.length === 1 ? related[0].link : null)
      || (item ? history.find(link => link.phif_invoice_item_id === item.id) : null);
    const group = groups.find(g=>g.members.some(l=>l.id===link?.id));
    let operations: any[] = [];
    if (link) {
      const result = await db.from("user_operation_log").select("action, created_at, metadata")
        .eq("pharmacy_id", pharmacyId).eq("entity", "phif_actual_stock_link").in("entity_id", group?.members.map(l=>l.id) || [link.id])
        .order("created_at", { ascending: false }).limit(50);
      if (result.error) throw new Error("تعذر قراءة سجل الربط");
      operations = (result.data ?? []).map((op: any) => ({ action: op.action, at: op.created_at, actor: op.metadata?.actor }));
    }
    return { available: true, scopeAvailable, history, groups, existing: link, conflict: resolution?.conflict || false,
      itemException: Boolean(item && history.some(l=>l.phif_invoice_item_id===item.id && !l.is_active && !l.source_identity)),
      members: group?.members.map(l=>({id:l.id,version:l.version})) || [], stocks, item: item ? { id: item.id, brand: item.brand, strength: item.strength,
      unit: item.metadata?.dosage_form ?? item.metadata?.dosage_unit ?? item.metadata?.quantity_unit ?? item.metadata?.unit ?? item.phif_financial_fields?.unit ?? null,
      package_quantity: item.metadata?.package_quantity ?? null, strips_quantity: item.metadata?.strips_quantity ?? null,
      quantity: item.quantity, invoice: item.invoice } : null, operations };
  });

export const saveActualStockLink = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ itemId: z.string().uuid(), targetId: z.string().uuid().nullable(),
    expectedVersion: z.number().int().min(0), expectedMembers: z.array(z.object({id:z.string().uuid(),version:z.number().int().min(1)})).max(500),
    confirmed: z.literal(true), revoke: z.boolean().default(false) }).parse(input))
  .handler(async ({ data }) => {
    const { db, pharmacyId, actorId, actor } = await actualManager();
    const item = await scopedItem(db, pharmacyId, data.itemId);
    if (!actorId) throw new Error("إدارة الربط الدائم تتطلب تسجيل الدخول بحساب مدير");
    const { readActualStockLinks } = await import("./actual-stock-links.server");
    const history = await readActualStockLinks(db,pharmacyId);
    const resolved = resolveActualStockLink(item,history);
    const direct = history.find(l=>l.phif_invoice_item_id===item.id);
    const related = actualLinkGroups(history).filter(g=>g.members.some(l=>l.is_active && actualLinkIdentity(item,l.target)===g.identity));
    const previous = resolved.link || (related.length === 1 ? related[0].link : null) || direct;
    let stock: any = null;
    if (!data.revoke) {
      if (!data.targetId) throw new Error("اختر صنف المخزون أولًا");
      const { data: selectedStock, error } = await db.from("phif_stock_items").select("*")
        .eq("pharmacy_id", pharmacyId).eq("id", data.targetId).eq("is_current", true).maybeSingle();
      stock = selectedStock;
      if (error || !stock) throw new Error("صنف المخزون غير متاح في الصيدلية الحالية");
      validateActualStockLink(item, stock);
    }
    const identity = actualLinkIdentity(item,stock || previous?.target || {});
    if (!identity) throw new Error("الهوية العلمية والتركيز والشكل والاسم التجاري تحتاج مراجعة قبل اعتماد رابط دائم");
    const group = actualLinkGroups(history).find(g=>g.identity===identity);
    const members = group?.members || [];
    const existing = group?.link;
    const fingerprint = (values: {id:string;version:number}[]) => JSON.stringify(values.map(l=>[l.id,l.version]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
    if ((existing?.version || 0)!==data.expectedVersion || fingerprint(members)!==fingerprint(data.expectedMembers))
      throw new Error("تغيرت الروابط منذ فتح النافذة؛ أعد تحميلها قبل الحفظ");
    if (existing && actualLinkIdentity(item,existing.target)!==identity) throw new Error("تغيير الشكل الدوائي يتطلب مراجعة الهوية أولًا");
    if (!data.revoke && existing?.is_active && !group?.conflict && !(direct && !direct.is_active && !direct.source_identity)
      && actualLinkTargetKey(existing.target)===actualLinkTargetKey(stock))
      return {saved:true,reused:true};
    const { error } = await db.rpc("set_phif_actual_identity_link", {
      p_pharmacy_id: pharmacyId, p_item_id: existing?.phif_invoice_item_id || item.id, p_target_id: data.targetId,
      p_signature: existing?.source_signature || actualItemSignature(item), p_identity: identity,
      p_expected_members: members.map(l=>({id:l.id,version:l.version})),
      p_user_id: actorId, p_actor: actor, p_revoke: data.revoke,
    });
    if (error) throw new Error("لم يُحفظ التغيير. تأكد من تطبيق migration وأعد تحميل الربط قبل المحاولة مجددًا.");
    return { saved: true };
  });
