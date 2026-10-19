import assert from 'node:assert/strict';
import test from 'node:test';
import {
  tradingDrawingFlatTopBottomPoints, tradingDrawingDisjointChannelPoints,
  tradingDrawingMoveShapedChannelHandle, tradingDrawingShapedChannelHandlePoint,
  tradingDrawingClosedHitArea, tradingDrawingLabelSpan, tradingDrawingPlacementMode,
  tradingDrawingToolDefinition, tradingDrawingAdvanceDraftPoints, tradingDrawingRewindDraftPoints, tradingDrawingAxisMarkerPoints,
} from '../src/renderer/trading-expert-drawing.ts';
import { translateDrawingText } from '../src/renderer/app-language.mjs';

for (const tool of ['flat-top-bottom', 'disjoint-channel']) {
  const geometry = tool === 'flat-top-bottom' ? tradingDrawingFlatTopBottomPoints : tradingDrawingDisjointChannelPoints;
  test(`${tool}: fixed baseline, independent height, forward/reverse, flat/angled and crossed edges`, () => {
    const definition = tradingDrawingToolDefinition(tool);
    assert.equal(tradingDrawingPlacementMode(definition), 'three-click');
    for (const [a, b] of [
      [{ x: 100, y: 100 }, { x: 500, y: 240 }],
      [{ x: 500, y: 240 }, { x: 100, y: 100 }],
      [{ x: 100, y: 300 }, { x: 500, y: 150 }],
      [{ x: 100, y: 200 }, { x: 500, y: 200 }],
    ]) for (const y of [50, 100, 180, 240, 400]) for (const x of [-100, 200, 700]) {
      const expected = [a, b, { x: b.x, y }, { x: a.x, y: tool === 'flat-top-bottom' ? y : y + b.y - a.y }];
      assert.deepEqual(geometry(a, b, { x, y }), expected);
      assert.deepEqual(tradingDrawingClosedHitArea(definition, a, b, { x, y }), { type: 'polygon', points: expected });
      assert.deepEqual(tradingDrawingLabelSpan({ tool }, [a, b, { x, y }], { width: 800, height: 600 }), a.x < b.x ? [a, b] : [b, a]);
    }
  });
  test(`${tool}: second click keeps the draft open; third click completes; right-click removes only the last anchor`, () => {
    const a = { time: 1, price: 100 }, b = { time: 2, price: 90 }, c = { time: 2, price: 60 };
    const second = tradingDrawingAdvanceDraftPoints([a, b], 1, 3, b);
    assert.equal(second.complete, false);
    assert.deepEqual(second.points.slice(0, 2), [a, b]);
    const third = tradingDrawingAdvanceDraftPoints(second.points, 2, 3, c);
    assert.equal(third.complete, true);
    assert.deepEqual(third.points, [a, b, c]);
    const rewind = tradingDrawingRewindDraftPoints(second.points, 2, c);
    assert.deepEqual(rewind.points, [a, c]);
    assert.equal(rewind.confirmedPointCount, 1);
  });
}

test('flat edge remains horizontal when any of its four handles is moved', () => {
  const points = [{ time: 1, price: 120 }, { time: 5, price: 100 }, { time: 5, price: 80 }];
  for (const index of [0, 1, 2, 3]) {
    const changed = tradingDrawingMoveShapedChannelHandle('flat-top-bottom', points, index, { time: 3, price: 90 });
    assert.equal(changed[2].time, changed[1].time);
    const left = tradingDrawingShapedChannelHandlePoint('flat-top-bottom', changed, 3);
    const right = tradingDrawingShapedChannelHandlePoint('flat-top-bottom', changed, 2);
    assert.equal(left.price, right.price);
    assert.equal(left.time, changed[0].time);
    assert.equal(right.time, changed[1].time);
    if (index < 2) assert.equal(changed[2].price, 80);
    else assert.deepEqual(changed.slice(0, 2).map(p => p.price), [120, 100]);
  }
  assert.deepEqual(points, [{ time: 1, price: 120 }, { time: 5, price: 100 }, { time: 5, price: 80 }]);
});

test('disjoint circular handles resize symmetrically; the opposite-end handle moves only the second edge', () => {
  const points = [{ time: 1, price: 120 }, { time: 5, price: 100 }, { time: 5, price: 80 }];
  assert.deepEqual(tradingDrawingShapedChannelHandlePoint('disjoint-channel', points, 3), { time: 1, price: 60 });
  for (const index of [0, 1, 3]) {
    const changed = tradingDrawingMoveShapedChannelHandle('disjoint-channel', points, index, { time: 3, price: 110 });
    const other = tradingDrawingShapedChannelHandlePoint('disjoint-channel', changed, 3);
    assert.equal(changed[0].price + other.price, 180, 'fixed center at start');
    assert.equal(changed[1].price + changed[2].price, 180, 'fixed center at end');
    assert.equal(changed[1].price - changed[0].price, -(changed[2].price - other.price));
    assert.deepEqual(tradingDrawingShapedChannelHandlePoint('disjoint-channel', changed, index), { time: 3, price: 110 });
  }
  const shifted = tradingDrawingMoveShapedChannelHandle('disjoint-channel', points, 2, { time: 999, price: 90 });
  assert.deepEqual(shifted.slice(0, 2), points.slice(0, 2));
  assert.deepEqual(shifted[2], { time: 5, price: 90 });
  assert.equal(tradingDrawingShapedChannelHandlePoint('disjoint-channel', shifted, 3).price, 70);
});

test('shaped-channel instructions translate into English', () => {
  for (const boundary of ['水平边界', '反向边界']) assert.doesNotMatch(
    translateDrawingText(`线段已确定 · 上下移动鼠标放置${boundary}，点击完成 · 右键撤销上一端点`, 'en'), /\p{Script=Han}/u);
});

test('selected channels label both primary prices and every opposite corner price at the real endpoint times', () => {
  const points = [{ time: 1, price: 120 }, { time: 5, price: 100 }, { time: 999, price: 80 }];
  for (const tool of ['flat-top-bottom', 'disjoint-channel']) {
    const markers = tradingDrawingAxisMarkerPoints(tradingDrawingToolDefinition(tool), points);
    assert.deepEqual(markers.map(m => m.point.time), [1, 5, 5, 1]);
    assert.deepEqual(markers.map(m => m.point.price), [120, 100, 80, tool === 'flat-top-bottom' ? 80 : 60]);
    assert.ok(markers.every(m => m.showPrice && m.showTime));
  }
});
