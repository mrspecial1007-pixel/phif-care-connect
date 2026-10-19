type Completeness = { actual: boolean; phif: boolean };

/** Uses the existing report's calculated profits; never estimates missing item costs. */
export function treasuryReportForRole(report: any, role: unknown, complete: Completeness) {
  if (role === "admin") {
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
