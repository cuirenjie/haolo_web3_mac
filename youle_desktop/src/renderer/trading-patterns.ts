import type { ScreenPoint, TradingDrawingModel } from './trading-expert-drawing.ts';
import { manualDrawingDefaults } from './trading-drawing-defaults.ts';

export type HarmonicDrawingTool = 'xabcd' | 'cypher' | 'abcd' | 'three-drives';
export const HARMONIC_BLUE = '#2962ff';
export function isHarmonicDrawing(tool: string): tool is HarmonicDrawingTool {
  return tool === 'xabcd' || tool === 'cypher' || tool === 'abcd' || tool === 'three-drives';
}
export function isReferencePatternDrawing(tool: string) {
  return isHarmonicDrawing(tool) || tool === 'head-shoulders' || tool === 'triangle-pattern';
}

// Ratios use price differences, never screen distance (including on log charts).
// XABCD: XB = AB/XA, AC = BC/AB, BD = CD/BC, XD = AD/XA.
// Cypher measures its extended C against XA: AC = XC/XA, XD = CD/XC.
export function harmonicDrawingRatios(tool: HarmonicDrawingTool, prices: readonly number[]) {
  const [x, a, b, c, d] = prices;
  const ratio = (numerator: number, denominator: number): number | null => {
    const value = Math.abs(numerator / denominator);
    return denominator !== 0 && Number.isFinite(value) ? value : null;
  };
  if (tool === 'abcd') return [
    { chord: 'AC', from: 0, to: 2, value: ratio(b - a, a - x) },
    { chord: 'BD', from: 1, to: 3, value: ratio(c - b, b - a) },
  ].filter(item => item.to < prices.length);
  if (tool === 'three-drives') return [
    { chord: '24', from: 1, to: 3, value: ratio(prices[3] - prices[2], prices[2] - prices[1]) },
    { chord: '46', from: 3, to: 5, value: ratio(prices[5] - prices[4], prices[4] - prices[3]) },
  ].filter(item => item.to < prices.length);
  return [
    { chord: 'XB', from: 0, to: 2, value: ratio(b - a, a - x) },
    { chord: 'AC', from: 1, to: 3, value: tool === 'cypher' ? ratio(c - x, a - x) : ratio(c - b, b - a) },
    { chord: 'BD', from: 2, to: 4, value: ratio(d - c, c - b) },
    { chord: 'XD', from: 0, to: 4, value: tool === 'cypher' ? ratio(d - c, c - x) : ratio(d - a, a - x) },
  ].filter(item => item.to < prices.length);
}

export function formatHarmonicRatio(value: number | null, precision = 3) {
  return value === null ? '—' : String(Number(value.toFixed(precision)));
}

export function harmonicFillColor(drawing: Pick<TradingDrawingModel, 'tool' | 'color' | 'textBackgroundColor'>) {
  // Reuse the persisted background color/alpha field, including zero alpha.
  return drawing.textBackgroundColor ?? `${(drawing.color ?? manualDrawingDefaults(drawing.tool).color).slice(0, 7)}26`;
}

// Shared visual primitives. AI supplies its own anchors, labels and measurements;
// using these must never recalculate a pattern or rename its points.
export function harmonicPatternPolygons(points: readonly ScreenPoint[]) {
  return [[0, 1, 2], [2, 3, 4]]
    .filter(indices => indices.every(i => i < points.length))
    .map(indices => indices.map(i => points[i]));
}

export function renderPatternLegs(drawing: TradingDrawingModel, points: readonly ScreenPoint[]) {
  const color = drawing.color ?? manualDrawingDefaults(drawing.tool).color;
  const dash = drawing.lineStyle === 'dashed' ? '8 5' : drawing.lineStyle === 'dotted' ? '2 4' : '';
  return points.length > 1 ? `<polyline data-harmonic-legs points="${points.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${drawing.lineWidth ?? 2}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` : '';
}

export function patternBadgeGeometry(text: string, center: ScreenPoint, fontSize: number) {
  const textWidth = Array.from(text).reduce((sum, char) => sum + (/[^\u0000-\u00ff]/.test(char) ? 1 : .59), 0) * fontSize;
  const width = Math.max(fontSize + 4, textWidth + 10), height = fontSize + 8;
  return { x: center.x - width / 2, y: center.y - height / 2, width, height };
}

