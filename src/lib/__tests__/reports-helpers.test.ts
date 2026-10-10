import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMonthlyReport, officialReportPayload, type ReportInvoice, type ReportItem } from "@/lib/reports.helpers";

const invoices: ReportInvoice[] = [
  {
    id: "inv-1",
    invoice_number: "1001",
    beneficiary_name: "Patient One",
    insurance_card_number: "0061600113888",
    dispensing_date: "2026-09-10",
    metadata: { total_amount: 30 },
  },
  {
    id: "inv-2",
    invoice_number: "1002",
    beneficiary_name: "Patient Two",
    insurance_card_number: "00001234",
    dispensing_date: "2026-09-11",
    metadata: { total_amount: 20 },
  },
];

const items: ReportItem[] = [
  {
    id: "item-1",
    phif_invoice_id: "inv-1",
    active_ingredient: "AMLODIPINE",
    strength: "5MG",
    brand: "Brand A",
    quantity: 30,
    source_classification: "phif-supplier",
    phif_financial_fields: { total_amount: 12 },
    metadata: { dosage_form: "TABS" },
  },
  {
    id: "item-2",
    phif_invoice_id: "inv-1",
    active_ingredient: "AMLODIPINE",
    strength: "5 MG",
    brand: "Brand B",
    quantity: 30,
    source_classification: "phif-supplier",
    phif_financial_fields: { total_amount: 18 },
    metadata: { dosage_form: "TABS" },
  },
  {
    id: "item-3",
    phif_invoice_id: "inv-2",
    active_ingredient: "ATORVASTATIN",
    strength: "20MG",
    brand: "Actual Brand",
    quantity: 28,
    source_classification: "actual-supplier",
    phif_financial_fields: { total_amount: 20 },
    metadata: { dosage_form: "TABS" },
  },
];

function report() {
  return buildMonthlyReport({
    dateFrom: "2026-09-01",
    dateTo: "2026-09-30",
    source: "all",
    groupBy: "scientific",
    sortBy: "quantity",
    topLimit: 20,
    invoices,
    items,
    firstDispensingByCard: new Map([
      ["0061600113888", "2026-09-10"],
      ["00001234", "2026-08-01"],
    ]),
    stockItems: [
      {
        source_stock_id: "stock-1",
        brand_name: "Brand A",
        active_ingredient: "AMLODIPINE",
        strength: "5MG",
        dosage_unit: "TABS",
        stock_quantity: 120,
      },
    ],
    previous: {
      invoices: [invoices[1]],
      items: [items[2]],
    },
  });
}

describe("monthly PHIF reports", () => {
  it("preserves leading-zero card numbers and splits new versus repeat beneficiaries", () => {
    const result = report();
    expect(result.beneficiary_stats.unique_patient_count).toBe(2);
    expect(result.beneficiary_stats.new_beneficiary_count).toBe(1);
    expect(result.beneficiary_stats.repeat_beneficiary_count).toBe(1);
    expect(result.beneficiary_stats.beneficiaries.map((row) => row.card)).toContain("0061600113888");
    expect(result.beneficiary_stats.beneficiaries.map((row) => row.card)).toContain("00001234");
  });

  it("separates PHIF Supplier and Actual Supplier without counting invoice values as cash", () => {
    const result = report();
    expect(result.summary.invoice_count).toBe(2);
    expect(result.summary.item_count).toBe(3);
    expect(result.source_split.phif.item_count).toBe(2);
    expect(result.source_split.actual.item_count).toBe(1);
    expect(result.summary.phif_value).toBe(30);
    expect(result.summary.actual_value).toBe(20);
  });

  it("groups identical scientific identity despite brand differences while preserving products", () => {
    const result = report();
    const amlodipine = result.top_drugs.find((row) => row.active_ingredient === "AMLODIPINE");
    expect(amlodipine?.quantity).toBe(60);
    expect(amlodipine?.dispense_count).toBe(2);
    expect(amlodipine?.products).toEqual(expect.arrayContaining([
      expect.objectContaining({ brand: "Brand A" }),
      expect.objectContaining({ brand: "Brand B" }),
    ]));
  });

  it("keeps different strengths and forms as separate drug rows", () => {
    const result = buildMonthlyReport({
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      source: "all",
      groupBy: "scientific",
      sortBy: "quantity",
      topLimit: "all",
      invoices: [invoices[0]],
      items: [
        items[0],
        { ...items[0], id: "item-4", strength: "10MG" },
        { ...items[0], id: "item-5", metadata: { dosage_form: "CAPS" } },
      ],
    });
    expect(result.top_drugs).toHaveLength(3);
  });

  it("builds daily rows, previous-month comparison, and stock consumption estimate", () => {
    const result = report();
    expect(result.daily).toHaveLength(2);
    expect(result.comparison?.available).toBe(true);
    expect(result.stock_consumption[0].period_quantity).toBe(60);
    expect(result.stock_consumption[0].days_of_stock).toBeGreaterThan(0);
  });

  it("keeps official export payload free from internal cost and profit fields", () => {
    const payload = officialReportPayload(report());
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/cost_price|purchaseCost|grossMargin|profit|margin|bridge_session|snapshot/i);
    expect(serialized).toContain("0061600113888");
  });

  it("uses stock-style quantity labels in report rows when possible", () => {
    const result = report();
    const amlodipine = result.top_drugs.find((row) => row.active_ingredient === "AMLODIPINE");
    expect(amlodipine?.formatted_quantity).toContain("60");
  });

  it("keeps report routes independent and guarded by source financial permissions", () => {
    const management = readFileSync(join(process.cwd(), "src/lib/management.functions.ts"), "utf8");
    const landing = readFileSync(join(process.cwd(), "src/routes/management.reports.tsx"), "utf8");
    const summary = readFileSync(join(process.cwd(), "src/routes/management.reports.summary.tsx"), "utf8");
    const itemTracking = readFileSync(join(process.cwd(), "src/routes/management.reports.item-tracking.tsx"), "utf8");
    const profit = readFileSync(join(process.cwd(), "src/routes/management.reports.profit-analysis.tsx"), "utf8");
    const views = readFileSync(join(process.cwd(), "src/components/management/ReportsViews.tsx"), "utf8");
    expect(management).toContain("getReportItemTracking");
    expect(management).toContain("getProfitAnalysisReport");
    expect(management).toContain("savePhifSupplierPurchasePrice");
    expect(management).toContain("financeAccess");
    expect(management).toContain("redactProfitRows");
    expect(management).toContain("actual_cost_read");
    expect(management).toContain("phif_purchase_price_write");
    expect(management).toContain("internal_purchase_price");
    expect(landing).toContain('createFileRoute("/management/reports")');
    expect(landing).toContain("/management/reports/summary");
    expect(landing).toContain("/management/reports/item-tracking");
    expect(landing).toContain("/management/reports/profit-analysis");
    expect(landing).not.toContain("getMonthlyManagementReport");
    expect(landing).toContain("<Outlet />");
    expect(summary).toContain('createFileRoute("/management/reports/summary")');
    expect(itemTracking).toContain('createFileRoute("/management/reports/item-tracking")');
    expect(profit).toContain('createFileRoute("/management/reports/profit-analysis")');
    expect(views).toContain("ReportsSummaryPage");
    expect(views).toContain("ReportsItemTrackingPage");
    expect(views).toContain("ReportsProfitAnalysisPage");
  });
});
