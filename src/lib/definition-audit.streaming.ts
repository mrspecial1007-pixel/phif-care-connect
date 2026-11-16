import { inspectDefinitions, prepareAuditBatch, type AuditSnapshot, type AuditFinding } from "./definition-audit.helpers";
import { createReportIdentityEvidence } from "./report-medication-evidence.helpers";

/** Keeps shared evidence and bounded representatives, never the invoice-item history. */
export function createStreamingAudit(support: AuditSnapshot, pharmacyId: string) {
  const invoices = new Map(support.invoices.map(i => [i.id, i]));
  const references = support.references.flatMap(r => {
    const m = r.medications;
    return m ? [{ active_ingredient: m.active_ingredient, dosage_form: m.dosage_form,
      strength: `${m.strength_value}${m.strength_unit}${m.strength_denominator_value != null && m.strength_denominator_unit ? `/${m.strength_denominator_value}${m.strength_denominator_unit}` : ""}` }] : [];
  });
  const evidence = createReportIdentityEvidence(support.stocks.filter(s => s.is_current === true), references, { pharmacyId, settings: support.settings }, 12 * 1024 * 1024);
  const slice = (items: any[]): AuditSnapshot => ({ ...support, items,
    invoices: [...new Set(items.map(i => i.phif_invoice_id))].map(id => invoices.get(id)).filter(Boolean) });
  const seen = new Set<string>();
  const specialInvoices = new Set(support.settings.flatMap(s => Object.keys(s.supplier_unit_exceptions || {})));
  const linkSources = new Set(support.links.map(l => l.phif_invoice_item_id));
  const retained = new Map<string, any>();
  const groups = new Map<string, { names: Set<string>; items: Set<string>; invoices: Set<string> }>();
  const findings = new Map<string, { finding: AuditFinding; items: Set<string>; invoices: Set<string>; records: Set<string> }>();
  let orphanItems = false;
  // Only exceptional raw evidence is retained. The same support budget is used by the reader.
  let retainedBytes = 0;
  const retain = (item: any) => {
    if (retained.has(item.id)) return;
    retainedBytes += Buffer.byteLength(JSON.stringify(item));
    if (retainedBytes > 12 * 1024 * 1024) throw new Error("budget");
    retained.set(item.id, item);
  };
  const merge = (f: AuditFinding, allItems?: Set<string>, allInvoices?: Set<string>) => {
    let entry = findings.get(f.id);
    if (!entry) {
      entry = { finding: { ...f, itemIds: [], invoices: [], records: [] }, items: new Set(), invoices: new Set(), records: new Set() };
      findings.set(f.id, entry);
    }
    for (const id of allItems || f.itemIds) entry.items.add(id);
    for (const id of allInvoices || f.invoices.map(i => i.id)) entry.invoices.add(id);
    for (const id of f.records) entry.records.add(id);
  };
  return {
    addEvidence(batch: any[]) {
      const prepared = prepareAuditBatch(slice(batch));
      evidence.addBatch(prepared.items, prepared.rows);
    },
    inspectBatch(batch: any[]) {
      for (const item of batch) {
        seen.add(item.id);
        if (!invoices.has(item.phif_invoice_id)) orphanItems = true;
      }
      const raw = slice(batch), prepared = prepareAuditBatch(raw);
      const identities = evidence.resolveBatch(prepared.items, prepared.rows);
      for (const item of batch) {
        const identity = identities.get(item.id)!;
        const key = JSON.stringify([identity.key, item.source_classification]);
        let group = groups.get(key);
        if (!group) { group = { names: new Set(), items: new Set(), invoices: new Set() }; groups.set(key, group); }
        group.items.add(item.id); group.invoices.add(item.phif_invoice_id);
        const name = String(item.active_ingredient);
        if (!group.names.has(name) && group.names.size < 2) { group.names.add(name); retain(item); }
        if (specialInvoices.has(item.phif_invoice_id) || linkSources.has(item.id)) retain(item);
      }
      for (const finding of inspectDefinitions(raw, pharmacyId, { evidence, prepared, batch: true })) merge(finding);
    },
    finish() {
      const globalCodes = new Set(["formatting_variants", "unused_definition", "supplier_exception_sql", "supplier_exception_scope",
        "orphan_link", "legacy_key_mismatch", "inactive_link", "actual_link_review", "duplicate_actual_links", "orphan_unit_decision"]);
      const raw = slice([...retained.values()]);
      for (const f of inspectDefinitions(raw, pharmacyId, { evidence })) {
        if (seen.size && !globalCodes.has(f.code)) continue;
        if (f.code === "orphan_unit_decision" && support.decisions.some(d => f.records.includes(d.id) && seen.has(d.phif_invoice_item_id))) continue;
        const group = f.code === "formatting_variants" ? groups.get(JSON.stringify([f.identity, f.source === "actual" ? "actual-supplier" : "phif-supplier"])) : undefined;
        merge(f, group?.items, group?.invoices);
      }
      const all = [...findings.values()].sort((a, b) => a.finding.id.localeCompare(b.finding.id));
      const displayed = all.slice(0, 100).map(({ finding: f, items, invoices: ids, records }) => ({ ...f,
        itemCount: items.size, invoiceCount: ids.size, recordCount: records.size,
        itemIds: [...items].slice(0, 5), records: [...records].slice(0, 5),
        invoices: [...ids].slice(0, 5).map(id => ({ id, number: String(invoices.get(id)?.invoice_number || id),
          month: /^\d{4}-\d{2}/.test(invoices.get(id)?.dispensing_date || "") ? invoices.get(id).dispensing_date.slice(0, 7) : "تاريخ غير محدد" })),
        evidenceTruncated: items.size > 5 || ids.size > 5 || records.size > 5 }));
      return { orphanItems, findings: displayed, findingsTotal: all.length, findingsTruncated: all.length > displayed.length,
        errors: all.filter(f => f.finding.category === "error").length,
        reviews: all.filter(f => f.finding.category === "review").length,
        unverified: all.filter(f => f.finding.category === "unverified").length };
    },
  };
}
