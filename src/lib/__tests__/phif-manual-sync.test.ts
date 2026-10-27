import { describe, expect, it, vi } from "vitest";
import { beginManualSync, failManualSync } from "../phif-manual-sync.server";
import { runManualStockSync } from "../phif-stock-sync.server";
import { completeCloudOrders, loadCloudOrders } from "../phif-orders-cloud.server";
import { ordersFixture } from "./fixtures/phif-orders.fixture";
import { signOrdersSnapshot, verifyOrdersSnapshot } from "../phif-orders-snapshot.server";
import { readFileSync } from "node:fs";

const op = { id: "00000000-0000-4000-8000-000000000001", snapshot_version: 0, expires_at: "2099-01-01T00:00:00Z" };
function db(options: { pending?: any; apply?: any; readback?: any; snapshot?: any; snapshotError?: any; fail?: any } = {}) {
  const calls: any[] = [];
  const report = ordersFixture();
  const database = { calls, rpc: vi.fn(async (name: string, data: any) => {
    calls.push([name, data]);
    if (name === "begin_phif_manual_sync") return options.pending || { data: op, error: null };
    if (name === "fail_phif_manual_sync") return options.fail || { data: "failed", error: null };
    return options.apply || { data: 1, error: null };
  }), from: (table: string) => {
    const q: any = { select: () => q, eq: (column: string, value: unknown) => { calls.push([table,column,value]); return q; },
      gt: () => q, order: () => q, limit: () => q, maybeSingle: async () => table === "phif_manual_sync_operations" ? { data: { status: "completed" }, error: null } : table === "phif_bridge_sessions"
        ? { data: { id: "session-row", bridge_session_id: "private-session", expires_at: "2099-01-01T00:00:00Z" }, error: null }
        : { data: options.snapshot === undefined ? { pharmacy_id: "tiryaq", report, version: 1, fetched_at: report.fetchedAt } : options.snapshot,
          error: options.snapshotError || null },
      single: async () => options.readback || { data: { status: "completed", imported_records: 1, total_records: 1 }, error: null } };
    return q;
  } };
  return database;
}
describe("manual-only, fenced PHIF synchronization", () => {
  it("does not contact PHIF when the DB lease is busy, missing, cooling down, legacy-pending or user is unauthenticated", async () => {
    for (const error of [{message:"PHIF_SYNC_BUSY"}, {message:"PHIF_SYNC_COOLDOWN"}, {message:"PHIF_LEGACY_PENDING_REQUIRES_REVIEW"}, {code:"PGRST202"}] ) {
      const database = db({ pending: { error } }), read = vi.fn();
      await expect(runManualStockSync(database, "tiryaq", "admin", read, vi.fn())).rejects.toThrow();
      expect(read).not.toHaveBeenCalled();
    }
    const database = db(); await expect(beginManualSync(database, "tiryaq", undefined, "orders", "session-row")).rejects.toThrow("موثق");
    expect(database.rpc).not.toHaveBeenCalled();
  });
  it("uses the current pharmacy, user and exact session record and confirms atomic completion by readback", async () => {
    const database = db(), read = vi.fn(async () => ({ ok: true, raw_count: 1, rows: [{ id: 100 }] }));
    const result = await runManualStockSync(database, "tiryaq", "admin", read, () => [{ source_stock_id: "100" }]);
    expect(result.imported_records).toBe(1);
    expect(database.rpc).toHaveBeenCalledWith("begin_phif_manual_sync", { p_pharmacy_id: "tiryaq", p_actor_id: "admin", p_kind: "stock", p_session_record_id: "session-row" });
    expect(database.calls).toContainEqual(["phif_stock_sync_runs","pharmacy_id","tiryaq"]);
    expect(database.calls.some(c => c[0] === "fail_phif_manual_sync")).toBe(false);
  });
  it("retains stock on timeout, partial payload, missing IDs, invalid counts and unconfirmed completion", async () => {
    for (const payload of [{ ok: false }, { ok: true, raw_count: 2, rows: [{}] }, { ok: true, raw_count: 1, rows: [{}] }]) {
      const database = db();
      await expect(runManualStockSync(database, "tiryaq", "admin", async () => payload, () => [])).rejects.toThrow();
      expect(database.rpc.mock.calls.some(c => c[0] === "replace_phif_stock_snapshots")).toBe(false);
      expect(database.rpc.mock.calls.some(c => c[0] === "fail_phif_manual_sync")).toBe(true);
    }
    const database = db({ readback: { error: { message: "timeout" } } });
    await expect(runManualStockSync(database, "tiryaq", "admin", async () => ({ ok: true, raw_count: 1, rows: [{}] }), () => [{ source_stock_id: "100" }])).rejects.toThrow("تأكيد");
    const timed = db(); await expect(runManualStockSync(timed, "tiryaq", "admin", async () => { throw new Error("timeout"); }, () => [])).rejects.toThrow("timeout");
    await expect(failManualSync(db({ fail: { error: {} } }), "tiryaq", "admin", op.id)).rejects.toThrow("إغلاق");
  });
  it("recognizes a committed stock transaction after a lost RPC acknowledgement, without applying twice", async () => {
    const database = db({ apply: { error: { message: "network" } } });
    const result = await runManualStockSync(database, "tiryaq", "admin", async () => ({ ok: true, raw_count: 1, rows: [{}] }), () => [{ source_stock_id: "100" }]);
    expect(result.imported_records).toBe(1);
    expect(database.rpc.mock.calls.filter(c => c[0] === "replace_phif_stock_snapshots")).toHaveLength(1);
  });
});
describe("shared Cloud orders, user-scoped delivery and temporary local cache", () => {
  it("reads the same complete report for authorized users/devices without sharing their signed identity", async () => {
    const database = db(), saved = await loadCloudOrders(database, "tiryaq");
    expect(saved.report?.totalOrders).toBe(2);
    const secret = "test-shared-orders-secret-at-least-32-characters";
    const admin = signOrdersSnapshot(saved.report, "tiryaq", "admin", secret), employee = signOrdersSnapshot(saved.report, "tiryaq", "employee", secret);
    expect(admin.report).toEqual(employee.report); expect(admin.signature).not.toBe(employee.signature);
    const external = signOrdersSnapshot(saved.report, "tiryaq", "admin", secret + "-external-deployment");
    expect(external.report).toEqual(admin.report);
    expect(verifyOrdersSnapshot(external, "tiryaq", "admin", secret + "-external-deployment").report).toEqual(admin.report);
    expect(() => verifyOrdersSnapshot(admin, "tiryaq", "employee", secret)).toThrow();
    expect(database.calls).toContainEqual(["phif_order_snapshots","pharmacy_id","tiryaq"]);
  });
  it("rejects foreign, partial, corrupt or unavailable central snapshots without pretending they are empty", async () => {
    const report = ordersFixture();
    for (const snapshot of [{ pharmacy_id: "andalus", report, version: 1, fetched_at: report.fetchedAt },
      { pharmacy_id: "tiryaq", report: { ...report, complete: false }, version: 1, fetched_at: report.fetchedAt }]) {
      const result = await loadCloudOrders(db({ snapshot }), "tiryaq");
      expect(result.ready).toBe(false); expect(result.report).toBeNull(); expect(result.error).toBeTruthy();
    }
    expect((await loadCloudOrders(db({ snapshotError: { code: "42P01" } }), "tiryaq")).error).toContain("Migration");
  });
  it("persists only validated complete reports through one versioned RPC, then reads the result back", async () => {
    const database = db(), report = ordersFixture();
    expect(await completeCloudOrders(database, "tiryaq", "admin", op, report)).toEqual(reportWithoutExport());
    expect(database.rpc).toHaveBeenCalledWith("complete_phif_orders_sync", expect.objectContaining({ p_expected_version: 0, p_operation_id: op.id, p_pharmacy_id: "tiryaq" }));
    await expect(completeCloudOrders(db(), "tiryaq", "admin", op, { ...report, complete: false })).rejects.toThrow();
    expect(await completeCloudOrders(db({ apply: { error: { message: "network" } } }), "tiryaq", "admin", op, report)).toEqual(reportWithoutExport());
  });
  it("has no automatic PHIF probes or timers/focus refetch and keeps data reads separate from the refresh POST", () => {
    for (const file of ["src/components/PhifConnectionIndicator.tsx", "src/lib/use-stored-phif-orders.ts", "src/routes/phif-sync.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("refetchInterval: false"); expect(source).toContain("refetchOnWindowFocus: false");
      expect(source).toContain("refetchOnReconnect: false");
    }
    const connection = readFileSync("src/lib/phif-connection.server.ts", "utf8");
    expect(connection).not.toMatch(/\bfetch\(|bridgeJson\(|\/(home|status)/);
    const sync = readFileSync("src/lib/phif-sync.functions.ts", "utf8").split("export const getPhifSessionStatus")[1].split("export const createPhifLoginSession")[0];
    expect(sync).not.toContain("bridgeJson("); expect(sync).not.toContain("markBridgeSession(");
  });
});
function reportWithoutExport() { const { canExport, ...report } = ordersFixture(); return report; }
