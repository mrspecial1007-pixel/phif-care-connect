import { scientificReportIdentity, reportForm, reportStrength } from "./report-medication-evidence.helpers";
import { supplierInvoiceForm } from "./phif-supplier-quick-cost.helpers";
import { normalizeActiveIngredient } from "./medication-normalize";

export type ActualStockLink = {
  id: string;
  version: number;
  phif_invoice_item_id: string;
  source_signature: string;
  is_active: boolean;
  source_identity?: string | null;
  source?: any;
  target: {
    id?: string; source_stock_id?: string | null; brand_product_id?: string | null;
    brand_name?: string | null; active_ingredient?: string | null; strength?: string | null;
    dosage_unit?: string | null; package_quantity?: string | number | null; strips_quantity?: string | number | null;
  };
};

export function actualItemSignature(item: any) {
  // Bind a decision to the exact imported item, not to its generic ingredient.
  return JSON.stringify([item.brand ?? null, item.strength ?? null, item.source_classification ?? null, item.metadata ?? {}]);
}

const text = (value: unknown) => String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g," ");
function sourceSignatureMatches(item: any, signature: string) {
  const current = actualItemSignature(item);
  if (current === signature) return true;
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])) : v;
  try { return JSON.stringify(canonical(JSON.parse(current))) === JSON.stringify(canonical(JSON.parse(signature))); }
  catch { return false; }
}
const sourceBase = (item: any) => JSON.stringify([normalizeActiveIngredient(String(item.active_ingredient || "")),reportStrength(item.strength),text(item.brand)]);
export function actualLinkIdentity(item: any, target: ActualStockLink["target"]) {
  if (item?.source_classification !== "actual-supplier" || !item.brand) return null;
  const identity = scientificReportIdentity(item, reportForm(supplierInvoiceForm(item)) || reportForm(target.dosage_unit));
  if (!identity.form || identity.key.includes('"unresolved"')) return null;
  // Keep the dispensed brand: a manually confirmed alias is not a generic-wide substitution.
  return JSON.stringify([JSON.parse(identity.key),text(item.brand)]);
}
export function actualLinkTargetKey(target: ActualStockLink["target"]) {
  const count = (v: unknown) => v == null ? null : Number.isFinite(Number(v)) ? Number(v) : text(v);
  return JSON.stringify([target.brand_product_id || target.source_stock_id || target.id, text(target.brand_name),
    scientificReportIdentity({ active_ingredient: "target", strength: target.strength },target.dosage_unit).key,
    count(target.package_quantity), count(target.strips_quantity)]);
}
export function actualLinkGroups(links: ActualStockLink[]) {
  const groups = new Map<string, ActualStockLink[]>();
  for (const link of links) {
    const validSource = link.source && sourceSignatureMatches(link.source,link.source_signature);
    const key = validSource ? actualLinkIdentity(link.source,link.target) : null;
    const identity = key || `item:${link.phif_invoice_item_id}`;
    groups.set(identity,[...(groups.get(identity) || []),link]);
  }
  return [...groups.entries()].map(([identity,members]) => {
    const active = members.filter(l=>l.is_active).sort((a,b)=>a.id.localeCompare(b.id));
    const conflict = new Set(active.map(l=>actualLinkTargetKey(l.target))).size > 1;
    const stale = active.some(l=>!l.target.brand_name || !l.target.strength || !reportForm(l.target.dosage_unit)
      || (l.source && !sourceSignatureMatches(l.source,l.source_signature)));
    return { identity, members, link: active[0] || members[0], status: conflict || stale ? "review" : active.length ? "linked" : "unlinked", conflict };
  });
}
function compatibleSourceIds(a: any, b: any) {
  return ["supplier_brand_name_id", "brand_product_id", "generic_names_id", "generic_ingredient_id", "package_quantity", "strips_quantity"]
    .every(key => { const x=a.metadata?.[key], y=b.metadata?.[key]; return x == null || y == null || text(x) === text(y); });
}
export function resolveActualStockLink(item: any, links: ActualStockLink[]) {
  const direct = links.filter(l => l.phif_invoice_item_id === item.id);
  if (direct.length && direct.every(l=>!l.is_active) && direct.some(l=>!l.source_identity)) return { link: null, conflict: false };
  const candidates = links.filter(link => link.is_active && (
    link.phif_invoice_item_id === item.id ? sourceSignatureMatches(item,link.source_signature)
      : link.source && sourceSignatureMatches(link.source,link.source_signature) && compatibleSourceIds(item,link.source)
        && actualLinkIdentity(item,link.target) != null && actualLinkIdentity(item,link.target) === actualLinkIdentity(link.source,link.target)));
  const conflict = new Set(candidates.map(l=>actualLinkTargetKey(l.target))).size > 1;
  return { link: conflict ? null : candidates.sort((a,b)=>a.id.localeCompare(b.id))[0] || null, conflict };
}

export function applyActualStockLinks<T extends { id?: string | null; source_classification?: string | null }>(items: T[], links: ActualStockLink[]) {
  // Per-read indexes: old decisions outside the selected invoice range remain usable without an N*M audit scan.
  const byItem = new Map<string,ActualStockLink[]>(), bySource = new Map<string,ActualStockLink[]>();
  for (const link of links) {
    byItem.set(link.phif_invoice_item_id,[...(byItem.get(link.phif_invoice_item_id) || []),link]);
    if (link.source && sourceSignatureMatches(link.source,link.source_signature)) {
      const key = sourceBase(link.source);
      bySource.set(key,[...(bySource.get(key) || []),link]);
    }
  }
  return items.map(item => {
    const { manual_stock_link: previous, manual_link_conflict: ignoredConflict, ...original } = item as T & { manual_stock_link?: ActualStockLink; manual_link_conflict?: boolean };
    if (item.source_classification !== "actual-supplier") return original;
    const candidates = [...new Map([...(byItem.get(item.id || "") || []),...(bySource.get(sourceBase(original)) || [])].map(l=>[l.id,l])).values()];
    const result = resolveActualStockLink(original,candidates);
    return result.link ? { ...original, manual_stock_link: result.link }
      : result.conflict ? { ...original, manual_link_conflict: true } : original;
  });
}

export function actualReferenceItem<T extends { brand?: string | null; strength?: string | null; active_ingredient?: string | null }>(item: T): T {
  const link = (item as any).manual_stock_link as ActualStockLink | undefined;
  if (!link?.is_active) return item;
  return { ...item, brand: link.target.brand_name, strength: link.target.strength,
    active_ingredient: link.target.active_ingredient || item.active_ingredient };
}
