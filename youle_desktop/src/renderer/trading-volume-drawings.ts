import type { DrawingCandle } from './trading-drawing-extra-tools.ts';
import type { ScreenPoint, TradingDrawingModel, TradingDrawingPoint } from './trading-expert-drawing.ts';

export const VWAP_SOURCES = ['hlc3', 'hl2', 'ohlc4', 'close', 'open', 'high', 'low'] as const;
export interface AnchoredVwapOptions {
  source: typeof VWAP_SOURCES[number];
  bandMode: 'standard-deviation' | 'percentage';
  multiplier: number;
  showBands: boolean;
  bandColor: string;
  fillOpacity: number;
}
export interface FixedVolumeOptions {
  rows: number;
  rowLayout: 'number' | 'ticks';
  ticksPerRow: number;
  widthPercent: number;
  valueArea: number;
  upColor: string;
  downColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  showPoc: boolean;
}
export const VWAP_DEFAULTS: Readonly<AnchoredVwapOptions> = Object.freeze({ source: 'hlc3', bandMode: 'standard-deviation', multiplier: 1, showBands: true, bandColor: '#4caf50', fillOpacity: .05 });
export const FIXED_VOLUME_DEFAULTS: Readonly<FixedVolumeOptions> = Object.freeze({ rows: 24, rowLayout: 'number', ticksPerRow: 1, widthPercent: 30, valueArea: 70, upColor: '#00bcd4', downColor: '#ec407a', backgroundColor: '#b2ebf2', backgroundOpacity: .15, showPoc: true });
const color = (v: unknown, fallback: string) => typeof v === 'string' && /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(v) ? v : fallback;
const number = (v: unknown, fallback: number, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
export function normalizeAnchoredVwapOptions(value?: unknown): AnchoredVwapOptions {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<AnchoredVwapOptions>;
  return { source: VWAP_SOURCES.includes(v.source!) ? v.source! : 'hlc3', bandMode: v.bandMode === 'percentage' ? 'percentage' : 'standard-deviation',
    multiplier: number(v.multiplier, 1, 0, 100), showBands: v.showBands !== false, bandColor: color(v.bandColor, VWAP_DEFAULTS.bandColor), fillOpacity: number(v.fillOpacity, .05, 0, 1) };
}
export function normalizeFixedVolumeOptions(value?: unknown): FixedVolumeOptions {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<FixedVolumeOptions>;
  return { rows: Math.round(number(v.rows, 24, 1, 500)), rowLayout: v.rowLayout === 'ticks' ? 'ticks' : 'number', ticksPerRow: Math.round(number(v.ticksPerRow, 1, 1, 1e9)), widthPercent: number(v.widthPercent, 30, 1, 100), valueArea: number(v.valueArea, 70, 0, 100),
    upColor: color(v.upColor, FIXED_VOLUME_DEFAULTS.upColor), downColor: color(v.downColor, FIXED_VOLUME_DEFAULTS.downColor), backgroundColor: color(v.backgroundColor, FIXED_VOLUME_DEFAULTS.backgroundColor),
    backgroundOpacity: number(v.backgroundOpacity, .15, 0, 1), showPoc: v.showPoc !== false };
}
export function isVolumeProfile(tool: string) { return tool === 'fixed-range-volume' || tool === 'anchored-volume-profile'; }
export function isVolumeDrawing(tool: string) { return tool === 'anchored-vwap' || isVolumeProfile(tool); }
export function volumeProfilePoints(drawing: TradingDrawingModel, candles: readonly DrawingCandle[]) {
  return drawing.tool === 'anchored-volume-profile' && drawing.points.length && candles.length
    ? [drawing.points[0], { time: candles[candles.length - 1].time, price: candles[candles.length - 1].close }] : drawing.points;
}

// Select a real bar, including at the right edge; never extrapolate into future whitespace.
export function volumeBarIndex(candles: readonly DrawingCandle[], time: number) {
  if (!candles.length || !Number.isFinite(time)) return -1;
  let lo = 0, hi = candles.length - 1;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (candles[mid].time < time) lo = mid + 1; else hi = mid; }
  return lo > 0 && time - candles[lo - 1].time < candles[lo].time - time ? lo - 1 : lo;
}
export function vwapSourcePrice(c: DrawingCandle, source: AnchoredVwapOptions['source'] = 'hlc3') {
  return source === 'hlc3' ? (c.high + c.low + c.close) / 3 : source === 'hl2' ? (c.high + c.low) / 2
    : source === 'ohlc4' ? (c.open + c.high + c.low + c.close) / 4 : c[source];
}
export interface VwapValue extends TradingDrawingPoint { deviation: number; upper: number; lower: number }
export function calculateAnchoredVwap(candles: readonly DrawingCandle[], start: number, value?: unknown): VwapValue[] {
  const options = normalizeAnchoredVwapOptions(value), result: VwapValue[] = [];
  let weight = 0, mean = 0, m2 = 0;
  for (const candle of candles) {
    if (!Number.isFinite(candle.time) || candle.time < start) continue;
    const price = vwapSourcePrice(candle, options.source), volume = candle.volume;
    if (!Number.isFinite(price)) continue;
    if (typeof volume === 'number' && Number.isFinite(volume) && volume > 0) {
      // Weighted Welford avoids cancellation for large prices with tiny variance.
      const nextWeight = weight + volume, delta = price - mean;
      mean += delta * volume / nextWeight;
      m2 += volume * delta * (price - mean);
      weight = nextWeight;
    }
    if (!weight) continue;
    const deviation = Math.sqrt(Math.max(0, m2 / weight));
    const width = options.multiplier * (options.bandMode === 'percentage' ? Math.abs(mean) / 100 : deviation);
    result.push({ time: candle.time, price: mean, deviation, upper: mean + width, lower: mean - width });
  }
  return result;
}
export function volumeDrawingAnchors(drawing: TradingDrawingModel, candles: readonly DrawingCandle[], resolved?: ReturnType<typeof calculateFixedVolume>): TradingDrawingPoint[] {
  if (!drawing.points.length) return [];
  if (drawing.tool === 'anchored-vwap') {
    const index = volumeBarIndex(candles, drawing.points[0].time);
    if (index < 0) return drawing.points;
    const price = vwapSourcePrice(candles[index], normalizeAnchoredVwapOptions(drawing.vwap).source);
    return [{ time: candles[index].time, price: Number.isFinite(price) ? price : drawing.points[0].price }];
  }
  if (drawing.tool === 'anchored-volume-profile') {
    const profile = resolved ?? calculateFixedVolume(candles, volumeProfilePoints(drawing, candles), drawing.volumeProfile);
    return profile ? [{ time: profile.startTime, price: profile.total > 0 ? profile.poc : profile.low }] : drawing.points;
  }
  const range = fixedVolumeRange(candles, drawing.points);
  if (!range) return drawing.points;
  return drawing.points.slice(0, 2).map((p, i) => ({ time: candles[volumeBarIndex(candles, p.time)].time,
    price: i === (drawing.points[0].time <= drawing.points[1].time ? 0 : 1) ? range.high : range.low }));
}
export function fixedVolumeRange(candles: readonly DrawingCandle[], points: readonly TradingDrawingPoint[]) {
  if (points.length < 2) return null;
  const indices = points.map(p => volumeBarIndex(candles, p.time));
  if (indices.some(i => i < 0)) return null;
  const start = Math.min(...indices), end = Math.max(...indices);
  let low = Infinity, high = -Infinity;
  for (let i = start; i <= end; i++) if (Number.isFinite(candles[i].low) && Number.isFinite(candles[i].high) && candles[i].high >= candles[i].low) {
    low = Math.min(low, candles[i].low); high = Math.max(high, candles[i].high);
  }
  return Number.isFinite(low) && Number.isFinite(high) ? { start, end, low, high, startTime: candles[start].time, endTime: candles[end].time } : null;
}

