import test from 'node:test';
import assert from 'node:assert/strict';
import {fibonacciProjectionGeometry,fibonacciFanGeometry} from '../src/renderer/trading-fibonacci-projections.ts';
import {fibonacciOptionsForDrawing} from '../src/renderer/trading-fibonacci.ts';
const bounds={width:1000,height:800},close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('extension: third anchor origin, signed AB price difference, BC time span',()=>{
 const d={tool:'fib-trend-extension',points:[{price:2573.25},{price:2356.09},{price:2312}]};
 const p=[{x:150,y:100},{x:650,y:250},{x:300,y:300}],g=fibonacciProjectionGeometry(d,p,bounds,p=>3000-p,y=>3000-y);
 close(g.levels.find(l=>l.value===0).price,2312);close(g.levels.find(l=>l.value===1).price,2094.84);
 close(g.levels.find(l=>l.value===1.618).price,1960.63512);assert.equal(g.connectors.length,2);
 for(const l of g.levels){assert.equal(l.from.x,300);assert.equal(l.to.x,650)}
 const first=fibonacciProjectionGeometry({...d,points:d.points.slice(0,2)},p.slice(0,2),bounds,p=>p,y=>y);assert.equal(first.levels.length,0);assert.equal(first.connectors.length,1);
});

test('channel: translates both time and price, keeps parallel AB segments and log prices',()=>{
 const d={tool:'fib-channel',points:[{price:2585.43},{price:2395.37},{price:2193.23}]},p=[{x:302,y:402},{x:741,y:549},{x:521,y:716}];
 const yToPrice=y=>2585.43*Math.pow(2193.23/2585.43,(y-402)/314),g=fibonacciProjectionGeometry(d,p,bounds,p=>p,yToPrice);
 for(const l of g.levels){close(l.to.x-l.from.x,439);close(l.to.y-l.from.y,147);close(l.from.x,302+219*l.value)}
 const one=g.levels.find(l=>l.value===1);assert.deepEqual(one.from,p[2]);close(one.price,2193.23);
 close(g.levels.find(l=>l.value===.236).price,2585.43*Math.pow(2193.23/2585.43,.236));
 const draft=fibonacciProjectionGeometry(d,p.slice(0,2),bounds,p=>p,y=>y);assert.equal(draft.levels.length,0);assert.equal(draft.connectors.length,1);
});

test('time zone: Fibonacci bar intervals, zero-width and reversed direction',()=>{
 const d={tool:'fib-time-zone',points:[{},{}]},p=[{x:100,y:10},{x:120,y:200}];
 const g=fibonacciProjectionGeometry(d,p,bounds,p=>p,y=>y);assert.deepEqual(g.levels.map(l=>l.value),[0,1,2,3,5,8,13,21,34,55,89]);
 assert.deepEqual(g.levels.map(l=>l.from.x),[100,120,140,160,200,260,360,520,780,1200,1880]);
 const reverse=fibonacciProjectionGeometry(d,[p[1],p[0]],bounds,p=>p,y=>y);assert.equal(reverse.levels.at(-1).from.x,120-20*89);
 const zero=fibonacciProjectionGeometry(d,[p[0],p[0]],bounds,p=>p,y=>y);assert.equal(zero.levels.length,1);assert.equal(zero.levels[0].color,'#2962ff');
});

test('speed fan: both time and price rays share origin, with rectangle ratios reversed',()=>{
 const d={tool:'fib-speed-fan'},p=[{x:340,y:420},{x:950,y:869}],r=fibonacciFanGeometry(p,fibonacciOptionsForDrawing(d));assert.equal(r.length,14);
 for(const l of r){assert.deepEqual(l.from,p[0]);if(l.family==='price'){close(l.to.x,950);close(l.to.y,420+(1-l.value)*449)}else {close(l.to.x,340+(1-l.value)*610);close(l.to.y,869)}}
 assert.equal(fibonacciFanGeometry([p[0],p[0]],fibonacciOptionsForDrawing(d)).length,0);
});

