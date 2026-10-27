import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { OrdersPage } from "@/routes/management.orders";
import { ordersFixture } from "./fixtures/phif-orders.fixture";
import { defaultOrdersFilters, orderAgeDays, orderDuration, ordersCacheOptions, ordersExportAllowed, ordersExportRows, ordersPeriodFilters, ordersStatisticFilters, ordersView } from "../phif-orders.helpers";
import { readPhifOrders } from "../phif-orders.server";
import { buildOrdersPdf, buildOrdersWorkbook, orderDateLabel, ordersPeriodLabel } from "../phif-orders-export";
import { bindItemsAnalyticsSessionCache, itemsAnalyticsScope } from "../items-analytics-cache.helpers";
import { ordersStorageIdentity, signOrdersSnapshot } from "../phif-orders-snapshot.server";

const session = { unlocked: true, pharmacy: { id: "tiryaq" }, user: { id: "admin", role: "admin", permissions: {} } };
vi.mock("@/lib/queries", () => ({ useSession: () => ({ data: session, error: null }) }));
vi.mock("@/components/management/ReportBackLink", () => ({ ReportBackLink: () => null }));
const clients: QueryClient[] = [];
afterEach(() => { for (const c of clients.splice(0)) c.clear(); vi.unstubAllEnvs(); });
const secret = "orders-local-test-secret-at-least-32-characters";
const cacheClient = () => { const c = new QueryClient(); clients.push(c);
  c.setQueryData(["phif_orders_access", itemsAnalyticsScope(session)], {
    ...ordersStorageIdentity("tiryaq", "admin", secret), canExport: true, sessionExpiresAt: null, sessionCheckFailed: false,
  });
  return c;
};
const saved = (report = ordersFixture()) => signOrdersSnapshot(report, "tiryaq", "admin", secret);

