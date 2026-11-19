import { expect, it, vi } from "vitest";
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({ inputValidator: (validate: any) => ({
  handler: (fn: any) => async (input: any) => fn({ data: validate(input.data) }),
}) }) }));
const permission = vi.hoisted(() => vi.fn());
const execute = vi.hoisted(() => vi.fn());
vi.mock("../user-management.functions", () => ({ requireTiryaqPermission: permission }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: "scoped-db" }));
vi.mock("../definition-audit-bulk.server", () => ({ executeBulkSupplierUnit: execute }));
import { previewReadySupplierUnits, confirmReadySupplierUnit } from "../definition-audit-bulk.functions";

it("requires explicit confirmation and a valid reviewed unit; rejects pharmacy or box-size overrides", async () => {
  for (const data of [{ token: "ticket" }, { token: "ticket", confirm: false },
    { token: "ticket", confirm: true }, { token: "ticket", confirm: true, unit: "guess" },
    { token: "ticket", confirm: true, unit: "tablet", pharmacyId: "other" },
    { token: "ticket", confirm: true, unit: "tablet", size: 1 }])
    await expect(confirmReadySupplierUnit({ data } as any)).rejects.toThrow();
  await expect(previewReadySupplierUnits({ data: { pharmacyId: "other" } } as any)).rejects.toThrow();
  expect(permission).not.toHaveBeenCalled();
});

it("forwards the reviewed unit only after server permission verification", async () => {
  const context = { pharmacy_id: "own" };
  permission.mockResolvedValue(context); execute.mockResolvedValue({ status: "confirmed" });
  await confirmReadySupplierUnit({ data: { token: "signed", confirm: true, unit: "inhaler" } });
  expect(permission).toHaveBeenCalledWith("users_manage");
  expect(execute).toHaveBeenCalledWith("scoped-db", context, "signed", "inhaler");
});
