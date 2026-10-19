import type { ScreenPoint, TradingDrawingModel } from './trading-expert-drawing.ts';
import { fibonacciOptionsForDrawing } from './trading-fibonacci.ts';
type Bounds={width:number;height:number};
type Segment=[ScreenPoint,ScreenPoint];
type Clipper=(a:ScreenPoint,b:ScreenPoint,bounds:Bounds,mode:'segment')=>Segment|null;
export const isGannProjection=(tool:string)=>['gann-box','gann-square-fixed','gann-square','gann-fan'].includes(tool);
export function gannSquareGeometry(points:readonly ScreenPoint[],fixed=true){
  const [a,b]=points;if(!a||!b)return null;
  const unit=Math.hypot(b.x-a.x,b.y-a.y);
  return {origin:a,width:fixed?5*unit*(b.x<a.x?-1:1):b.x-a.x,height:fixed?5*unit*(b.y<a.y?-1:1):b.y-a.y,unit};
}
export function gannBoxGeometry(points:readonly ScreenPoint[],drawing:TradingDrawingModel){
  const [a,b]=points;if(!a||!b)return [];
  return fibonacciOptionsForDrawing(drawing).levels.filter(l=>l.enabled).sort((a,b)=>a.value-b.value).map(l=>({...l,x:a.x+(b.x-a.x)*l.value,y:a.y+(b.y-a.y)*l.value}));
}
export function renderGannProjection(drawing:TradingDrawingModel,points:readonly ScreenPoint[],bounds:Bounds,clipLine:Clipper,barSpan=0){
  if(drawing.tool==='gann-fan')return renderGannFan(drawing,points,bounds,clipLine);
  if(drawing.tool.startsWith('gann-square'))return renderGannSquare(drawing,points,bounds,clipLine,barSpan);
  const o=fibonacciOptionsForDrawing(drawing),segments:Segment[]=[];let body='',hit='';
  const [a,b]=points,levels=gannBoxGeometry(points,drawing);
  const line=(from:ScreenPoint,to:ScreenPoint,color:string,part:string)=>{const s=clipLine(from,to,bounds,'segment');if(!s)return;segments.push(s);
    const attrs=`x1="${s[0].x}" y1="${s[0].y}" x2="${s[1].x}" y2="${s[1].y}"`;
    body+=`<line data-gann-line="${part}" ${attrs} stroke="${color}" stroke-width="${o.lineWidth}"${o.lineStyle==='solid'?'':` stroke-dasharray="${o.lineStyle==='dashed'?'8 6':'2 4'}"`}/>`;
    hit+=`<line class="trading-drawing-hit-target" ${attrs} stroke="transparent" stroke-width="12" pointer-events="stroke"/>`;
  };
  const rect=(x1:number,y1:number,x2:number,y2:number,color:string)=>{
    const x=Math.max(0,Math.min(x1,x2)),y=Math.max(0,Math.min(y1,y2)),right=Math.min(bounds.width,Math.max(x1,x2)),bottom=Math.min(bounds.height,Math.max(y1,y2));
    if(right>x&&bottom>y)body+=`<rect class="trading-fibonacci-band" data-gann-band x="${x}" y="${y}" width="${right-x}" height="${bottom-y}" fill="${color}" fill-opacity="${o.fillOpacity}"/>`;
  };
  const label=(v:string,p:ScreenPoint,color:string,anchor='middle')=>{if(p.x>=0&&p.y>=0&&p.x<=bounds.width&&p.y<=bounds.height)body+=`<text class="trading-fibonacci-label" x="${p.x}" y="${p.y}" fill="${color}" text-anchor="${anchor}" dominant-baseline="central">${v}</text>`;};
  if(a&&b){
    if(o.fillVisible)for(let i=1;i<levels.length;i++){
      const prev=levels[i-1],l=levels[i];rect(prev.x,a.y,l.x,b.y,l.color);rect(a.x,prev.y,b.x,l.y,l.color);
    }
    for(const l of levels){
      line({x:l.x,y:a.y},{x:l.x,y:b.y},l.color,`time-${l.value}`);line({x:a.x,y:l.y},{x:b.x,y:l.y},l.color,`price-${l.value}`);
      if(o.showLevels){label(String(l.value),{x:l.x,y:Math.min(a.y,b.y)-14},l.color);label(String(l.value),{x:l.x,y:Math.max(a.y,b.y)+14},l.color);
        label(String(l.value),{x:Math.min(a.x,b.x)-9,y:l.y},l.color,'end');label(String(l.value),{x:Math.max(a.x,b.x)+9,y:l.y},l.color,'start');}
    }
  }
  return {body,hit,segments,geometry:{options:o,levels:[],connectors:[],grid:levels}};
}

