import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { createOrdersStore } from "../phif-orders.storage";
import { ordersStorageIdentity, signOrdersSnapshot, verifyOrdersSnapshot } from "../phif-orders-snapshot.server";
import { refreshStoredOrders } from "../use-stored-phif-orders";
import { ordersFixture } from "./fixtures/phif-orders.fixture";
import { exportAuthorizedOrdersSnapshot as authorizePhifOrdersSnapshot, readAuthorizedPhifOrders as getPhifOrders, readOrdersStorageAccess as getPhifOrdersStorageAccess } from "../phif-orders-service.server";
import { ordersExportRows, defaultOrdersFilters } from "../phif-orders.helpers";
import { buildOrdersWorkbook } from "../phif-orders-export";

const mocks = vi.hoisted(() => ({ context: null as any, read: vi.fn(), calls: [] as any[], expiry: null as string | null, cloud: null as any }));
vi.mock("@tanstack/react-start/server", () => ({ setResponseHeader: vi.fn() }));
vi.mock("@/lib/pharmacy-session.server", () => ({ requirePharmacySession: async () => mocks.context }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (table: string) => {
  mocks.calls.push(["from", table]);
  if (table === "pharmacy_users") {
    const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: mocks.context.session.data.user_id ? {
      id: mocks.context.session.data.user_id, pharmacy_id: mocks.context.pharmacy_id, is_active: true,
      role: mocks.context.session.data.user_role, permissions: mocks.context.session.data.user_permissions,
    } : null, error: null }) }; return q;
  }
  if (table === "phif_order_snapshots") {
    const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: mocks.cloud ? {
      pharmacy_id: "tiryaq", report: mocks.cloud, version: 1, fetched_at: mocks.cloud.fetchedAt,
    } : null, error: null }) }; return q;
  }
  if (table === "phif_order_receipts") {
    const empty: any = { select: () => empty, eq: () => empty, limit: () => empty, order: () => empty,
      range: async () => ({ data: [], count: 0, error: null }), then: (resolve: any) => resolve({ data: [], error: null }) };
    return empty;
  }
  const query: any = { select: () => query, eq: (key: string, value: unknown) => { mocks.calls.push([key, value]); return query; },
    gt: () => query, order: () => query, limit: () => query,
    maybeSingle: async () => ({ data: mocks.expiry ? { id: "session-row", bridge_session_id: "private", expires_at: mocks.expiry } : null, error: null }) };
  return query;
}, rpc: async (name: string, args: any) => {
  mocks.calls.push([name,args]);
  if (name === "begin_phif_manual_sync") return { data: { id: "00000000-0000-4000-8000-000000000001", snapshot_version: 0, expires_at: "2099-01-01" }, error: null };
  if (name === "complete_phif_orders_sync") { mocks.cloud = args.p_report; return { data: 1, error: null }; }
  if (name === "fail_phif_manual_sync") return { data: "failed", error: null };
  return { error: { message: "Unexpected RPC" } };
} } }));
vi.mock("../phif-orders.server", async original => ({ ...await original<any>(), readPhifOrders: mocks.read }));

const SECRET = "orders-persistence-test-secret-minimum-32-characters";
const access = (pharmacyId = "tiryaq", userId = "admin") => ({ ...ordersStorageIdentity(pharmacyId, userId, SECRET), canExport: true, sessionExpiresAt: null });
const snapshot = (patch: any = {}, pharmacyId = "tiryaq", userId = "admin") => signOrdersSnapshot({ ...ordersFixture(), ...patch }, pharmacyId, userId, SECRET);
const instances: ReturnType<typeof createOrdersStore>[] = [];
function storage(factory = new IDBFactory()) {
  const store = createOrdersStore({ indexedDB: factory, crypto: webcrypto as Crypto, name: "orders-test" });
  instances.push(store); return store;
}
beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET); mocks.calls.length = 0; mocks.read.mockReset(); mocks.expiry = null; mocks.cloud = null;
  mocks.context = { pharmacy_id: "tiryaq", pharmacy_name: "صيدلية الترياق الشافي",
    session: { data: { pharmacy_name: "صيدلية الترياق الشافي", user_id: "admin", user_role: "admin", user_permissions: {} } } };
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await Promise.all(instances.splice(0).map(store => store.close())); });

