import type { TradingDrawingModel, TradingDrawingPoint, ScreenPoint } from './trading-expert-drawing.ts';
import type { DrawingCandle } from './trading-drawing-extra-tools.ts';
import { predictionLineDash } from './trading-position-tools.ts';

export const isPredictionShape = (tool: string) => ['bars-pattern','ghost-feed','sector'].includes(tool);
export interface BarsPatternSnapshot { bars: DrawingCandle[] }
export function normalizeBarsSnapshot(value?: BarsPatternSnapshot) {
  if (!Array.isArray(value?.bars)) return undefined;
  const bars = value.bars.filter(b=>[b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)).slice(0,4000)
    .map(({time,open,high,low,close})=>({time,open,high,low,close}));
  return bars.length ? { bars } : undefined;
}
export function nearestPatternBar(candles: readonly DrawingCandle[], time: number) {
  if (!candles.length) return null;
  let lo=0,hi=candles.length-1;
  while(lo<hi){const m=Math.floor((lo+hi)/2);if(candles[m].time<time)lo=m+1;else hi=m;}
  if(lo>0&&Math.abs(candles[lo-1].time-time)<Math.abs(candles[lo].time-time))lo--;
  return candles[lo];
}
export function captureBarsPattern(drawing: TradingDrawingModel, candles: readonly DrawingCandle[]) {
  const [a,b=a]=drawing.points, first=nearestPatternBar(candles,a.time),last=nearestPatternBar(candles,b.time);
  if(!first||!last)return null;
  const bars=candles.filter(c=>c.time>=Math.min(first.time,last.time)&&c.time<=Math.max(first.time,last.time)).slice(0,4000)
    .map(({time,open,high,low,close})=>({time,open,high,low,close}));
  if(bars.length<2)return null;
  // Preserve the clicked vertical offset; the slope always follows closes.
  const offset=a.price-first.close;
  return {barsPattern:{bars},points:[{time:bars[0].time,price:bars[0].close+offset},{time:bars.at(-1)!.time,price:bars.at(-1)!.close+offset}]};
}
export function patternPreviewPoint(drawing: TradingDrawingModel, point: TradingDrawingPoint, candles: readonly DrawingCandle[]) {
  const first=nearestPatternBar(candles,drawing.points[0].time),bar=nearestPatternBar(candles,point.time);
  return first&&bar?{time:bar.time,price:bar.close+drawing.points[0].price-first.close}:point;
}
export function barsPatternValues(drawing: TradingDrawingModel): DrawingCandle[] {
  const bars=drawing.barsPattern?.bars??[],[a,b=a]=drawing.points;
  if(!bars.length||!a)return [];
  const first=bars[0],last=bars.at(-1)!,delta=last.close-first.close;
  const scale=Math.abs(delta)>1e-10?(b.price-a.price)/delta:1;
  return bars.map((bar,i)=>{
    const u=bars.length===1?0:i/(bars.length-1), time=a.time+(b.time-a.time)*u;
    const map=(p:number)=>a.price+(p-first.close)*scale+(Math.abs(delta)<=1e-10?(b.price-a.price)*u:0);
    const high=map(bar.high),low=map(bar.low);
    return {time,open:map(bar.open),close:map(bar.close),high:Math.max(high,low),low:Math.min(high,low)};
  });
}
export function sectorEndpoint(center: ScreenPoint, radiusPoint: ScreenPoint, cursor: ScreenPoint): ScreenPoint {
  const radius=Math.hypot(radiusPoint.x-center.x,radiusPoint.y-center.y),angle=Math.atan2(cursor.y-center.y,cursor.x-center.x);
  return {x:center.x+Math.cos(angle)*radius,y:center.y+Math.sin(angle)*radius};
}
export function sectorPath(points: ScreenPoint[]) {
  const [a,b=a,c]=points;
  if(!a)return '';
  if(!c)return `M${a.x},${a.y} L${b.x},${b.y}`;
  const end=sectorEndpoint(a,b,c),r=Math.hypot(b.x-a.x,b.y-a.y);
  const turn=((Math.atan2(end.y-a.y,end.x-a.x)-Math.atan2(b.y-a.y,b.x-a.x)+Math.PI*3)%(Math.PI*2))-Math.PI;
  return `M${a.x},${a.y} L${b.x},${b.y} A${r},${r} 0 0 ${turn>=0?1:0} ${end.x},${end.y} Z`;
}

