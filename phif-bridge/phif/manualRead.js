/** One manually requested stock/orders read per pharmacy, including across sessions. */
export async function exclusiveManualRead(res, pharmacyId, operations, read, timeoutMs = 115000) {
  if (operations.has(pharmacyId)) {
    res.writeHead(409, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: false, error: "A PHIF read is already running for this pharmacy" }));
    return;
  }
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(); };
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  operations.set(pharmacyId, controller);
  res.once("close", abort);
  try { return await read(controller.signal); }
  finally { clearTimeout(timer); res.off("close", abort); operations.delete(pharmacyId); }
}
