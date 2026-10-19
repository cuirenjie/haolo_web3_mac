import type { TradingDrawingModel, TradingDrawingPoint, ScreenPoint } from './trading-expert-drawing.ts';
import type { DrawingCandle } from './trading-drawing-extra-tools.ts';

export const isPositionDrawing = (tool: string) => tool === 'long-position' || tool === 'short-position';
export const isPredictionDrawing = (tool: string) => isPositionDrawing(tool) || ['forecast','bars-pattern','ghost-feed','sector'].includes(tool);
export const predictionLineDash = (style?: string) => style === 'dashed' ? ' stroke-dasharray="6 4"' : style === 'dotted' ? ' stroke-dasharray="2 3"' : '';
export interface PositionOptions {
  accountSize: number; risk: number; riskMode: 'percent' | 'amount'; leverage: number;
  lotSize: number; pointValue: number; tickSize: number; quantityPrecision: number;
  profitColor: string; lossColor: string; fillOpacity: number; alwaysShowStats: boolean;
}
export function normalizePositionOptions(value?: Partial<PositionOptions>): PositionOptions {
  const number = (v: unknown, fallback: number, min: number, max = 1e12) => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
  const color = (v: unknown, fallback: string) => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v) ? v : fallback;
  return {
    accountSize: number(value?.accountSize, 1000, .01), risk: number(value?.risk, 25, 0), riskMode: value?.riskMode === 'amount' ? 'amount' : 'percent',
    // Zero means risk sizing without a leverage cap (the supplied reference).
    leverage: number(value?.leverage, 0, 0, 10000), lotSize: number(value?.lotSize, 1, 1e-8), pointValue: number(value?.pointValue, 1, 1e-8),
    tickSize: number(value?.tickSize, .01, 1e-8), quantityPrecision: Math.round(number(value?.quantityPrecision, 3, 0, 8)),
    profitColor: color(value?.profitColor, '#089981'), lossColor: color(value?.lossColor, '#f23645'),
    fillOpacity: number(value?.fillOpacity, .2, 0, 1), alwaysShowStats: value?.alwaysShowStats === true,
  };
}

// Four persisted anchors: entry/start, entry/end, target/start, stop/start.
// Two-point legacy records and placement previews receive symmetric risk.
export function positionAnchors(drawing: Pick<TradingDrawingModel, 'tool' | 'points' | 'position'>): TradingDrawingPoint[] {
  const [a, b = a, target, stop] = drawing.points;
  if (!a) return [];
  const tick = normalizePositionOptions(drawing.position).tickSize;
  const direction = drawing.tool === 'short-position' ? -1 : 1;
  const chosenSpan = Math.abs(b.price - a.price);
  const span = Math.max(chosenSpan >= tick ? chosenSpan : Math.abs(a.price) * .04, tick);
  const start = Math.min(a.time, b.time), end = Math.max(a.time, b.time);
  return [{ time: start, price: a.price }, { time: end, price: a.price },
    { time: start, price: target ? a.price + direction * Math.max(tick, direction * (target.price - a.price)) : a.price + direction * span },
    { time: start, price: stop ? a.price - direction * Math.max(tick, direction * (a.price - stop.price)) : a.price - direction * span }];
}

export function movePositionAnchor(drawing: Pick<TradingDrawingModel, 'tool' | 'points' | 'position'>, index: number, point: TradingDrawingPoint) {
  const p = positionAnchors(drawing), tick = normalizePositionOptions(drawing.position).tickSize;
  if (p.length < 4 || index < 0 || index > 3) return p;
  const sign = drawing.tool === 'short-position' ? -1 : 1;
  const price = Math.round(point.price / tick) * tick;
  if (index === 1) p[1].time = Math.max(p[0].time + 1, point.time);
  else for (const i of [0, 2, 3]) p[i].time = Math.min(point.time, p[1].time - 1);
  if (index <= 1) {
    const low = Math.min(p[2].price, p[3].price) + tick, high = Math.max(p[2].price, p[3].price) - tick;
    p[0].price = p[1].price = Math.max(low, Math.min(high, price));
  } else if (index === 2) p[2].price = p[0].price + sign * Math.max(tick, sign * (price - p[0].price));
  else p[3].price = p[0].price - sign * Math.max(tick, sign * (p[0].price - price));
  return p;
}

