import { buildItemsAnalytics, analyticsSearchSchema } from "./items-analytics.helpers";
import { resolveReportIdentities, reportSettingKey, createReportIdentityEvidence } from "./report-medication-evidence.helpers";
import { applyActualStockLinks, actualLinkIdentity, actualLinkGroups } from "./actual-stock-links.helpers";
import { applyActualUnitDecisions, actualUnit } from "./actual-units.helpers";
import { calculateActualGrossMargin } from "./phif-stock.helpers";
import { REPORT_BOX_REASONS } from "./report-box-quantity.helpers";

export type AuditFinding = {
  id: string; code: string; category: "error" | "review" | "unverified";
  severity: "high" | "medium" | "low"; name: string; reason: string; action: string;
  source: string; identity: string | null; records: string[]; itemIds: string[];
  invoices: { id: string; number: string; month: string }[];
};
export type AuditSnapshot = {
  invoices: any[]; items: any[]; settings: any[]; stocks: any[];
  links: any[]; decisions: any[]; references: any[];
};
export const emptyAuditSnapshot = (): AuditSnapshot => ({ invoices: [], items: [], settings: [], stocks: [], links: [], decisions: [], references: [] });

/** Pure inspection. No normalized key, inferred form or quantity is ever persisted. */
export function prepareAuditBatch(raw: AuditSnapshot) {
  const byItem = new Map(raw.items.map(i => [i.id, i]));
  const links = raw.links.map(l => ({ ...l, source: byItem.get(l.phif_invoice_item_id) || l.source, target: l.target || {} }));
  const items = applyActualUnitDecisions(applyActualStockLinks(raw.items, links), raw.decisions);
  const stocks = raw.stocks.filter(s => s.is_current === true);
  // Use the existing Actual engine only for its verified identity/unit evidence.
  // Financial outputs are neither returned nor stored by this audit.
  const rows = items.map(i => {
    const p = i.source_classification === "actual-supplier" ? calculateActualGrossMargin(i, stocks) : null;
    return { item_id: i.id, matched_stock_id: p?.stock?.source_stock_id,
      invoice_quantity_unit: p?.units?.dispensingUnit, actual_cost_unit: p?.units?.costUnit,
      actual_conversion_factor: p?.units?.factor, match_status: p?.status,
      invoice_dosage_form: i.metadata?.dosage_form ?? i.metadata?.dosageForm ?? i.metadata?.form ?? i.metadata?.pharmaceuticalForm
        ?? String(i.metadata?.unit ?? i.metadata?.dosage_unit ?? i.metadata?.quantity_unit ?? i.phif_financial_fields?.unit ?? "").trim() };
  });
  return { items, rows, stocks, links };
}