test('trend time: measures AB duration and projects from C independent of prices',()=>{
 const d={tool:'fib-trend-time',points:[{}, {}, {}]},p=[{x:235,y:440},{x:798,y:695},{x:492,y:786}];
 const g=fibonacciProjectionGeometry(d,p,bounds,p=>p,y=>y);assert.equal(g.connectors.length,2);for(const l of g.levels)close(l.from.x,492+563*l.value);
 assert.equal(g.levels[0].value,0);assert.equal(g.levels[1].value,.382);assert.equal(g.levels[2].value,.618);
 assert.deepEqual(fibonacciProjectionGeometry(d,[...p.slice(0,2),{x:492,y:1}],bounds,p=>p,y=>y).levels,g.levels);
});

import {fibonacciRadialGeometry} from '../src/renderer/trading-fibonacci-radial.ts';
test('circles: bounding anchors define midpoint and independently scaled radii',()=>{
 const g=fibonacciRadialGeometry('fib-circles',[{x:330,y:430},{x:474,y:583}]);assert.deepEqual(g.center,{x:402,y:506.5});close(g.rx,72);close(g.ry,76.5);close(g.sweep,2*Math.PI);
 assert.deepEqual(fibonacciRadialGeometry('fib-circles',[{x:474,y:583},{x:330,y:430}]),g);
});

