import { isGannProjection, renderGannProjection } from './trading-gann-projections.ts';
import { isFibonacciRadial, renderFibonacciRadial } from './trading-fibonacci-radial.ts';
import type { ScreenPoint, TradingDrawingModel, TradingDrawingLineStyle } from './trading-expert-drawing.ts';
import { fibonacciOptionsForDrawing } from './trading-fibonacci.ts';

export const isThreePointFibonacci = (tool: string) => ['fib-trend-extension','fib-channel','fib-trend-time','fib-wedge','pitchfan'].includes(tool);
export const isFibonacciProjection = (tool: string) => isGannProjection(tool) || isFibonacciRadial(tool) || isThreePointFibonacci(tool) || tool === 'fib-time-zone' || tool === 'fib-speed-fan';
type Bounds = { width: number; height: number };
type Segment = [ScreenPoint, ScreenPoint];
type Clipper = (a: ScreenPoint, b: ScreenPoint, bounds: Bounds, mode: 'segment') => Segment | null;
type Level = { value: number; color: string; from: ScreenPoint; to: ScreenPoint; price: number | null };
const finite = (p: ScreenPoint) => Number.isFinite(p.x) && Number.isFinite(p.y);
const along = (a: ScreenPoint, b: ScreenPoint, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Price extensions use price differences; channels interpolate in the chart's
 * price scale. Projecting each extension price separately also works on log axes. */
export function fibonacciProjectionGeometry(drawing: TradingDrawingModel, points: readonly ScreenPoint[], bounds: Bounds,
  priceToY: (price: number) => number | null, yToPrice: (y: number) => number | null) {
  const options = fibonacciOptionsForDrawing(drawing), levels: Level[] = [], connectors: Segment[] = [];
  const [a, b, c] = points;
  if (!a || !b || points.some(p => !finite(p))) return { options, levels, connectors };
  const enabled = options.levels.filter(l => l.enabled).sort((a, b) => a.value - b.value);
  if (drawing.tool === 'fib-trend-time') {
    if (options.trendVisible) { connectors.push([a, b]); if (c) connectors.push([b, c]); }
    if (c) for (const level of enabled) {
      const x = c.x + (b.x - a.x) * level.value;
      levels.push({ ...level, from: { x, y: 0 }, to: { x, y: bounds.height }, price: null });
    }
  } else if (drawing.tool === 'fib-time-zone') {
    const step = b.x - a.x;
    // Coincident anchors show one line. Never invent a minimum pixel interval.
    for (const level of enabled.filter(l => Math.abs(step) > 1e-7 || l.value === 0)) {
      const x = a.x + step * level.value;
      levels.push({ ...level, color: Math.abs(step) <= 1e-7 && !drawing.color ? '#2962ff' : level.color,
        from: { x, y: 0 }, to: { x, y: bounds.height }, price: null });
    }
    if (options.trendVisible && Math.hypot(b.x - a.x, b.y - a.y) > 1e-7) connectors.push([a, b]);
  } else if (drawing.tool === 'fib-trend-extension') {
    if (options.trendVisible) { connectors.push([a, b]); if (c) connectors.push([b, c]); }
    if (c && drawing.points.length >= 3) {
      const left = options.extendLeft ? 0 : Math.min(b.x, c.x);
      const right = options.extendRight ? bounds.width : Math.max(b.x, c.x);
      const delta = drawing.points[1].price - drawing.points[0].price;
      for (const level of enabled) {
        const price = drawing.points[2].price + delta * level.value, y = priceToY(price);
        if (y !== null && Number.isFinite(y) && Number.isFinite(price)) levels.push({ ...level, price, from: { x: left, y }, to: { x: right, y } });
      }
    }
  } else if (drawing.tool === 'fib-channel') {
    if (!c) {
      // Only the solid AB baseline is visible while choosing point two.
      connectors.push([a, b]);
    } else {
      const dx = b.x - a.x, dy = b.y - a.y;
      const offset = { x: c.x - a.x, y: c.y - a.y };
      const collapsed = Math.abs(dx * offset.y - dy * offset.x) < 1e-7;
      for (const level of enabled.filter(l => !collapsed || l.value === 0)) {
        const from = { x: a.x + offset.x * level.value, y: a.y + offset.y * level.value };
        const to = { x: b.x + offset.x * level.value, y: b.y + offset.y * level.value };
        levels.push({ ...level, from, to, price: yToPrice(from.y) });
      }
      // Use the same parameter range for every level, preserving parallel band
      // edges even when the whole baseline is outside the visible plot.
      const length2 = dx * dx + dy * dy;
      if (length2 > 1e-12 && (options.extendLeft || options.extendRight)) {
        const corners = [{ x: 0, y: 0 }, { x: bounds.width, y: 0 }, { x: bounds.width, y: bounds.height }, { x: 0, y: bounds.height }];
        const ts = levels.flatMap(l => corners.map(p => ((p.x - l.from.x) * dx + (p.y - l.from.y) * dy) / length2));
        const forward = dx >= 0;
        const low = (forward ? options.extendLeft : options.extendRight) ? Math.min(0, ...ts) - 1 : 0;
        const high = (forward ? options.extendRight : options.extendLeft) ? Math.max(1, ...ts) + 1 : 1;
        for (const l of levels) { const start = l.from, end = l.to; l.from = along(start, end, low); l.to = along(start, end, high); }
      }
    }
  }
  return { options, levels, connectors };
}

function clipBand(polygon: ScreenPoint[], bounds: Bounds) {
  for (const [axis, edge, greater] of [['x', 0, true], ['x', bounds.width, false], ['y', 0, true], ['y', bounds.height, false]] as const) {
    const clipped: ScreenPoint[] = [];
    const inside = (p: ScreenPoint) => greater ? p[axis] >= edge : p[axis] <= edge;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      if (inside(a)) clipped.push(a);
      if (inside(a) !== inside(b)) clipped.push(along(a, b, (edge - a[axis]) / (b[axis] - a[axis])));
    }
    polygon = clipped;
  }
  return polygon;
}

