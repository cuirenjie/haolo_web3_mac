import assert from 'node:assert/strict';
import test from 'node:test';
import { OFFICIAL_TRADING_CATALOG } from '../src/shared/official-trading-catalog.mjs';
import { nativeAiDrawingDisplayModel, nativeAiDrawingDefaults, usesNativeAiDrawingStyle, isHiddenOrderFlowAnnotation, renderNativeAiHarmonicPath } from '../src/renderer/trading-ai-native-style.ts';
import { manualDrawingDefaults } from '../src/renderer/trading-drawing-defaults.ts';
import { renderReferencePattern, renderPatternBadge } from '../src/renderer/trading-patterns.ts';
import { renderIndicatorAnalysisPatch } from '../src/renderer/cloud-indicator-drawings.ts';

const points = Object.freeze([100, 200, 138.2, 183.2, 121.4].map((price, i) => Object.freeze({ time: 1700000000 + i * 3600, price })));
const model = (overrides = {}) => ({ id: 'analysis-xabcd', strategyId: 'harmonic', source: 'ai', symbol: 'BTCUSDT', interval: '1h', tool: 'path',
  points, locked: true, colorToken: 'strategy-support', lineWidth: 3, lineStyle: 'solid', ...overrides });
const screen = points.map((p, i) => ({ x: 80 + i * 170, y: 700 - p.price * 2 }));

test('all catalog strategies use native styles except price-action and Wyckoff, including legacy tokens', () => {
  for (const item of OFFICIAL_TRADING_CATALOG) {
    const drawing = model({ strategyId: item.id });
    assert.equal(usesNativeAiDrawingStyle(drawing), !['price-action', 'wyckoff'].includes(item.id), item.id);
  }
  for (const colorToken of ['price-action-trend', 'price-action-support', 'wyckoff-range', 'wyckoff-projection']) {
    const drawing = Object.freeze(model({ strategyId: undefined, colorToken }));
    assert.equal(nativeAiDrawingDisplayModel(drawing), drawing);
  }
  const manual = Object.freeze(model({ source: 'manual', color: '#123456' }));
  assert.equal(nativeAiDrawingDisplayModel(manual), manual);
});

test('presentation changes only color and width, preserving accepted anchors, semantics and historical text', () => {
  const drawing = Object.freeze(model({ lineStyle: 'dashed', text: 'C? 预测', fontSize: 18,
    entryConditionRef: Object.freeze({ conditionId: 'condition', revision: 2, conditionHash: 'hash' }) }));
  const before = JSON.stringify(drawing), display = nativeAiDrawingDisplayModel(drawing);
  assert.equal(JSON.stringify(drawing), before);
  assert.equal(display.points, drawing.points);
  assert.deepEqual({ ...display, color: undefined, lineWidth: drawing.lineWidth }, { ...drawing, color: undefined });
  assert.equal(display.color, manualDrawingDefaults('xabcd').color);
  assert.equal(display.lineWidth, manualDrawingDefaults('xabcd').lineWidth);
  assert.deepEqual(nativeAiDrawingDisplayModel(display), display);
});

test('complete harmonic legs and fill match the native tool without generating extra ratios or labels', () => {
  const drawing = nativeAiDrawingDisplayModel(model());
  const ai = renderNativeAiHarmonicPath(drawing, screen);
  const manual = renderReferencePattern({ ...drawing, source: 'manual', tool: 'xabcd' }, screen).body;
  assert.equal(ai, manual.slice(0, manual.indexOf('<line data-harmonic-chord')));
  assert.doesNotMatch(ai, /data-harmonic-ratio|data-harmonic-point/);
});

test('developing Shark keeps its four confirmed anchors, one fill and separate dashed terminal leg', () => {
  const drawing = nativeAiDrawingDisplayModel(model({ id: 'shark-0xab-developing', points: points.slice(0, 4) }));
  const body = renderNativeAiHarmonicPath(drawing, screen.slice(0, 4));
  assert.equal((body.match(/data-harmonic-fill/g) || []).length, 1);
  assert.ok(body.includes(`points="${screen.slice(0, 4).map(p => `${p.x},${p.y}`).join(' ')}"`));
  const projection = nativeAiDrawingDisplayModel(model({ id: 'shark-projected-terminal-leg', points: points.slice(3), lineStyle: 'dashed' }));
  const projected = renderNativeAiHarmonicPath(projection, screen.slice(3));
  assert.match(projected, /stroke-dasharray="8 5"/);
  assert.doesNotMatch(projected, /data-harmonic-fill/);
  const guide = renderNativeAiHarmonicPath(nativeAiDrawingDisplayModel(model({ id: 'shark-ratio-line-ab-xa', lineStyle: 'dotted' })), [screen[1], screen[3]]);
  assert.match(guide, /stroke-width="1" stroke-dasharray="1 3"/);
});

