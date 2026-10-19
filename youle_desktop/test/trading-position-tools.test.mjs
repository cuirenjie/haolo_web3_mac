import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePositionOptions, positionAnchors, movePositionAnchor, positionStatistics, renderPositionDrawing, forecastStatistics, renderForecastDrawing } from '../src/renderer/trading-position-tools.ts';
import { captureBarsPattern, patternPreviewPoint, nearestPatternBar, barsPatternValues, ghostFeedCandles, sectorEndpoint, sectorPath, renderPredictionShape } from '../src/renderer/trading-prediction-shapes.ts';
import { drawingToWire, drawingFromWire, DrawingReplica } from '../src/renderer/manual-drawing-sync.ts';
import { tradingDrawingRequiredPointCount, tradingDrawingToolDefinition } from '../src/renderer/trading-expert-drawing.ts';
import { englishDrawingText } from '../src/renderer/app-language-en-drawing.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} vs ${b}`);
const make=(tool,entry,target,stop)=>({id:'prediction-test',symbol:'binance:usdm:ETHUSDT',tool,points:[{time:100,price:entry},{time:300,price:entry},{time:100,price:target},{time:100,price:stop}]});
const bar=(time,low,high,close=(low+high)/2)=>({time,open:close,high,low,close});

test('initial position follows the chosen price span, including narrow price ranges',()=>{
  const p=positionAnchors({tool:'long-position',points:[{time:100,price:1300},{time:200,price:1320}]});
  assert.equal(p[2].price,1320);assert.equal(p[3].price,1280);
  assert.equal(englishDrawingText('已确定 3 / 5 段 · 点击添加下一段 · Enter 或双击完成 · 右键撤销上一端点'),'3 of 5 segments set · Click to add the next segment · Enter or double-click to finish · Right-click to undo the last point');
});

