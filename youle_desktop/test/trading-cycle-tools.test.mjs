import assert from 'node:assert/strict';
import test from 'node:test';
import { cycleAnchorPoints, moveCycleAnchor, visibleCyclePositions, sineValueAt, sineWavePoints, renderCycleDrawing, cycleHitDistance } from '../src/renderer/trading-cycle-tools.ts';
import { tradingDrawingPlacementMode, tradingDrawingToolDefinition } from '../src/renderer/trading-expert-drawing.ts';

const bounds = { width: 1040, height: 1100 };
const model = (tool, style = {}) => ({ id: 'cycle-test', symbol: 'ETHUSDT', tool, points: [{ time: 100, price: 100 }, { time: 200, price: 130 }], ...style });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} vs ${b}`);

test('cyclic lines repeat equal intervals into the future, even with both anchors offscreen', () => {
  assert.deepEqual(visibleCyclePositions(200, 320, 1040, false), [200, 320, 440, 560, 680, 800, 920, 1040]);
  assert.deepEqual(visibleCyclePositions(200, 352, 1040, false), [200, 352, 504, 656, 808, 960]);
  assert.deepEqual(visibleCyclePositions(352, 200, 1040, false), [200, 352, 504, 656, 808, 960]);
  assert.deepEqual(visibleCyclePositions(-1000000, -999900, 300, false), [0, 100, 200, 300]);
  assert.deepEqual(visibleCyclePositions(2000, 2100, 300, false), []);
  const points = [{ x: 200, y: 395 }, { x: 320, y: 455 }];
  const selected = renderCycleDrawing(model('cyclic-lines'), points, bounds, true);
  assert.equal((selected.body.match(/data-cycle-line/g) ?? []).length, 8);
  assert.match(selected.body, /stroke="#80ccdb" stroke-width="2"/);
  assert.match(selected.body, /data-cycle-guide/);
  assert.doesNotMatch(selected.body, /<text/);
  assert.equal((selected.hit.match(/<line/g) ?? []).length, 9);
  assert.doesNotMatch(renderCycleDrawing(model('cyclic-lines'), points, bounds).body, /data-cycle-guide/);
});

test('time cycles reproduce screenshot semicircles in both directions with separate fill', () => {
  for (const period of [126, 322]) {
    const a = { x: 136, y: 364 }, b = { x: 136 + period, y: 650 };
    const out = renderCycleDrawing(model('time-cycles'), [a, b], bounds);
    const starts = visibleCyclePositions(a.x, b.x, bounds.width, true, true);
    assert.ok(starts[0] <= 0 && starts.at(-1) + period >= bounds.width);
    assert.ok(starts.includes(a.x));
    assert.match(out.body, /fill="#6aa84f80" stroke="none"/);
    assert.ok(out.body.includes(`A${period / 2},${period / 2} 0 0 1`));
    assert.doesNotMatch(out.body, /<line|650|data-cycle-guide/);
    assert.equal((out.hit.match(/<path/g) ?? []).length, starts.length);
    assert.doesNotMatch(out.hit, / Z/); // no fake horizontal hit line along the baseline
  }
});

test('time cycles share a baseline during edits and migrate unused legacy prices', () => {
  const points = model('time-cycles').points;
  assert.deepEqual(cycleAnchorPoints('time-cycles', points), [{ time: 100, price: 100 }, { time: 200, price: 100 }]);
  assert.deepEqual(moveCycleAnchor('time-cycles', points, 1, { time: 250, price: 150 }), [{ time: 100, price: 150 }, { time: 250, price: 150 }]);
  assert.deepEqual(moveCycleAnchor('time-cycles', points, 0, { time: 50, price: 90 }), [{ time: 50, price: 90 }, { time: 200, price: 90 }]);
  assert.equal(points[1].price, 130, 'normalization does not mutate the input');
  for (const tool of ['cyclic-lines', 'sine-line']) {
    const next = moveCycleAnchor(tool, points, 1, { time: 250, price: 150 });
    assert.deepEqual(next[0], points[0]);
    assert.deepEqual(moveCycleAnchor(tool, points, 1, { time: 100, price: 300 }), points);
  }
});

test('sine anchors are adjacent extrema: screenshot half-period, amplitude and phase', () => {
  for (const b of [{ x: 467, y: 717 }, { x: 361, y: 656 }]) {
    const a = { x: 271, y: 854 }, delta = b.x - a.x;
    near(sineValueAt(a, b, a.x), a.y);
    near(sineValueAt(a, b, b.x), b.y);
    near(sineValueAt(a, b, a.x + 2 * delta), a.y);
    near(sineValueAt(a, b, a.x - delta), b.y);
    near(sineValueAt(a, b, a.x + delta / 2), (a.y + b.y) / 2);
    const points = sineWavePoints(a, b, bounds.width);
    assert.equal(points[0].x, 0); assert.equal(points.at(-1).x, bounds.width);
    assert.ok(points.some(p => p.x === a.x && p.y === a.y));
    assert.ok(points.some(p => p.x === b.x && p.y === b.y));
    for (const p of points) { assert.ok(p.y >= b.y && p.y <= a.y); near(sineValueAt(b, a, p.x), p.y); }
    const out = renderCycleDrawing(model('sine-line'), [a, b], bounds, true);
    assert.match(out.body, /data-cycle-sine/); assert.doesNotMatch(out.body, /data-cycle-guide|data-cycle-fill/);
  }
});

test('degenerate and dense inputs remain finite and bounded without inventing a 4px period', () => {
  for (const tool of ['cyclic-lines', 'time-cycles', 'sine-line']) {
    assert.equal(tradingDrawingPlacementMode(tradingDrawingToolDefinition(tool)), 'two-click');
    const out = renderCycleDrawing(model(tool), [{ x: 100, y: 300 }, { x: 100, y: 200 }], bounds, true);
    assert.doesNotMatch(out.body, /NaN|Infinity|data-cycle-arc|data-cycle-sine/);
  }
  assert.ok(visibleCyclePositions(-1e8, -1e8 + .0001, 4000, true).length <= 8192);
  assert.ok(sineWavePoints({ x: 0, y: 10 }, { x: .0001, y: 100 }, 4000).length <= 24577);
  assert.deepEqual(visibleCyclePositions(Infinity, 0, 100, true), []);
  assert.deepEqual(visibleCyclePositions(0, 1, 3, false), [0, 1, 2, 3]);
});

test('user line style and transparent background survive cycle rendering', () => {
  const drawing = model('time-cycles', { color: '#e91e63', lineWidth: 4, lineStyle: 'dashed', textBackgroundColor: '#12345600' });
  const out = renderCycleDrawing(drawing, [{ x: 100, y: 300 }, { x: 300, y: 300 }], bounds);
  assert.match(out.body, /stroke="#e91e63" stroke-width="4" stroke-dasharray="7 5"/);
  assert.match(out.body, /fill="#12345600"/);
});

test('eraser hits repetitions, not an invisible chord or the region below semicircles', () => {
  const a = { x: 100, y: 300 }, b = { x: 300, y: 100 };
  near(cycleHitDistance('cyclic-lines', [a,b], { x: 700, y: 10 }, 1000), 0);
  assert.ok(cycleHitDistance('cyclic-lines', [a,b], { x: 200, y: 200 }, 1000) > 16);
  near(cycleHitDistance('time-cycles', [a,b], { x: 800, y: 200 }, 1000), 0);
  assert.ok(cycleHitDistance('time-cycles', [a,b], { x: 800, y: 400 }, 1000) > 16);
  near(cycleHitDistance('sine-line', [a,b], { x: 700, y: 100 }, 1000), 0);
  assert.ok(cycleHitDistance('sine-line', [a,b], { x: 700, y: 200 }, 1000) > 16);
});
