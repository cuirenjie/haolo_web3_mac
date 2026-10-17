import type { ScreenPoint, TradingDrawingModel } from './trading-expert-drawing.ts';
import { manualDrawingDefaults, manualFibLevelColor } from './trading-drawing-defaults.ts';

export interface DrawingCandle { time: number; open: number; high: number; low: number; close: number; volume?: number }
export const FIB_TIME_RATIOS = [0, 0.382, 0.618, 1, 1.382, 1.618, 2, 2.618, 3.618, 4.236] as const;
export function trendFibTimePositions(a: number, b: number, origin: number) {
  return FIB_TIME_RATIOS.map(ratio => ({ ratio, value: origin + (b - a) * ratio }));
}

export function anchoredVwap(candles: readonly DrawingCandle[], start: number) {
  let volume = 0, weighted = 0;
  return candles.filter(c => c.time >= start).flatMap(c => {
    const v = Math.max(0, Number(c.volume) || 0);
    volume += v;
    weighted += ((c.high + c.low + c.close) / 3) * v;
    return volume > 0 ? [{ time: c.time, price: weighted / volume }] : [];
  });
}

// OHLCV bars do not contain individual trade prices. Allocate each bar's volume
// by its overlap with price bins, conserving total volume (including zero-range bars).
export function drawingVolumeProfile(candles: readonly DrawingCandle[], start: number, end = Infinity, count = 24) {
  const source = candles.filter(c => c.time >= Math.min(start, end) && c.time <= Math.max(start, end)
    && Number.isFinite(c.low) && Number.isFinite(c.high));
  if (!source.length) return [];
  const low = Math.min(...source.map(c => c.low));
  const high = Math.max(...source.map(c => c.high));
  const step = Math.max((high - low) / count, Math.max(Math.abs(low), 1) * 1e-9);
  const bins = Array.from({ length: count }, (_, i) => ({ low: low + i * step, high: low + (i + 1) * step, volume: 0, up: 0 }));
  for (const c of source) {
    const volume = Math.max(0, Number(c.volume) || 0);
    if (c.high === c.low) {
      const bin = bins[Math.min(count - 1, Math.max(0, Math.floor((c.low - low) / step)))];
      bin.volume += volume;
      if (c.close >= c.open) bin.up += volume;
    } else for (const bin of bins) {
      const share = volume * Math.max(0, Math.min(bin.high, c.high) - Math.max(bin.low, c.low)) / (c.high - c.low);
      bin.volume += share;
      if (c.close >= c.open) bin.up += share;
    }
  }
  return bins;
}

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const point = (p: ScreenPoint) => `${p.x},${p.y}`;
const IMAGE_REFERENCE_PREFIX = 'haolo-image:';
const IMAGE_STORAGE_PREFIX = 'haolo.drawing-image.v1.';
export function storeDrawingImage(dataUrl: string) {
  if (!/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=]+$/i.test(dataUrl) || dataUrl.length > 2_000_000) throw new Error('图片过大或格式不支持');
  const id = crypto.randomUUID();
  // Assets stay on this device; drawing sync transports the reference and anchors only.
  localStorage.setItem(IMAGE_STORAGE_PREFIX + id, dataUrl);
  return IMAGE_REFERENCE_PREFIX + id;
}
export function drawingImageUrl(value: string) {
  if (value.startsWith(IMAGE_REFERENCE_PREFIX)) {
    try {
      const data = localStorage.getItem(IMAGE_STORAGE_PREFIX + value.slice(IMAGE_REFERENCE_PREFIX.length)) ?? '';
      return /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=]+$/i.test(data) ? data : '';
    } catch { return ''; }
  }
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
export const EXTRA_GEOMETRY_TOOLS = new Set([
  'fib-trend-time', 'fib-speed-arcs', 'gann-square-fixed', 'time-cycles', 'sine-line',
  'anchored-vwap', 'anchored-volume-profile', 'sector',
]);

