import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { OrdersPage } from "@/routes/management.orders";
import { ordersFixture } from "./fixtures/phif-orders.fixture";
import { defaultOrdersFilters, orderAgeDays, ordersCacheOptions, ordersExportAllowed, ordersExportRows, ordersView } from "../phif-orders.helpers";
import { readPhifOrders } from "../phif-orders.server";
import { buildOrdersPdf, buildOrdersWorkbook, orderDateLabel } from "../phif-orders-export";
import { bindItemsAnalyticsSessionCache, itemsAnalyticsScope } from "../items-analytics-cache.helpers";

const session = { unlocked: true, pharmacy: { id: "tiryaq" }, user: { id: "admin", role: "admin", permissions: {} } };
vi.mock("@/lib/queries", () => ({ useSession: () => ({ data: session, error: null }) }));
vi.mock("@/components/management/ReportBackLink", () => ({ ReportBackLink: () => null }));
const clients: QueryClient[] = [];
afterEach(() => { for (const c of clients.splice(0)) c.clear(); vi.unstubAllEnvs(); });
const cacheClient = () => { const c = new QueryClient(); clients.push(c); return c; };

describe("PHIF order monitoring reads and exports", () => {
  it("filters across all orders, excludes explicit zero but retains unknown quantities, and sorts waiting oldest first", () => {
    const data = ordersFixture(), before = JSON.stringify(data);
    data.orders[0].lines.push({ ...data.orders[0].lines[0], id: "zero", approvedQuantity: 0 });
    const result = ordersView(data, defaultOrdersFilters);
    expect(result.rows).toHaveLength(5);
    expect(result.rows[0].orderId).toBe("6123");
    expect(result.counts).toEqual({ waiting: 3, received: 1, not_approved: 1, review: 0 });
    expect(result.rows.filter(r => r.approvedQuantity == null)).toHaveLength(2);
    expect(ordersView(data, { ...defaultOrdersFilters, status: "waiting", supplier: "شركة ثانية" }).rows).toHaveLength(1);
    expect(ordersView(data, { ...defaultOrdersFilters, query: "ORD_242_266_6123" }).rows).toHaveLength(1);
    data.orders[0].lines.pop(); expect(JSON.stringify(data)).toBe(before);
  });
  it("measures elapsed days only from creation, never fabricates approval/receipt times", () => {
    expect(orderAgeDays("2026-10-23T12:00:00Z", Date.parse("2026-10-25T12:00:00Z"))).toBe(2);
    expect(orderAgeDays(null)).toBeNull(); expect(orderAgeDays("invalid")).toBeNull();
    expect(orderAgeDays("2027-01-01T00:00:00Z", Date.parse("2026-10-25"))).toBeNull();
    expect(orderDateLabel("2026-10-24T23:30:00Z")).toBe("2026-10-25");
    expect(ordersFixture().orders.flatMap(o => o.lines).every(l => !l.approvedAt && !l.receivedAt)).toBe(true);
  });
  it("uses current export permissions without requiring financial cost/profit permissions", () => {
    expect(ordersExportAllowed({ user_role: "admin", user_id: "a" })).toBe(true);
    expect(ordersExportAllowed({ user_role: "employee", user_id: "e", user_permissions: {} })).toBe(false);
    expect(ordersExportAllowed({ user_role: "employee", user_id: "e", user_permissions: { reports_export: true } })).toBe(true);
    const server = readFileSync("src/lib/phif-orders.functions.ts", "utf8");
    expect(server).toContain('requireTiryaqPermission("inventory_read")');
    expect(server.indexOf("if (data.export && !canExport)")).toBeLessThan(server.indexOf("await readPhifOrders("));
    expect(server).toContain("if (data.export && !report.complete)");
    expect(server).not.toContain("stock_cost_read");
  });
  it("retains cached orders on navigation and clears them when pharmacy/user/permissions change or logout occurs", async () => {
    const c = cacheClient(), scope = itemsAnalyticsScope(session)!;
    const queryKey = ["phif_orders", scope];
    const read = vi.fn(async () => ordersFixture());
    const watch = () => new QueryObserver(c, { queryKey, queryFn: read, ...ordersCacheOptions });
    const first = watch(), stop = first.subscribe(() => {});
    await first.refetch(); stop();
    const second = watch(), stopAgain = second.subscribe(() => {});
    expect(second.getCurrentResult().isLoading).toBe(false);
    expect(read).toHaveBeenCalledTimes(1); stopAgain();
    const unbind = bindItemsAnalyticsSessionCache(c);
    for (const next of [{ ...session, pharmacy: { id: "andalus" } }, { ...session, user: { ...session.user, permissions: { inventory_read: true } } }, { unlocked: false }]) {
      c.setQueryData(queryKey, ordersFixture()); c.setQueryData(["session"], next);
      expect(c.getQueryData(queryKey)).toBeUndefined();
    }
    unbind();
  });
  it("renders compact cached order cards, pending approval separately, and an explicit failed-detail warning", () => {
    const c = cacheClient();
    const key = ["phif_orders", itemsAnalyticsScope(session)];
    c.setQueryData(key, ordersFixture());
    const render = () => renderToStaticMarkup(<QueryClientProvider client={c}><OrdersPage /></QueryClientProvider>);
    const html = render();
    for (const text of ["متابعة طلبيات PHIF", "بانتظار موافقة المورد", "بانتظار الاستلام", "تم الاستلام", "00123", "منذ إنشاء الطلب", "غير موثقة"])
      expect(html).toContain(text);
    expect(html).not.toContain("جارٍ قراءة الطلبات وتفاصيلها");
    const data = ordersFixture(); data.complete = false; data.orders[1].detailError = "تعذر قراءة تفاصيل الطلب"; data.orders[1].lines = [];
    c.setQueryData(key, data);
    expect(render()).toContain("الإحصائيات تشمل البنود المقروءة فقط والتصدير موقوف");
  });
  it("roundtrips a genuine Arabic RTL Excel workbook with text batches and numeric quantities and dates", async () => {
    const data = ordersFixture();
    const workbook = await buildOrdersWorkbook(data, defaultOrdersFilters);
    const bytes = await workbook.xlsx.writeBuffer();
    const ExcelJS = await import("exceljs"); const parsed = new ExcelJS.Workbook(); await parsed.xlsx.load(bytes);
    expect(parsed.worksheets).toHaveLength(2);
    const sheet = parsed.getWorksheet("أصناف الطلبات")!;
    expect(sheet.rowCount).toBe(6);
    expect(sheet.getCell("E2").value).toBe("00123");
    expect(sheet.getCell("F2").value).toBe(10);
    expect(sheet.getCell("B2").value).toBeInstanceOf(Date);
    expect(sheet.views[0]).toMatchObject({ rightToLeft: true, ySplit: 1 });
    expect(sheet.autoFilter).toBeDefined();
    expect(sheet.getColumn("F").values).toContain("غير موثقة");
    expect(ordersExportRows(data, defaultOrdersFilters, true)).toHaveLength(4);
    expect(ordersExportRows(data, { ...defaultOrdersFilters, status: "received" }, true)).toHaveLength(0);
  }, 30000);
  it("generates a real multipage Arabic A4 PDF with long drug names and only nonreceived rows", async () => {
    const data = ordersFixture();
    const first = data.orders[0].lines[0];
    data.orders[0].lines = Array.from({ length: 50 }, (_, i) => ({ ...first, id: String(1000 + i),
      medicine: "SYNJARDY 12.5 / 1000 MG FICTA 60 TABS BLI NEME - اسم دواء طويل للتحقق من التفاف النص داخل الخلية", batch: `000${i}` }));
    const before = JSON.stringify(data);
    const blob = await buildOrdersPdf(data, defaultOrdersFilters, {
      regular: resolve("public/fonts/Amiri-Regular.ttf"), bold: resolve("public/fonts/Amiri-Bold.ttf"),
    });
    const bytes = Buffer.from(await blob.arrayBuffer());
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(bytes.length).toBeGreaterThan(15000);
    expect(JSON.stringify(data)).toBe(before);
    if (process.env.PHIF_ORDERS_TEST_PDF) writeFileSync(process.env.PHIF_ORDERS_TEST_PDF, bytes);
  }, 30000);
});

