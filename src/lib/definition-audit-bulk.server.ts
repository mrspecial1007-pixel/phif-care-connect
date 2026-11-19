import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { readDefinitionSnapshot } from "./definition-audit.server";
import { inspectDefinitions, prepareAuditBatch, type AuditSnapshot } from "./definition-audit.helpers";
import { buildItemsAnalytics, analyticsSearchSchema, type AnalyticsRow } from "./items-analytics.helpers";
import { reportSettingKey, resolveReportIdentities } from "./report-medication-evidence.helpers";
import { actualUnit, type ActualUnit } from "./actual-units.helpers";
import { previewSupplierUnitRows, proposedSupplierUnit } from "./report-supplier-units.helpers";
import { supplierSettingReceipt } from "./report-supplier-unit.model";
import { requireSupplierUnitManager, saveSupplierUnit } from "./report-supplier-unit-save.server";

const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const settingDigest = (s: any) => digest([s.id, s.item_identity, s.version, s.units_per_box, s.base_unit,
  s.supplier_quantity_unit, s.supplier_unit_exceptions || {}]);
const evidenceDigest = (items: any[]) => digest(items.map(i => [i.id, i.phif_invoice_id, i.active_ingredient,
  i.strength, i.brand ?? null, i.quantity, i.metadata ?? {}, i.phif_financial_fields ?? {}, i.source_classification]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
const ticketSchema = z.object({ pharmacyId: z.string(), userId: z.string(), identity: z.string(), settingId: z.string().uuid(),
  version: z.number().int().positive(), setting: z.string(), evidence: z.string(), expires: z.number() }).strict();
type Ticket = z.infer<typeof ticketSchema>;
function secret() {
  if (!process.env.SESSION_SECRET) throw new Error("تعذر تأمين موافقة التوثيق؛ إعداد الجلسة غير متاح");
  return process.env.SESSION_SECRET;
}
export function signBulkTicket(payload: Ticket) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", secret()).update(`supplier-bulk-v1:${body}`).digest("base64url")}`;
}
export function readBulkTicket(token: string, context: any): Ticket {
  const [body, signature, extra] = token.split(".");
  const expected = createHmac("sha256", secret()).update(`supplier-bulk-v1:${body}`).digest();
  const given = Buffer.from(signature || "", "base64url");
  if (extra || given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error("موافقة المعاينة غير صالحة");
  const payload = ticketSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString()));
  if (payload.pharmacyId !== context.pharmacy_id || payload.userId !== context.session.data.user_id) throw new Error("المعاينة لا تخص المستخدم والصيدلية الحالية");
  if (payload.expires < Date.now()) throw new Error("انتهت صلاحية المعاينة؛ أعد عرض الأصناف قبل التأكيد");
  return payload;
}

function candidateReason(setting: any, identity: string, rows: AnalyticsRow[]) {
  if (!supplierSettingReceipt.safeParse(setting).success) return "تعريف العبوة ناقص أو قيمه غير صالحة";
  if (setting.units_per_box > 10000) return "حجم العبوة يتجاوز الحدود المعتمدة في الحفظ الفردي";
  const form = actualUnit(JSON.parse(identity)[2]);
  if (!form || setting.base_unit !== form || ["box", "strip"].includes(setting.base_unit)) return "وحدة العبوة لا تطابق الشكل الدوائي الموثق";
  if (!setting.supplier_quantity_unit) return "اختر وحدة Supplier وراجعها قبل الاعتماد";
  if (!["box", "strip", form].includes(setting.supplier_quantity_unit)) return "وحدة Supplier تتعارض مع الشكل الدوائي";
  for (const [invoiceId, unit] of Object.entries(setting.supplier_unit_exceptions || {})) {
    if (rows.filter(r => r.invoiceId === invoiceId).length !== 1 || !["box", "strip", form].includes(String(unit)))
      return "استثناء فاتورة غير مرتبط بشكل منفرد أو وحدته غير محسومة";
  }
  if (!rows.length) return "لا توجد بنود Supplier مرتبطة بهذه الهوية بشكل مؤكد";
  const preview = previewSupplierUnitRows(rows, setting, setting.supplier_quantity_unit, setting.supplier_unit_exceptions || {});
  if (preview.some(p => p.row.unitIssue || p.row.boxIssue || p.boxes == null || !Number.isFinite(p.boxes) || p.boxes < 0))
    return "تحويل أحد البنود غير صالح أو غير موثق؛ لا يكفي حجم العبوة وحده";
  return null;
}

