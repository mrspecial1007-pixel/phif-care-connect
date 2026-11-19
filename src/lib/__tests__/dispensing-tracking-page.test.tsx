import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildTrackingReport,
  trackingInput,
  type TrackingMovement,
} from "../dispensing-tracking.model";

const state = vi.hoisted(() => ({ session: {} as any, report: {} as any, filters: {} as any }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: any) => fn }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => state.report }));
vi.mock("@/routes/management.reports.item-tracking", () => ({
  Route: { useSearch: () => state.filters },
}));
vi.mock("@/lib/queries", () => ({ useSession: () => state.session }));
vi.mock("@/lib/dispensing-tracking.functions", () => ({
  readDispensingTracking: vi.fn(),
  exportDispensingTracking: vi.fn(),
}));
vi.mock("@/components/management/ReportBackLink", () => ({ ReportBackLink: () => null }));
vi.mock("recharts", () => ({
  ResponsiveContainer: () => <div data-chart="timeline" />,
  BarChart: () => null,
  Bar: () => null,
  CartesianGrid: () => null,
  Legend: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));
import { ReportsItemTrackingPage } from "@/components/management/DispensingTrackingPage";

beforeEach(() => {
  state.session = {
    data: { unlocked: true, pharmacy: { id: "p1" }, user: { id: "u1", role: "admin" } },
  };
  state.filters = trackingInput.parse({ item: "scientific" });
  const row = {
    id: "line",
    identity: "scientific",
    ingredient: "A very long scientific medicine name",
    strength: "5MG",
    form: "tablet",
    brand: null,
    product: null,
    company: null,
    companyKey: "__unknown__",
    legacyKey: null,
    identityComplete: true,
    invoiceId: "inv",
    invoiceNumber: "0001",
    date: "2026-11-10",
    quantity: 30,
    unit: "tablet",
    quantityIssue: null,
    boxes: null,
    boxIssue: "missing_supplier_box_size",
    source: "phif",
    beneficiariesAvailable: true,
    card: "0001",
    revenue: 60,
    cost: null,
    profit: null,
  } as TrackingMovement;
  state.report = {
    data: {
      ...buildTrackingReport([row], state.filters),
      totalMovements: 1,
      page: 1,
      pageCount: 1,
      hiddenSources: [],
      unclassifiedItems: 0,
      canExport: true,
    },
    isFetching: false,
    isPending: false,
  };
});
describe("existing tracking route presentation", () => {
  it("renders RTL controls, full-history context, original units and unknown boxes without fabricated brand", () => {
    const html = renderToStaticMarkup(<ReportsItemTrackingPage />);
    expect(html).toContain('dir="rtl"');
    for (const label of [
      "الاسم العلمي",
      "الاسم التجاري",
      "PHIF Actual Supplier",
      "كل التاريخ",
      "تصدير Excel",
      "0001",
      "30",
      "قرص",
      "غير محدد / غير متاح",
      "صرف علمي غير منسوب",
      "تفاصيل الصرف",
      "التسلسل الزمني",
    ])
      expect(html).toContain(label);
    expect(html).not.toContain("جارٍ قراءة");
  });
  it("does not expose stale report after session verification failure", () => {
    state.session.error = new Error("expired");
    const html = renderToStaticMarkup(<ReportsItemTrackingPage />);
    expect(html).toContain("تعذر التحقق من الجلسة");
    expect(html).not.toContain("0001");
  });
  it("disables export while fetching or without server permission and displays load failures", () => {
    state.report.data.canExport = false;
    state.report.error = new Error("Incomplete read");
    const html = renderToStaticMarkup(<ReportsItemTrackingPage />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?تصدير Excel/);
    expect(html).toContain("Incomplete read");
  });
});
