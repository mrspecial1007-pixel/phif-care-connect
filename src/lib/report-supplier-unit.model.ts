import { z } from "zod";
import { ACTUAL_UNITS } from "./actual-units.helpers";

const unit = z.enum(Object.keys(ACTUAL_UNITS) as [keyof typeof ACTUAL_UNITS, ...(keyof typeof ACTUAL_UNITS)[]]);
export const supplierUnitInput = z.object({
  identity: z.string().min(5).max(1500), unit: unit.nullable(),
  exceptions: z.array(z.object({ invoiceId: z.string().uuid(), unit: z.string().max(20) })).max(200),
  version: z.number().int().min(1),
}).strict();
export const supplierSettingReceipt = z.object({
  id: z.string().uuid(), item_identity: z.string(), units_per_box: z.number().int().positive(),
  base_unit: unit, version: z.number().int().positive(), supplier_quantity_unit: unit.nullable().optional(),
  supplier_unit_exceptions: z.record(z.string()).optional(),
});
