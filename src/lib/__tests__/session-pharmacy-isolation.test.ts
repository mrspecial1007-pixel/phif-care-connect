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

  it("does not accept client-controlled pharmacy ids for communication logs", () => {
    const source = readProjectFile("src/lib/activity.functions.ts");
    const phoneSheet = readProjectFile("src/components/PhoneSheet.tsx");

    expect(source).not.toContain("pharmacyId: z.string().uuid()");
    expect(source).not.toContain("data.pharmacyId");
    expect(source).toContain("requirePharmacySession");
    expect(source).toContain("pharmacy_id: sessionPharmacyId");
    expect(phoneSheet).not.toContain("pharmacyId:");
  });
});
