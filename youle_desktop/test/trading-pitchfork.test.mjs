import assert from 'node:assert/strict';
import test from 'node:test';
import { pitchforkGeometry, clipPitchforkBand, renderTradingPitchfork } from '../src/renderer/trading-pitchfork.ts';
import { clipTradingDrawingLine, tradingDrawingToolDefinition, tradingDrawingPlacementMode, tradingDrawingAdvanceDraftPoints, tradingDrawingRewindDraftPoints, tradingDrawingAxisMarkerPoints } from '../src/renderer/trading-expert-drawing.ts';
import { translateDrawingText } from '../src/renderer/app-language.mjs';

const tools = ['pitchfork', 'schiff-pitchfork', 'modified-schiff-pitchfork', 'inside-pitchfork'];
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);
const direction = line => ({ x: line.to.x - line.from.x, y: line.to.y - line.from.y });
const parallel = (a, b) => near(a.x * b.y - a.y * b.x, 0);
const bounds = { width: 1122, height: 1214 };

test('reference screenshots: each fork has its own origin, direction and construction lines', () => {
  const cases = [
    ['pitchfork', [{ x: 578, y: 349 }, { x: 807, y: 550 }, { x: 664, y: 672 }], { x: 578, y: 349 }, { x: 157.5, y: 262 }, { x: 578, y: 349 }],
    ['schiff-pitchfork', [{ x: 473, y: 440 }, { x: 816, y: 663 }, { x: 673, y: 832 }], { x: 473, y: 551.5 }, { x: 271.5, y: 196 }, { x: 473, y: 551.5 }],
    ['modified-schiff-pitchfork', [{ x: 206, y: 360 }, { x: 692, y: 594 }, { x: 568, y: 815 }], { x: 449, y: 477 }, { x: 181, y: 227.5 }, { x: 449, y: 477 }],
    ['inside-pitchfork', [{ x: 282, y: 408 }, { x: 816, y: 614 }, { x: 673, y: 727 }], { x: 549, y: 511 }, { x: 124, y: 216 }, { x: 744.5, y: 670.5 }],
  ];
  for (const [tool, anchors, origin, slope, medianStart] of cases) {
    const g = pitchforkGeometry(tool, anchors);
    assert.deepEqual(g.origin, origin); assert.deepEqual(g.direction, slope);
    assert.deepEqual(g.lines.find(l => l.part === 'median').from, medianStart);
    assert.deepEqual(g.lines.find(l => l.part === 'outer-b').from, anchors[1]);
    assert.deepEqual(g.lines.find(l => l.part === 'outer-c').from, anchors[2]);
    assert.equal(g.lines.some(l => l.part === 'baseline'), tool !== 'pitchfork');
    if (tool === 'inside-pitchfork') assert.deepEqual(g.lines.find(l => l.part === 'stem'), { part: 'stem', from: origin, to: anchors[2], color: '#f23645', ray: false });
    for (const line of g.lines.filter(l => l.ray)) parallel(direction(line), slope);
    assert.equal(g.bands.length, 3);
    assert.deepEqual(g.bands.map(b => b.color), ['#2962ff', '#089981', '#2962ff']);
  }
});

for (const tool of tools) {
  test(`${tool}: three clicks, free third anchor, rewind and three coordinate labels`, () => {
    const definition = tradingDrawingToolDefinition(tool);
    assert.equal(tradingDrawingPlacementMode(definition), 'three-click');
    const a = { time: 1, price: 120 }, b = { time: 8, price: 100 }, c = { time: 5, price: 80 };
    const second = tradingDrawingAdvanceDraftPoints([a, b], 1, 3, b);
    assert.equal(second.complete, false); assert.deepEqual(second.points, [a, b, b]);
    const third = tradingDrawingAdvanceDraftPoints(second.points, 2, 3, c);
    assert.equal(third.complete, true); assert.deepEqual(third.points, [a, b, c]);
    assert.deepEqual(tradingDrawingAxisMarkerPoints(definition, third.points).map(p => p.point), [a, b, c]);
    assert.deepEqual(tradingDrawingRewindDraftPoints(second.points, 2, c).points, [a, c]);
  });
  test(`${tool}: first leg, second-click ray and third-point fill are distinct phases`, () => {
    const a = { x: 100, y: 100 }, b = { x: 500, y: 300 }, c = { x: 350, y: 500 };
    const first = pitchforkGeometry(tool, [a, b]);
    assert.equal(first.lines.length, 1); assert.equal(first.bands.length, 0);
    const second = pitchforkGeometry(tool, [a, b, b]);
    assert.equal(second.bands.length, 0);
    assert.equal(second.lines.at(-1).part, 'preview-ray'); assert.deepEqual(second.lines.at(-1).from, b);
    const full = renderTradingPitchfork(tool, [a, b, c], bounds, {}, clipTradingDrawingLine);
    assert.equal((full.body.match(/data-pitchfork-fill=/g) ?? []).length, 3);
    assert.match(full.hit, /trading-drawing-hit-target area/);
    assert.doesNotMatch(full.body, /NaN|Infinity|stroke-dasharray/);
    const custom = renderTradingPitchfork(tool, [a, b, c], bounds, { color: '#123456', lineWidth: 4, lineStyle: 'dashed' }, clipTradingDrawingLine);
    assert.match(custom.body, /stroke="#123456" stroke-width="4" stroke-dasharray="8 5"/);
    assert.doesNotMatch(custom.body, /#2962ff|#089981|#f23645/);
  });
  test(`${tool}: reversed, vertical and offscreen forks stay parallel and clip fill and hit targets to the plot`, () => {
    for (const points of [
      [{ x: 800, y: 600 }, { x: 300, y: 300 }, { x: 450, y: 100 }],
      [{ x: 300, y: 100 }, { x: 400, y: 400 }, { x: 200, y: 400 }],
      [{ x: -900, y: -400 }, { x: -500, y: 300 }, { x: -300, y: 700 }],
      [{ x: 1800, y: 1500 }, { x: 1300, y: 600 }, { x: 1600, y: 400 }],
    ]) {
      const { geometry: g, segments, body } = renderTradingPitchfork(tool, points, bounds, {}, clipTradingDrawingLine);
      assert.doesNotMatch(body, /NaN|Infinity/);
      for (const [a, b] of segments) for (const p of [a, b]) { assert.ok(p.x >= -1e-6 && p.x <= bounds.width + 1e-6); assert.ok(p.y >= -1e-6 && p.y <= bounds.height + 1e-6); }
      for (const band of g.bands) for (const p of clipPitchforkBand(band, g.direction, bounds)) { assert.ok(p.x >= -1e-6 && p.x <= bounds.width + 1e-6); assert.ok(p.y >= -1e-6 && p.y <= bounds.height + 1e-6); }
      for (const line of g.lines.filter(l => l.ray)) parallel(direction(line), g.direction);
    }
  });
  test(`${tool}: degenerate anchors never create an arbitrary width or invalid SVG`, () => {
    for (const points of [[], [{ x: 1, y: 1 }], [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }], [{ x: 100, y: 100 }, { x: 100, y: 200 }, { x: 100, y: 300 }]]) {
      assert.doesNotMatch(renderTradingPitchfork(tool, points, bounds, {}, clipTradingDrawingLine).body, /NaN|Infinity/);
    }
  });
}

test('fork placement prompts have English translations', () => {
  for (const prompt of ['前两点已确定', '移动鼠标选择第三点，调整叉口与方向，点击完成', '移动鼠标选择第二点，点击确定第一段']) assert.doesNotMatch(translateDrawingText(prompt, 'en'), /[\u4e00-\u9fff]/);
});