export function renderFibonacciProjection(drawing: TradingDrawingModel, points: readonly ScreenPoint[], bounds: Bounds,
  priceToY: (price: number) => number | null, yToPrice: (y: number) => number | null,
  formatPrice: (price: number) => string, clipLine: Clipper, barSpan = 0) {
  if (isGannProjection(drawing.tool)) return renderGannProjection(drawing, points, bounds, clipLine, barSpan);
  if (isFibonacciRadial(drawing.tool)) return renderFibonacciRadial(drawing, points, bounds, clipLine);
  if (drawing.tool === 'pitchfan') return renderPitchfan(drawing, points, bounds, clipLine);
  if (drawing.tool === 'fib-speed-fan') return renderFibonacciFan(drawing, points, bounds, clipLine);
  const geometry = fibonacciProjectionGeometry(drawing, points, bounds, priceToY, yToPrice);
  const { options: o, levels, connectors } = geometry;
  const channel = drawing.tool === 'fib-channel', timeZone = drawing.tool === 'fib-time-zone' || drawing.tool === 'fib-trend-time';
  let body = '', hit = '';
  const segments: Segment[] = [];
  const attrs = ([a, b]: Segment) => `x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"`;
  const stroke = (width: number, style: TradingDrawingLineStyle) => `stroke-width="${width}" vector-effect="non-scaling-stroke"${style === 'solid' ? '' : ` stroke-dasharray="${style === 'dashed' ? '8 6' : '2 4'}"`}`;
  const addHit = (segment: Segment) => {
    segments.push(segment);
    hit += `<line class="trading-drawing-hit-target" ${attrs(segment)} stroke="transparent" stroke-width="12" fill="none" pointer-events="stroke"/>`;
  };
  if (o.fillVisible) for (let i = 0; i + 1 < levels.length; i++) {
    const a = levels[i], b = levels[i + 1];
    const polygon = clipBand([a.from, a.to, b.to, b.from], bounds);
    const area = Math.abs(polygon.reduce((sum, p, i) => { const q = polygon[(i + 1) % polygon.length]; return sum + p.x * q.y - q.x * p.y; }, 0));
    if (polygon.length < 3 || area < 1e-7) continue;
    // The reference channel bands inherit the lower ratio; extensions the higher.
    const colorLevel = channel || drawing.tool === 'fib-time-zone' ? a : b;
    body += `<polygon class="trading-fibonacci-band" data-fibonacci-band="${colorLevel.value}" points="${polygon.map(p => `${p.x},${p.y}`).join(' ')}" fill="${colorLevel.color}" fill-opacity="${o.fillOpacity}"/>`;
  }
  for (const connector of connectors) {
    const segment = clipLine(...connector, bounds, 'segment');
    if (!segment) continue;
    body += `<line class="trading-fibonacci-connector" ${attrs(segment)} stroke="${o.trendColor}" ${stroke(channel ? o.lineWidth : o.trendWidth, channel ? o.lineStyle : o.trendStyle)}/>`;
    addHit(segment);
  }
  for (const level of levels) {
    const segment = clipLine(level.from, level.to, bounds, 'segment');
    if (!segment) continue;
    body += `<g class="trading-fibonacci-level" data-fibonacci-level="${level.value}"><line class="trading-fibonacci-level-line" ${attrs(segment)} stroke="${level.color}" ${stroke(o.lineWidth, o.lineStyle)}/>`;
    const labelPoint = segment[0].x <= segment[1].x ? segment[0] : segment[1];
    const inside = !timeZone && (o.extendLeft || labelPoint.x < 140);
    const price = channel ? yToPrice(labelPoint.y) : level.price;
    const label = `${o.showLevels ? level.value : ''}${!timeZone && o.showPrices && price !== null && Number.isFinite(price) ? `${o.showLevels ? ' ' : ''}(${formatPrice(price)})` : ''}`;
    if (label) body += `<text class="trading-fibonacci-label" x="${labelPoint.x + (timeZone || inside ? 8 : -8)}" y="${timeZone ? bounds.height - 8 : labelPoint.y}" text-anchor="${timeZone || inside ? 'start' : 'end'}" dominant-baseline="central" fill="${level.color}">${label}</text>`;
    body += '</g>';
    addHit(segment);
  }
  return { body, hit, segments, geometry };
}

