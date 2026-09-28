import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  calculateActualGrossMargin,
  invoiceItemValue,
  stockSnapshotCandidatesForInvoice,
} from "@/lib/phif-stock.helpers";

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
  return invoiceItemValue(item);
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

export const getActualProfitReport = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => rangeSchema.pick({ dateFrom: true, dateTo: true }).parse(d))
  .handler(async ({ data }) => {
    const { requireTiryaqPermission } = await import("@/lib/user-management.functions");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pharmacy_id } = await requireTiryaqPermission("stock_cost_read");

    const { data: invoices, error } = await supabaseAdmin
      .from("phif_invoices")
      .select("id, invoice_number, invoice_key, dispensing_date")
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
        .select("id, phif_invoice_id, phif_item_id, active_ingredient, strength, brand, quantity, supplier, source_classification, phif_financial_fields, metadata")
        .in("phif_invoice_id", batch)
        .neq("source_classification", "phif-supplier");
      if (itemError) throw new Error(itemError.message);
      items.push(...(rows ?? []));
    }

    const { data: stockRows, error: stockError } = await supabaseAdmin
      .from("phif_stock_items")
      .select("id, source_stock_id, generic_ingredient_id, supplier_id, brand_product_id, brand_name, active_ingredient, strength, dosage_unit, package_quantity, strips_quantity, cost_price, sale_price, synced_at")
      .eq("pharmacy_id", pharmacy_id)
      .not("cost_price", "is", null)
      .order("synced_at", { ascending: false });
    if (stockError) throw new Error(stockError.message);

    const invoiceById = new Map((invoices ?? []).map((invoice: any) => [invoice.id, invoice]));
    const details = items.map((item) => {
      const invoice: any = invoiceById.get(item.phif_invoice_id);
      const candidates = stockSnapshotCandidatesForInvoice(item, stockRows ?? [], invoice?.dispensing_date);
      const margin = calculateActualGrossMargin(item, candidates);
      return {
        invoice_id: item.phif_invoice_id,
        invoice_number: invoice?.invoice_number ?? invoice?.invoice_key ?? null,
        dispensing_date: invoice?.dispensing_date ?? null,
        item_name: [item.brand, item.active_ingredient, item.strength].filter(Boolean).join(" · "),
        quantity: item.quantity,
        invoice_value: margin.invoiceValue,
        purchase_cost: margin.purchaseCost,
        gross_margin: margin.grossMargin,
        match_status: margin.status,
        match_reason: margin.reason,
        matched_stock_id: margin.stock?.source_stock_id ?? null,
      };
    });

    const matched = details.filter((row) => row.match_status === "matched");
    const totalValue = details.reduce((sum, row) => sum + row.invoice_value, 0);
    const knownCost = matched.reduce((sum, row) => sum + (row.purchase_cost ?? 0), 0);
    const knownMargin = matched.reduce((sum, row) => sum + (row.gross_margin ?? 0), 0);

    return {
      total_actual_items: details.length,
      total_actual_value: totalValue,
      matched_item_count: matched.length,
      review_item_count: details.length - matched.length,
      known_purchase_cost: knownCost,
      known_gross_margin: knownMargin,
      coverage_ratio: details.length ? matched.length / details.length : 0,
      details,
    };
  });
