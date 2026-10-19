import { TIRYAQ_PHARMACY_NAME } from "@/lib/pharmacy-isolation";

type Completeness = { actual: boolean; phif: boolean };
type TreasurySession = {
  pharmacy_id: string;
  pharmacy_name: string;
  session: { data: { user_id?: string | null; user_role?: string; user_permissions?: Record<string, boolean> } };
};

// Called only with the verified context returned by requireTiryaqPermission.
export function isTreasuryManager(context: TreasurySession | null | undefined) {
  if (!context?.pharmacy_id || context.pharmacy_name !== TIRYAQ_PHARMACY_NAME || !context.session?.data) return false;
  const { user_id, user_role, user_permissions } = context.session.data;
  return user_role === "admin"
    || (user_role === "legacy" && user_permissions?.users_manage === true)
    || (!user_id && !user_role);
}

type SourceReadAccess = { items: boolean; movements: boolean; revenue: boolean; cost: boolean; profit: boolean };

export function treasuryFinanceAccess<T extends { actual: SourceReadAccess; phif: SourceReadAccess }>(context: TreasurySession, access: T) {
  const manager = isTreasuryManager(context);
  const sourceAccess = (source: SourceReadAccess) => manager
    ? { ...source, items: true, movements: true, revenue: true, cost: true, profit: true }
    : { ...source, profit: false };
  return { ...access, actual: { ...access.actual, ...sourceAccess(access.actual) }, phif: { ...access.phif, ...sourceAccess(access.phif) } };
}

/** Uses the existing report's calculated profits; never estimates missing item costs. */
export function treasuryReportForSession(report: any, context: TreasurySession | null | undefined, complete: Completeness) {
  if (isTreasuryManager(context)) {
    const actualProfit = complete.actual ? report.source_split.actual.known_profit : null;
    const phifProfit = complete.phif ? report.source_split.phif.known_profit : null;
    const claimComplete = complete.actual && complete.phif;
    return {
      ...report,
      treasury_financials: {
        actual: { profit: actualProfit, complete: complete.actual },
        phif: { profit: phifProfit, complete: complete.phif },
        claim: { value: claimComplete ? report.source_split.phif.revenue + actualProfit : null, complete: claimComplete },
      },
    };
  }
  const hideProfit = (row: any) => ({ ...row, known_profit: null, ...("gross_margin" in row ? { gross_margin: null } : {}) });
  return {
    ...report,
    treasury_financials: null,
    summary: hideProfit(report.summary),
    source_split: { actual: hideProfit(report.source_split.actual), phif: hideProfit(report.source_split.phif) },
    top_profit_items: [],
    top_profit_beneficiaries: [],
    top_revenue_items: report.top_revenue_items.map(hideProfit),
    top_dispensed_items: report.top_dispensed_items.map(hideProfit),
    top_revenue_beneficiaries: report.top_revenue_beneficiaries.map(hideProfit),
    invoices: report.invoices.map((invoice: any) => ({
      ...hideProfit(invoice),
      items: invoice.items.map((item: any) => ({ ...hideProfit(item), gross_margin: null, profit_hidden: true })),
    })),
  };
}
