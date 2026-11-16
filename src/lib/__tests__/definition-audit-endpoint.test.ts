import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAuthorizedDefinitionAudit } from "../definition-audit.request";
const state = { context: {} as any, run: vi.fn(), authorize: vi.fn() };
const invoke = () => runAuthorizedDefinitionAudit(async () => state.context, {}, state.authorize, state.run);
beforeEach(() => {
  state.context = { pharmacy_id: "own", session: { data: { user_id: "u", user_role: "admin" } } };
  state.authorize.mockReset().mockResolvedValue(undefined); state.run.mockReset().mockResolvedValue({ pharmacyId: "own" });
});
describe("definition audit endpoint", () => {
  it("rejects client-selected pharmacies before any read", async () => {
    state.context = { pharmacy_id: "other", session: { data: { user_id: "u", user_role: "admin" } } };
    state.authorize.mockRejectedValueOnce(new Error("foreign pharmacy"));
    await expect(invoke()).rejects.toThrow("foreign pharmacy");
    expect(state.run).not.toHaveBeenCalled();
  });
  it("authorizes before reading and again before returning results", async () => {
    await invoke();
    expect(state.authorize).toHaveBeenCalledTimes(2); expect(state.run).toHaveBeenCalledWith({}, "own");
  });
  it("does not return results after the manager is disabled mid-scan", async () => {
    state.authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("disabled"));
    await expect(invoke()).rejects.toThrow("disabled");
  });
  it("rejects unauthorized users without starting a scan", async () => {
    state.authorize.mockRejectedValue(new Error("forbidden"));
    await expect(invoke()).rejects.toThrow("forbidden"); expect(state.run).not.toHaveBeenCalled();
  });
  it("prevents simultaneous duplicate scans in this worker and releases the guard", async () => {
    let release!: (v: any) => void;
    state.run.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = invoke();
    await vi.waitFor(() => expect(state.run).toHaveBeenCalledTimes(1));
    await expect(invoke()).rejects.toThrow("قيد التشغيل");
    release({}); await first;
    await expect(invoke()).resolves.toBeDefined();
  });
});
