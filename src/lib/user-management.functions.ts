import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { ALL_TIRYAQ_PERMISSIONS, adminPermissions, normalizePermissions, TIRYAQ_PERMISSIONS, type TiryaqPermission } from "@/lib/user-permissions";

const TIRYAQ_PHARMACY_NAME = "صيدلية الترياق الشافي";

const userInput = z.object({
  display_name: z.string().trim().min(1).max(120),
  login_identifier: z.string().trim().min(3).max(160),
  role: z.enum(["admin", "employee"]).default("employee"),
  permissions: z.record(z.boolean()).default({}),
});

const updateUserInput = userInput.extend({
  id: z.string().uuid(),
  is_active: z.boolean(),
});

const idInput = z.object({ id: z.string().uuid() });

function temporaryPassword() {
  return randomBytes(15).toString("base64url");
}

async function context() {
  const { requirePharmacySession, hashPin } = await import("@/lib/pharmacy-session.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const session = await requirePharmacySession();
  return { ...session, db: supabaseAdmin, hashPin };
}

async function writeUserOperation(db: any, input: { pharmacy_id: string; user_id?: string | null; action: string; entity: string; entity_id?: string | null; metadata?: Record<string, unknown> }) {
  try {
    await db.from("user_operation_log").insert({
      pharmacy_id: input.pharmacy_id,
      user_id: input.user_id ?? null,
      action: input.action,
      entity: input.entity,
      entity_id: input.entity_id ?? null,
      metadata: input.metadata ?? {},
    });
  } catch {
    // Operation logging is best-effort and must never expose secrets.
  }
}

export async function requireTiryaqPermission(permission: TiryaqPermission) {
  const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
  const { hasPermission } = await import("@/lib/user-permissions");
  const session = await requirePharmacySession();
  if (session.pharmacy_name !== TIRYAQ_PHARMACY_NAME) throw new Error("Unauthorized");
  if (!session.session.data.user_id && !session.session.data.user_role) return session;
  if (!hasPermission(session.session.data.user_role, session.session.data.user_permissions, permission)) {
    throw new Error("Forbidden");
  }
  return session;
}

async function requireUserManagement() {
  return requireTiryaqPermission("users_manage");
}

export const listTiryaqPermissions = createServerFn({ method: "GET" }).handler(async () => {
  await requireTiryaqPermission("users_manage");
  return TIRYAQ_PERMISSIONS;
});

export const listPharmacyUsers = createServerFn({ method: "GET" }).handler(async () => {
  const { pharmacy_id, db } = await context();
  await requireUserManagement();
  const { data, error } = await db
    .from("pharmacy_users")
    .select("id, display_name, login_identifier, role, permissions, is_active, created_at, last_login_at")
    .eq("pharmacy_id", pharmacy_id)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => ({
    ...row,
    permissions: row.role === "admin" ? adminPermissions() : normalizePermissions(row.permissions),
  }));
});

export const createPharmacyUser = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => userInput.parse(d))
  .handler(async ({ data }) => {
    const { pharmacy_id, db, hashPin, session } = await context();
    await requireUserManagement();
    const password = temporaryPassword();
    const payload = {
      pharmacy_id,
      display_name: data.display_name,
      login_identifier: data.login_identifier.trim().toLowerCase(),
      password_hash: hashPin(password),
      role: data.role,
      permissions: data.role === "admin" ? adminPermissions() : normalizePermissions(data.permissions),
      is_active: true,
    };
    const { data: inserted, error } = await db
      .from("pharmacy_users")
      .insert(payload)
      .select("id, display_name, login_identifier, role, permissions, is_active, created_at, last_login_at")
      .single();
    if (error) throw new Error(error.message);
    await writeUserOperation(db, {
      pharmacy_id,
      user_id: session.data.user_id ?? null,
      action: "create_user",
      entity: "pharmacy_user",
      entity_id: inserted.id,
      metadata: { role: inserted.role },
    });
    return { user: inserted, temporary_password: password };
  });

export const updatePharmacyUser = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => updateUserInput.parse(d))
  .handler(async ({ data }) => {
    const { pharmacy_id, db, session } = await context();
    await requireUserManagement();
    const payload = {
      display_name: data.display_name,
      login_identifier: data.login_identifier.trim().toLowerCase(),
      role: data.role,
      permissions: data.role === "admin" ? adminPermissions() : normalizePermissions(data.permissions),
      is_active: data.is_active,
      updated_at: new Date().toISOString(),
    };
    const { data: updated, error } = await db
      .from("pharmacy_users")
      .update(payload)
      .eq("id", data.id)
      .eq("pharmacy_id", pharmacy_id)
      .select("id, display_name, login_identifier, role, permissions, is_active, created_at, last_login_at")
      .single();
    if (error) throw new Error(error.message);
    await writeUserOperation(db, {
      pharmacy_id,
      user_id: session.data.user_id ?? null,
      action: "update_user",
      entity: "pharmacy_user",
      entity_id: updated.id,
      metadata: { role: updated.role, is_active: updated.is_active },
    });
    return updated;
  });

export const resetPharmacyUserPassword = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data }) => {
    const { pharmacy_id, db, hashPin, session } = await context();
    await requireUserManagement();
    const password = temporaryPassword();
    const { data: updated, error } = await db
      .from("pharmacy_users")
      .update({ password_hash: hashPin(password), updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("pharmacy_id", pharmacy_id)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await writeUserOperation(db, {
      pharmacy_id,
      user_id: session.data.user_id ?? null,
      action: "reset_user_password",
      entity: "pharmacy_user",
      entity_id: updated.id,
    });
    return { temporary_password: password };
  });
