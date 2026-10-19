import fs from 'node:fs';
import {normalizeCloudReports} from '../../src/main/cloud-plan-contract.mjs';
import {cloudAccountPlanCardFixture} from './cloud-plan-card-fixture.mjs';

export const screenshotMetrics = JSON.parse(fs.readFileSync(new URL('../fixtures/plan-metrics-screenshot.json', import.meta.url)));
export const revaluedMetrics = JSON.parse(fs.readFileSync(new URL('../fixtures/plan-metrics-target-stop.json', import.meta.url)));

export function screenshotReport(locale = 'zh-CN', side = 'long', scale = 1, source = revaluedMetrics) {
  const report = cloudAccountPlanCardFixture(locale, side), plan = report.executionPlan, scenario = plan.scenarios[0];
  const sign = side === 'long' ? 1 : -1, price = value => (source.entry + sign * (value - source.entry)) * scale;
  plan.selectedMode = plan.requestedMode = 'left';
  Object.assign(plan.entryCondition, {direction: side, confirmation: 'touch', interval: '15m', trigger: {
    operator: 'in_zone', lower: price(side === 'long' ? source.entryZone.lower : source.entryZone.upper),
    upper: price(side === 'long' ? source.entryZone.upper : source.entryZone.lower),
  }, invalidation: {operator: side === 'long' ? 'at_or_below' : 'at_or_above', lower: price(source.stop)}});
  Object.assign(scenario, {side, entry: price(source.entry), stop: price(source.stop), targets: source.targets.map(price),
    confirmation: 'touch', entryCondition: structuredClone(plan.entryCondition), riskReward: [...source.netRiskReward]});
  Object.assign(scenario.positionSizing, {estimatedRoundTripCostRate: source.estimatedRoundTripCostRate, netRiskReward: [...source.netRiskReward]});
  Object.assign(scenario.positionSizing.accountPlan, {equity: 1000, entryPrice: scenario.entry, quantity: source.quantity / scale,
    notional: source.notional, estimatedStopLoss: source.estimatedStopLoss});
  plan.positionSizing = structuredClone(scenario.positionSizing);
  report.planRecords[0].scenario = structuredClone(scenario);
  return normalizeCloudReports(JSON.parse(JSON.stringify([report])))[0];
}