export interface VolumeCalculationInput {
  candles?: readonly DrawingCandle[];
  tickSize?: number;
  sourceLabel?: string;
}
export function volumeRowLayout(low: number, high: number, value?: unknown, tickSize = 0) {
  const options = normalizeFixedVolumeOptions(value);
  if (high === low) return { low, high, step: tickSize > 0 ? tickSize : Math.max(1, Math.abs(low)) * 1e-9, count: 1 };
  if (!(tickSize > 0) || !Number.isFinite(tickSize)) return { low, high, step: (high - low) / options.rows, count: options.rows };
  const bottom = Math.floor(low / tickSize + 1e-7), top = Math.ceil(high / tickSize - 1e-7), ticks = Math.max(1, top - bottom);
  const exact = ticks / options.rows, floor = Math.max(1, Math.floor(exact)), ceil = Math.max(1, Math.ceil(exact));
  let perRow = options.rowLayout === 'ticks' ? options.ticksPerRow
    : Math.abs(Math.ceil(ticks / floor) - options.rows) <= Math.abs(Math.ceil(ticks / ceil) - options.rows) ? floor : ceil;
  // Bound SVG work for tiny tick settings on very large price spans.
  perRow = Math.max(perRow, Math.ceil(ticks / 5000));
  return { low: bottom * tickSize, high: top * tickSize, step: perRow * tickSize, count: Math.ceil(ticks / perRow) };
}

