import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supplierHistoricalCompatible } from "./phif-supplier-price-basis.helpers";

export const supplierBasisSchema = z.object({ amount: z.number().min(0).max(1_000_000), count: z.number().int().min(1).max(10000),
  unit: z.string().min(1).max(40), confirmQuantityUnit: z.boolean().optional() });
const previewSchema = z.object({ itemId: z.string().uuid(), basis: supplierBasisSchema, historical: z.boolean().default(false) });

export const previewPhifSupplierPrice = createServerFn({ method: "POST" })
  .inputValidator((value: unknown) => previewSchema.parse(value))
  .handler(async ({ data }) => {
    const { supplierPriceContext, readSupplierPriceItem, previewSupplierBasis } = await import("./phif-supplier-price-basis.server");
    const context = await supplierPriceContext();
    return previewSupplierBasis(context, await readSupplierPriceItem(context, data.itemId), data.basis, data.historical);
  });

export const applyPhifSupplierPrice = createServerFn({ method: "POST" })
  .inputValidator((value: unknown) => previewSchema.extend({ targets: z.array(z.object({ id: z.string().uuid(), version: z.string().max(1_000_000) })).min(1).max(50) }).parse(value))
  .handler(async ({ data }) => {
    const { supplierPriceContext, readSupplierPriceItem, writeSupplierBasis } = await import("./phif-supplier-price-basis.server");
    const context = await supplierPriceContext();
    const anchor = await readSupplierPriceItem(context, data.itemId);
    if (new Set(data.targets.map(row => row.id)).size !== data.targets.length) throw new Error("بنود مكررة في الطلب");
    const results: { id: string; ok: boolean; error?: string }[] = [];
    // Each row is independently version-checked and audited. Report partial failures honestly.
    for (const target of data.targets) {
      try {
        const item = target.id === anchor.id ? anchor : await readSupplierPriceItem(context, target.id);
        if (target.id !== anchor.id && (!data.historical || !supplierHistoricalCompatible(anchor, item))) throw new Error("البند غير متوافق مع هوية الصنف ووحدته");
        await writeSupplierBasis(context, item, data.basis, target.version);
        results.push({ id: target.id, ok: true });
      } catch (error) {
        results.push({ id: target.id, ok: false, error: error instanceof Error ? error.message : "تعذر حفظ البند" });
      }
    }
    return { results };
  });