export function positionStatistics(drawing: Pick<TradingDrawingModel, 'tool' | 'points' | 'position'>, candles: readonly DrawingCandle[]) {
  const [a, b, target, stop] = positionAnchors(drawing), options = normalizePositionOptions(drawing.position);
  const sign = drawing.tool === 'short-position' ? -1 : 1;
  const reward = sign * (target.price - a.price), risk = sign * (a.price - stop.price);
  const budget = options.riskMode === 'percent' ? options.accountSize * options.risk / 100 : options.risk;
  const multiplier = options.pointValue * options.lotSize;
  const quantityRisk = budget / (risk * multiplier);
  const quantityLeverage = options.leverage > 0 && a.price > 0 ? options.accountSize * options.leverage / a.price * options.pointValue / options.lotSize : Infinity;
  const quantity = Math.min(quantityRisk, quantityLeverage);
  let entered = false, closed = false, ambiguous = false, entryTime: number | null = null, exitTime: number | null = null;
  let last = candles.at(-1)?.close ?? a.price;
  for (const bar of candles) {
    if (bar.time <= b.time) last = bar.close;
    if (bar.time < a.time || bar.time > b.time || closed) continue;
    if (!entered && bar.low <= a.price && bar.high >= a.price) { entered = true; entryTime = bar.time; }
    if (!entered) continue;
    const take = sign > 0 ? bar.high >= target.price : bar.low <= target.price;
    const loss = sign > 0 ? bar.low <= stop.price : bar.high >= stop.price;
    // OHLC cannot resolve intrabar order. A bar touching both is conservatively
    // a stop; surface this fact in the tag's tooltip instead of implying ticks.
    if (take || loss) { closed = true; ambiguous = take && loss; exitTime = bar.time; last = loss ? stop.price : target.price; break; }
  }
  return { options, reward, risk, quantity, ratio: reward / risk, targetAmount: options.accountSize + reward * quantity * multiplier,
    stopAmount: options.accountSize - risk * quantity * multiplier, pnl: sign * (last - a.price), entered, closed, ambiguous, entryTime, exitTime, exitPrice: last };
}

const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
export const positionNumber = (value: number, precision = 2, grouping = false) => Number.isFinite(value)
  ? value.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision, useGrouping: grouping }) : '—';
const trimNumber = (n: number, precision = 2) => Number(n.toFixed(precision)).toString();
const textWidth = (s: string, size: number) => [...s].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 1 : .58) * size, 0);
export function predictionTag(lines: string[], center: number, y: number, color: string, bounds: { width: number; height: number }, size = 12, whiteBorder = false, name = '', textColor = '#ffffff') {
  const width = Math.max(...lines.map(s => textWidth(s, size))) + 12, height = lines.length * (size + 2) + 7;
  const x = Math.max(2, Math.min(bounds.width - width - 2, center - width / 2)), top = Math.max(2, Math.min(bounds.height - height - 2, y));
  return { x, y: top, width, height, html: `<g data-prediction-tag="${name}"><rect x="${x}" y="${top}" width="${width}" height="${height}" rx="4" fill="${color}"${whiteBorder ? ' stroke="#fff" stroke-width="1.5"' : ''}/>`
    + lines.map((s, i) => `<text x="${x + width / 2}" y="${top + 4 + size + i * (size + 2)}" text-anchor="middle" fill="${textColor}" font-size="${size}" font-weight="600">${escape(s)}</text>`).join('') + '</g>' };
}