export function gannFanGeometry(points:readonly ScreenPoint[],drawing:TradingDrawingModel){
  const [a,b]=points;if(!a||!b)return [];
  const dx=b.x-a.x,dy=b.y-a.y;if(Math.abs(dx)<1e-6||Math.abs(dy)<1e-6)return [];
  return fibonacciOptionsForDrawing(drawing).levels.filter(l=>l.enabled&&l.value>0).sort((a,b)=>b.value-a.value).map(l=>({...l,from:a,
    to:l.value>=1?{x:b.x,y:a.y+dy/l.value}:{x:a.x+dx*l.value,y:b.y},
    label:l.value>=1?`${l.value}/1`:`1/${Number((1/l.value).toFixed(6))}`}));
}
function renderGannFan(drawing:TradingDrawingModel,points:readonly ScreenPoint[],bounds:Bounds,clipLine:Clipper){
  const o=fibonacciOptionsForDrawing(drawing),rays=gannFanGeometry(points,drawing),segments:Segment[]=[];let body='',hit='';
  const a=points[0];if(!a)return {body,hit,segments,geometry:{options:o,levels:[],connectors:[]}};
  const reach=4*Math.max(1,...[{x:0,y:0},{x:bounds.width,y:0},{x:bounds.width,y:bounds.height},{x:0,y:bounds.height}].map(p=>Math.hypot(p.x-a.x,p.y-a.y)));
  const far=(p:ScreenPoint)=>{const scale=reach/Math.max(1e-9,Math.hypot(p.x-a.x,p.y-a.y));return {x:a.x+(p.x-a.x)*scale,y:a.y+(p.y-a.y)*scale}};
  if(o.fillVisible)for(let i=0;i<rays.length-1;i++){
    const p=far(rays[i].to),q=far(rays[i+1].to),color=rays[i].value>=1?rays[i].color:rays[i+1].color;
    body+=`<path class="trading-fibonacci-band" data-gann-fan-band="${i}" d="M${a.x},${a.y} L${p.x},${p.y} L${q.x},${q.y} Z" fill="${color}" fill-opacity="${o.fillOpacity}"/>`;
  }
  for(const ray of rays){const s=clipLine(a,far(ray.to),bounds,'segment');if(!s)continue;segments.push(s);
    const attrs=`x1="${s[0].x}" y1="${s[0].y}" x2="${s[1].x}" y2="${s[1].y}"`;
    body+=`<line data-gann-fan-ray="${ray.label}" ${attrs} stroke="${ray.color}" stroke-width="${o.lineWidth}"${o.lineStyle==='solid'?'':` stroke-dasharray="${o.lineStyle==='dashed'?'8 6':'2 4'}"`}/>`;
    hit+=`<line class="trading-drawing-hit-target" ${attrs} stroke="transparent" stroke-width="12" pointer-events="stroke"/>`;
    if(o.showLevels&&ray.to.x>=0&&ray.to.x<=bounds.width&&ray.to.y>=0&&ray.to.y<=bounds.height)body+=`<text class="trading-fibonacci-label" x="${ray.to.x+7}" y="${ray.to.y-3}" fill="${ray.color}" dominant-baseline="central">${ray.label}</text>`;
  }
  return {body,hit,segments,geometry:{options:o,levels:[],connectors:[],rays}};
}

