import assert from 'node:assert/strict';
import test from 'node:test';
import { TradingHollowHistogram } from '../src/renderer/trading-hollow-histogram.ts';
import { normalizeTradingIndicatorSettings } from '../src/renderer/trading-expert-market.ts';
import { flattenSettings, applySettingValues } from '../src/renderer/account-settings-sync.ts';

test('MACD hollow preference survives storage and account settings, with solid legacy defaults', () => {
  const defaults = normalizeTradingIndicatorSettings(null);
  assert.equal(defaults['sub:macd'].series.histogram.histogramStyle, 'solid');
  for (const histogramStyle of [undefined, null, 'invalid', true]) {
    const settings = normalizeTradingIndicatorSettings({ 'sub:macd': { series: { histogram: { histogramStyle } } } });
    assert.equal(settings['sub:macd'].series.histogram.histogramStyle, 'solid');
  }
  defaults['sub:macd'].series.histogram.histogramStyle = 'hollow';
  defaults['sub:macd'].series.histogram.visible = false;
  const restored = normalizeTradingIndicatorSettings(JSON.parse(JSON.stringify(defaults)));
  const synced = normalizeTradingIndicatorSettings(applySettingValues(
    normalizeTradingIndicatorSettings(null), flattenSettings(restored, 'indicator'), 'indicator',
  ));
  assert.deepEqual(synced['sub:macd'], defaults['sub:macd']);
  assert.equal(synced['sub:volume'].series.volume.histogramStyle, undefined);
});

function paint({ ratio = 1, spacing = 10, values = [10, -10, 0], visibleRange, converter } = {}) {
  const series = new TradingHollowHistogram();
  const rectangles = [];
  const context = { save() {}, restore() {}, fillRect(x, y, w, h) { rectangles.push({ x, y, w, h, color: this.fillStyle }); } };
  series.update({
    bars: values.map((value, i) => ({ x: 20 + i * spacing, time: i, originalData: { time: i, value }, barColor: value >= 0 ? 'green' : 'red' })),
    barSpacing: spacing, conflationFactor: 1,
    visibleRange: visibleRange === undefined ? { from: 0, to: values.length } : visibleRange,
  });
  const target = { useBitmapCoordinateSpace: draw => draw({ context, horizontalPixelRatio: ratio, verticalPixelRatio: ratio }) };
  series.draw(target, converter || (value => 50 - value * 2), false);
  return { rectangles, series, target };
}

const covers = (rectangles, x, y) => rectangles.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);

test('positive and negative MACD bars leave the interior transparent at normal and high DPI', () => {
  for (const ratio of [1, 1.25, 2]) {
    const { rectangles } = paint({ ratio });
    assert.equal(covers(rectangles, 20 * ratio, 40 * ratio), false);
    assert.equal(covers(rectangles, 30 * ratio, 60 * ratio), false);
    assert.equal(covers(rectangles, Math.round(20 * ratio), Math.round(30 * ratio)), true);
    assert.equal(covers(rectangles, Math.round(30 * ratio), Math.round(70 * ratio)), true);
    assert.equal(rectangles[0].color, 'green');
    assert.equal(rectangles[4].color, 'red');
    assert.equal(covers(rectangles, Math.round(40 * ratio), Math.round(50 * ratio)), true, 'zero remains visible');
  }
});

test('hollow histogram respects the viewport, handles dense bars and releases its data', () => {
  assert.equal(paint({ visibleRange: null }).rectangles.length, 0);
  const { rectangles } = paint({ visibleRange: { from: 1, to: 2 } });
  assert.ok(rectangles.length > 0);
  assert.ok(rectangles.every(r => r.color === 'red'));
  const dense = paint({ spacing: 1 });
  assert.ok(dense.rectangles.every(r => r.w === 1 && r.h > 0));
  dense.series.destroy();
  const count = dense.rectangles.length;
  dense.series.draw(dense.target, value => 50 - value * 2, false);
  assert.equal(dense.rectangles.length, count);
  assert.equal(paint({ converter: () => null }).rectangles.length, 0);
});

test('histogram autoscaling includes zero and crosshair uses the actual MACD value', () => {
  const series = new TradingHollowHistogram();
  assert.deepEqual(series.priceValueBuilder({ time: 1, value: -12 }), [0, -12]);
  assert.equal(series.isWhitespace({ time: 1 }), true);
  assert.equal(series.isWhitespace({ time: 1, value: NaN }), true);
  assert.equal(series.isWhitespace({ time: 1, value: 0 }), false);
});
