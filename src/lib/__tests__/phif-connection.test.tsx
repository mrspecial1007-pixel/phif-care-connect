import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { PhifConnectionBadge } from "../../components/PhifConnectionIndicator";
import { readPhifConnectionStatus } from "../phif-connection.server";
import { phifConnectionState, type PhifConnectionStatus } from "../phif-connection.helpers";
import { bindItemsAnalyticsSessionCache, itemsAnalyticsScope } from "../items-analytics-cache.helpers";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const future = "2099-01-01T00:00:00Z";
function database(row: any = { id: "session-row", expires_at: future }, observed: any = { status: "completed", finished_at: new Date().toISOString() }, error: any = null) {
  const calls: any[] = [];
  return { calls, from: (table: string) => {
    calls.push(["from",table]);
    const q: any = { select: () => q, eq: (key: string, value: unknown) => { calls.push([key,value]); return q; },
      gt: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: table === "phif_bridge_sessions" ? row : observed, error }) };
    return q;
  } };
}
describe("passive PHIF connection metadata", () => {
  it("never contacts PHIF or Bridge, requires a recent successful manual operation on the same pharmacy/session", async () => {
    vi.stubEnv("PHIF_BRIDGE_SECRET", "private"); const fetcher = vi.fn(() => { throw new Error("must never fetch"); }); vi.stubGlobal("fetch",fetcher);
    const db = database(), result = await readPhifConnectionStatus(db,"tiryaq");
    expect(result).toMatchObject({ authenticated:true,sessionAvailable:true,reason:"available",expiresAt:future });
    expect(db.calls).toContainEqual(["pharmacy_id","tiryaq"]);expect(db.calls).toContainEqual(["session_record_id","session-row"]);
    expect(fetcher).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toMatch(/private|session-row|cookie|token/);
  });
  it("does not call a saved session connected without recent proof, after failures or after session changes", async () => {
    vi.stubEnv("PHIF_BRIDGE_SECRET","private");
    for(const observation of [null,{status:"pending"},{status:"failed"},{status:"completed",finished_at:"2020-01-01"},
      {status:"completed",finished_at:"invalid"},{status:"completed",finished_at:future}])
      expect(await readPhifConnectionStatus(database(undefined,observation),"tiryaq")).toMatchObject({authenticated:false,reason:"verification_required"});
  });
  it("handles absent/expired sessions, missing migration and configuration without a probe or write", async () => {
    vi.stubEnv("PHIF_BRIDGE_SECRET","private");
    for(const row of [null,{id:"s",expires_at:"invalid"},{id:"s",expires_at:"2000-01-01"}])
      expect((await readPhifConnectionStatus(database(row),"tiryaq")).authenticated).toBe(false);
    expect((await readPhifConnectionStatus(database(undefined,undefined,{code:"42P01"}),"tiryaq")).reason).toBe("unreachable");
    vi.stubEnv("PHIF_BRIDGE_SECRET","");expect((await readPhifConnectionStatus(database(),"tiryaq")).reason).toBe("not_configured");
    const server=readFileSync("src/lib/phif-connection.server.ts","utf8");
    expect(server).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(|\bfetch\(/);
  });
});
describe("header states and user/pharmacy isolation", () => {
  const now=Date.parse("2026-10-25T12:00:00Z");
  const status: PhifConnectionStatus={authenticated:true,reason:"available",checkedAt:new Date(now).toISOString(),expiresAt:new Date(now+120000).toISOString()};
  it("shows unknown for stale proof, disconnected for expiry/offline, with no silent refresh", () => {
    expect(phifConnectionState(status,{now})).toBe("connected");
    expect(phifConnectionState(status,{now:now+61000})).toBe("unknown");
    expect(phifConnectionState(status,{now,failed:true})).toBe("unknown");
    expect(phifConnectionState(status,{now,online:false})).toBe("disconnected");
    expect(phifConnectionState(status,{now:now+120001})).toBe("disconnected");
    expect(phifConnectionState({...status,authenticated:false,reason:"verification_required"},{now:now+120001})).toBe("disconnected");
    expect(phifConnectionState(undefined,{now,pending:true})).toBe("checking");
  });
  it("keeps compact RTL-compatible green/red badges and explains unverified status", () => {
    expect(renderToStaticMarkup(<PhifConnectionBadge state="connected"/>)).toContain("text-emerald-900");
    expect(renderToStaticMarkup(<PhifConnectionBadge state="disconnected"/>)).toContain("غير متصل");
    const unknown=renderToStaticMarkup(<PhifConnectionBadge state="unknown"/>);
    expect(unknown).toContain("غير مؤكد");expect(unknown).toContain('role="status"');
    expect(unknown).toContain("عند المزامنة اليدوية فقط");
  });
  it("purges another pharmacy/user's badge and clears it on logout", () => {
    const client=new QueryClient(),unbind=bindItemsAnalyticsSessionCache(client);
    const session={unlocked:true,pharmacy:{id:"tiryaq"},user:{id:"admin",role:"admin"}},key=["phif_connection_indicator",itemsAnalyticsScope(session)];
    for(const next of [{...session,pharmacy:{id:"andalus"}},{...session,user:{id:"employee",role:"employee"}},{unlocked:false}]) {
      client.setQueryData(key,status);client.setQueryData(["session"],next);expect(client.getQueryData(key)).toBeUndefined();
    }
    unbind();client.clear();
  });
});
