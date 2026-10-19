import assert from 'node:assert/strict';
import test from 'node:test';
import { rotatedRectangleGeometry, rotatedRectangleWidthPoint, moveRotatedRectangleHandle } from '../src/renderer/trading-rotated-rectangle.ts';
import { tradingDrawingToolDefinition, tradingDrawingPlacementMode, tradingDrawingClosedHitArea, tradingDrawingLabelGeometry } from '../src/renderer/trading-expert-drawing.ts';
import { drawingToWire, drawingFromWire } from '../src/renderer/manual-drawing-sync.ts';
import { translateDrawingText } from '../src/renderer/app-language.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const nearPoint = (a, b) => { near(a.x, b.x); near(a.y, b.y); };

test('rotated rectangles use a fixed centerline and independent perpendicular width', () => {
  const tool = tradingDrawingToolDefinition('rotated-rectangle');
  assert.equal(tradingDrawingPlacementMode(tool), 'three-click');
  for (const b of [{ x: 500, y: 300 }, { x: 100, y: 450 }, { x: 20, y: 150 }, { x: 500, y: 150 }]) {
    const a = { x: 100, y: 150 }, base = rotatedRectangleGeometry(a, b);
    for (const width of [-120, -10, 0, 30, 200]) for (const along of [-300, 0, 750]) {
      const c = { x: b.x + base.normal.x * width + base.axis.x * along, y: b.y + base.normal.y * width + base.axis.y * along };
      const g = rotatedRectangleGeometry(a, b, c), corners = g.corners;
      near(g.halfWidth, Math.abs(width));
      nearPoint({ x: (corners[0].x + corners[3].x) / 2, y: (corners[0].y + corners[3].y) / 2 }, a);
      nearPoint({ x: (corners[1].x + corners[2].x) / 2, y: (corners[1].y + corners[2].y) / 2 }, b);
      near((corners[1].x - corners[0].x) * (corners[3].x - corners[0].x) + (corners[1].y - corners[0].y) * (corners[3].y - corners[0].y), 0);
      assert.deepEqual(tradingDrawingClosedHitArea(tool, a, b, c), { type: 'polygon', points: corners });
      near(rotatedRectangleGeometry(a, b, rotatedRectangleWidthPoint(a, b, c)).halfWidth, Math.abs(width));
    }
  }
});

test('six handles preserve the opposite endpoint and rectangle geometry during rotation and resizing', () => {
  const a = { x: 150, y: 150 }, b = { x: 600, y: 330 };
  const points = [a, b, rotatedRectangleWidthPoint(a, b, { x: 550, y: 450 })];
  const original = structuredClone(points), g = rotatedRectangleGeometry(...points);
  for (let index = 0; index < 6; index++) {
    const p = g.handles[index], pointer = { x: p.x + 42, y: p.y + 58 };
    const next = moveRotatedRectangleHandle(points, index, pointer), result = rotatedRectangleGeometry(...next);
    const movedEnd = index < 2 ? index : index === 2 || index === 5 ? 0 : 1;
    assert.deepEqual(next[1 - movedEnd], points[1 - movedEnd]);
    if (index < 2) { nearPoint(next[index], pointer); near(result.halfWidth, g.halfWidth); }
    else { nearPoint(result.handles[index], pointer); near(result.axis.x, g.axis.x); near(result.axis.y, g.axis.y); }
    assert.equal(next.length, 3);
    assert.ok(next.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  }
  assert.deepEqual(points, original);
  assert.deepEqual(moveRotatedRectangleHandle(points, 0, b), points, 'coincident axis is rejected');
  assert.ok(rotatedRectangleGeometry(a, a, b).corners.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  near(rotatedRectangleGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }).halfWidth, 18);
});

test('center labels keep the axis angle through width edits and persistence', () => {
  const points = [{ x: 100, y: 150 }, { x: 600, y: 350 }];
  const drawing = { id: 'rotated', tool: 'rotated-rectangle', symbol: 'BINANCE:FUTURES:BTCUSDT', text: '倾斜文字', textAlign: 'center', textVerticalAlign: 'middle', points: [{ time: 100, price: 150 }, { time: 600, price: 350 }, { time: 600, price: 450 }] };
  for (const width of [{ x: 600, y: 450 }, { x: 100, y: 500 }]) {
    const label = tradingDrawingLabelGeometry(drawing, [...points, width], { width: 900, height: 650 });
    near(label.x, 350); near(label.y, 250);
    near(label.angle, Math.atan2(200, 500) * 180 / Math.PI);
    near(label.top + label.layout.height / 2, label.y);
  }
  const restored = drawingFromWire(drawingToWire(drawing), drawing.symbol);
  for (const key of ['points', 'text', 'textAlign', 'textVerticalAlign']) assert.deepEqual(restored[key], drawing[key]);
  for (const text of ['中轴线已确定 · 移动鼠标调整矩形宽度，点击完成 · 右键撤销上一端点', '移动鼠标选择终点，点击确定中轴线 · 右键撤销上一端点']) assert.doesNotMatch(translateDrawingText(text, 'en'), /\p{Script=Han}/u);
});