// Allocate the selected, reconciled lower-timeframe bars into tick-aligned rows.
// Price overlap conserves volume; this is not a substitute for trade-by-trade data.
export function calculateFixedVolume(candles: readonly DrawingCandle[], points: readonly TradingDrawingPoint[], value?: unknown, input: VolumeCalculationInput = {}) {
  const range = fixedVolumeRange(candles, points);
  if (!range) return null;
  const options = normalizeFixedVolumeOptions(value);
  const layout = volumeRowLayout(range.low, range.high, options, input.tickSize);
  const { step } = layout;
  const bins = Array.from({ length: layout.count }, (_, i) => ({ low: layout.low + i * step, high: range.low === range.high ? layout.low + step : Math.min(layout.high, layout.low + (i + 1) * step), up: 0, down: 0, volume: 0, inValueArea: false }));
  let total = 0;
  for (const c of input.candles ?? candles.slice(range.start, range.end + 1)) {
    const volume = c.volume;
    if (!Number.isFinite(c.low) || !Number.isFinite(c.high) || c.high < c.low || typeof volume !== 'number' || !Number.isFinite(volume) || volume <= 0) continue;
    total += volume;
    const first = Math.max(0, Math.min(bins.length - 1, Math.floor((c.low - layout.low) / step + 1e-9)));
    const last = Math.max(first, Math.min(bins.length - 1, Math.ceil((c.high - layout.low) / step - 1e-9) - 1));
    for (let j = first; j <= last; j++) {
      const bin = bins[j], share = c.high === c.low ? volume : volume * Math.max(0, Math.min(bin.high, c.high) - Math.max(bin.low, c.low)) / (c.high - c.low);
      bin.volume += share;
      const up = range.start === range.end ? c.close > c.open : c.close >= c.open;
      if (up) bin.up += share; else bin.down += share;
    }
  }
  const maxVolume = Math.max(...bins.map(b => b.volume));
  const pocIndex = bins.findIndex(b => b.volume === maxVolume);
  let left = pocIndex, right = pocIndex, areaVolume = bins[pocIndex].volume;
  bins[pocIndex].inValueArea = total > 0;
  while (areaVolume < total * options.valueArea / 100 && (left > 0 || right < bins.length - 1)) {
    const below = left > 0 ? bins[left - 1].volume : -1, above = right < bins.length - 1 ? bins[right + 1].volume : -1;
    // Match TradingView's published VA expansion: prefer the closer row on a
    // volume tie (then the upper row), and stop before exceeding the target.
    const takeAbove = above > below || above === below && right + 1 - pocIndex <= pocIndex - left + 1;
    const next = takeAbove ? right + 1 : left - 1;
    if (areaVolume + bins[next].volume > total * options.valueArea / 100 + total * 1e-12) break;
    if (takeAbove) right = next; else left = next;
    bins[next].inValueArea = true; areaVolume += bins[next].volume;
  }
  return { ...range, options, bins, total, maxVolume, poc: range.low === range.high ? range.low : (bins[pocIndex].high + bins[pocIndex].low) / 2,
    vah: bins[right].high, val: bins[left].low, sourceLabel: input.sourceLabel ?? '', tickSize: input.tickSize ?? 0 };
}

