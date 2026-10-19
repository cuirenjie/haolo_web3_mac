import type { ScreenPoint, TradingDrawingModel, TradingDrawingPoint } from './trading-expert-drawing.ts';
import { manualDrawingDefaults } from './trading-drawing-defaults.ts';

export const isCycleDrawing = (tool: string) => ['cyclic-lines', 'time-cycles', 'sine-line'].includes(tool);
export const TIME_CYCLES_FILL = '#6aa84f80';
export const cycleFillColor = (drawing: TradingDrawingModel) =>
  /^#[\da-f]{6}([\da-f]{2})?$/i.test(drawing.textBackgroundColor ?? '') ? drawing.textBackgroundColor! : TIME_CYCLES_FILL;

// Old clients stored an unused second price for time cycles. Project, edit and
// persist both handles on the actual baseline, without moving their times.
export function cycleAnchorPoints(tool: string, points: readonly TradingDrawingPoint[]) {
  return points.map((point, i) => tool === 'time-cycles' && i === 1
    ? { ...point, price: points[0].price } : { ...point });
}

export function moveCycleAnchor(tool: string, points: readonly TradingDrawingPoint[], index: number, point: TradingDrawingPoint) {
  if (!points[index] || point.time === points[1 - index]?.time) return cycleAnchorPoints(tool, points);
  return points.map((original, i) => ({ ...(i === index ? point : original),
    ...(tool === 'time-cycles' ? { price: point.price } : {}) }));
}

// Work from the first VISIBLE cycle rather than iterating from an offscreen
// anchor. Subpixel cycles may skip whole periods, preserving the original phase.
export function visibleCyclePositions(a: number, b: number, width: number, bothDirections: boolean, includePartial = false) {
  const period = Math.abs(b - a), origin = bothDirections ? a : Math.min(a, b);
  if (![a, b, width, period].every(Number.isFinite) || period < 1e-6 || width <= 0) return [];
  let first = includePartial ? Math.floor(-origin / period) : Math.ceil(-origin / period);
  if (!bothDirections) first = Math.max(0, first);
  const last = Math.floor((width - origin) / period);
  const stride = Math.max(1, Math.ceil((last - first + 1) / 8192));
  const positions: number[] = [];
  for (let i = first; i <= last; i += stride) positions.push(origin + i * period);
  return positions;
}

export function sineValueAt(a: ScreenPoint, b: ScreenPoint, x: number) {
  const halfPeriod = Math.abs(b.x - a.x);
  return halfPeriod < 1e-6 ? a.y : (a.y + b.y) / 2 + (a.y - b.y) / 2 * Math.cos((x - a.x) * Math.PI / halfPeriod);
}

export function sineWavePoints(a: ScreenPoint, b: ScreenPoint, width: number) {
  const halfPeriod = Math.abs(b.x - a.x);
  if (![a.x, a.y, b.x, b.y, width].every(Number.isFinite) || halfPeriod < 1e-6 || width <= 0) return [];
  // Sample by phase as well as pixel distance; a fixed 2px step aliases narrow
  // waves. Include every visible extremum so handles sit exactly on the curve.
  const count = Math.min(16384, Math.max(1, Math.ceil(width / Math.min(2, halfPeriod / 32))));
  const xs = Array.from({ length: count + 1 }, (_, i) => width * i / count);
  xs.push(...visibleCyclePositions(a.x, b.x, width, true));
  return [...new Set(xs)].sort((x, y) => x - y).map(x => ({ x, y: sineValueAt(a, b, x) }));
}

