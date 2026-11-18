import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const state = vi.hoisted(() => ({ user: { id: "u", role: "admin" } as any, run: vi.fn() }));
vi.mock("@/lib/queries", () => ({ useSession: () => ({ data: { user: state.user, pharmacy: { id: "own" } } }) }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => state.run }));
vi.mock("../definition-audit.functions", () => ({ runDefinitionAuditReport: () => {}, exportDefinitionAuditReview: () => {} }));
vi.mock("../definition-audit-bulk.functions", () => ({ previewReadySupplierUnits: () => {}, confirmReadySupplierUnit: () => {} }));
import { DefinitionAuditPanel } from "@/components/management/DefinitionAuditPanel";
describe("manual audit UI", () => {
  it("renders an RTL manual start, never executes on mount", () => {
    state.user = { id: "u", role: "admin" };
    const html = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><DefinitionAuditPanel /></QueryClientProvider>);
    expect(html).toContain('dir="rtl"'); expect(html).toContain("بدء فحص شامل");
    expect(html).toContain("جارٍ استعادة نتائج هذا المستخدم والصيدلية"); expect(state.run).not.toHaveBeenCalled();
    expect(html).toContain("مسح النتائج المحفوظة");
    expect(html).toContain("تصدير الأصناف للمراجعة – Excel");
    expect(html).toContain("توثيق جميع الأصناف الجاهزة");
  });
  it.each([null, { id: "u", role: "employee" }, { role: "admin" }])("does not render results for an unverified manager %s", user => {
    state.user = user;
    expect(renderToStaticMarkup(<DefinitionAuditPanel />)).toBe("");
  });
});