import {fibonacciSpiralGeometry} from '../src/renderer/trading-fibonacci-radial.ts';
test('spiral: golden growth, finite curve, reversed winding and collapsed baseline',()=>{
 const p=[{x:311,y:247},{x:650,y:330}],curve=fibonacciSpiralGeometry(p,bounds);assert.ok(curve.length>100);assert.ok(curve.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
 const reversed=fibonacciSpiralGeometry(p,bounds,true);close(Math.hypot(curve[40].x-311,curve[40].y-247),Math.hypot(reversed[40].x-311,reversed[40].y-247));assert.notDeepEqual(curve[40],reversed[40]);assert.deepEqual(fibonacciSpiralGeometry([p[0],p[0]],bounds),[]);
});

test('speed arcs: first anchor is center, AB distance radius, semicircle follows vertical direction',()=>{
 const p=[{x:549,y:552},{x:549,y:677}],g=fibonacciRadialGeometry('fib-speed-arcs',p);assert.deepEqual(g.center,p[0]);close(g.rx,125);close(g.ry,125);close(g.sweep,Math.PI);
 close(fibonacciRadialGeometry('fib-speed-arcs',[p[0],{x:549,y:427}]).sweep,-Math.PI);close(fibonacciRadialGeometry('fib-speed-arcs',p,true).sweep,2*Math.PI);
});

import {fibonacciWedgeEndpoint} from '../src/renderer/trading-fibonacci-radial.ts';
test('wedge: C controls angle at fixed AB radius, both edges meet outer arc',()=>{
 const p=[{x:340,y:590},{x:692,y:722},{x:503,y:930}],g=fibonacciRadialGeometry('fib-wedge',p),c=fibonacciWedgeEndpoint(...p);
 close(Math.hypot(c.x-340,c.y-590),g.rx);close(340+g.rx*Math.cos(g.start),692);close(590+g.ry*Math.sin(g.start),722);
 close(340+g.rx*Math.cos(g.start+g.sweep),c.x);close(590+g.ry*Math.sin(g.start+g.sweep),c.y);
 assert.equal(fibonacciRadialGeometry('fib-wedge',p.slice(0,2)),null);
});

import {pitchfanGeometry} from '../src/renderer/trading-fibonacci-projections.ts';
test('pitchfan: five rays through BC quartiles, no parallel fork substitution',()=>{
 const p=[{x:368,y:531},{x:655,y:648},{x:483,y:829}],o=fibonacciOptionsForDrawing({tool:'pitchfan'}),g=pitchfanGeometry(p,o);assert.equal(g.length,5);
 assert.deepEqual(g.map(l=>l.color),['#2962ff','#00bcd4','#f23645','#00bcd4','#2962ff']);
 for(const l of g){assert.deepEqual(l.from,p[0]);close(l.to.x,655+(483-655)*l.value);close(l.to.y,648+(829-648)*l.value)}
 assert.equal(pitchfanGeometry(p.slice(0,2),o).length,1);assert.equal(pitchfanGeometry([p[0],p[1],p[1]],o).length,1);
});

import {gannBoxGeometry} from '../src/renderer/trading-gann-projections.ts';
test('Gann box: independent time and price axes use the seven reference ratios',()=>{
 const g=gannBoxGeometry([{x:330,y:405},{x:911,y:894}],{tool:'gann-box'});assert.deepEqual(g.map(l=>l.value),[0,.25,.382,.5,.618,.75,1]);
 for(const l of g){close(l.x,330+581*l.value);close(l.y,405+489*l.value)}assert.deepEqual(g.map(l=>l.color),['#808080','#ff9800','#00bcd4','#4caf50','#089981','#2962ff','#808080']);
});

import {gannSquareGeometry} from '../src/renderer/trading-gann-projections.ts';
test('fixed Gann square: AB distance is one unit, outer square spans five units',()=>{
 const g=gannSquareGeometry([{x:349,y:500},{x:444,y:570}]);close(g.unit,Math.hypot(95,70));close(g.width,5*Math.hypot(95,70));close(g.height,g.width);
 const reversed=gannSquareGeometry([{x:0,y:0},{x:-3,y:-4}]);assert.equal(reversed.width,-25);assert.equal(reversed.height,-25);
});

test('Gann square: free time and price spans preserve rectangular aspect',()=>{
 const g=gannSquareGeometry([{x:302,y:383},{x:998,y:834}],false);assert.equal(g.width,696);assert.equal(g.height,451);assert.deepEqual(g.origin,{x:302,y:383});
});

import {gannFanGeometry} from '../src/renderer/trading-gann-projections.ts';
test('Gann fan: nine rays calibrated from AB, labels use price/time ratios',()=>{
 const p=[{x:378,y:259},{x:864,y:966}],g=gannFanGeometry(p,{tool:'gann-fan'});assert.equal(g.length,9);assert.deepEqual(g.map(l=>l.label),['8/1','4/1','3/1','2/1','1/1','1/2','1/3','1/4','1/8']);
 for(const l of g)close((l.to.y-l.from.y)/(l.to.x-l.from.x),707/486/l.value);assert.deepEqual(g.find(l=>l.value===1).to,p[1]);
 assert.deepEqual(gannFanGeometry([p[0],p[0]],{tool:'gann-fan'}),[]);
});

import {renderFibonacciProjection,isThreePointFibonacci} from '../src/renderer/trading-fibonacci-projections.ts';
import {clipTradingDrawingLine} from '../src/renderer/trading-expert-drawing.ts';
import {drawingToWire,drawingFromWire} from '../src/renderer/manual-drawing-sync.ts';
import {englishDrawingText} from '../src/renderer/app-language-en-drawing.mjs';
test('projection settings and placement messages have complete English translations',()=>{
 for(const label of ['网格','半径线','边界线','连接线','边框','扇线','弧线','范围和比率',
   '趋势幅度已确定 · 移动鼠标选择第三点作为 0 位，点击完成 · 右键撤销上一端点',
   '基准线已确定 · 移动鼠标选择 1 倍通道起点，点击完成 · 右键撤销上一端点',
   '趋势时间已确定 · 移动鼠标选择时间投射起点，点击完成 · 右键撤销上一端点']){
   assert.ok(englishDrawingText(label),label);assert.doesNotMatch(englishDrawingText(label),/\p{Script=Han}/u);
 }
});
const tools=['fib-trend-extension','fib-channel','fib-time-zone','fib-speed-fan','fib-trend-time','fib-circles','fib-spiral','fib-speed-arcs','fib-wedge','pitchfan','gann-box','gann-square-fixed','gann-square','gann-fan'];
test('speed fan grid has independent color, width and style',()=>{
 const p=[{x:100,y:100},{x:400,y:300}],d={id:'grid',tool:'fib-speed-fan',points:p.map(q=>({price:3000-q.y})),fibonacci:{trendColor:'#123456',trendWidth:3,trendStyle:'dotted'}};
 const r=renderFibonacciProjection(d,p,bounds,p=>3000-p,y=>3000-y,String,clipTradingDrawingLine);
 assert.match(r.body,/data-fibonacci-fan-grid[^>]*stroke="#123456" stroke-width="3" stroke-dasharray="2 4"/);
});
test('spiral radius has independent width and style',()=>{
 const p=[{x:100,y:100},{x:400,y:300}],d={id:'spiral',tool:'fib-spiral',points:p.map(q=>({price:3000-q.y})),fibonacci:{trendWidth:3,trendStyle:'dotted'}};
 const r=renderFibonacciProjection(d,p,bounds,p=>3000-p,y=>3000-y,String,clipTradingDrawingLine);
 assert.match(r.body,/data-spiral-radius[^>]*stroke-width="3" stroke-dasharray="2 4"/);
 assert.match(r.body,/data-fibonacci-spiral[^>]*stroke-width="2"/);
});
test('wedge boundaries honor custom line style',()=>{
 const p=[{x:100,y:100},{x:400,y:300},{x:250,y:400}],d={id:'wedge',tool:'fib-wedge',points:p.map(q=>({price:3000-q.y})),fibonacci:{trendColor:'#123456',trendWidth:3,trendStyle:'dotted'}};
 const r=renderFibonacciProjection(d,p,bounds,p=>3000-p,y=>3000-y,String,clipTradingDrawingLine);
 assert.equal((r.body.match(/trading-fibonacci-connector[^>]*stroke="#123456" stroke-width="3" stroke-dasharray="2 4"/g)||[]).length,2);
});
test('pitchfan crossbar has independent color, width and style',()=>{
 const p=[{x:100,y:100},{x:400,y:300},{x:250,y:400}],d={id:'pitchfan',tool:'pitchfan',points:p.map(q=>({price:3000-q.y})),fibonacci:{trendColor:'#123456',trendWidth:3,trendStyle:'dotted'}};
 const r=renderFibonacciProjection(d,p,bounds,p=>3000-p,y=>3000-y,String,clipTradingDrawingLine);
 assert.match(r.body,/data-pitchfan-line="crossbar"[^>]*stroke="#123456" stroke-width="3" stroke-dasharray="2 4"/);
});
for(const tool of tools)test(`${tool}: reversed/offscreen/collapsed geometry clips finite eraser targets and preserves settings`,()=>{
  const cases=[
    [{x:200,y:150},{x:600,y:350},{x:350,y:500}],
    [{x:750,y:600},{x:250,y:200},{x:650,y:100}],
    [{x:-250,y:-150},{x:400,y:250},{x:100,y:500}],
    [{x:350,y:300},{x:350,y:300},{x:350,y:300}],
  ];
  for(const points of cases){
    const p=points.slice(0,isThreePointFibonacci(tool)?3:2);
    const drawing={id:'qa-'+tool,tool,symbol:'binance:usdm:ETHUSDT',points:p.map(q=>({time:1800000000+q.x*3600,price:3000-q.y}))};
    const r=renderFibonacciProjection(drawing,p,bounds,p=>3000-p,y=>3000-y,p=>p.toFixed(2),clipTradingDrawingLine,100);
    assert.doesNotMatch(r.body+r.hit,/NaN|Infinity|undefined/);
    for(const segment of r.segments)for(const q of segment){
      assert.ok(q.x>=-.001&&q.x<=bounds.width+.001,`${tool}: clipped x ${q.x}`);
      assert.ok(q.y>=-.001&&q.y<=bounds.height+.001,`${tool}: clipped y ${q.y}`);
    }
    drawing.fibonacci={...fibonacciOptionsForDrawing(drawing),counterclockwise:true,fullCircles:true,gannFanVisible:false,gannArcsVisible:false};
    const restored=drawingFromWire(drawingToWire(drawing),drawing.symbol);
    assert.deepEqual(fibonacciOptionsForDrawing(restored),drawing.fibonacci);
    assert.equal(restored.points.length,p.length);
  }
});
