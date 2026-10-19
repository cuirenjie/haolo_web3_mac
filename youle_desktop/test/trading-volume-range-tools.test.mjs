import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAnchoredVwap, calculateFixedVolume, volumeBarIndex, volumeDrawingAnchors, volumeProfilePoints, renderAnchoredVwap, renderFixedVolume, normalizeFixedVolumeOptions } from '../src/renderer/trading-volume-drawings.ts';
import { rangeMeasurement, renderRangeDrawing } from '../src/renderer/trading-range-tools.ts';
import { DrawingReplica, drawingToWire, drawingFromWire } from '../src/renderer/manual-drawing-sync.ts';
const bar = (time, price, volume, open = price) => ({ time, open, high: price, low: price, close: price, volume });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const drawing = (tool, points) => ({ id: 'qa', symbol: 'ETHUSDT', tool, points });
const project = p => ({ x: p.time, y: 500 - p.price * 10 });
const bounds = { width: 800, height: 500 };

test('volume options survive local restart and unsupported records cannot block regular drawing uploads', () => {
  const replica = new DrawingReplica();
  const regular = { ...drawing('date-range', [{ time: 1785542400, price: 10 }, { time: 1785628800, price: 12 }]), id: 'regular', symbol: 'BINANCE:FUTURES:ETHUSDT' };
  const anchored = { ...regular, id: 'anchored', tool: 'anchored-vwap', points: regular.points.slice(0, 1), vwap: { multiplier: 2 } };
  const profile = { ...regular, id: 'profile', tool: 'fixed-range-volume', volumeProfile: { rows: 36 } };
  const wire = [regular, anchored, profile].map(drawingToWire);
  replica.edit([], wire);
  assert.deepEqual(replica.begin('binance:usdm:ETHUSDT', '1h').operations.map(op => op.id), ['regular']);
  replica.acknowledge();
  const restored = new DrawingReplica(replica.serialize());
  restored.merge({ schemaVersion: 4, version: 1, marketKey: 'binance:usdm:ETHUSDT', serverTime: Date.now(), entries: [replica.entries.regular] });
  assert.equal(restored.drawings().length, 3);
  assert.equal(drawingFromWire(restored.entries.anchored.drawing, regular.symbol).vwap.multiplier, 2);
  assert.equal(restored.entries.profile.drawing.volumeProfile.rows, 36);
  assert.equal(restored.dirty, false);
});

test('AVWAP has independently verified weighted mean and variance, and ignores click height', () => {
  const candles = [bar(0, 1000, 100), bar(10, 10, 1), bar(20, 20, 3), bar(30, 999, 0)];
  const values = calculateAnchoredVwap(candles, 10);
  assert.equal(values[0].price, 10); assert.equal(values[0].deviation, 0);
  near(values[1].price, 17.5); near(values[1].deviation, Math.sqrt(18.75));
  assert.equal(values[2].price, 17.5); near(values[2].upper, 17.5 + Math.sqrt(18.75));
  for (const price of [-1000, 4000]) assert.deepEqual(volumeDrawingAnchors(drawing('anchored-vwap', [{ time: 11, price }]), candles), [{ time: 10, price: 10 }]);
  assert.equal(calculateAnchoredVwap(candles, 40).length, 0);
});
test('VWAP handles invalid volume, missing prices, percentages, and realtime changes', () => {
  const candles = [bar(1, 10, 0), bar(2, NaN, 100), bar(3, 10, 2), bar(4, 50, Infinity), bar(5, 20, 2)];
  const values = calculateAnchoredVwap(candles, 1, { bandMode: 'percentage', multiplier: 2 });
  assert.equal(values.length, 3); near(values.at(-1).upper, 15.3);
  candles[4].close = 50; candles[4].high = 50; candles[4].low = 50;
  near(calculateAnchoredVwap(candles, 1).at(-1).price, 30);
  const large = calculateAnchoredVwap([bar(1, 1e9, 1), bar(2, 1e9 + 2, 1)], 1);
  near(large[1].deviation, 1);
});
test('profile conserves volume and derives POC, range extrema and directional volume from data', () => {
  const candles = [{ time: 0, open: 0, low: 0, high: 20, close: 20, volume: 200 }, bar(10, 5, 30, 6), bar(20, 25, 70, 24)];
  const points = [{ time: 0, price: 300 }, { time: 10, price: -100 }];
  const profile = calculateFixedVolume(candles, points, { rows: 4 });
  assert.deepEqual(profile.bins.map(b => b.volume), [50, 80, 50, 50]);
  near(profile.total, 230); near(profile.bins.reduce((s, b) => s + b.volume, 0), 230);
  assert.equal(profile.poc, 7.5); assert.equal(profile.low, 0); assert.equal(profile.high, 20);
  near(profile.bins.reduce((s, b) => s + b.up, 0), 200); near(profile.bins.reduce((s, b) => s + b.down, 0), 30);
  assert.deepEqual(calculateFixedVolume(candles, [...points].reverse(), { rows: 4 }), profile);
  assert.deepEqual(volumeDrawingAnchors(drawing('fixed-range-volume', points), candles), [{ time: 0, price: 20 }, { time: 10, price: 0 }]);
});
test('all volume endpoints clamp to existing bars, anchored profiles grow but fixed ones stay fixed', () => {
  const candles = [bar(10, 10, 100), bar(20, 20, 50)];
  assert.equal(volumeBarIndex(candles, 1e12), 1); assert.equal(volumeBarIndex(candles, -1e12), 0);
  const avp = drawing('anchored-volume-profile', [{ time: 10, price: 999 }]);
  const frvp = drawing('fixed-range-volume', [{ time: 10, price: 0 }, { time: 20, price: 0 }]);
  assert.equal(calculateFixedVolume(candles, volumeProfilePoints(avp, candles)).total, 150);
  candles.push(bar(30, 25, 1000));
  assert.equal(calculateFixedVolume(candles, volumeProfilePoints(avp, candles)).total, 1150);
  assert.equal(calculateFixedVolume(candles, frvp.points).total, 150);
  assert.equal(volumeDrawingAnchors(avp, candles).length, 1);
});

