import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const rangeSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.enum(["all", "actual", "phif"]).default("all"),
});

function moneyValue(fields: Record<string, unknown> | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = fields?.[key];
    if (value === undefined || value === null || value === "") continue;
    const numeric = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function itemAmount(item: any) {
  return moneyValue(item.phif_financial_fields, [
    "total_amount",
    "totalAmount",
    "total",
    "itemTotal",
    "phifValue",
    "insurance_amount",
    "insuranceAmount",
    "outside_insurance_amount",
    "outsideInsuranceAmount",
  ]);
}

export const getManagementReport = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => rangeSchema.parse(d))
  .handler(async ({ data }) => {
    const { requireTiryaqPermission } = await import("@/lib/user-management.functions");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pharmacy_id } = await requireTiryaqPermission("reports_read");

    const { data: invoices, error } = await supabaseAdmin
      .from("phif_invoices")
      .select("id, invoice_number, invoice_key, beneficiary_name, insurance_card_number, dispensing_date, patient_id")
      .eq("pharmacy_id", pharmacy_id)
      .gte("dispensing_date", data.dateFrom)
      .lte("dispensing_date", data.dateTo)
      .order("dispensing_date", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = (invoices ?? []).map((invoice: any) => invoice.id);
    const items: any[] = [];
    for (let index = 0; index < ids.length; index += 500) {
      const batch = ids.slice(index, index + 500);
      if (batch.length === 0) continue;
      const { data: rows, error: itemError } = await supabaseAdmin
        .from("phif_invoice_items")
        .select("phif_invoice_id, source_classification, quantity, phif_financial_fields")
        .in("phif_invoice_id", batch);
      if (itemError) throw new Error(itemError.message);
      items.push(...(rows ?? []));
    }

    const invoiceById = new Map((invoices ?? []).map((invoice: any) => [invoice.id, invoice]));
    const filteredItems = items.filter((item) => {
      if (data.source === "all") return true;
      if (data.source === "phif") return item.source_classification === "phif-supplier";
      return item.source_classification !== "phif-supplier";
    });
    const invoiceIdsWithItems = new Set(filteredItems.map((item) => item.phif_invoice_id));
    const uniquePatients = new Set<string>();
    for (const invoice of invoices ?? []) {
      if (!invoiceIdsWithItems.has(invoice.id) && data.source !== "all") continue;
      uniquePatients.add(invoice.patient_id ?? invoice.insurance_card_number ?? invoice.beneficiary_name ?? invoice.id);
    }

    const actualValue = filteredItems
      .filter((item) => item.source_classification !== "phif-supplier")
      .reduce((sum, item) => sum + itemAmount(item), 0);
    const phifValue = filteredItems
      .filter((item) => item.source_classification === "phif-supplier")
      .reduce((sum, item) => sum + itemAmount(item), 0);

    const details = [...invoiceIdsWithItems].map((id) => {
      const invoice = invoiceById.get(id);
      const invoiceItems = filteredItems.filter((item) => item.phif_invoice_id === id);
      return {
        id,
        invoice_number: invoice?.invoice_number ?? null,
        invoice_key: invoice?.invoice_key ?? null,
        beneficiary_name: invoice?.beneficiary_name ?? null,
        insurance_card_number: invoice?.insurance_card_number ?? null,
        dispensing_date: invoice?.dispensing_date ?? null,
        item_count: invoiceItems.length,
        actual_value: invoiceItems.filter((item) => item.source_classification !== "phif-supplier").reduce((sum, item) => sum + itemAmount(item), 0),
        phif_value: invoiceItems.filter((item) => item.source_classification === "phif-supplier").reduce((sum, item) => sum + itemAmount(item), 0),
      };
    });

    return {
      invoice_count: invoiceIdsWithItems.size,
      unique_patient_count: uniquePatients.size,
      item_count: filteredItems.length,
      actual_value: actualValue,
      phif_value: phifValue,
      total_dispensed_value: actualValue + phifValue,
      employee_breakdown_available: false,
      details,
    };
  });
