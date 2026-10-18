export type MedicationFollowUp = {
  patient_id: string;
  medication_identity_key: string;
  is_stopped: boolean;
  reason: string | null;
  stopped_at: string | null;
  baseline_invoice_ids: string[];
};

export const FOLLOW_UP_MIGRATION_MESSAGE = "ميزة إيقاف متابعة الصنف تحتاج تطبيق migration متابعة الأدوية في Lovable Cloud أولًا.";

/** Callers must first authorize the patient IDs against the session pharmacy. */
export async function loadMedicationFollowUps(db: any, pharmacyId: string, patientIds: string[]) {
  const rows: MedicationFollowUp[] = [];
  const ids = [...new Set(patientIds)];
  for (let index = 0; index < ids.length; index += 100) {
    let from = 0;
    for (;;) {
      const { data, error } = await db.from("phif_medication_follow_ups")
        .select("patient_id, medication_identity_key, is_stopped, reason, stopped_at, baseline_invoice_ids")
        .eq("pharmacy_id", pharmacyId)
        .in("patient_id", ids.slice(index, index + 100))
        .order("patient_id", { ascending: true })
        .order("medication_identity_key", { ascending: true })
        .range(from, from + 999);
      if (error) {
        if ((error.code === "42P01" || error.code === "PGRST205") && String(error.message).includes("phif_medication_follow_ups")) {
          return { rows: [] as MedicationFollowUp[], available: false };
        }
        throw new Error("تعذر تحميل حالات متابعة الأدوية. حاول مجددًا.");
      }
      const page = data ?? [];
      rows.push(...page);
      if (!page.length) break;
      from += page.length;
    }
  }
  return { rows, available: true };
}

export function medicationFollowUpState(identityKey: string, invoiceIds: string[], followUps: MedicationFollowUp[]) {
  const state = followUps.find((row) => row.medication_identity_key === identityKey);
  const stopped = state?.is_stopped === true;
  const known = new Set(state?.baseline_invoice_ids ?? []);
  return {
    follow_up_status: stopped ? "stopped" as const : "active" as const,
    stopped_reason: state?.reason ?? null,
    stopped_at: state?.stopped_at ?? null,
    new_dispensing_while_stopped: stopped && invoiceIds.some((id) => !known.has(id)),
  };
}
