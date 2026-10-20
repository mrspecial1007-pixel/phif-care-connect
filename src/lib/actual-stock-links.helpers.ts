export type ActualStockLink = {
  id: string;
  version: number;
  phif_invoice_item_id: string;
  source_signature: string;
  is_active: boolean;
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

export function applyActualStockLinks<T extends { id?: string | null; source_classification?: string | null }>(items: T[], links: ActualStockLink[]) {
  const byItem = new Map(links.filter(link => link.is_active).map(link => [link.phif_invoice_item_id, link]));
  return items.map(item => {
    const { manual_stock_link: previous, ...original } = item as T & { manual_stock_link?: ActualStockLink };
    const link = item.id ? byItem.get(item.id) : null;
    return item.source_classification === "actual-supplier" && link?.source_signature === actualItemSignature(original)
      ? { ...original, manual_stock_link: link } : original;
  });
}

export function actualReferenceItem<T extends { brand?: string | null; strength?: string | null; active_ingredient?: string | null }>(item: T): T {
  const link = (item as any).manual_stock_link as ActualStockLink | undefined;
  if (!link?.is_active) return item;
  return { ...item, brand: link.target.brand_name, strength: link.target.strength,
    active_ingredient: link.target.active_ingredient || item.active_ingredient };
}