export function pitchfanGeometry(points:readonly ScreenPoint[], options:ReturnType<typeof fibonacciOptionsForDrawing>){
  const [a,b,c]=points;if(!a||!b)return [];
  if(!c||Math.hypot(c.x-b.x,c.y-b.y)<1e-6)return [{from:a,to:b,value:.5,color:options.trendColor}];
  return options.levels.filter(l=>l.enabled).sort((a,b)=>a.value-b.value).map(l=>({...l,from:a,to:along(b,c,l.value)}));
}
function renderPitchfan(drawing:TradingDrawingModel,points:readonly ScreenPoint[],bounds:Bounds,clipLine:Clipper){
  const o=fibonacciOptionsForDrawing(drawing),rays=pitchfanGeometry(points,o),segments:Segment[]=[];
  let body='',hit='';const a=points[0];
  const reach=a?4*Math.max(1,...[{x:0,y:0},{x:bounds.width,y:0},{x:bounds.width,y:bounds.height},{x:0,y:bounds.height}].map(p=>Math.hypot(p.x-a.x,p.y-a.y))):1;
  const far=(p:ScreenPoint)=>along(a,p,reach/Math.max(1e-9,Math.hypot(p.x-a.x,p.y-a.y)));
  const add=(from:ScreenPoint,to:ScreenPoint,color:string,part:string,width=o.lineWidth,style=o.lineStyle)=>{const s=clipLine(from,to,bounds,'segment');if(!s)return;segments.push(s);
    const attrs=`x1="${s[0].x}" y1="${s[0].y}" x2="${s[1].x}" y2="${s[1].y}"`;
    body+=`<line data-pitchfan-line="${part}" ${attrs} stroke="${color}" stroke-width="${width}"${style==='solid'?'':` stroke-dasharray="${style==='dashed'?'8 6':'2 4'}"`}/>`;
    hit+=`<line class="trading-drawing-hit-target" ${attrs} stroke="transparent" stroke-width="12" pointer-events="stroke"/>`;
  };
  if(o.fillVisible&&rays.length>1)for(let i=0;i<rays.length-1;i++){
    const polygon=clipBand([a,far(rays[i].to),far(rays[i+1].to)],bounds),color=rays[i].value<.5?rays[i].color:rays[i+1].color;
    if(polygon.length>=3)body+=`<polygon class="trading-fibonacci-band" data-pitchfan-band="${i}" points="${polygon.map(p=>`${p.x},${p.y}`).join(' ')}" fill="${color}" fill-opacity="${o.fillOpacity}"/>`;
  }
  for(const ray of rays)if(Math.hypot(ray.to.x-a.x,ray.to.y-a.y)>1e-6)add(a,far(ray.to),ray.color,String(ray.value));
  if(points[2]&&o.trendVisible)add(points[1],points[2],o.trendColor,'crossbar',o.trendWidth,o.trendStyle);
  return {body,hit,segments,geometry:{options:o,levels:[],connectors:[],rays}};
}

/** Two ray families: A -> (Bx, Ay + (1-r)dy) and
 * A -> (Ax + (1-r)dx, By). The shared r=0 diagonal is drawn once. */
export function fibonacciFanGeometry(points: readonly ScreenPoint[], options: ReturnType<typeof fibonacciOptionsForDrawing>) {
  const [a, b] = points;
  const rays: { family: 'price' | 'time'; value: number; color: string; from: ScreenPoint; to: ScreenPoint }[] = [];
  if (!a || !b || !finite(a) || !finite(b) || Math.abs(b.x - a.x) < 1e-7 || Math.abs(b.y - a.y) < 1e-7) return rays;
  for (const level of options.levels.filter(l => l.enabled).sort((a, b) => b.value - a.value)) {
    rays.push({ ...level, family: 'price', from: a, to: { x: b.x, y: a.y + (1 - level.value) * (b.y - a.y) } });
    rays.push({ ...level, family: 'time', from: a, to: { x: a.x + (1 - level.value) * (b.x - a.x), y: b.y } });
  }
  return rays;
}

