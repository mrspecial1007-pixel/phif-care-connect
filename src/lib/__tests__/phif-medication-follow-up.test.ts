import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildPhifMedicationProfileFromRows, buildPhifDueSummaries, medicationFollowUpInput } from "@/lib/phif-invoices.functions";
import { phifDueSummariesToTracks, pickDisplayDueTrack, buildPhifHistoryRows } from "@/lib/reads.functions";
import { loadMedicationFollowUps, type MedicationFollowUp } from "@/lib/phif-medication-follow-up";

const invoices = [
  { id: "invoice-a", invoice_key: "key-a", dispensing_date: "2026-09-01" },
  { id: "invoice-b", invoice_key: "key-b", dispensing_date: "2026-10-01" },
];
const items = [
  { id: "a", phif_invoice_id: "invoice-a", phif_item_id: "drug-a", active_ingredient: "Metformin", strength: "500MG", quantity: 30, metadata: { dosage_form: "TAB" } },
  { id: "b", phif_invoice_id: "invoice-b", phif_item_id: "drug-b", active_ingredient: "Amlodipine", strength: "5MG", quantity: 30, metadata: { dosage_form: "TAB" } },
];
const initial = buildPhifMedicationProfileFromRows(invoices, items);
const key = initial.items.find((item) => item.active_ingredient === "Metformin")!.identity_key;
const stop: MedicationFollowUp = {
  patient_id: "patient-a", medication_identity_key: key, is_stopped: true,
  stopped_at: "2026-10-10T10:00:00Z", reason: "Treatment changed", baseline_invoice_ids: ["invoice-a"],
};
const build = (states = [stop], inv = invoices, rows = items) => buildPhifMedicationProfileFromRows(inv, rows, [], states);

describe("per-patient PHIF medication follow-up", () => {
  it("removes stopped medication from all due summaries and retains its complete history", () => {
    const profile = build();
    expect(profile.items).toHaveLength(2);
    expect(profile.nearest_due_date).toBe("2026-10-29");
    expect(profile.nearest_due_items).toEqual(["Amlodipine 5MG"]);
    expect(profile.nearest_due_item_count).toBe(1);
    expect(profile.due_summaries.map((row) => row.next_due_date)).toEqual(["2026-10-29"]);
    expect(pickDisplayDueTrack(phifDueSummariesToTracks(profile.due_summaries))?.next_due_date).toBe("2026-10-29");
    expect(profile.items.find((item) => item.identity_key === key)).toMatchObject({ follow_up_status: "stopped", stopped_at: stop.stopped_at, stopped_reason: stop.reason, new_dispensing_while_stopped: false });
    expect(buildPhifHistoryRows(profile, "tiryaq", "Tiryaq")).toHaveLength(2);
    expect(invoices[0].dispensing_date).toBe("2026-09-01");
  });

  it("has no active due dates when all medications are stopped", () => {
    const states = initial.items.map((item) => ({ ...stop, medication_identity_key: item.identity_key }));
    const profile = build(states);
    expect(profile.items).toHaveLength(2);
    expect(profile.due_summaries).toEqual([]);
    expect(profile.nearest_due_date).toBeNull();
    expect(profile.nearest_due_item_count).toBe(0);
    expect(phifDueSummariesToTracks(profile.due_summaries)).toEqual([]);
  });

  it("excludes stopped items whether their due date is overdue, today or upcoming", () => {
    for (const date of ["2020-01-01", new Date().toISOString().slice(0, 10), "2099-01-01"]) {
      expect(buildPhifDueSummaries([{ next_due_date: date, follow_up_status: "stopped" }])).toEqual([]);
    }
  });

  it("reactivates using the last PHIF dispensing +28 days, never the reactivation date", () => {
    const profile = build([{ ...stop, is_stopped: false }]);
    expect(profile.items.find((item) => item.identity_key === key)).toMatchObject({ follow_up_status: "active", next_due_date: "2026-09-29", new_dispensing_while_stopped: false });
    expect(profile.due_summaries).toHaveLength(2);
  });

  it("warns on new PHIF dispensing without automatic reactivation and survives repeated imports", () => {
    const nextInvoices = [...invoices, { id: "new-invoice", invoice_key: "new-key", dispensing_date: "2026-10-16" }];
    const nextItems = [...items, { ...items[0], id: "new-item", phif_invoice_id: "new-invoice" }];
    for (let i = 0; i < 2; i++) {
      const profile = build([stop], nextInvoices, nextItems);
      const medication = profile.items.find((item) => item.identity_key === key)!;
      expect(medication).toMatchObject({ follow_up_status: "stopped", new_dispensing_while_stopped: true, latest_dispensing_date: "2026-10-16" });
      expect(medication.movements).toHaveLength(2);
      expect(profile.due_summaries).toHaveLength(1);
    }
  });

  it("does not stop other strengths, forms or another patient's medication", () => {
    const profile = build([stop], invoices, [...items, { ...items[0], id: "850", strength: "850MG" }, { ...items[0], id: "syrup", metadata: { dosage_form: "SYRUP" } }]);
    expect(profile.items.filter((item) => item.follow_up_status === "stopped")).toHaveLength(1);
    const otherPatient = build([]);
    expect(otherPatient.items.every((item) => item.follow_up_status === "active")).toBe(true);
    expect(otherPatient.due_summaries).toHaveLength(2);
  });

  it("requires a non-empty stop reason and validates patient and medication inputs", () => {
    const input = { patientId: "00000000-0000-4000-8000-000000000001", identityKey: key, isStopped: true };
    expect(medicationFollowUpInput.safeParse(input).success).toBe(false);
    expect(medicationFollowUpInput.safeParse({ ...input, reason: "   " }).success).toBe(false);
    expect(medicationFollowUpInput.parse({ ...input, reason: " changed " }).reason).toBe("changed");
    expect(medicationFollowUpInput.safeParse({ ...input, isStopped: false }).success).toBe(true);
    expect(medicationFollowUpInput.safeParse({ ...input, reason: "x".repeat(501) }).success).toBe(false);
    expect(medicationFollowUpInput.safeParse({ ...input, patientId: "invalid", reason: "reason" }).success).toBe(false);
  });
});

