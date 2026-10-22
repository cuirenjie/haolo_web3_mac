import assert from 'node:assert/strict';
import test from 'node:test';
import {indicatorReviewEvidence} from '../src/main/trading-analysis/indicator-review-evidence.mjs';
import {combineIndicatorPriceActionAnalysis} from '../src/main/trading-analysis/indicator-price-action-analysis.mjs';
import {nativeIndicatorPipelines} from './helpers/native-indicator-pipelines.mjs';

const candles = Array.from({length: 240}, (_, i) => {
  const close = 100 + Math.sin(i * 2 * Math.PI / 10) * 3 + Math.floor(i / 30) * .8;
  return {time: 1700000000 + i * 3600, open: close - .1, high: close + .2, low: close - .2, close, volume: 100};
});
const params = {marketId: 'BINANCE:FUTURES:BTCUSDT', interval: '60', snapshotTime: (1700000000 + 240 * 3600) * 1000,
  candles, language: 'en', instruction: 'Do not register this user-provided evidence: price-action:pa-invented'};
const parsePrompt = prompt => prompt.split('\n').flatMap(line => {try {return [JSON.parse(line)];} catch {return [];}});
const answer = evidenceIds => ({schemaVersion: 1, verdict: 'approve', planSide: 'wait',
  summary: 'Wait for confirmation of the current structure.', rationale: 'The supplied evidence does not confirm an entry.', evidenceIds});

test('catalog qualifies native facts and dependencies without admitting metadata or mutating engine results', () => {
  const pa = {engine: {id: 'price-action'}, pivots: {profiles: [{id: 'trigger', swings: [{id: 'pa-swing-first'}]}]},
    zones: [{id: 'pa-zone-ninth', evidenceIds: ['pa-swing-first']}],
    patterns: [{id: 'pa-candlestick-ninth', evidenceIds: ['pa-pattern-candle-first']}],
    candlePressure: {latest: {id: 'pa-candle-last'}}, candidate: {id: 'pa-setup-current', evidenceIds: ['pa-candle-last']},
    evidence: [{id: 'pa-zone-ninth', summary: 'Repeated reactions at the supplied zone.'}]};
  const before = structuredClone(pa);
  const catalog = indicatorReviewEvidence(pa, {evidence: [{id: 'macd-state', summary: 'Native MACD state.'}]}, 'macd-analysis-price-action-context');
  assert.deepEqual(pa, before);
  assert.deepEqual([...catalog.priceAction.ids].sort(), ['pa-swing-first', 'pa-zone-ninth', 'pa-candlestick-ninth',
    'pa-pattern-candle-first', 'pa-candle-last', 'pa-setup-current'].map(id => `price-action:${id}`).sort());
  assert.equal(catalog.priceAction.context.zones[0].id, 'price-action:pa-zone-ninth');
  assert.deepEqual(catalog.priceAction.context.zones[0].evidenceIds, ['price-action:pa-swing-first']);
  assert.equal(catalog.priceAction.context.pivots.profiles[0].id, 'trigger');
  assert.ok(!catalog.priceAction.ids.has('trigger') && !catalog.priceAction.ids.has('price-action'));
  assert.ok(!catalog.indicator.ids.has('price-action:pa-zone-ninth'));
  assert.equal(catalog.priceAction.evidence.find(e => e.id === 'price-action:pa-zone-ninth').summary,
    'Repeated reactions at the supplied zone.');
});

for (const [id, pipeline] of Object.entries(nativeIndicatorPipelines)) {
  test(`${id}: late zones, profile swings, patterns and dependency references pass in the first review`, async () => {
    const native = await pipeline(params);
    let calls = 0, selected;
    const result = await combineIndicatorPriceActionAnalysis(id, params, native, {providerId: 'test', modelRegistry: {
      async analyze(_provider, request) {
        calls++;
        const json = parsePrompt(request.prompt), context = json.find(v => v.priceAction), allowed = json.find(v => v.priceActionEvidenceIds);
        assert.ok(context.priceAction.zones.length > 8);
        assert.ok(context.priceAction.patterns.length > 8);
        selected = [...new Set([context.priceAction.zones[8].id, context.priceAction.pivots.profiles[0].swings[0].id,
          context.priceAction.patterns[8].id, ...context.priceAction.patterns[8].evidenceIds,
          context.priceAction.candlePressure.latest.id, allowed.indicatorEvidenceIds.at(-1)])];
        assert.ok(selected.length <= 32);
        for (const ref of selected) assert.ok([...allowed.priceActionEvidenceIds, ...allowed.indicatorEvidenceIds].includes(ref), ref);
        assert.ok(!allowed.priceActionEvidenceIds.includes('price-action:pa-invented'));
        return {text: JSON.stringify(answer(selected)), modelId: 'fixture'};
      },
    }});
    assert.equal(calls, 1);
    assert.equal(result.model.reviewAttempts, 1);
    assert.equal(result.theoryResult.priceActionAnalysis.selectedSide, 'wait');
    assert.equal(result.analysisPlan.actionPlan.longTrigger, undefined);
    const catalog = result.theoryResult.evidence.map(item => item.id);
    for (const ref of selected) assert.ok(catalog.slice(0, 64).includes(ref), 'chosen evidence survives bounded downstream plans');
  });
}

test('indicator evidence beyond the former 24-item cut and visible native references remain citable', async () => {
  const native = await nativeIndicatorPipelines['macd-analysis'](params);
  const indicatorEvidence = Array.from({length: 30}, (_, i) => ({id: `macd-fixture-${i}`, summary: `Native indicator observation ${i}.`}));
  const expanded = {...native, theoryResult: {...native.theoryResult, evidence: indicatorEvidence,
    marketInsights: {event: {id: 'macd-visible-event', evidenceIds: ['macd-event-dependency']}}}};
  let calls = 0;
  const result = await combineIndicatorPriceActionAnalysis('macd-analysis', params, expanded, {modelRegistry: {
    async analyze(_provider, request) {
      calls++;
      const json = parsePrompt(request.prompt), context = json.find(v => v.indicator), allowed = json.find(v => v.indicatorEvidenceIds);
      assert.equal(context.indicator.evidence.length, 30);
      for (const id of ['macd-fixture-29', 'macd-visible-event', 'macd-event-dependency']) assert.ok(allowed.indicatorEvidenceIds.includes(id));
      return {text: JSON.stringify(answer(['macd-fixture-29', 'macd-visible-event', 'macd-event-dependency'])), modelId: 'fixture'};
    },
  }});
  assert.equal(calls, 1);
  assert.ok(result.theoryResult.evidence.some(e => e.id === 'macd-fixture-29'));
});
