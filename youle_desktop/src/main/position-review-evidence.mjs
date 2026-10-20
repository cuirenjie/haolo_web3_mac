// Read-only arithmetic over Host-owned account facts and verified cloud levels.
// No market direction, order, replacement price or user preference is invented.
const number = value => typeof value === "number" && Number.isFinite(value) ? value : null;
const positive = value => number(value) !== null && value > 0 ? value : null;
const sideOf = position => {
  const side = String(position.direction || position.positionSide || "").toLowerCase();
  return ["long", "short"].includes(side) ? side : null;
};
const availableSource = value => typeof value === "string" && !/unavailable|unknown|stale|partial|error/i.test(value);
const freshnessMs = 120_000;
const intervalKey = value => {
  const raw = String(value ?? "");
  const match = /^(\d+)([mhdwDW]?)$/.exec(raw);
  return match ? String(Number(match[1]) * ({ "": 1, m: 1, h: 60, d: 1440, D: 1440, w: 10080, W: 10080 }[match[2]])) : raw;
};
export function positionAccountFresh(account, now = Date.now()) {
  const at = Date.parse(account?.fetchedAt);
  return account?.available === true && Number.isFinite(at)
    && now - at >= -5_000 && now - at <= freshnessMs
    && !(account.warnings || []).some(w => /stale|上次成功|过期|過期/i.test(String(w)));
}

function referenceScenarios(analysis, side, now) {
  return (analysis.cloudReports || []).flatMap(report => {
    if (report.marketId !== analysis.marketId || intervalKey(report.interval) !== intervalKey(analysis.interval)) return [];
    const plan = report.executionPlan;
    if (!plan) return [];
    const entryV2 = plan.schemaVersion === 2;
    const marketKey = `binance:usdm:${analysis.marketId?.split(":").at(-1)}`;
    if (entryV2 ? plan.context?.marketKey !== marketKey || intervalKey(plan.context?.interval) !== intervalKey(analysis.interval)
      : plan.market?.marketId !== analysis.marketId || intervalKey(plan.market?.interval) !== intervalKey(analysis.interval)) return [];
    return (plan.scenarios || []).flatMap(s => {
      const condition = s.entryCondition || plan.entryCondition;
      const stop = positive(entryV2 ? s.stop : s.stop?.price);
      if (s.side !== side || !stop || entryV2 && (condition?.direction !== side || condition.marketKey !== marketKey)) return [];
      const sizing = s.positionSizing || plan.positionSizing;
      const rate = number(sizing?.estimatedRoundTripCostRate);
      const cap = positive(sizing?.maxLossPerTradePercent ?? sizing?.maxAccountRiskPercent);
      const expiries = [plan.expiresAt, ...(entryV2 ? [condition.expiresAt] : [])].map(positive).filter(v => v !== null);
      const expiresAt = expiries.length ? Math.min(...expiries) : null;
      return [{
        source: "strategy-reference-not-an-order", runId: report.runId, planId: plan.planId,
        scenarioId: s.id || condition?.conditionId, side, stop,
        trigger: positive(entryV2 ? s.entry : s.trigger?.price),
        ...(entryV2 ? { entryCondition: condition } : {}),
        targets: (s.targets || []).map(t => positive(entryV2 ? t : t.price)).filter(p => p !== null),
        action: entryV2 ? plan.outcome?.action : plan.action, expiresAt,
        expired: !expiresAt || expiresAt <= now,
        strategyRiskLimitPercent: cap !== null && cap <= 100 ? cap : null,
        estimatedRoundTripCostRate: rate !== null && rate >= 0 && rate < 0.1 ? rate : null,
      }];
    });
  });
}

