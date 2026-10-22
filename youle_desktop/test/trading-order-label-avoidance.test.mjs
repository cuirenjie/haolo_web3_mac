import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutTradingOrderLineLabelLeft, renderTradingOrderLineSvg } from '../src/renderer/trading-expert-order-lines.ts';

const bounds = { width: 1000, height: 600 };
const badge = { width: 170, y: 300 };
const place = (candles = [], annotations = [], viewport = bounds) =>
  layoutTradingOrderLineLabelLeft(badge.width, badge.y, viewport, candles, annotations);
const onRow = (x, width) => ({ x, y: 280, width, height: 40 });

test('price labels prefer the right edge and move into left whitespace when annotations occupy the right', () => {
  assert.equal(place(), 822);
  assert.equal(place([], [onRow(760, 240)]), 586);
  const left = place([onRow(300, 700)], [onRow(750, 240)]);
  assert.ok(left >= 8 && left + badge.width <= 296, 'left half is available for a clear label');
});

test('avoid both text and candles, preserving right-first order among completely empty slots', () => {
  const candles = [onRow(610, 130), onRow(100, 120)];
  const annotations = [onRow(800, 200)];
  assert.equal(place(candles, annotations), 436);
  assert.equal(place(candles, [...annotations].reverse()), 436);
  assert.equal(place([], [{ x: 760, y: 20, width: 240, height: 40 }]), 822, 'other price rows do not obstruct');
});

test('unavoidably dense candles never justify covering readable annotations', () => {
  const candles = Array.from({ length: 25 }, (_, i) => onRow(i * 40, 32));
  const left = place(candles, [onRow(0, 700)]);
  assert.ok(left >= 704, 'text avoidance takes priority when every position covers candles');
  assert.equal(left, place(candles, [onRow(0, 700)]), 'redraw does not drift');
});

test('invalid and offscreen obstacles are ignored, and narrow labels remain within the plot', () => {
  assert.equal(place([], [onRow(NaN, 200), onRow(-500, 30), onRow(1100, 200)]), 822);
  const left = place([], [onRow(300, 120)], { width: 420, height: 600 });
  assert.ok(left >= 8 && left + badge.width <= 296);
});

test('close plan levels remain separated and price strokes retain exact coordinates while badges avoid drawings', () => {
  const market = 'BINANCE:FUTURES:BTCUSDT';
  const lines = ['plan-entry', 'stop-loss', 'take-profit'].map((kind, i) => ({
    id: `level-${i}`, marketId: market, price: 300 + i * 2, kind,
    shortLabel: ['入场', '止损', '第1止盈'][i], label: String(300 + i * 2), labelMode: 'price',
  }));
  const svg = renderTradingOrderLineSvg(lines, market, bounds, p => p, [], [{ x: 400, y: 270, width: 600, height: 100 }]);
  const labels = [...svg.matchAll(/class="trading-order-line-label-bg" x="([^"]+)" y="([^"]+)" width="([^"]+)"/g)]
    .map(m => ({ x: +m[1], y: +m[2], width: +m[3] }));
  assert.equal(labels.length, 3);
  for (const label of labels) assert.ok(label.x + label.width <= 396);
  assert.ok(labels[1].y - labels[0].y >= 22 && labels[2].y - labels[1].y >= 22);
  for (const line of lines) assert.ok(svg.includes(`y1="${line.price}" x2="1000" y2="${line.price}"`));
});
