import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PhifAnalyticsPage } from "@/components/analytics/PhifAnalyticsPage";

const data = vi.hoisted(() => ({ report: {} as any }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: any) => ({ data: { months: [{ ...data.report, status: data.report.status || "success", month: options.queryKey.at(-1) }] }, isLoading: false }) }));
vi.mock("@/lib/queries", () => ({ useSession: () => ({ data: { unlocked: true, pharmacy: { id: "tiryaq", name: "الترياق الشافي" }, user: { id: "admin" } } }) }));
vi.mock("@/lib/items-analytics.functions", () => ({ getPhifAnalyticsPeriod: vi.fn(), exportPhifAnalytics: vi.fn() }));
vi.mock("@/components/management/ReportBackLink", () => ({ ReportBackLink: () => null }));

beforeEach(() => {
  data.report = { canExport: false, movements: [{ id: "a", identity: JSON.stringify(["metformin", "500mg", "tablet"]),
    ingredient: "Metformin", strength: "500MG", form: "tablet", brand: "Brand", invoiceId: "invoice",
    date: "2026-09-12", source: "phif", boxes: null, unit: "tablet", baseUnit: "tablet", boxSize: 30,
    card: null, beneficiariesAvailable: false }] };
});
describe("Analytics view completeness and permissions", () => {
  it("does not present a failed selected month as zero dispensing or zero generic medicines", () => {
    data.report = { status: "error", message: "failed month" };
    const html = renderToStaticMarkup(<PhifAnalyticsPage />);
    expect(html).toContain("بيانات الشهر غير متاحة");
    expect(html).not.toContain("0 بند صرف");
    expect(html).not.toContain("0 مادة");
    expect(html).toContain("المقارنة الشهرية");
  });
  it("renders unknown totals and hidden beneficiaries explicitly, keeps rows and disables export", () => {
    const html = renderToStaticMarkup(<PhifAnalyticsPage />);
    expect(html).toContain("غير محدد"); expect(html).toContain("غير متاح");
    expect(html).toContain("1 بند صرف"); expect(html).toContain("Metformin");
    expect(html).toContain("الترتيب غير متاح");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?تصدير Excel<\/button>/);
    expect(html).toContain("var(--chart-1)"); expect(html).toContain("var(--chart-2)");
  });
  it("marks unresolved scientific identities without hiding their rows", () => {
    data.report.movements[0].identity = JSON.stringify(["metformin", "500mg", "", "unresolved", "a"]);
    const html = renderToStaticMarkup(<PhifAnalyticsPage />);
    expect(html).toContain("1 هوية تحتاج مراجعة"); expect(html).toContain("Metformin");
  });
  it("displays confirmed zero instead of an unknown-quantity warning", () => {
    data.report.movements[0].boxes = 0; data.report.movements[0].card = "000123";
    data.report.movements[0].beneficiariesAvailable = true;
    const html = renderToStaticMarkup(<PhifAnalyticsPage />);
    expect(html).not.toContain("غير محدد"); expect(html).not.toContain("غير متاح");
    expect(html).toContain("حالة العبوات: مكتمل");
  });
});
