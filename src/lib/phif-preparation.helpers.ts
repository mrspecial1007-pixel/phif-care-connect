export type PhifPreparationSummary = {
  itemCount: number;
  dueDates: { date: string; itemCount: number }[];
};

type PreparationPatient = {
  patient_id: string;
  is_archived?: boolean;
  is_follow_up_suspended?: boolean;
  phif_due_summaries?: { next_due_date: string; item_count: number }[] | null;
};

function validDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date;
}

export function validPreparationRange(from: string, to: string) {
  return validDate(from) && validDate(to) && from <= to;
}

/** Input summaries are authorized server reads of active PHIF medications only. */
export function buildPhifPreparationIndex(rows: readonly PreparationPatient[], from: string, to: string) {
  const result = new Map<string, PhifPreparationSummary>();
  if (!validPreparationRange(from, to)) return result;
  const datesByPatient = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!row.patient_id || row.is_archived || row.is_follow_up_suspended) continue;
    const dates = datesByPatient.get(row.patient_id) ?? new Map<string, number>();
    for (const due of row.phif_due_summaries ?? []) {
      if (!validDate(due.next_due_date) || due.next_due_date < from || due.next_due_date > to) continue;
      if (!Number.isInteger(due.item_count) || due.item_count <= 0) continue;
      // Repeated rows/summaries must not double-count the same patient/date.
      dates.set(due.next_due_date, Math.max(dates.get(due.next_due_date) ?? 0, due.item_count));
    }
    if (dates.size) datesByPatient.set(row.patient_id, dates);
  }
  for (const [id, dates] of datesByPatient) {
    const dueDates = [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, itemCount]) => ({ date, itemCount }));
    result.set(id, { itemCount: dueDates.reduce((sum, due) => sum + due.itemCount, 0), dueDates });
  }
  return result;
}
