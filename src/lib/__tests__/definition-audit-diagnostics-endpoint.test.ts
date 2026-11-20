import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ getRequest: vi.fn(), session: vi.fn(), authorize: vi.fn(), run: vi.fn(), db: {} }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({ inputValidator: (validate: (value: unknown) => unknown) => ({
  handler: (handle: (options: any) => Promise<any>) => async (options: any) => handle({ data: validate(options.data) }),
}) }) }));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: state.getRequest }));
vi.mock("../pharmacy-session.server", () => ({ requirePharmacySession: state.session }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: state.db }));
vi.mock("../definition-audit.server", () => ({ requireDefinitionAuditAdmin: state.authorize, runDefinitionAudit: state.run }));
import { runDefinitionAuditReport } from "../definition-audit.functions";

beforeEach(() => {
  vi.clearAllMocks();
  state.getRequest.mockReturnValue(new Request("https://synthetic.invalid/_serverFn/audit"));
  state.session.mockResolvedValue({ pharmacy_id: "own", session: { data: { user_id: "admin" } } });
  state.authorize.mockResolvedValue(undefined);
  state.run.mockResolvedValue({ coverage: "observed_stable" });
});

describe("diagnostics request signal wiring", () => {
  it("passes the server request signal with the authorized pharmacy, not client parameters", async () => {
    await runDefinitionAuditReport({ data: {} });
    expect(state.run).toHaveBeenCalledWith(state.db, "own", state.getRequest.mock.results[0].value.signal);
    expect(state.authorize).toHaveBeenCalledTimes(2);
  });
  it("does not run diagnostics for an unauthorized caller", async () => {
    state.authorize.mockRejectedValueOnce(new Error("forbidden"));
    await expect(runDefinitionAuditReport({ data: {} })).rejects.toThrow("forbidden");
    expect(state.run).not.toHaveBeenCalled();
  });
  it("does not accept client-controlled diagnostic activation or pharmacy selection", async () => {
    await expect(runDefinitionAuditReport({ data: { diagnostics: true, pharmacyId: "other" } } as any)).rejects.toThrow();
    expect(state.getRequest).not.toHaveBeenCalled(); expect(state.run).not.toHaveBeenCalled();
  });
});
