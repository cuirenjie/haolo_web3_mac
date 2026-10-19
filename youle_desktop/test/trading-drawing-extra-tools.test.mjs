import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { anchoredVwap, drawingVolumeProfile, trendFibTimePositions, renderExtraDrawingGeometry, renderExtraAnnotation, storeDrawingImage, drawingImageUrl } from '../src/renderer/trading-drawing-extra-tools.ts';
import { TRADING_DRAWING_TOOLS, tradingDrawingRequiredPointCount, tradingDrawingPlacementMode, renderTradingDrawingToolbar } from '../src/renderer/trading-expert-drawing.ts';
import { DRAWING_MENU_SECTIONS, drawingMenuGroup, DRAWING_ICON_PATHS, renderDrawingIcon } from '../src/renderer/trading-drawing-catalog.ts';

test('every catalog icon is explicit, and formerly conflated tools have distinct artwork', () => {
  for (const tool of TRADING_DRAWING_TOOLS) assert.ok(DRAWING_ICON_PATHS[tool.icon], tool.id);
  for (const ids of [
    ['gann-fan','fib-speed-fan'], ['note','anchored-note','anchored-text'],
    ['fixed-range-volume','anchored-volume-profile'], ['triangle','triangle-pattern'],
    ['elliott-impulse','elliott-correction','elliott-triangle','elliott-double-combo','elliott-triple-combo'],
    ['date-range','price-range','date-price-range'],
  ]) assert.equal(new Set(ids.map(id=>DRAWING_ICON_PATHS[TRADING_DRAWING_TOOLS.find(t=>t.id===id).icon])).size,ids.length);
  assert.throws(()=>renderDrawingIcon('missing-icon'), /Unknown drawing icon/);
  assert.doesNotThrow(()=>renderTradingDrawingToolbar());
});

test('click paths extend the catalog without replacing the old freehand and preset tools', () => {
  for (const id of ['multi-point-path','multi-point-polyline']) {
    const tool=TRADING_DRAWING_TOOLS.find(t=>t.id===id);
    assert.equal(tradingDrawingPlacementMode(tool),'multi-click');
    assert.equal(tool.freehand,false);
    assert.equal(drawingMenuGroup(id),'brush');
  }
  assert.equal(tradingDrawingPlacementMode(TRADING_DRAWING_TOOLS.find(t=>t.id==='path')),'drag');
  assert.equal(tradingDrawingPlacementMode(TRADING_DRAWING_TOOLS.find(t=>t.id==='polyline')),'two-click');
});

test('all 77 original Haolo tools retain their ids, drawing families and freehand behavior', async () => {
  const baseline=JSON.parse(await readFile(new URL('./fixtures/haolo-drawing-tools-before-reference.json',import.meta.url),'utf8'));
  assert.equal(baseline.tools.length,77);
  for(const old of baseline.tools) {
    const tool=TRADING_DRAWING_TOOLS.find(t=>t.id===old.id);
    assert.ok(tool,`Original Haolo tool must be retained: ${old.id}`);
    assert.equal(tool.kind,['comment','signpost'].includes(old.id)?'text':old.kind,old.id); assert.equal(!!tool.freehand,old.freehand,old.id);
  }
});

test('every tool is reachable once, including merged line/channel and brush/shape groups', () => {
  const menuIds = DRAWING_MENU_SECTIONS.flatMap(g=>g.sections.flatMap(s=>s.tools));
  assert.equal(new Set(menuIds).size,menuIds.length);
  assert.deepEqual(new Set(menuIds),new Set(TRADING_DRAWING_TOOLS.map(t=>t.id)));
  assert.equal(drawingMenuGroup('parallel-channel'),'trend');
  assert.equal(drawingMenuGroup('rectangle'),'brush');
  assert.equal(drawingMenuGroup('arrow-up'),'brush');
});

test('anchored VWAP excludes earlier bars and weights typical prices by real volume', () => {
  const candles=[
    {time:1,open:100,high:100,low:100,close:100,volume:10000},
    {time:2,open:10,high:13,low:7,close:10,volume:1},
    {time:3,open:20,high:23,low:17,close:20,volume:3},
    {time:4,open:999,high:999,low:999,close:999,volume:0},
  ];
  assert.deepEqual(anchoredVwap(candles,2),[{time:2,price:10},{time:3,price:17.5},{time:4,price:17.5}]);
  assert.deepEqual(anchoredVwap(candles,5),[]);
  assert.deepEqual(anchoredVwap(candles.map(c=>({...c,volume:0})),2),[]);
});

