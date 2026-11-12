import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ItemIdentityReviewAction, ItemsAnalyticsPage } from "@/components/management/ItemsAnalyticsViews";
import { analyticsSearchSchema } from "../items-analytics.helpers";
import { itemsAnalyticsScope } from "../items-analytics-cache.helpers";
import { reportReviewRequest } from "../report-identity-review.helpers";
import { itemReportReturn, openItemIdentityReview, reportItemAnchor, reportReviewTarget, restoreItemReportPosition } from "../report-review-navigation.helpers";
import { refreshReportAfterSettingSave } from "../report-setting-save.helpers";

const mocks = vi.hoisted(() => ({ filters: {} as any, state: {} as any, session: {} as any,
  navigate: vi.fn(), saveBox: vi.fn(), saveUnit: vi.fn(), read: vi.fn(), mutations: [] as any[] }));
vi.mock("@tanstack/react-router", () => ({ useSearch: () => mocks.filters,
  useNavigate: () => mocks.navigate, useLocation: () => mocks.state }));
vi.mock("@/lib/queries", () => ({ useSession: () => ({ data: mocks.session, error: null }) }));
vi.mock("@/lib/items-analytics.functions", () => ({ getItemsAnalytics: mocks.read,
  saveReportBoxSetting: mocks.saveBox, saveReportSupplierUnit: mocks.saveUnit }));
vi.mock("@/components/management/ReportBackLink", () => ({ ReportBackLink: () => null }));
vi.mock("@/components/ui/sheet", () => {
  const Wrap = ({ children }: any) => <div>{children}</div>;
  return { Sheet: Wrap, SheetContent: Wrap, SheetHeader: Wrap, SheetTitle: Wrap, SheetDescription: Wrap };
});
vi.mock("@tanstack/react-query", async original => {
  const actual = await original<any>();
  return { ...actual, useMutation: (options: any) => {
    mocks.mutations.push(options);
    return { isPending: false, error: null, mutate: vi.fn() };
  } };
});
const id = '["amlodipine + valsartan","10mg/160mg","tablet"]';
const unresolved = '["amlodipine + valsartan","10mg/160mg","","unresolved","invoice-item-id"]';
const filters = analyticsSearchSchema.parse({ month: "2026-10", source: "phif", q: "Amlodipine", sort: "sale_desc" });
const manager = { unlocked: true, pharmacy: { id: "tiryaq" }, user: { id: "admin", role: "admin", permissions: {} } };
const scope = itemsAnalyticsScope(manager)!;
const returnState = { scope, filters, identityId: id, scrollY: 1700, cardTop: 150, limit: 120 };
const setting = { id: "existing-definition", item_identity: id, version: 7, base_unit: "tablet", units_per_box: 30,
  supplier_quantity_unit: "tablet", supplier_unit_exceptions: {} };
const item = { id, ingredient: "Amlodipine + Valsartan", strength: "10MG/160MG", form: "tablet",
  identityComplete: true, latestSale: null, sources: ["phif"], setting, cost: 24, profit: 66 };
const report = () => ({ items: [structuredClone(item)], reviewItems: [], canManageBoxes: true,
  settingsAvailable: true, supplierUnitsAvailable: true,
  historyMovements: [{ id: "invoice-item-id", identity: id, source: "phif", invoiceId: "invoice", invoiceNumber: "1525611",
    date: "2026-10-01", quantity: 30, unit: "tablet", units: 30, unitProvenance: "source" }],
});
const clients: QueryClient[] = [];
function setup(data = report()) {
  mocks.filters = filters; mocks.state = { itemReportReturn: returnState }; mocks.session = manager;
  mocks.mutations.length = 0; mocks.navigate.mockReset(); mocks.saveBox.mockReset(); mocks.saveUnit.mockReset();
  const client = new QueryClient(); clients.push(client);
  const key = ["items_analytics", scope, "consumption", { ...filters, source: "all" }];
  client.setQueryData(key, data);
  const render = () => renderToStaticMarkup(<QueryClientProvider client={client}><ItemsAnalyticsPage reviewIdentityId={id} /></QueryClientProvider>);
  return { client, key, render };
}
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); });

