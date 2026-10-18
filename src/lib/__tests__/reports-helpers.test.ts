import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMonthlyReport, officialReportPayload, reportItemBoxQuantity, reportItemBoxConversion, type ReportInvoice, type ReportItem } from "@/lib/reports.helpers";

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

  it("reports missing packaging explicitly instead of assuming a box size", () => {
    const result = report();
    const amlodipine = result.top_drugs.find((row) => row.active_ingredient === "AMLODIPINE");
    expect(amlodipine?.formatted_quantity).toContain("60");
    expect(amlodipine?.formatted_quantity).toContain("بيانات عبوة ناقصة");
    expect(amlodipine?.box_quantity).toBeNull();
  });

  it("converts tablets by total units per box, not strips per box", () => {
    const row = { ...items[0], quantity: 60, metadata: { unit: "TABLETS", package_quantity: 30, strips_quantity: 3 } };
    expect(reportItemBoxQuantity(row)).toBe(2);
    expect(reportItemBoxQuantity({ ...row, quantity: 15 })).toBe(0.5);
    expect(reportItemBoxQuantity({ ...row, quantity: 0 })).toBe(0);
    expect(reportItemBoxQuantity({ ...row, metadata: { unit: "STRIPS", strips_quantity: 3 } })).toBe(20);
    expect(reportItemBoxQuantity({ ...row, metadata: { unit: "BOX" } })).toBe(60);
    expect(reportItemBoxQuantity({ ...row, quantity: null })).toBeNull();
    expect(reportItemBoxQuantity({ ...row, metadata: { unit: "TAB", package_quantity: 0 } })).toBeNull();
  });

  it("sums boxes per invoice item before grouping brands with different packaging", () => {
    const result = buildMonthlyReport({ dateFrom: "2026-09-01", dateTo: "2026-09-30", source: "all", groupBy: "scientific", sortBy: "quantity", topLimit: "all", invoices,
      items: [
        { ...items[0], quantity: 30, metadata: { dosage_form: "TABS", package_quantity: 30 } },
        { ...items[1], quantity: 60, metadata: { dosage_form: "TABS", package_quantity: 60 } },
      ] });
    expect(result.top_drugs).toHaveLength(1);
    expect(result.top_drugs[0]).toMatchObject({ quantity: 90, box_quantity: 2, formatted_quantity: "2 علبة", total_value: 30 });
    expect(officialReportPayload(result).top_drugs[0].box_quantity).toBe(2);
  });

  it("uses matching stock package data without using scientific alternatives or costs", () => {
    const row = { ...items[0], source_classification: "actual-supplier", brand: "Forxiga 10MG", strength: "10MG", quantity: 60, metadata: { unit: "TAB" } };
    const stock = { brand_name: "Forxiga 10MG TABS", strength: "10MG", dosage_unit: "TABLETS", package_quantity: 30, strips_quantity: 3, cost_price: 999 };
    expect(reportItemBoxQuantity(row, [stock])).toBe(2);
    expect(reportItemBoxQuantity(row, [{ ...stock, brand_name: "Dapasan" }])).toBeNull();
    expect(reportItemBoxQuantity(row, [{ ...stock, strength: "5MG" }])).toBeNull();
    expect(reportItemBoxQuantity(row, [{ ...stock, dosage_unit: "CAPS" }])).toBeNull();
    expect(reportItemBoxQuantity(row, [stock, { ...stock, package_quantity: 60 }])).toBeNull();
    expect(reportItemBoxQuantity(row, [stock, { ...stock, cost_price: 123 }])).toBe(2);
  });

  it("never labels incomplete conversion as a complete box total", () => {
    const result = buildMonthlyReport({ dateFrom: "2026-09-01", dateTo: "2026-09-30", source: "all", groupBy: "scientific", sortBy: "quantity", topLimit: "all", invoices,
      items: [{ ...items[0], metadata: { dosage_form: "TABS", package_quantity: 30 } }, items[1]] });
    expect(result.top_drugs[0]).toMatchObject({ box_quantity: null, known_box_quantity: 1, quantity_conversion_complete: false });
    expect(result.top_drugs[0].formatted_quantity).toContain("1 علبة");
    expect(result.top_drugs[0].formatted_quantity).toContain("30 قرص");
    const view = readFileSync(join(process.cwd(), "src/components/management/ReportsViews.tsx"), "utf8");
    expect(view).toContain("الكمية_بالعلبة: r.box_quantity");
  });

  it("reproduces saved empty metadata: Aspirem 28 tablets is half a 56-tablet box", () => {
    const row = { ...items[0], brand: "Aspirem EC", active_ingredient: "ACETYLSALICYLIC ACID", strength: "75MG", quantity: 28, source_classification: "actual-supplier", metadata: {} };
    const stock = { brand_name: "Aspirem EC", strength: "75MG", dosage_unit: "TABS", source_quantity_unit: "TABS", package_quantity: "56", strips_quantity: "2", brand_product_id: "1002" };
    expect(reportItemBoxConversion(row, [stock, { ...stock }])).toEqual({ boxes: 0.5, unit: "tablet", reason: null });
    const report = buildMonthlyReport({ dateFrom: "2026-09-01", dateTo: "2026-09-30", source: "all", groupBy: "scientific", sortBy: "quantity", topLimit: "all", invoices, items: [row], stockItems: [stock] });
    expect(report.top_drugs[0].formatted_quantity).toBe("0.5 علبة");
    expect(row.metadata).toEqual({});
  });

  it("reuses full brand, compound strength and form matching with real Forxiga and TAZIN fields", () => {
    const rows = [
      { brand: "Forxiga", strength: "10mg", quantity: 28, stock: { brand_name: "Forxiga", strength: "10mg", dosage_unit: "TABS", package_quantity: "28", strips_quantity: "2" } },
      { brand: "TAZIN 0.40mg", strength: "400 MCG", quantity: 30, stock: { brand_name: "TAZIN 0.40mg", strength: "400 MCG", dosage_unit: "CAPS", package_quantity: "30", strips_quantity: "3" } },
    ];
    for (const row of rows) expect(reportItemBoxQuantity({ ...items[0], ...row, source_classification: "actual-supplier", metadata: {} }, [row.stock])).toBe(1);
    const compound = { ...items[0], brand: "TENSTAR", strength: "160/25MG", source_classification: "actual-supplier", metadata: {} };
    expect(reportItemBoxQuantity(compound, [{ brand_name: "TENSTAR", strength: "160MG", dosage_unit: "TABS", package_quantity: 30 }])).toBeNull();
  });

  it("distinguishes unknown units, missing packaging and conflicting product matches", () => {
    const row = { ...items[0], brand: "Aspirem EC", strength: "75MG", source_classification: "actual-supplier", metadata: {} };
    const stock = { brand_name: "Aspirem EC", strength: "75MG", dosage_unit: "TABS", package_quantity: 56 };
    expect(reportItemBoxConversion(row).reason).toBe("unknown_unit");
    expect(reportItemBoxConversion(row, [{ ...stock, package_quantity: null }]).reason).toBe("missing_package");
    expect(reportItemBoxConversion(row, [stock, { ...stock, package_quantity: 28 }]).reason).toBe("matching_conflict");
    expect(reportItemBoxConversion({ ...row, metadata: { unit: "TAB" } }, [{ ...stock, dosage_unit: "CAPS" }]).reason).toBe("matching_conflict");
    expect(reportItemBoxConversion({ ...row, metadata: { unit: "CAP", dosage_form: "TABLETS" } }, [stock]).reason).toBe("matching_conflict");
    expect(reportItemBoxConversion({ ...row, metadata: { unit: "TAB", package_quantity: 28 }, phif_financial_fields: { package_quantity: 56 } }).reason).toBe("matching_conflict");
  });

  it("normalizes recorded unit aliases and keeps quantity units distinct from form and purchase units", () => {
    for (const unit of ["tab", "TABS", "TABLET", "TABLETS", "T.A.B.S", " قرص "]) {
      expect(reportItemBoxQuantity({ ...items[0], quantity: 60, metadata: { unit, package_quantity: "30" } })).toBe(2);
    }
    expect(reportItemBoxQuantity({ ...items[0], quantity: 6, metadata: { quantityUnit: "STRIPS", dosage_form: "TAB", strips_quantity: "3" } })).toBe(2);
    const row = { ...items[0], brand: "Aspirem EC", strength: "75MG", quantity: 28, source_classification: "actual-supplier", metadata: {} };
    expect(reportItemBoxQuantity(row, [
      { brand_name: "Aspirem EC", strength: "75MG", dosage_unit: "TABLETS", package_quantity: "56.000", strips_quantity: "2" },
      { brand_name: "Aspirem EC", strength: "75MG", dosage_unit: "TABS", package_quantity: "56", strips_quantity: "2.0" },
    ])).toBe(0.5);
    expect(reportItemBoxConversion({ ...items[0], metadata: {}, phif_financial_fields: { internal_purchase_cost_unit: "TAB", purchase_price_unit: "TAB", internal_purchase_unit: "TAB" } }).reason).toBe("unknown_unit");
  });

  it("does not borrow an Actual substitute's package for PHIF Supplier or confuse pens with dosage units", () => {
    const phif = { ...items[0], brand: "ACETYLSALICYLIC ACID", strength: "75MG", quantity: 28, metadata: {} };
    const stocks = [{ brand_name: "ACETYLSALICYLIC ACID", strength: "75MG", dosage_unit: "TABS", package_quantity: 56 }];
    expect(reportItemBoxQuantity(phif, stocks)).toBeNull();
    const pen = { ...items[0], brand: "APIDRA", strength: "100IU", source_classification: "actual-supplier", metadata: {} };
    expect(reportItemBoxConversion(pen, [{ brand_name: "APIDRA", strength: "100IU", dosage_unit: "PEN", package_quantity: 300 }]).reason).toBe("unknown_unit");
  });

  it("reads explicit package suffixes observed in saved invoice brand names without guessing doses", () => {
    const samples = [
      ["XARELTO 15 MG TABS -28 TABS", 28],
      ["JARDIANCE 10 MG , FICTA BLI - 30 Tabs", 30],
      ["SYNJARDY 12.5 /1000MG, FICTA-60 TABS", 60],
    ] as const;
    for (const [brand, quantity] of samples) expect(reportItemBoxQuantity({ ...items[0], brand, quantity, metadata: {} })).toBe(1);
    for (const brand of ["B12 TABS", "ASPIRIN 75MG TABLETS", "MEDICINE 5x10 TABS", "MEDICINE 10/30 TABS", "APIDRA 5X3ML INJ"]) {
      expect(reportItemBoxQuantity({ ...items[0], brand, quantity: 30, metadata: {} })).toBeNull();
    }
    expect(reportItemBoxConversion({ ...items[0], brand: samples[0][0], metadata: { unit: "TAB", package_quantity: 30 } }).reason).toBe("matching_conflict");
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