test('volume-at-price conserves volume, clips the requested range and handles flat candles', () => {
  const candles=[
    {time:1,open:0,high:20,low:0,close:20,volume:200},
    {time:2,open:5,high:5,low:5,close:5,volume:30},
    {time:3,open:5,high:9,low:0,close:1,volume:80},
  ];
  const bins=drawingVolumeProfile(candles,1,2,4);
  assert.equal(bins.reduce((s,b)=>s+b.volume,0),230);
  assert.equal(bins.reduce((s,b)=>s+b.up,0),230);
  assert.deepEqual(bins.map(b=>b.volume),[50,80,50,50]);
  assert.deepEqual(drawingVolumeProfile(candles,2,1,4),bins);
  assert.deepEqual(drawingVolumeProfile(candles,4),[]);
  assert.equal(drawingVolumeProfile([candles[1]],2).reduce((s,b)=>s+b.volume,0),30);
});

test('trend Fibonacci time is based on the first interval and the third anchor in either direction', () => {
  assert.equal(trendFibTimePositions(10,30,100).find(v=>v.ratio===1.618).value,132.36);
  assert.equal(trendFibTimePositions(30,10,100).find(v=>v.ratio===2).value,60);
  for (const [id,count] of [['fib-trend-time',3],['sector',3],['elliott-double-combo',4],['elliott-triple-combo',6],['anchored-vwap',1]])
    assert.equal(tradingDrawingRequiredPointCount(TRADING_DRAWING_TOOLS.find(t=>t.id===id)),count);
});

test('new geometry remains finite with coincident, reversed and offscreen anchors, with draggable paths', () => {
  const ids=['fib-trend-time','fib-speed-arcs','gann-square-fixed','time-cycles','sine-line','anchored-vwap','anchored-volume-profile','sector'];
  const candles=[{time:0,open:10,high:15,low:5,close:12,volume:3},{time:10,open:12,high:20,low:10,close:18,volume:6}];
  for(const id of ids) for (const points of [[{x:10,y:10},{x:10,y:10},{x:10,y:10}],[{x:300,y:250},{x:80,y:40},{x:190,y:100}]]) {
    const drawing={id,tool:id,symbol:'BTC',points:[{time:0,price:10},{time:10,price:20},{time:20,price:15}]};
    const output=renderExtraDrawingGeometry({drawing,points,bounds:{width:800,height:500},color:'#123456',candles,project:p=>({x:p.time,y:500-p.price*10})});
    assert.ok(output); assert.doesNotMatch(output.body+output.hit,/NaN|Infinity|undefined/);
    const zeroCycle = ['time-cycles', 'sine-line'].includes(id) && points[0].x === points[1].x;
    if (zeroCycle) assert.equal(output.body + output.hit, '', 'a zero period has no phantom wave or hit target');
    else if(id!=='fib-speed-arcs') assert.ok(output.hit.includes('trading-drawing-hit-target'),id);
  }
});

test('table and image annotations escape input and reject executable URL schemes', () => {
  const drawing={id:'note',tool:'table',symbol:'BTC',points:[{time:1,price:10}],text:'<script> | test\nA | B'};
  const table=renderExtraAnnotation(drawing,{x:5,y:5},'#123456');
  assert.ok(table.includes('&lt;script&gt;')); assert.equal((table.match(/<rect /g)||[]).length,4);
  assert.ok(!renderExtraAnnotation({...drawing,tool:'image',text:'javascript:alert(1)'},{x:0,y:0},'#000').includes('<image'));
  assert.ok(renderExtraAnnotation({...drawing,tool:'image',text:'https://example.com/image.png'},{x:0,y:0},'#000').includes('<image'));
});

test('local image assets persist by a short drawing reference without sending image bytes through drawing sync', () => {
  const original=globalThis.localStorage, values=new Map();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)}});
  try {
    const data='data:image/png;base64,aGVsbG8=';
    const reference=storeDrawingImage(data);
    assert.ok(reference.startsWith('haolo-image:'));
    assert.ok(reference.length<240); assert.equal(drawingImageUrl(reference),data);
    assert.throws(()=>storeDrawingImage('data:image/svg+xml;base64,aGVsbG8='));
    assert.equal(drawingImageUrl('javascript:alert(1)'),'');
    assert.equal(drawingImageUrl('haolo-image:missing'),'');
  } finally { Object.defineProperty(globalThis,'localStorage',{configurable:true,value:original}); }
});