async function rawRecord(factory: IDBFactory, id: string) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open("orders-test", 1); req.onsuccess = () => resolve(req.result); req.onerror = reject;
  });
  try { return await new Promise<any>((resolve, reject) => {
    const req = db.transaction("snapshots").objectStore("snapshots").get(id);
    req.onsuccess = () => resolve(req.result); req.onerror = reject;
  }); } finally { db.close(); }
}

describe("durable encrypted PHIF order snapshots", () => {
  it("survives closing/reopening the database and stores ciphertext only, with no password, session or key", async () => {
    const factory = new IDBFactory(), first = storage(factory), rights = access(), data = snapshot();
    await first.save(data, rights); await first.close();
    const reopened = storage(factory);
    expect(await reopened.load(rights)).toEqual(data);
    const raw = await rawRecord(factory, rights.subject);
    expect(Object.keys(raw).sort()).toEqual(["ciphertext", "id", "iv", "revision", "version"]);
    expect(raw.ciphertext).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(raw.ciphertext)).not.toContain("Allopurinol");
    expect(JSON.stringify(raw)).not.toMatch(/storageKey|cookie|token|password|phif_session|bridge_session/);
    expect(JSON.stringify(raw)).not.toContain(rights.storageKey);
  });
  it("isolates Tiryaq/Andalus and users in the same browser database", async () => {
    const store = storage(), data = snapshot();
    await store.save(data, access());
    expect(await store.load(access("andalus"))).toBeNull();
    expect(await store.load(access("tiryaq", "employee"))).toBeNull();
    await expect(store.save(data, access("andalus"))).rejects.toThrow("مختلف");
    await store.save(snapshot({}, "andalus"), access("andalus"));
    expect((await store.load(access()))?.pharmacyId).toBe("tiryaq");
    expect((await store.load(access("andalus")))?.pharmacyId).toBe("andalus");
  });
  it("rejects partial, empty, older, truncated and malformed replacements while keeping the complete snapshot", async () => {
    const store = storage(), original = snapshot(), rights = access();
    await store.save(original, rights);
    const empty = snapshot({ orders: [], totalOrders: 0, fetchedAt: "2026-10-26T12:00:00Z" });
    const truncated = snapshot({ orders: [ordersFixture().orders[0]], totalOrders: 1, fetchedAt: "2026-10-26T12:00:00Z" });
    const old = snapshot({ fetchedAt: "2026-10-24T12:00:00Z" });
    for (const candidate of [empty, truncated, old, { ...original, report: { ...original.report, complete: false } },
      { ...original, report: { ...original.report, totalOrders: 999 } }]) {
      await expect(store.save(candidate as any, rights)).rejects.toThrow();
      expect(await store.load(rights)).toEqual(original);
    }
  });
  it("atomically rolls back a failed write and rejects concurrent tab overwrites", async () => {
    const factory = new IDBFactory(), a = storage(factory), b = storage(factory), rights = access(), original = snapshot();
    await a.save(original, rights);
    const realPut = IDBObjectStore.prototype.put;
    const failure = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => { throw new DOMException("quota", "QuotaExceededError"); });
    await expect(a.save(snapshot({ fetchedAt: "2026-10-26T12:00:00Z" }), rights)).rejects.toThrow("احتُفظ");
    failure.mockRestore();
    expect(await a.load(rights)).toEqual(original);
    expect(IDBObjectStore.prototype.put).toBe(realPut);
    const results = await Promise.allSettled([
      a.save(snapshot({ fetchedAt: "2026-10-26T12:00:00Z" }), rights),
      b.save(snapshot({ fetchedAt: "2026-10-27T12:00:00Z" }), rights),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const persisted = await a.load(rights);
    expect(["2026-10-26T12:00:00Z", "2026-10-27T12:00:00Z"]).toContain(persisted?.report.fetchedAt);
  });
  it("fails closed on a wrong encryption key or corrupted ciphertext, without deleting the original", async () => {
    const store = storage(), rights = access(), original = snapshot();
    await store.save(original, rights);
    await expect(store.load({ ...rights, storageKey: "1".repeat(64) })).rejects.toThrow("فك تشفيرها");
    expect(await store.load(rights)).toEqual(original);
  });
  it("retains every detail and status, including unknown quantities and exact batch strings", async () => {
    const store = storage(), data = snapshot();
    await store.save(data, access());
    const restored = await store.load(access());
    expect(restored?.report.orders[0].lines[0].batch).toBe("00123");
    expect(restored?.report.orders[0].lines[2]).toMatchObject({ status: "not_approved", approvedQuantity: null });
    expect(restored?.report.orders[0].lines[3].approvedQuantity).toBeNull();
    expect(ordersExportRows({ ...restored!.report, canExport: true }, defaultOrdersFilters)).toHaveLength(4);
  });
  it("keeps legacy null receipt dates and explicit actual receipt dates signed and durable", async () => {
    const store = storage(), original = snapshot(), rights = access();
    await store.save(original, rights);
    expect(verifyOrdersSnapshot((await store.load(rights))!, "tiryaq", "admin", SECRET)).toEqual(original);
    const report = ordersFixture(); report.orders[0].lines[1].receivedAt = "2026-10-18T12:00:00Z";
    const next = signOrdersSnapshot(report, "tiryaq", "admin", SECRET);
    await store.save(next, rights);
    const restored = verifyOrdersSnapshot((await store.load(rights))!, "tiryaq", "admin", SECRET);
    expect(restored.report.orders[0].lines[1].receivedAt).toBe("2026-10-18T12:00:00Z");
  });
});