export function renderPositionDrawing(drawing: TradingDrawingModel, project: (p: TradingDrawingPoint) => ScreenPoint | null,
  candles: readonly DrawingCandle[], bounds: { width: number; height: number }, selected: boolean, draft: boolean, t: (s: string) => string = s => s) {
  const anchors = positionAnchors(drawing), points = anchors.map(project);
  if (points.length < 4 || points.some(p => !p)) return { body: '', hit: '', handles: '' };
  const [a, b, target, stop] = points as ScreenPoint[], s = positionStatistics(drawing, candles), o = s.options;
  const left = Math.min(a.x, b.x), width = Math.max(1, Math.abs(b.x - a.x)), center = left + width / 2;
  const region = (p: ScreenPoint, color: string, name: string) => `<rect data-position-region="${name}" x="${left}" y="${Math.min(a.y, p.y)}" width="${width}" height="${Math.max(1, Math.abs(a.y - p.y))}" fill="${color}" fill-opacity="${o.fillOpacity}"/>`
    + `<line x1="${left}" x2="${left + width}" y1="${p.y}" y2="${p.y}" stroke="${color}" stroke-opacity=".4" stroke-width=".5"/>`;
  let body = region(target, o.profitColor, 'target') + region(stop, o.lossColor, 'stop')
    + `<line data-position-entry x1="${left}" x2="${left + width}" y1="${a.y}" y2="${a.y}" stroke="${drawing.color ?? '#787b86'}" stroke-width="${drawing.lineWidth ?? 1}"${predictionLineDash(drawing.lineStyle)}/>`;
  if (s.entryTime !== null) {
    const start = project({ time: s.entryTime, price: anchors[0].price }), end = project({ time: s.exitTime ?? anchors[1].time, price: s.exitPrice });
    if (start && end) body += `<path data-position-trade-path d="M${start.x},${start.y} L${end.x},${end.y}" fill="none" stroke="#787b86" stroke-width="1" stroke-dasharray="4 4"/>`;
  }
  let hit = `<rect class="trading-drawing-hit-target closed" x="${left}" y="${Math.min(target.y, stop.y)}" width="${width}" height="${Math.abs(target.y - stop.y)}" fill="transparent" style="pointer-events:all"/>`;
  if (selected || draft || o.alwaysShowStats) {
    const size = drawing.fontSize ?? 12;
    const level = (name: string, offset: number, amount: number) => `${t(name)}: ${positionNumber(offset)} (${positionNumber(offset / Math.abs(anchors[0].price || 1) * 100, 3)}%) ${Math.round(offset / o.tickSize).toLocaleString('en-US')}, ${t('金额')}: ${trimNumber(amount)}`;
    const tag = (lines: string[], y: number, color: string, name: string, border = false) => {
      const label = predictionTag(lines, center, y, color, bounds, size, border, name, drawing.textColor ?? '#fff'); body += label.html;
      hit += `<rect class="trading-drawing-hit-target closed" x="${label.x}" y="${label.y}" width="${label.width}" height="${label.height}" fill="transparent" style="pointer-events:all"/>`;
    };
    tag([level('目标', s.reward, s.targetAmount)], target.y < a.y ? target.y - size - 23 : target.y + 14, o.profitColor, 'target');
    tag([level('止损', s.risk, s.stopAmount)], stop.y < a.y ? stop.y - size - 23 : stop.y + 14, o.lossColor, 'stop');
    tag([`${t(s.closed ? '已平仓' : '开仓')} PnL: ${positionNumber(s.pnl)}, ${t('数量')}: ${trimNumber(s.quantity, o.quantityPrecision)}`,
      `${t('风险/回报比')}: ${trimNumber(s.ratio)}`], a.y + 14, s.pnl >= 0 ? o.profitColor : o.lossColor, 'pnl', true);
    if (s.ambiguous) body += `<title>${t('同根 K 线同时触及止盈止损，按止损计算')}</title>`;
  }
  const handles = selected || draft ? (points as ScreenPoint[]).map((p, i) => {
    const attrs = `class="trading-drawing-handle" data-position-handle="${i}" data-drawing-handle-index="${i}" fill="var(--trading-market-panel)" style="stroke:#2962ff;cursor:move" stroke-width="1.5"`;
    return i === 0 ? `<circle ${attrs} cx="${p.x}" cy="${p.y}" r="6"/>` : `<rect ${attrs} x="${p.x - 6}" y="${p.y - 6}" width="12" height="12" rx="3"/>`;
  }).join('') : '';
  return { body, hit, handles };
}

export function forecastStatistics(points: readonly TradingDrawingPoint[], candles: readonly DrawingCandle[]) {
  const [a, b = a] = points, difference = b.price - a.price;
  // Evaluate the target candle, never earlier bars below/above an unfilled
  // source price. Future forecasts remain pending until their target bar.
  const bar = candles.find(c => c.time >= b.time);
  const status = !bar || b.time <= a.time ? 'pending' : (difference >= 0 ? bar.high >= b.price : bar.low <= b.price) ? 'success' : 'failure';
  return { difference, percent: a.price ? difference / Math.abs(a.price) * 100 : 0, seconds: Math.abs(b.time - a.time), status };
}

