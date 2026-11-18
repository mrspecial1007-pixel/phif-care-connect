import { expect, it, vi } from "vitest";
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({ inputValidator: (validate: any) => ({
  handler: (fn: any) => async (input: any) => fn({ data: validate(input.data) }),
}) }) }));
const permission = vi.hoisted(() => vi.fn());
vi.mock("../user-management.functions", () => ({ requireTiryaqPermission: permission }));
import { previewReadySupplierUnits, confirmReadySupplierUnit } from "../definition-audit-bulk.functions";

it("requires explicit confirmation and rejects client-selected pharmacy or mutable unit values before reaching the server", async () => {
  for (const data of [{ token: "ticket" }, { token: "ticket", confirm: false },
    { token: "ticket", confirm: true, pharmacyId: "other" }, { token: "ticket", confirm: true, unit: "tablet" }])
    await expect(confirmReadySupplierUnit({ data } as any)).rejects.toThrow();
  await expect(previewReadySupplierUnits({ data: { pharmacyId: "other" } } as any)).rejects.toThrow();
  expect(permission).not.toHaveBeenCalled();
});
