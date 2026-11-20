import { classifyAuditFailure } from "./definition-audit-errors";

type CompletedStep = "query_finished" | "records_checked" | "evidence_finished";

function abortKind(reason: unknown): string {
  try {
    if (reason && typeof reason === "object" && "name" in reason) {
      if (reason.name === "TimeoutError") return "timeout";
      if (reason.name === "AbortError") {
        return "message" in reason && reason.message === "The client has disconnected" ? "client_disconnected" : "abort";
      }
    }
    return reason == null ? "unavailable" : "unspecified";
  } catch { return "unavailable"; }
}

/** Server-only, expiring observation. No rows, headers or raw errors enter the log. */
export function createAuditItemsDiagnostics(runId: string, startedAt: string, signal?: AbortSignal) {
  const value = process.env.PHIF_AUDIT_ITEMS_DIAGNOSTICS_UNTIL || "";
  const until = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ? Date.parse(value) : NaN;
  if (!Number.isFinite(until) || until <= Date.now()) return undefined;

  let page = 0, offset = 0;
  let itemCount: number | null = null;
  let step = "phase_started", stepStarted = Date.now();
  let lastCompleted: { page: number; step: CompletedStep } | null = null;
  let disposed = false;
  const emit = (event: string, details: { durationMs?: number; queryError?: boolean; errorKind?: string; abortReason?: string; outcome?: string } = {}) => {
    if (disposed || Date.now() >= until) return;
    try {
      console.info("definition_audit_items", {
        runId, stage: "identity_evidence", source: "items", event,
        page, offset, itemCount, step, lastCompleted,
        elapsedMs: Math.max(0, Date.now() - Date.parse(startedAt)), requestAborted: signal?.aborted ?? false,
        ...details,
      });
    } catch { /* Diagnostics must never change the scan outcome. */ }
  };
  const complete = (event: CompletedStep, details: { queryError?: boolean } = {}) => {
    const durationMs = Math.max(0, Date.now() - stepStarted);
    lastCompleted = { page, step: event };
    step = event;
    emit(event, { durationMs, ...details });
    stepStarted = Date.now();
  };
  const onAbort = () => emit("request_aborted", { abortReason: abortKind(signal?.reason), durationMs: Math.max(0, Date.now() - stepStarted) });
  emit("phase_started");
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  return {
    queryStarted(pageNumber: number, from: number) {
      page = pageNumber; offset = from; itemCount = null;
      step = "query_started"; stepStarted = Date.now();
      emit(step);
    },
    queryFinished(count: number | null, queryError: boolean) {
      itemCount = count;
      complete("query_finished", { queryError });
      if (!queryError) step = "checking_records";
    },
    recordsChecked() { complete("records_checked"); },
    evidenceStarted() { step = "evidence_started"; stepStarted = Date.now(); emit(step); },
    evidenceFinished() { complete("evidence_finished"); },
    failed(error: unknown) { emit("page_failed", { errorKind: classifyAuditFailure(error), durationMs: Math.max(0, Date.now() - stepStarted) }); },
    finished(ok: boolean) { emit("phase_finished", { outcome: ok ? "completed" : "failed" }); },
    dispose() {
      disposed = true;
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

export type AuditItemsDiagnostics = ReturnType<typeof createAuditItemsDiagnostics>;