export function renderForecastDrawing(drawing: TradingDrawingModel, points: ScreenPoint[], candles: readonly DrawingCandle[], bounds: { width: number; height: number }, selected: boolean, draft: boolean, timeOffset: number, t: (s: string) => string = s => s) {
  if (!points.length || !drawing.points.length) return {body:'',hit:'',handles:''};
  const [a, b = a] = points, s = forecastStatistics(drawing.points, candles), color = drawing.color ?? '#2962ff', size = drawing.fontSize ?? 12;
  const up = b.y < a.y, direction = up ? -1 : 1;
  const path = `M${a.x},${a.y} C${a.x + (b.x - a.x) * .55},${a.y} ${b.x},${a.y + (b.y - a.y) * .25} ${b.x},${b.y}`;
  const date = (time: number) => new Date((time + timeOffset) * 1000).toISOString().slice(0, s.seconds < 86400 ? 16 : 10).replace('T', ' ');
  const duration = s.seconds >= 86400 ? `${trimNumber(s.seconds / 86400)}${t('天')}` : s.seconds >= 3600 ? `${trimNumber(s.seconds / 3600)}${t('小时')}` : `${trimNumber(s.seconds / 60)}${t('分钟')}`;
  const sign = s.difference < 0 ? '−' : '';
  const source = predictionTag([positionNumber(drawing.points[0].price, 2, true), date(drawing.points[0].time)], a.x + 10, up ? a.y + 12 : a.y - size * 2 - 25, color, bounds, size, false, 'source', drawing.textColor ?? '#fff');
  const resultVisible = !draft && s.status !== 'pending';
  const targetY = up ? Math.max(resultVisible ? 24 : 2, b.y - size * 2 - 25)
    : Math.min(b.y + 12, bounds.height - (2 * (size + 2) + 7) - (resultVisible ? 23 : 2));
  const target = predictionTag([`${sign}${positionNumber(Math.abs(s.difference))} (${sign}${positionNumber(Math.abs(s.percent))}%) ${t('在')} ${duration}`,
    `${positionNumber(drawing.points[1]?.price ?? drawing.points[0].price, 2, true)} ◷ ${date(drawing.points[1]?.time ?? drawing.points[0].time)}`], b.x + 70, targetY, color, bounds, size, false, 'forecast', drawing.textColor ?? '#fff');
  const callout = (label: typeof source, anchor: ScreenPoint) => {
    const below = anchor.y >= label.y + label.height;
    if (!below && anchor.y > label.y) return '';
    const x = Math.max(label.x + 8, Math.min(label.x + label.width - 8, anchor.x));
    const y = below ? label.y + label.height : label.y;
    return `<path d="M${x - 6},${y} L${x},${y + (below ? 7 : -7)} L${x + 6},${y} Z" fill="${color}"/>`;
  };
  const triangle = `M${b.x},${b.y} l-4,${-direction * 9} h8 Z`;
  let body = `<path data-forecast-curve d="${path}" fill="none" stroke="${color}" stroke-width="${drawing.lineWidth ?? 2}"${predictionLineDash(drawing.lineStyle)}/>`
    + `<path d="${triangle}" fill="${color}"/>` + source.html + callout(source, a) + target.html + callout(target, b);
  if (resultVisible) {
    const y = up ? target.y - 21 : target.y + target.height + 2;
    body += `<g data-forecast-result="${s.status}"><rect x="${target.x}" y="${y}" width="${target.width}" height="19" rx="4" fill="${s.status === 'success' ? '#58b85b' : '#f23645'}"/><text x="${target.x + target.width / 2}" y="${y + 14}" text-anchor="middle" font-size="12" font-weight="600" fill="#fff">${s.status === 'success' ? '✓ ' + t('成功') : '× ' + t('失败')}</text></g>`;
  }
  const hit = `<path class="trading-drawing-hit-target" d="${path}" fill="none"/>` + [source, target].map(r => `<rect class="trading-drawing-hit-target closed" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="transparent" style="pointer-events:all"/>`).join('');
  const handles = [a, b].map((p, i) => selected || draft ? `<circle class="trading-drawing-handle" data-position-handle="${i}" data-drawing-handle-index="${i}" cx="${p.x}" cy="${p.y}" r="6" fill="var(--trading-market-panel)" style="stroke:#2962ff;cursor:move" stroke-width="1.5"/>`
    : `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#292929"/>`).join('');
  return { body, hit, handles };
}
