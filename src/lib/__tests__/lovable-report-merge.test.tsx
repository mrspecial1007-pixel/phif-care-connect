import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ItemsAnalyticsPage } from "@/components/management/ItemsAnalyticsViews";
import { analyticsSearchSchema } from "../items-analytics.helpers";
import { itemsAnalyticsScope } from "../items-analytics-cache.helpers";
import { reportItemAnchor } from "../report-review-navigation.helpers";
import { selectAnalyticsRows } from "../items-analytics-export";

const filters = analyticsSearchSchema.parse({ month: "2026-10", sort: "consumption_desc" });
const session = { unlocked: true, pharmacy: { id: "test-pharmacy" }, user: { id: "manager", role: "admin", permissions: {} } };
vi.mock("@/lib/queries", () => ({ useSession: () => ({ data: session }) }));
vi.mock("@tanstack/react-router", () => ({ useSearch: () => filters, useNavigate: () => vi.fn(), useLocation: () => ({}) }));
vi.mock("@/components/management/ReportBackLink", () => ({ ReportBackLink: () => null }));
const clients: QueryClient[] = [];
afterEach(() => clients.splice(0).forEach(client => client.clear()));

describe("Lovable consumption design with preserved local identity review", () => {
  it("keeps the new design, sorting and export alongside exact identity anchors and the review action", () => {
    const items = [{ id: '["atorvastatin","10mg","tablet"]', ingredient: "ATORVASTATIN", strength: "10MG", form: "tablet",
      identityComplete: true, boxes: 2, actualBoxes: 1, phifBoxes: 1, beneficiaries: 3, units: 60, latestSale: null },
    { id: '["atorvastatin","20mg","tablet"]', ingredient: "ATORVASTATIN", strength: "20MG", form: "tablet",
      identityComplete: true, boxes: 8, actualBoxes: 2, phifBoxes: 6, beneficiaries: 5, units: 240, latestSale: null }];
    const data = { items, reviewItems: [], historyMovements: [], movements: [], canExport: true, settingsAvailable: true,
      canManageBoxes: true, supplierUnitsAvailable: true, summary: { actualBoxes: 3, phifBoxes: 7, boxes: 10, beneficiaries: 8 } };
    const before = JSON.stringify(data), client = new QueryClient(); clients.push(client);
    client.setQueryData(["items_analytics", itemsAnalyticsScope(session), "consumption", filters], data);
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><ItemsAnalyticsPage /></QueryClientProvider>);
    expect(html).toContain('aria-label="ترتيب الاستهلاك"'); expect(html).toContain("الفلاتر");
    expect(html).toContain('aria-label="تصدير Excel"'); expect(html).toContain("shadow-none");
    expect(html).toContain("مراجعة الهوية"); expect(html).toContain(`id="${reportItemAnchor(items[1].id)}"`);
    expect(html.indexOf(reportItemAnchor(items[1].id))).toBeLessThan(html.indexOf(reportItemAnchor(items[0].id)));
    expect(selectAnalyticsRows(data, "consumption", filters).map(i => i.id)).toEqual([items[1].id, items[0].id]);
    expect(JSON.stringify(data)).toBe(before);
  });
});