export function renderExtraDrawingGeometry(options: {
  drawing: TradingDrawingModel; points: ScreenPoint[]; bounds: { width: number; height: number };
  color: string; candles: readonly DrawingCandle[]; project: (p: { time: number; price: number }) => ScreenPoint | null;
}): { body: string; hit: string } | null {
  const { drawing, points, bounds, color, candles, project } = options;
  if (!EXTRA_GEOMETRY_TOOLS.has(drawing.tool) || !points.length) return null;
  const a = points[0], b = points[1] ?? a, c = points[2] ?? b;
  const defaults = drawing.source === 'ai' ? undefined : manualDrawingDefaults(drawing.tool);
  const dash = drawing.lineStyle === 'dashed' ? '7 5' : drawing.lineStyle === 'dotted' ? '2 4' : '';
  const styleFor = (ink = color) => `fill="none" stroke="${ink}" stroke-width="${drawing.lineWidth ?? defaults?.lineWidth ?? 1}" stroke-dasharray="${dash}" vector-effect="non-scaling-stroke"`;
  let body = '', hit = '';
  const line = (p: ScreenPoint, q: ScreenPoint, ink = color) => {
    body += `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" ${styleFor(ink)}/>`;
    hit += `<line class="trading-drawing-hit-target" x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}"/>`;
  };
  const path = (d: string, fill = false, ink = color) => {
    body += `<path d="${d}" ${styleFor(ink)}${fill ? ` style="fill:${color};fill-opacity:${defaults?.fillOpacity ?? .07}"` : ''}/>`;
    hit += `<path class="trading-drawing-hit-target" d="${d}"/>`;
  };
  const label = (p: ScreenPoint, text: string) => { body += `<text x="${p.x}" y="${p.y}" fill="${color}" font-size="11">${escape(text)}</text>`; };
  if (drawing.tool === 'fib-trend-time') {
    line(a, b); line(b, c);
    for (const { ratio, value: x } of trendFibTimePositions(a.x, b.x, c.x)) {
      if (x < 0 || x > bounds.width) continue;
      line({ x, y: 0 }, { x, y: bounds.height }, defaults && !drawing.color ? manualFibLevelColor(ratio) : color); label({ x: x + 4, y: 18 }, String(ratio));
    }
  } else if (drawing.tool === 'fib-speed-arcs') {
    line(a, b);
    const radius = Math.hypot(b.x - a.x, b.y - a.y);
    for (const ratio of [0.236, 0.382, 0.5, 0.618, 0.786, 1]) {
      const r = radius * ratio;
      if (r < .1) continue;
      const sweep = b.y <= a.y ? 0 : 1;
      path(`M${a.x - r},${a.y} A${r},${r} 0 0 ${sweep} ${a.x + r},${a.y}`, false, defaults && !drawing.color ? manualFibLevelColor(ratio) : color);
      label({ x: a.x + r + 3, y: a.y - 3 }, String(ratio));
    }
  } else if (drawing.tool === 'gann-square-fixed') {
    const size = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
    const sx = Math.sign(b.x - a.x) || 1, sy = Math.sign(b.y - a.y) || -1;
    const p = (x: number, y: number) => ({ x: a.x + sx * x * size, y: a.y + sy * y * size });
    for (let i = 0; i <= 5; i++) { line(p(i / 5, 0), p(i / 5, 1)); line(p(0, i / 5), p(1, i / 5)); }
    for (const r of [.125, .25, .5, 1]) { line(a, p(1, r)); if (r !== 1) line(a, p(r, 1)); }
    line(p(1, 0), p(0, 1));
    for (const r of [.25, .5, .75, 1]) path(`M${point(p(r, 0))} A${r * size},${r * size} 0 0 ${sx * sy > 0 ? 1 : 0} ${point(p(0, r))}`);
  } else if (drawing.tool === 'time-cycles') {
    const width = Math.max(Math.abs(b.x - a.x), 4);
    const radius = width / 2;
    const start = a.x - Math.ceil(a.x / width) * width;
    for (let x = start, n = 0; x < bounds.width && n < 500; x += width, n++)
      path(`M${x},${a.y} A${radius},${radius} 0 0 1 ${x + width},${a.y}`);
  } else if (drawing.tool === 'sine-line') {
    const halfPeriod = Math.max(Math.abs(b.x - a.x), 4);
    const center = (a.y + b.y) / 2, amplitude = (a.y - b.y) / 2;
    const samples = Math.min(2400, Math.ceil(bounds.width / 2));
    const wave = Array.from({ length: samples + 1 }, (_, i) => {
      const x = i * bounds.width / samples;
      return { x, y: center + amplitude * Math.cos((x - a.x) * Math.PI / halfPeriod) };
    });
    path(`M${wave.map(point).join(' L')}`);
  } else if (drawing.tool === 'sector') {
    const radius = Math.hypot(b.x - a.x, b.y - a.y);
    const angle = Math.atan2(c.y - a.y, c.x - a.x);
    const end = { x: a.x + Math.cos(angle) * radius, y: a.y + Math.sin(angle) * radius };
    const startAngle = Math.atan2(b.y - a.y, b.x - a.x);
    const turn = (angle - startAngle + Math.PI * 2) % (Math.PI * 2);
    path(`M${point(a)} L${point(b)} A${radius},${radius} 0 ${turn > Math.PI ? 1 : 0} 1 ${point(end)} Z`, true);
  } else if (drawing.tool === 'anchored-vwap') {
    const values = anchoredVwap(candles, drawing.points[0].time);
    const projected = values.map(project).filter((p): p is ScreenPoint => !!p);
    if (projected.length > 1) path(`M${projected.map(point).join(' L')}`);
    if (projected.length) label(projected.at(-1)!, 'VWAP');
    else { line({ x: a.x, y: a.y - 10 }, { x: a.x, y: a.y + 10 }); label({ x: a.x + 8, y: a.y }, '暂无成交量数据'); }
  } else if (drawing.tool === 'anchored-volume-profile') {
    const bins = drawingVolumeProfile(candles, drawing.points[0].time);
    const maxVolume = Math.max(...bins.map(bin => bin.volume), 0);
    if (maxVolume <= 0) { line({ x: a.x, y: a.y - 10 }, { x: a.x, y: a.y + 10 }); label({ x: a.x + 8, y: a.y }, '暂无成交量数据'); }
    const width = Math.max(40, Math.min(180, bounds.width * .22));
    for (const bin of bins) {
      const low = project({ time: drawing.points[0].time, price: bin.low });
      const high = project({ time: drawing.points[0].time, price: bin.high });
      if (!low || !high || !maxVolume) continue;
      const w = width * bin.volume / maxVolume, upWidth = width * bin.up / maxVolume;
      const top = Math.min(low.y, high.y), height = Math.max(Math.abs(low.y - high.y) - .5, .5);
      body += `<rect x="${a.x}" y="${top}" width="${upWidth}" height="${height}" fill="#26a69a" fill-opacity=".55"/><rect x="${a.x + upWidth}" y="${top}" width="${w - upWidth}" height="${height}" fill="#ef5350" fill-opacity=".55"/>`;
      hit += `<rect class="trading-drawing-hit-target area" x="${a.x}" y="${top}" width="${Math.max(w, 8)}" height="${height}"/>`;
      if (bin.volume === maxVolume) { line({ x: a.x, y: (top + height / 2) }, { x: bounds.width, y: top + height / 2 }); label({ x: a.x + width + 4, y: top }, 'POC'); }
    }
  }
  return { body, hit };
}