function database(rows: any[], error?: any) {
  const calls: any[] = [];
  return { calls, from(table: string) {
    expect(table).toBe("phif_medication_follow_ups");
    let filtered = rows;
    const q = {
      select() { return q; },
      eq(field: string, value: string) { calls.push([field, value]); filtered = filtered.filter((row) => row[field] === value); return q; },
      in(field: string, ids: string[]) { filtered = filtered.filter((row) => ids.includes(row[field])); return q; },
      order() { return q; },
      async range(from: number) { return { data: filtered.slice(from, from + 2), error }; },
    };
    return q;
  } };
}

describe("follow-up storage and authorization", () => {
  it("loads only requested patients in the session pharmacy, including all pages", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ ...stop, pharmacy_id: "tiryaq", medication_identity_key: `key${i}` }));
    const db = database([...rows, { ...stop, pharmacy_id: "andalus" }, { ...stop, patient_id: "other", pharmacy_id: "tiryaq" }]);
    expect((await loadMedicationFollowUps(db, "tiryaq", ["patient-a"])).rows).toEqual(rows);
    expect(db.calls).toContainEqual(["pharmacy_id", "tiryaq"]);
  });

  it("handles an unapplied migration explicitly and does not hide other read failures", async () => {
    expect(await loadMedicationFollowUps(database([], { code: "PGRST205", message: "public.phif_medication_follow_ups missing" }), "tiryaq", ["patient-a"])).toEqual({ rows: [], available: false });
    await expect(loadMedicationFollowUps(database([], { code: "42501", message: "permission denied" }), "tiryaq", ["patient-a"])).rejects.toThrow("تعذر تحميل حالات متابعة");
  });

  it("requires Tiryaq write permission and patient access before mutation", () => {
    const source = readFileSync("src/lib/phif-invoices.functions.ts", "utf8");
    const mutation = source.slice(source.indexOf("export const setPatientMedicationFollowUp"));
    expect(mutation).toContain('requireTiryaqPermission("dispensing_write")');
    expect(mutation.indexOf("authorizePatientForSessionPharmacy")).toBeLessThan(mutation.indexOf('db.rpc("set_phif_medication_follow_up"'));
    expect(mutation).toContain("profile.items.find((item) => item.identity_key === data.identityKey)");
    expect(mutation).toContain("p_pharmacy_id: pharmacy_id");
    expect(mutation).not.toContain("data.pharmacy_id");
    expect(mutation).not.toMatch(/\.delete\(|\.insert\(|\.update\(/);
  });

  it("keeps atomic transitions service-only and repeated stop requests preserve the baseline", () => {
    const sql = readFileSync("supabase/migrations/20261018010000_add_phif_medication_follow_ups.sql", "utf8");
    expect(sql).toContain("PRIMARY KEY (pharmacy_id, patient_id, medication_identity_key)");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("WHERE f.is_stopped IS DISTINCT FROM EXCLUDED.is_stopped");
    expect(sql).toContain("reason IS NOT NULL");
    expect(sql).toContain("public.patient_pharmacy_access");
    expect(sql).not.toMatch(/UPDATE public\.(phif_invoices|phif_invoice_items|patients|dispensing_)/i);
  });

  it("exposes separate stopped history, confirmation, errors, and invalidates all due readers after saving", () => {
    const ui = readFileSync("src/routes/patients.$id.tsx", "utf8");
    const controls = readFileSync("src/components/MedicationFollowUpControl.tsx", "utf8");
    expect(ui).toContain("الأدوية الموقوفة");
    expect(ui).toContain("new_dispensing_while_stopped");
    expect(ui).toContain("FOLLOW_UP_MIGRATION_MESSAGE");
    expect(controls).toContain("سبب الإيقاف");
    for (const key of ["patient_status", "patient_due_tracks", "patient_phif_medication_profile"]) expect(controls).toContain(`queryKey: ["${key}"`);
    expect(controls.indexOf("await changeFollowUp")).toBeLessThan(controls.indexOf("toast.success"));
    expect(controls).toContain('role="alert"');
  });
});
