import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { phifTrackerAccess, requirePhifTrackerUser, confirmPhifTrackerUser } from "../phif-tracker-user.server";
import { hashPin, verifyPin } from "../pharmacy-session.server";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PhifTrackerIdentityNotice } from "../../components/management/PhifTrackerIdentityNotice";

const context = (user_id?: string) => ({ pharmacy_id: "tiryaq", pharmacy_name: "صيدلية الترياق الشافي",
  session: { data: { pharmacy_id: "tiryaq", user_id, user_role: user_id ? "admin" : "legacy" }, update: vi.fn(async () => {}) } });
const user = { id: "verified-admin", pharmacy_id: "tiryaq", is_active: true, role: "admin", permissions: {}, display_name: "Manager", password_hash: hashPin("4123") };
function database(row: any = user, error: any = null) {
  const filters: any[] = [];
  const q: any = { select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; }, maybeSingle: async () => ({ data: row, error }) };
  return { filters, from: vi.fn(() => q), rpc: vi.fn() };
}
beforeEach(() => vi.stubEnv("SESSION_SECRET", "local-test-session-secret-with-at-least-32-characters"));
afterEach(() => vi.unstubAllEnvs());

describe("PHIF actor verification using existing Tracker PIN accounts", () => {
  it("does not promote a shared pharmacy PIN to a person or call a sync RPC", async () => {
    const db = database(), session = context();
    expect(await phifTrackerAccess(db, session)).toMatchObject({ ready: false, reason: "identity_required" });
    await expect(requirePhifTrackerUser(db, session)).rejects.toThrow("PIN");
    expect(db.from).not.toHaveBeenCalled(); expect(db.rpc).not.toHaveBeenCalled(); expect(session.session.update).not.toHaveBeenCalled();
    expect((await phifTrackerAccess(db, { ...context(user.id), session: { ...session.session, data: { user_id: user.id, user_role: "legacy" } } })).ready).toBe(false);
    expect(db.from).not.toHaveBeenCalled();
  });
  it("rechecks user ID, pharmacy, active status and current permissions rather than trusting signed stale roles", async () => {
    for (const row of [null, { ...user, id: "different-user" }, { ...user, pharmacy_id: "andalus" },
      { ...user, is_active: false }, { ...user, role: "employee", permissions: {} }, { ...user, role: "legacy" }]) {
      expect((await phifTrackerAccess(database(row), context(user.id))).ready).toBe(false);
    }
    const db = database(); expect(await requirePhifTrackerUser(db, context(user.id))).toBe(user.id);
    expect(db.filters).toContainEqual(["id", user.id]); expect(db.filters).toContainEqual(["pharmacy_id", "tiryaq"]);
    expect((await phifTrackerAccess(database({ ...user, role: "employee", permissions: { inventory_read: true } }), context(user.id))).ready).toBe(true);
  });
  it("verifies the actual PIN and existing scoped user; ignores a forged client user ID", async () => {
    const db = database(), current = context();
    await confirmPhifTrackerUser(db, current, { identifier: "ADMIN@TIRYAQ.COM", pin: "4123", user_id: "attacker" } as any, verifyPin);
    expect(db.filters).toContainEqual(["pharmacy_id", "tiryaq"]); expect(db.filters).toContainEqual(["login_identifier", "admin@tiryaq.com"]);
    expect(current.session.update).toHaveBeenCalledWith(expect.objectContaining({ pharmacy_id: "tiryaq", user_id: user.id, user_role: "admin" }));
    expect(db.rpc).not.toHaveBeenCalled();
    for (const row of [{ ...user, pharmacy_id: "andalus" }, { ...user, is_active: false }, user]) {
      const current = context();
      await expect(confirmPhifTrackerUser(database(row), current, { identifier: "admin", pin: "incorrect" }, verifyPin)).rejects.toThrow();
      expect(current.session.update).not.toHaveBeenCalled();
    }
  });
  it("fails closed for missing secrets, another pharmacy, DB errors and revoked inventory access", async () => {
    vi.stubEnv("SESSION_SECRET", "dev-only-unsafe");
    expect((await phifTrackerAccess(database(), context(user.id))).reason).toBe("configuration");
    vi.stubEnv("SESSION_SECRET", "local-test-session-secret-with-at-least-32-characters");
    expect((await phifTrackerAccess(database(null, {}), context(user.id))).reason).toBe("unavailable");
    expect((await phifTrackerAccess(database(), { ...context(user.id), pharmacy_name: "الأندلس" })).reason).toBe("forbidden");
    await expect(confirmPhifTrackerUser(database({ ...user, role: "employee", permissions: {} }), context(), { identifier: "employee", pin: "4123" }, verifyPin)).rejects.toThrow("صلاحية");
  });
  it("shows a precise PIN-session action, without embedding user IDs or credentials in the notice", () => {
    const client = new QueryClient();
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><PhifTrackerIdentityNotice access={{ ready: false, reason: "identity_required", message: "جلسة PIN تحتاج مستخدمًا موثقًا" }} /></QueryClientProvider>);
    expect(html).toContain("توثيق مستخدم Tracker"); expect(html).not.toContain(user.id); client.clear();
  });
});