function renderFibonacciFan(drawing: TradingDrawingModel, points: readonly ScreenPoint[], bounds: Bounds, clipLine: Clipper) {
  const o = fibonacciOptionsForDrawing(drawing), rays = fibonacciFanGeometry(points, o);
  const [a, b] = points, segments: Segment[] = [];
  let body = '', hit = '';
  const attrs = ([p, q]: Segment) => `x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}"`;
  const addLine = (from: ScreenPoint, to: ScreenPoint, color: string, width: number, extra: string, interactive = true, style = o.lineStyle) => {
    const segment = clipLine(from, to, bounds, 'segment'); if (!segment) return;
    const dash = style === 'solid' ? '' : ` stroke-dasharray="${style === 'dashed' ? '8 6' : '2 4'}"`;
    body += `<line ${extra} ${attrs(segment)} stroke="${color}" stroke-width="${width}"${dash} vector-effect="non-scaling-stroke"/>`;
    if (interactive) { segments.push(segment); hit += `<line class="trading-drawing-hit-target" ${attrs(segment)} stroke="transparent" stroke-width="12" pointer-events="stroke"/>`; }
  };
  const label = (text: number, p: ScreenPoint, anchor: string) => {
    if (!o.showLevels || p.x < 0 || p.x > bounds.width || p.y < 0 || p.y > bounds.height) return '';
    const color = o.levels.find(l => l.value === text)?.color ?? '#808080';
    return `<text class="trading-fibonacci-label" x="${p.x}" y="${p.y}" text-anchor="${anchor}" dominant-baseline="central" fill="${color}">${text}</text>`;
  };
  if (a && b && finite(a) && finite(b)) {
    const corners = [{ x: 0, y: 0 }, { x: bounds.width, y: 0 }, { x: bounds.width, y: bounds.height }, { x: 0, y: bounds.height }];
    // A common radius enclosing the viewport makes the connecting far edge of
    // each wedge lie outside the chart, including offscreen origins.
    const reach = 4 * Math.max(1, ...corners.map(p => Math.hypot(p.x - a.x, p.y - a.y)));
    const far = (to: ScreenPoint) => { const length = Math.hypot(to.x - a.x, to.y - a.y); return along(a, to, reach / length); };
    if (o.fillVisible) for (const family of ['price', 'time']) {
      const group = rays.filter(r => r.family === family);
      for (let i = 0; i + 1 < group.length; i++) {
        const polygon = clipBand([a, far(group[i].to), far(group[i + 1].to)], bounds);
        if (polygon.length >= 3) body += `<polygon class="trading-fibonacci-band" data-fibonacci-fan-band="${family}-${group[i].value}" points="${polygon.map(p => `${p.x},${p.y}`).join(' ')}" fill="${group[i].color}" fill-opacity="${o.fillOpacity}"/>`;
      }
    }
    // Grid and four label sides use the actual two-anchor rectangle.
    for (const ray of rays) {
      const q = ray.to;
      if (o.trendVisible) addLine(ray.family === 'price' ? { x: a.x, y: q.y } : { x: q.x, y: a.y }, q, o.trendColor, o.trendWidth, 'data-fibonacci-fan-grid', false, o.trendStyle);
    }
    for (const ray of rays) {
      if (!(ray.family === 'time' && ray.value === 0)) addLine(a, far(ray.to), ray.color, o.lineWidth, `data-fibonacci-fan-ray="${ray.family}" data-fibonacci-level="${ray.value}"`);
    }
    for (const ray of rays) {
      if (ray.family === 'price') {
        body += label(ray.value, { x: Math.min(a.x, b.x) - 9, y: ray.to.y }, 'end');
        if (ray.value !== 1) body += label(ray.value, { x: Math.max(a.x, b.x) + 9, y: ray.to.y }, 'start');
      } else {
        body += label(ray.value, { x: ray.to.x, y: Math.min(a.y, b.y) - 16 }, 'middle');
        if (ray.value !== 1) body += label(ray.value, { x: ray.to.x, y: Math.max(a.y, b.y) + 16 }, 'middle');
      }
    }
    if (!rays.length) addLine(a, b, o.trendColor, o.lineWidth, 'class="trading-fibonacci-connector"');
  }
  return { body, hit, segments, geometry: { options: o, levels: [], connectors: [], rays } };
}