test('annotations from every strategy retain original colors, text, sizing and leaders', () => {
  for (const item of OFFICIAL_TRADING_CATALOG) for (const tool of ['note', 'text']) {
    const drawing = Object.freeze(model({ strategyId: item.id, tool, text: '[1H] OB', fontSize: 12, lineWidth: 1.5 }));
    assert.equal(nativeAiDrawingDisplayModel(drawing), drawing);
  }
  for (const [suffix, text] of [['point-0', '0'], ['point-x', 'X'], ['point-a', 'A'], ['point-b', 'B'], ['point-c', 'C'],
    ['ratio-label-ab-xa', 'AB/XA 1.248'], ['ratio-label-cd-projections', 'CD/BC 1.618 · CD/AB 1.272'], ['projected-terminal-label', 'C? 预测']]) {
    const drawing = Object.freeze(model({ id: `shark-${suffix}`, tool: 'text', points: [points[0]], fontSize: 14, text }));
    assert.equal(nativeAiDrawingDisplayModel(drawing), drawing);
  }
  // The shared badge primitive still belongs to the unchanged manual tool.
  assert.doesNotMatch(renderPatternBadge(model(), '<script>"&', screen[0], '').body, /<script>/);
});

test('order-flow buy/sell text is hidden by semantics in all languages, without touching shapes or stored drawings', () => {
  for (const colorToken of ['order-flow-buy', 'order-flow-sell']) {
    for (const text of ['大额主动买入', '大额主动卖出 ×3', '主动卖出失衡区', 'large aggressive buys', 'sell imbalance zone', '大額主動賣出']) {
      for (const tool of ['note', 'text']) {
        const drawing = Object.freeze(model({ strategyId: undefined, tool, text, colorToken }));
        assert.equal(isHiddenOrderFlowAnnotation(drawing), true);
        assert.equal(nativeAiDrawingDisplayModel(drawing), drawing);
        assert.equal(isHiddenOrderFlowAnnotation({ ...drawing, source: 'manual' }), false);
      }
    }
    for (const tool of ['path', 'rectangle', 'arrow-up', 'arrow-down', 'ellipse']) {
      assert.equal(isHiddenOrderFlowAnnotation(model({ strategyId: undefined, tool, colorToken })), false);
    }
  }
  for (const colorToken of ['order-flow-poc', 'order-flow-note', 'order-flow-ob-bull', 'order-flow-structure-bear', 'order-flow-liquidity', 'strategy-support']) {
    assert.equal(isHiddenOrderFlowAnnotation(model({ tool: 'note', colorToken })), false);
  }
});

test('ordinary paths, wave strokes and regions share corresponding native tool defaults', () => {
  for (const tool of ['path', 'rectangle', 'circle', 'ellipse', 'arrow-up', 'arrow-down', 'text', 'note']) {
    const drawing = model({ tool, strategyId: 'ict-smc' });
    assert.deepEqual(nativeAiDrawingDefaults(drawing), manualDrawingDefaults(tool));
    assert.equal(renderNativeAiHarmonicPath(drawing, screen), null);
  }
  assert.deepEqual(nativeAiDrawingDefaults(model({ strategyId: undefined, colorToken: 'wave-primary' })), manualDrawingDefaults('elliott-impulse'));
  assert.deepEqual(nativeAiDrawingDefaults(model({ tool: 'text', strategyId: undefined, colorToken: 'wave-primary' })), manualDrawingDefaults('elliott-impulse'));
});

test('indicator paths use native styling while retaining their existing value and timestamp projection', () => {
  for (const dark of [false, true]) {
    const drawing = { id: 'indicator-divergence', strategyId: 'rsi-analysis', tool: 'path', colorToken: 'strategy-support', lineWidth: 4, lineStyle: 'dashed',
      points: [{ time: 100, value: 40 }, { time: 99, value: 60 }, { time: 100, value: 45 }] };
    const patch = { indicatorId: 'rsi', operations: [{ op: 'upsert', drawing }] }, before = JSON.stringify(patch);
    const added = [];
    const runtime = { pane: { addSeries: () => assert.fail('annotation must not add a data series') },
      series: [{ api: { attachPrimitive: p => added.push(p), priceScale: () => ({ setAutoScale() {} }) } }], analysisSeries: [], analysisMarkers: null, analysisSignature: '' };
    renderIndicatorAnalysisPatch({ chart: { removeSeries() {} }, runtime, patch, host: {}, dark, timeOffsetSeconds: 28800, getCandles: () => [] });
    assert.equal(added[0].paths[0].color, manualDrawingDefaults('path').color);
    assert.equal(added[0].paths[0].lineWidth, manualDrawingDefaults('path').lineWidth);
    assert.equal(added[0].paths[0].lineStyle, 'dashed');
    assert.deepEqual(added[0].paths[0].points, drawing.points);
    assert.equal(JSON.stringify(patch), before);
  }
});
