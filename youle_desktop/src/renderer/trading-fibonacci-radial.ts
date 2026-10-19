import type { ScreenPoint, TradingDrawingModel } from './trading-expert-drawing.ts';
import { fibonacciOptionsForDrawing } from './trading-fibonacci.ts';
type Bounds = { width: number; height: number };
type Segment = [ScreenPoint, ScreenPoint];
type Clipper = (a: ScreenPoint, b: ScreenPoint, bounds: Bounds, mode: 'segment') => Segment | null;
export const isFibonacciRadial = (tool: string) => ['fib-circles','fib-spiral','fib-speed-arcs','fib-wedge'].includes(tool);
export function fibonacciWedgeEndpoint(a:ScreenPoint,b:ScreenPoint,c:ScreenPoint){
  const r=Math.hypot(b.x-a.x,b.y-a.y),length=Math.hypot(c.x-a.x,c.y-a.y);
  return length>1e-9?{x:a.x+(c.x-a.x)*r/length,y:a.y+(c.y-a.y)*r/length}:b;
}
/** Golden logarithmic spiral: radius grows by phi every quarter revolution.
 * B lies exactly on the curve and determines its orientation and scale. */
export function fibonacciSpiralGeometry(points: readonly ScreenPoint[], bounds: Bounds, counterclockwise = false) {
  const [a,b]=points;if(!a||!b)return [];
  const radius=Math.hypot(b.x-a.x,b.y-a.y);if(radius<1e-6)return [];
  const k=Math.log((1+Math.sqrt(5))/2)/(Math.PI/2),base=Math.atan2(b.y-a.y,b.x-a.x),direction=counterclockwise?-1:1;
  const reach=Math.max(radius,...[{x:0,y:0},{x:bounds.width,y:0},{x:0,y:bounds.height},{x:bounds.width,y:bounds.height}].map(p=>Math.hypot(p.x-a.x,p.y-a.y)))*1.05;
  const start=Math.log(Math.min(.3,radius)/radius)/k,end=Math.log(reach/radius)/k;
  const curve:ScreenPoint[]=[a];
  for(let t=start;t<end;){const r=radius*Math.exp(k*t),angle=base+direction*t;curve.push({x:a.x+r*Math.cos(angle),y:a.y+r*Math.sin(angle)});t+=Math.max(.001,Math.min(.04,3/Math.max(r,1)));}
  return curve;
}
export function fibonacciRadialGeometry(tool: string, points: readonly ScreenPoint[], fullCircles = false) {
  const [a,b] = points;
  if (!a || !b) return null;
  if(tool==='fib-wedge'){
    if(!points[2])return null;
    const r=Math.hypot(b.x-a.x,b.y-a.y),c=fibonacciWedgeEndpoint(a,b,points[2]),start=Math.atan2(b.y-a.y,b.x-a.x);
    const sweep=Math.atan2((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x),(b.x-a.x)*(c.x-a.x)+(b.y-a.y)*(c.y-a.y));
    return {center:a,rx:r,ry:r,start,sweep};
  }
  if(tool==='fib-speed-arcs'){
    const r=Math.hypot(b.x-a.x,b.y-a.y);
    return {center:a,rx:r,ry:r,start:0,sweep:fullCircles?Math.PI*2:b.y>=a.y?Math.PI:-Math.PI};
  }
  return { center: {x:(a.x+b.x)/2,y:(a.y+b.y)/2}, rx:Math.abs(b.x-a.x)/2, ry:Math.abs(b.y-a.y)/2, start:0, sweep:Math.PI*2 };
}
export function renderFibonacciRadial(drawing: TradingDrawingModel, points: readonly ScreenPoint[], bounds: Bounds, clipLine: Clipper) {
  const o=fibonacciOptionsForDrawing(drawing), geometry=fibonacciRadialGeometry(drawing.tool,points,o.fullCircles), segments: Segment[]=[];
  let body='',hit='';
  const dash=(style:string)=>style==='solid'?'':` stroke-dasharray="${style==='dashed'?'8 6':'2 4'}"`;
  const path=(p:ScreenPoint[])=>p.map((q,i)=>`${i?'L':'M'}${q.x},${q.y}`).join(' ');
  const addHit=(p:ScreenPoint[])=>{
    for(let i=1;i<p.length;i++){const s=clipLine(p[i-1],p[i],bounds,'segment');if(s)segments.push(s);}
    hit+=`<path class="trading-drawing-hit-target" d="${path(p)}" fill="none" stroke="transparent" stroke-width="12" pointer-events="stroke"/>`;
  };
  if(drawing.tool==='fib-spiral'){
    const curve=fibonacciSpiralGeometry(points,bounds,o.counterclockwise),color=drawing.color??o.trendColor;
    if(curve.length){body+=`<path data-fibonacci-spiral d="${path(curve)}" fill="none" stroke="${color}" stroke-width="${o.lineWidth}"${dash(o.lineStyle)}/>`;addHit(curve);}
    if(points.length>=2&&o.trendVisible){const [a,b]=points,length=Math.hypot(b.x-a.x,b.y-a.y);if(length>1e-6){
      const reach=4*Math.max(bounds.width,bounds.height,length)/length,s=clipLine(a,{x:a.x+(b.x-a.x)*reach,y:a.y+(b.y-a.y)*reach},bounds,'segment');
      if(s){body+=`<path data-spiral-radius d="${path(s)}" fill="none" stroke="${color}" stroke-width="${o.trendWidth}"${dash(o.trendStyle)}/>`;addHit(s);}
    }}
    return {body,hit,segments,geometry:{options:o,levels:[],connectors:[],radial:geometry}};
  }
  if(geometry && geometry.rx>1e-6 && geometry.ry>1e-6){
    const g=geometry, levels=o.levels.filter(l=>l.enabled&&l.value>0).sort((a,b)=>a.value-b.value);
    let previous:ScreenPoint[]=[];
    for(const l of levels){
      const count=Math.min(2048,Math.max(80,Math.ceil(Math.max(g.rx,g.ry)*l.value*Math.abs(g.sweep)/3)));
      const curve=Array.from({length:count+1},(_,i)=>{const angle=g.start+g.sweep*i/count;return {x:g.center.x+g.rx*l.value*Math.cos(angle),y:g.center.y+g.ry*l.value*Math.sin(angle)}});
      const close=drawing.tool==='fib-wedge'?` L${g.center.x},${g.center.y} Z`:' Z';
      if(o.fillVisible)body+=`<path class="trading-fibonacci-band" data-radial-band="${l.value}" d="${path(curve)}${close} ${previous.length?path(previous)+close:''}" fill-rule="evenodd" fill="${l.color}" fill-opacity="${o.fillOpacity}"/>`;
      body+=`<path data-fibonacci-level="${l.value}" data-fibonacci-curve d="${path(curve)}" fill="none" stroke="${l.color}" stroke-width="${o.lineWidth}"${dash(o.lineStyle)} vector-effect="non-scaling-stroke"/>`;addHit(curve);
      const wedge=drawing.tool==='fib-wedge',angle=g.start+g.sweep/2,labelRadius=Math.max(0,g.rx*l.value-12);
      if(o.showLevels)body+=`<text class="trading-fibonacci-label" x="${wedge?g.center.x+labelRadius*Math.cos(angle):g.center.x-8}" y="${wedge?g.center.y+labelRadius*Math.sin(angle):g.center.y+(g.sweep<0?-1:1)*g.ry*l.value}" text-anchor="${wedge?'middle':'end'}" dominant-baseline="central" fill="${l.color}">${l.value}</text>`;
      previous=curve;
    }
  }
  if(o.trendVisible && points.length>=2){
    const ends=drawing.tool==='fib-wedge'&&points[2]?[points[1],fibonacciWedgeEndpoint(points[0],points[1],points[2])]:[points[1]];
    for(const end of ends){const s=clipLine(points[0],end,bounds,'segment');
    if(s){body+=`<path class="trading-fibonacci-connector" d="${path(s)}" fill="none" stroke="${o.trendColor}" stroke-width="${o.trendWidth}"${dash(o.trendStyle)}/>`;addHit(s);}}
  }
  return {body,hit,segments,geometry:{options:o,levels:[],connectors:[],radial:geometry}};
}
