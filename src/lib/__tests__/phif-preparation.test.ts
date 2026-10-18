import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildPhifPreparationIndex, validPreparationRange } from "@/lib/phif-preparation.helpers";
import { buildPhifMedicationProfileFromRows } from "@/lib/phif-invoices.functions";

const invoices = [
  { id: "a", invoice_key: "a", dispensing_date: "2026-09-24" },
  { id: "b", invoice_key: "b", dispensing_date: "2026-10-01" },
];
const item = (id: string, invoice: string, ingredient: string) => ({
  id, phif_invoice_id: invoice, phif_item_id: ingredient, active_ingredient: ingredient,
  strength: "5MG", quantity: 30, metadata: { dosage_form: "TAB" },
});
const items = [item("a", "a", "Medication A"), item("b", "a", "Medication B"), item("c", "b", "Medication C")];
const profile = buildPhifMedicationProfileFromRows(invoices, items);
const patient = { patient_id: "patient-a", phif_due_summaries: profile.due_summaries };

describe("read-only PHIF preparation dates", () => {
  it("shows one patient with the number of medicines due on the chosen day", () => {
    const result = buildPhifPreparationIndex([patient], "2026-10-22", "2026-10-22");
    expect(result.size).toBe(1);
    expect(result.get("patient-a")).toEqual({ itemCount: 2, dueDates: [{ date: "2026-10-22", itemCount: 2 }] });
    expect(buildPhifPreparationIndex([patient], "2026-10-23", "2026-10-23").size).toBe(0);
  });

  it("includes both date boundaries and independent 28-day dispensing groups", () => {
    const result = buildPhifPreparationIndex([patient], "2026-10-22", "2026-10-29");
    expect(result.get("patient-a")).toEqual({ itemCount: 3, dueDates: [
      { date: "2026-10-22", itemCount: 2 }, { date: "2026-10-29", itemCount: 1 },
    ] });
    expect(buildPhifPreparationIndex([patient], "2026-10-23", "2026-10-29").get("patient-a")?.itemCount).toBe(1);
  });

  it("does not count historical due dates after the same medication is dispensed again", () => {
    const repeated = buildPhifMedicationProfileFromRows(invoices, [...items, item("new", "b", "Medication A")]);
    const row = { ...patient, phif_due_summaries: repeated.due_summaries };
    expect(buildPhifPreparationIndex([row], "2026-10-22", "2026-10-22").get("patient-a")?.itemCount).toBe(1);
    expect(buildPhifPreparationIndex([row], "2026-10-29", "2026-10-29").get("patient-a")?.itemCount).toBe(2);
    expect(repeated.items.flatMap((row) => row.movements)).toHaveLength(4);
  });

  it("excludes stopped medications, including new dispensing while stopped, without changing history", () => {
    const medication = profile.items.find((row) => row.active_ingredient === "Medication A")!;
    const stopped = buildPhifMedicationProfileFromRows(invoices, [...items, item("new", "b", "Medication A")], [], [{
      patient_id: patient.patient_id, medication_identity_key: medication.identity_key, is_stopped: true,
      stopped_at: "2026-10-01T00:00:00Z", reason: "Changed", baseline_invoice_ids: ["a"],
    }]);
    const row = { ...patient, phif_due_summaries: stopped.due_summaries };
    expect(buildPhifPreparationIndex([row], "2026-10-22", "2026-10-29").get("patient-a")?.itemCount).toBe(2);
    expect(stopped.items.find((row) => row.identity_key === medication.identity_key)?.new_dispensing_while_stopped).toBe(true);
    expect(stopped.items.flatMap((row) => row.movements)).toHaveLength(4);
    expect(items).toHaveLength(3);
  });

  it("does not duplicate a patient or count units dispensed as medication counts", () => {
    const result = buildPhifPreparationIndex([patient, patient, { ...patient, patient_id: "patient-b" }], "2026-10-22", "2026-10-29");
    expect(result.size).toBe(2);
    expect(result.get("patient-a")?.itemCount).toBe(3);
    expect(result.get("patient-b")?.itemCount).toBe(3);
  });

  it("does not include manual due tracks, archived or suspended patients", () => {
    const result = buildPhifPreparationIndex([
      { patient_id: "manual", phif_due_summaries: [] },
      { patient_id: "missing" },
      { ...patient, patient_id: "archive", is_archived: true },
      { ...patient, patient_id: "suspended", is_follow_up_suspended: true },
      patient,
    ], "2026-10-22", "2026-10-29");
    expect([...result.keys()]).toEqual(["patient-a"]);
  });

  it("validates calendar dates and reversed or incomplete ranges", () => {
    for (const [from, to] of [["", "2026-10-22"], ["2026-10-29", "2026-10-22"], ["2026-02-30", "2026-03-01"], ["2026-2-01", "2026-02-02"]]) {
      expect(validPreparationRange(from, to)).toBe(false);
      expect(buildPhifPreparationIndex([patient], from, to).size).toBe(0);
    }
    expect(validPreparationRange("2028-02-29", "2028-02-29")).toBe(true);
  });

  it("does not cap results at 500 patients or mutate supplied dates", () => {
    const rows = Array.from({ length: 505 }, (_, i) => ({ ...patient, patient_id: String(i) }));
    const before = JSON.stringify(rows);
    expect(buildPhifPreparationIndex(rows, "2026-10-22", "2026-10-29").size).toBe(505);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("keeps active as default and preparation before overdue, only for Tiryaq", () => {
    const route = readFileSync("src/routes/index.tsx", "utf8");
    expect(route).toContain('>("active")');
    expect(route.indexOf('{ k: "preparation", label: "تجهيز" }')).toBeLessThan(route.indexOf('{ k: "overdue", label: "متأخر" }'));
    expect(route).toContain('c.k !== "preparation" || isTiryaq');
    expect(route).toContain('preparationMode === "single" ? preparationFrom : preparationTo');
    expect(route).toContain('grid-cols-1 gap-3 sm:grid-cols-2');
    expect(route).toContain('role="alert"');
    expect(route.indexOf('if (filter === "preparation") return isTiryaq')).toBeLessThan(route.indexOf('if (searching) return true'));
    const card = readFileSync("src/components/PatientCard.tsx", "utf8");
    expect(card).toContain("للتجهيز: {preparation.itemCount} صنف");
    expect(card).toContain("preparation.dueDates.map");
    const helper = readFileSync("src/lib/phif-preparation.helpers.ts", "utf8");
    expect(helper).not.toMatch(/supabase|createServerFn|\.insert\(|\.update\(|\.delete\(/);
  });
});
