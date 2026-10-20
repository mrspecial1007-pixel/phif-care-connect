// Exhaust a scoped query even when the database caps responses below our page size.
export async function readReportPages(query: () => any) {
  const result: any[] = [], seen = new Set<string>();
  let expected: number | null = null;
  for (let from = 0; ; ) {
    const { data, count, error } = await query().range(from, from + 499);
    if (error) throw new Error("تعذر تحميل بيانات التقرير كاملة");
    if (typeof count === "number") {
      if (expected !== null && expected !== count) throw new Error("تغيرت بيانات التقرير أثناء القراءة؛ أعد المحاولة");
      expected = count;
    }
    const page = data ?? [];
    if (!page.length) {
      if (expected !== null && from < expected) throw new Error("بيانات التقرير غير مكتملة");
      break;
    }
    for (const row of page) {
      if (!row.id || seen.has(row.id)) throw new Error("تغير ترتيب بيانات التقرير؛ أعد المحاولة");
      seen.add(row.id); result.push(row);
    }
    from += page.length;
    if (expected !== null && from >= expected) break;
  }
  return result;
}
