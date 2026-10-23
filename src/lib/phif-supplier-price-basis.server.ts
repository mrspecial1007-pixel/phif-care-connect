import {
  canManageSupplierBasis,
  supplierBasisFields,
  supplierHistoricalCompatible,
  supplierPriceVersion,
  validateSupplierBasis,
  type SupplierPriceBasis,
} from "./phif-supplier-price-basis.helpers";
import { supplierInvoiceForm, supplierInvoiceUnit } from "./phif-supplier-quick-cost.helpers";
import {
  supplierQuantityEvidence,
  resolveReportIdentities,
} from "./report-medication-evidence.helpers";

export async function supplierPriceContext() {
  const { requireTiryaqPermission } = await import("./user-management.functions");
  const context = await requireTiryaqPermission("phif_purchase_price_write");
  const user = context.session.data;
  if (!canManageSupplierBasis(user))
    throw new Error("لا تملك صلاحية عرض وتعديل تكاليف PHIF Supplier");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return {
    db: supabaseAdmin as any,
    pharmacyId: context.pharmacy_id,
    userId: user.user_id ?? null,
  };
}

export async function readSupplierPriceItem(
  context: Awaited<ReturnType<typeof supplierPriceContext>>,
  id: string,
) {
  const { data, error } = await context.db
    .from("phif_invoice_items")
    .select(
      "id,phif_invoice_id,brand,active_ingredient,strength,quantity,metadata,source_classification,phif_financial_fields,phif_invoices!inner(pharmacy_id,invoice_number,dispensing_date)",
    )
    .eq("id", id)
    .eq("phif_invoices.pharmacy_id", context.pharmacyId)
    .eq("source_classification", "phif-supplier")
    .maybeSingle();
  if (error) throw new Error("تعذر قراءة بند PHIF Supplier");
  if (!data) throw new Error("بند الفاتورة غير متاح في الصيدلية الحالية");
  if (supplierInvoiceForm(data)) return data;
  const scoped = context as typeof context & {
    reportForms?: Promise<ReturnType<typeof resolveReportIdentities>>;
  };
  scoped.reportForms ??= (async () => {
    const { loadItemAnalyticsDataset } = await import("./management.functions");
    const dataset = await loadItemAnalyticsDataset();
    if (dataset.session.pharmacy_id !== context.pharmacyId)
      throw new Error("الصيدلية لا تطابق جلسة الحفظ");
    return resolveReportIdentities(
      dataset.items,
      dataset.rows,
      dataset.stocks,
      dataset.referenceForms,
    );
  })();
  const form = (await scoped.reportForms).get(data.id)?.form;
  return form ? { ...data, report_form: form } : data;
}

export async function writeSupplierBasis(
  context: Awaited<ReturnType<typeof supplierPriceContext>>,
  item: any,
  basis: SupplierPriceBasis,
  expectedVersion: string,
) {
  if (supplierPriceVersion(item) !== expectedVersion)
    throw new Error("تغيّر البند منذ المعاينة؛ أعد فتحه قبل الحفظ");
  const fields = supplierBasisFields(item, basis, {
    id: context.userId,
    at: new Date().toISOString(),
  });
  let query = context.db
    .from("phif_invoice_items")
    .update({ phif_financial_fields: fields })
    .eq("id", item.id)
    .eq("phif_invoice_id", item.phif_invoice_id)
    .eq("quantity", item.quantity)
    .eq("source_classification", "phif-supplier");
  for (const key of ["brand", "active_ingredient", "strength"])
    query = item[key] == null ? query.is(key, null) : query.eq(key, item[key]);
  query =
    item.metadata == null
      ? query.is("metadata", null)
      : query.eq("metadata", JSON.stringify(item.metadata));
  query =
    item.phif_financial_fields == null
      ? query.is("phif_financial_fields", null)
      : query.eq("phif_financial_fields", JSON.stringify(item.phif_financial_fields));
  const { data, error } = await query.select("id").maybeSingle();
  if (error || !data)
    throw new Error("لم تُحفظ التكلفة؛ قد يكون البند عُدّل من جلسة أخرى. أعد المعاينة");
  return { id: item.id, cost: fields.internal_purchase_cost_value };
}

export async function previewSupplierBasis(
  context: Awaited<ReturnType<typeof supplierPriceContext>>,
  anchor: any,
  basis: SupplierPriceBasis,
  historical: boolean,
) {
  validateSupplierBasis(anchor, basis);
  const candidates: any[] = [];
  if (historical) {
    for (let offset = 0; ; ) {
      const { data, error } = await context.db
        .from("phif_invoice_items")
        .select(
          "id,phif_invoice_id,brand,active_ingredient,strength,quantity,metadata,source_classification,phif_financial_fields,phif_invoices!inner(pharmacy_id,invoice_number,dispensing_date)",
        )
        .eq("source_classification", "phif-supplier")
        .eq("phif_invoices.pharmacy_id", context.pharmacyId)
        .order("id")
        .range(offset, offset + 499);
      if (error) throw new Error("تعذر معاينة فواتير PHIF Supplier السابقة");
      if (!data?.length) break;
      candidates.push(
        ...data.filter(
          (item: any) => item.id !== anchor.id && supplierHistoricalCompatible(anchor, item),
        ),
      );
      offset += data.length;
    }
  }
  return [anchor, ...candidates].map((item) => ({
    id: item.id,
    version: supplierPriceVersion(item),
    invoiceNumber: item.phif_invoices.invoice_number,
    date: item.phif_invoices.dispensing_date,
    quantity: item.quantity,
    unit: supplierQuantityEvidence(item).unit,
    form: supplierInvoiceForm(item),
    cost: validateSupplierBasis(item, basis),
    hasCost:
      item.phif_financial_fields?.internal_purchase_cost_value != null ||
      item.phif_financial_fields?.internal_purchase_price != null,
  }));
}
