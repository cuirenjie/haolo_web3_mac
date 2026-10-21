import assert from 'node:assert/strict';
import test from 'node:test';
import {combineIndicatorPriceActionAnalysis, indicatorStructuralReport} from '../src/main/trading-analysis/indicator-price-action-analysis.mjs';
import {runRsiAnalysisPipeline} from '../src/main/trading-analysis/rsi-analysis-pipeline.mjs';
import {rsiAnalysisStrategyAdapter} from '../src/main/trading-strategy-runtime/builtins/rsi-analysis-adapter.mjs';
import {OFFICIAL_TRADING_CATALOG} from '../src/shared/official-trading-catalog.mjs';

const candles = Array.from({length: 200}, (_, i) => {
  const close = 100 + i * .02 + Math.sin(i / 5) * 3;
  return {time: 1700000000 + i * 3600, open: close - .1, high: close + 1, low: close - 1, close, volume: 100};
});
const params = {marketId: 'BINANCE:FUTURES:BTCUSDT', interval: '60', snapshotTime: 1700000000000 + 200 * 3600000, candles, language: 'en'};
const review = {schemaVersion: 1, verdict: 'approve', planSide: 'long', summary: 'Price structure and RSI confirm a conditional setup.',
  rationale: 'Wait for a resistance break with improving RSI momentum.', evidenceIds: ['price-action:price-action-market-range','rsi-analysis-price-action-context']};

test('indicator adapter returns both chart surfaces from one frozen model review', async () => {
  let calls = 0;
  const result = await rsiAnalysisStrategyAdapter.run(params, {providerId: 'fixture', modelRegistry: {async analyze(_provider, request) {
    calls++;
    assert.match(request.prompt, /indicatorEvidenceIds/);
    const sources = request.prompt.split('\n').map(line => {try {return JSON.parse(line);} catch {return null;}}).find(v => v?.priceActionEvidenceIds);
    return {text: JSON.stringify({...review, planSide: sources.allowedSides[0] || 'wait',
      evidenceIds: [sources.priceActionEvidenceIds[0], sources.indicatorEvidenceIds[0]]}), providerId: 'fixture', modelId: 'fixture'};
  }}});
  assert.equal(calls, 1);
  assert.ok(result.analysisPlan.drawingPatch.operations.some(o => o.drawing.id.includes('-price-action-')));
  assert.ok(result.analysisPlan.indicatorDrawingPatch.operations.length > 0);
  assert.equal(result.analysisPlan.drawingPatch.analysisId, result.analysisPlan.indicatorDrawingPatch.analysisId);
  assert.equal(result.theoryResult.priceActionAnalysis.engine.id, 'price-action');
  assert.equal(result.theoryResult.priceActionAnalysis.engine.mode, 'deterministic-ohlc-only');
});

test('a mismatched snapshot and cancellation cannot produce combined drawings', async () => {
  const native = await runRsiAnalysisPipeline(params);
  const options = {modelRegistry: {async analyze() {throw Error('must not call model');}}};
  await assert.rejects(combineIndicatorPriceActionAnalysis('rsi-analysis', {...params, marketId: 'BINANCE:FUTURES:ETHUSDT'}, native, options), /snapshot mismatch/);
  const controller = new AbortController();controller.abort();
  await assert.rejects(combineIndicatorPriceActionAnalysis('rsi-analysis', params, native, {...options, signal: controller.signal}), {name: 'AbortError'});
});

test('every official indicator advertises a combined plan capability', () => {
  const indicators = OFFICIAL_TRADING_CATALOG.filter(item => item.display.group === 'indicator');
  assert.equal(indicators.length, 6);
  assert.ok(indicators.every(item => item.capabilities.includes('execution-plan')));
});

test('combined reports retain indicator evidence without a second indicator-only plan', () => {
  for (const heading of ['标准执行方案', '當前執行方案', 'Current execution plan', 'Conditional execution']) {
    assert.equal(indicatorStructuralReport(`### Evidence\nNative indicator geometry\n### ${heading}\nOld entry/stop/targets\n### Data\nClosed bars`),
      '### Evidence\nNative indicator geometry\n### Data\nClosed bars');
  }
});
