// Local synthetic benchmark. Generates database pages on demand; no production reads.
import { runDefinitionAudit } from "../../definition-audit.server";
const count = Number(process.argv[2] || 50000);
let peakHeap = 0;
let pages = 0;
const sample = () => { peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed); };
const db = { from(table: string) {
  const query: any = { select: () => query, eq: () => query, order: () => query,
    range: async (from: number, to: number) => {
      sample(); pages++;
      const total = table === "phif_invoice_items" ? count : table === "phif_invoices" ? Math.ceil(count / 5) : 0;
      const data = Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, index) => {
        const n = from + index;
        return table === "phif_invoices" ? { id: `v${n}`, pharmacy_id: "own", invoice_number: String(n), dispensing_date: `2026-${n % 2 ? "10" : "11"}-01` }
          : { id: `i${n}`, phif_invoice_id: `v${Math.floor(n / 5)}`, phif_invoices: { pharmacy_id: "own" },
            active_ingredient: `Medicine ${n % 250}`, strength: n % 2 ? "10MG" : "20MG", brand: `Brand ${n % 500}`,
            source_classification: "phif-supplier", quantity: n % 11 ? 30 : null,
            metadata: { dosage_form: "tablet", quantity_unit: "tablet", original_description: "local synthetic evidence ".repeat(12) },
            phif_financial_fields: { total_amount: 12.345 } };
      });
      return { data, count: total };
    } };
  return query;
} };
const start = performance.now();
const result = await runDefinitionAudit(db, "own");
sample();
console.log(JSON.stringify({ items: count, coverage: result.coverage, readItems: result.counts.items,
  verifiedItems: result.manifest.find(m => m.source === "items")?.verificationCount,
  elapsedMs: Math.round(performance.now() - start), sampledPeakHeapMiB: +(peakHeap / 1048576).toFixed(2),
  maxRSSMiB: +(process.resourceUsage().maxRSS / 1024).toFixed(2), responseBytes: Buffer.byteLength(JSON.stringify(result)), pages,
  findings: result.findingsTotal, truncated: result.findingsTruncated }));
if (result.coverage !== "observed_stable" || result.counts.items !== count) process.exitCode = 1;
