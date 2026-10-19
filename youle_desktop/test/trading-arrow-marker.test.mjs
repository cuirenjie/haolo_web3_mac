import assert from 'node:assert/strict';
import test from 'node:test';
import {
  tradingDrawingArrowMarkerPoints,
  tradingDrawingAxisMarkerPoints,
  tradingDrawingClosedHitArea,
  tradingDrawingPlacementMode,
  tradingDrawingRequiredPointCount,
  tradingDrawingToolDefinition,
} from '../src/renderer/trading-expert-drawing.ts';

test('arrow marker requires two clicks while directional stamps remain single-click', () => {
  const arrow = tradingDrawingToolDefinition('arrow-marker');
  assert.equal(tradingDrawingRequiredPointCount(arrow), 2);
  assert.equal(tradingDrawingPlacementMode(arrow), 'two-click');
  for (const id of ['arrow-up', 'arrow-down', 'arrow-left', 'arrow-right', 'flag']) {
    assert.equal(tradingDrawingPlacementMode(tradingDrawingToolDefinition(id)), 'single-click');
  }
  const anchors = [{ time: 100, price: 400 }, { time: 200, price: 200 }];
  assert.deepEqual(tradingDrawingAxisMarkerPoints(arrow, anchors), anchors.map(point => ({ point, showPrice: true, showTime: true })));
});

test('the whole filled arrow scales from its fixed tail and ends exactly at the pointer', () => {
  const tail = { x: 100, y: 80 }, tip = { x: 280, y: 190 };
  const small = tradingDrawingArrowMarkerPoints(tail, tip);
  const large = tradingDrawingArrowMarkerPoints(tail, { x: 460, y: 300 });
  assert.deepEqual(small[0], tail);
  assert.deepEqual(small[3], tip);
  for (let i = 0; i < small.length; i++) {
    assert.ok(Math.abs(large[i].x - tail.x - 2 * (small[i].x - tail.x)) < 1e-9);
    assert.ok(Math.abs(large[i].y - tail.y - 2 * (small[i].y - tail.y)) < 1e-9);
  }
  assert.deepEqual(tradingDrawingClosedHitArea(tradingDrawingToolDefinition('arrow-marker'), tail, tip), { type: 'polygon', points: small });
});

test('rotation, reversed direction, offscreen and coincident endpoints keep finite geometry', () => {
  const origin = { x: 0, y: 0 };
  const horizontal = tradingDrawingArrowMarkerPoints(origin, { x: 100, y: 0 });
  const vertical = tradingDrawingArrowMarkerPoints(origin, { x: 0, y: 100 });
  horizontal.forEach((point, index) => {
    assert.equal(vertical[index].x + point.y, 0);
    assert.equal(vertical[index].y, point.x);
  });
  for (const tip of [{ x: -100, y: -200 }, { x: 0, y: -100 }, { x: 0.001, y: 0 }, { x: 20000, y: -30000 }, origin]) {
    const points = tradingDrawingArrowMarkerPoints(origin, tip);
    assert.deepEqual(points[3], tip);
    assert.ok(points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
  }
  assert.ok(tradingDrawingArrowMarkerPoints(origin, origin).every(point => point.x === 0 && point.y === 0));
});
