import { normalizeColor } from './color-picker.ts';
import type { TradingDrawingModel, TradingDrawingLineStyle, ScreenPoint } from './trading-expert-drawing.ts';

export const FIB_LEVEL_DEFAULTS = [
  [0, '#808080'], [.236, '#f23645'], [.382, '#ff9800'], [.5, '#4caf50'],
  [.618, '#089981'], [.786, '#00bcd4'], [1, '#808080'], [1.618, '#2962ff'],
  [2.618, '#f23645'], [3.618, '#9c27b0'], [4.236, '#e91e63'], [1.272, '#ff9800'],
  [1.414, '#f23645'], [2.272, '#ff9800'], [2.414, '#4caf50'], [2, '#089981'],
  [3, '#00bcd4'], [3.272, '#808080'], [3.414, '#2962ff'], [4, '#f23645'],
  [4.272, '#9c27b0'], [4.414, '#e91e63'],
] as const;
export const FIB_INTERVAL_GROUPS = ['seconds', 'minutes', 'hours', 'days', 'weeks', 'months'] as const;
export const FIB_TIME_LEVEL_DEFAULTS = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]
  .map(value => [value, value === 0 ? '#808080' : '#2962ff'] as const);
export const FIB_FAN_LEVEL_DEFAULTS = [[1, '#808080'], [.75, '#2962ff'], [.618, '#089981'], [.5, '#4caf50'], [.382, '#00bcd4'], [.25, '#ff9800'], [0, '#808080']] as const;
export const FIB_TREND_TIME_DEFAULTS = [[0, '#808080'], [.382, '#f23645'], [.618, '#4caf50'], [1, '#089981'], [1.618, '#00bcd4'], [2.618, '#2962ff'], [3.618, '#9c27b0'], [4.236, '#e91e63']] as const;
export const FIB_CIRCLE_DEFAULTS = [[.236, '#f23645'], [.382, '#ff9800'], [.5, '#089981'], [.618, '#4caf50'], [.786, '#00bcd4'], [1, '#808080'], [1.618, '#2962ff'], [2.618, '#e91e63'], [3.618, '#2962ff'], [4.236, '#e91e63'], [4.618, '#f23645']] as const;
export const PITCHFAN_DEFAULTS = [[0, '#2962ff'], [.25, '#00bcd4'], [.5, '#f23645'], [.75, '#00bcd4'], [1, '#2962ff']] as const;
export const GANN_BOX_DEFAULTS = [[0, '#808080'], [.25, '#ff9800'], [.382, '#00bcd4'], [.5, '#4caf50'], [.618, '#089981'], [.75, '#2962ff'], [1, '#808080']] as const;
export const GANN_SQUARE_DEFAULTS = [[0,'#808080'],[1,'#ff9800'],[2,'#00bcd4'],[3,'#4caf50'],[4,'#089981'],[5,'#2962ff']] as const;
export const GANN_FAN_DEFAULTS = [[8,'#f23645'],[4,'#e91e63'],[3,'#9c27b0'],[2,'#2962ff'],[1,'#00bcd4'],[.5,'#089981'],[1/3,'#4caf50'],[.25,'#089981'],[.125,'#ff9800']] as const;
type IntervalGroup = typeof FIB_INTERVAL_GROUPS[number];
export interface FibonacciOptions {
  name: string;
  counterclockwise: boolean; fullCircles: boolean; gannFanVisible: boolean; gannArcsVisible: boolean;
  levels: { value: number; color: string; enabled: boolean }[];
  trendVisible: boolean; trendColor: string; trendWidth: number; trendStyle: TradingDrawingLineStyle;
  lineWidth: number; lineStyle: TradingDrawingLineStyle;
  extendLeft: boolean; extendRight: boolean;
  fillVisible: boolean; fillOpacity: number; showPrices: boolean; showLevels: boolean;
  visibility: Record<IntervalGroup, { enabled: boolean; min: number; max: number }>;
}
const limits = [59, 59, 24, 366, 52, 12];
const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
const style = (value: unknown, fallback: TradingDrawingLineStyle): TradingDrawingLineStyle =>
  value === 'solid' || value === 'dashed' || value === 'dotted' ? value : fallback;
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export function normalizeFibonacciOptions(value?: unknown, tool?: string): FibonacciOptions {
  const v = record(value), ranges = record(v.visibility);
  const timeZone = tool === 'fib-time-zone';
  const defaults = tool === 'gann-fan' ? GANN_FAN_DEFAULTS : tool?.startsWith('gann-square') ? GANN_SQUARE_DEFAULTS : tool === 'gann-box' ? GANN_BOX_DEFAULTS : tool === 'pitchfan' ? PITCHFAN_DEFAULTS : tool === 'fib-wedge' ? FIB_LEVEL_DEFAULTS.filter(([r]) => r > 0 && r <= 1) : timeZone ? FIB_TIME_LEVEL_DEFAULTS : tool === 'fib-speed-fan' ? FIB_FAN_LEVEL_DEFAULTS : tool === 'fib-trend-time' ? FIB_TREND_TIME_DEFAULTS : ['fib-circles','fib-speed-arcs'].includes(tool ?? '') ? FIB_CIRCLE_DEFAULTS : FIB_LEVEL_DEFAULTS;
  return {
    gannFanVisible: v.gannFanVisible !== false, gannArcsVisible: v.gannArcsVisible !== false,
    fullCircles: v.fullCircles === true,
    counterclockwise: v.counterclockwise === true,
    name: typeof v.name === 'string' ? v.name.trim().slice(0, 80) : '',
    levels: defaults.map(([ratio, color], i) => {
      const level = record(v.levels?.[i]);
      return { value: number(level.value, ratio, -1000, 1000), color: normalizeColor(level.color) ?? color,
        enabled: typeof level.enabled === 'boolean' ? level.enabled : i < 11 };
    }),
    trendVisible: v.trendVisible !== false, trendColor: normalizeColor(v.trendColor) ?? (tool === 'fib-speed-fan' ? '#153899cc' : tool === 'fib-spiral' ? '#00bcd4' : tool === 'pitchfan' ? '#f23645' : '#808080'),
    trendWidth: number(v.trendWidth, timeZone || tool === 'fib-speed-fan' ? 1 : 2, .5, 8), trendStyle: style(v.trendStyle, ['fib-speed-fan','fib-spiral','fib-wedge','pitchfan'].includes(tool ?? '') ? 'solid' : 'dashed'),
    lineWidth: number(v.lineWidth, 2, .5, 8), lineStyle: style(v.lineStyle, 'solid'),
    extendLeft: v.extendLeft === true, extendRight: v.extendRight === true,
    fillVisible: typeof v.fillVisible === 'boolean' ? v.fillVisible : !timeZone, fillOpacity: number(v.fillOpacity, .2, 0, 1),
    showPrices: typeof v.showPrices === 'boolean' ? v.showPrices : !timeZone && tool !== 'fib-speed-fan', showLevels: v.showLevels !== false,
    visibility: Object.fromEntries(FIB_INTERVAL_GROUPS.map((key, i) => {
      const range = record(ranges[key]), min = Math.round(number(range.min, 1, 1, limits[i]));
      const max = Math.round(number(range.max, limits[i], 1, limits[i]));
      return [key, { enabled: range.enabled !== false, min: Math.min(min, max), max: Math.max(min, max) }];
    })) as FibonacciOptions['visibility'],
  };
}
export function fibonacciOptionsForDrawing(drawing: Pick<TradingDrawingModel, 'fibonacci' | 'color' | 'lineWidth' | 'lineStyle'> & { tool?: string }) {
  const options = normalizeFibonacciOptions(drawing.fibonacci, drawing.tool);
  if (normalizeColor(drawing.color)) {
    options.levels.forEach(level => { level.color = drawing.color!; });
    options.trendColor = drawing.color!;
  }
  if (drawing.lineWidth !== undefined) options.lineWidth = number(drawing.lineWidth, options.lineWidth, .5, 8);
  if (drawing.lineStyle) options.lineStyle = style(drawing.lineStyle, options.lineStyle);
  return options;
}
export function fibonacciVisibleAtInterval(value: unknown, interval: string) {
  const match = /^(\d+)([smhdwMy]|D|W)?$/.exec(interval);
  if (!match) return true;
  const unit = match[2] || 'm';
  const key = ({ s: 'seconds', m: 'minutes', h: 'hours', d: 'days', D: 'days', w: 'weeks', W: 'weeks', M: 'months', y: 'months' } as const)[unit as 's'];
  const count = Number(match[1]) * (unit === 'y' ? 12 : 1);
  // Numeric chart-library periods use minutes (60/240), so normalize hours.
  const group = unit === 'm' && count >= 60 && count % 60 === 0 ? 'hours' : key;
  const amount = group === 'hours' && unit === 'm' ? count / 60 : count;
  const range = normalizeFibonacciOptions(value).visibility[group];
  return range.enabled && amount >= range.min && amount <= range.max;
}

