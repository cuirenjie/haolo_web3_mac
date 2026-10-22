import assert from 'node:assert/strict';
import test from 'node:test';
import { TradingDrawingController, TRADING_DRAWING_TOOLS, tradingDrawingSupportsSettings, tradingDrawingHidesLineNodes, tradingDrawingLabelGeometry, tradingDrawingLabelSpan, renderTradingDrawingLabel } from '../src/renderer/trading-expert-drawing.ts';
import { drawingToWire, drawingFromWire } from '../src/renderer/manual-drawing-sync.ts';

const bounds = { width: 800, height: 600 };
const model = { id: 'label', tool: 'trend-line', symbol: 'BINANCE:FUTURES:BTCUSDT', text: '支撑 <b>', points: [{ time: 1700000000, price: 1300 }, { time: 1700010000, price: 1310 }] };

test('center add-text placeholders use the authored label gap on the drawing geometry only',()=>{
  const controller=Object.assign(Object.create(TradingDrawingController.prototype),{userDrawingEnabled:true,labelMaskPrefix:'test',activeTool:'cursor'});
  const points=[{x:100,y:100},{x:500,y:300}],body='<path id="stroke"/>',hit='<path id="hit"/>';
  const render=drawing=>controller.renderDrawingFrame(drawing,points,bounds,false,true,body,hit,'');
  for(const tool of ['trend-line','ray','horizontal-line','vertical-line','multi-point-path']){
    const drawing={...model,tool,text:''},html=render(drawing);
    assert.match(html,/class="trading-drawing-add-text-mask"/);
    assert.match(html,/<g class="trading-drawing-geometry" data-drawing-placeholder-mask="true" style="--trading-drawing-placeholder-mask:url\(#[^)]+\)"><path id="stroke"\/><\/g><path id="hit"\/>/);
    const center=tradingDrawingLabelGeometry({...drawing,text:'＋ 添加文字',fontSize:12,textAlign:'center',textVerticalAlign:'middle'},points,bounds,{width:84,height:22});
    assert.ok(html.includes(`transform="rotate(${center.angle} ${center.x} ${center.y})"`));
    assert.ok(html.includes(`x="${center.left-4}" y="${center.top-2}" width="92" height="26"`));
  }
  assert.match(render({...model,textVerticalAlign:'middle'}),/ mask="url\(/);
  assert.doesNotMatch(render({...model,textVerticalAlign:'middle'}),/trading-drawing-add-text-mask/);
  for(const drawing of [{...model,text:'',locked:true},{...model,text:'',source:'ai'},{...model,text:'',tool:'rectangle'}]){
    assert.doesNotMatch(render(drawing),/trading-drawing-add-text-mask/);
  }
});

test('line node policy preserves closed-shape adjustment handles', () => {
  for (const tool of ['trend-line', 'ray', 'horizontal-line', 'arrow', 'curve', 'double-curve', 'multi-point-path', 'multi-point-polyline', 'path', 'polyline', 'brush', 'highlighter', 'pitchfork', 'parallel-channel', 'regression-trend', 'fib-retracement', 'fib-spiral', 'elliott-impulse', 'anchored-vwap', 'forecast']) {
    assert.equal(tradingDrawingHidesLineNodes(tool), true, tool);
  }
  for (const tool of ['rectangle', 'rotated-rectangle', 'circle', 'ellipse', 'triangle', 'arc', 'arrow-up', 'arrow-down', 'sector', 'gann-box', 'long-position', 'price-range', 'fixed-range-volume', 'emoji']) {
    assert.equal(tradingDrawingHidesLineNodes(tool), false, tool);
  }
});

test('freehand and segmented line text uses the actual half-length point', () => {
  const points = [{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 500 }];
  for (const tool of ['brush', 'highlighter', 'multi-point-path', 'multi-point-polyline', 'anchored-vwap']) {
    const g = tradingDrawingLabelGeometry({ ...model, tool, textAlign: 'center', textVerticalAlign: 'middle' }, points, bounds);
    assert.equal(g.x, 400, tool); assert.equal(g.y, 150, tool); assert.equal(g.angle, 90, tool);
  }
});

test('channel center labels sit between the two edges', () => {
  const points = [{ x: 100, y: 100 }, { x: 500, y: 300 }, { x: 500, y: 400 }];
  const g = tradingDrawingLabelGeometry({ ...model, tool: 'parallel-channel', textAlign: 'center', textVerticalAlign: 'middle' }, points, bounds);
  assert.equal(g.x, 300); assert.equal(g.y, 250);
  assert.equal(g.angle, Math.atan2(200, 400) * 180 / Math.PI);
});

test('every geometric tool supports labels, while text and symbol tools retain their own editors', () => {
  for (const definition of TRADING_DRAWING_TOOLS) {
    const supported = !['cursor', 'eraser', 'text'].includes(definition.kind) && !['emoji', 'sticker', 'icon'].includes(definition.id);
    assert.equal(tradingDrawingSupportsSettings(definition.id), supported, definition.id);
    if (!supported) continue;
    const drawing = { ...model, tool: definition.id, textColor: '#ef5350', fontSize: 24, textAlign: 'right', textVerticalAlign: 'bottom', italic: true };
    const geometry = tradingDrawingLabelGeometry(drawing, [{ x: 100, y: 100 }, { x: 500, y: 300 }], bounds);
    assert.ok(geometry, definition.id);
    const markup = renderTradingDrawingLabel(drawing, geometry, '#2962ff', true);
    assert.match(markup, /支撑 &lt;b&gt;/);
    assert.match(markup, /font-size="24" font-weight="400" font-style="italic"/);
    assert.match(markup, /data-horizontal-line-edit-text="label"/);
    const restored = drawingFromWire(drawingToWire(drawing), drawing.symbol);
    for (const key of ['tool', 'text', 'textColor', 'fontSize', 'textAlign', 'textVerticalAlign', 'italic']) assert.equal(restored[key], drawing[key], definition.id + ' ' + key);
  }
});

test('sloping line labels align relative to the visible line, independent of endpoint order', () => {
  const points = [{ x: 100, y: 100 }, { x: 500, y: 300 }];
  for (const textAlign of ['left', 'center', 'right']) {
    const drawing = { ...model, textAlign };
    const g = tradingDrawingLabelGeometry(drawing, points, bounds);
    assert.deepEqual(g, tradingDrawingLabelGeometry(drawing, points.toReversed(), bounds));
    const insetX = 8 * 400 / Math.hypot(400, 200);
    assert.ok(Math.abs(g.x - { left: 100 + insetX, center: 300, right: 500 - insetX }[textAlign]) < 1e-9);
    assert.ok(Math.abs(g.y - (100 + (g.x - 100) * .5)) < 1e-9);
    assert.equal(g.angle, Math.atan2(200, 400) * 180 / Math.PI);
  }
});

test('ray labels follow clipped ray direction and vertical labels follow their line', () => {
  const span = tradingDrawingLabelSpan({ ...model, tool: 'ray' }, [{ x: 400, y: 200 }, { x: 300, y: 100 }], bounds);
  assert.deepEqual(span, [{ x: 200, y: 0 }, { x: 400, y: 200 }]);
  const g = tradingDrawingLabelGeometry({ ...model, tool: 'vertical-line', textVerticalAlign: 'middle' }, [{ x: 600, y: 200 }], bounds);
  assert.equal(g.x, 600); assert.equal(g.top + g.layout.height / 2, 300);
  assert.equal(tradingDrawingLabelGeometry(model, [{ x: -200, y: 100 }, { x: -100, y: 200 }], bounds), null);
  assert.equal(tradingDrawingLabelGeometry({ ...model, text: '' }, [{ x: 100, y: 100 }, { x: 500, y: 300 }], bounds), null);
});

test('shape labels and native editor measurements stay within the chart when clipped', () => {
  const points = [{ x: -100, y: 200 }, { x: 1000, y: 400 }];
  for (const tool of ['rectangle', 'circle', 'triangle', 'fib-retracement', 'multi-point-path', 'brush']) {
    for (const textAlign of ['left', 'center', 'right']) {
      const g = tradingDrawingLabelGeometry({ ...model, tool, textAlign }, points, bounds, { width: 240, height: 30 });
      const radians = g.angle * Math.PI / 180;
      for (const x of [g.left, g.left + 240]) for (const y of [g.top, g.top + 30]) {
        const screenX = g.x + (x - g.x) * Math.cos(radians) - (y - g.y) * Math.sin(radians);
        const screenY = g.y + (x - g.x) * Math.sin(radians) + (y - g.y) * Math.cos(radians);
        assert.ok(screenX >= 0 && screenX <= bounds.width && screenY >= 0 && screenY <= bounds.height, tool);
      }
    }
  }
});

test('all straight label baselines are parallel to the projected stroke, including reversed and steep lines', () => {
  for (const tool of ['trend-line','ray','extended-line','arrow','parallel-channel','pitchfork','arrow-marker','rotated-rectangle']) {
    for (const points of [[{x:100,y:100},{x:700,y:400}],[{x:100,y:500},{x:700,y:100}],[{x:400,y:10},{x:401,y:590}],[{x:400,y:590},{x:400,y:10}]]) {
      for (const textVerticalAlign of ['top','middle','bottom']) for (const textAlign of ['left','center','right']) {
        const drawing = {...model,tool,textAlign,textVerticalAlign};
        const g = tradingDrawingLabelGeometry(drawing,points,bounds);
        const angle = g.angle * Math.PI / 180, dx = points[1].x - points[0].x, dy = points[1].y - points[0].y;
        assert.ok(Math.abs(Math.cos(angle)*dy-Math.sin(angle)*dx)<1e-8,tool);
        assert.ok(g.angle>=-90&&g.angle<=90, 'labels are never upside-down');
        assert.ok(Math.abs((g.x-points[0].x)*dy-(g.y-points[0].y)*dx)<1e-7,'anchor stays on stroke');
        assert.match(renderTradingDrawingLabel(drawing,g,'#2962ff',true),/class="trading-drawing-label" transform="rotate\(/);
      }
    }
  }
});

test('path labels follow the segment beneath them and curve labels follow the local tangent', () => {
  const points=[{x:100,y:200},{x:400,y:100},{x:700,y:400}];
  for(const tool of ['brush','multi-point-path','multi-point-polyline']) {
    const g=tradingDrawingLabelGeometry({...model,tool},points,bounds);
    assert.equal(g.angle,45,tool);
  }
  for(const tool of ['arc','curve','double-curve']) {
    const g=tradingDrawingLabelGeometry({...model,tool},[points[0],points[2]],bounds);
    assert.ok(Math.abs(g.angle-Math.atan2(200,600)*180/Math.PI)<1e-9,tool);
  }
});

test('default labels sit above the local slope and all nine alignments preserve that local frame', () => {
  for (const points of [[{ x: 100, y: 100 }, { x: 700, y: 400 }], [{ x: 100, y: 500 }, { x: 700, y: 100 }]]) {
    const defaultLabel = tradingDrawingLabelGeometry(model, points, bounds);
    assert.deepEqual(defaultLabel, tradingDrawingLabelGeometry({ ...model, textAlign: 'center', textVerticalAlign: 'top' }, points, bounds));
    for (const textAlign of ['left', 'center', 'right']) for (const textVerticalAlign of ['top', 'middle', 'bottom']) {
      const drawing = { ...model, textAlign, textVerticalAlign };
      const g = tradingDrawingLabelGeometry(drawing, points, bounds);
      assert.deepEqual(g, tradingDrawingLabelGeometry(drawing, points.toReversed(), bounds));
      assert.ok(Math.abs(g.left - g.x - { left: 0, center: -g.layout.width / 2, right: -g.layout.width }[textAlign]) < 1e-9);
      if (textVerticalAlign === 'top') assert.ok(Math.abs(g.top + g.layout.height - g.y + 6) < 1e-9);
      if (textVerticalAlign === 'middle') assert.equal(g.top + g.layout.height / 2, g.y);
      if (textVerticalAlign === 'bottom') assert.equal(g.top - g.y, 6);
    }
  }
});
