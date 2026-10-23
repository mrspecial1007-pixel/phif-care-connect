import { readReportPages } from "./report-pages.server";

/** Only medication references actually used by this pharmacy; no patient fields. */
export async function readReportFormReferences(db: any, pharmacyId: string) {
  const rows = await readReportPages(() =>
    db
      .from("prescription_items")
      .select(
        "id,medications(active_ingredient,strength_value,strength_unit,strength_denominator_value,strength_denominator_unit,dosage_form)",
        { count: "exact" },
      )
      .eq("pharmacy_id", pharmacyId)
      .not("medication_id", "is", null)
      .order("id"),
  );
  return rows.flatMap((row: any) => {
    const m = row.medications;
    if (!m) return [];
    return [
      {
        active_ingredient: m.active_ingredient,
        dosage_form: m.dosage_form,
        strength: `${m.strength_value}${m.strength_unit}${m.strength_denominator_value != null && m.strength_denominator_unit ? `/${m.strength_denominator_value}${m.strength_denominator_unit}` : ""}`,
      },
    ];
  });
}
