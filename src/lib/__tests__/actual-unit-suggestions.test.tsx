import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { actualUnitSuggestion, actualMoneyProduct } from "@/lib/actual-unit-suggestions.helpers";
import { actualUnitPreview, actualDecisionInput } from "@/lib/actual-units.preview";
import { actualUnitAccess } from "@/lib/actual-units.auth";
import { calculateActualGrossMargin, matchActualInvoiceItemToStock, invoiceItemValue } from "@/lib/phif-stock.helpers";
import { actualUnitSourceSignature, actualStockUnitSignature, applyActualUnitDecisions } from "@/lib/actual-units.helpers";
import { buildManagementAuditReport } from "@/lib/management.functions";
import { UnitForm } from "@/components/management/ActualUnitEditor";
import { ActualUnitAccessNotice } from "@/components/management/ActualUnitAccessNotice";
import { TIRYAQ_PHARMACY_NAME, ANDALUS_PHARMACY_NAME } from "@/lib/pharmacy-isolation";
import { readFileSync } from "node:fs";

// Medicine-only fields verified from Cloud. IDs are synthetic; no patient/session data.
const item = { id: "item", phif_invoice_id: "invoice", source_classification: "actual-supplier", brand: "PROSTAM LP",
  strength: "400 MCG", quantity: 30, metadata: {}, phif_financial_fields: { total_amount: 129.600 } };
const stock = { id: "stock", brand_name: "PROSTAM LP", strength: "400 MCG", dosage_unit: "CAPS",
  package_quantity: 30, strips_quantity: 2, sale_price: 4.320, cost_price: 3.600, is_current: true, stock_quantity: 0 };
const suggest = (source: any = item, stocks: any[] = [stock]) => actualUnitSuggestion(source, matchActualInvoiceItemToStock(source, stocks), invoiceItemValue(source));
const context = (role: string, userId?: string, pharmacy = TIRYAQ_PHARMACY_NAME) => ({ pharmacy_id: "tiryaq", pharmacy_name: pharmacy,
  session: { data: { user_id: userId, user_role: role, user_permissions: { users_manage: true } } } });
const db = (row: any, calls: any[] = []) => ({ from(table: string) { calls.push(table);
  const query = { select() { return query; }, eq(key: string, value: any) { calls.push([key, value]); return query; },
    async maybeSingle() { return { data: row, error: null }; } }; return query;
} });
const preview = (items: any[] = [item], stocks: any[] = [stock]) => actualUnitPreview({ invoices: [{ id: "invoice", invoice_number: "sample", dispensing_date: "2026-09-01" }],
  items, stocks, decisions: [], scope: { itemId: item.id } });

