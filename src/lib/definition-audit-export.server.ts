import { createHash } from "node:crypto";
import { inspectDefinitions, prepareAuditBatch, type AuditSnapshot, type AuditFinding } from "./definition-audit.helpers";
import { readDefinitionSnapshot, requireDefinitionAuditAdmin } from "./definition-audit.server";
import { runAuthorizedDefinitionAudit } from "./definition-audit.request";
import { reportSettingKey } from "./report-medication-evidence.helpers";
import { buildItemsAnalytics, analyticsSearchSchema } from "./items-analytics.helpers";
import { auditReviewExportInput, type AuditReviewExport, type AuditReviewExportInput } from "./definition-audit-export.model";

type Manifest = Awaited<ReturnType<typeof readDefinitionSnapshot>>["manifest"];
function fingerprint(manifest: Manifest) {
  if (manifest.some(m => m.status !== "read" || !m.digest))
    throw new Error("تعذرت قراءة جميع مصادر التصدير ضمن حدود التشغيل الآمنة؛ لم يُنشأ ملف ناقص.");
  // Match the existing scan's support-first, items-last fingerprint order.
  const ordered = [...manifest.filter(m => m.source !== "items"), ...manifest.filter(m => m.source === "items")];
  return createHash("sha256").update(JSON.stringify(ordered.map(m => [m.source, m.digest]))).digest("hex");
}

const uniqueValue = <T>(values: T[]): T | null => values.length && new Set(values).size === 1 ? values[0] : null;
const numeric = (value: unknown) => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);

/** Projects all findings, before any UI sampling, with only non-patient reference fields. */
export function buildAuditReviewRows(raw: AuditSnapshot, pharmacyId: string, findings: AuditFinding[],
  movements: { id: string; boxSize?: number | null; baseUnit?: string | null }[] = []) {
  const items = new Map(raw.items.map(i => [i.id, i]));
  const movementById = new Map(movements.map(m => [m.id, m]));
  const settings = new Map<string, any[]>();
  for (const s of raw.settings) {
    if (s.pharmacy_id !== pharmacyId) throw new Error("تعريف خارج نطاق الصيدلية");
    const key = reportSettingKey(s.item_identity);
    if (key) settings.set(key, [...(settings.get(key) || []), s]);
  }
  const groups = new Map<string, { identity: string | null; source: string; findings: AuditFinding[];
    items: Set<string>; invoices: Set<string>; records: Set<string> }>();
  const recordTables = [
    ["phif_report_box_settings", new Set(raw.settings.map(s => s.id))],
    ["phif_actual_stock_links", new Set(raw.links.map(s => s.id))],
    ["phif_actual_unit_decisions", new Set(raw.decisions.map(s => s.id))],
  ] as const;
  for (const f of findings) {
    const identity = f.identity;
    const stableRecords = recordTables.flatMap(([table, ids]) => f.records.filter(id => ids.has(id)).map(id => [table, id])).sort();
    const key = JSON.stringify([pharmacyId, f.source, identity || `record:${createHash("sha256").update(stableRecords.length ? JSON.stringify(stableRecords) : f.id).digest("hex")}`]);
    let group = groups.get(key);
    if (!group) {
      group = { identity, source: f.source, findings: [], items: new Set(), invoices: new Set(), records: new Set() };
      groups.set(key, group);
    }
    group.findings.push(f);
    for (const id of f.itemIds) {
      const item = items.get(id);
      if (!item) throw new Error("تعذر ربط أحد بنود المراجعة بمصدره؛ لم يُنشأ ملف ناقص.");
      const source = item.source_classification === "phif-supplier" ? "phif" : item.source_classification === "actual-supplier" ? "actual" : "unknown";
      if (source !== f.source) continue;
      group.items.add(id); group.invoices.add(item.phif_invoice_id);
    }
    for (const id of f.records) group.records.add(id);
  }
  const definitions: AuditReviewExport["definitions"] = [];
  const records: AuditReviewExport["records"] = [];
  const rows: AuditReviewExport["rows"] = [];
  for (const [key, group] of groups) {
    const related = [...group.items].map(id => items.get(id)).filter(Boolean);
    const candidates = group.source === "phif" ? (group.identity ? settings.get(reportSettingKey(group.identity) || "") || []
      : raw.settings.filter(s => group.records.has(s.id))) : [];
    const parts = group.identity && reportSettingKey(group.identity) ? JSON.parse(group.identity) as string[] : null;
    const actual = [...group.items].map(id => movementById.get(id)).filter(m => !!m);
    const size = group.source === "actual" ? uniqueValue(actual.map(m => m.boxSize ?? null)) : uniqueValue(candidates.map(s => numeric(s.units_per_box)));
    const baseUnit = group.source === "actual" ? uniqueValue(actual.map(m => m.boxSize ? m.baseUnit ?? null : null)) : uniqueValue(candidates.map(s => s.base_unit ?? null));
    const supplierUnit = uniqueValue(candidates.map(s => s.supplier_quantity_unit ?? null));
    const status = [!parts ? "هوية غير محسومة؛ يلزم ربط موثق قبل الاستيراد" : "",
      candidates.length > 1 ? "عدة تعريفات محفوظة؛ راجع ورقة التعريفات المرجعية ولا تستبدلها تلقائيًا" : "",
      candidates.length === 1 ? "تعريف محفوظ مسترجع بمفتاح الهوية" : "",
      group.source === "actual" ? "بيانات Actual مستقلة؛ لا تُطبق إعدادات Supplier عليها" : "",
      group.source === "actual" && actual.length && (size == null || baseUnit == null) ? "حجم عبوة Actual مفقود أو متعدد أو متعارض؛ لم يُختر حجم تلقائيًا" : "",
      candidates.some(s => Object.keys(s.supplier_unit_exceptions || {}).length) ? "توجد استثناءات وحدات محفوظة؛ لا يتضمن الملف تفاصيل فواتيرها" : "",
    ].filter(Boolean).join(" · ");
    const originalNames = [...new Set(related.map(i => String(i.active_ingredient || "")).filter(Boolean))];
    if (!originalNames.length) for (const s of candidates) {
      try { const original = JSON.parse(s.item_identity); if (Array.isArray(original) && typeof original[0] === "string") originalNames.push(original[0]); } catch { /* Keep an invalid key in the reference sheet. */ }
    }
    rows.push({ key, identity: group.identity, source: group.source,
      name: originalNames.join(" / ") || "الاسم غير متاح؛ راجع السجل المرجعي", strength: parts?.[1] || [...new Set(related.map(i => String(i.strength || "")))].join(" / "),
      form: parts?.[2] || "غير محسوم", reasons: [...new Set(group.findings.map(f => f.reason))],
      itemCount: group.items.size, invoiceCount: group.invoices.size, boxSize: size, baseUnit, supplierUnit, status });
    for (const s of candidates) definitions.push({ rowKey: key, id: String(s.id), identity: s.item_identity, version: numeric(s.version),
      boxSize: numeric(s.units_per_box), baseUnit: s.base_unit ?? null, supplierUnit: s.supplier_quantity_unit ?? null });
    for (const [table, ids] of recordTables) for (const id of group.records) if (ids.has(id)) records.push({ rowKey: key, table, id });
  }
  return { rows, definitions, records };
}

