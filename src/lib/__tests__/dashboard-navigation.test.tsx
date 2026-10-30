import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { canReturnToDashboard, dashboardScope, defaultDashboardView, readDashboardView, saveDashboardView } from "../dashboard-navigation.helpers";
import { PreparationTotal } from "@/components/PhifPreparationList";

vi.mock("@/components/DashboardNavigation", () => ({ PatientProfileLink: () => null }));
const session = (pharmacy = "tiryaq", user = "manager") => ({ unlocked: true, pharmacy: { id: pharmacy }, user: { id: user, role: "admin" } });
const scope = dashboardScope(session());
const storage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};
describe("dashboard restoration is scoped to a history entry", () => {
  it("restores filters, dates, searches, expanded medicine and both scroll positions without changing the defaults", () => {
    const value = { ...defaultDashboardView("2026-10-30"), filter: "preparation" as const, q: "00123", preparationMode: "range" as const,
      preparationFrom: "2026-10-01", preparationTo: "2026-10-31", scrollY: 730,
      preparationList: { open: true, query: "ACETYL", selectedKey: '["acetylsalicylicacid","75mg","tablet"]', listScrollTop: 150, detailScrollTop: 280 } };
    const tab = storage(); saveDashboardView(scope, "return-entry", value, tab);
    expect(readDashboardView(scope, "return-entry", "2026-11-01", tab)).toEqual(value);
    expect(readDashboardView(scope, "new-entry", "2026-11-01", tab)).toEqual(defaultDashboardView("2026-11-01"));
  });
  it("keeps every dashboard filter and the search during patient visits", () => {
    for (const filter of ["all", "active", "favorite", "overdue", "no_phone", "suspended"] as const) {
      const value = { ...defaultDashboardView("2026-10-30"), filter, q: "patient", scrollY: 123 };
      saveDashboardView(scope, `filter-${filter}`, value);
      expect(readDashboardView(scope, `filter-${filter}`, "2026-10-30")).toEqual(value);
    }
  });
  it("does not reuse a different pharmacy or user's UI state", () => {
    saveDashboardView(scope, "isolated", { ...defaultDashboardView("2026-10-30"), q: "00123" });
    expect(readDashboardView(dashboardScope(session("andalus")), "isolated", "2026-10-30").q).toBe("");
    expect(readDashboardView(dashboardScope(session("tiryaq", "employee")), "isolated", "2026-10-30").q).toBe("");
  });
  it("validates persisted positions and survives denied tab storage", () => {
    const denied = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => {} };
    const value = { ...defaultDashboardView("2026-10-30"), q: "preserved" };
    saveDashboardView(scope, "denied", value, denied);
    expect(readDashboardView(scope, "denied", "2026-10-30", denied)).toEqual(value);
    saveDashboardView(scope, "invalid", { ...value, scrollY: -1 });
    expect(readDashboardView(scope, "invalid", "2026-10-30").q).toBe("");
  });
  it("uses browser Back only for the matching patient, scope and immediately preceding dashboard visit", () => {
    const origin = { scope, entry: "origin", index: 2, patientId: "patient" };
    expect(canReturnToDashboard(origin, scope, "patient", 3)).toBe(true);
    expect(canReturnToDashboard(origin, scope, "another", 3)).toBe(false);
    expect(canReturnToDashboard(origin, "another-scope", "patient", 3)).toBe(false);
    expect(canReturnToDashboard(origin, scope, "patient", 5)).toBe(false);
    expect(canReturnToDashboard(null, scope, "patient", 3)).toBe(false);
  });
  it("renders the number and estimated description separately, keeping incomplete and unknown labels", () => {
    const html = renderToStaticMarkup(<PreparationTotal summary={{ boxes: 2, knownBoxes: 2, knownItemCount: 1 }} />);
    expect(html).toContain("<bdi>2</bdi>"); expect(html).toContain("تقديري من آخر صرف");
    const partial = renderToStaticMarkup(<PreparationTotal summary={{ boxes: null, knownBoxes: 1.5, knownItemCount: 1 }} />);
    expect(partial).toContain("الإجمالي غير مكتمل");
    expect(renderToStaticMarkup(<PreparationTotal summary={{ boxes: null, knownBoxes: 0, knownItemCount: 0 }} />)).toContain("يحتاج تحديد");
  });
});