export function renderPatternBadge(drawing: TradingDrawingModel, text: string, center: ScreenPoint, attribute: string) {
  const fontSize = drawing.fontSize ?? 14;
  const color = drawing.color ?? manualDrawingDefaults(drawing.tool).color;
  const box = patternBadgeGeometry(text, center, fontSize);
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return { box, body: `<g ${attribute} data-i18n-skip><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="4" fill="${color}" stroke="none"/><text x="${center.x}" y="${center.y}" text-anchor="middle" dominant-baseline="central" fill="${drawing.textColor ?? '#ffffff'}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="${drawing.bold ? 700 : 500}"${drawing.italic ? ' font-style="italic"' : ''}>${escaped}</text></g>` };
}

export function trianglePatternGeometry(points: readonly ScreenPoint[], width: number) {
  const [a, b, c, d] = points;
  if (!d || Math.abs(c.x - a.x) < 1e-7 || Math.abs(d.x - b.x) < 1e-7) return null;
  const upperSlope = (c.y - a.y) / (c.x - a.x), lowerSlope = (d.y - b.y) / (d.x - b.x);
  const upperAt = (x: number) => ({ x, y: a.y + (x - a.x) * upperSlope });
  const lowerAt = (x: number) => ({ x, y: b.y + (x - b.x) * lowerSlope });
  const direction = Math.sign(d.x - a.x) || 1;
  let endX = direction > 0 ? width : 0;
  if (Math.abs(upperSlope - lowerSlope) > 1e-7) {
    const apexX = (b.y - a.y + a.x * upperSlope - b.x * lowerSlope) / (upperSlope - lowerSlope);
    // Only converge at an apex beyond all four anchors. A backward crossing
    // describes an expanding triangle, whose edges continue to the viewport.
    if (points.every(point => (apexX - point.x) * direction >= 0) && (apexX - endX) * direction < 0) endX = apexX;
  }
  const polygon = [upperAt(a.x), upperAt(endX), lowerAt(endX), lowerAt(a.x)];
  return { polygon, edges: [[polygon[0], polygon[1]], [polygon[3], polygon[2]], [polygon[3], polygon[0]]] as [ScreenPoint, ScreenPoint][] };
}

// Clip the completed lobes to the head side of the neckline. This leaves the
// initial approach and the final break outside the shaded region, for both
// ordinary and inverse head-and-shoulders drawings.
export function headShouldersGeometry(points: readonly ScreenPoint[], width: number) {
  const polygons: ScreenPoint[][] = [];
  const a = points[2], b = points[4];
  if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) < 1e-7) return { polygons, neckline: null };
  const side = (p: ScreenPoint) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const headSide = Math.sign(side(points[3])) || -1;
  const intersect = (p: ScreenPoint, q: ScreenPoint) => {
    const denominator = side(p) - side(q);
    if (Math.abs(denominator) < 1e-7) return null;
    const t = side(p) / denominator;
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
  };
  for (const indices of [[0, 1, 2], [2, 3, 4], [4, 5, 6]]) {
    if (indices.some(i => !points[i])) continue;
    const source = indices.map(i => points[i]), clipped: ScreenPoint[] = [];
    for (let i = 0; i < source.length; i++) {
      const p = source[i], q = source[(i + 1) % source.length];
      const insideP = side(p) * headSide >= -1e-7, insideQ = side(q) * headSide >= -1e-7;
      if (insideP) clipped.push(p);
      if (insideP !== insideQ) { const cross = intersect(p, q); if (cross) clipped.push(cross); }
    }
    if (clipped.length >= 3) polygons.push(clipped);
  }
  if (Math.abs(b.x - a.x) < 1e-7) return { polygons, neckline: [a, b] as [ScreenPoint, ScreenPoint] };
  const atX = (x: number): ScreenPoint => ({ x, y: a.y + (x - a.x) * (b.y - a.y) / (b.x - a.x) });
  const startCross = intersect(points[0], points[1]);
  const start = startCross && startCross.x >= Math.min(points[0].x, points[1].x) && startCross.x <= Math.max(points[0].x, points[1].x)
    ? startCross : atX(points[0].x);
  // Until the final leg exists, show the neckline to the edge of the chart.
  const end = points[6] ? atX(points[6].x) : atX(b.x >= a.x ? width : 0);
  return { polygons, neckline: [start, end] as [ScreenPoint, ScreenPoint] };
}