describe("pharmacy-scoped Tracker to Bridge read", () => {
  function db(row: any) {
    const calls: any[] = [];
    const q: any = { select: vi.fn(() => q), eq: (key: string, value: any) => { calls.push([key, value]); return q; },
      gt: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: row, error: null }) };
    return { calls, database: { from: (name: string) => { calls.push(name); return q; } } };
  }
  it("uses only the server pharmacy's existing active session, GET, and sanitized fields", async () => {
    vi.stubEnv("PHIF_BRIDGE_SECRET", "test-secret"); vi.stubEnv("PHIF_BRIDGE_BASE_URL", "http://bridge-test");
    const source = db({ bridge_session_id: "private-session", expires_at: "2099-01-01T00:00:00Z" });
    const fetcher = vi.fn(async () => Response.json({ ok: true, ...ordersFixture(), cookieJar: "secret", raw: "private" }));
    const result = await readPhifOrders(source.database, "tiryaq", fetcher);
    expect(source.calls).toContainEqual(["pharmacy_id", "tiryaq"]);
    expect(source.calls).toContainEqual(["status", "active"]);
    expect(fetcher.mock.calls[0][0]).toContain("/private-session/orders");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET", headers: { "X-Pharmacy-Id": "tiryaq", "X-PHIF-Bridge-Secret": "test-secret" } });
    expect(JSON.stringify(result)).not.toMatch(/cookieJar|private-session|private|test-secret/);
    expect(result).not.toHaveProperty("canExport");
  });
  it("never creates a session or fetches data if the saved session is missing, expired or malformed", async () => {
    for (const row of [null, { bridge_session_id: "s", expires_at: "2000-01-01" }, { bridge_session_id: "s", expires_at: "bad" }]) {
      const fetcher = vi.fn();
      await expect(readPhifOrders(db(row).database, "tiryaq", fetcher)).rejects.toThrow("جلسة PHIF");
      expect(fetcher).not.toHaveBeenCalled();
    }
    const source = readFileSync("src/lib/phif-orders.server.ts", "utf8");
    expect(source).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
  });
  it("handles transport, bad JSON, incomplete pagination, missing Bridge support and invalid states explicitly", async () => {
    vi.stubEnv("PHIF_BRIDGE_SECRET", "test-secret");
    const database = db({ bridge_session_id: "s", expires_at: "2099-01-01T00:00:00Z" }).database;
    for (const fetcher of [async () => { throw new Error("connection reset"); }, async () => new Response("not json"),
      async () => new Response("{}", { status: 404 }), async () => Response.json({ ok: true, ...ordersFixture(), totalOrders: 99 }),
      async () => { const data: any = ordersFixture(); data.orders[0].lines[0].status = "invented"; return Response.json({ ok: true, ...data }); }])
      await expect(readPhifOrders(database, "tiryaq", fetcher)).rejects.toThrow();
  });
});