export function cycleHitDistance(tool: string, points: ScreenPoint[], pointer: ScreenPoint, width: number) {
  const [a, b] = points;
  if (!a || !b || !isCycleDrawing(tool)) return Infinity;
  const period = Math.abs(b.x - a.x);
  if (period < 1e-6) return Infinity;
  if (tool === 'cyclic-lines') {
    const origin = Math.min(a.x, b.x), n = Math.max(0, Math.round((pointer.x - origin) / period));
    return Math.abs(pointer.x - origin - n * period);
  }
  if (tool === 'time-cycles') {
    const start = a.x + Math.floor((pointer.x - a.x) / period) * period;
    if (pointer.y > a.y) return Math.min(Math.hypot(pointer.x - start, pointer.y - a.y), Math.hypot(pointer.x - start - period, pointer.y - a.y));
    return Math.abs(Math.hypot(pointer.x - start - period / 2, pointer.y - a.y) - period / 2);
  }
  const wave = sineWavePoints(a, b, width);
  let distance = Infinity;
  for (let i = 1; i < wave.length; i++) {
    const p = wave[i - 1], q = wave[i], dx = q.x - p.x, dy = q.y - p.y;
    const t = Math.max(0, Math.min(1, ((pointer.x - p.x) * dx + (pointer.y - p.y) * dy) / (dx * dx + dy * dy || 1)));
    distance = Math.min(distance, Math.hypot(pointer.x - p.x - t * dx, pointer.y - p.y - t * dy));
  }
  return distance;
}

export function renderCycleDrawing(drawing: TradingDrawingModel, points: ScreenPoint[], bounds: { width: number; height: number }, editing = false) {
  const [a, b = a] = points;
  if (!a || !isCycleDrawing(drawing.tool)) return null;
  const defaults = manualDrawingDefaults(drawing.tool), color = drawing.color ?? defaults.color;
  const dash = drawing.lineStyle === 'dashed' ? '7 5' : drawing.lineStyle === 'dotted' ? '2 4' : '';
  const stroke = `fill="none" stroke="${color}" stroke-width="${drawing.lineWidth ?? defaults.lineWidth}" stroke-dasharray="${dash}" vector-effect="non-scaling-stroke"`;
  let body = '', hit = '';
  if (drawing.tool === 'cyclic-lines') {
    const positions = visibleCyclePositions(a.x, b.x, bounds.width, false);
    if (!positions.length && Math.abs(b.x - a.x) < 1e-6 && a.x >= 0 && a.x <= bounds.width) positions.push(a.x);
    for (const x of positions) {
      const coordinates = `x1="${x}" y1="0" x2="${x}" y2="${bounds.height}"`;
      body += `<line data-cycle-line ${coordinates} ${stroke}/>`;
      hit += `<line class="trading-drawing-hit-target" ${coordinates}/>`;
    }
    if (editing) {
      const coordinates = `x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"`;
      body += `<line data-cycle-guide ${coordinates} fill="none" stroke="#787b86" stroke-width="1" stroke-dasharray="4 4"/>`;
      hit += `<line class="trading-drawing-hit-target" ${coordinates}/>`;
    }
  } else if (drawing.tool === 'time-cycles') {
    const period = Math.abs(b.x - a.x), radius = period / 2;
    for (const x of visibleCyclePositions(a.x, b.x, bounds.width, true, true)) {
      const d = `M${x},${a.y} A${radius},${radius} 0 0 1 ${x + period},${a.y}`;
      // Close only the fill. Stroking Z would add an unwanted horizontal line.
      body += `<path data-cycle-fill d="${d} Z" fill="${cycleFillColor(drawing)}" stroke="none" pointer-events="none"/>`
        + `<path data-cycle-arc d="${d}" ${stroke}/>`;
      hit += `<path class="trading-drawing-hit-target" d="${d}"/>`;
    }
  } else {
    const wave = sineWavePoints(a, b, bounds.width);
    if (wave.length) {
      const d = 'M' + wave.map(p => `${p.x},${p.y}`).join(' L');
      body = `<path data-cycle-sine d="${d}" ${stroke} stroke-linejoin="round"/>`;
      hit = `<path class="trading-drawing-hit-target" d="${d}"/>`;
    }
  }
  return { body, hit };
}
