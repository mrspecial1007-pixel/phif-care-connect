import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { analyticsSearchSchema, buildItemsAnalytics } from "../items-analytics.helpers";
import {
  buildTrackingReport,
  trackingInput,
  trackingMovements,
  trackingSummary,
  type TrackingMovement,
} from "../dispensing-tracking.model";
import {
  bindItemsAnalyticsSessionCache,
  itemsAnalyticsScope,
} from "../items-analytics-cache.helpers";
import { buildTrackingWorkbook } from "../dispensing-tracking.xlsx";
import type { TrackingReport } from "../dispensing-tracking.server";
import ExcelJS from "exceljs";

const rights = { items: true, movements: true, revenue: true, cost: true, profit: true };
const fixture = () => {
  const items = [
    {
      id: "a",
      brand: "Brand A",
      supplier: "Company A",
      date: "2020-01-01",
      source: "phif",
      strength: "5MG",
      form: "tablet",
    },
    {
      id: "b",
      brand: "Brand B",
      supplier: "Company B",
      date: "2026-11-05",
      source: "phif",
      strength: "5MG",
      form: "tablet",
    },
    {
      id: "c",
      brand: "Brand A",
      supplier: " company a ",
      date: "2026-11-05",
      source: "actual",
      strength: "5MG",
      form: "tablet",
    },
    {
      id: "d",
      brand: null,
      supplier: "PHIF Supplier",
      date: "2026-11-06",
      source: "phif",
      strength: "5MG",
      form: "tablet",
    },
    {
      id: "e",
      brand: "Brand A",
      supplier: "Company A",
      date: "2026-11-07",
      source: "phif",
      strength: "10MG",
      form: "tablet",
    },
    {
      id: "f",
      brand: "Brand A",
      supplier: "Company A",
      date: "2026-11-08",
      source: "phif",
      strength: "5MG",
      form: "capsule",
    },
    {
      id: "g",
      brand: null,
      supplier: "PHIF Supplier",
      date: "",
      source: "phif",
      strength: "5MG",
      form: "tablet",
    },
  ];
  const raw = items.map((r) => ({
    id: r.id,
    phif_invoice_id: r.id,
    active_ingredient: "Amlodipine",
    strength: r.strength,
    brand: r.brand,
    supplier: r.supplier,
    source_classification: r.source === "phif" ? "phif-supplier" : "actual-supplier",
    quantity: 30,
    metadata: {
      dosage_form: r.form,
      unit: r.form === "tablet" ? "TAB" : "CAP",
      package_quantity: 30,
    },
  }));
  const invoices = items.map((r) => ({
    id: r.id,
    invoice_number: `000${r.id}`,
    dispensing_date: r.date,
    insurance_card_number: r.id === "b" ? "002" : "001",
    beneficiary_name: "Private patient",
  }));
  const financial = raw.map((r) => ({
    item_id: r.id,
    identity_key: `${r.strength}|${r.metadata.dosage_form}`,
    revenue: 60,
    purchase_cost: 24,
    gross_margin: 36,
  }));
  const report = buildItemsAnalytics({
    items: raw,
    invoices,
    rows: financial,
    stocks: [],
    settings: [],
    filters: analyticsSearchSchema.parse({ month: "all" }),
    access: { actual: rights, phif: rights },
  });
  return { raw, financial, report, rows: trackingMovements(report, raw, financial) };
};
const input = (overrides: object = {}) => trackingInput.parse(overrides);

