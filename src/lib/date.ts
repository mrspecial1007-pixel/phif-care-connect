const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar-day difference without UTC parsing or daylight-saving drift. */
export function daysUntilDate(dateString: string | null | undefined): number | null {
  if (!dateString) return null;

  const [year, month, day] = dateString.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;

  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const dueUtc = Date.UTC(year, month - 1, day);

  return Math.round((dueUtc - todayUtc) / DAY_MS);
}