test('profile doji direction and value-area tie/target rules match the published specification', () => {
  const candles = [2, 3, 10, 3, 3].map((volume, i) => bar(i, i, volume));
  const profile = calculateFixedVolume(candles, [{ time: 0, price: 0 }, { time: 4, price: 4 }], { rows: 5, valueArea: 80 });
  assert.deepEqual(profile.bins.map(b => b.inValueArea), [false, true, true, true, false]);
  assert.equal(profile.bins.reduce((s, b) => s + b.up, 0), 21);
  assert.equal(profile.bins.filter(b => b.inValueArea).reduce((s, b) => s + b.volume, 0), 16);
  const single = calculateFixedVolume(candles, [{ time: 2, price: 0 }, { time: 2, price: 4 }]);
  assert.equal(single.bins[0].down, 10);
});
test('single bar / zero volume / invalid rows are finite and do not fabricate a POC', () => {
  assert.equal(normalizeFixedVolumeOptions({ rows: Infinity }).rows, 24);
  const candles = [bar(10, 10, 0)], points = [{ time: 10, price: 10 }, { time: 10, price: 10 }];
  const result = renderFixedVolume(drawing('fixed-range-volume', points), candles, project, true, false, bounds);
  assert.match(result.body, /暂无成交量数据/); assert.doesNotMatch(result.body, /data-volume-poc|NaN|Infinity/);
  const profile = calculateFixedVolume([bar(10, 10, 7)], points);
  assert.equal(profile.bins.length, 1); assert.equal(profile.total, 7); assert.equal(profile.bins[0].down, 7);
});
test('VWAP has three curves and fill, fixed profiles align left and anchored profiles align to price axis', () => {
  const candles = Array.from({ length: 20 }, (_, i) => bar(i * 10, 10 + i % 5, i + 1, 11 + i % 5));
  const avwap = renderAnchoredVwap(drawing('anchored-vwap', [{ time: 0, price: 10 }]), candles, project, true, bounds);
  assert.equal((avwap.body.match(/data-vwap-line/g) ?? []).length, 3); assert.match(avwap.body, /data-vwap-fill/);
  assert.equal((avwap.handles.match(/<circle/g) ?? []).length, 7);
  const avp = renderFixedVolume(drawing('anchored-volume-profile', [{ time: 0, price: 10 }]), candles, project, true, false, bounds);
  assert.match(avp.body, /data-volume-poc x1="0".*x2="800"/);
  const fixed = renderFixedVolume(drawing('fixed-range-volume', [{ time: 0, price: 10 }, { time: 190, price: 20 }]), candles, project, true, false, bounds);
  assert.match(fixed.body, /data-volume-poc x1="0".*x2="190"/);
  assert.doesNotMatch(avp.body + fixed.body, /NaN|Infinity|undefined/);
});
test('range numbers match supplied screenshots, including symbol tick size and zero base price', () => {
  const value = rangeMeasurement({ start: { time: 0, price: 2506.39 }, end: { time: 86400, price: 2219.14 }, candles: [], bars: 1, minMove: .01, precision: 2 });
  assert.equal(value.priceText, '−287.25 (−11.46%) −28,725');
  assert.equal(rangeMeasurement({ start: { time: 0, price: 0 }, end: { time: 1, price: 1 }, candles: [], bars: 0 }).percent, null);
  assert.equal(rangeMeasurement({ start: { time: 0, price: 100 }, end: { time: 1, price: 101.5 }, candles: [], bars: 0, minMove: .25 }).ticks, 6);
});
test('date measurements count elapsed bars while volume includes only available bars inside the interval', () => {
  const candles = [bar(0, 10, 3), bar(86400, 10, 4), bar(172800, 10, 5)];
  const value = rangeMeasurement({ start: { time: 0, price: 10 }, end: { time: 864000, price: 12 }, candles, bars: 10 });
  assert.equal(value.volume, 12); assert.match(value.dateText, /10/);
  const reverse = rangeMeasurement({ start: { time: 864000, price: 12 }, end: { time: 0, price: 10 }, candles, bars: -10 });
  assert.equal(reverse.volume, 12); assert.equal(reverse.dateText, value.dateText);
});
test('range geometry supports both drag directions, degenerate rectangles and clipped cards', () => {
  const m = rangeMeasurement({ start: { time: 0, price: 10 }, end: { time: 20, price: 12 }, candles: [], bars: 20 });
  for (const tool of ['price-range', 'date-range', 'date-price-range']) for (const points of [[{ x: 10, y: 10 }, { x: 250, y: 300 }], [{ x: 500, y: 400 }, { x: -10, y: 100 }], [{ x: 0, y: 0 }, { x: 0, y: 0 }]]) {
    const result = renderRangeDrawing(drawing(tool, [{ time: 0, price: 10 }, { time: 20, price: 12 }]), points, bounds, m, true, false);
    assert.doesNotMatch(result.body + result.hit + result.handles, /NaN|Infinity|undefined/);
    assert.equal((result.body.match(/<text /g) ?? []).length, tool === 'price-range' ? 1 : tool === 'date-range' ? 2 : 3);
    assert.equal((result.handles.match(/data-drawing-handle-index/g) ?? []).length, 2);
  }
});