describe("exact item identity review navigation", () => {
  it("shows an explicit review action for no Supplier sale, including a fully documented unit; zero-price sales are not missing", () => {
    const onReview = vi.fn();
    const action = ItemIdentityReviewAction({ item, onReview })!;
    expect(renderToStaticMarkup(action)).toContain("مراجعة الهوية");
    action.props.onClick();
    expect(onReview).toHaveBeenCalledWith(item);
    expect(ItemIdentityReviewAction({ item: { ...item, latestSale: { price: 0 } }, onReview })).toBeNull();
    expect(ItemIdentityReviewAction({ item: { ...item, latestSale: { price: 1.1 } }, onReview })).toBeNull();
  });
  it("roundtrips a slash/plus-containing identity as a route parameter, with every original report filter and return state", async () => {
    const { createRootRoute, createRoute, createRouter, createMemoryHistory } = await vi.importActual<any>("@tanstack/react-router");
    const root = createRootRoute();
    const parent = createRoute({ getParentRoute: () => root, path: "/management/reports/items", validateSearch: (value: any) => analyticsSearchSchema.parse(value) });
    const child = createRoute({ getParentRoute: () => parent, path: "identity-review/$identityId" });
    const router = createRouter({ routeTree: root.addChildren([parent.addChildren([child])]), history: createMemoryHistory({ initialEntries: ["/"] }) });
    const location = router.buildLocation({ to: "/management/reports/items/identity-review/$identityId", params: { identityId: id },
      search: filters, state: { itemReportReturn: returnState } });
    expect(decodeURIComponent(location.pathname.slice(location.pathname.lastIndexOf("identity-review/") + 16))).toBe(id);
    expect(location.search).toEqual(filters);
    expect(location.state.itemReportReturn).toEqual(returnState);
  });
  it("preserves the originating history entry for native Back before opening the exact review target", async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    await openItemIdentityReview(navigate, returnState);
    expect(navigate).toHaveBeenNthCalledWith(1, { to: "/management/reports/items", search: filters,
      state: { itemReportReturn: returnState }, replace: true, resetScroll: false });
    expect(navigate).toHaveBeenNthCalledWith(2, { to: "/management/reports/items/identity-review/$identityId", params: { identityId: id },
      search: filters, state: { itemReportReturn: returnState } });
  });
  it("resolves by exact identity, and follows an exact historical item after its unresolved identity was completed", () => {
    const data = report(), before = JSON.stringify(data);
    expect(reportReviewTarget(data, id)).toBe(data.items[0]);
    expect(reportReviewTarget(data, unresolved)).toBe(data.items[0]);
    expect(reportReviewTarget(data, unresolved.replace("10mg/160mg", "5mg/160mg"))).toBeNull();
    expect(reportReviewTarget(data, unresolved.replace("invoice-item-id", "different-item"))).toBeNull();
    expect(reportReviewTarget(data, "Amlodipine + Valsartan")).toBeNull();
    expect(JSON.stringify(data)).toBe(before);
  });
  it("opens the saved definition and current unit directly, without reclassifying a missing price as an incomplete identity", () => {
    const { render } = setup();
    const html = render();
    expect(html).toContain("مراجعة هوية الأصناف");
    expect(html).toContain("إعدادات علبة ووحدة PHIF Supplier");
    expect(html).toContain('value="30"');
    expect(html).toContain('value="tablet" selected');
    expect(html).toContain("حفظ توثيق الوحدة");
    expect(html).toContain("الرجوع إلى الصنف في التقرير");
    expect(html).not.toContain('aria-label="الشكل الدوائي"');
    expect(html).not.toContain("جارٍ تحميل تعريف الصنف");
  });
  it("saves only the existing setting using its version, then invalidates the report before returning with filters and position", async () => {
    const data = report(), before = JSON.stringify(data), { client, render } = setup(data);
    const originalKey = ["items_analytics", scope, "consumption", filters];
    client.setQueryData(originalKey, { marker: "original-report" });
    mocks.saveBox.mockResolvedValue({ ...setting, version: 8, units_per_box: 30 });
    render();
    const mutation = mocks.mutations[0];
    const saved = await mutation.mutationFn();
    expect(mocks.saveBox).toHaveBeenCalledWith({ data: { identity: id, unitsPerBox: 30, baseUnit: "tablet", version: 7 } });
    expect(mocks.navigate).not.toHaveBeenCalled();
    mocks.navigate.mockImplementation(() => { expect(client.getQueryState(originalKey)?.isInvalidated).toBe(true); });
    mutation.onSuccess(saved);
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
    expect(mocks.navigate.mock.calls[0][0]).toMatchObject({ to: "/management/reports/items", search: filters,
      resetScroll: false, state: { itemReportReturn: returnState } });
    expect(JSON.stringify(data)).toBe(before);
    expect(client.getQueryData(originalKey)).toEqual({ marker: "original-report" });
  });
  it("uses the same documented Supplier unit and existing version when saving its documentation", async () => {
    const { render } = setup();
    mocks.saveUnit.mockResolvedValue({ ...setting, version: 8 });
    render();
    await mocks.mutations[1].mutationFn();
    expect(mocks.saveUnit).toHaveBeenCalledWith({ data: { identity: id, unit: "tablet", exceptions: [], version: 7 } });
  });
  it("does not return or invalidate results after a failed save, and preserves server version conflicts", async () => {
    const { render, client, key } = setup();
    mocks.saveBox.mockRejectedValue(new Error("version conflict"));
    render();
    await expect(mocks.mutations[0].mutationFn()).rejects.toThrow("version conflict");
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });
  it("reuses an existing target setting even in an unresolved review request, rather than issuing version zero", () => {
    expect(reportReviewRequest({ id: unresolved, setting }, "tablet", "30", "tablet", "invoice-item-id"))
      .toMatchObject({ identity: id, version: 7, reviewItemId: "invoice-item-id" });
  });
  it("does not open an editor for an employee, a conflicting setting, or an identity absent from the authorized report", () => {
    for (const patch of [{ canManageBoxes: false }, { items: [{ ...item, settingConflict: true }] }, { items: [] }]) {
      const { render } = setup({ ...report(), ...patch });
      const html = render();
      expect(html).not.toContain("حفظ توثيق الوحدة");
      expect(mocks.mutations).toHaveLength(0);
    }
  });
  it("keeps return positions pharmacy/user/filter scoped and restores the card offset and fractional scroll safely", () => {
    expect(itemReportReturn(returnState, scope, filters)).toEqual(returnState);
    expect(itemReportReturn(returnState, "andalus", filters)).toBeNull();
    expect(itemReportReturn(returnState, scope, { ...filters, month: "all" })).toBeNull();
    expect(itemReportReturn({ ...returnState, limit: Infinity }, scope, filters)).toBeNull();
    const scroll = vi.fn();
    restoreItemReportPosition(returnState, { getBoundingClientRect: () => ({ top: 350.5 }) }, 1700, scroll);
    expect(scroll).toHaveBeenLastCalledWith(1900.5);
    restoreItemReportPosition(returnState, null, 0, scroll);
    expect(scroll).toHaveBeenLastCalledWith(1700);
    expect(reportItemAnchor(id)).not.toContain("/");
  });
  it("does not wait for a report refetch before allowing return, and leaves other pharmacies untouched", async () => {
    const { client, key } = setup();
    const other = ["items_analytics", "another-pharmacy"];
    client.setQueryData(other, { private: "other" });
    let finish!: () => void;
    const refetch = vi.spyOn(client, "refetchQueries").mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const returned = vi.fn(), error = vi.fn();
    refreshReportAfterSettingSave(client, key, error, returned);
    await vi.waitFor(() => expect(returned).toHaveBeenCalledTimes(1));
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    expect(refetch).toHaveBeenCalledTimes(1);
    finish();
  });
});