export function fibonacciGeometry(drawing: TradingDrawingModel, first: ScreenPoint, second: ScreenPoint,
  bounds: { width: number; height: number }, priceToY: (price: number) => number | null) {
  const options = fibonacciOptionsForDrawing(drawing);
  const expanded = Math.hypot(second.x - first.x, second.y - first.y) >= 3;
  const left = options.extendLeft ? 0 : Math.min(first.x, second.x);
  const right = options.extendRight ? bounds.width : Math.max(first.x, second.x);
  const firstPrice = drawing.points[0].price, secondPrice = drawing.points.at(-1)!.price;
  const levels = options.levels.filter(level => level.enabled && (expanded || level.value === 1))
    .map(level => { const price = secondPrice + (firstPrice - secondPrice) * level.value; return { ...level, price, y: priceToY(price) }; })
    .filter((level): level is typeof level & { y: number } => level.y !== null && Number.isFinite(level.y))
    .sort((a, b) => b.value - a.value);
  return { options, expanded, left, right, levels };
}

export function renderFibonacci(drawing: TradingDrawingModel, first: ScreenPoint, second: ScreenPoint,
  bounds: { width: number; height: number }, priceToY: (price: number) => number | null,
  formatPrice: (price: number) => string, opacity = 1) {
  const { options: o, expanded, left, right, levels } = fibonacciGeometry(drawing, first, second, bounds, priceToY);
  const stroke = (width: number, lineStyle: TradingDrawingLineStyle) => `stroke-width="${width}" vector-effect="non-scaling-stroke"${lineStyle === 'solid' ? '' : ` stroke-dasharray="${lineStyle === 'dashed' ? '5 5' : '2 4'}"`}`;
  const line = (a: ScreenPoint, b: ScreenPoint, color: string, width: number, lineStyle: TradingDrawingLineStyle, cls: string) =>
    `<line class="${cls}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" ${stroke(width, lineStyle)} opacity="${opacity}"/>`;
  const fillLeft = Math.max(0, left), fillRight = Math.min(bounds.width, right);
  const bands = expanded && o.fillVisible && fillRight > fillLeft ? levels.slice(0, -1).map((level, i) => {
    const top = Math.max(0, Math.min(level.y, levels[i + 1].y)), bottom = Math.min(bounds.height, Math.max(level.y, levels[i + 1].y));
    return bottom > top ? `<rect class="trading-fibonacci-band" data-fibonacci-band="${level.value}" x="${fillLeft}" y="${top}" width="${fillRight - fillLeft}" height="${bottom - top}" fill="${level.color}" fill-opacity="${o.fillOpacity}" opacity="${opacity}"/>` : '';
  }).join('') : '';
  const connector = expanded && o.trendVisible ? line(first, second, o.trendColor, o.trendWidth, o.trendStyle, 'trading-fibonacci-connector') : '';
  const body = bands + connector + levels.map(level => {
    const label = `${o.showLevels ? level.value : ''}${o.showPrices ? `${o.showLevels ? ' ' : ''}(${formatPrice(level.price)})` : ''}`;
    const inside = o.extendLeft || left < 80;
    return `<g class="trading-fibonacci-level" data-fibonacci-level="${level.value}">`
      + line({ x: left, y: level.y }, { x: right, y: level.y }, level.color, o.lineWidth, o.lineStyle, 'trading-fibonacci-level-line')
      + (label ? `<text class="trading-fibonacci-label" x="${inside ? Math.max(0, left) + 8 : left - 8}" y="${level.y}" text-anchor="${inside ? 'start' : 'end'}" dominant-baseline="central" fill="${level.color}" opacity="${opacity}">${label}</text>` : '') + '</g>';
  }).join('');
  const segments: [ScreenPoint, ScreenPoint][] = levels.map(level => [{ x: first.x <= second.x ? left : right, y: level.y }, { x: first.x <= second.x ? right : left, y: level.y }]);
  if (expanded && o.trendVisible) segments.push([first, second]);
  const hit = segments.map(([a, b]) => `<line class="trading-drawing-hit-target" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="transparent" stroke-width="12" fill="none" pointer-events="stroke"/>`).join('');
  return { body, hit };
}
