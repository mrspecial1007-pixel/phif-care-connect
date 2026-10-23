import { actualUnit, type ActualUnit } from "./actual-units.helpers";
import { supplierQuantityEvidence } from "./report-medication-evidence.helpers";

export type SupplierUnitSetting = {
  supplier_quantity_unit?: ActualUnit | null;
  supplier_unit_exceptions?: Record<string, ActualUnit | "unknown">;
};

/** A report box size never establishes an invoice's quantity unit. */
export function reportSupplierUnit(item: any, setting?: SupplierUnitSetting | null) {
  const original = supplierQuantityEvidence(item);
  const recorded = actualUnit(original.unit);
  const exception = setting?.supplier_unit_exceptions?.[item.phif_invoice_id];
  if (exception === "unknown")
    return { unit: null, issue: "invoice_exception", provenance: "exception" };
  if (original.issue && original.issue !== "missing")
    return { unit: null, issue: original.issue, provenance: "source" };
  const chosen = actualUnit(exception);
  if (recorded && chosen && recorded !== chosen)
    return { unit: null, issue: "conflict", provenance: "exception" };
  if (recorded) return { unit: recorded, issue: null, provenance: "source" };
  if (chosen) return { unit: chosen, issue: null, provenance: "exception" };
  const confirmed = actualUnit(setting?.supplier_quantity_unit);
  return {
    unit: confirmed,
    issue: confirmed ? null : "missing",
    provenance: confirmed ? "item_confirmation" : "source",
  };
}

export function supplierBoxPreview(
  quantity: number,
  unit: ActualUnit | null,
  base: ActualUnit,
  size: number,
  packageQuantity?: number | null,
  strips?: number | null,
) {
  if (!Number.isFinite(quantity) || quantity < 0 || !Number.isSafeInteger(size) || size < 1)
    return null;
  if (
    ["tablet", "capsule"].includes(base) &&
    Number.isSafeInteger(packageQuantity) &&
    Number(packageQuantity) > 0
  ) {
    if (unit === "box") return (quantity * Number(packageQuantity)) / size;
    if (
      unit === "strip" &&
      Number.isSafeInteger(strips) &&
      Number(strips) > 0 &&
      Number(packageQuantity) % Number(strips) === 0
    )
      return (quantity * Number(packageQuantity)) / Number(strips) / size;
  }
  return unit === base ? quantity / size : null;
}

/** Latest eligible PHIF sale, never an Actual fallback or a current inventory price. */
export function latestReportSupplierSale(items: any[]) {
  const eligible = items.filter(
    (i) =>
      i.source_classification === "phif-supplier" &&
      Number(i.quantity) > 0 &&
      Number.isFinite(Number(i.phif_financial_fields?.total_amount)) &&
      Number(i.phif_financial_fields?.total_amount) >= 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(i.invoice?.dispensing_date || ""),
  );
  const compare = (a: any, b: any) => {
    for (const value of [
      [a.invoice.dispensing_date, b.invoice.dispensing_date],
      [a.invoice.dispensing_time, b.invoice.dispensing_time],
      [a.invoice.invoice_number, b.invoice.invoice_number],
      [a.phif_invoice_id, b.phif_invoice_id],
      [a.id, b.id],
    ]) {
      const result = String(value[1] || "").localeCompare(String(value[0] || ""), "en", {
        numeric: true,
      });
      if (result) return result;
    }
    return 0;
  };
  const latest = eligible.sort(compare)[0];
  if (!latest) return null;
  const price = Number(latest.phif_financial_fields.total_amount) / Number(latest.quantity);
  return {
    price,
    date: latest.invoice.dispensing_date,
    invoiceNumber: latest.invoice.invoice_number,
    itemId: latest.id,
    conflict: false,
    basis: "invoice_value_divided_by_verified_units",
  };
}
