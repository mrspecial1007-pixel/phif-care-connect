import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readProjectFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("archived patient visibility", () => {
  it("keeps archived patients available in v_patient_status", () => {
    const sql = readProjectFile("supabase/migrations/20260916010000_include_archived_patients_in_status.sql");

    expect(sql).toContain("COALESCE(p.is_archived, false) AS is_archived");
    expect(sql).not.toContain("WHERE p.is_archived = false");
    expect(sql).not.toContain("WHERE (p.is_archived = false OR p.is_archived IS NULL)");
  });

  it("hides archived patients by default but includes them in search and archived filter", () => {
    const source = readProjectFile("src/routes/patients.index.tsx");

    expect(source).toContain('| "archived"');
    expect(source).toContain('{ k: "archived", label: "المؤرشفون" }');
    expect(source).toContain("if (qd) return true");
    expect(source).toContain('if (filter === "archived") return !!r.is_archived');
    expect(source).toContain("if (r.is_archived) return false");
  });

  it("marks archived cards with a readable archived badge and muted styling", () => {
    const source = readProjectFile("src/components/PatientCard.tsx");

    expect(source).toContain("if (row.is_archived)");
    expect(source).toContain('label: "مؤرشف"');
    expect(source).toContain('row.is_archived ? "opacity-70 bg-muted/40" : ""');
  });

  it("authorizes archive and restore through the current pharmacy session", () => {
    const source = readProjectFile("src/lib/dispensing.functions.ts");

    const archiveSection = source.slice(source.indexOf("export const archivePatient"), source.indexOf("export const restorePatient"));
    const restoreSection = source.slice(source.indexOf("export const restorePatient"), source.indexOf("export const setFollowUpStatus"));

    expect(source).toContain("async function authorizePatientForPharmacy");
    expect(archiveSection).toContain("authorizePatientForPharmacy(supabaseAdmin, sessionPharmacyId, data.id)");
    expect(restoreSection).toContain("authorizePatientForPharmacy(supabaseAdmin, sessionPharmacyId, data.id)");
    expect(restoreSection).toContain("is_archived: false");
    expect(restoreSection).toContain("archived_at: null");
  });

  it("paginates patient status reads so archived search is not capped", () => {
    const source = readProjectFile("src/lib/reads.functions.ts");
    const listSection = source.slice(source.indexOf("export const listPatientStatuses"), source.indexOf("export const getPatient"));

    expect(listSection).toContain('.from("v_patient_status")');
    expect(listSection).toContain(".range(from, from + PAGE - 1)");
    expect(listSection).not.toContain(".limit(5000)");
  });
});