const xy = (p: ScreenPoint) => `${p.x},${p.y}`;
const circle = (p: ScreenPoint, anchor?: number) => `<circle class="trading-drawing-handle" data-volume-handle ${anchor === undefined ? 'data-vwap-selection-point style="stroke:#2962ff;pointer-events:none"' : `data-drawing-handle-index="${anchor}" style="stroke:#2962ff"`} cx="${p.x}" cy="${p.y}" r="${anchor === undefined ? 4 : 6}" fill="var(--trading-market-panel)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
export function renderAnchoredVwap(drawing: TradingDrawingModel, candles: readonly DrawingCandle[], project: (p: TradingDrawingPoint) => ScreenPoint | null, selected: boolean, bounds: { width: number; height: number }) {
  const options = normalizeAnchoredVwapOptions(drawing.vwap), values = calculateAnchoredVwap(candles, drawing.points[0].time, options);
  const rows = values.map(v => ({ base: project(v), upper: project({ time: v.time, price: v.upper }), lower: project({ time: v.time, price: v.lower }) }))
    .filter((r): r is { base: ScreenPoint; upper: ScreenPoint; lower: ScreenPoint } => !!r.base && !!r.upper && !!r.lower);
  let body = '', hit = '', handles = '';
  const anchor = project(volumeDrawingAnchors(drawing, candles)[0]);
  if (selected && anchor) handles = circle(anchor, 0);
  if (!rows.length) return { body: anchor ? `<text x="${anchor.x + 10}" y="${anchor.y}" fill="var(--text-secondary)" font-size="12">暂无成交量数据</text>` : '', hit: anchor ? `<circle class="trading-drawing-hit-target" cx="${anchor.x}" cy="${anchor.y}" r="7"/>` : '', handles };
  const path = (part: 'base' | 'upper' | 'lower') => `M${rows.map(r => xy(r[part])).join(' L')}`;
  if (options.showBands) body += `<path data-vwap-fill d="${path('upper')} L${[...rows].reverse().map(r => xy(r.lower)).join(' L')} Z" fill="${options.bandColor}" fill-opacity="${options.fillOpacity}" stroke="none"/>`;
  for (const part of options.showBands ? ['upper', 'lower', 'base'] as const : ['base'] as const) {
    const d = path(part), ink = part === 'base' ? drawing.color ?? '#1e88e5' : options.bandColor;
    body += `<path data-vwap-line="${part}" d="${d}" fill="none" stroke="${ink}" stroke-width="${drawing.lineWidth ?? 1}" stroke-dasharray="${drawing.lineStyle === 'dashed' ? '7 5' : drawing.lineStyle === 'dotted' ? '2 4' : ''}" vector-effect="non-scaling-stroke"/>`;
    hit += `<path class="trading-drawing-hit-target" d="${d}"/>`;
  }
  if (selected && rows.length > 3) {
    const visible = rows.filter(r => r.base.x >= 0 && r.base.x <= bounds.width);
    for (const index of new Set([Math.floor((visible.length - 1) * .27), Math.floor((visible.length - 1) * .78)])) {
      const row = visible[index]; if (!row) continue;
      for (const p of options.showBands ? [row.base, row.upper, row.lower] : [row.base]) if (p.y >= 0 && p.y <= bounds.height) handles += circle(p);
    }
  }
  return { body, hit, handles };
}

export function renderFixedVolume(drawing: TradingDrawingModel, candles: readonly DrawingCandle[], project: (p: TradingDrawingPoint) => ScreenPoint | null, selected: boolean, preview: boolean, bounds: { width: number; height: number }, resolved?: ReturnType<typeof calculateFixedVolume>) {
  const anchored = drawing.tool === 'anchored-volume-profile';
  const anchors = (preview ? drawing.points : volumeDrawingAnchors(drawing, candles, resolved)).map(project);
  const a = anchors[0], b = anchors[1] ?? a;
  if (!a || !b) return { body: '', hit: '', handles: '' };
  let handles = selected ? circle(a, 0) + (drawing.points.length > 1 ? circle(b, 1) : '') : '';
  if (preview) return { body: `<g data-volume-preview stroke="#787b86" stroke-width="1" fill="none"><path d="M${a.x},0 V${bounds.height}${anchored ? '' : ` M${b.x},0 V${bounds.height} M${xy(a)} L${xy(b)}`}"/></g>`, hit: '', handles };
  const profile = resolved ?? calculateFixedVolume(candles, volumeProfilePoints(drawing, candles), drawing.volumeProfile);
  if (!profile) return { body: '', hit: '', handles };
  const { options } = profile;
  const start = project({ time: profile.startTime, price: profile.high }), end = project({ time: profile.endTime, price: profile.low });
  if (!start || !end) return { body: '', hit: '', handles };
  const left = Math.min(start.x, end.x), right = Math.max(start.x, end.x), top = Math.min(start.y, end.y), bottom = Math.max(start.y, end.y);
  const width = Math.max(1, right - left), height = Math.max(1, bottom - top);
  const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  let body = `<title>${escape(profile.sourceLabel)}</title><rect data-volume-background x="${left}" y="${top}" width="${width}" height="${height}" fill="${options.backgroundColor}" fill-opacity="${options.backgroundOpacity}"/>`;
  let hit = `<rect class="trading-drawing-hit-target" x="${left}" y="${top}" width="${width}" height="${height}" fill="none"/>`;
  if (!profile.total) return { body: body + `<text x="${left + 10}" y="${top + 20}" fill="var(--text-secondary)" font-size="12">暂无成交量数据</text>`, hit, handles };
  for (const bin of profile.bins) {
    const p = project({ time: profile.startTime, price: bin.high }), q = project({ time: profile.startTime, price: bin.low });
    if (!p || !q) continue;
    const y = Math.min(p.y, q.y), h = Math.max(.5, Math.abs(q.y - p.y) - .5), scale = (anchored ? bounds.width : width) * options.widthPercent / 100 / profile.maxVolume;
    const up = bin.up * scale, down = bin.down * scale, opacity = bin.inValueArea ? .75 : .4;
    const upX = anchored ? bounds.width - up : left, downX = anchored ? bounds.width - up - down : left + up;
    body += `<g data-volume-row fill-opacity="${opacity}"><rect x="${upX}" y="${y}" width="${up}" height="${h}" fill="${options.upColor}"/><rect x="${downX}" y="${y}" width="${down}" height="${h}" fill="${options.downColor}"/></g>`;
    hit += `<rect class="trading-drawing-hit-target area" x="${Math.min(upX, downX)}" y="${y}" width="${up + down}" height="${h}"/>`;
  }
  const poc = project({ time: profile.startTime, price: profile.poc });
  if (poc && options.showPoc) {
    body += `<line data-volume-poc x1="${anchored ? 0 : left}" y1="${poc.y}" x2="${anchored ? bounds.width : right}" y2="${poc.y}" stroke="var(--text-primary, #131722)" stroke-width="2"/>`;
    hit += `<line class="trading-drawing-hit-target" x1="${anchored ? 0 : left}" y1="${poc.y}" x2="${anchored ? bounds.width : right}" y2="${poc.y}"/>`;
  }
  return { body, hit, handles };
}
