import { afterEach, describe, expect, it, vi } from "vitest";
import { brokeredPreviewStorage } from "@/integrations/supabase/previewAuthStorage";

function environment(host = "id-preview--c9c49a77-15ee-4b01-b97f-8592fb126678.lovable.app", framed = true) {
  const values = new Map<string, string>(), listeners = new Set<(event: any) => void>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const parent = { postMessage: vi.fn() };
  const window: any = { parent, addEventListener: (_: string, fn: any) => listeners.add(fn),
    removeEventListener: (_: string, fn: any) => listeners.delete(fn) };
  if (!framed) window.parent = window;
  vi.stubGlobal("window", window); vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("location", { hostname: host, ancestorOrigins: ["https://lovable.dev"] });
  vi.stubGlobal("document", { referrer: "https://lovable.dev/projects/test" });
  const reply = (request: any, value: string | null, origin = "https://lovable.dev", requestId = request.requestId) => {
    for (const handler of [...listeners]) handler({ origin, data: { type: "lovable-preview-auth:result", requestId, ok: true, value } });
  };
  return { storage, parent, reply, listeners };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Lovable auth-storage merge safety", () => {
  it("uses local storage without contacting the editor on public, untrusted, or unframed surfaces", () => {
    for (const [host, framed] of [["phif-rx-tracker.lovable.app", true],
      ["id-preview--c9c49a77-15ee-4b01-b97f-8592fb126678.example.com", true],
      ["id-preview--c9c49a77-15ee-4b01-b97f-8592fb126678.lovable.app", false]] as const) {
      const env = environment(host, framed);
      expect(brokeredPreviewStorage()).toBe(env.storage); expect(env.parent.postMessage).not.toHaveBeenCalled();
    }
  });
  it("rejects foreign origins and mismatched request IDs before accepting the editor response", async () => {
    const env = environment();
    env.parent.postMessage.mockImplementation((request, origin) => {
      expect(origin).toBe("https://lovable.dev");
      env.reply(request, "foreign", "https://untrusted.example");
      env.reply(request, "wrong-request", origin, "different-id");
      env.reply(request, "test-session", origin);
    });
    expect(await brokeredPreviewStorage()!.getItem("test-key")).toBe("test-session");
    expect(env.storage.getItem("test-key")).toBe("test-session"); expect(env.listeners.size).toBe(0);
  });
  it("passes an existing local session only to the trusted editor and keeps it when no editor value exists", async () => {
    const env = environment(); env.storage.setItem("test-key", "existing-test-session");
    env.parent.postMessage.mockImplementation((request, origin) => {
      expect(request.value).toBe("existing-test-session"); expect(origin).toBe("https://lovable.dev"); env.reply(request, null);
    });
    expect(await brokeredPreviewStorage()!.getItem("test-key")).toBe("existing-test-session");
  });
  it("preserves logout tombstones and sends removal through the same trusted broker", async () => {
    const env = environment(); env.storage.setItem("test-key", "existing-test-session");
    env.parent.postMessage.mockImplementation(request => env.reply(request, ""));
    const storage = brokeredPreviewStorage()!;
    expect(await storage.getItem("test-key")).toBeNull(); expect(env.storage.getItem("test-key")).toBeNull();
    env.storage.setItem("test-key", "another-test-session"); await storage.removeItem("test-key");
    expect(env.parent.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ type: "lovable-preview-auth:remove", value: "another-test-session" });
    expect(env.storage.getItem("test-key")).toBeNull();
  });
  it("falls back to existing storage after a silent broker without leaving message listeners", async () => {
    vi.useFakeTimers(); const env = environment(); env.storage.setItem("test-key", "existing-test-session");
    const result = brokeredPreviewStorage()!.getItem("test-key");
    await vi.advanceTimersByTimeAsync(4500);
    expect(await result).toBe("existing-test-session"); expect(env.parent.postMessage).toHaveBeenCalledTimes(2);
    expect(env.listeners.size).toBe(0);
  });
});
