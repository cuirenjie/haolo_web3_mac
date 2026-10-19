import { translateDrawingText } from './app-language.mjs';

type Point = { x: number; y: number };
type PricePoint = { time: number; price: number };

function duration(seconds: number) {
  let remaining = Math.abs(Math.round(seconds));
  const parts: string[] = [];
  for (const [size, unit] of [[86400, '天'], [3600, '小时'], [60, '分钟'], [1, '秒']] as const) {
    const value = Math.floor(remaining / size);
    if (value) parts.push(translateDrawingText(`${value}${unit}`));
    remaining %= size;
  }
  return parts.join(' ') || translateDrawingText('0秒');
}

export function tradingInfoLineRows(options: {
  start: PricePoint; end: PricePoint; first: Point; second: Point;
  bars: number | null; precision: number; minMove: number;
}) {
  const { start, end, first, second } = options;
  const precision = Number.isFinite(options.precision) ? Math.max(0, Math.min(12, options.precision)) : 2;
  const delta = end.price - start.price;
  const number = (value: number, digits: number) => (Object.is(value, -0) ? 0 : value).toLocaleString('en-US', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
  const signed = (value: number, digits: number) => `${value > 0 ? '+' : ''}${number(value, digits)}`;
  const percent = start.price ? delta / start.price * 100 : 0;
  const tickSize = options.minMove > 0 ? options.minMove : 10 ** -precision;
  const dx = second.x - first.x, dy = second.y - first.y;
  // Screen Y grows downwards. Normalize the slope so reversing the anchors
  // preserves the visual angle while price change retains its direction.
  let angle = Math.atan2(-dy, dx) * 180 / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  const bars = options.bars === null ? '—' : number(Math.round(Math.abs(options.bars)), 0);
  return [
    `${signed(delta, precision)} (${signed(percent, 2)}%), ${signed(Math.round(delta / tickSize), 0)}`,
    translateDrawingText(`${bars}根K线 (${duration(end.time - start.time)}), 距离: ${number(Math.round(Math.hypot(dx, dy)), 0)} px`),
    `${number(Number(angle.toFixed(2)), 2)}°`,
  ];
}

const icons = [
  'M5 3h14M5 21h14M12 5v14m-4-11 4-4 4 4m-8 8 4 4 4-4',
  'M2 3v18M22 3v18M5 12h14m-11-4-4 4 4 4m8-8 4 4-4 4M10 5v4m4 6v4',
  'M4 20h17M4 20 13 3M10 9a12 12 0 0 1 5 11',
];
let measure: CanvasRenderingContext2D | null | undefined;

export function renderTradingInfoLineCard(
  rows: string[], first: Point, second: Point, bounds: { width: number; height: number }, opacity = 1,
) {
  if (measure === undefined && typeof document !== 'undefined') measure = document.createElement('canvas').getContext('2d');
  if (measure) measure.font = '400 14px Inter, "Segoe UI", "Microsoft YaHei", sans-serif';
  const textWidth = Math.max(...rows.map(row => measure?.measureText(row).width ?? Array.from(row).length * 8));
  const width = Math.ceil(textWidth) + 64, height = 112, gap = 16;
  const mid = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  const falling = (second.x - first.x) * (second.y - first.y) >= 0;
  const right = mid.x + gap, left = mid.x - width - gap;
  const above = mid.y - height - gap, below = mid.y + gap;
  // Prefer the open quadrant above the segment, matching TradingView, then
  // try the opposite quadrant before clamping against a chart edge.
  const candidates = falling ? [[right, above], [left, below]] : [[left, above], [right, below]];
  const [preferredX, preferredY] = candidates.find(([x, y]) => x >= 6 && y >= 6 && x + width <= bounds.width - 6 && y + height <= bounds.height - 6) ?? candidates[0];
  const scale = Math.min(1, Math.max(0, bounds.width - 12) / width, Math.max(0, bounds.height - 12) / height);
  const x = Math.max(6, Math.min(preferredX, bounds.width - width * scale - 6));
  const y = Math.max(6, Math.min(preferredY, bounds.height - height * scale - 6));
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<g class="trading-info-line-card" data-i18n-skip transform="translate(${x} ${y}) scale(${scale})" opacity="${opacity}">`
    + `<rect class="trading-info-line-background" width="${width}" height="${height}" rx="5" />`
    + rows.map((row, index) => `<g transform="translate(0 ${24 + index * 32})">`
      + `<path d="${icons[index]}" transform="translate(14 -10) scale(.833333)" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />`
      + `<text x="48" y="0" dominant-baseline="central" fill="currentColor" font-size="14" font-weight="400">${escape(row)}</text></g>`).join('')
    + '</g>';
}
