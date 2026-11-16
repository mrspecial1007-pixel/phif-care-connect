const running = new Set<string>();

export async function runAuthorizedDefinitionAudit(
  getSession: () => Promise<any>,
  db: any,
  authorize: (db: any, context: any) => Promise<void>,
  run: (db: any, pharmacyId: string) => Promise<any>,
) {
  const context = await getSession();
  await authorize(db, context);
  if (running.has(context.pharmacy_id)) throw new Error("يوجد فحص قيد التشغيل لهذه الصيدلية");
  running.add(context.pharmacy_id);
  try {
    const result = await run(db, context.pharmacy_id);
    const current = await getSession();
    if (current.pharmacy_id !== context.pharmacy_id || current.session.data.user_id !== context.session.data.user_id)
      throw new Error("تغيرت الجلسة أثناء الفحص");
    await authorize(db, current);
    return result;
  } finally { running.delete(context.pharmacy_id); }
}
