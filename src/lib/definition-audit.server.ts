import { createHash, randomUUID } from "node:crypto";
import { emptyAuditSnapshot } from "./definition-audit.helpers";
import { createStreamingAudit } from "./definition-audit.streaming";
import type { AuditFinding } from "./definition-audit.helpers";
import { auditFailureMessages, classifyAuditFailure, type AuditFailureCode } from "./definition-audit-errors";
import { createAuditItemsDiagnostics, type AuditItemsDiagnostics } from "./definition-audit-diagnostics.server";

export async function requireDefinitionAuditAdmin(db: any, context: any) {
  const actor = context.session.data;
  if (!process.env.SESSION_SECRET || !actor.user_id || actor.user_role !== "admin" || !context.pharmacy_id)
    throw new Error("التدقيق الشامل يتطلب جلسة مدير موثقة");
  const { data, error } = await db.from("pharmacy_users").select("id")
    .eq("id", actor.user_id).eq("pharmacy_id", context.pharmacy_id).eq("role", "admin").eq("is_active", true).maybeSingle();
  if (error || !data) throw new Error("لا تملك صلاحية تدقيق هذه الصيدلية");
}

const sources = {
  invoices: ["phif_invoices", "id,pharmacy_id,invoice_number,dispensing_date"],
  items: ["phif_invoice_items", "id,phif_invoice_id,brand,active_ingredient,strength,quantity,source_classification,metadata,phif_financial_fields,phif_invoices!inner(pharmacy_id)"],
  settings: ["phif_report_box_settings", "id,pharmacy_id,item_identity,units_per_box,base_unit,version,supplier_quantity_unit,supplier_unit_exceptions"],
  stocks: ["phif_stock_items", "id,pharmacy_id,source_stock_id,brand_product_id,brand_name,active_ingredient,strength,dosage_unit,package_quantity,strips_quantity,is_current,cost_price,sale_price,source_quantity_unit"],
  links: ["phif_actual_stock_links", "id,pharmacy_id,version,phif_invoice_item_id,source_signature,source_identity,is_active,source:phif_invoice_items!phif_invoice_item_id(id,phif_invoice_id,brand,active_ingredient,strength,source_classification,metadata,phif_invoices!inner(pharmacy_id)),target:phif_stock_items!target_stock_item_id(id,pharmacy_id,source_stock_id,brand_product_id,brand_name,active_ingredient,strength,dosage_unit,package_quantity,strips_quantity)"],
  decisions: ["phif_actual_unit_decisions", "*"],
  references: ["prescription_items", "id,pharmacy_id,medication_id,medications(active_ingredient,strength_value,strength_unit,strength_denominator_value,strength_denominator_unit,dosage_form)"],
} as const;
export type AuditSource = keyof typeof sources;
// Leave headroom for the report engine's indexes and the Worker runtime.
const SNAPSHOT_BYTE_BUDGET = 12 * 1024 * 1024;
const FINDING_LIMIT = 100;
const EVIDENCE_LIMIT = 5;
export function summarizeAuditFindings(findings: AuditFinding[]) {
  return findings.slice(0, FINDING_LIMIT).map(f => ({ ...f,
    itemCount: f.itemIds.length, invoiceCount: f.invoices.length, recordCount: f.records.length,
    itemIds: f.itemIds.slice(0, EVIDENCE_LIMIT), invoices: f.invoices.slice(0, EVIDENCE_LIMIT),
    records: f.records.slice(0, EVIDENCE_LIMIT), evidenceTruncated: f.itemIds.length > EVIDENCE_LIMIT || f.invoices.length > EVIDENCE_LIMIT || f.records.length > EVIDENCE_LIMIT }));
}
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;

