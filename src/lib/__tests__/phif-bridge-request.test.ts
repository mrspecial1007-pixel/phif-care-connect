import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { phifBridgeOrigin, requestPhifBridgeRead, PHIF_MANUAL_READ_TIMEOUT_MS } from "../phif-bridge-request.server";

beforeEach(() => { vi.stubEnv("PHIF_BRIDGE_SECRET", "secret-not-for-logs"); vi.stubEnv("PHIF_BRIDGE_BASE_URL", ""); vi.stubEnv("PHIF_BRIDGE_PUBLIC_BASE_URL", ""); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe("manual Bridge transport and safe diagnostics", () => {
  it("uses the public origin in production, honors explicit configuration and never falls back after failure", async () => {
    vi.stubEnv("NODE_ENV", "production"); expect(phifBridgeOrigin()).toBe("https://phif-bridge.altiryaq-pharma.com");
    vi.stubEnv("NODE_ENV", "test"); expect(phifBridgeOrigin()).toBe("http://127.0.0.1:5174");
    vi.stubEnv("PHIF_BRIDGE_PUBLIC_BASE_URL", "https://example.test/"); expect(phifBridgeOrigin()).toBe("https://example.test");
    vi.stubEnv("PHIF_BRIDGE_BASE_URL", "http://127.0.0.1:5174/"); expect(phifBridgeOrigin()).toBe("http://127.0.0.1:5174");
    const fetcher = vi.fn(async () => { throw Object.assign(new Error("cookies and private-session"), { cause: { code: "ECONNREFUSED" } }); });
    await expect(requestPhifBridgeRead("orders", "tiryaq", "private-session", fetcher)).rejects.toMatchObject({ code: "BRIDGE_NETWORK" });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/private-session|secret-not-for-logs|cookies/);
  });
  it("distinguishes access, missing-session, version, busy and upstream errors without guessing session expiry", async () => {
    for (const [status, payload, code] of [[401, {}, "BRIDGE_AUTHORIZATION"], [403, {}, "BRIDGE_AUTHORIZATION"],
      [404, {error:"Bridge session not found or not authorized"}, "BRIDGE_SESSION_MISSING"], [404, {error:"Not found"}, "BRIDGE_VERSION"],
      [409, {}, "BRIDGE_BUSY"], [502, {code:"PHIF_UPSTREAM_TIMEOUT"}, "PHIF_UPSTREAM_TIMEOUT"], [502, {}, "BRIDGE_UPSTREAM"],
      [502, {authRequired:true}, "PHIF_AUTH_REQUIRED"]] as const) {
      await expect(requestPhifBridgeRead("stock", "tiryaq", "s", vi.fn(async () => new Response(JSON.stringify(payload), {status})))).rejects.toMatchObject({ code });
    }
  });
  it("sends only one scoped read, keeps redirects disabled, and handles invalid JSON", async () => {
    const fetcher = vi.fn(async () => Response.json({ok:true,rows:[]}));
    expect(await requestPhifBridgeRead("stock","tiryaq","s",fetcher)).toMatchObject({ok:true});
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:5174/api/bridge-sessions/s/stock", expect.objectContaining({method:"GET",redirect:"error",cache:"no-store",headers:expect.objectContaining({"X-Pharmacy-Id":"tiryaq"})}));
    await expect(requestPhifBridgeRead("orders","tiryaq","s",vi.fn(async () => new Response("not-json")))).rejects.toMatchObject({code:"BRIDGE_RESPONSE"});
    vi.stubEnv("PHIF_BRIDGE_BASE_URL", "https://user:password@example.test"); expect(() => phifBridgeOrigin()).toThrow();
  });
  it("applies one whole-request deadline without retries or leaving a pending promise", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: any, options: any) => new Promise<Response>((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")), {once:true})));
    const pending = expect(requestPhifBridgeRead("orders","tiryaq","s",fetcher)).rejects.toMatchObject({code:"BRIDGE_TIMEOUT"});
    await vi.advanceTimersByTimeAsync(PHIF_MANUAL_READ_TIMEOUT_MS); await pending;
    expect(fetcher).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
});