describe("Actual unit price evidence and explicit manager approval", () => {
  it("proposes Cloud PROSTAM 30 native units at 108.000 cost / 21.600 profit without inventing a tablet form", () => {
    expect(suggest()).toMatchObject({ status: "high_confidence", dispensingUnit: "capsule", costUnit: "capsule",
      expectedValue: 129.6, projectedCost: 108, projectedProfit: 21.6, factor: 1 });
    expect(calculateActualGrossMargin(item, [stock])).toMatchObject({ status: "matched", purchaseCost: 108, grossMargin: 21.6, reason: "verified_stock_sale_price",
      units: { provenance: "stock_price_check", dispensingUnit: "capsule", costUnit: "capsule", factor: 1 } });
    const approval = { phif_invoice_item_id: item.id, source_signature: actualUnitSourceSignature(item), stock_signature: actualStockUnitSignature(stock),
      dispensing_unit: "capsule" as const, cost_unit: "capsule" as const, version: 1, is_active: true };
    const [bound] = applyActualUnitDecisions([item], [approval]);
    expect(calculateActualGrossMargin(bound, [stock])).toMatchObject({ status: "matched", purchaseCost: 108 });
    expect(calculateActualGrossMargin(bound, [stock]).grossMargin).toBeCloseTo(21.6);
    expect(calculateActualGrossMargin(applyActualUnitDecisions([bound], [{ ...approval, is_active: false }])[0], [stock]).purchaseCost).toBe(108);
  });

  it("rounds decimal products once to millimes, without accepting discounts or broad tolerances", () => {
    expect(actualMoneyProduct("30", "4.320000")).toBe(129.6);
    expect(actualMoneyProduct("1", "0.1235")).toBe(0.124);
    expect(actualMoneyProduct("3", "0.3335")).toBe(1.001);
    for (const value of [129.599, 129.601, 120, 0, 129.6001]) expect(suggest({ ...item, phif_financial_fields: { total_amount: value } }).status).toBe("review");
    for (const quantity of [null, 0, -1, "not-number"]) expect(suggest({ ...item, quantity }).status).toBe("review");
  });

  it("does not auto-cost a discount, unknown price unit, missing price or conflicting stock rows", () => {
    for (const value of [129.599, 129.601, 120]) {
      expect(calculateActualGrossMargin({ ...item, phif_financial_fields: { total_amount: value } }, [stock]))
        .toMatchObject({ status: "pricing_unit_unverified", purchaseCost: null, grossMargin: null, reason: "amount_mismatch" });
    }
    for (const stocks of [[{ ...stock, dosage_unit: "INJ" }], [{ ...stock, sale_price: null }],
      [stock, { ...stock, id: "other-sale", sale_price: 5 }], [stock, { ...stock, id: "other-cost", cost_price: 4 }]]) {
      expect(calculateActualGrossMargin(item, stocks).purchaseCost).toBeNull();
    }
    expect(calculateActualGrossMargin({ ...item, brand: "Another brand" }, [stock]).purchaseCost).toBeNull();
    expect(calculateActualGrossMargin({ ...item, strength: null }, [stock]).purchaseCost).toBeNull();
  });

  it("does not auto-certify an amount-only box/strip conversion; retains explicit and manual unit evidence", () => {
    const strip = { ...item, quantity: 2 };
    expect(calculateActualGrossMargin(strip, [stock])).toMatchObject({ purchaseCost: null, reason: "conversion_requires_confirmation" });
    expect(calculateActualGrossMargin({ ...strip, metadata: { quantity_unit: "STRIP" } }, [stock])).toMatchObject({ purchaseCost: 108 });
    const approval = { phif_invoice_item_id: item.id, source_signature: actualUnitSourceSignature(strip), stock_signature: actualStockUnitSignature(stock),
      dispensing_unit: "strip" as const, cost_unit: "capsule" as const, version: 1, is_active: true };
    expect(calculateActualGrossMargin(applyActualUnitDecisions([strip], [approval])[0], [stock]).purchaseCost).toBe(108);
    expect(calculateActualGrossMargin(applyActualUnitDecisions([{ ...strip, quantity: 30 }], [approval])[0], [stock]).purchaseCost).toBeNull();
  });

  it("auto-costs one documented native pen without interpreting package_quantity=300 as pens", () => {
    const insulin = { ...item, brand: "Novomix", strength: "100IU", quantity: 1, phif_financial_fields: { total_amount: 86.58 } };
    const pen = { ...stock, brand_name: "Novomix", strength: "100IU", dosage_unit: "PEN", package_quantity: 300, strips_quantity: null,
      sale_price: 86.58, cost_price: 78 };
    expect(calculateActualGrossMargin(insulin, [pen])).toMatchObject({ status: "matched", purchaseCost: 78, grossMargin: 8.58,
      units: { dispensingUnit: "pen", costUnit: "pen", factor: 1 } });
    expect(calculateActualGrossMargin({ ...insulin, phif_financial_fields: { total_amount: 25974 } }, [pen]).purchaseCost).toBeNull();
  });

  it("honors an audited manual decision when current sale prices differ from a historical invoice", () => {
    const discounted = { ...item, phif_financial_fields: { total_amount: 120 } };
    const approval = { phif_invoice_item_id: item.id, source_signature: actualUnitSourceSignature(discounted), stock_signature: actualStockUnitSignature(stock),
      dispensing_unit: "capsule" as const, cost_unit: "capsule" as const, version: 1, is_active: true };
    const [bound] = applyActualUnitDecisions([discounted], [approval]);
    expect(calculateActualGrossMargin(bound, [stock])).toMatchObject({ purchaseCost: 108, grossMargin: 12, units: { provenance: "manual" } });
    expect(calculateActualGrossMargin(applyActualUnitDecisions([bound], [])[0], [stock]).purchaseCost).toBeNull();
    expect(calculateActualGrossMargin({ ...item, source_classification: "phif-supplier" }, [stock]).status).toBe("phif_supplier_excluded");
  });

  it("keeps sale/cost conflicts, unknown pricing units and competing interpretations for review", () => {
    expect(suggest(item, [stock, { ...stock, id: "batch2", sale_price: 4.5 }])).toMatchObject({ status: "review", reason: "price_conflict" });
    expect(suggest(item, [{ ...stock, dosage_unit: "INJ" }])).toMatchObject({ status: "review", reason: "pricing_unit_unknown" });
    expect(suggest(item, [{ ...stock, package_quantity: 1, strips_quantity: 1 }])).toMatchObject({ status: "review", reason: "competing_units" });
    expect(suggest({ ...item, metadata: { quantity_unit: "TAB", unit: "BOX" } }).status).toBe("review");
    expect(suggest({ ...item, source_classification: "phif-supplier" }).status).toBe("review");
  });

  it("proposes strip/box conversions only with documented solid-dose package counts", () => {
    expect(suggest({ ...item, quantity: 2 })).toMatchObject({ status: "high_confidence", dispensingUnit: "strip", factor: 15 });
    expect(suggest({ ...item, quantity: 1 })).toMatchObject({ status: "high_confidence", dispensingUnit: "box", factor: 30 });
    expect(suggest({ ...item, quantity: 2 }, [{ ...stock, strips_quantity: null }]).status).toBe("review");
    const insulin = { ...item, brand: "Novomix", strength: "100IU", quantity: 1, phif_financial_fields: { total_amount: 86.58 } };
    const pen = { ...stock, brand_name: "Novomix", strength: "100IU", dosage_unit: "PEN", package_quantity: 300, strips_quantity: null,
      sale_price: 86.58, cost_price: 78 };
    expect(suggest(insulin, [pen])).toMatchObject({ status: "high_confidence", dispensingUnit: "pen", projectedCost: 78 });
    expect(suggest({ ...insulin, phif_financial_fields: { total_amount: 86.58 * 300 } }, [pen]).status).toBe("review");
  });

  it("revalidates compatible subsets, individual exceptions and current prices at save time", () => {
    const source = preview([item, { ...item, id: "discount", phif_financial_fields: { total_amount: 120 } }]);
    const request = { rows: [{ ...source.rows[0], priceSignature: source.rows[0].suggestion.priceSignature }],
      dispensingUnit: "capsule" as const, costUnit: "capsule" as const, revoke: false, suggestedOnly: true };
    expect(actualDecisionInput(source, request)).toHaveLength(1);
    expect(() => actualDecisionInput(source, { ...request, rows: source.rows.map(row => ({ ...row, priceSignature: row.suggestion.priceSignature })) })).toThrow("غير متوافقة");
    expect(() => actualDecisionInput(preview([item], [{ ...stock, cost_price: 3.7 }]), request)).toThrow("تغيرت الأسعار");
    expect(() => actualDecisionInput(source, { ...request, dispensingUnit: "box" })).toThrow();
    expect(actualDecisionInput(source, { ...request, suggestedOnly: false, revoke: true })).toHaveLength(1);
  });

  it("shows registered-admin, inactive-account and SESSION_SECRET failures without exposing secrets or widening permissions", async () => {
    const secret = "x".repeat(32), calls: any[] = [];
    expect(await actualUnitAccess(db({ id: "admin", display_name: "Manager" }, calls), context("admin", "admin"), secret)).toMatchObject({ allowed: true, subject: "admin", code: "ready" });
    expect(calls).toContainEqual(["pharmacy_id", "tiryaq"]); expect(calls).toContainEqual(["is_active", true]);
    for (const ctx of [context("legacy"), context("employee", "employee"), context("admin", "admin", ANDALUS_PHARMACY_NAME)]) {
      expect(await actualUnitAccess(db(null), ctx, secret)).toMatchObject({ allowed: false, code: "registered_admin_required" });
    }
    expect(await actualUnitAccess(db(null), context("admin", "admin"), secret)).toMatchObject({ allowed: false, code: "admin_verification_failed" });
    const blocked = await actualUnitAccess(db(null), context("admin", "admin"), "private-short-secret");
    expect(blocked).toMatchObject({ allowed: false, code: "session_secret_required" });
    expect(JSON.stringify(blocked)).not.toContain("private-short-secret");
    expect(renderToStaticMarkup(<ActualUnitAccessNotice access={blocked} />)).toContain("SESSION_SECRET");
    expect(renderToStaticMarkup(<ActualUnitAccessNotice access={await actualUnitAccess(db(null), context("legacy"), secret)} />)).toContain("/settings/users");
  });

  it("renders manager preview with financial evidence, item exceptions and no implicit selection", () => {
    const markup = renderToStaticMarkup(<UnitForm data={{ ...preview(), available: true, operations: [] }} scope={{ itemId: item.id }} onSave={async () => {}} />);
    expect(markup).toContain("PROSTAM LP"); expect(markup).toContain("محسوب آليًا");
    expect(markup).toContain("معامل التحويل"); expect(markup).toContain("استثناء هذه الفاتورة");
    expect(markup).not.toContain('checked=""');
    const report = buildManagementAuditReport({ invoices: [{ id: "invoice" }], items: [item], stocks: [stock] });
    expect(report.actual.summary).toMatchObject({ automatic_cost_items: 1, suggested_unit_items: 0, matched: 1, unmatched: 0 });
    expect(report.financial.summary.actual_cost_review_items).toBe(0);
    const form = readFileSync("src/components/management/ActualUnitEditor.tsx", "utf8");
    expect(form).toContain('["actual_units", access?.subject, scope]');
    expect(form).toContain("access?.allowed && query.data");
    for (const key of ["management_audit", "treasury_report", "management_monthly_report", "management_profit_analysis"]) expect(form).toContain(key);
    const functions = readFileSync("src/lib/actual-units.functions.ts", "utf8");
    expect(functions).toContain("actualDecisionInput(preview, data)"); expect(functions).toContain("verifyActualUnitAdmin");
  });
});
