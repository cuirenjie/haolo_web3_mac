import assert from 'node:assert/strict';
import test from 'node:test';
import { harmonicDrawingRatios, formatHarmonicRatio, renderReferencePattern, headShouldersGeometry, trianglePatternGeometry } from '../src/renderer/trading-patterns.ts';
import { tradingDrawingToolDefinition, tradingDrawingPlacementMode, tradingDrawingAdvanceDraftPoints, tradingDrawingRewindDraftPoints } from '../src/renderer/trading-expert-drawing.ts';

const model = (tool, prices, style = {}) => ({ id: 'pattern-test', symbol: 'ETHUSDT', tool, points: prices.map((price, index) => ({ time: 1700000000 + index * 86400, price })), ...style });
const screen = prices => prices.map((price, i) => ({ x: 100 + i * 150, y: 2900 - price }));
const texts = (tool, prices, precision = 3) => harmonicDrawingRatios(tool, prices).map(r => formatHarmonicRatio(r.value, precision));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} vs ${b}`);

test('three-drives: screenshot ratios use alternating retracements with two-decimal precision', () => {
  const prices = [2559.70, 2343.05, 2720.40, 2384.17, 2656.10, 2493.77, 2671.54];
  assert.deepEqual(texts('three-drives', prices, 2), ['0.89', '0.6']);
  assert.deepEqual(texts('three-drives', [...prices.slice(0, 5), 2530.18], 2), ['0.89', '0.46']);
  assert.deepEqual(texts('three-drives', prices.map(p => 6000 - p), 2), ['0.89', '0.6']);
  // The last drive has no extra measurement; moving it cannot alter retracements.
  assert.deepEqual(harmonicDrawingRatios('three-drives', prices), harmonicDrawingRatios('three-drives', [...prices.slice(0, 6), 3000]));
  const out = renderReferencePattern(model('three-drives', prices), screen(prices));
  assert.match(out.body, />0\.89<\/text>/); assert.match(out.body, />0\.6<\/text>/);
  assert.doesNotMatch(out.body, /data-harmonic-fill|data-harmonic-point/);
  assert.match(out.body, /stroke="#673ab7" stroke-width="2" stroke-dasharray="2 6"/);
});

test('three-drives: each of seven clicks fixes one anchor; ratio guides appear only after a retracement', () => {
  const prices = [100, 80, 120, 90, 130, 100, 140], points = model('three-drives', prices).points;
  let progress = { points: [points[0], points[0]], confirmedPointCount: 1 };
  for (let count = 2; count <= 7; count++) {
    const out = renderReferencePattern(model('three-drives', prices.slice(0, count)), screen(prices.slice(0, count)), count - 1);
    assert.doesNotMatch(out.body, /data-harmonic-fill|data-harmonic-point/);
    assert.equal((out.body.match(/data-harmonic-ratio=/g) ?? []).length, count < 4 ? 0 : count < 6 ? 1 : 2);
    progress = tradingDrawingAdvanceDraftPoints(progress.points, progress.confirmedPointCount, 7, points[count - 1]);
    assert.equal(progress.complete, count === 7); assert.deepEqual(progress.points.slice(0, count), points.slice(0, count));
  }
  const flat = renderReferencePattern(model('three-drives', Array(7).fill(100)), screen(Array(7).fill(100)));
  assert.doesNotMatch(flat.body + flat.hit, /NaN|Infinity/);
  assert.deepEqual(texts('three-drives', Array(7).fill(100), 2), ['—', '—']);
});

test('triangle: supplied preview converges at AC/BD intersection and final drawing clips to chart edge', () => {
  const points = [{ x: 266, y: 442 }, { x: 414, y: 650 }, { x: 575, y: 381 }, { x: 752, y: 465 }];
  const preview = trianglePatternGeometry(points, 1122);
  const [left, apex, lowerApex, lowerLeft] = preview.polygon;
  assert.equal(left.x, points[0].x); assert.equal(lowerLeft.x, points[0].x);
  assert.ok(apex.x > points[3].x && apex.x < 1122); near(apex.y, lowerApex.y);
  const onLine = (p, a, b) => near((p.y - a.y) * (b.x - a.x), (p.x - a.x) * (b.y - a.y));
  onLine(apex, points[0], points[2]); onLine(apex, points[1], points[3]); onLine(lowerLeft, points[1], points[3]);
  const final = trianglePatternGeometry([...points.slice(0, 3), { x: 729, y: 503 }], 1122);
  assert.equal(final.polygon[1].x, 1122); assert.equal(final.polygon[2].x, 1122);
  assert.notEqual(final.polygon[1].y, final.polygon[2].y);
  for (let count = 2; count <= 4; count++) {
    const out = renderReferencePattern(model('triangle-pattern', points.slice(0, count).map(p => 3000 - p.y)), points.slice(0, count), count - 1);
    assert.equal((out.body.match(/data-harmonic-point=/g) ?? []).length, count);
    assert.equal((out.body.match(/data-triangle-boundary=/g) ?? []).length, count === 4 ? 3 : 0);
    assert.equal((out.body.match(/data-harmonic-fill=/g) ?? []).length, count === 4 ? 1 : 0);
    assert.doesNotMatch(out.body, /data-harmonic-ratio/);
    assert.match(out.body, /stroke="#673ab7"/);
  }
});

test('triangle: parallel, expanding, reversed and coincident-x boundaries stay finite', () => {
  const parallel = [{ x: 100, y: 200 }, { x: 200, y: 400 }, { x: 300, y: 150 }, { x: 400, y: 350 }];
  const expanding = [parallel[0], parallel[1], parallel[2], { x: 400, y: 450 }];
  for (const anchors of [parallel, expanding]) {
    const geometry = trianglePatternGeometry(anchors, 1000);
    assert.equal(geometry.polygon[1].x, 1000); assert.equal(geometry.polygon[2].x, 1000);
    const reversed = trianglePatternGeometry(anchors.map(p => ({ x: 1000 - p.x, y: p.y })), 1000);
    assert.equal(reversed.polygon[1].x, 0); assert.equal(reversed.polygon[2].x, 0);
  }
  const vertical = parallel.map((p, i) => ({ ...p, x: i === 2 ? parallel[0].x : p.x }));
  const out = renderReferencePattern(model('triangle-pattern', vertical.map(p => p.y)), vertical);
  assert.doesNotMatch(out.body + out.hit, /NaN|Infinity/);
  assert.match(out.body, /data-harmonic-legs/);
});

test('abcd: reference ratios, no fill, four names and two dotted measurements', () => {
  const prices = [2316.04, 2582.06, 2411.98, 2714.49];
  assert.deepEqual(texts('abcd', prices), ['0.639', '1.779']);
  const out = renderReferencePattern(model('abcd', prices), screen(prices));
  assert.doesNotMatch(out.body, /data-harmonic-fill/);
  assert.equal((out.body.match(/data-harmonic-ratio=/g) ?? []).length, 2);
  assert.equal((out.body.match(/data-harmonic-point=/g) ?? []).length, 4);
  for (const label of ['A', 'B', 'C', 'D']) assert.ok(out.body.includes(`>${label}</text>`));
  assert.match(out.body, /stroke="#089981" stroke-width="2" stroke-dasharray="2 6"/);
  assert.deepEqual(texts('abcd', prices.map(p => 6000 - p)), ['0.639', '1.779']);
});

test('abcd: C preview introduces AC; D adds BD without changing the first measurement', () => {
  const prices = [100, 200, 140, 240];
  for (const count of [2, 3, 4]) {
    const out = renderReferencePattern(model('abcd', prices.slice(0, count)), screen(prices.slice(0, count)), count - 1);
    assert.equal((out.body.match(/data-harmonic-ratio=/g) ?? []).length, count - 2);
    assert.doesNotMatch(out.body, /data-harmonic-fill/);
  }
  const old = harmonicDrawingRatios('abcd', prices), next = harmonicDrawingRatios('abcd', [100, 200, 140, 300]);
  assert.deepEqual(old[0], next[0]);assert.notEqual(old[1].value,next[1].value);
});

test('head-shoulders: reference neckline, three labels and progressive fill', () => {
  const points = [{ x: 258, y: 636 }, { x: 305, y: 407 }, { x: 467, y: 582 }, { x: 528, y: 236 }, { x: 714, y: 585 }, { x: 799, y: 360 }, { x: 945, y: 591 }];
  const prices = points.map(p => 3000 - p.y);
  for (let count = 2; count <= 7; count++) {
    const out = renderReferencePattern(model('head-shoulders', prices.slice(0, count)), points.slice(0, count), count - 1, { width: 1122, height: 1214 });
    assert.equal((out.body.match(/data-harmonic-point=/g) ?? []).length, Math.floor(count / 2));
    assert.equal((out.body.match(/data-harmonic-fill=/g) ?? []).length, count < 5 ? 0 : count < 7 ? 2 : 3);
    assert.equal(out.body.includes('data-head-shoulders-neckline'), count >= 5);
    assert.doesNotMatch(out.body, /data-harmonic-ratio/);
  }
  const g = headShouldersGeometry(points, 1122), [start, end] = g.neckline;
  assert.ok(start.x > points[0].x && start.x < points[1].x);
  assert.equal(end.x, points[6].x);
  for (const p of [start, end]) near((p.y - points[2].y) * (points[4].x - points[2].x), (p.x - points[2].x) * (points[4].y - points[2].y));
  const body = renderReferencePattern(model('head-shoulders', prices), points).body;
  for (const label of ['左肩', '头部', '右肩']) assert.ok(body.includes(`>${label}</text>`));
  assert.match(body, /fill="#08998126"/);
  assert.match(body, /stroke="#089981" stroke-width="2" stroke-dasharray="2 6"/);
});

test('head-shoulders: inverse, sloping and vertical necklines remain finite and correctly clipped', () => {
  const points = [{ x: 100, y: 500 }, { x: 200, y: 200 }, { x: 300, y: 400 }, { x: 400, y: 100 }, { x: 500, y: 360 }, { x: 600, y: 170 }, { x: 700, y: 420 }];
  for (const anchors of [points, points.map(p => ({ x: p.x, y: 700 - p.y })), points.map(p => ({ x: 900 - p.x, y: p.y }))]) {
    const g = headShouldersGeometry(anchors, 1000), a = anchors[2], b = anchors[4];
    const side = p => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const direction = Math.sign(side(anchors[3]));
    assert.equal(g.polygons.length, 3);
    for (const polygon of g.polygons) for (const p of polygon) assert.ok(side(p) * direction >= -1e-6);
  }
  const vertical = points.map((p, i) => ({ ...p, x: i === 4 ? points[2].x : p.x }));
  const body = renderReferencePattern(model('head-shoulders', points.map(p => p.y)), vertical).body;
  assert.doesNotMatch(body, /NaN|Infinity/);
});

test('cypher: supplied preview prices distinguish XC/XA from BC/AB', () => {
  assert.deepEqual(texts('cypher', [2539.04, 2196.68, 2587.47]), ['1.141']);
  assert.deepEqual(texts('cypher', [2539.04, 2196.68, 2575.27, 2290.26]), ['1.106', '0.727']);
  // The final C/D values reproduce the four rounded ratios in the last image.
  const prices = [2539.04, 2196.68, 2575.27, 2286.72, 2839.30];
  assert.deepEqual(texts('cypher', prices), ['1.106', '0.737', '1.915', '2.19']);
  assert.notEqual(texts('cypher', prices)[1], texts('xabcd', prices)[1]);
  assert.notEqual(texts('cypher', prices)[3], texts('xabcd', prices)[3]);
});

test('cypher: D moves freely and inverted patterns keep the same price ratios', () => {
  const prices = [100, 200, 150, 230, 127.82];
  assert.equal(texts('cypher', prices)[3], '0.786');
  const reflected = prices.map(p => 500 - p);
  assert.deepEqual(texts('cypher', prices), texts('cypher', reflected));
  const moved = [...prices.slice(0, 4), 280];
  const original = harmonicDrawingRatios('cypher', prices), changed = harmonicDrawingRatios('cypher', moved);
  assert.deepEqual(original.slice(0, 2), changed.slice(0, 2));
  assert.notEqual(original[3].value, changed[3].value);
  const out = renderReferencePattern(model('cypher', moved), screen(moved));
  assert.equal((out.body.match(/data-harmonic-fill=/g) ?? []).length, 2);
  assert.equal((out.body.match(/data-harmonic-ratio=/g) ?? []).length, 4);
  assert.equal(harmonicDrawingRatios('cypher', [100, 200, 150, 100, 120]).at(-1).value, null);
});

test('xabcd: supplied screenshot prices reproduce all four ratios', () => {
  const prices = [2541.04, 2275.89, 2659.74, 2319.29, 2545.04];
  assert.deepEqual(texts('xabcd', prices), ['1.448', '0.887', '0.663', '1.015']);
  assert.deepEqual(harmonicDrawingRatios('xabcd', prices).map(r => r.chord), ['XB', 'AC', 'BD', 'XD']);
  const svg = renderReferencePattern(model('xabcd', prices), screen(prices)).body;
  for (const text of ['1.448', '0.887', '0.663', '1.015']) assert.ok(svg.includes(`>${text}</text>`));
  assert.equal((svg.match(/data-harmonic-fill=/g) ?? []).length, 2);
  assert.match(svg, /fill="#2962ff26"/);
  // Nonlinear and unequal chart projections must not change any measurement.
  const distorted = screen(prices).map((p, i) => ({ x: i * i * 90, y: Math.log(prices[i]) * -500 }));
  const logSvg = renderReferencePattern(model('xabcd', prices), distorted).body;
  for (const text of texts('xabcd', prices)) assert.ok(logSvg.includes(`>${text}</text>`));
});

test('xabcd: previews add only the geometry belonging to the placed and moving anchors', () => {
  const prices = [2541.04, 2275.89, 2659.74, 2319.29, 2545.04];
  for (const [count, fills, ratios] of [[2, 0, 0], [3, 1, 1], [4, 1, 2], [5, 2, 4]]) {
    const m = model('xabcd', prices.slice(0, count));
    const out = renderReferencePattern(m, screen(prices.slice(0, count)), count - 1);
    assert.equal((out.body.match(/data-harmonic-fill=/g) ?? []).length, fills);
    assert.equal((out.body.match(/data-harmonic-ratio=/g) ?? []).length, ratios);
    assert.equal((out.body.match(/data-harmonic-point=/g) ?? []).length, count);
  }
  const m = model('xabcd', [2500, 2300, 2300]);
  const out = renderReferencePattern(m, [{ x: 100, y: 100 }, { x: 200, y: 300 }, { x: 200, y: 300 }], 2);
  assert.doesNotMatch(out.body, /data-harmonic-fill|data-harmonic-ratio/);
  assert.equal((out.body.match(/data-harmonic-point=/g) ?? []).length, 2);
});

test('xabcd: zero price legs are undefined measurements, not Infinity or false ratios', () => {
  const prices = [100, 100, 100, 100, 100];
  assert.deepEqual(texts('xabcd', prices), ['—', '—', '—', '—']);
  const out = renderReferencePattern(model('xabcd', prices), screen(prices));
  assert.doesNotMatch(out.body + out.hit, /NaN|Infinity/);
  assert.equal(formatHarmonicRatio(1.4), '1.4');
});

test('xabcd: five-click state, rewind and style do not fabricate a completion point', () => {
  const definition = tradingDrawingToolDefinition('xabcd');
  assert.equal(tradingDrawingPlacementMode(definition), 'multi-click');
  const points = model('xabcd', [100, 80, 95, 85, 105]).points;
  let progress = { points: [points[0], points[0]], confirmedPointCount: 1 };
  for (let i = 1; i < 5; i++) {
    progress = tradingDrawingAdvanceDraftPoints(progress.points, progress.confirmedPointCount, 5, points[i]);
    assert.equal(progress.complete, i === 4);
    assert.deepEqual(progress.points.slice(0, i + 1), points.slice(0, i + 1));
  }
  const rewind = tradingDrawingRewindDraftPoints(points.slice(0, 4), 3, points[3]);
  assert.equal(rewind.confirmedPointCount, 2);
  const m = model('xabcd', [100, 80, 95, 85, 105], { color: '#ff0000', textColor: '#000000', textBackgroundColor: '#00ff0080', lineWidth: 4, lineStyle: 'dashed', fontSize: 18, bold: true, italic: true });
  const out = renderReferencePattern(m, screen(m.points.map(p => p.price)));
  assert.match(out.body, /fill="#00ff0080"/);
  assert.match(out.body, /stroke-width="4" stroke-dasharray="8 5"/);
  assert.match(out.body, /font-size="18" font-weight="700" font-style="italic"/);
  assert.match(out.hit, /trading-drawing-hit-target area/);
});
