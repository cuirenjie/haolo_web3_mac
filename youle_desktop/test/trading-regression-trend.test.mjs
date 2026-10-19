import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRegressionTrend as fit, normalizeRegressionTrendOptions, renderRegressionTrend, REGRESSION_SOURCES } from '../src/renderer/trading-regression-trend.ts';
import { drawingFromWire, drawingToWire } from '../src/renderer/manual-drawing-sync.ts';
import { tradingDrawingPlacementMode, tradingDrawingToolDefinition } from '../src/renderer/trading-expert-drawing.ts';
import { translateDrawingText } from '../src/renderer/app-language.mjs';
const bars = prices => prices.map((close, i) => ({ time: 1800000000 + i * 3600, close, open: close + 2, high: close + 3, low: close - 1 }));
const points = candles => [candles[0], candles.at(-1)].map((c, i) => ({ time: c.time, price: i ? -1000 : 1000 }));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

test('two clicks choose the inclusive bar interval, not the drawn slope', () => {
  const candles = bars([1, 2, 4]), anchors = points(candles), result = fit(candles, anchors);
  assert.equal(tradingDrawingPlacementMode(tradingDrawingToolDefinition('regression-trend')), 'two-click');
  assert.equal(result.count, 3); near(result.slope, 1.5); near(result.base[0].price, 5 / 6);
  near(result.base[1].price, 23 / 6); near(result.deviation, Math.sqrt(1 / 12)); near(result.pearson, Math.sqrt(27 / 28));
  near(result.upper[0].price - result.base[0].price, 2 * Math.sqrt(1 / 12));
  near(result.lower[0].price - result.base[0].price, -2 * Math.sqrt(1 / 12));
  assert.deepEqual(fit(candles, anchors.map(p => ({ ...p, price: 0 }))), result);
  const reverse = fit(candles, anchors.toReversed());
  assert.deepEqual(reverse.base, result.base); assert.deepEqual(reverse.anchors, result.anchors.toReversed());
});

test('uses bar ordinal across session gaps, snaps nearest bars and excludes prices outside the range', () => {
  const candles = bars([9999, 1, 2, 4, -9999]); candles[3].time += 86400; candles[4].time += 86400;
  const result = fit(candles, [{ time: candles[1].time + 10, price: 100 }, { time: candles[3].time - 10, price: 0 }]);
  near(result.slope, 1.5); assert.equal(result.count, 3);
  const before = structuredClone(candles); fit(candles, points(candles)); assert.deepEqual(candles, before);
});

test('handles flat, descending, two-bar, invalid and unavailable ranges without NaN', () => {
  for (const values of [[5, 5, 5], [3, 2, 1], [2, 4]]) {
    const candles = bars(values), result = fit(candles, points(candles));
    near(result.deviation, 0); near(result.pearson, values[0] === values[1] ? 0 : 1);
  }
  const candles = bars([1, 2, 4]);
  assert.equal(fit([], points(candles)), null);
  assert.equal(fit(candles, [points(candles)[0], points(candles)[0]]), null);
  assert.equal(fit(candles, [{ time: NaN, price: 1 }, points(candles)[1]]), null);
  assert.equal(fit(candles, [{ time: 0, price: 1 }, { time: 100, price: 1 }]), null);
  candles[1].close = NaN; assert.equal(fit(candles, points(candles)), null);
});

test('source, independent deviations and extremum fallback affect the computed channel', () => {
  const candles = bars([1, 2, 4]), anchors = points(candles);
  for (const source of REGRESSION_SOURCES) assert.ok(fit(candles, anchors, { source }));
  near(fit(candles, anchors, { source: 'open' }).base[0].price, fit(candles, anchors).base[0].price + 2);
  const result = fit(candles, anchors, { upperDeviation: 1, lowerDeviation: -3 });
  near(result.upper[1].price - result.base[1].price, result.deviation);
  near(result.base[1].price - result.lower[1].price, result.deviation * 3);
  const extreme = fit(candles, anchors, { useUpperDeviation: false, useLowerDeviation: false });
  near(extreme.upper[0].price - extreme.base[0].price, 19 / 6);
  near(extreme.base[0].price - extreme.lower[0].price, 4 / 3);
});

test('draws vertical channel ends, separate fills, independent styles, extension and Pearson text', () => {
  const candles = bars([1, 2, 4]);
  const drawing = { id: 'regression', tool: 'regression-trend', symbol: 'binance:usdm:BTCUSDT', points: points(candles) };
  const project = p => ({ x: (p.time - candles[0].time) / 3600 * 100 + 50, y: 500 - p.price * 10 });
  const result = renderRegressionTrend(fit(candles, drawing.points), drawing, project, 600);
  assert.equal((result.body.match(/<polygon/g) ?? []).length, 2);
  assert.match(result.body, /fill="#2962ff" fill-opacity="0.3"/);
  assert.match(result.body, /fill="#f23645" fill-opacity="0.3"/);
  assert.match(result.body, /data-regression-line="base"[^>]*stroke-width="1"[^>]*stroke-dasharray="5 5"/);
  assert.match(result.body, /data-regression-line="upper"[^>]*stroke-width="2"/);
  assert.match(result.body, /data-regression-pearson/);
  const extended = renderRegressionTrend(fit(candles, drawing.points, { extendRight: true, showPearson: false, showUpper: false }), drawing, project, 600);
  assert.match(extended.body, /x2="600"/); assert.doesNotMatch(extended.body, /data-regression-pearson|data-regression-line="upper"/);
});

test('normalizes untrusted options and preserves settings through drawing serialization', () => {
  const regression = normalizeRegressionTrendOptions({ source: 'hl2', baseColor: '<svg>', upperDeviation: Infinity, lowerWidth: -1, fillOpacity: 2, showPearson: false });
  assert.equal(regression.baseColor, '#f23645'); assert.equal(regression.upperDeviation, 2);
  assert.equal(regression.lowerWidth, 2); assert.equal(regression.fillOpacity, .3);
  const drawing = { id: 'regression', tool: 'regression-trend', symbol: 'binance:usdm:BTCUSDT', points: points(bars([1, 2, 4])), regression };
  assert.deepEqual(drawingFromWire(drawingToWire(drawing), drawing.symbol).regression, regression);
  for (const phrase of ['选择结束 K 线，点击后自动计算回归通道 · 右键撤销上一端点', '回归趋势至少需要两根有效 K 线', '两个端点只选择 K 线区间，价格由回归计算。']) assert.doesNotMatch(translateDrawingText(phrase, 'en'), /\p{Script=Han}/u);
});
