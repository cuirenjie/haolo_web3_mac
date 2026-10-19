import assert from 'node:assert/strict';
import test from 'node:test';
import {
  tradingDrawingChannelPoints, tradingDrawingClosedHitArea, tradingDrawingLabelSpan,
  tradingDrawingPlacementMode, tradingDrawingToolDefinition,
} from '../src/renderer/trading-expert-drawing.ts';
import { translateDrawingText } from '../src/renderer/app-language.mjs';

test('parallel channel fixes its baseline and projects a mouse-controlled edge on either side', () => {
  const definition = tradingDrawingToolDefinition('parallel-channel');
  assert.equal(tradingDrawingPlacementMode(definition), 'three-click');
  for (const [a, b] of [
    [{ x: 100, y: 300 }, { x: 500, y: 200 }],
    [{ x: 500, y: 200 }, { x: 100, y: 300 }],
    [{ x: 100, y: 200 }, { x: 500, y: 300 }],
    [{ x: 100, y: 300 }, { x: 500, y: 300 }],
  ]) for (const offset of [-150, -1, 0, 1, 250]) for (const x of [20, 250, 700]) {
    const mouse = { x, y: a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x) + offset };
    const expected = [a, b, { x: b.x, y: b.y + offset }, { x: a.x, y: a.y + offset }];
    assert.deepEqual(tradingDrawingChannelPoints(a, b, mouse), expected);
    assert.deepEqual(tradingDrawingClosedHitArea(definition, a, b, mouse), { type: 'polygon', points: expected });
    const span = tradingDrawingLabelSpan({ tool: 'parallel-channel' }, [a, b, mouse], { width: 800, height: 600 });
    assert.deepEqual(span, a.x < b.x ? [a, b] : [b, a]);
  }
});

test('vertical and coincident baselines have finite geometry and legacy channels retain their offset', () => {
  const a = { x: 100, y: 100 }, b = { x: 100, y: 400 }, c = { x: 150, y: 200 };
  assert.deepEqual(tradingDrawingChannelPoints(a, b, c), [a, b, { x: 150, y: 400 }, { x: 150, y: 100 }]);
  assert.ok(tradingDrawingChannelPoints(a, a, c).every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  const end = { x: 300, y: 100 };
  assert.deepEqual(tradingDrawingChannelPoints(a, end), [a, end, { x: 300, y: 140 }, { x: 100, y: 140 }]);
  assert.equal(tradingDrawingPlacementMode(tradingDrawingToolDefinition('disjoint-channel')), 'three-click');
});

test('parallel-channel placement instructions are translated', () => {
  for (const text of [
    '线段已确定 · 上下移动鼠标调整通道宽度，点击完成 · 右键撤销上一端点',
    '移动鼠标选择终点，点击确定线段 · 右键撤销上一端点',
  ]) assert.doesNotMatch(translateDrawingText(text, 'en'), /\p{Script=Han}/u);
});
