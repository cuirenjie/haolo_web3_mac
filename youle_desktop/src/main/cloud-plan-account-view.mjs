// Presentation adapter for frozen account sizing. Missing V2 exit estimates
// use the existing product allocation rule; never mutate a plan or place orders.
import {defaultTakeProfitPercent, takeProfitNotionals} from './take-profit-allocation.mjs';
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function equal(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}

export function cloudPlanAccountView(plan, marketId, record) {
  const scenario = plan.scenarios?.[0], condition = plan.entryCondition;
  const perScenario = scenario?.positionSizing, sizing = perScenario || plan.positionSizing;
  if (!condition || !scenario || !sizing || plan.outcome?.action !== 'plan'
    || scenario.eligible !== true || plan.executionBlocked === true || sizing.executionBlocked === true
    || sizing.accountStatus !== 'available' || !sizing.accountPlan) return undefined;

  // Older structured records repeated the binding inside positionSizing.
  // If any such field exists, require the complete binding; do not silently
  // reinterpret a partial/mismatched legacy record as the compact V2 shape.
  const hasBinding = ['side', 'entry', 'stop', 'targets'].some(key => Object.hasOwn(sizing, key));
  if (hasBinding || !perScenario) {
    const matches = perScenario
      ? sizing.side === condition.direction && sizing.entry === scenario.entry && sizing.stop === scenario.stop
        && equal(sizing.targets, scenario.targets)
      : plan.preferredSide === condition.direction;
    return matches ? sizing.accountPlan : undefined;
  }

  // V2 binds sizing through its enclosing, receipt-validated scenario, not
  // duplicate side/price fields. Check that binding again for restored cards.
  const account = sizing.accountPlan;
  const predicate = condition.confirmation === 'breakout_retest' ? condition.retest : condition.trigger;
  const expectedEntry = predicate?.operator === 'in_zone' && condition.direction === 'long' ? predicate.upper : predicate?.lower;
  const market = /^BINANCE:FUTURES:(.+)(USDT)$/.exec(String(marketId));
  if (plan.schemaVersion !== 2 || plan.scenarios.length !== 1 || !market
    || record?.id !== plan.planId || !equal(record.scenario, scenario)
    || !['long', 'short'].includes(scenario.side) || scenario.side !== condition.direction
    || !/^[a-f0-9]{64}$/.test(plan.conditionHash || '') || scenario.conditionHash !== plan.conditionHash
    || !equal(scenario.entryCondition, condition) || scenario.confirmation !== condition.confirmation
    || !positive(scenario.entry) || scenario.entry !== expectedEntry || !positive(scenario.stop)
    || account.mode !== 'new_position' || sizing.quantityIsOrder !== false
    || account.entryPrice !== scenario.entry || !positive(account.quantity) || !positive(account.notional)
    || !positive(account.equity) || !positive(account.leverage) || !positive(account.snapshotAt)) return undefined;

  const expectedNotional = account.quantity * account.entryPrice;
  if (!Number.isFinite(expectedNotional) || Math.abs(account.notional - expectedNotional) > Math.max(1, expectedNotional) * 1e-10) return undefined;

  // V2 omits the legacy targetOrders. Apply the same existing allocation rule
  // to its frozen budget for display only. Keep explicit server exits intact.
  // Scale the server's net outcome by each allocated share, including its costs.
  const ratios = sizing.netRiskReward;
  const allocation = !Object.hasOwn(account, 'targetOrders')
    ? takeProfitNotionals(account.notional, scenario.targets.map((_, index) => defaultTakeProfitPercent(index, scenario.targets.length))) : undefined;
  const targetEstimates = allocation?.amounts.map((notional, targetIndex) => {
    const profit = nonnegative(account.estimatedStopLoss) && Array.isArray(ratios) && ratios.length === scenario.targets.length
      && Number.isFinite(ratios[targetIndex]) ? account.estimatedStopLoss * ratios[targetIndex] * notional / account.notional : undefined;
    return {price: scenario.targets[targetIndex], targetIndex, notional,
      estimatedNetProfit: Number.isFinite(profit) ? Math.floor((profit + Number.EPSILON) * 100) / 100 : undefined};
  });
  return {...account, baseAsset: market[1], currency: market[2], allocationNotional: allocation?.notional, targetEstimates};
}