test('long reference screenshots: quantity, ratio, offsets, and account amounts use unrounded size',()=>{
  for(const [entry,target,stop,qty,ratio,amount] of [[2347.57,2529.57,2087.15,.96,.70,1174.72],[2371.71,2553.71,1946.80,.588,.43,1107.08],[2221.42,2700.71,1796.51,.588,1.13,1282]]){
    const s=positionStatistics(make('long-position',entry,target,stop),[]);
    assert.equal(Number(s.quantity.toFixed(3)),qty);assert.equal(Number(s.ratio.toFixed(2)),ratio);assert.equal(Number(s.targetAmount.toFixed(2)),amount);near(s.stopAmount,750);
  }
});
test('short reference screenshots mirror risk and account arithmetic',()=>{
  for(const [target,stop,qty,ratio,amount] of [[1990.73,2511.57,.96,1,1250],[1990.73,2555.58,.821,.86,1213.86],[1849.74,2659.59,.612,.98,1245.70]]){
    const s=positionStatistics(make('short-position',2251.15,target,stop),[]);
    assert.equal(Number(s.quantity.toFixed(3)),qty);assert.equal(Number(s.ratio.toFixed(2)),ratio);assert.equal(Number(s.targetAmount.toFixed(2)),amount);near(s.stopAmount,750);
  }
});
test('historical evaluation starts at entry and stops on the first reached boundary; future uses last price',()=>{
  const d=make('long-position',100,120,80);
  assert.equal(positionStatistics(d,[bar(110,60,70)]).closed,false);
  const loss=positionStatistics(d,[bar(110,75,105),bar(120,110,140)]);assert.equal(loss.closed,true);assert.equal(loss.pnl,-20);
  const profit=positionStatistics(d,[bar(110,95,121),bar(120,60,140)]);assert.equal(profit.pnl,20);
  const ambiguous=positionStatistics(d,[bar(110,70,130)]);assert.equal(ambiguous.ambiguous,true);assert.equal(ambiguous.pnl,-20);
  assert.equal(positionStatistics(d,[bar(50,90,100,97)]).pnl,-3);
  const noEntry=positionStatistics(make('short-position',2251.15,1990.73,2511.57),[bar(200,1870,1910,1888.91)]);near(noEntry.pnl,362.24);assert.equal(noEntry.closed,false);
});
test('all four position handles move time and corresponding price without skewing rectangles',()=>{
  for(const tool of ['long-position','short-position']){
    const d=make(tool,100,tool==='long-position'?120:80,tool==='long-position'?80:120);
    for(let i=0;i<4;i++){
      const p=movePositionAnchor(d,i,{time:i===1?350:125,price:d.points[i].price+2});
      assert.equal(p[0].price,p[1].price);assert.equal(p[0].time,p[2].time);assert.equal(p[0].time,p[3].time);
      assert.notEqual(p[i].time,d.points[i].time);assert.notEqual(p[i].price,d.points[i].price);
      assert.equal(positionAnchors({...d,points:p}).length,4);
    }
    const clamped=movePositionAnchor(d,2,{time:900,price:-100});assert.ok(clamped[0].time<clamped[1].time);assert.ok((tool==='long-position'?1:-1)*(clamped[2].price-clamped[0].price)>0);
  }
});
test('position settings respect leverage cap, lot/point values and finite validation',()=>{
  const d={...make('long-position',100,120,90),position:normalizePositionOptions({accountSize:1000,risk:10,leverage:1})};
  near(positionStatistics(d,[]).quantity,10);
  d.position.risk=100;near(positionStatistics(d,[]).quantity,10);near(positionStatistics(d,[]).stopAmount,900);
  assert.equal(normalizePositionOptions({tickSize:NaN,quantityPrecision:100}).tickSize,.01);assert.equal(normalizePositionOptions({quantityPrecision:100}).quantityPrecision,8);
});
test('selected position renders three tags, four shaped handles, and correct direction colors',()=>{
  const d=make('short-position',100,80,120),project=p=>({x:p.time,y:200-p.price});
  const out=renderPositionDrawing(d,project,[],{width:800,height:500},true,false);
  assert.equal((out.body.match(/data-prediction-tag=/g)||[]).length,3);assert.equal((out.handles.match(/data-position-handle=/g)||[]).length,4);
  assert.match(out.body,/data-position-region="stop"[^>]*y="80"/);assert.match(out.body,/data-position-region="target"[^>]*y="100"/);
  assert.doesNotMatch(out.body+out.hit+out.handles,/NaN|Infinity/);
  const idle=renderPositionDrawing(d,project,[],{width:800,height:500},false,false);assert.equal(idle.handles,'');assert.doesNotMatch(idle.body,/data-prediction-tag/);
});
test('forecast reproduces reference deltas, duration and pending/success/failure at target bar',()=>{
  const points=[{time:100,price:2418.24},{time:100+58*86400,price:2038.51}],s=forecastStatistics(points,[]);
  near(s.difference,-379.73);assert.equal(s.seconds/86400,58);assert.equal(s.status,'pending');
  assert.equal(forecastStatistics(points,[bar(points[1].time,2600,2800)]).status,'failure');
  assert.equal(forecastStatistics(points,[bar(points[1].time,2000,2050)]).status,'success');
  const out=renderForecastDrawing({id:'f',tool:'forecast',points},[{x:100,y:150},{x:500,y:400}],[],{width:900,height:600},true,false,28800);
  assert.match(out.body,/−379.73/);assert.match(out.body,/58天/);assert.match(out.body,/data-forecast-curve/);assert.doesNotMatch(out.body,/data-forecast-result/);
});
test('bars preview is clamped to historical candles and follows closes regardless of cursor y',()=>{
  const bars=[bar(100,90,110,100),bar(200,110,130,120),bar(300,95,115,105)],d={tool:'bars-pattern',points:[{time:100,price:150},{time:200,price:170}]};
  assert.equal(nearestPatternBar(bars,10000).time,300);assert.equal(nearestPatternBar(bars,-10000).time,100);
  assert.deepEqual(patternPreviewPoint(d,{time:10000,price:9000},bars),{time:300,price:155});
  const copied=captureBarsPattern({...d,points:[d.points[0],{time:300,price:155}]},bars);assert.equal(copied.barsPattern.bars.length,3);
  const values=barsPatternValues({...d,...copied});assert.deepEqual(values.map(b=>b.close),[150,170,155]);
  bars[1].close=999;assert.equal(barsPatternValues({...d,...copied})[1].close,170);
  const moved=barsPatternValues({...d,...copied,points:copied.points.map(p=>({time:p.time+1000,price:p.price+20}))});assert.deepEqual(moved.map(b=>b.close),[170,190,175]);
});
test('sector uses a short circular arc and the third handle stays on the radius',()=>{
  const a={x:337,y:555},b={x:668,y:683},c={x:674,y:442},end=sectorEndpoint(a,b,c);
  near(Math.hypot(end.x-a.x,end.y-a.y),Math.hypot(b.x-a.x,b.y-a.y));assert.match(sectorPath([a,b,c]),/ 0 0 0 /);
  assert.doesNotMatch(sectorPath([a,a,a]),/NaN|Infinity/);
});
test('ghost feed has at most five segments and stable, bounded OHLC through every anchor',()=>{
  assert.equal(tradingDrawingRequiredPointCount(tradingDrawingToolDefinition('ghost-feed')),6);
  const points=Array.from({length:8},(_,i)=>({time:100+i*100,price:100+Math.sin(i)*20})),a=ghostFeedCandles(points,10,'test');
  assert.deepEqual(a,ghostFeedCandles(points,10,'test'));assert.equal(a.length,50);assert.equal(a.at(-1).time,points[5].time);
  for(let i=1;i<=5;i++)near(a[i*10-1].close,points[i].price);
  assert.ok(a.every(b=>b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)));
  const draft=renderPredictionShape({id:'g',tool:'ghost-feed',points:points.slice(0,3)},p=>({x:p.time,y:p.price}),[],{width:1000,height:600},false,true,2);
  assert.equal((draft.handles.match(/data-position-handle/g)||[]).length,2);assert.match(draft.body,/data-ghost-guide/);
});
test('metadata survives local wire roundtrip without blocking compatible remote drawings',()=>{
  const d={...make('long-position',100,120,80),position:normalizePositionOptions({risk:10})},wire=drawingToWire(d);
  assert.deepEqual(drawingFromWire(wire,d.symbol),{...d,source:'manual',drawingScope:'main'});
  const replica=new DrawingReplica();replica.edit([],[wire,{...wire,id:'line',tool:'trend-line',points:wire.points.slice(0,2),position:undefined}]);
  assert.equal(replica.begin('binance:usdm:ETHUSDT','1h').operations.length,1);replica.acknowledge();assert.equal(replica.dirty,false);assert.ok(replica.pending[d.id]);
  replica.merge({schemaVersion:4,serverTime:Date.now(),entries:[]});assert.ok(replica.drawings().some(d=>d.position));
});
