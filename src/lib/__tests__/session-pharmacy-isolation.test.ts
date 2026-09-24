import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readProjectFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("session pharmacy isolation", () => {
  it("does not accept client-controlled pharmacy ids for dispensing writes", () => {
    const source = readProjectFile("src/lib/dispensing.functions.ts");

    expect(source).not.toContain("pharmacy_id: z.string().uuid()");
    expect(source).not.toContain("data.pharmacy_id");
    expect(source).toContain("const pharmacy_id = sessionPharmacyId");
    expect(source).toContain('.eq("idempotency_key", data.idempotency_key)');
    expect(source).toContain('.eq("pharmacy_id", sessionPharmacyId)');
  });

  it("limits dispensing update and cancel operations to the session pharmacy", () => {
    const source = readProjectFile("src/lib/dispensing.functions.ts");

    const updateSection = source.slice(source.indexOf("export const updateDispensing"), source.indexOf("export const cancelDispensing"));
    const cancelSection = source.slice(source.indexOf("export const cancelDispensing"), source.indexOf("export const archivePatient"));

    expect(updateSection).toContain('.eq("pharmacy_id", sessionPharmacyId)');
    expect(cancelSection).toContain('.eq("pharmacy_id", sessionPharmacyId)');
  });

  it("guards dispensing creation and patient mutations through session patient authorization", () => {
    const source = readProjectFile("src/lib/dispensing.functions.ts");

    const recordSection = source.slice(source.indexOf("export const recordDispensing"), source.indexOf("const upsertPatientSchema"));
    const upsertSection = source.slice(source.indexOf("export const upsertPatient"), source.indexOf("const importSchema"));
    const followUpSection = source.slice(source.indexOf("export const setFollowUpStatus"));

    expect(recordSection).toContain("authorizePatientForPharmacy(supabaseAdmin, sessionPharmacyId, data.patient_id)");
    expect(upsertSection).toContain("authorizePatientForPharmacy(supabaseAdmin, pharmacy_id, existing.id)");
    expect(upsertSection).toContain("authorizePatientForPharmacy(supabaseAdmin, pharmacy_id, data.id)");
    expect(followUpSection).toContain("authorizePatientForPharmacy(supabaseAdmin, sessionPharmacyId, data.id)");
  });

  it("excludes Tiryaq-history patients from Andalus patient access server-side", () => {
    const isolation = readProjectFile("src/lib/pharmacy-isolation.ts");
    const reads = readProjectFile("src/lib/reads.functions.ts");

    expect(isolation).toContain('ANDALUS_PHARMACY_NAME = "صيدلية الأندلس"');
    expect(isolation).toContain('TIRYAQ_PHARMACY_NAME = "صيدلية الترياق الشافي"');
    expect(isolation).toContain("patientHasTiryaqHistory");
    expect(isolation).toContain("return false");
    expect(isolation).toContain("excluded.add(r.patient_id)");
    expect(reads).toContain("patientAccessSetsForSession");
    expect(reads).toContain("!excluded.has(r.patient_id)");
  });

  it("keeps transaction and activity reads scoped to the session pharmacy", () => {
    const reads = readProjectFile("src/lib/reads.functions.ts");
    const activity = readProjectFile("src/lib/activity.functions.ts");

    expect(reads).toContain("export const listDispensingTransactions");
    expect(reads).toContain('.eq("pharmacy_id", pharmacy_id)');
    expect(activity).toContain("requirePharmacySession");
    expect(activity).toContain('.eq("pharmacy_id", sessionPharmacyId)');
  });

  it("does not accept client-controlled pharmacy ids for communication logs", () => {
    const source = readProjectFile("src/lib/activity.functions.ts");
    const phoneSheet = readProjectFile("src/components/PhoneSheet.tsx");

    expect(source).not.toContain("pharmacyId: z.string().uuid()");
    expect(source).not.toContain("data.pharmacyId");
    expect(source).toContain("requirePharmacySession");
    expect(source).toContain("pharmacy_id: sessionPharmacyId");
    expect(phoneSheet).not.toContain("pharmacyId:");
  });

  it("uses server-side email/password login without exposing pharmacy choices in the UI", () => {
    const unlock = readProjectFile("src/components/UnlockScreen.tsx");
    const auth = readProjectFile("src/lib/auth.functions.ts");
    const unlockSection = auth.slice(auth.indexOf("export const unlockPharmacy"), auth.indexOf("export const lockPharmacy"));

    expect(unlock).not.toContain("usePharmacies()");
    expect(unlock).not.toContain("pharmacies?.map");
    expect(unlock).not.toContain("setPharmacyId");
    expect(unlock).not.toContain("Admin@andalus.com");
    expect(unlock).not.toContain("Admin@tiryaq.com");
    expect(unlock).toContain('type="email"');
    expect(unlock).toContain('type="password"');
    expect(auth).toContain("email: z.string().trim().email()");
    expect(auth).toContain("password: z.string()");
    expect(unlockSection).toContain("data.email.trim().toLowerCase()");
    expect(unlockSection).toContain('.ilike("login_email", email)');
    expect(unlockSection).toContain("verifyPin(data.password, pharm.pin_hash)");
    expect(unlockSection).not.toContain("data.pharmacy_id");
    expect(unlockSection).not.toContain("data.pin");
  });

  it("updates pharmacy PIN hashes through migration without plaintext PIN columns", () => {
    const migration = readProjectFile("supabase/migrations/20260921010000_update_pharmacy_pin_hashes.sql");

    expect(migration).toContain("UPDATE public.pharmacies");
    expect(migration).toContain("WHERE name = 'صيدلية الترياق الشافي'");
    expect(migration).toContain("WHERE name = 'صيدلية الأندلس'");
    expect(migration).toContain("pin_hash = 's1:");
    expect(migration).not.toContain("pin =");
  });

  it("adds login emails through migration without storing plaintext passwords", () => {
    const migration = readProjectFile("supabase/migrations/20260921020000_add_pharmacy_login_email.sql");

    expect(migration).toContain("ADD COLUMN IF NOT EXISTS login_email text");
    expect(migration).toContain("admin@tiryaq.com");
    expect(migration).toContain("admin@andalus.com");
    expect(migration).toContain("lower(login_email)");
    expect(migration).not.toContain("password");
  });

  it("keeps PHIF navigation visible only for Tiryaq sessions", () => {
    const appShell = readProjectFile("src/components/AppShell.tsx");

    expect(appShell).toContain('"/phif-sync"');
    expect(appShell).toContain('"/phif-invoices"');
    expect(appShell).toContain('session?.pharmacy.name === "صيدلية الترياق الشافي"');
    expect(appShell).toContain("visibleNav.map");
    expect(appShell).toContain("visibleNav.slice");
  });
});