describe("snapshot integrity, current permissions and PHIF-independent export", () => {
  it("binds signatures and encryption keys to both pharmacy and user and strips arbitrary credentials", () => {
    const data = snapshot({ cookies: "private", bridge_session_id: "private", cost_price: 42 });
    expect(JSON.stringify(data)).not.toMatch(/private|cost_price/);
    expect(verifyOrdersSnapshot(data, "tiryaq", "admin", SECRET)).toEqual(data);
    for (const [pharmacy, user] of [["andalus", "admin"], ["tiryaq", "employee"]])
      expect(() => verifyOrdersSnapshot(data, pharmacy, user, SECRET)).toThrow();
    const tampered = structuredClone(data); tampered.report.orders[0].lines[0].approvedQuantity = 999;
    expect(() => verifyOrdersSnapshot(tampered, "tiryaq", "admin", SECRET)).toThrow();
    expect(access().storageKey).not.toBe(access("andalus").storageKey);
    expect(access().storageKey).not.toBe(access("tiryaq", "employee").storageKey);
    for (const secret of ["", "short", "dev-only-session-secret-please-set-SESSION_SECRET-in-env"])
      expect(() => ordersStorageIdentity("tiryaq", "admin", secret)).toThrow("SESSION_SECRET");
  });
  it("opens storage access and exports the saved report with an expired PHIF session, without calling Bridge", async () => {
    const rights = await getPhifOrdersStorageAccess();
    expect(rights.sessionExpiresAt).toBeNull();
    expect(rights.canExport).toBe(true);
    expect(mocks.calls).toContainEqual(["pharmacy_id", "tiryaq"]);
    const exported = await authorizePhifOrdersSnapshot(snapshot());
    expect(exported.orders).toEqual(ordersFixture().orders);
    expect(exported.fetchedAt).toBe(ordersFixture().fetchedAt);
    expect(exported.dataSource).toBe("saved");
    expect(mocks.read).not.toHaveBeenCalled();
    const workbook = await buildOrdersWorkbook(exported, defaultOrdersFilters);
    const rows: any[] = []; workbook.getWorksheet("الملخص")!.eachRow(row => rows.push(row.values));
    expect(JSON.stringify(rows)).toContain("آخر مزامنة ناجحة");
    expect(JSON.stringify(rows)).toContain(ordersFixture().fetchedAt);
  }, 30000);
  it("checks current employee permissions and rejects revoked export, cross-user, cross-pharmacy and forged snapshots", async () => {
    const data = snapshot();
    mocks.context.session.data = { user_id: "employee", user_role: "employee", user_permissions: { inventory_read: true } };
    expect((await getPhifOrdersStorageAccess()).canExport).toBe(false);
    await expect(authorizePhifOrdersSnapshot(data)).rejects.toThrow("تصدير");
    mocks.context.session.data.user_permissions.reports_export = true;
    await expect(authorizePhifOrdersSnapshot(data)).rejects.toThrow("التحقق");
    const own = snapshot({}, "tiryaq", "employee");
    expect((await authorizePhifOrdersSnapshot(own)).canExport).toBe(true);
    mocks.context.session.data.user_permissions.inventory_read = false;
    await expect(getPhifOrdersStorageAccess()).rejects.toThrow("Forbidden");
    mocks.context.pharmacy_name = "صيدلية الأندلس";
    await expect(getPhifOrdersStorageAccess()).rejects.toThrow("Unauthorized");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("signs only a complete manual refresh and never permits partial responses to replace a previous snapshot", async () => {
    mocks.expiry = "2099-01-01T00:00:00Z";
    mocks.read.mockResolvedValue({ ...ordersFixture(), complete: false });
    expect(await getPhifOrders({ export: false })).toMatchObject({ ok: false, reason: "upstream" });
    mocks.read.mockResolvedValue(ordersFixture());
    const refreshed = await getPhifOrders({ export: false });
    expect(refreshed.ok).toBe(true);
    if (refreshed.ok) expect(verifyOrdersSnapshot(refreshed.snapshot, "tiryaq", "admin", SECRET).report.totalOrders).toBe(2);
  });
  it("keeps the previous result on failed sessions, partial reads, foreign scopes or storage failures", async () => {
    const previous = snapshot(), write = vi.fn();
    for (const reason of ["session_expired", "incomplete", "upstream"]) {
      const read: any = async () => ({ ok: false, reason, error: "retained" });
      expect(await refreshStoredOrders(access(), previous, read, write)).toMatchObject({ ok: false, reason });
    }
    expect(write).not.toHaveBeenCalled();
    await expect(refreshStoredOrders(access(), previous, async () => ({ ok: true, snapshot: snapshot({}, "andalus") }), write)).rejects.toThrow("لا تخص");
    await expect(refreshStoredOrders(access(), previous, async () => ({ ok: true, snapshot: snapshot() }), async () => { throw new Error("quota"); })).resolves.toMatchObject({ ok: true, cacheWarning: expect.stringContaining("Cloud") });
    expect(previous).toEqual(snapshot());
  });
  it("checks the signed local baseline before saving Cloud, so an initial partial central read cannot discard a known order", async () => {
    mocks.expiry = "2099-01-01T00:00:00Z";
    const original = ordersFixture(); original.orders.push({ ...original.orders[0], id: "99999", lines: [] }); original.totalOrders++;
    const previous = signOrdersSnapshot(original, "tiryaq", "admin", SECRET);
    mocks.read.mockResolvedValue(ordersFixture());
    expect(await getPhifOrders({ export: false, previous })).toMatchObject({ ok:false, error:expect.stringContaining("جميع الطلبات") });
    expect(mocks.calls.some(c => c[0] === "complete_phif_orders_sync")).toBe(false);
    expect(mocks.cloud).toBeNull();
  });
  it("never auto-syncs on mount or exports using a live PHIF read, and keeps keys out of durable storage", () => {
    const hook = readFileSync("src/lib/use-stored-phif-orders.ts", "utf8");
    expect(hook.indexOf("getPhifOrders({")).toBeGreaterThan(hook.indexOf("async function refresh()"));
    const exporter = readFileSync("src/components/management/OrdersExportButton.tsx", "utf8");
    expect(exporter).toContain("authorizePhifOrdersSnapshot"); expect(exporter).not.toContain("getPhifOrders(");
    const store = readFileSync("src/lib/phif-orders.storage.ts", "utf8");
    expect(store).not.toContain("localStorage"); expect(store).toContain('"AES-GCM"');
    const api = readFileSync("src/lib/phif-orders.functions.ts", "utf8");
    expect(api).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
  });
});
