// A tool has evidence/artifacts, not authority to declare the user's entire
// request answered. Keep report bodies distinct from short scan notifications.
export function analysisEvidence(result = {}) {
  result ||= {};
  const reports = (Array.isArray(result.cloudReports) ? result.cloudReports : [])
    .filter(report => typeof report?.report === "string" && report.report.trim())
    .map(report => ({
      marketId: report.marketId, interval: report.interval, strategyId: report.strategyId,
      report: report.report,
    }));
  return {
    report: reports.length
      ? reports.map(row => reports.length === 1 ? row.report : `## ${row.marketId} ${row.interval}\n${row.report}`).join("\n\n")
      : String(result.report || ""),
    reports,
    marketId: result.marketId, symbol: result.symbol, interval: result.interval,
    analysisJobId: result.analysisJobId,
  };
}

export const ANALYSIS_ANSWER_REQUIRED = "Tool results are evidence, not the final answer. Answer every part of the user's actual request in final text. A scan summary, chart or card does not establish that the question was answered. Explain gaps honestly; do not claim advice or risk checks were displayed when they were not.";

export const POSITION_ANSWER_REQUIRED = `${ANALYSIS_ANSWER_REQUIRED}
Use positionReview and the complete market report together. Lead with the health assessment and whether to add, reduce, hold or exit, with reasons and conditions. Identify the actual position, direction, entry, size, leverage/margin mode and snapshot time. If accountStatus is not available, describe earlier figures only as historical/unverified, never as current holdings; any health judgment must be conditional. Separate actual protective orders from hypothetical strategy stop/target references. Explain measured loss versus the effective account-equity risk limit, unavailable facts and any unreviewed holdings. A new-entry trigger is not the user's entry. Reduction estimates include the loss realized by reducing at the current mark; if already over budget, reduction cannot undo that loss. Quantities are estimates until current prices, exchange lot rules and actual protective coverage are verified; never claim exchange rounding is known when it is not. Do not multiply position P&L by leverage again. Missing data or a wait/no-trade market result never means an existing position is safe. Give conditional advice without inventing quantities, stop orders, liquidation prices or execution. Do not call haolo_plan_present for position evidence.`;
