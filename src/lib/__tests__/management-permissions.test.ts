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
    expect(management).toContain("source_classification === \"phif-supplier\"");
    expect(management).toContain("actual_value");
    expect(management).toContain("phif_value");
    expect(treasury).toContain("لا تعرض رصيدًا نقديًا فعليًا");
  });
});
