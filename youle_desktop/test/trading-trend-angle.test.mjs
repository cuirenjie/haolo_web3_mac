import assert from 'node:assert/strict';
import test from 'node:test';
import { tradingTrendAngleGeometry, renderTradingTrendAngleAnnotation } from '../src/renderer/trading-trend-angle.ts';

test('trend angle measures all four quadrants from the rightward baseline without folding leftward angles', () => {
  const first = { x: 200, y: 200 };
  for (const [dx, dy, angle] of [[100, 100, -45], [-100, 100, -135], [-100, -100, 135], [100, -100, 45], [0, 100, -90], [0, -100, 90], [100, 0, 0], [-100, 0, -180]]) {
    const g = tradingTrendAngleGeometry(first, { x: first.x + dx, y: first.y + dy });
    assert.equal(g.angle, angle);
    assert.equal(g.label, `${angle.toFixed(2)}°`);
    assert.deepEqual(g.baselineEnd, { x: 256, y: 200 });
    assert.ok(Math.abs(Math.hypot(g.arcEnd.x - first.x, g.arcEnd.y - first.y) - 56) < 1e-10);
    assert.ok(Math.abs((g.arcEnd.x - first.x) * dy - (g.arcEnd.y - first.y) * dx) < 1e-9);
    if (dy) assert.match(g.arcPath, new RegExp(` A 56 56 0 0 ${dy > 0 ? 1 : 0} `));
  }
});

test('moving either endpoint and changing chart scale recomputes both the sweep and the displayed angle', () => {
  const first = { x: 300, y: 200 }, second = { x: 560, y: 395 };
  const original = tradingTrendAngleGeometry(first, second);
  assert.equal(original.label, '-36.87°');
  const endDragged = tradingTrendAngleGeometry(first, { x: 220, y: 410 });
  assert.equal(endDragged.label, '-110.85°');
  assert.notEqual(endDragged.arcPath, original.arcPath);
  const startDragged = tradingTrendAngleGeometry({ x: 400, y: 400 }, second);
  assert.equal(startDragged.label, '1.79°');
  assert.notEqual(startDragged.arcPath, original.arcPath);
  const zoomed = tradingTrendAngleGeometry(first, { x: 820, y: 395 });
  assert.equal(zoomed.label, '-20.56°');
  assert.equal(tradingTrendAngleGeometry({ x: 310, y: 210 }, { x: 570, y: 405 }).label, original.label);
});

test('short, coincident and horizontal lines have finite geometry and no negative-zero label', () => {
  for (const second of [{ x: 0, y: 0 }, { x: 2, y: 1 }, { x: 200, y: .00001 }]) {
    const g = tradingTrendAngleGeometry({ x: 0, y: 0 }, second);
    assert.ok(g.radius <= Math.hypot(second.x, second.y));
    const svg = renderTradingTrendAngleAnnotation({ x: 0, y: 0 }, second, '#2962ff', 1);
    assert.doesNotMatch(svg, /NaN|Infinity|undefined|-0\.00°|marker-end|<rect/);
  }
  const zero = tradingTrendAngleGeometry({ x: 0, y: 0 }, { x: 0, y: 0 });
  assert.equal(zero.label, '0.00°');
  assert.equal(zero.arcPath, '');
});