function stopMeasurement(position, reference, equity, riskLimit) {
  const qty = positive(position.amount), entry = positive(position.entryPrice), mark = positive(position.markPrice);
  if (!qty || !entry || !mark) return { ...reference, measurable: false, reason: "position-price-or-size-unavailable" };
  const sign = sideOf(position) === "long" ? 1 : -1;
  const unitAtMark = sign * (mark - entry), unitAtStop = sign * (reference.stop - entry);
  const costs = reference.estimatedRoundTripCostRate === null ? null : qty * entry * reference.estimatedRoundTripCostRate;
  const loss = costs === null ? null : Math.max(0, -qty * unitAtStop + costs);
  const exitNowLoss = costs === null ? null : Math.max(0, -qty * unitAtMark + costs);
  const appliedLimit = riskLimit === null ? null : Math.min(riskLimit, reference.strategyRiskLimitPercent ?? riskLimit);
  const budget = equity !== null && appliedLimit !== null ? equity * appliedLimit / 100 : null;
  const breached = sign * (mark - reference.stop) <= 0;
  const additionalLoss = Math.max(0, qty * sign * (mark - reference.stop));
  // Reduce at the current mark and retain the rest to the reference stop.
  // Counting only the retained position would hide already-realized losses.
  let reduction = null;
  if (budget !== null && costs !== null && !reference.expired && !breached && unitAtMark > unitAtStop) {
    const remaining = Math.max(0, Math.min(qty, (budget + qty * unitAtMark - costs) / (unitAtMark - unitAtStop)));
    reduction = {
      maximumRemainingQuantityEstimate: remaining,
      minimumReductionQuantityEstimate: qty - remaining,
      budgetAchievableAtMark: exitNowLoss <= budget,
      realizedLossCannotBeUndone: exitNowLoss > budget,
      quantityIsOrder: false,
      precision: "estimate-before-exchange-lot-rounding",
    };
  }
  return { ...reference, measurable: true, referenceAlreadyBreached: breached,
    grossPnlAtReference: qty * unitAtStop, additionalGrossLossFromMark: additionalLoss,
    estimatedCosts: costs, estimatedNetLossAtReference: loss,
    estimatedNetLossPercentOfEquity: loss !== null && equity !== null ? loss / equity * 100 : null,
    riskBudget: budget, riskLimitPercentApplied: appliedLimit,
    exceedsRiskBudget: loss !== null && budget !== null ? loss > budget : null,
    estimatedNetLossIfExitAtMark: exitNowLoss, reduction,
    costAssumption: costs === null ? "Costs unavailable; gross figures do not verify the net risk limit."
      : "Uses the cloud plan's round-trip cost reserve on actual entry notional, not verified fill fees. Slippage/funding may differ.",
  };
}