describe("PHIF order monitoring reads and exports", () => {
  it("filters across all orders, excludes explicit zero but retains unknown quantities, and sorts waiting oldest first", () => {
    const data = ordersFixture(), before = JSON.stringify(data);
    data.orders[0].lines.push({ ...data.orders[0].lines[0], id: "zero", approvedQuantity: 0 });
    const result = ordersView(data, defaultOrdersFilters);
    expect(result.rows).toHaveLength(4);
    expect(result.rows[0].orderId).toBe("6123");
    expect(result.counts).toEqual({ waiting: 3, received: 1, not_approved: 1, review: 0 });
    expect(result.rows.filter(r => r.approvedQuantity == null)).toHaveLength(1);
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
  it("advances nonreceived durations to today even for an older saved snapshot, but never ages received items without a receipt date", () => {
    const report = ordersFixture(), before = JSON.stringify(report), now = Date.parse("2026-10-30T02:38:20Z");
    const view = ordersView(report, defaultOrdersFilters, now);
    expect(view.rows.find(row => row.id === "60686")?.duration).toEqual({ days: 17, label: "مدة منذ إنشاء الطلب: 17 يومًا" });
    const received = view.rows.find(row => row.status === "received")!;
    expect(received.duration).toEqual({ days: null, label: "تم الاستلام — تاريخ الاستلام غير متوفر" });
    expect(ordersView(report, defaultOrdersFilters, now + 7 * 86400000).rows.find(row => row.id === received.id)?.duration).toEqual(received.duration);
    expect(view.counts).toEqual(ordersView(report, defaultOrdersFilters, now + 7 * 86400000).counts);
    expect(ordersExportRows(report, defaultOrdersFilters, false, now).find(row => row.status === "تم الاستلام")).toMatchObject({ ageDays: null, durationLabel: received.duration.label });
    const pdfRows = ordersExportRows(report, defaultOrdersFilters, true, now);
    expect(pdfRows.find(row => row.orderNumber === "ORD_242_266_10326")?.ageDays).toBe(17);
    expect(pdfRows.every(row => row.status !== "تم الاستلام")).toBe(true);
    expect(JSON.stringify(report)).toBe(before);
  });
  it("stops a received duration on its actual receipt date and rejects missing, invalid, reversed or future dates without a fallback", () => {
    const row = { createdAt: "2026-10-13T12:00:00Z", status: "received" as const, receivedAt: "2026-10-18T12:00:00Z" };
    expect(orderDuration(row, Date.parse("2026-10-25"))).toEqual({ days: 5, label: "مدة من إنشاء الطلب حتى الاستلام: 5 يومًا" });
    expect(orderDuration(row, Date.parse("2026-11-25"))).toEqual(orderDuration(row, Date.parse("2026-10-25")));
    for (const receivedAt of ["invalid", "2026-10-12T12:00:00Z", "2027-01-01T12:00:00Z"])
      expect(orderDuration({ ...row, receivedAt }, Date.parse("2026-10-25")).days).toBeNull();
    expect(orderDuration({ ...row, createdAt: null }).days).toBeNull();
    expect(orderDuration({ ...row, receivedAt: null, updated_at: row.receivedAt, firstObservedAt: row.receivedAt } as any).label)
      .toBe("تم الاستلام — تاريخ الاستلام غير متوفر");
    expect(orderDuration({ ...row, status: "waiting", receivedAt: null }, Date.parse("2026-10-25T12:00:00Z")).days).toBe(12);
    expect(orderDuration({ ...row, status: "not_approved", receivedAt: null }, Date.parse("2026-10-25T12:00:00Z")).days).toBe(12);
  });
  it("exports numeric receipt durations or an explicit unknown-date reason in Excel without using the snapshot date", async () => {
    const report = ordersFixture();
    const received = report.orders[0].lines.find(row => row.status === "received")!;
    report.orders[0].lines.push({ ...received, id: "777", receivedAt: "2026-10-18T02:38:20Z" });
    const before = JSON.stringify(report), now = Date.parse("2026-10-30T02:38:20Z");
    const workbook = await buildOrdersWorkbook(report, defaultOrdersFilters, now);
    const ExcelJS = await import("exceljs"), parsed = new ExcelJS.Workbook();
    await parsed.xlsx.load(await workbook.xlsx.writeBuffer());
    const sheet = parsed.getWorksheet("أصناف الطلبات")!;
    const rows: any[] = []; sheet.eachRow((row, index) => { if (index > 1) rows.push(row.values); });
    const receivedRows = rows.filter(row => row[7] === "تم الاستلام");
    expect(receivedRows).toHaveLength(2);
    const unknown = receivedRows.find(row => row[9] === "تم الاستلام — تاريخ الاستلام غير متوفر");
    expect(unknown[8] ?? null).toBeNull(); expect(unknown[10]).toBe("غير متاح");
    const known = receivedRows.find(row => row[8] === 5);
    expect(known[9]).toBe("مدة من إنشاء الطلب حتى الاستلام: 5 يومًا");
    expect(known[10]).toBeInstanceOf(Date);
    expect(rows.find(row => row[1] === "ORD_242_266_10326" && row[7] === "بانتظار الاستلام")[8]).toBe(17);
    expect(JSON.stringify(report)).toBe(before);
  }, 30000);
  it("renders the received-card unknown-date notice without a running duration", () => {
    const c = cacheClient(); c.setQueryData(["phif_orders", itemsAnalyticsScope(session)], saved());
    const html = renderToStaticMarkup(<QueryClientProvider client={c}><OrdersPage /></QueryClientProvider>);
    const receivedCard = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/g)?.find(card => card.includes("تم الاستلام"))!;
    expect(receivedCard).toContain("تم الاستلام — تاريخ الاستلام غير متوفر");
    expect(receivedCard).not.toContain("مدة منذ إنشاء الطلب:");
    expect(receivedCard).not.toMatch(/\d+ يوم/);
  });
  it("uses current export permissions without requiring financial cost/profit permissions", () => {
    expect(ordersExportAllowed({ user_role: "admin", user_id: "a" })).toBe(true);
    expect(ordersExportAllowed({ user_role: "employee", user_id: "e", user_permissions: {} })).toBe(false);
    expect(ordersExportAllowed({ user_role: "employee", user_id: "e", user_permissions: { reports_export: true } })).toBe(true);
    const server = readFileSync("src/lib/phif-orders-service.server.ts", "utf8");
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
  it("renders compact stored order cards and a nonblocking expired PHIF notice without hiding data or exports", () => {
    const c = cacheClient();
    const key = ["phif_orders", itemsAnalyticsScope(session)];
    c.setQueryData(key, saved());
    const render = () => renderToStaticMarkup(<QueryClientProvider client={c}><OrdersPage /></QueryClientProvider>);
    const html = render();
    for (const text of ["متابعة طلبيات PHIF", "بانتظار موافقة المورد", "بانتظار الاستلام", "تم الاستلام", "00123", "منذ إنشاء الطلب", "غير موثقة"])
      expect(html).toContain(text);
    expect(html).not.toContain("جارٍ قراءة الطلبات وتفاصيلها");
    expect(html).toContain("انتهت جلسة PHIF، البيانات المعروضة من آخر مزامنة");
    expect(html).toContain("آخر مزامنة ناجحة");
    expect(html).toContain("نسخة مؤقتة على هذا الجهاز فقط");
    expect(html).not.toContain('type="button" disabled="" data-slot="dropdown-menu-trigger"');
  });
  it("shows the shared Cloud report and exports after PHIF expiry without implying a device-only copy", () => {
    const c = cacheClient(), scope = itemsAnalyticsScope(session);
    c.setQueryData(["phif_orders", scope], saved());
    c.setQueryData(["phif_orders_access", scope], (previous: any) => ({ ...previous, cloudReady: true, cloudSnapshot: saved() }));
    const html = renderToStaticMarkup(<QueryClientProvider client={c}><OrdersPage /></QueryClientProvider>);
    expect(html).toContain("نسخة مشتركة محفوظة في Cloud");
    expect(html).toContain("انتهت جلسة PHIF، البيانات المعروضة من آخر مزامنة");
    expect(html).toContain("00123");
    expect(html).not.toContain('type="button" disabled="" data-slot="dropdown-menu-trigger"');
  });
  it("roundtrips a genuine Arabic RTL Excel workbook with text batches and numeric quantities and dates", async () => {
    const data = ordersFixture();
    const workbook = await buildOrdersWorkbook(data, defaultOrdersFilters);
    const bytes = await workbook.xlsx.writeBuffer();
    const ExcelJS = await import("exceljs"); const parsed = new ExcelJS.Workbook(); await parsed.xlsx.load(bytes);
    expect(parsed.worksheets).toHaveLength(2);
    const sheet = parsed.getWorksheet("أصناف الطلبات")!;
    expect(sheet.rowCount).toBe(5);
    expect(sheet.getCell("E2").value).toBe("00123");
    expect(sheet.getCell("F2").value).toBe(10);
    expect(sheet.getCell("B2").value).toBeInstanceOf(Date);
    expect(sheet.views[0]).toMatchObject({ rightToLeft: true, ySplit: 1 });
    expect(sheet.autoFilter).toBeDefined();
    expect(sheet.getColumn("F").values).toContain("غير موثقة");
    expect(ordersExportRows(data, defaultOrdersFilters, true)).toHaveLength(3);
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

describe("order periods, approval tabs and linked statistics", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  const month = { ...defaultOrdersFilters, ...ordersPeriodFilters("this_month", now) };
  it("separates pending supplier approval and review from all approved receipt states", () => {
    const report = ordersFixture();
    report.orders[0].lines.push({ ...report.orders[0].lines[0], id: "review", status: "review" });
    const before = JSON.stringify(report);
    expect(ordersView(report, defaultOrdersFilters).rows.map(row => row.status)).toEqual(["waiting", "waiting", "waiting", "received"]);
    expect(ordersView(report, { ...defaultOrdersFilters, tab: "not_approved" }).rows.map(row => row.status)).toEqual(["not_approved"]);
    expect(ordersView(report, { ...defaultOrdersFilters, tab: "review" }).rows.map(row => row.status)).toEqual(["review"]);
    expect(JSON.stringify(report)).toBe(before);
  });
  it("builds explicit Libya-calendar month ranges including year rollover and leap years", () => {
    expect(ordersPeriodFilters("this_month", now)).toEqual({ period: "this_month", dateFrom: "2026-10-01", dateTo: "2026-10-31" });
    expect(ordersPeriodFilters("previous_month", now)).toEqual({ period: "previous_month", dateFrom: "2026-09-01", dateTo: "2026-09-30" });
    expect(ordersPeriodFilters("previous_month", Date.parse("2026-01-15"))).toMatchObject({ dateFrom: "2025-12-01", dateTo: "2025-12-31" });
    expect(ordersPeriodFilters("previous_month", Date.parse("2024-03-15"))).toMatchObject({ dateFrom: "2024-02-01", dateTo: "2024-02-29" });
    expect(ordersPeriodFilters("this_month", Date.parse("2026-09-30T22:30:00Z"))).toMatchObject({ dateFrom: "2026-10-01" });
    expect(ordersPeriodFilters("all", now)).toMatchObject({ dateFrom: "", dateTo: "" });
  });
  it("uses creation dates inclusively in Libya, not the read, approval or receipt date", () => {
    const report = ordersFixture(), original = report.orders[0];
    report.orders = [
      { ...original, id: "start", createdAt: "2026-09-30T22:00:00Z" },
      { ...original, id: "end", createdAt: "2026-10-31T21:59:59Z" },
      { ...original, id: "next", createdAt: "2026-10-31T22:00:00Z" },
      { ...original, id: "missing", createdAt: null },
    ];
    expect(ordersView(report, month).orders.map(order => order.id)).toEqual(["start", "end"]);
    expect(ordersView(report, month).undatedOrders).toBe(1);
    expect(ordersView(report, defaultOrdersFilters).orderCount).toBe(4);
    expect(ordersView(report, { ...month, ...ordersPeriodFilters("previous_month", now) }).orderCount).toBe(0);
    const day = { ...month, period: "custom" as const, dateFrom: "2026-10-01", dateTo: "2026-10-01" };
    expect(ordersView(report, day).orders.map(order => order.id)).toEqual(["start"]);
  });
  it("counts orders including empty ones and keeps period statistics stable when selecting a card or tab", () => {
    const report = ordersFixture();
    report.orders.push({ ...report.orders[0], id: "empty", number: "EMPTY", lines: [] });
    const scoped = ordersView(report, month);
    expect(scoped.orderCount).toBe(2);
    expect(scoped.counts).toEqual({ waiting: 2, received: 1, not_approved: 1, review: 0 });
    for (const statistic of ["orders", "received", "waiting", "not_approved", "review"] as const) {
      const filters = { ...month, ...ordersStatisticFilters(statistic) }, view = ordersView(report, filters);
      expect(view.counts).toEqual(scoped.counts);
      expect(view.orderCount).toBe(2);
      if (statistic !== "orders") expect(view.rows.every(row => row.status === statistic)).toBe(true);
      else expect(view.orders.map(order => order.id)).toContain("empty");
    }
  });
  it("combines date, supplier, number/drug/batch search and keeps unknown quantities distinct from zero", () => {
    const report = ordersFixture();
    report.orders[0].lines.push({ ...report.orders[0].lines[0], id: "zero", approvedQuantity: 0 });
    const selected = { ...month, supplier: "شركة ثانية", query: "00123" };
    const view = ordersView(report, selected);
    expect(view.orderCount).toBe(1);
    expect(view.counts.waiting).toBe(1);
    expect(view.rows[0].approvedQuantity).toBeNull();
    expect(view.orders[0].counts.waiting).toBe(1);
    expect(ordersView(report, { ...selected, query: "ORD_242_266_10326" }).rows).toHaveLength(1);
    expect(ordersView(report, { ...selected, query: "unknown" }).orderCount).toBe(0);
    expect(ordersView(report, month).counts.waiting).toBe(2);
  });
  it("rejects incomplete, reversed and invalid custom dates instead of silently exporting all history", async () => {
    for (const bounds of [{ dateFrom: "", dateTo: "" }, { dateFrom: "2026-10-25", dateTo: "2026-10-01" },
      { dateFrom: "2026-02-30", dateTo: "2026-03-01" }]) {
      const filters = { ...defaultOrdersFilters, period: "custom" as const, ...bounds };
      const view = ordersView(ordersFixture(), filters);
      expect(view.periodError).toBeTruthy(); expect(view.orderCount).toBe(0); expect(view.rows).toHaveLength(0);
      await expect(buildOrdersWorkbook(ordersFixture(), filters)).rejects.toThrow();
      await expect(buildOrdersPdf(ordersFixture(), filters, { regular: "unused", bold: "unused" })).rejects.toThrow();
    }
  });
  it("renders interactive statistic buttons, period controls and an isolated approval tab without a new fetch", () => {
    const c = cacheClient(), report = ordersFixture();
    report.orders[0].lines[2].medicine = "ONLY_PENDING_APPROVAL";
    c.setQueryData(["phif_orders", itemsAnalyticsScope(session)], saved(report));
    const html = renderToStaticMarkup(<QueryClientProvider client={c}><OrdersPage /></QueryClientProvider>);
    expect(html).toContain("الفترة حسب تاريخ إنشاء الطلب");
    expect(html).toContain("عدد الطلبات");
    expect(html).toContain('aria-label="مجموعات متابعة الطلبات"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain("ONLY_PENDING_APPROVAL");
    expect(html).toContain("وليس تاريخ الموافقة أو الاستلام");
    expect(html).not.toContain("جارٍ قراءة الطلبات وتفاصيلها");
  });
  it("exports the same selected period, tab, supplier and statistics to genuine Excel", async () => {
    const report = ordersFixture();
    const filters = { ...month, ...ordersStatisticFilters("not_approved") };
    const workbook = await buildOrdersWorkbook(report, filters);
    const ExcelJS = await import("exceljs"), parsed = new ExcelJS.Workbook();
    await parsed.xlsx.load(await workbook.xlsx.writeBuffer());
    const sheet = parsed.getWorksheet("أصناف الطلبات")!;
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getCell("A2").value).toBe("ORD_242_266_10326");
    expect(sheet.getCell("G2").value).toBe("بانتظار موافقة المورد");
    expect(sheet.getCell("F2").value).toBe("غير موثقة");
    const summary: any[] = [];
    parsed.getWorksheet("الملخص")!.eachRow(row => summary.push([row.getCell(1).value, row.getCell(2).value]));
    expect(summary).toContainEqual(["عدد الطلبات ضمن الفترة والبحث والمورد", 1]);
    expect(summary).toContainEqual(["الفترة", ordersPeriodLabel(filters)]);
    expect(ordersPeriodLabel(filters)).toContain("2026-10-01 - 2026-10-31");
    expect(ordersExportRows(report, filters, true)).toHaveLength(1);
    expect(ordersExportRows(report, { ...month, status: "received" }, true)).toHaveLength(0);
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
  it("preserves an explicit normalized receipt date but never substitutes order updated_at or a first observation timestamp", async () => {
    vi.stubEnv("PHIF_BRIDGE_SECRET", "test-secret");
    const source = db({ bridge_session_id: "private-session", expires_at: "2099-01-01T00:00:00Z" });
    const report: any = ordersFixture();
    report.orders[0].updated_at = "2026-10-20T12:00:00Z";
    report.orders[0].lines[1].firstObservedAt = "2026-10-20T12:00:00Z";
    const fetcher = async () => Response.json({ ok: true, ...report });
    const missing = await readPhifOrders(source.database, "tiryaq", fetcher);
    expect(missing.orders[0].lines[1].receivedAt).toBeNull();
    report.orders[0].lines[1].receivedAt = "2026-10-18T12:00:00Z";
    const explicit = await readPhifOrders(source.database, "tiryaq", fetcher);
    expect(explicit.orders[0].lines[1].receivedAt).toBe("2026-10-18T12:00:00Z");
    expect(JSON.stringify(explicit)).not.toMatch(/updated_at|firstObservedAt/);
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
