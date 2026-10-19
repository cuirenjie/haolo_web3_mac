import assert from 'node:assert/strict';
import test from 'node:test';
import {cloudPlanAccountView} from '../src/main/cloud-plan-account-view.mjs';
import {cloudPlanCard} from '../src/main/cloud-plan-contract.mjs';
import {executionPlanStickyHtml} from '../src/main/execution-plan-sticky-view.mjs';
import {takeProfitNotionals} from '../src/main/take-profit-allocation.mjs';
import {mergeCloudExecutionPlans} from '../src/renderer/cloud-plan-sync.ts';
import {screenshotReport, revaluedMetrics as source, screenshotMetrics as historical} from './support/plan-metrics-fixture.mjs';
import {renderCurrentReports, renderCurrentSavedPlan} from './support/right-renderer-parity.mjs';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-12, `${actual} != ${expected}`);

test('screenshot uses long lower / short upper for both display and sizing, then rounds accumulated profit', () => {
  for (const locale of ['zh-CN', 'zh-Hant', 'en']) for (const side of ['long', 'short']) {
    const report = screenshotReport(locale, side), before = structuredClone(report);
    const scenario = report.executionPlan.scenarios[0], sign = side === 'long' ? 1 : -1;
    const account = cloudPlanAccountView(report.executionPlan, report.marketId, report.planRecords[0]);
    assert.equal(scenario.entry, report.executionPlan.entryCondition.trigger[side === 'long' ? 'lower' : 'upper']);
    assert.equal(account.entryPrice, scenario.entry);
    assert.deepEqual(account.targetEstimates.map(order => order.notional), [1.63, 1.63, 1.7]);
    const risk = sign * (scenario.entry - scenario.stop) + scenario.entry * source.estimatedRoundTripCostRate;
    close(account.estimatedStopLoss, account.quantity * risk);
    let cumulative = 0;
    const expected = ['0.03', '0.06', '0.10'];
    for (const [i, target] of scenario.targets.entries()) {
      const reward = sign * (target - scenario.entry) - scenario.entry * source.estimatedRoundTripCostRate;
      close(scenario.riskReward[i], reward / risk);
      const order = account.targetEstimates[i];
      close(order.estimatedNetProfit, order.notional / scenario.entry * reward);
      cumulative += order.estimatedNetProfit;
      assert.equal(cumulative.toFixed(2), expected[i]);
    }
    const saved = mergeCloudExecutionPlans([report], [])[0], language = locale === 'zh-Hant' ? 'zh-TW' : locale;
    for (const html of [cloudPlanCard(report).html, renderCurrentReports([report]).rendered.cards,
      renderCurrentSavedPlan(saved, language), executionPlanStickyHtml({cloudReport: report, language})]) {
      assert.match(html, /execution-plan-price (?:bullish|bearish)">80681\.26</);
      for (const value of ['1:1.00', '1:1.13', '1:1.21', '-0.09', '+0.03', '+0.06', '+0.10']) assert.ok(html.includes(value), value);
      assert.doesNotMatch(html, />81490\.77<|>82300\.28<|1:0\.49|>\+0\.02<|>\+0\.04</);
    }
    assert.deepEqual(report, before, 'history, quantities and signed receipts remain immutable');
  }
});

test('old receipts keep their original data and never attach old estimates to the favorable entry', () => {
  for (const locale of ['zh-CN', 'zh-Hant', 'en']) for (const side of ['long', 'short']) {
    const report = screenshotReport(locale, side, 1, historical), before = structuredClone(report);
    assert.equal(cloudPlanAccountView(report.executionPlan, report.marketId, report.planRecords[0]), undefined);
    const language = locale === 'zh-Hant' ? 'zh-TW' : locale;
    const notice = locale === 'en' ? 'previous entry basis' : locale === 'zh-Hant' ? '舊入場口徑' : '旧入场口径';
    const saved = mergeCloudExecutionPlans([report], [])[0];
    for (const html of [cloudPlanCard(report).html, renderCurrentReports([report]).rendered.cards,
      renderCurrentSavedPlan(saved, language), executionPlanStickyHtml({cloudReport: report, language})]) {
      assert.ok(html.includes(notice));
      assert.doesNotMatch(html, /1:0\.49|1:0\.64|1:0\.73|class="execution-plan-account-detail/);
    }
    assert.deepEqual(report, before);
  }
});

test('full-precision net estimates are scale invariant for low-priced assets and mirrored shorts', () => {
  for (const side of ['long', 'short']) for (const scale of [1, 1e-6, 1e-12, 1e3]) {
    const report = screenshotReport('zh-CN', side);
    const base = cloudPlanAccountView(report.executionPlan, report.marketId, report.planRecords[0]);
    const scaled = screenshotReport('zh-CN', side, scale);
    const result = cloudPlanAccountView(scaled.executionPlan, scaled.marketId, scaled.planRecords[0]);
    for (const [i, order] of result.targetEstimates.entries()) close(order.estimatedNetProfit, base.targetEstimates[i].estimatedNetProfit);
  }
});

test('decimal-cent allocations never drop a cent at a binary floating point boundary', () => {
  for (let cents = 1; cents <= 10000; cents++) {
    const result = takeProfitNotionals(cents / 100, [33, 33, 34]);
    assert.equal(result.notional, cents / 100);
    assert.equal(result.amounts.reduce((sum, amount) => sum + Math.round(amount * 100), 0), cents);
  }
  assert.deepEqual(takeProfitNotionals(1.13, [100]), {notional: 1.13, amounts: [1.13]});
  assert.deepEqual(takeProfitNotionals(100, [1.15, 98.85]), {notional: 100, amounts: [1.15, 98.85]});
  assert.equal(takeProfitNotionals(1.1299999999999997, [100]).notional, 1.12, 'do not round a genuinely smaller budget up');
  assert.equal(takeProfitNotionals(1e-8, [100]), undefined);
  assert.equal(takeProfitNotionals(1e20, [100]), undefined);
});
