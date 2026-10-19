/** Three user anchors, in chart coordinates after projection (also works on log scales). */
export interface PitchforkPoint { x: number; y: number }
export type PitchforkTool = 'pitchfork' | 'schiff-pitchfork' | 'modified-schiff-pitchfork' | 'inside-pitchfork';
export type PitchforkLine = { part: string; from: PitchforkPoint; to: PitchforkPoint; ray: boolean; color: string };
export type PitchforkBand = { part: string; from: PitchforkPoint; to: PitchforkPoint; color: string };
const RED = '#f23645', BLUE = '#2962ff', GREEN = '#089981';
const midpoint = (a: PitchforkPoint, b: PitchforkPoint): PitchforkPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const plus = (a: PitchforkPoint, b: PitchforkPoint): PitchforkPoint => ({ x: a.x + b.x, y: a.y + b.y });
const minus = (a: PitchforkPoint, b: PitchforkPoint): PitchforkPoint => ({ x: a.x - b.x, y: a.y - b.y });
const length = (p: PitchforkPoint) => Math.hypot(p.x, p.y);

export function isTradingPitchfork(tool: string): tool is PitchforkTool {
  return ['pitchfork', 'schiff-pitchfork', 'modified-schiff-pitchfork', 'inside-pitchfork'].includes(tool);
}

export function pitchforkGeometry(tool: PitchforkTool, points: readonly PitchforkPoint[]) {
  const lines: PitchforkLine[] = [], bands: PitchforkBand[] = [];
  const [a, b, c] = points;
  const origin = a && b ? tool === 'pitchfork' ? a
    : tool === 'schiff-pitchfork' ? { x: a.x, y: (a.y + b.y) / 2 }
    : midpoint(a, b) : a;
  const center = b && c ? midpoint(b, c) : b;
  const direction = origin && center ? minus(tool === 'inside-pitchfork' && c ? c : center, origin) : { x: 0, y: 0 };
  const line = (part: string, from: PitchforkPoint, to: PitchforkPoint, color = RED, ray = false) => {
    if (length(minus(to, from)) > 1e-7) lines.push({ part, from, to, color, ray });
  };
  if (!a || !b || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return { lines, bands, origin, center, direction };
  if (!c) {
    // First leg: no synthetic channel width or premature fill.
    line('baseline', a, b, RED, tool === 'modified-schiff-pitchfork');
    return { lines, bands, origin, center, direction };
  }
  if (length(minus(b, c)) < 1e-7) {
    // The second click duplicates B until the third-point preview moves.
    line('baseline', a, b);
    if (tool === 'schiff-pitchfork') line('stem', origin, b);
    line('preview-ray', b, plus(b, direction), BLUE, true);
    return { lines, bands, origin, center, direction };
  }
  if (tool !== 'pitchfork') line('baseline', a, b);
  line('crossbar', b, c);
  if (length(direction) < 1e-7) return { lines, bands, origin, center, direction };
  // Inside uses the AB midpoint -> C direction, but the median starts at BC's
  // midpoint. Its construction stem ends at C (not at the channel median).
  if (tool === 'inside-pitchfork') line('stem', origin, c);
  const medianStart = tool === 'inside-pitchfork' ? center : origin;
  line('median', medianStart, plus(medianStart, direction), RED, true);
  const halfB = midpoint(center, b), halfC = midpoint(center, c);
  for (const [part, start, color] of [
    ['outer-b', b, BLUE], ['inner-b', halfB, GREEN],
    ['inner-c', halfC, GREEN], ['outer-c', c, BLUE],
  ] as const) line(part, start, plus(start, direction), color, true);
  bands.push({ part: 'outer-b', from: b, to: halfB, color: BLUE },
    { part: 'inner', from: halfB, to: halfC, color: GREEN },
    { part: 'outer-c', from: halfC, to: c, color: BLUE });
  return { lines, bands, origin, center, direction };
}

/** Clip a filled forward strip to the plot, including when both anchors are offscreen. */
export function clipPitchforkBand(band: PitchforkBand, direction: PitchforkPoint, bounds: { width: number; height: number }) {
  const { width, height } = bounds;
  const magnitude = length(direction);
  if (magnitude < 1e-7 || width <= 0 || height <= 0) return [];
  const unit = { x: direction.x / magnitude, y: direction.y / magnitude };
  const corners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
  const reach = Math.max(0, ...[band.from, band.to].flatMap(start => corners.map(c => (c.x - start.x) * unit.x + (c.y - start.y) * unit.y))) + 1;
  const delta = { x: unit.x * reach, y: unit.y * reach };
  let polygon = [band.from, band.to, plus(band.to, delta), plus(band.from, delta)];
  for (const [axis, edge, greater] of [['x', 0, true], ['x', width, false], ['y', 0, true], ['y', height, false]] as const) {
    const clipped: PitchforkPoint[] = [];
    const inside = (p: PitchforkPoint) => greater ? p[axis] >= edge : p[axis] <= edge;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      if (inside(a)) clipped.push(a);
      if (inside(a) !== inside(b)) {
        const ratio = (edge - a[axis]) / (b[axis] - a[axis]);
        clipped.push({ x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio });
      }
    }
    polygon = clipped;
  }
  return polygon;
}

type LineClipper = (a: PitchforkPoint, b: PitchforkPoint, bounds: { width: number; height: number }, extension: 'segment' | 'ray') => [PitchforkPoint, PitchforkPoint] | null;
export function renderTradingPitchfork(tool: PitchforkTool, points: readonly PitchforkPoint[], bounds: { width: number; height: number },
  style: { color?: string; lineWidth?: number; lineStyle?: 'solid' | 'dashed' | 'dotted' }, clipLine: LineClipper) {
  const geometry = pitchforkGeometry(tool, points);
  const width = style.lineWidth ?? 2;
  const dash = style.lineStyle === 'dashed' ? ' stroke-dasharray="8 5"' : style.lineStyle === 'dotted' ? ' stroke-dasharray="2 4"' : '';
  // Authored colors come through the controller's validated color settings.
  // The shared settings dialog writes its displayed default red even when only
  // coordinates/width change. Keep the default multicolor fork in that case.
  const color = (fallback: string) => style.color && style.color.toLowerCase() !== RED ? style.color : fallback;
  let body = '', hit = '';
  const segments: [PitchforkPoint, PitchforkPoint][] = [];
  for (const band of geometry.bands) {
    const polygon = clipPitchforkBand(band, geometry.direction, bounds);
    if (polygon.length < 3) continue;
    const attr = polygon.map(p => `${p.x},${p.y}`).join(' ');
    body += `<polygon data-pitchfork-fill="${band.part}" points="${attr}" fill="${color(band.color)}" fill-opacity="0.2"/>`;
    hit += `<polygon class="trading-drawing-hit-target area" points="${attr}"/>`;
  }
  for (const line of geometry.lines) {
    const clipped = clipLine(line.from, line.to, bounds, line.ray ? 'ray' : 'segment');
    if (!clipped) continue;
    segments.push(clipped);
    const [a, b] = clipped;
    const attr = `x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"`;
    body += `<line data-pitchfork-line="${line.part}" ${attr} stroke="${color(line.color)}" stroke-width="${width}"${dash} vector-effect="non-scaling-stroke"/>`;
    hit += `<line class="trading-drawing-hit-target" ${attr}/>`;
  }
  return { body, hit, segments, geometry };
}