async function readSource(db: any, pharmacyId: string, source: AuditSource, retain: boolean, budget: { bytes: number }, visit?: (rows: any[]) => void, diagnostics?: AuditItemsDiagnostics) {
  const [table, fields] = sources[source];
  const rows: any[] = [];
  const seen = new Set<string>();
  const hash = createHash("sha256");
  let expected: number | null = null;
  let from = 0;
  let pageNumber = 0;
  for (;;) {
    diagnostics?.queryStarted(++pageNumber, from);
    const page = await db.from(table).select(fields, { count: "exact" })
      .eq(source === "items" ? "phif_invoices.pharmacy_id" : "pharmacy_id", pharmacyId)
      .order("id").range(from, from + 499);
    diagnostics?.queryFinished(Array.isArray(page.data) ? page.data.length : null, !!page.error);
    if (page.error) throw Object.assign(new Error("تعذر تحميل بيانات التقرير كاملة"), {
      databaseCode: /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(String(page.error.code || "")) ? String(page.error.code) : undefined,
    });
    if (typeof page.count !== "number") throw new Error("Missing completeness count");
    const total = page.count;
    if (expected !== null && expected !== total) throw new Error("تغيرت بيانات التقرير أثناء القراءة؛ أعد المحاولة");
    expected = total;
    const data = page.data || [];
    if (!data.length) {
      if (from < total) throw new Error("بيانات التقرير غير مكتملة");
      diagnostics?.recordsChecked();
      break;
    }
    for (const row of data) {
      if (!row.id || seen.has(row.id)) throw new Error("تغير ترتيب بيانات التقرير؛ أعد المحاولة");
      if ((source === "items" ? row.phif_invoices?.pharmacy_id : row.pharmacy_id) !== pharmacyId
        || (source === "links" && row.target && row.target.pharmacy_id !== pharmacyId)
        || (source === "links" && row.source && row.source.phif_invoices?.pharmacy_id !== pharmacyId)) throw new Error("scope");
      seen.add(row.id);
      const serialized = JSON.stringify(canonical(row));
      hash.update(serialized).update("\n");
      if (retain) {
        budget.bytes += Buffer.byteLength(serialized, "utf8");
        if (budget.bytes > SNAPSHOT_BYTE_BUDGET) throw new Error("budget");
      }
      if (retain) rows.push(row);
    }
    diagnostics?.recordsChecked();
    diagnostics?.evidenceStarted();
    visit?.(data);
    diagnostics?.evidenceFinished();
    from += data.length;
    if (from > total) throw new Error("تغيرت بيانات التقرير أثناء القراءة؛ أعد المحاولة");
    if (from >= total) break;
  }
  return { rows, count: from, digest: hash.digest("hex") };
}

export async function readDefinitionSnapshot(db: any, pharmacyId: string, retain = true) {
  const snapshot = retain ? emptyAuditSnapshot() : null;
  const budget = { bytes: 0 };
  const manifest: { source: AuditSource; count: number; status: "read" | "failed"; reason?: string; digest?: string }[] = [];
  for (const source of Object.keys(sources) as AuditSource[]) {
    try {
      const result = await readSource(db, pharmacyId, source, retain, budget);
      if (snapshot) snapshot[source] = result.rows;
      manifest.push({ source, count: result.count, status: "read", digest: result.digest });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const reason = message === "budget" ? "تجاوز حجم البيانات ميزانية الذاكرة؛ الفحص غير مكتمل"
        : message === "scope" ? "فشل عزل الصيدلية؛ حُجبت البيانات"
        : message === "Missing completeness count" ? "عدد السجلات المتوقع غير متاح"
          : message.includes("ترتيب") ? "معرف مفقود أو مكرر بين الصفحات؛ الفحص غير مكتمل"
            : message.includes("تغيرت") ? "تغير عدد السجلات أثناء القراءة"
              : message.includes("غير مكتملة") ? "انتهت الصفحات قبل اكتمال العدد المتوقع"
                : "تعذر تحميل المصدر؛ لم يُعتبر خاليًا من المشكلات";
      manifest.push({ source, count: 0, status: "failed", reason });
    }
  }
  return { snapshot, manifest };
}

