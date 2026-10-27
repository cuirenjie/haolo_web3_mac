import assert from 'node:assert/strict';
import test from 'node:test';
import {
  tradingAnalysisDrawingFocusRange,
  tradingAnalysisPlanFocusRange,
  tradingAnalysisVisibleTimeRange,
} from '../src/renderer/trading-analysis-viewport.mjs';
import { tradingAiPlanFitRange } from '../src/renderer/trading-ai-plan-autoscale.ts';

const candles = Array.from({ length: 600 }, (_, i) => ({ time: 1_800_000_000 + i * 3600 }));
const point = (index, price) => ({ time: candles[0].time + index * 3600, price });
const structure = (identity = { theory: 'wyckoff' }) => [
  { ...identity, tool: 'rectangle', points: [point(320, 83629.27), point(580, 80511.19)] },
  { ...identity, tool: 'note', text: 'Phase A', points: [point(340, 83629.27)] },
  { ...identity, tool: 'path', points: [point(580, 80511.19), point(599, 80240.80), point(615, 77393.11)] },
];
const levels = [80999.90, 81809.90, 80385.10, 79801.10, 79393.20].map((price, i) => ({
  theory: 'strategy', strategyId: 'wyckoff',
  colorToken: i === 0 ? 'strategy-entry' : i === 1 ? 'strategy-stop' : 'strategy-target',
  points: [point(5, price), point(750, price)],
}));
const patch = drawings => ({ operations: drawings.map(drawing => ({ op: 'upsert', drawing })) });

test('Wyckoff playback and final plan focus contain the entire range, early phases and projection at both widths', () => {
  for (const identity of [{ theory: 'wyckoff' }, { theory: 'strategy', strategyId: 'wyckoff' }, { colorToken: 'wyckoff-range' }]) {
    for (const width of [420, 1040]) {
      const drawings = [...structure(identity), ...levels];
      const original = structuredClone({ drawings, candles });
      const before = tradingAnalysisDrawingFocusRange(patch(drawings), candles, width);
      const after = tradingAnalysisPlanFocusRange(drawings, candles, width);
      assert.deepEqual(before, after, 'completion must not zoom back to the recent candles');
      assert.ok(after.from < 320 && after.to > 615, JSON.stringify(after));
      assert.ok(after.from > 280 && after.to < 700, 'full-width plan endpoints must not determine the window');
      assert.deepEqual({ drawings, candles }, original, 'prices, phases and candles stay unchanged');
    }
  }
});

test('a Wyckoff structure without plan levels still fits its entire horizontal and vertical extent', () => {
  const drawings = structure({ colorToken: 'wyckoff-range' });
  const range = tradingAnalysisPlanFocusRange(drawings, candles, 1040);
  assert.ok(range.from < 320 && range.to > 615);
  const priceRange = tradingAiPlanFitRange([], drawings, tradingAnalysisVisibleTimeRange(candles, range));
  assert.ok(priceRange.minValue < 77393.11 && priceRange.maxValue > 83629.27);
});

test('a historical Wyckoff study stays historical and a first-candle range keeps its left border', () => {
  const drawings = [{ theory: 'wyckoff', points: [point(0, 100), point(200, 105)] }];
  const range = tradingAnalysisPlanFocusRange(drawings, candles, 1040);
  assert.ok(range.from < 0 && range.to > 200 && range.to < 250);
});

test('recent Wyckoff structure includes the nearby live candle without dropping the initial phase', () => {
  const range = tradingAnalysisPlanFocusRange([{ theory: 'wyckoff', points: [point(300, 100), point(590, 105)] }], candles, 1040);
  assert.ok(range.from < 300 && range.to > 599);
});

test('empty or invalid Wyckoff structures safely retain the existing fallback', () => {
  const invalid = [{ theory: 'wyckoff', points: [{ time: NaN, price: 100 }] }];
  assert.equal(tradingAnalysisPlanFocusRange(invalid, candles, 1040), null);
  assert.equal(tradingAnalysisDrawingFocusRange(patch(invalid), candles, 1040), null);
  assert.equal(tradingAnalysisPlanFocusRange(structure(), [], 1040), null);
});

test('other strategies and a text mention of Wyckoff keep the existing recent-candle viewport', () => {
  const genericStructure = structure({ theory: 'strategy' });
  const genericLevels = levels.map(({ strategyId, ...drawing }) => drawing);
  const reference = tradingAnalysisPlanFocusRange([...genericStructure, ...genericLevels], candles, 1040);
  assert.ok(reference.from > 450, 'the non-Wyckoff recent-candle policy remains in effect');
  for (const strategyId of ['price-action', 'chan', 'elliott', 'order-flow', 'harmonic-patterns', 'gann-theory', 'chart-patterns', 'personal-example']) {
    const drawings = [...genericStructure, ...genericLevels].map(drawing => ({ ...drawing, strategyId, text: 'Wyckoff 威科夫' }));
    assert.deepEqual(tradingAnalysisPlanFocusRange(drawings, candles, 1040), reference, strategyId);
    assert.deepEqual(tradingAnalysisDrawingFocusRange(patch(drawings), candles, 1040), reference, strategyId);
  }
  assert.equal(tradingAiPlanFitRange([], genericStructure), null, 'other strategies do not gain geometry-only autoscale');
});

test('Wyckoff vertical fit contains all plan levels and only contributes visible structure after manual navigation', () => {
  const drawings = [...structure(), { theory: 'strategy', strategyId: 'price-action', points: [point(580, 200000)] }];
  const geometryOnly = tradingAiPlanFitRange([], drawings, { from: point(580, 0).time, to: point(620, 0).time });
  assert.ok(geometryOnly.maxValue < 84000, 'unrelated no-plan geometry does not enter Wyckoff autoscale');
  const full = tradingAiPlanFitRange(levels.map(d => d.points[0].price), structure(),
    tradingAnalysisVisibleTimeRange(candles, tradingAnalysisPlanFocusRange([...structure(), ...levels], candles, 1040)));
  assert.ok(full.minValue < 77393.11 && full.maxValue > 83629.27);
  assert.equal(tradingAiPlanFitRange([], structure(), { from: point(700, 0).time, to: point(720, 0).time }), null);
});