export async function readAuditReviewExport(db: any, pharmacyId: string, request: AuditReviewExportInput): Promise<AuditReviewExport> {
  const first = await readDefinitionSnapshot(db, pharmacyId);
  const firstFingerprint = fingerprint(first.manifest);
  if (firstFingerprint !== request.fingerprint) throw new Error("تغيرت البيانات منذ آخر فحص مكتمل؛ أعد الفحص قبل التصدير.");
  const raw = first.snapshot!;
  const invoiceIds = new Set(raw.invoices.map(i => i.id));
  if (raw.items.some(i => !invoiceIds.has(i.phif_invoice_id))) throw new Error("بعض البنود بلا فاتورة ضمن النطاق؛ تعذر ضمان اكتمال التصدير.");
  const prepared = prepareAuditBatch(raw);
  const findings = inspectDefinitions(raw, pharmacyId, { prepared });
  const rights = { items: true, movements: false, revenue: false, cost: false, profit: false };
  const movements = findings.some(f => f.source === "actual") ? buildItemsAnalytics({ ...prepared, pharmacyId,
    invoices: raw.invoices, settings: raw.settings, access: { actual: rights, phif: rights },
    referenceForms: raw.references.flatMap(r => r.medications ? [{ active_ingredient: r.medications.active_ingredient,
      dosage_form: r.medications.dosage_form,
      strength: `${r.medications.strength_value}${r.medications.strength_unit}${r.medications.strength_denominator_value != null && r.medications.strength_denominator_unit ? `/${r.medications.strength_denominator_value}${r.medications.strength_denominator_unit}` : ""}` }] : []),
    filters: analyticsSearchSchema.parse({ month: "all" }),
  }).historyMovements : [];
  const projection = buildAuditReviewRows(raw, pharmacyId, findings, movements);
  const verification = await readDefinitionSnapshot(db, pharmacyId, false);
  if (fingerprint(verification.manifest) !== firstFingerprint) throw new Error("تغيرت البيانات أثناء تجهيز التصدير؛ لم يُنشأ ملف غير متسق.");
  return { schemaVersion: 1, pharmacyId, fingerprint: firstFingerprint, ruleVersion: request.ruleVersion,
    auditFinishedAt: request.finishedAt, verifiedAt: new Date().toISOString(), findingsCount: findings.length, ...projection };
}

export async function exportAuthorizedDefinitionAudit(getSession: () => Promise<any>, db: any, input: unknown) {
  const request = auditReviewExportInput.parse(input);
  return runAuthorizedDefinitionAudit(getSession, db, requireDefinitionAuditAdmin,
    (database, pharmacyId) => readAuditReviewExport(database, pharmacyId, request)) as Promise<AuditReviewExport>;
}
