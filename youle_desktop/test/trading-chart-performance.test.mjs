import assert from "node:assert/strict";
import test from "node:test";
import { TradingDrawingController, updateTradingDrawingMarkup, tradingDrawingCoordinateToLogical, tradingDrawingLogicalToCoordinate, tradingDrawingTimeAtLogicalIndex, tradingDrawingLogicalIndexAtTime } from "../src/renderer/trading-expert-drawing.ts";
import { TradingChartExtremaOverlay } from "../src/renderer/trading-chart-extrema.ts";

test('unsnapped drawing coordinates round-trip between candles instead of jumping by one bar', () => {
  const candles = [{ time: 100 }, { time: 160 }, { time: 400 }, { time: 460 }];
  for (const spacing of [0.5, 6, 40, 100]) for (const offset of [-1200.7, 0, 350.2]) {
    const project = index => Number.isInteger(index) ? offset + index * spacing : 0;
    const integerIndex = x => Math.ceil((x - offset) / spacing);
    for (let x = -30; x < 90; x += 0.375) {
      const logical = tradingDrawingCoordinateToLogical(x, integerIndex, project);
      const time = tradingDrawingTimeAtLogicalIndex(candles, logical);
      const restored = tradingDrawingLogicalToCoordinate(tradingDrawingLogicalIndexAtTime(candles, time), project);
      assert.ok(Math.abs(restored - x) < 1e-8, `pixel ${x} at spacing ${spacing}: ${restored}`);
    }
  }
  assert.equal(tradingDrawingCoordinateToLogical(NaN, () => 2, () => 1), null);
  assert.equal(tradingDrawingCoordinateToLogical(2, () => null, () => 1), null);
  assert.equal(tradingDrawingCoordinateToLogical(2, () => 3, () => null), 3);
});

test('magnet searches irregular history logarithmically and retains nearest OHLC snapping', () => {
  let reads = 0;
  const candles = Array.from({ length: 10000 }, (_, i) => ({ get time() { reads++; return i * i + 100; }, open: 100, high: 120, low: 80, close: 110 }));
  const context = { getCandles: () => candles, getChart: () => ({ timeScale: () => ({ timeToCoordinate: time => time / 100000 }) }),
    timeOffsetSeconds: 0, getCandleSeries: () => ({ priceToCoordinate: price => 200 - price }) };
  for (const index of [0, 20, 9999]) {
    const time = candles[index].time;
    reads = 0;
    const point = TradingDrawingController.prototype.snapPointToCandle.call(context, { time: time + 0.1, price: 109 }, { x: time / 100000, y: 89 });
    assert.deepEqual(point, { time, price: 110 });
    assert.ok(reads < 80, `magnet scanned history: ${reads}`);
  }
});

test("unchanged SVG markup retains nodes; theme/content changes and clearing still replace them", () => {
  const writes = [];
  const layer = { set innerHTML(value) { writes.push(value); } };
  for (let i = 0; i < 100; i++) updateTradingDrawingMarkup(layer, '<g class="light"/>');
  assert.deepEqual(writes, ['<g class="light"/>']);
  updateTradingDrawingMarkup(layer, '<g class="dark"/>');
  updateTradingDrawingMarkup(layer, '');
  updateTradingDrawingMarkup(layer, '<g class="light"/>');
  assert.deepEqual(writes, ['<g class="light"/>', '<g class="dark"/>', '', '<g class="light"/>']);
});

test("candle collision geometry is identical when off-screen history is culled", () => {
  const candles = Array.from({ length: 10000 }, (_, i) => ({ time: i, high: 200, low: 100 }));
  for (const spacing of [0.5, 3, 40]) for (const first of [-1500, 0, 9374.3, 11000]) {
    let visits = 0;
    const context = {
      getCandles: () => candles,
      getChart: () => ({ timeScale: () => ({ coordinateToLogical: x => first + x / spacing }) }),
      pointToScreen: point => { visits++; return { x: (point.time - first) * spacing, y: 300 - point.price }; },
    };
    const culled = TradingDrawingController.prototype.visibleCandleObstacles.call(context, { width: 600, height: 400 });
    assert.ok(visits <= 2 * (Math.ceil(624 / spacing) + 3), `processed off-screen history: ${visits}`);
    context.getChart = () => null; // Original complete-history traversal.
    const full = TradingDrawingController.prototype.visibleCandleObstacles.call(context, { width: 600, height: 400 });
    assert.deepEqual(culled, full);
  }
});

test('navigation overlay geometry does not synchronously measure DOM after label writes', () => {
  const noLayout = { getBoundingClientRect() { throw new Error('forced layout'); },
    get clientWidth() { throw new Error('forced width layout'); },
    get clientHeight() { throw new Error('forced height layout'); } };
  const chart = { options: () => ({ height: 800 }),
    timeScale: () => ({ width: () => 700, getVisibleLogicalRange: () => ({ from: 0, to: 1 }), timeToCoordinate: t => t * 500 }),
    panes: () => [{ getHeight: () => 600 }, { getHeight: () => 170 }] };
  for (const [drawingScope, paneIndex, height] of [['main', 0, 600], ['indicator:volume', 1, 170]]) {
    const bounds = TradingDrawingController.prototype.plotBounds.call({ getChart: () => chart, chartElement: noLayout, drawingScope, paneIndex });
    assert.deepEqual(bounds, { width: 700, height });
  }
  const label = () => ({ style: {}, dataset: {}, hidden: true, textContent: '',
    get offsetWidth() { throw new Error('forced label width'); }, get offsetHeight() { throw new Error('forced label height'); } });
  const overlay = Object.create(TradingChartExtremaOverlay.prototype);
  Object.assign(overlay, { destroyed: false, highLabel: label(), lowLabel: label(), options: {
    chartElement: noLayout, getChart: () => chart, getSeries: () => ({ priceToCoordinate: p => 700 - p }),
    getCandles: () => [{ time: 0, high: 650, low: 200 }, { time: 1, high: 550, low: 100 }], formatPrice: String,
  } });
  overlay.update();
  assert.equal(overlay.highLabel.textContent, '← 650');
  assert.equal(overlay.lowLabel.textContent, '100 →');
  assert.equal(overlay.highLabel.style.top, '50px');
  assert.equal(overlay.lowLabel.style.transform, 'translate(-100%, -50%)');
  assert.equal(overlay.lowLabel.style.top, '590px');
});
