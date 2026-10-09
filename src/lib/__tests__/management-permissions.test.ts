import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adminPermissions, hasPermission, normalizePermissions } from "@/lib/user-permissions";

function readProjectFile(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Tiryaq management and permissions", () => {
  it("adds server-only pharmacy user and operation log tables without default passwords", () => {
    const migration = readProjectFile("supabase/migrations/20260927010000_add_tiryaq_users_permissions.sql");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.pharmacy_users");
    expect(migration).toContain("password_hash text NOT NULL");
    expect(migration).toContain("permissions jsonb NOT NULL");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.user_operation_log");
    expect(migration).toContain("REVOKE ALL ON public.pharmacy_users FROM anon, authenticated");
    expect(migration).toContain("REVOKE ALL ON public.user_operation_log FROM anon, authenticated");
    expect(migration).not.toMatch(/1235|6456|temporary_password/i);
  });

  it("lets managers set employee PINs server-side without returning or logging plaintext PINs", () => {
    const users = readProjectFile("src/lib/user-management.functions.ts");
    const route = readProjectFile("src/routes/settings.users.tsx");

    expect(users).toContain("pinFields");
    expect(users).toContain("/^\\d{4,8}$/");
    expect(users).toContain("pin === data.pin_confirm");
    expect(users).toContain("password_hash: hashPin(data.pin)");
    expect(users).toContain("requireTiryaqPermission(\"users_manage\")");
    expect(users).toContain("return { user: inserted }");
    expect(users).toContain("return { ok: true }");
    expect(users).not.toContain("temporaryPassword");
    expect(users).not.toContain("temporary_password");
    expect(users).not.toContain("metadata: { pin");

    expect(route).toContain("الرقم السري");
    expect(route).toContain("تأكيد الرقم السري");
    expect(route).toContain("إعادة تعيين الرقم السري");
    expect(route).toContain("resetFn({ data: input })");
    expect(route).not.toContain("temporaryPassword");
    expect(route).not.toContain("navigator.clipboard");
  });

  it("treats admins as all-permission users and employees as explicit permissions only", () => {
    expect(hasPermission("admin", {}, "users_manage")).toBe(true);
    expect(hasPermission("employee", { reports_read: true }, "reports_read")).toBe(true);
    expect(hasPermission("employee", { reports_read: true }, "treasury_read")).toBe(false);
    expect(adminPermissions().phif_sync_run).toBe(true);
    expect(normalizePermissions({ reports_read: true, unknown: true }).reports_read).toBe(true);
    expect(normalizePermissions({}).dispensing_write).toBe(false);
  });

  it("keeps PHIF sync and completion guarded by separate server permissions", () => {
    const source = readProjectFile("src/lib/phif-sync.functions.ts");
    expect(source).toContain('requireTiryaqPermission("phif_sync_run")');
    expect(source).toContain('requireTiryaqPermission("phif_completion_run")');
  });

  it("exposes actual settings and management routes without dead links", () => {
    const settings = readProjectFile("src/routes/settings.tsx");
    const phifSettings = readProjectFile("src/routes/settings.phif.tsx");
    const management = readProjectFile("src/routes/management.tsx");
    const appShell = readProjectFile("src/components/AppShell.tsx");
    const routeTree = readProjectFile("src/routeTree.gen.ts");

    expect(routeTree).toContain("'/settings/phif'");
    expect(routeTree).toContain("'/settings/users'");
    expect(routeTree).toContain("'/management'");
    expect(routeTree).toContain("'/management/reports'");
    expect(routeTree).toContain("'/management/treasury'");
    expect(routeTree).toContain("'/phif-invoices'");
    expect(settings).toContain("return <Outlet />");
    expect(settings).toContain('to="/settings/phif"');
    expect(settings).toContain('to="/settings/users"');
    expect(settings).toContain('to="/management"');
    expect(settings).not.toContain('to="/management/reports"');
    expect(settings).not.toContain('to="/management/treasury"');
    expect(settings).not.toContain('to="/phif-invoices"');
    expect(settings).not.toContain('title="مزامنة PHIF"');
    expect(phifSettings).toContain('to: "/phif-invoices"');
    expect(phifSettings).toContain('to: "/phif-sync"');
    expect(phifSettings).toContain("فواتير PHIF");
    expect(phifSettings).toContain("مزامنة PHIF");
    expect(phifSettings).toContain("استكمال فواتير PHIF");
    expect(management).toContain("التقارير");
    expect(management).toContain("خزينة الصرف");
    expect(management).toContain("مخزون PHIF");
    expect(management).toContain("return <Outlet />");
    expect(management).toContain('to: "/management/reports"');
    expect(management).toContain('to: "/management/treasury"');
    expect(appShell).toContain("isLegacyTiryaq");
    expect(appShell).toContain("isLegacyTiryaq ||");
    expect(appShell).not.toContain('{ to: "/phif-invoices"');
  });

  it("orders patient list by the current display due window and hides older overdue by default", () => {
    const patientRoute = readProjectFile("src/routes/patients.index.tsx");
    const reads = readProjectFile("src/lib/reads.functions.ts");
    expect(patientRoute).toContain("days === -3");
    expect(patientRoute).toContain("days === 3");
    expect(patientRoute).toContain("return r.remaining_days === null || r.remaining_days >= -3");
    expect(reads).toContain("pickDisplayDueTrack");
    expect(reads).toContain("track.remaining_days >= -3");
  });

  it("calculates management finance values from invoice items without treating them as cash", () => {
    const management = readProjectFile("src/lib/management.functions.ts");
    const treasury = readProjectFile("src/routes/management.treasury.tsx");
    expect(management).toContain("phif_invoice_items");
    expect(management).toContain("reportItemSource(item) === \"phif\"");
    expect(management).toContain("actual_value");
    expect(management).toContain("phif_value");
    expect(treasury).toContain("دون إنشاء سجل صرف جديد");
  });

  it("renders treasury as invoice cards backed by the profit analysis dataset", () => {
    const treasury = readProjectFile("src/routes/management.treasury.tsx");
    expect(treasury).toContain("getProfitAnalysisReport");
    expect(treasury).toContain("(data?.invoices ?? []).map");
    expect(treasury).toContain("setSelectedInvoiceId(invoice.invoice_id)");
    expect(treasury).toContain("TreasuryInvoiceSheet");
    expect(treasury).toContain("Actual: {money(invoice.actual_value)}");
    expect(treasury).toContain("savePhifSupplierPurchasePrice");
    expect(treasury).not.toContain("actualProfitFn");
  });

  it("keeps PHIF Supplier purchase price per invoice item and reports invoice-level finance status", () => {
    const management = readProjectFile("src/lib/management.functions.ts");
    const treasury = readProjectFile("src/routes/management.treasury.tsx");
    const reports = readProjectFile("src/components/management/ReportsViews.tsx");
    expect(management).toContain('requireTiryaqPermission("stock_cost_read")');
    expect(management).toContain('.from("phif_invoice_items")');
    expect(management).toContain(".eq(\"id\", data.itemId)");
    expect(management).toContain("internal_purchase_cost_mode: data.purchaseCostMode");
    expect(management).toContain("internal_purchase_cost_value: purchaseValue");
    expect(management).toContain("invoiceFinancialStatus");
    expect(management).toContain("complete_invoice_count");
    expect(management).toContain("needs_price_item_count");
    expect(management).toContain("actual_unmatched_item_count");
    expect(management).toContain("unit_review_item_count");
    expect(treasury).toContain('item.source === "phif"');
    expect(treasury).toContain('item.source === "actual"');
    expect(treasury).toContain("Actual يحتاج مطابقة");
    expect(treasury).not.toContain("غير مدخل");
    expect(reports).toContain("purchasePriceLabel");
    expect(reports).toContain("Actual يحتاج مطابقة");
  });

  it("uses current PHIF stock cost for Actual profit and keeps PHIF Supplier price item-scoped", () => {
    const management = readProjectFile("src/lib/management.functions.ts");
    expect(management).toContain('.from("phif_stock_items")');
    expect(management).toContain('.eq("is_current", true)');
    expect(management).toContain("const margin = calculateActualGrossMargin(item, stocks)");
    expect(management).toContain('unitPurchasePrice: margin.status === "matched" ? reportNumberValue(margin.stock?.cost_price) : null');
    expect(management).toContain("purchaseMode === \"total_dispensed_cost\"");
    expect(management).toContain("override * quantity");
    expect(management).toContain("phif_financial_fields: fields");
  });
});
