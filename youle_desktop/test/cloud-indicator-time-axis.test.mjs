import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchTradingChartLibrary } from '../scripts/trading-chart-library-patch.mjs';
import { renderIndicatorAnalysisPatch, clearIndicatorAnalysisRuntime, storeCloudIndicatorPatch, loadCloudIndicatorPatch } from '../src/renderer/cloud-indicator-drawings.ts';
import { indicatorDrawingTimeCoordinate } from '../src/renderer/trading-indicator-drawing-primitive.ts';
import { TRADING_INDICATORS } from '../src/renderer/trading-expert-indicators.ts';
import { runKdjAnalysisPipeline } from '../src/main/trading-analysis/kdj-analysis-pipeline.mjs';
import { runRsiAnalysisPipeline } from '../src/main/trading-analysis/rsi-analysis-pipeline.mjs';
import { runMacdAnalysisPipeline } from '../src/main/trading-analysis/macd-analysis-pipeline.mjs';

// Use the installed, hash-guarded production DataLayer in memory. No altered
// dependency files, DOM substitute for time merging, or hand-built union oracle.
const source = patchTradingChartLibrary(readFileSync(new URL('../node_modules/lightweight-charts/dist/lightweight-charts.development.mjs', import.meta.url), 'utf8'));
const { DataLayer, HorzScaleBehaviorTime } = Function(source
  .replace(/^import .* from 'fancy-canvas';$/m, '')
  .replace(/^export \{[^\n]+\};$/m, '') + '\nreturn { DataLayer, HorzScaleBehaviorTime };')();
const START = 1792627200, STEP = 3600, OFFSET = 28800;
const candles = () => Array.from({ length: 140 }, (_, i) => {
  const close = 100 + Math.sin(i / 4) * 8 + Math.sin(i / 11) * 3 + i * .02;
  return { time: START + i * STEP, open: close - .2, high: close + .9, low: close - .9, close, volume: 100 + i };
});
const params = bars => ({ marketId: 'BINANCE:FUTURES:BTCUSDT', interval: '60', snapshotTime: (bars.at(-1).time + STEP) * 1000, candles: bars });

function harness() {
  const layer = new DataLayer(new HorzScaleBehaviorTime());
  const active = new Set(), removed = [];
  let bars = candles();
  const timeScale = {
    timeToCoordinate: time => { const i = layer._private__sortedTimePoints.findIndex(p => p.originalTime === time); return i < 0 ? null : 20 + i * 8; },
    coordinateToLogical: x => (x - 20) / 8,
  };
  const chart = { timeScale: () => timeScale, removeSeries: api => { removed.push(api); layer._internal_removeSeries(api.native); } };
  const makeSeries = type => {
    const native = { _internal_seriesType: () => type, _internal_customSeriesPlotValuesBuilder: () => undefined, _internal_customSeriesWhitespaceCheck: () => undefined };
    const api = { native, setData: data => layer._internal_setSeriesData(native, data),
      attachPrimitive(p) { active.add(p); p.attached({ chart, series: api }); },
      detachPrimitive(p) { active.delete(p); p.detached(); },
      priceToCoordinate: value => 200 - value, priceScale: () => ({ setAutoScale() {} }),
    };
    return api;
  };
  const price = makeSeries('Candlestick'), volume = makeSeries('Histogram'), macd = makeSeries('Histogram'), indicator = makeSeries('Line');
  const write = () => {
    price.setData(bars.map(b => ({ ...b, time: b.time + OFFSET })));
    volume.setData(bars.map(b => ({ time: b.time + OFFSET, value: b.volume })));
    macd.setData(bars.map((b, i) => ({ time: b.time + OFFSET, value: Math.sin(i) * 5 })));
    indicator.setData(bars.map((b, i) => ({ time: b.time + OFFSET, value: 50 + Math.sin(i) * 30 })));
  };
  write();
  const runtime = { pane: { addSeries: () => makeSeries('Line') }, series: [{ api: indicator }], analysisSeries: [], analysisMarkers: null, analysisSignature: '' };
  const options = { chart, runtime, host: {}, timeOffsetSeconds: OFFSET, getCandles: () => bars };
  const snapshot = () => ({
    times: layer._private__sortedTimePoints.map(p => p.originalTime),
    series: [price, volume, macd, indicator].map(api => layer._private__seriesRowsBySeries.get(api.native).map(row => ({
      time: row._internal_originalTime, index: row._internal_index, values: [...row._internal_value], x: timeScale.timeToCoordinate(row._internal_originalTime),
    }))),
  });
  const draw = () => {
    const calls = [];
    const context = new Proxy({}, { get: (_, key) => (...args) => calls.push([key, ...args]), set: () => true });
    for (const p of active) p.paneViews()[0].renderer().draw({ useMediaCoordinateSpace: fn => fn({ context, mediaSize: { width: 1200, height: 250 } }) });
    return calls;
  };
  return { options, runtime, snapshot, draw, active, removed, bars: () => bars,
    replace(next) { bars = next; write(); },
  };
}

globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#6d4acb' });

function patch(id = 'rsi') {
  const drawing = (tool, suffix, points, extra = {}) => ({ op: 'upsert', drawing: {
    id: suffix, strategyId: `${id}-analysis`, theory: 'strategy', layer: `ai/strategy/${id}-analysis`, tool, points, colorToken: 'strategy-note', ...extra,
  } });
  const time = START + STEP * 100 + 1234;
  return { schemaVersion: 1, analysisId: 'legacy', marketId: 'BINANCE:FUTURES:BTCUSDT', interval: '60', indicatorId: id, operations: [
    drawing('path', 'leader', [{ time, value: -10 }, { time: time + 1, value: 38 }], { lineStyle: 'dashed' }),
    drawing('path', 'vertical-and-reverse', [{ time, value: 20 }, { time, value: 40 }, { time: time - STEP, value: 60 }]),
    drawing('note', 'dot', [{ time, value: -10 }], { markerSize: .35 }),
    drawing('text', 'label', [{ time, value: 38 }], { markerSize: 0, text: '低位金叉 / Crossover / 低位金叉' }),
  ] };
}

for (const [id, pipeline] of [['kdj', runKdjAnalysisPipeline], ['rsi', runRsiAnalysisPipeline], ['macd', runMacdAnalysisPipeline]]) {
  for (const dark of [false, true]) test(`${id} actual engine annotations preserve every candle, volume and MACD bar (${dark ? 'dark' : 'light'})`, async () => {
    const h = harness(), baseline = h.snapshot();
    const result = await pipeline(params(h.bars()));
    const drawing = result.analysisPlan.indicatorDrawingPatch, before = JSON.stringify(drawing);
    assert.ok(drawing.operations.some(o => o.drawing.tool === 'path'));
    renderIndicatorAnalysisPatch({ ...h.options, dark, patch: drawing });
    assert.deepEqual(h.snapshot(), baseline);
    assert.ok(h.draw().some(c => c[0] === 'lineTo'), 'annotations still draw');
    assert.equal(JSON.stringify(drawing), before);
    clearIndicatorAnalysisRuntime(h.options.chart, h.runtime);
    assert.deepEqual(h.snapshot(), baseline); assert.equal(h.active.size, 0);
  });
}

for (const { id } of TRADING_INDICATORS) test(`${id} shared entry handles off-grid, duplicate and reversed times across lifecycle`, () => {
  const h = harness(), baseline = h.snapshot(), original = patch(id), before = JSON.stringify(original);
  const apply = (value, extra = {}) => { renderIndicatorAnalysisPatch({ ...h.options, dark: false, patch: value, ...extra }); assert.deepEqual(h.snapshot(), baseline); };
  apply(original); assert.equal(h.active.size, 1);
  const first = h.runtime.analysisPrimitive;
  apply(original); assert.equal(h.runtime.analysisPrimitive, first, 'identical input is idempotent');
  apply({ ...original, analysisId: 'revision-2' }); assert.equal(h.active.size, 1); assert.ok(!h.active.has(first));
  apply(original, { dark: true, force: true }); assert.equal(h.active.size, 1);
  apply(null); assert.equal(h.active.size, 0);
  apply(original); assert.equal(h.active.size, 1);
  assert.equal(JSON.stringify(original), before);
  assert.deepEqual(h.runtime.analysisPrimitive.paths[1].points, original.operations[1].drawing.points);
  clearIndicatorAnalysisRuntime(h.options.chart, h.runtime); assert.deepEqual(h.snapshot(), baseline);
});

test('cache recovery and multiple independent indicator panes never accumulate extra times', () => {
  const storage = new Map(); globalThis.window = { localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) } };
  const h = harness(), other = harness(), baseline = h.snapshot(), secondary = other.snapshot();
  for (const id of ['kdj', 'rsi', 'macd']) {
    const p = storeCloudIndicatorPatch('saved', patch(id));
    const runtime = { ...h.runtime, analysisPrimitive: undefined, analysisSignature: '' };
    renderIndicatorAnalysisPatch({ ...h.options, runtime, dark: false, patch: p });
    const saved = loadCloudIndicatorPatch('saved', p.marketId, p.interval, id);
    renderIndicatorAnalysisPatch({ ...other.options, dark: true, patch: saved });
    assert.deepEqual(h.snapshot(), baseline); assert.deepEqual(other.snapshot(), secondary);
    clearIndicatorAnalysisRuntime(h.options.chart, runtime);
  }
  clearIndicatorAnalysisRuntime(other.options.chart, other.runtime);
  assert.equal(h.active.size, 0); assert.equal(other.active.size, 0);
});

