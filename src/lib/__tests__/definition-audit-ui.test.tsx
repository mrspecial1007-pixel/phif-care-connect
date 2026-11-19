import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const state = vi.hoisted(() => ({ user: { id: "u", role: "admin" } as any, run: vi.fn(), audit: null as any, options: null as any }));
vi.mock("@tanstack/react-query", async importOriginal => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return { ...actual, useMutation: (options: any) => {
    if (options.gcTime !== 0) return actual.useMutation(options);
    state.options = options;
    return { mutate: vi.fn(), mutateAsync: vi.fn(), reset: vi.fn(), ...state.audit };
  } };
});
vi.mock("@/lib/queries", () => ({ useSession: () => ({ data: { user: state.user, pharmacy: { id: "own" } } }) }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => state.run }));
vi.mock("../definition-audit.functions", () => ({ runDefinitionAuditReport: () => {}, exportDefinitionAuditReview: () => {} }));
vi.mock("../definition-audit-bulk.functions", () => ({ previewReadySupplierUnits: () => {}, confirmReadySupplierUnit: () => {} }));
import { DefinitionAuditPanel } from "@/components/management/DefinitionAuditPanel";
import { definitionAuditStore } from "../definition-audit.local";

afterEach(() => { state.audit = null; state.options = null; vi.restoreAllMocks(); });
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
  it("renders a safe message instead of raw server details and never retries automatically", () => {
    state.user = { id: "u", role: "admin" };
    state.audit = { error: new Error("private Internal server error token"), isError: true };
    const html = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><DefinitionAuditPanel /></QueryClientProvider>);
    expect(html).toContain("لم تُستبدل النتائج المحفوظة");
    expect(html).not.toContain("private");
    expect(html).not.toContain("Internal server error");
    expect(state.options.retry).toBe(false);
    expect(state.run).not.toHaveBeenCalled();
  });
  it("does not persist a processing failure and does not label it a completed scan", async () => {
    state.user = { id: "u", role: "admin" };
    const failed = { coverage: "incomplete", runId: "safe-reference", finishedAt: "2026-11-19T12:00:00Z",
      failure: { code: "processing", reference: "safe-reference", stage: "finalize" }, findings: [], manifest: [],
      counts: { invoices: 1200, items: 1200, definitions: 40, errors: 0, reviews: 0, unverified: 1 } };
    state.audit = { data: failed };
    const save = vi.spyOn(definitionAuditStore, "save");
    const html = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><DefinitionAuditPanel /></QueryClientProvider>);
    expect(html).toContain("safe-reference");
    expect(html).toContain("آخر محاولة غير مكتملة");
    expect(html).not.toContain("آخر فحص مكتمل");
    expect(html).not.toContain("احتُفظ بآخر نتيجة مكتملة");
    await state.options.onSuccess(failed);
    expect(save).not.toHaveBeenCalled();
  });
});
