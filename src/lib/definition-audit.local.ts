import type { runDefinitionAudit } from "./definition-audit.server";

type AuditReport = Awaited<ReturnType<typeof runDefinitionAudit>>;
type AuditFinding = AuditReport["findings"][number];
export type CachedAuditFinding = Omit<AuditFinding, "id" | "identity" | "records" | "itemIds" | "invoices"> & {
  id: string;
  identity: null;
  records: [];
  itemIds: [];
  invoices: [];
  months: string[];
};
export type CachedAuditReport = Omit<AuditReport, "findings" | "pharmacyId" | "evidenceFingerprint" | "runId" | "previousRun"> & {
  findings: CachedAuditFinding[];
  cached: true;
  evidenceFingerprint?: string | null;
};
export type AuditScope = { pharmacyId: string; userId: string };
export type StoredAuditResult = { result: CachedAuditReport; savedAt: string };

type StoredRecord = StoredAuditResult & { id: string; version: 1; pharmacyId: string; userId: string };
const DATABASE = "phif-definition-audit-local-v1";
const STORE = "results";
const MAX_STORAGE_BYTES = 256 * 1024;

function scopeId(scope: AuditScope) {
  if (!scope.pharmacyId || !scope.userId) throw new Error("نطاق التخزين المحلي غير مكتمل");
  return JSON.stringify([scope.pharmacyId, scope.userId]);
}

function safeFinding(finding: AuditFinding, index: number): CachedAuditFinding {
  const invoices = finding.invoices || [];
  return {
    id: `cached-${index}`,
    code: finding.code,
    category: finding.category,
    severity: finding.severity,
    name: finding.name.slice(0, 240),
    reason: finding.reason.slice(0, 600),
    action: finding.action.slice(0, 400),
    source: finding.source.slice(0, 40),
    itemCount: finding.itemCount,
    invoiceCount: finding.invoiceCount,
    recordCount: finding.recordCount,
    evidenceTruncated: finding.evidenceTruncated,
    identity: null,
    records: [],
    itemIds: [],
    invoices: [],
    months: [...new Set((invoices || []).map(invoice => String(invoice.month || "")).filter(Boolean))],
  };
}

function safeReport(report: AuditReport): CachedAuditReport {
  if (report.coverage !== "observed_stable") throw new Error("لا تحفظ نتيجة فحص غير مكتمل");
  const safe: CachedAuditReport = {
    schemaVersion: report.schemaVersion,
    ruleVersion: report.ruleVersion,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    coverage: report.coverage,
    consistency: report.consistency,
    notice: report.notice,
    manifest: report.manifest.map(source => ({
      source: source.source, count: source.count, verificationCount: source.verificationCount,
      reason: source.reason?.slice(0, 300) || null, status: source.status,
    })),
    counts: { ...report.counts },
    findingsTotal: report.findingsTotal,
    findingsTruncated: report.findingsTruncated,
    findings: report.findings.map(safeFinding),
    cached: true,
    evidenceFingerprint: /^[a-f0-9]{64}$/.test(report.evidenceFingerprint || "") ? report.evidenceFingerprint : null,
  };
  if (new TextEncoder().encode(JSON.stringify(safe)).byteLength > MAX_STORAGE_BYTES)
    throw new Error("نتائج التدقيق المختصرة أكبر من مساحة التخزين المحلي المسموحة");
  return safe;
}

function validRecord(value: unknown, scope: AuditScope): value is StoredRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as StoredRecord;
  return record.version === 1 && record.id === scopeId(scope)
    && record.pharmacyId === scope.pharmacyId && record.userId === scope.userId
    && typeof record.savedAt === "string" && !!record.result
    && record.result.cached === true && record.result.coverage === "observed_stable"
    && Array.isArray(record.result.findings) && typeof record.result.finishedAt === "string";
}

/** Stores only a bounded, non-identifying audit summary for the active pharmacy and user. */
export function createDefinitionAuditStore(options: { indexedDB?: IDBFactory; name?: string } = {}) {
  let connection: Promise<IDBDatabase> | null = null;
  const open = () => connection ||= new Promise<IDBDatabase>((resolve, reject) => {
    const factory = options.indexedDB || globalThis.indexedDB;
    if (!factory) { connection = null; reject(new Error("IndexedDB غير متاح في هذا المتصفح")); return; }
    const request = factory.open(options.name || DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); connection = null; };
      resolve(request.result);
    };
    request.onerror = () => { connection = null; reject(new Error("تعذر فتح نتائج التدقيق المحفوظة")); };
    request.onblocked = () => { connection = null; reject(new Error("أغلق التبويبات القديمة قبل تحديث التخزين المحلي")); };
  });

  async function get(db: IDBDatabase, id: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly"), request = tx.objectStore(STORE).get(id);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(new Error("تعذرت قراءة النتائج المحفوظة"));
    });
  }

  return {
    async load(scope: AuditScope): Promise<StoredAuditResult | null> {
      const stored = await get(await open(), scopeId(scope));
      return validRecord(stored, scope) ? { result: stored.result, savedAt: stored.savedAt } : null;
    },
    async save(scope: AuditScope, report: AuditReport): Promise<StoredAuditResult> {
      if (report.pharmacyId !== scope.pharmacyId) throw new Error("نتيجة التدقيق لا تخص الصيدلية الحالية");
      const next: StoredRecord = {
        id: scopeId(scope), version: 1, pharmacyId: scope.pharmacyId, userId: scope.userId,
        savedAt: new Date().toISOString(), result: safeReport(report),
      };
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE);
        const request = store.get(next.id);
        let selected: StoredAuditResult = { result: next.result, savedAt: next.savedAt };
        let shouldWrite = true;
        request.onsuccess = () => {
          const previous = request.result;
          if (previous !== undefined) {
            if (!validRecord(previous, scope)) { shouldWrite = false; tx.abort(); return; }
            if (Date.parse(previous.result.finishedAt) > Date.parse(next.result.finishedAt)) {
              shouldWrite = false;
              selected = { result: previous.result, savedAt: previous.savedAt };
              return;
            }
          }
          if (shouldWrite) store.put(next);
        };
        tx.oncomplete = () => resolve(selected);
        tx.onabort = tx.onerror = () => reject(new Error("تعذر حفظ نتائج التدقيق؛ احتُفظ بالنتيجة المكتملة السابقة"));
      });
    },
    async clear(scope: AuditScope) {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(scopeId(scope));
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(new Error("تعذر مسح نتيجة التدقيق المحفوظة"));
      });
    },
    async close() {
      const current = connection;
      connection = null;
      if (current) (await current).close();
    },
  };
}

export const definitionAuditStore = createDefinitionAuditStore();
