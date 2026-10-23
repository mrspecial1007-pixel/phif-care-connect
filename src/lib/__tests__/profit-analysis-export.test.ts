import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { canExportProfit, profitExportPayload, profitExportFilename, validProfitExportRange } from "../profit-analysis-export.model";
import { buildProfitWorkbook } from "../profit-analysis-export.xlsx";
import { profitExportFixture, profitExportMeta } from "./fixtures/profit-export.fixture";

const fullAccess = { actual: { items: true, movements: true, revenue: true, cost: true, profit: true }, phif: { items: true, movements: true, revenue: true, cost: true, profit: true } };
describe("authorized profit analysis exports", () => {
  it("uses complete existing report collections, not visible top-20 lists", () => {
    const report = profitExportFixture();
    const data = profitExportPayload(report, profitExportMeta);
    expect(data.beneficiaries.rows).toHaveLength(35);
    expect(data.revenueItems.rows).toHaveLength(70);
    expect(data.profitItems.rows).toHaveLength(70);
    expect(data.invoices.rows).toHaveLength(35);
    expect(data.details.rows).toHaveLength(70);
    expect(new Set(data.invoices.rows.map(r => r[0])).size).toBe(35);
    expect(data.summary.rows[0][1]).toBe(report.summary.total_revenue);
    expect(data.invoices.totals?.slice(4,7)).toEqual([report.summary.total_revenue, report.summary.known_cost, report.summary.known_profit]);
  });
  it("keeps source and invoice financial values unchanged, with separate revenue and profit sorting", () => {
    const raw = profitExportFixture();
    raw.export_details.items[0].known_profit = -5;
    const data = profitExportPayload(raw, profitExportMeta);
    expect(data.sources.rows.map(r => r.slice(3,6))).toEqual([[2100,700,1400],[1400,1020,340]]);
    expect(data.revenueItems.rows[0][4]).toBe(60);
    expect(data.profitItems.rows.at(-1)?.[6]).toBe(-5);
    expect(data.meta).toEqual(profitExportMeta);
    expect(data.details.rows.at(-1)?.[9]).toBeNull();
    expect(data.complete).toBe(false);
    expect(data.revenueItems.rows.find(r => r[0] === "ACETYLSALICYLIC ACID")?.[2]).toBeNull();
  });
  it("never turns unknown total cost/profit into zero", () => {
    const report = profitExportFixture(1);
    report.summary.matched_count = 0;
    const data = profitExportPayload(report, profitExportMeta);
    expect(data.summary.rows[1][1]).toBeNull();
    expect(data.summary.rows[2][1]).toBeNull();
  });
  it("requires report/export permissions and each selected source's financial and movement rights", () => {
    expect(canExportProfit({ user_role: "admin" }, "all", fullAccess)).toBe(true);
    const permissions = Object.fromEntries(["reports_read","reports_export","stock_cost_read"].map(k => [k,true]));
    const user = { user_role: "employee", user_permissions: permissions };
    expect(canExportProfit(user,"all",fullAccess)).toBe(true);
    for (const key of Object.keys(permissions)) expect(canExportProfit({ ...user, user_permissions: { ...permissions, [key]: false } },"all",fullAccess)).toBe(false);
    expect(canExportProfit(user,"all",{ ...fullAccess, actual: { ...fullAccess.actual, cost: false } })).toBe(false);
    expect(canExportProfit(user,"all",{ ...fullAccess, phif: { ...fullAccess.phif, profit: false } })).toBe(false);
    expect(canExportProfit({ ...user, user_permissions: { ...permissions, stock_cost_read: false } },"phif",{ ...fullAccess, actual: { items: false } })).toBe(true);
    expect(canExportProfit({},"all",fullAccess)).toBe(false);
  });
  it("validates actual ranges without changing this-month UI selection", () => {
    expect(validProfitExportRange("2026-09-01","2026-09-30")).toBe(true);
    expect(validProfitExportRange("2026-02-30","2026-03-02")).toBe(false);
    expect(validProfitExportRange("2026-10-01","2026-09-01")).toBe(false);
    expect(profitExportFilename(profitExportPayload(profitExportFixture(),profitExportMeta),"pdf-full")).toBe("PHIF-profit-pdf-full-all-2026-09-01_2026-09-30-2026-10-23.pdf");
    const page = readFileSync("src/components/management/ReportsViews.tsx","utf8");
    expect(page).toContain('useState("this_month")');
    expect(page).toContain("<ProfitAnalysisExportButton range={period.range} source={source}");
  });
  it("enforces permissions before loading export rows, derives pharmacy on the server, and never writes", () => {
    const server = readFileSync("src/lib/management.functions.ts","utf8");
    const body = server.slice(server.indexOf("async function buildProfitAnalysisReport"),server.indexOf("function summarizeProfitRows"));
    expect(body.indexOf("if (exporting && !can_export)")).toBeLessThan(body.indexOf("await loadProfitRows"));
    expect(body).toContain("const { pharmacy_id } = session");
    expect(body).toContain("pharmacy: session.pharmacy_name");
    expect(body).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(server).toContain('requireTiryaqPermission(exporting ? "reports_export" : "reports_read")');
    const worker = readFileSync("src/lib/profit-analysis-export.worker.ts","utf8");
    expect(worker).not.toMatch(/supabase|fetch\(/);
  });
  it("roundtrips a styled seven-sheet XLSX with text cards, real dates/numbers, filters and totals", async () => {
    const report = profitExportFixture();
    const data = profitExportPayload(report,profitExportMeta);
    const workbook = await buildProfitWorkbook(data);
    const bytes = await workbook.xlsx.writeBuffer();
    const parsed = new ExcelJS.Workbook();
    await parsed.xlsx.load(bytes);
    expect(parsed.worksheets.map(s => s.name)).toEqual(["الملخص المالي","مقارنة المصادر","المستفيدون","الأصناف حسب الإيراد","الأصناف حسب الربح","الفواتير","تفاصيل البنود"]);
    expect(parsed.getWorksheet("المستفيدون")!.getCell("B7").value).toBe("00000");
    const invoices = parsed.getWorksheet("الفواتير")!;
    expect(invoices.getCell("B7").value).toBeInstanceOf(Date);
    expect(invoices.getCell("E7").value).toBe(100);
    expect(invoices.getCell("E7").numFmt).toContain("0.000");
    expect(invoices.getCell(`E${invoices.rowCount}`).value).toBe(report.summary.total_revenue);
    expect(invoices.views[0]).toMatchObject({ rightToLeft: true, state: "frozen", ySplit: 6 });
    expect(invoices.autoFilter).toBeTruthy();
    expect(invoices.getCell("C7").alignment.wrapText).toBe(true);
    expect(invoices.pageSetup.printTitlesRow).toBe("6:6");
    expect(parsed.getWorksheet("تفاصيل البنود")!.getCell("J76").value).toContain("غير مكتمل");
  }, 30000);
});