export function renderExtraAnnotation(drawing: TradingDrawingModel, anchor: ScreenPoint, color: string): string | null {
  const { x, y } = anchor, size = drawing.fontSize ?? 16, text = drawing.text ?? '';
  if (['emoji', 'sticker', 'icon'].includes(drawing.tool)) {
    const glyphSize = drawing.fontSize ?? (drawing.tool === 'sticker' ? 64 : 32);
    return `<text x="${x}" y="${y}" fill="${color}" font-size="${glyphSize}" text-anchor="middle" dominant-baseline="central">${escape(text || '🙂')}</text>`;
  }
  if (drawing.tool === 'table') {
    const rows = (text || '项目 | 数值\n价格 | 0').split('\n').slice(0, 12).map(row => row.split(/[|\t]/).slice(0, 6));
    const columns = Math.max(...rows.map(row => row.length)), cell = Math.max(72, size * 6), height = size + 16;
    return rows.map((row, r) => Array.from({ length: columns }, (_, c) =>
      `<rect x="${x + c * cell}" y="${y + r * height}" width="${cell}" height="${height}" fill="var(--trading-market-panel)" stroke="${color}"/><text x="${x + c * cell + 6}" y="${y + r * height + size + 5}" fill="${color}" font-size="${size}">${escape(row[c]?.trim() ?? '')}</text>`).join('')).join('');
  }
  if (drawing.tool === 'image') {
    // Only explicit HTTP(S) image links; no HTML, SVG markup, or executable URL protocols.
    const url = drawingImageUrl(text);
    return url ? `<image href="${escape(url)}" x="${x}" y="${y}" width="240" height="160" preserveAspectRatio="xMidYMid meet"/>`
      : `<rect x="${x}" y="${y}" width="240" height="160" fill="none" stroke="${color}"/><text x="${x + 12}" y="${y + 28}" fill="${color}">请输入图片链接</text>`;
  }
  if (drawing.tool === 'price-label') {
    const value = drawing.points[0]?.price.toLocaleString('en-US', { maximumFractionDigits: 6 }) ?? '';
    const width = value.length * size * .62 + 18;
    return `<path d="M${x},${y} l8,-${size + 10} h${width} v${size + 18} h-${width} Z" fill="var(--trading-market-panel)" stroke="${color}"/><text x="${x + 14}" y="${y - 6}" fill="${color}" font-size="${size}">${value}</text>`;
  }
  if (drawing.tool === 'arrow-left' || drawing.tool === 'arrow-right') {
    const sign = drawing.tool === 'arrow-left' ? -1 : 1;
    return `<path d="M${x + sign * 12},${y} l${-sign * 12},-9 v5 h${-sign * 10} v8 h${sign * 10} v5 Z" fill="${color}"/>`;
  }
  return null;
}