describe("dispensing tracking: exact commercial and shared scientific identity", () => {
  it("groups full ingredient/strength/form across companies and years, preserving original items", () => {
    const { rows } = fixture();
    const before = JSON.stringify(rows);
    const result = buildTrackingReport(rows, input({ item: rows[0].identity }));
    expect(result.catalog).toHaveLength(3);
    expect(result.movements.map((r) => r.id).sort()).toEqual(["a", "b", "c", "d", "g"]);
    expect(result.summary).toMatchObject({
      items: 5,
      invoices: 5,
      beneficiaries: 2,
      first: "2020-01-01",
      last: "2026-11-06",
      undated: 1,
    });
    expect(result.summary.revenue).toBe(300);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("isolates commercial movements and never assigns scientific-only dispensing to a stock brand", () => {
    const f = fixture();
    f.report.historyMovements.find((r) => r.id === "d")!.brand = "Stock matched brand";
    const rows = trackingMovements(f.report, f.raw, f.financial);
    expect(rows.find((r) => r.id === "d")).toMatchObject({
      brand: null,
      product: null,
      company: null,
    });
    const result = buildTrackingReport(
      rows,
      input({ item: rows[0].identity, mode: "brand", product: rows[0].product }),
    );
    expect(result.movements.map((r) => r.id)).toEqual(["a", "c"]);
    expect(result.summary.first).toBe("2020-01-01");
    expect(result.selected?.products).toHaveLength(2);
    expect(
      buildTrackingReport(
        rows,
        input({
          item: rows[0].identity,
          mode: "brand",
          product: rows.find((r) => r.id === "e")!.product,
        }),
      ).movements,
    ).toHaveLength(0);
  });
  it("honors period, source and company without losing full-history dates or undated records", () => {
    const { rows } = fixture(),
      item = rows[0].identity;
    const result = buildTrackingReport(
      rows,
      input({ item, from: "2026-11-01", to: "2026-11-30", company: "company a" }),
    );
    expect(result.movements.map((r) => r.id)).toEqual(["c"]);
    expect(result.history.first).toBe("2020-01-01");
    const month = buildTrackingReport(rows, input({ item, from: "2026-11-01", source: "phif" }));
    expect(month.movements.map((r) => r.id)).toEqual(["b", "d"]);
    expect(month.undatedOutsidePeriod).toBe(1);
    expect(month.timeline.reduce((n, p) => n + p.phif + p.actual, 0)).toBe(month.summary.items);
    expect(month.chronology.reduce((n, g) => n + g.summary.items, 0)).toBe(month.summary.items);
  });
  it("accepts old report links only when their aliases resolve uniquely", () => {
    const { rows } = fixture();
    expect(buildTrackingReport(rows, input({ item: rows[0].legacyKey })).selected?.id).toBe(
      rows[0].identity,
    );
    rows.find((r) => r.id === "e")!.legacyKey = rows[0].legacyKey;
    expect(buildTrackingReport(rows, input({ item: rows[0].legacyKey })).selected).toBeNull();
  });
  it("does not merge unknown quantities, true zero or different box sizes", () => {
    const row = fixture().rows[0];
    const zero: TrackingMovement = {
      ...row,
      quantity: 0,
      quantityIssue: null,
      boxes: 0,
      boxIssue: null,
      boxSize: 30,
      baseUnit: "tablet",
    };
    expect(trackingSummary([zero]).boxes.value).toBe(0);
    expect(
      trackingSummary([{ ...zero, quantity: null, boxes: null, quantityIssue: "missing" }]),
    ).toMatchObject({ unknownQuantity: 1, boxes: { value: null } });
    expect(trackingSummary([zero, { ...zero, boxes: 1, boxSize: 28 }]).boxes.state).toBe(
      "incompatible",
    );
    const boxes = trackingSummary([
      { ...zero, quantity: 1, unit: "box", packageQuantity: 28 },
      { ...zero, quantity: 2, unit: "box", packageQuantity: 30 },
    ]);
    expect(boxes.quantities).toHaveLength(2);
    expect(trackingSummary([{ ...zero, unit: null }]).unknownQuantity).toBe(1);
  });
  it("uses metadata company only when explicitly recorded and ignores source labels", () => {
    const f = fixture();
    Object.assign(f.raw[3].metadata, { company_name: "Recorded company" });
    expect(trackingMovements(f.report, f.raw, f.financial)[3]).toMatchObject({
      company: "Recorded company",
      product: null,
    });
  });
  it("rejects forged scope and invalid dates", () => {
    expect(() => input({ pharmacyId: "other" })).toThrow();
    expect(() => input({ from: "2026-02-30" })).toThrow();
    expect(() => input({ from: "2026-12-01", to: "2026-01-01" })).toThrow();
  });
});

describe("dispensing tracking export and cache", () => {
  it("exports every matching row, numeric quantities, text invoice numbers and real dates without patient data", async () => {
    const { rows } = fixture();
    const all = Array.from({ length: 1234 }, (_, i) => ({
      ...rows[0],
      id: `item-${i}`,
      invoiceId: `invoice-${i}`,
      invoiceNumber: `000${i}`,
    }));
    const filters = input({ item: rows[0].identity });
    const data = {
      ...buildTrackingReport(all, filters),
      filters,
      totalMovements: all.length,
      page: 1,
      pageCount: 25,
      pharmacy: "Test",
      issuedAt: "2026-11-19T12:00:00Z",
      canExport: true,
      hiddenSources: [],
      unclassifiedItems: 0,
      revision: "x".repeat(64),
    } satisfies TrackingReport;
    const workbook = await buildTrackingWorkbook(data);
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load(await workbook.xlsx.writeBuffer());
    const sheet = restored.getWorksheet("جميع حركات الصرف")!;
    expect(sheet.rowCount).toBe(1235);
    expect(sheet.getCell("B2").value).toBe("0000");
    expect(sheet.getCell("C2").value).toBeInstanceOf(Date);
    expect(sheet.getCell("J2").value).toBe(30);
    expect(sheet.views[0]).toMatchObject({ rightToLeft: true, state: "frozen", ySplit: 1 });
    expect(sheet.autoFilter).toBeTruthy();
    expect(restored.worksheets).toHaveLength(7);
    expect(JSON.stringify(restored.model)).not.toContain("Private patient");
    await expect(
      buildTrackingWorkbook({ ...data, movements: data.movements.slice(0, 50) }),
    ).rejects.toThrow("غير مكتملة");
  });
  it("invalidates tracking after invoice/settings refresh and purges it on user/pharmacy changes", async () => {
    const client = new QueryClient();
    const stop = bindItemsAnalyticsSessionCache(client);
    const session = { unlocked: true, pharmacy: { id: "p1" }, user: { id: "u1", role: "admin" } };
    const scope = itemsAnalyticsScope(session),
      key = ["report_item_tracking", scope];
    client.setQueryData(["session"], session);
    client.setQueryData(key, { rows: [1] });
    client.setQueryData(["items_analytics", scope], {});
    await client.invalidateQueries({ queryKey: ["items_analytics"] });
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    client.setQueryData(["session"], { ...session, pharmacy: { id: "p2" } });
    expect(client.getQueryData(key)).toBeUndefined();
    stop();
    client.clear();
  });
});