function renderGannSquare(drawing:TradingDrawingModel,points:readonly ScreenPoint[],bounds:Bounds,clipLine:Clipper,barSpan=0){
  const fixed=drawing.tool==='gann-square-fixed';
  const o=fibonacciOptionsForDrawing(drawing),square=gannSquareGeometry(points,fixed),segments:Segment[]=[];
  let body='',hit='';
  if(!square||square.unit<1e-6)return {body,hit,segments,geometry:{options:o,levels:[],connectors:[]}};
  const {origin:a,width:w,height:h}=square;
  const project=(x:number,y:number)=>({x:a.x+w*x/5,y:a.y+h*y/5});
  const left=Math.min(a.x,a.x+w),top=Math.min(a.y,a.y+h),width=Math.abs(w),height=Math.abs(h);
  const id='gann-square-'+drawing.id.replace(/[^a-zA-Z0-9_-]/g,'');
  body+=`<defs><clipPath id="${id}"><rect x="${left}" y="${top}" width="${width}" height="${height}"/></clipPath></defs><g clip-path="url(#${id})">`;
  const path=(p:ScreenPoint[])=>p.map((q,i)=>`${i?'L':'M'}${q.x},${q.y}`).join(' ');
  const dash=o.lineStyle==='solid'?'':` stroke-dasharray="${o.lineStyle==='dashed'?'8 6':'2 4'}"`;
  const add=(p:ScreenPoint[],color:string,part:string)=>{
    body+=`<path data-gann-square="${part}" d="${path(p)}" fill="none" stroke="${color}" stroke-width="${o.lineWidth}"${dash}/>`;
    for(let i=1;i<p.length;i++){
      const segment=clipLine({x:p[i-1].x-left,y:p[i-1].y-top},{x:p[i].x-left,y:p[i].y-top},{width,height},'segment');
      if(!segment)continue;const clipped=clipLine({x:segment[0].x+left,y:segment[0].y+top},{x:segment[1].x+left,y:segment[1].y+top},bounds,'segment');if(clipped)segments.push(clipped);
    }
    hit+=`<path class="trading-drawing-hit-target" d="${path(p)}" fill="none" stroke="transparent" stroke-width="12" pointer-events="stroke" clip-path="url(#${id})"/>`;
  };
  const levels=o.levels.filter(l=>l.enabled&&l.value>0&&l.value<=5).sort((a,b)=>a.value-b.value);
  const curve=(r:number)=>Array.from({length:181},(_,i)=>project(r*Math.cos(i*Math.PI/360),r*Math.sin(i*Math.PI/360)));
  let previous:ScreenPoint[]=[];
  if(o.fillVisible)for(const l of levels){const p=curve(l.value),close=` L${a.x},${a.y} Z`;
    body+=`<path class="trading-fibonacci-band" data-gann-square-band="${l.value}" d="${path(p)}${close} ${previous.length?path(previous)+close:''}" fill="${l.color}" fill-opacity="${o.fillOpacity}" fill-rule="evenodd"/>`;previous=p;
  }
  for(const l of levels){
    if(l.value<5){add([project(l.value,0),project(l.value,5)],l.color,'vertical-'+l.value);add([project(0,l.value),project(5,l.value)],l.color,'horizontal-'+l.value);}
    if(o.gannArcsVisible){add(curve(l.value),l.color,'arc-'+l.value);add(curve(Math.hypot(l.value,1)),l.color,'arc-diagonal-'+l.value);if(l.value===1)add(curve(1.5),l.color,'arc-1.5');}
  }
  if(o.gannFanVisible)for(const [slope,color] of [[.5,'#00bcd4'],[1,'#4caf50'],[2,'#089981']] as const){
    add([a,project(slope<=1?5:5/slope,slope<=1?5*slope:5)],drawing.color??color,'fan-'+slope);
  }
  if(o.trendVisible&&o.levels[0]?.enabled)add([project(0,0),project(5,0),project(5,5),project(0,5),project(0,0)],o.levels[0].color,'border');body+='</g>';
  if(!fixed&&o.showLevels){
    const bars=Math.round(Math.abs(barSpan)),delta=drawing.points[1].price-drawing.points[0].price;
    const labels=[{x:left+width+12,y:top-14,text:String(bars),anchor:'start'},
      {x:left-12,y:top+height+20,text:delta.toFixed(2),anchor:'end'},
      {x:left+width+12,y:top+height+20,text:bars>0?(Math.abs(delta)/bars).toFixed(7):'—',anchor:'start'}];
    for(const l of labels)body+=`<text class="trading-fibonacci-label" data-gann-measurement x="${l.x}" y="${l.y}" fill="${o.trendColor}" text-anchor="${l.anchor}" dominant-baseline="central">${l.text}</text>`;
  }
  return {body,hit,segments,geometry:{options:o,levels:[],connectors:[],square}};
}
