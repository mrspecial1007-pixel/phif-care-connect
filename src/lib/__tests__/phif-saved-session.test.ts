import { afterEach, describe, expect, it, vi } from "vitest";
import { readSavedPhifSession } from "../phif-saved-session.server";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function database(data: unknown = null, error: unknown = null) {
  const q: any = {};
  for (const method of ["select", "eq", "gt", "order", "limit"]) q[method] = vi.fn(() => q);
  q.maybeSingle = vi.fn(async () => ({ data, error }));
  return { db: { from: vi.fn(() => q) }, q };
}

describe("manual sync saved login availability without a connection indicator", () => {
  it.each(["tiryaq", "andalus"])("reads only nonexpired saved login metadata scoped to %s", async pharmacyId => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
    const network = vi.fn(() => { throw new Error("No PHIF requests allowed"); });
    vi.stubGlobal("fetch", network);
    const { db, q } = database({ expires_at: "2026-10-28T13:00:00Z", bridge_session_id: "never-expose-this" });
    expect(await readSavedPhifSession(db, pharmacyId)).toEqual({ expires_at: "2026-10-28T13:00:00Z" });
    expect(db.from).toHaveBeenCalledExactlyOnceWith("phif_bridge_sessions");
    expect(q.select).toHaveBeenCalledExactlyOnceWith("expires_at");
    expect(q.eq.mock.calls).toEqual([["pharmacy_id", pharmacyId], ["status", "active"]]);
    expect(q.gt).toHaveBeenCalledExactlyOnceWith("expires_at", "2026-10-28T12:00:00.000Z");
    expect(q.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(q.limit).toHaveBeenCalledWith(1);
    expect(network).not.toHaveBeenCalled();
  });

  it("does not create a session when none is saved", async () => {
    const { db } = database();
    expect(await readSavedPhifSession(db, "tiryaq")).toBeNull();
    expect(Object.keys(db)).toEqual(["from"]);
  });

  it("reports DB errors without leaking technical or credential details", async () => {
    const { db } = database(null, { message: "secret internal detail" });
    await expect(readSavedPhifSession(db, "tiryaq")).rejects.toThrow("تعذر قراءة جلسة PHIF المحفوظة");
  });

  it("removes the indicator, endpoint, evidence tracking, cache keys, and observers from application source", () => {
    for (const file of ["src/components/PhifConnectionIndicator.tsx", "src/lib/phif-connection.functions.ts",
      "src/lib/phif-connection.server.ts", "src/lib/phif-connection.helpers.ts", "src/lib/phif-connection-observation.server.ts"])
      expect(existsSync(file), file).toBe(false);
    function check(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== "__tests__") check(file); }
        else if (/\.[jt]sx?$/.test(entry.name)) expect(readFileSync(file, "utf8"), file)
          .not.toMatch(/PhifConnectionIndicator|phif_connection_indicator|phif-connection|recordPhifConnectionObservation/);
      }
    }
    check("src");
    const page = readFileSync("src/routes/phif-sync.tsx", "utf8");
    expect(page).not.toMatch(/آخر اتصال مؤكد|جلسة غير مؤكدة|غير متصل|status\?\.authenticated/);
  });

  it("retains authenticated manual sync, expiry handling, Cloud storage, and the stock fence", () => {
    const sync = readFileSync("src/lib/phif-sync.functions.ts", "utf8");
    const metadata = sync.split("export const getPhifSessionStatus")[1].split("export const createPhifLoginSession")[0];
    expect(metadata).toContain('requireTiryaqPermission("phif_sync_run")');
    expect(metadata).toContain("readSavedPhifSession");
    expect(metadata).not.toMatch(/bridgeJson\(|markBridgeSession\(|currentBridgeSession\(/);
    expect(sync).toContain('markBridgeSession(db, pharmacy_id, session.bridge_session_id, "expired")');
    for (const file of ["src/lib/phif-orders-service.server.ts", "src/lib/phif-stock-sync.server.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("beginManualSync");
      expect(source).toContain("failManualSync");
    }
    expect(readFileSync("src/lib/phif-orders-service.server.ts", "utf8")).toContain("requirePhifTrackerUser");
    expect(readFileSync("src/lib/phif-stock.functions.ts", "utf8")).toContain("requirePhifTrackerUser");
    expect(readFileSync("src/lib/phif-orders-service.server.ts", "utf8")).toContain("completeCloudOrders");
    const hook = readFileSync("src/lib/use-stored-phif-orders.ts", "utf8");
    expect(hook).not.toMatch(/setInterval\(|setTimeout\([^,]+,\s*30_?000/);
    expect(hook).toContain("refetchInterval: false");
    expect(hook).toContain("refetchOnWindowFocus: false");
    expect(hook).toContain("refetchOnReconnect: false");
  });
});