export function renderReferencePattern(
  drawing: TradingDrawingModel,
  projectedPoints: readonly ScreenPoint[],
  confirmedPointCount = drawing.points.length,
  bounds = { width: 1200, height: 800 },
  translate: (text: string) => string = text => text,
) {
  if (!isReferencePatternDrawing(drawing.tool)) return { body: '', hit: '' };
  const headShoulders = drawing.tool === 'head-shoulders';
  const abcd = drawing.tool === 'abcd';
  const triangle = drawing.tool === 'triangle-pattern';
  const threeDrives = drawing.tool === 'three-drives';
  const points = projectedPoints.slice(0, headShoulders || threeDrives ? 7 : abcd || triangle ? 4 : 5);
  // A newly confirmed anchor is also the next preview until the mouse moves.
  // Do not flash a second letter or a zero-valued measurement at that position.
  if (confirmedPointCount < points.length && points.length > 1) {
    const last = points.at(-1)!, previous = points.at(-2)!;
    if (Math.hypot(last.x - previous.x, last.y - previous.y) < .5) points.pop();
  }
  if (!points.length || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return { body: '', hit: '' };
  const color = drawing.color ?? manualDrawingDefaults(drawing.tool).color;
  const fill = harmonicFillColor(drawing);
  const fontSize = drawing.fontSize ?? 14;
  const height = fontSize + 8;
  const width = drawing.lineWidth ?? 2;
  const attrs = (p: readonly ScreenPoint[]) => p.map(p => `${p.x},${p.y}`).join(' ');
  const neck = headShoulders ? headShouldersGeometry(points, bounds.width) : null;
  const triangleGeometry = triangle ? trianglePatternGeometry(points, bounds.width) : null;
  const polygons = headShoulders ? neck!.polygons : triangle ? (triangleGeometry ? [triangleGeometry.polygon] : []) : abcd || threeDrives ? []
    : harmonicPatternPolygons(points);
  const chords = isHarmonicDrawing(drawing.tool) ? harmonicDrawingRatios(drawing.tool, drawing.points.slice(0, points.length).map(p => p.price)) : [];
  const segments = points.slice(1).map((point, i) => [points[i], point]);
  let body = polygons.map((polygon, index) => `<polygon data-harmonic-fill="${headShoulders ? index : index === 0 ? 'XAB' : 'BCD'}" points="${attrs(polygon)}" fill="${fill}" stroke="none"/>`).join('');
  body += renderPatternLegs(drawing, points);
  body += chords.map(({ chord, from, to }) => {
    const a = points[from], b = points[to];
    segments.push([a, b]);
    return `<line data-harmonic-chord="${chord}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="${abcd || threeDrives ? width : 1}" stroke-dasharray="${abcd || threeDrives ? '2 6' : '1 3'}" vector-effect="non-scaling-stroke"/>`;
  }).join('');
  if (neck?.neckline) {
    const [a, b] = neck.neckline;
    segments.push([a, b]);
    body += `<line data-head-shoulders-neckline x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="${width}" stroke-dasharray="2 6" vector-effect="non-scaling-stroke"/>`;
  }
  if (triangleGeometry) body += triangleGeometry.edges.map(([a, b], index) => {
    segments.push([a, b]);
    return `<line data-triangle-boundary="${index}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="${width}" stroke-dasharray="2 6" vector-effect="non-scaling-stroke"/>`;
  }).join('');
  const boxes: { x: number; y: number; width: number }[] = [];
  const badge = (text: string, center: ScreenPoint, attribute: string) => {
    const result = renderPatternBadge(drawing, text, center, attribute);
    boxes.push(result.box);
    return result.body;
  };
  body += chords.map(({ chord, from, to, value }) => badge(formatHarmonicRatio(value, threeDrives ? 2 : 3), {
    x: (points[from].x + points[to].x) / 2,
    y: (points[from].y + points[to].y) / 2,
  }, `data-harmonic-ratio="${chord}"`)).join('');
  body += points.map((point, index) => {
    if (threeDrives) return '';
    if (headShoulders && ![1, 3, 5].includes(index)) return '';
    const neighbors = [points[index - 1], points[index + 1]].filter(Boolean);
    // Place the letter outside the swing. Endpoints use their one neighbor;
    // interior extrema stay above/below even for inverted or crossed drawings.
    const average = neighbors.length ? neighbors.reduce((sum, p) => sum + p.y, 0) / neighbors.length : point.y;
    const below = point.y > average;
    const label = headShoulders ? translate(({ 1: '左肩', 3: '头部', 5: '右肩' } as Record<number, string>)[index]) : (abcd || triangle ? 'ABCD' : 'XABCD')[index];
    return badge(label, { x: point.x, y: point.y + (below ? 1 : -1) * (height / 2 + 6) }, `data-harmonic-point="${index}"`);
  }).join('');
  const hit = polygons.map(polygon => `<polygon class="trading-drawing-hit-target area" points="${attrs(polygon)}"/>`).join('')
    + segments.map(([a, b]) => `<line class="trading-drawing-hit-target" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`).join('')
    + boxes.map(box => `<rect class="trading-drawing-hit-target area" x="${box.x}" y="${box.y}" width="${box.width}" height="${height}"/>`).join('');
  return { body, hit };
}