export function buildPositionReview({ account, analysis = {}, profile, now = Date.now() } = {}) {
  const fresh = positionAccountFresh(account, now);
  const positionsKnown = fresh && availableSource(account?.sources?.futures) && Array.isArray(account.positions);
  const equity = fresh ? positive(account.summary?.marginBalance) : null;
  const limit = !profile?.riskClarificationRequired ? positive(profile?.maxLossPerTradePercent) : null;
  const riskLimit = limit !== null && limit <= 100 ? limit : null;
  const productMatches = /^BINANCE:FUTURES:[A-Z0-9]+USDT$/.test(analysis.marketId || "");
  const symbol = productMatches ? analysis.marketId.split(":").at(-1) : null;
  const positions = positionsKnown ? account.positions.filter(p => positive(p.amount)) : [];
  const ordersKnown = fresh && availableSource(account?.sources?.openOrders) && Array.isArray(account.openOrders);
  const matching = productMatches ? positions.filter(p => p.symbol === symbol) : [];
  const reviewed = matching.map(position => {
    const side = sideOf(position), qty = positive(position.amount), mark = positive(position.markPrice);
    const notional = positive(position.notionalValue) ?? (qty && mark ? qty * mark : null);
    const orders = ordersKnown ? account.openOrders.filter(order => order.symbol === position.symbol
      && order.side === (side === "long" ? "SELL" : "BUY")
      && ["STOP", "STOP_MARKET", "STOP_LOSS", "STOP_LOSS_LIMIT"].includes(order.orderType)
      && ["NEW", "PARTIALLY_FILLED", "ACCEPTED", "WORKING"].includes(order.status)
      && (order.positionSide === "BOTH" || String(order.positionSide).toLowerCase() === side)
      && (order.reduceOnly === true || order.closePosition === true)
      && positive(order.triggerPrice)) : [];
    const references = side ? referenceScenarios(analysis, side, now).map(ref => stopMeasurement(position, ref, equity, riskLimit)) : [];
    const liquidation = positive(position.liquidationPrice);
    return {
      symbol: position.symbol, side, quantity: qty, entryPrice: positive(position.entryPrice), markPrice: mark,
      notionalValue: notional, unrealizedPnl: number(position.unrealizedPnl),
      leverage: positive(position.leverage), marginType: position.marginType || null,
      notionalToEquity: equity && notional ? notional / equity : null,
      liquidationPrice: liquidation,
      liquidationDistancePercent: liquidation && mark && side
        ? (side === "long" ? mark - liquidation : liquidation - mark) / mark * 100 : null,
      protectiveOrders: {
        status: ordersKnown ? (orders.length ? "observed" : "no-matching-protective-order") : "unavailable",
        coverageVerified: false, // Normalized snapshots do not prove remaining base quantity.
        orders: orders.map(o => ({ triggerPrice: o.triggerPrice, orderType: o.orderType, closePosition: o.closePosition,
          reduceOnly: o.reduceOnly, workingType: o.workingType })),
      },
      referenceRisk: references,
      findings: [
        ...(!side || !qty || !positive(position.entryPrice) || !mark ? ["position-fields-incomplete"] : []),
        ...(!liquidation ? ["liquidation-price-unavailable"] : []),
        ...(!ordersKnown ? ["protective-orders-unavailable"] : orders.length ? ["stop-coverage-not-verified"] : ["no-matching-protective-order"]),
        ...(!references.length ? ["no-matching-strategy-stop-reference"] : []),
        ...(references.some(r => r.referenceAlreadyBreached) ? ["reference-invalidation-reached"] : []),
        ...(references.some(r => r.exceedsRiskBudget) ? ["reference-loss-exceeds-risk-budget"] : []),
        ...(positive(profile?.maxLeverage) && positive(position.leverage) > profile.maxLeverage ? ["leverage-exceeds-preference"] : []),
      ],
    };
  });
  return {
    schemaVersion: 1, kind: "position-evidence", answerRequired: true, snapshotTime: account?.fetchedAt || null,
    accountStatus: account?.available !== true ? "unavailable" : !fresh ? "stale-or-undated" : !positionsKnown ? "positions-unavailable" : "available",
    accountWarnings: account?.warnings || [], accountReason: account?.reason || null,
    marketMatchesAccountProduct: productMatches, equity, equityBasis: "futures-marginBalance-USDT",
    riskLimitPercent: riskLimit,
    preferences: profile || null,
    positions: reviewed,
    otherPositionsRequiringSeparateMarketEvidence: positions.filter(p => !matching.includes(p)).map(p => ({
      symbol: p.symbol, side: sideOf(p), quantity: positive(p.amount),
    })),
    noMatchingPosition: positionsKnown && productMatches && matching.length === 0,
    portfolioAssessmentComplete: false,
    limitations: [
      "This is evidence for the root's final answer, not a completed health assessment or an order.",
      "Existing position entry/quantity are account facts. Strategy trigger/stop/targets are hypothetical references, not actual fills or protective orders.",
      "Review every holding requested by the user. Unknown data, absent candidates and wait/no-trade signals never establish safety.",
      "Only give numeric adjustment estimates when supported by these measurements and current inputs. Do not replace existing-position net-risk calculations with a new-entry sizing formula that omits realized P&L, fees, funding or slippage.",
      ...(!equity ? ["Account equity unavailable; do not use wallet/available balance as a substitute or invent risk percentages."] : []),
      ...(riskLimit === null ? ["Effective net-loss limit unavailable or ambiguous; do not invent a compliant size."] : []),
    ],
  };
}