export async function runDefinitionAudit(db: any, pharmacyId: string, requestSignal?: AbortSignal) {
  const startedAt = new Date().toISOString();
  const runId = randomUUID();
  let stage = "support_read";
  let failure: { code: AuditFailureCode; stage: string; reference: string } | undefined;
  // Correlation and phase timings only; never log rows, identities, tokens or raw database errors.
  const log = (event: string, details: Record<string, string | number> = {}) => {
    console.info("definition_audit", { runId, event, stage, elapsedMs: Date.now() - Date.parse(startedAt), ...details });
  };
  const fail = (error: unknown, source?: AuditSource) => {
    const code = classifyAuditFailure(error);
    failure ||= { code, stage, reference: runId };
    const databaseCode = error && typeof error === "object" && "databaseCode" in error ? error.databaseCode : undefined;
    log("failed", { code, ...(source ? { source } : {}), ...(typeof databaseCode === "string" ? { databaseCode } : {}) });
    return auditFailureMessages[code];
  };
  log("started");
  const support = emptyAuditSnapshot();
  const budget = { bytes: 0 };
  type Read = { count: number; digest?: string; reason?: string };
  const before = new Map<AuditSource, Read>(), after = new Map<AuditSource, Read>();
  const read = async (source: AuditSource, retain: boolean, destination: Map<AuditSource, Read>, visit?: (rows: any[]) => void, diagnostics?: AuditItemsDiagnostics) => {
    const readStarted = Date.now();
    log("reading", { source });
    try {
      const result = await readSource(db, pharmacyId, source, retain, budget, visit, diagnostics);
      if (retain) support[source] = result.rows;
      destination.set(source, result);
      log("read", { source, count: result.count, durationMs: Date.now() - readStarted });
    } catch (error) {
      diagnostics?.failed(error);
      destination.set(source, { count: 0, reason: fail(error, source) });
    }
  };
  const supporting = (Object.keys(sources) as AuditSource[]).filter(s => s !== "items");
  for (const source of supporting) await read(source, true, before);
  let result: ReturnType<ReturnType<typeof createStreamingAudit>["finish"]> | undefined;
  try {
    if (![...before.values()].some(r => r.reason)) {
      stage = "initialize";
      log("processing");
      const audit = createStreamingAudit(support, pharmacyId);
      stage = "identity_evidence";
      const diagnostics = createAuditItemsDiagnostics(runId, startedAt, requestSignal);
      try {
        await read("items", false, before, rows => audit.addEvidence(rows), diagnostics);
        diagnostics?.finished(!before.get("items")?.reason);
      } finally { diagnostics?.dispose(); }
      if (!before.get("items")?.reason) {
        stage = "inspect_items";
        await read("items", false, after, rows => audit.inspectBatch(rows));
        stage = "verify_sources";
        for (const source of supporting) await read(source, false, after);
        if (![...after.values()].some(r => r.reason)) {
          stage = "finalize";
          log("processing");
          result = audit.finish();
        }
      }
    }
  } catch (error) {
    fail(error);
  }
  const manifest = (Object.keys(sources) as AuditSource[]).map(source => {
    const first = before.get(source), second = after.get(source);
    const reason = first?.reason || second?.reason || (!first || !second ? "لم تكتمل قراءتا التحقق" : first.digest !== second.digest ? "تغير محتوى السجلات بين القراءتين" : null);
    return { source, count: first?.count || 0, verificationCount: second?.count || 0, reason,
      status: !first || !second || first.reason || second.reason ? "failed" : first.digest !== second.digest ? "changed" : "observed_stable" };
  });
  const complete = manifest.every(m => m.status === "observed_stable") && !!result && !result.orphanItems;
  log("finished", { coverage: complete ? "observed_stable" : "incomplete" });
  return { runId, schemaVersion: 1, ruleVersion: "definitions-2", pharmacyId, startedAt, finishedAt: new Date().toISOString(),
    ...(failure ? { failure } : {}),
    evidenceFingerprint: complete ? createHash("sha256").update(JSON.stringify([...before].map(([s, r]) => [s, r.digest]))).digest("hex") : null,
    coverage: complete ? "observed_stable" as const : "incomplete" as const,
    consistency: "unverified_snapshot" as const, previousRun: null,
    notice: "قراءة كاملة مرتين لكشف التغيّر، وليست لقطة ذرّية. قائمة الأدلة مختصرة؛ توافق SQL المنشور غير متحقق.",
    manifest, counts: { invoices: before.get("invoices")?.count || 0, items: before.get("items")?.count || 0, definitions: support.settings.length,
      errors: complete ? result!.errors : 0, reviews: complete ? result!.reviews : 0,
      unverified: (complete ? result!.unverified : 0) + 1 + manifest.filter(m => m.status !== "observed_stable").length + Number(!!result?.orphanItems) },
    findingsTotal: complete ? result!.findingsTotal : 0, findingsTruncated: complete ? result!.findingsTruncated : false,
    findings: complete ? result!.findings : [] };
}