function supplierRows(items: any[], setting: any, pharmacyId: string) {
  const rights = { items: true, movements: false, revenue: false, cost: false, profit: false };
  return buildItemsAnalytics({ pharmacyId, items, settings: [setting], stocks: [],
    invoices: [...new Set(items.map(i => i.phif_invoice_id))].map(id => ({ id })),
    rows: items.map(i => ({ item_id: i.id })), access: { actual: rights, phif: rights },
    filters: analyticsSearchSchema.parse({ month: "all" }),
  }).historyMovements.filter(r => r.source === "phif");
}

export function planBulkSupplierUnits(raw: AuditSnapshot, context: any) {
  const prepared = prepareAuditBatch(raw);
  const findings = inspectDefinitions(raw, context.pharmacy_id, { prepared });
  const references = raw.references.flatMap(r => {
    const m = r.medications;
    return m ? [{ active_ingredient: m.active_ingredient, dosage_form: m.dosage_form,
      strength: `${m.strength_value}${m.strength_unit}${m.strength_denominator_value != null && m.strength_denominator_unit ? `/${m.strength_denominator_value}${m.strength_denominator_unit}` : ""}` }] : [];
  });
  const identities = resolveReportIdentities(prepared.items, prepared.rows, prepared.stocks, references,
    { pharmacyId: context.pharmacy_id, settings: raw.settings });
  const groups = new Map<string, (typeof findings)>();
  for (const f of findings) {
    const key = JSON.stringify([f.source, f.identity || [...f.records].sort()]);
    groups.set(key, [...(groups.get(key) || []), f]);
  }
  const ready: { identity: string; name: string; size: number; baseUnit: string; unit: string; savedUnit: string | null;
    options: { unit: ActualUnit; boxes: number }[]; exceptionCount: number; itemCount: number; token: string }[] = [];
  const excluded: { name: string; reason: string }[] = [];
  for (const group of groups.values()) {
    const first = group[0], identity = first.identity;
    let reason = first.source !== "phif" ? "خارج نطاق توثيق PHIF Supplier" : !identity || !reportSettingKey(identity) ? "الهوية غير محسومة" : null;
    const settings = identity ? raw.settings.filter(s => reportSettingKey(s.item_identity) === identity) : [];
    if (!reason && settings.length !== 1) reason = settings.length ? "تعريفات متعددة أو متعارضة" : "لا يوجد تعريف عبوة محفوظ قابل للربط";
    const setting = settings[0];
    // Include every matching historical item, not just the finding's affected subset.
    const related = raw.items.filter(i => i.source_classification === "phif-supplier" && identities.get(i.id)?.key === identity);
    if (!reason && (!related.length || group.some(f => f.code === "identity_review"))) reason = "الهوية تحتاج مراجعة أو لا ترتبط ببند Supplier";
    const proposed = !reason && setting && identity ? proposedSupplierUnit(setting, JSON.parse(identity)[2]) : "";
    const options: { unit: ActualUnit; boxes: number }[] = [];
    let conversionReason: string | null = null;
    if (!reason) {
      for (const unit of [actualUnit(JSON.parse(identity!)[2]), "box", "strip"] as (ActualUnit | null)[]) {
        if (!unit) continue;
        // Apply the reviewed proposal in memory only, using the report's real conversion rules.
        const prospective = { ...setting, supplier_quantity_unit: unit };
        const rows = supplierRows(related, prospective, context.pharmacy_id);
        const failure = candidateReason(prospective, identity!, rows);
        if (failure) { conversionReason = failure; continue; }
        const converted = previewSupplierUnitRows(rows, prospective, unit, prospective.supplier_unit_exceptions || {});
        options.push({ unit, boxes: converted.reduce((sum, p) => sum + p.boxes!, 0) });
      }
      if (!options.length) reason = conversionReason || "لا تتوفر بيانات كافية لتحويل موثوق";
    }
    if (reason) { excluded.push({ name: first.name, reason }); continue; }
    ready.push({ identity: identity!, name: first.name, size: setting.units_per_box, baseUnit: setting.base_unit,
      unit: proposed, savedUnit: setting.supplier_quantity_unit ?? null, options,
      exceptionCount: Object.keys(setting.supplier_unit_exceptions || {}).length,
      itemCount: related.length, token: signBulkTicket({
        pharmacyId: context.pharmacy_id, userId: context.session.data.user_id, identity: identity!, settingId: setting.id,
        version: setting.version, setting: settingDigest(setting), evidence: evidenceDigest(related), expires: Date.now() + 30 * 60_000,
      }) });
  }
  return { ready, excluded, checkedAt: new Date().toISOString() };
}

