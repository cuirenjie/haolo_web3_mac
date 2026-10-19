import type { DrawingCandle } from './trading-drawing-extra-tools.ts';
import type { ScreenPoint, TradingDrawingModel, TradingDrawingPoint } from './trading-expert-drawing.ts';
import { translateDrawingText } from './app-language.mjs';

export const isRangeDrawing = (tool: string) => ['price-range', 'date-range', 'date-price-range'].includes(tool);
export const rangeFillColor = (drawing: TradingDrawingModel) => drawing.textBackgroundColor ?? '#2962ff26';
function duration(seconds: number) {
  let remaining = Math.abs(Math.round(seconds));
  const parts: string[] = [];
  for (const [size, unit] of [[86400, '天'], [3600, '小时'], [60, '分钟'], [1, '秒']] as const) {
    const value = Math.floor(remaining / size); if (value) parts.push(translateDrawingText(`${value}${unit}`)); remaining %= size;
  }
  return parts.join(' ') || translateDrawingText('0秒');
}
const format = (n: number, digits: number) => (Math.abs(n) < .5 * 10 ** -digits ? 0 : n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace('-', '−');
export function rangeMeasurement(options: { start: TradingDrawingPoint; end: TradingDrawingPoint; candles: readonly Pick<DrawingCandle, 'time' | 'volume'>[]; bars: number | null; precision?: number; minMove?: number }) {
  const { start, end, candles } = options;
  const precision = Math.max(0, Math.min(12, options.precision ?? 2)), tick = options.minMove && options.minMove > 0 ? options.minMove : 10 ** -precision;
  const delta = end.price - start.price, percent = start.price === 0 ? null : delta / start.price * 100;
  let volume = 0;
  for (const candle of candles) if (candle.time >= Math.min(start.time, end.time) && candle.time <= Math.max(start.time, end.time) && Number.isFinite(candle.volume) && candle.volume! > 0) volume += candle.volume!;
  const compactVolume = volume >= 1e9 ? `${format(volume / 1e9, 2)}B` : volume >= 1e6 ? `${format(volume / 1e6, 2)}M` : volume >= 1e3 ? `${format(volume / 1e3, 2)}K` : format(volume, 0);
  return { delta, percent, ticks: Math.round(delta / tick), volume,
    priceText: `${format(delta, precision)} (${percent === null ? '—' : format(percent, 2)}%) ${format(Math.round(delta / tick), 0)}`,
    dateText: `${translateDrawingText(`${options.bars === null ? '—' : Math.round(Math.abs(options.bars))}根K线`)}, ${duration(end.time - start.time)}`,
    volumeText: `${translateDrawingText('成交量')} ${compactVolume}` };
}
let context: CanvasRenderingContext2D | null | undefined;
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function renderRangeDrawing(drawing: TradingDrawingModel, points: ScreenPoint[], bounds: { width: number; height: number }, measurement: ReturnType<typeof rangeMeasurement>, selected: boolean, draft: boolean) {
  const a = points[0], b = points[1] ?? a;
  if (!a) return { body: '', hit: '', handles: '' };
  const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x), top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y), midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
  const ink = drawing.color ?? '#2962ff', lineWidth = drawing.lineWidth ?? 2, dash = drawing.lineStyle === 'dashed' ? '7 5' : drawing.lineStyle === 'dotted' ? '2 4' : '';
  const price = drawing.tool !== 'date-range', date = drawing.tool !== 'price-range';
  let path = '';
  if (drawing.tool === 'price-range') path += `M${left},${top} H${right} M${left},${bottom} H${right} `;
  if (drawing.tool === 'date-range') path += `M${left},${top} V${bottom} M${right},${top} V${bottom} `;
  if (price) {
    const direction = Math.sign(b.y - a.y) || 1, arrow = Math.min(12, Math.abs(b.y - a.y) / 3);
    path += `M${midX},${a.y} V${b.y} M${midX - arrow},${b.y - direction * arrow} L${midX},${b.y} L${midX + arrow},${b.y - direction * arrow} `;
  }
  if (date) {
    const direction = Math.sign(b.x - a.x) || 1, arrow = Math.min(12, Math.abs(b.x - a.x) / 3);
    path += `M${a.x},${midY} H${b.x} M${b.x - direction * arrow},${midY - arrow} L${b.x},${midY} L${b.x - direction * arrow},${midY + arrow}`;
  }
  let body = `<rect data-range-fill x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" fill="${escape(rangeFillColor(drawing))}"/>`
    + `<path data-range-arrows d="${path}" fill="none" stroke="${escape(ink)}" stroke-width="${lineWidth}" stroke-dasharray="${dash}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
  const rows = [...(price ? [measurement.priceText] : []), ...(date ? [measurement.dateText, measurement.volumeText] : [])];
  const font = drawing.fontSize ?? 14;
  if (context === undefined && typeof document !== 'undefined') context = document.createElement('canvas').getContext('2d');
  if (context) context.font = `${drawing.bold ? 700 : 400} ${font}px "Segoe UI", "Microsoft YaHei", sans-serif`;
  const width = Math.ceil(Math.max(...rows.map(r => context?.measureText(r).width ?? Array.from(r).length * font * .65))) + 24;
  const lineHeight = font + 9, height = rows.length * lineHeight + 10;
  const scale = Math.min(1, Math.max(1, bounds.width - 12) / width, Math.max(1, bounds.height - 12) / height);
  const x = Math.max(6, Math.min(midX - width * scale / 2, bounds.width - width * scale - 6));
  const preferY = price && b.y < a.y ? top - height * scale - 10 : bottom + 10;
  const y = Math.max(6, Math.min(preferY, bounds.height - height * scale - 6));
  body += `<g class="trading-range-card" data-range-card data-i18n-skip transform="translate(${x} ${y}) scale(${scale})"><rect width="${width}" height="${height}" rx="4"/>`
    + rows.map((r, i) => `<text x="${width / 2}" y="${5 + lineHeight * (i + .5)}" text-anchor="middle" dominant-baseline="central" fill="${drawing.textColor ? escape(drawing.textColor) : 'currentColor'}" font-size="${font}" font-weight="${drawing.bold ? 700 : 400}" font-style="${drawing.italic ? 'italic' : 'normal'}">${escape(r)}</text>`).join('') + '</g>';
  const hit = `<rect class="trading-drawing-hit-target area" x="${left}" y="${top}" width="${Math.max(1, right - left)}" height="${Math.max(1, bottom - top)}"/><path class="trading-drawing-hit-target" d="${path}"/>`;
  const handles = selected || draft ? (draft ? [a] : [a, b]).map((p, i) => `<circle class="trading-drawing-handle" data-range-handle data-drawing-handle-index="${i}" cx="${p.x}" cy="${p.y}" r="6" fill="var(--trading-market-panel)" style="stroke:#2962ff" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`).join('') : '';
  return { body, hit, handles };
}