export function ghostFeedCandles(points: readonly TradingDrawingPoint[], interval: number, seed: string): DrawingCandle[] {
  let hash=2166136261;for(const c of seed)hash=Math.imul(hash^c.charCodeAt(0),16777619);
  const random=()=>{hash^=hash<<13;hash^=hash>>>17;hash^=hash<<5;return(hash>>>0)/4294967296;};
  const result:DrawingCandle[]=[];
  for(let j=1;j<Math.min(points.length,6);j++){
    const a=points[j-1],b=points[j],count=Math.min(400,Math.max(1,Math.round(Math.abs(b.time-a.time)/Math.max(interval,1))));
    const amplitude=Math.max(Math.abs(b.price-a.price)*.14,Math.abs(a.price)*.004);
    let previous=a.price;
    for(let i=1;i<=count;i++){
      const u=i/count,base=a.price+(b.price-a.price)*u;
      const close=i===count?b.price:base+(random()-.5)*amplitude*2;
      const wick=amplitude*(.12+random()*.45);
      result.push({time:a.time+(b.time-a.time)*u,open:previous,close,high:Math.max(previous,close)+wick,low:Math.min(previous,close)-wick});previous=close;
    }
  }
  return result;
}

export function renderPredictionShape(drawing: TradingDrawingModel, project: (p:TradingDrawingPoint)=>ScreenPoint|null, candles: readonly DrawingCandle[], bounds:{width:number;height:number}, selected:boolean,draft:boolean,confirmed:number) {
  const points=drawing.points.map(project).filter((p):p is ScreenPoint=>!!p),[a,b=a]=points;
  if(!a)return {body:'',hit:'',handles:''};
  let body='',hit='';
  const line=(p:ScreenPoint,q:ScreenPoint,attrs='')=>`<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" ${attrs}/>`;
  if(drawing.tool==='sector'){
    const path=sectorPath(points),color=drawing.color??'#999999',fill=drawing.textBackgroundColor??'#9c6ade33';
    body=`<path data-sector-shape d="${path}" fill="${points.length<3?'none':fill}" stroke="${color}" stroke-width="${drawing.lineWidth??2}"${predictionLineDash(drawing.lineStyle)}/>`;
    hit=`<path class="trading-drawing-hit-target${points.length>=3?' closed':''}" d="${path}" fill="transparent"/>`;
    if(points[2])points[2]=sectorEndpoint(a,b,points[2]);
  }else if(drawing.tool==='bars-pattern'&&draft){
    body=[a,b].map(p=>line({x:p.x,y:0},{x:p.x,y:bounds.height},'data-bars-boundary stroke="#888" stroke-width="1"')).join('')+line(a,b,'data-bars-slope stroke="#888" stroke-width="1"');
  }else{
    const ghost=drawing.tool==='ghost-feed',interval=candles.length>1?candles.at(-1)!.time-candles.at(-2)!.time:60;
    const bars=ghost?ghostFeedCandles(drawing.points.slice(0,draft?confirmed:6),interval,drawing.id):barsPatternValues(drawing);
    for(let i=0;i<bars.length;i++){
      const bar=bars[i],p=project({time:bar.time,price:bar.open}),q=project({time:bar.time,price:bar.close}),high=project({time:bar.time,price:bar.high}),low=project({time:bar.time,price:bar.low});
      if(!p||!q||!high||!low||p.x < -20 || p.x > bounds.width+20)continue;
      const next=project({time:bars[i+1]?.time??bar.time+interval,price:bar.close}),width=Math.max(1,Math.min(12,Math.abs((next?.x??p.x+6)-p.x)*.65));
      const color=ghost?(bar.close>=bar.open?'#26a69a':'#f23645'):drawing.color??'#2962ff';
      if(ghost)body+=`<g data-ghost-candle>`+line(high,low,'stroke="#969696" stroke-opacity=".55" stroke-width=".7"')+`<rect x="${p.x-width/2}" y="${Math.min(p.y,q.y)}" width="${width}" height="${Math.max(1,Math.abs(p.y-q.y))}" fill="${color}" fill-opacity=".18" stroke="${color}" stroke-opacity=".5" stroke-width=".6"/></g>`;
      else body+=`<path data-bars-stick d="M${high.x},${high.y} V${low.y} M${p.x-width/2},${p.y} H${p.x} M${q.x},${q.y} H${q.x+width/2}" stroke="${color}" stroke-width="${drawing.lineWidth??2}" fill="none"/>`;
      hit+=line(high,low,'class="trading-drawing-hit-target"');
    }
    if(ghost&&(selected||draft)){
      const path=`M${points.map(p=>`${p.x},${p.y}`).join(' L')}`;
      body+=`<path data-ghost-guide d="${path}" stroke="#999" stroke-width="1" fill="none"/>`;hit+=`<path class="trading-drawing-hit-target" d="${path}" fill="none"/>`;
    }
  }
  const handles=(selected||draft)&&!(draft&&drawing.tool==='bars-pattern')?points.filter((_,i)=>!draft||i<confirmed).map((p,i)=>`<circle class="trading-drawing-handle" data-position-handle="${i}" data-drawing-handle-index="${i}" cx="${p.x}" cy="${p.y}" r="6" fill="var(--trading-market-panel)" style="stroke:#2962ff;cursor:move" stroke-width="1.5"/>`).join(''):'';
  return {body,hit,handles};
}