export function inspectDefinitions(raw: AuditSnapshot, pharmacyId: string, options: {
  evidence?: ReturnType<typeof createReportIdentityEvidence>; batch?: boolean;
  prepared?: ReturnType<typeof prepareAuditBatch>;
} = {}): AuditFinding[] {
  const invoiceMap = new Map(raw.invoices.map(i => [i.id, i]));
  const byItem = new Map(raw.items.map(i => [i.id, i]));
  const { items, rows, stocks, links } = options.prepared || prepareAuditBatch(raw);
  const references = raw.references.flatMap(r => {
    const m = r.medications;
    return m ? [{ active_ingredient: m.active_ingredient, dosage_form: m.dosage_form,
      strength: `${m.strength_value}${m.strength_unit}${m.strength_denominator_value != null && m.strength_denominator_unit ? `/${m.strength_denominator_value}${m.strength_denominator_unit}` : ""}` }] : [];
  });
  const identities = options.evidence?.resolveBatch(items, rows) ?? resolveReportIdentities(items, rows, stocks, references, { pharmacyId, settings: raw.settings });
  const findings = new Map<string, { finding: AuditFinding; itemIds: Set<string>; invoices: Map<string, AuditFinding["invoices"][number]>; records: Set<string> }>();
  const add = (code: string, category: AuditFinding["category"], reason: string, related: any[], identity: string | null, records: string[] = [], source = "phif", name?: string) => {
    const id = JSON.stringify([code, identity || records.slice().sort(), source]);
    const old = findings.get(id);
    const first = related[0];
    const entry = old || { finding: { id, code, category, severity: category === "error" ? "high" : category === "review" ? "medium" : "low",
      name: name || `${first?.active_ingredient || "سجل محفوظ"} ${first?.strength || ""}`.trim(), reason,
      action: category === "unverified" ? "راجع الدليل والنطاق قبل أي اعتماد" : "افتح الصنف وراجع التعريف والأدلة دون تغيير الفاتورة",
      identity, source, records: [], itemIds: [], invoices: [] } as AuditFinding,
      itemIds: new Set<string>(), invoices: new Map<string, AuditFinding["invoices"][number]>(), records: new Set<string>() };
    for (const record of records) entry.records.add(record);
    for (const item of related) {
      if (!item || entry.itemIds.has(item.id)) continue;
      entry.itemIds.add(item.id);
      const invoiceId = byItem.get(item.id)?.phif_invoice_id;
      if (invoiceId && !entry.invoices.has(invoiceId)) {
        const invoice = invoiceMap.get(invoiceId);
        entry.invoices.set(invoiceId, { id: invoiceId, number: String(invoice?.invoice_number || invoiceId),
          month: /^\d{4}-\d{2}/.test(invoice?.dispensing_date || "") ? invoice.dispensing_date.slice(0, 7) : "تاريخ غير محدد" });
      }
    }
    findings.set(id, entry);
  };
  const scoped = new Map<string, any[]>();
  for (const i of items) {
    const identity = identities.get(i.id)!;
    const group = scoped.get(identity.key) || [];
    group.push(i); scoped.set(identity.key, group);
    if (!["actual-supplier", "phif-supplier"].includes(i.source_classification)) add("unknown_source", "unverified", "مصدر البند غير محدد؛ لم يُفرض مصدر أو تحويل", [i], identity.key, [], "unknown");
  }
  for (const [key, group] of scoped) {
    for (const source of ["phif-supplier", "actual-supplier"]) {
      const related = group.filter(i => i.source_classification === source && identities.get(i.id)?.reviewReason);
      if (related.length) add("identity_review", "review", identities.get(related[0].id)!.reviewReason!, related, key, [], source === "phif-supplier" ? "phif" : "actual");
    }
    if (!options.batch && new Set(group.map(i => String(i.active_ingredient))).size > 1 && !key.includes('"unresolved"')) {
      for (const source of ["phif-supplier", "actual-supplier"]) {
        const related = group.filter(i => i.source_classification === source);
        if (related.length) add("formatting_variants", "review", "توجد كتابات أصلية مختلفة تصل إلى هوية التقرير نفسها؛ لم تتغير الأسماء الأصلية أو مفاتيح Actual", related, key, [], source === "phif-supplier" ? "phif" : "actual");
      }
    }
  }
  const definitions = new Map<string, any[]>();
  for (const s of raw.settings) {
    const key = reportSettingKey(s.item_identity);
    const related = key ? (scoped.get(key) || []).filter(i => i.source_classification === "phif-supplier") : [];
    const label = key ? JSON.parse(key).join(" · ") : "تعريف بمفتاح غير صالح";
    if (!key) add("invalid_key", "error", "مفتاح التعريف لا يقرأه محرك التقرير", [], null, [s.id], "phif", label);
    else {
      definitions.set(key, [...(definitions.get(key) || []), s]);
      if (s.item_identity !== key) add("normalized_alias", "review", "المفتاح المحفوظ مختلف؛ يُسترجع حاليًا عبر تطبيع التقرير، دون إعادة كتابته", related, key, [s.id], "phif", label);
      if (!options.batch && !related.some(i => i.source_classification === "phif-supplier")) add("unused_definition", "review", "لا يوجد بند Supplier يصل إلى هذا التعريف في التاريخ المقروء؛ قد يكون تعريفًا قديمًا أو هوية مختلفة", related, key, [s.id], "phif", label);
      if (!Number.isSafeInteger(Number(s.units_per_box)) || Number(s.units_per_box) <= 0) add("invalid_box", "error", "عدد وحدات العبوة غير صالح؛ لم يُستبدل بصفر", related, key, [s.id], "phif", label);
      const formUnit = actualUnit(JSON.parse(key)[2]);
      if (!actualUnit(s.base_unit) || (formUnit && actualUnit(s.base_unit) !== formUnit)) add("invalid_definition_unit", "error", "وحدة محتوى العبوة المحفوظة غير صالحة أو تختلف عن الشكل الموثق", related, key, [s.id], "phif", label);
    }
    for (const invoiceId of options.batch ? [] : Object.keys(s.supplier_unit_exceptions || {})) {
      const candidates = (scoped.get(key || "") || []).filter(i => i.phif_invoice_id === invoiceId && i.source_classification === "phif-supplier");
      add("supplier_exception_sql", "unverified", "توافق الاستثناء مع SQL المنشور غير متحقق؛ لم تُستدعَ دالة حفظ", candidates, key, [s.id, invoiceId], "phif", label);
      if (candidates.length !== 1) add("supplier_exception_scope", "review", `الاستثناء لا يحدد بند Supplier وحيدًا بهذه الهوية (${candidates.length} مطابق)`, candidates, key, [s.id, invoiceId], "phif", label);
    }
  }
  for (const [key, settings] of definitions) if (settings.length > 1) {
    add("duplicate_definition", "review", "أكثر من سجل يصل لنفس الهوية؛ اختلاف العبوة قد يكون مشروعًا، لكن اختيار الإعداد يحتاج مراجعة", scoped.get(key) || [], key, settings.map(s => s.id));
  }
  for (const [key, group] of scoped) if (group.some(i => i.source_classification === "phif-supplier") && !definitions.has(key)) {
    add("missing_definition", "review", "لا يوجد تعريف Supplier محفوظ قابل للاسترجاع لهذه الهوية", group.filter(i => i.source_classification === "phif-supplier"), key);
  }
  const rights = { items: true, movements: false, revenue: false, cost: false, profit: false };
  const report = buildItemsAnalytics({ identityEvidence: options.evidence, pharmacyId, items, invoices: raw.invoices, rows, stocks, referenceForms: references,
    settings: raw.settings, access: { actual: rights, phif: rights }, filters: analyticsSearchSchema.parse({ month: "all" }) });
  const conversionGroups = new Map<string, typeof report.historyMovements>();
  for (const row of report.historyMovements) if (row.boxes == null) {
    const key = JSON.stringify([row.identity, row.source, row.boxIssue, row.unitIssue]);
    const group = conversionGroups.get(key) || []; group.push(row); conversionGroups.set(key, group);
  }
  for (const group of conversionGroups.values()) {
    const row = group[0];
    add(`conversion_unverified:${row.boxIssue || row.unitIssue || "unknown"}`, "review", REPORT_BOX_REASONS[row.boxIssue || ""] || `تحويل غير موثق: ${row.boxIssue || row.unitIssue || "وحدة مجهولة"}`, group.map(r => byItem.get(r.id)), row.identity, [], row.source);
  }
  for (const link of options.batch ? [] : links) {
    const source = byItem.get(link.phif_invoice_item_id);
    const identity = source ? identities.get(source.id)?.key || null : null;
    if (!source || !link.target.id) add("orphan_link", "error", "مصدر الرابط أو صنف المخزون غير موجود في نطاق القراءة", source ? [source] : [], identity, [link.id], "actual");
    else if (link.source_identity && link.source_identity !== actualLinkIdentity(source, link.target)) add("legacy_key_mismatch", "review", "مفتاح Actual المحفوظ مختلف عن صيغته التاريخية المتوقعة؛ لم يُغيّر أو يُستبدل بمفتاح التقرير", [source], identity, [link.id], "actual");
    if (!link.is_active) add("inactive_link", "review", "رابط تاريخي غير فعال؛ ليس خطأ ولا يُحذف تلقائيًا", source ? [source] : [], identity, [link.id], "actual");
  }
  for (const group of options.batch ? [] : actualLinkGroups(links)) if (group.status === "review") {
    const related = group.members.map(l => byItem.get(l.phif_invoice_item_id)).filter(Boolean);
    add("actual_link_review", group.conflict ? "error" : "review", group.conflict ? "روابط فعالة إلى منتجات مختلفة؛ لا اختيار تلقائيًا" : "توقيع المصدر أو بيانات هدف الرابط تحتاج مراجعة", related, related[0] ? identities.get(related[0].id)!.key : null, group.members.map(l => l.id), "actual");
  } else if (group.members.filter(l => l.is_active).length > 1) {
    const related = group.members.map(l => byItem.get(l.phif_invoice_item_id)).filter(Boolean);
    add("duplicate_actual_links", "review", "أكثر من رابط فعال للعلاقة نفسها؛ المحرك يعيد استخدامها دون حذف السجل التاريخي", related, related[0] ? identities.get(related[0].id)!.key : null, group.members.map(l => l.id), "actual");
  }
  for (const d of options.batch ? [] : raw.decisions) if (!byItem.has(d.phif_invoice_item_id)) add("orphan_unit_decision", "review", "قرار وحدة قديم لا يشير إلى بند ضمن النطاق المقروء", [], null, [d.id], "actual");
  return [...findings.values()].map(({ finding, itemIds, invoices, records }) => ({ ...finding,
    itemIds: [...itemIds], invoices: [...invoices.values()], records: [...records] }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