export async function previewBulkSupplierUnits(db: any, context: any) {
  await requireSupplierUnitManager(db, context);
  secret();
  const first = await readDefinitionSnapshot(db, context.pharmacy_id);
  if (first.manifest.some(m => m.status !== "read")) throw new Error("لم تكتمل قراءة جميع مصادر المعاينة؛ لا اعتماد جزئي");
  const raw = first.snapshot!;
  const invoiceIds = new Set(raw.invoices.map(i => i.id));
  if (raw.items.some(i => !invoiceIds.has(i.phif_invoice_id))) throw new Error("بنود بلا فاتورة ضمن النطاق؛ المعاينة غير مكتملة");
  const result = planBulkSupplierUnits(raw, context);
  const second = await readDefinitionSnapshot(db, context.pharmacy_id, false);
  if (digest(first.manifest) !== digest(second.manifest)) throw new Error("تغيرت البيانات أثناء المعاينة؛ أعد المحاولة");
  await requireSupplierUnitManager(db, context);
  return result;
}

export async function executeBulkSupplierUnit(db: any, context: any, token: string, reviewedUnit: ActualUnit) {
  await requireSupplierUnitManager(db, context);
  const ticket = readBulkTicket(token, context);
  const { expires, ...operation } = ticket;
  if (!actualUnit(reviewedUnit) || actualUnit(reviewedUnit) !== reviewedUnit) throw new Error("وحدة المراجعة غير صالحة");
  const key = digest({ ...operation, reviewedUnit });
  const previous = await db.from("user_operation_log").select("id").eq("pharmacy_id", context.pharmacy_id)
    .eq("user_id", context.session.data.user_id).eq("action", "supplier_unit_bulk_result")
    .eq("entity_id", ticket.settingId).contains("metadata", { operation: key, status: "confirmed" }).limit(1);
  if (previous.error) throw new Error("تعذر التحقق من سجل العمليات؛ لم يبدأ الحفظ");
  if (previous.data?.length) return { status: "already_confirmed" as const, message: "سبق تنفيذ هذه الموافقة؛ لم يتكرر الحفظ" };
  const log = async (action: string, status: string) => {
    const response = await db.from("user_operation_log").insert({ pharmacy_id: context.pharmacy_id, user_id: context.session.data.user_id,
      action, entity: "phif_report_box_settings", entity_id: ticket.settingId, metadata: { operation: key, status, version: ticket.version, reviewed_unit: reviewedUnit } });
    if (response.error) throw new Error("تعذر تسجيل نتيجة العملية؛ تحقق قبل إعادة المحاولة");
  };
  let attempted = false;
  try {
    // The manager may edit the quantity unit, but cannot replace the signed definition or box size.
    const settingRead = await db.from("phif_report_box_settings").select("*").eq("pharmacy_id", context.pharmacy_id).eq("id", ticket.settingId).maybeSingle();
    const setting = settingRead.data;
    if (settingRead.error || !setting || setting.pharmacy_id !== context.pharmacy_id || settingDigest(setting) !== ticket.setting) throw new Error("تغير التعريف منذ المعاينة؛ لم يُستبدل أي تعديل أحدث");
    const saved = await saveSupplierUnit(db, context, { identity: ticket.identity, unit: reviewedUnit,
      exceptions: Object.entries(setting.supplier_unit_exceptions || {}).map(([invoiceId, unit]) => ({ invoiceId, unit })),
      version: ticket.version }, async (scope, current) => {
      const items = scope.items.filter(i => i.source_classification === "phif-supplier");
      if (settingDigest(current) !== ticket.setting || evidenceDigest(items) !== ticket.evidence) throw new Error("تغيرت بيانات الصنف منذ المعاينة؛ أعد الفحص");
      const prospective = { ...current, supplier_quantity_unit: reviewedUnit };
      const reason = candidateReason(prospective, scope.id, supplierRows(items, prospective, context.pharmacy_id));
      if (reason) throw new Error(reason);
      await log("supplier_unit_bulk_attempt", "started"); attempted = true;
    });
    if (saved.supplier_quantity_unit !== reviewedUnit || saved.units_per_box !== setting.units_per_box
      || saved.base_unit !== setting.base_unit || ![ticket.version, ticket.version + 1].includes(saved.version)
      || digest(saved.supplier_unit_exceptions || {}) !== digest(setting.supplier_unit_exceptions || {}))
      throw new Error("استجابة الحفظ لا تطابق القيم المعتمدة؛ توقف وتحقق من السجل");
    await log("supplier_unit_bulk_result", "confirmed");
    return { status: "confirmed" as const, message: "حُفظت الوحدة التي راجعها المدير؛ يلزم إعادة التدقيق" };
  } catch (error) {
    try { await log("supplier_unit_bulk_result", attempted ? "uncertain" : "failed"); }
    catch { return { status: "uncertain" as const, message: "تعذر تأكيد العملية وتسجيل نتيجتها؛ توقف وتحقق قبل إعادة المحاولة" }; }
    return { status: attempted ? "uncertain" as const : "failed" as const,
      message: error instanceof Error ? error.message : "تعذر توثيق الصنف" };
  }
}