test('live append, history backfill and period replacement preserve actual data and reproject annotations', () => {
  const h = harness();
  renderIndicatorAnalysisPatch({ ...h.options, dark: false, patch: patch() });
  for (const mutate of [
    bars => [...bars, { ...bars.at(-1), time: bars.at(-1).time + STEP }],
    bars => [{ ...bars[0], time: bars[0].time - STEP }, ...bars],
    bars => bars.map((bar, i) => ({ ...bar, time: START + i * 300 })),
  ]) {
    h.replace(mutate(h.bars()));
    const expected = h.snapshot();
    h.draw(); assert.deepEqual(h.snapshot(), expected);
    assert.equal(expected.times.length, h.bars().length);
    expected.series.forEach(s => assert.equal(s.length, h.bars().length));
  }
  clearIndicatorAnalysisRuntime(h.options.chart, h.runtime); assert.equal(h.active.size, 0);
});

test('continuous projection keeps exact KDJ crossovers and one-second leaders inside the same bar interval', () => {
  const bars = [{ time: 100 }, { time: 3700 }, { time: 10900 }];
  const coordinate = time => new Map([[100 + OFFSET, 0], [3700 + OFFSET, 20], [10900 + OFFSET, 40]]).get(time) ?? null;
  const x = time => indicatorDrawingTimeCoordinate(time, bars, OFFSET, coordinate);
  assert.equal(x(1900), 10); assert.equal(x(7300), 30);
  assert.equal(x(3700), 20); assert.ok(Math.abs(x(1901) - x(1900) - 20 / STEP) < 1e-10);
  assert.equal(x(-3500), -20); assert.equal(x(18100), 60);
  assert.equal(indicatorDrawingTimeCoordinate(100, [], 0, coordinate), null);
  assert.equal(indicatorDrawingTimeCoordinate(101, [{ time: 100 }], OFFSET, coordinate), null);
  assert.equal(indicatorDrawingTimeCoordinate(1900, bars, OFFSET, () => null), null);
});

test('replacing a pre-fix runtime removes its contaminating series before drawing the same cached patch', () => {
  const h = harness(), baseline = h.snapshot(), p = patch();
  const legacy = h.runtime.pane.addSeries();
  legacy.setData(p.operations[0].drawing.points.map(point => ({ ...point, time: point.time + OFFSET })));
  h.runtime.analysisSeries.push(legacy);
  h.runtime.analysisSignature = JSON.stringify([p, false]);
  assert.equal(h.snapshot().times.length, baseline.times.length + 2, 'negative control reproduces two empty columns');
  renderIndicatorAnalysisPatch({ ...h.options, dark: false, patch: p });
  assert.deepEqual(h.snapshot(), baseline);
  assert.deepEqual(h.removed, [legacy]);
  assert.ok(h.draw().some(c => c[0] === 'lineTo'));
});

test('paths, exact dots, plain text, negative values and pane clipping render without timestamp mutation', () => {
  const h = harness(), p = patch(), baseline = h.snapshot();
  renderIndicatorAnalysisPatch({ ...h.options, dark: false, patch: p });
  const commands = h.draw(), time = p.operations[0].drawing.points[0].time;
  const expectedX = 20 + (time - START) / STEP * 8;
  const dot = commands.find(c => c[0] === 'arc');
  assert.ok(Math.abs(dot[1] - expectedX) < 1e-8); assert.equal(dot[2], 210); assert.equal(dot[3], 1.75);
  assert.deepEqual(commands.find(c => c[0] === 'rect'), ['rect', 0, 0, 1200, 250]);
  assert.ok(commands.some(c => c[0] === 'clip'));
  assert.ok(commands.some(c => c[0] === 'fillText' && c[1] === p.operations[3].drawing.text));
  assert.deepEqual(h.runtime.analysisPrimitive.autoscaleInfo(95, 105).priceRange, { minValue: -10, maxValue: 60 });
  assert.equal(h.runtime.analysisPrimitive.autoscaleInfo(0, 10), null);
  assert.deepEqual(h.snapshot(), baseline);
  clearIndicatorAnalysisRuntime(h.options.chart, h.runtime); assert.deepEqual(h.draw(), []);
});
