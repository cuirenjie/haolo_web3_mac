import type { ScreenPoint, TradingDrawingModel, TradingDrawingPoint } from './trading-expert-drawing.ts';
import { FIB_LEVEL_DEFAULTS, fibonacciGeometry, normalizeFibonacciOptions, renderFibonacci, type FibonacciLabelPosition } from './trading-fibonacci.ts';

type Rect = { x: number; y: number; width: number; height: number };
type Level = { drawing: TradingDrawingModel; ratio: number; group: string };
type DisplayDrawing = TradingDrawingModel & { aiFibLevelPrices?: ReadonlyMap<number, number> };

function legacyLevel(drawing: TradingDrawingModel): Level | null {
  if (drawing.source !== 'ai' || drawing.planLevel || !['path', 'trend-line'].includes(drawing.tool)
    || drawing.points.length !== 2) return null;
  const match = /^(.*)-fib-(-?\d+(?:\.\d+)?)$/.exec(drawing.id);
  const [a, b] = drawing.points;
  if (!match || ![a.time, b.time, a.price, b.price].every(Number.isFinite) || a.price !== b.price) return null;
  const ratio = Number(match[2]);
  return Math.abs(ratio) <= 1000 ? { drawing, ratio, group: match[1] } : null;
}

/** Presentation only: never replace the accepted patch or persisted history. */
export function projectAiFibonacciDrawings(drawings: readonly TradingDrawingModel[]) {
  const groups = new Map<string, Level[]>();
  for (const drawing of drawings) {
    const level = legacyLevel(drawing);
    if (!level) continue;
    const key = JSON.stringify([level.group, drawing.symbol, drawing.interval,
      drawing.strategyId, drawing.points.map(p => p.time)]);
    const group = groups.get(key) ?? [];
    group.push(level); groups.set(key, group);
  }
  const replacements = new Map<string, DisplayDrawing>(), hidden = new Set<string>();
  const byId = new Map(drawings.map(drawing => [drawing.id, drawing]));
  for (const levels of groups.values()) {
    const ordered = [...levels].sort((a, b) => a.ratio - b.ratio);
    if (new Set(ordered.map(level => level.ratio)).size !== ordered.length || ordered.length > FIB_LEVEL_DEFAULTS.length) continue;
    const first = ordered[0], last = ordered.at(-1)!;
    const span = ordered.length > 1 ? (last.drawing.points[0].price - first.drawing.points[0].price) / (last.ratio - first.ratio) : 0;
    const zero = first.drawing.points[0].price - span * first.ratio;
    const tolerance = Math.max(...ordered.map(level => Math.abs(level.drawing.points[0].price)), Number.MIN_VALUE) * 1e-9;
    // Never conceal conflicting measurements or infer a different price series.
    if (![span, zero, zero + span].every(Number.isFinite) || ordered.some(level =>
      Math.abs(zero + span * level.ratio - level.drawing.points[0].price) > tolerance)) continue;
    const base = levels[0].drawing;
    const labelSizes = levels.map(({ drawing }) => byId.get(`${drawing.id}-label`)?.fontSize).filter((size): size is number => typeof size === 'number');
    const fibonacci = normalizeFibonacciOptions();
    fibonacci.trendVisible = false; // The existing wave path already shows the measurement structure.
    fibonacci.levels = fibonacci.levels.map((fallback, i) => {
      const level = ordered[i];
      return level ? { value: level.ratio, enabled: true,
        color: FIB_LEVEL_DEFAULTS.find(([ratio]) => ratio === level.ratio)?.[1] ?? fallback.color }
        : { ...fallback, enabled: false };
    });
    const display: DisplayDrawing = { ...base, tool: 'fib-retracement', color: undefined,
      lineWidth: undefined, lineStyle: undefined, text: undefined, fibonacci,
      fontSize: labelSizes.length ? Math.max(...labelSizes) + 2 : 12,
      points: [{ ...base.points[0], price: zero + span }, { ...base.points[1], price: zero }],
      aiFibLevelPrices: new Map(ordered.map(level => [level.ratio, level.drawing.points[0].price])) };
    replacements.set(base.id, display);
    for (const { drawing } of levels) {
      if (drawing.id !== base.id) hidden.add(drawing.id);
      const label = byId.get(`${drawing.id}-label`);
      if (label?.source === 'ai' && !label.planLevel && ['note', 'text'].includes(label.tool)
        && label.symbol === drawing.symbol && label.interval === drawing.interval
        && label.points.length === 1 && label.points[0].time === drawing.points[1].time
        && label.points[0].price === drawing.points[1].price) hidden.add(label.id);
    }
  }
  return { drawings: drawings.filter(drawing => !hidden.has(drawing.id)).map(drawing => replacements.get(drawing.id) ?? drawing), hidden };
}

export function nativeAiFibonacciModel(drawing: TradingDrawingModel): TradingDrawingModel {
  if (drawing.source !== 'ai' || drawing.tool !== 'fib-retracement') return drawing;
  // AI semantic colors must not override the native tool's independent level colors.
  return { ...drawing, color: undefined, lineWidth: undefined, lineStyle: undefined };
}

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.width + 4 && a.x + a.width + 4 > b.x
  && a.y < b.y + b.height + 4 && a.y + a.height + 4 > b.y;

export function renderAiFibonacci(drawing: DisplayDrawing, project: (point: TradingDrawingPoint) => ScreenPoint | null,
  bounds: { width: number; height: number }, priceToY: (price: number) => number | null,
  formatPrice: (price: number) => string, obstacles: readonly Rect[] = [], draft = false, candles: readonly Rect[] = []) {
  if (drawing.source !== 'ai' || drawing.tool !== 'fib-retracement' || drawing.points.length < 2) return null;
  const empty = { body: '', hit: '', obstacles: [] as Rect[] };
  if (bounds.width <= 32 || bounds.height <= 24) return empty;
  const exactPrices = drawing.aiFibLevelPrices;
  // Derived 0/1 anchors can be outside a logarithmic scale; project the accepted
  // level prices to obtain x coordinates without inventing visible base levels.
  const acceptedPrices = exactPrices ? [...exactPrices.values()] : [];
  const start = project({ ...drawing.points[0], price: acceptedPrices[0] ?? drawing.points[0].price });
  const end = project({ ...drawing.points.at(-1)!, price: acceptedPrices.at(-1) ?? drawing.points.at(-1)!.price });
  if (!start || !end || Math.max(start.x, end.x) < 0 || Math.min(start.x, end.x) > bounds.width) return empty;
  let left = Math.max(8, Math.min(start.x, end.x)), right = Math.min(bounds.width - 8, Math.max(start.x, end.x));
  const minWidth = Math.min(240, Math.max(160, bounds.width * .22), bounds.width - 16);
  if (!draft && right - left < minWidth) {
    // Prefer empty future space; at the right edge expand back over the plot.
    right = Math.min(bounds.width - 8, left + minWidth);
    left = Math.max(8, right - minWidth);
  }
  if (right < left) return empty;
  const first = { ...start, x: start.x <= end.x ? left : right };
  const second = { ...end, x: start.x <= end.x ? right : left };
  const model = nativeAiFibonacciModel(drawing);
  const geometry = fibonacciGeometry(model, first, second, bounds, priceToY, exactPrices);
  const levelLines = geometry.levels.map(level => ({ x: geometry.left, y: level.y - 1, width: geometry.right - geometry.left, height: 2 }));
  const labelPositions = new Map<number, FibonacciLabelPosition>();
  const occupied: Rect[] = [];
  const fontSize = Math.max(10, Math.min(18, drawing.fontSize ?? 12));
  for (const level of [...geometry.levels].sort((a, b) => a.y - b.y)) {
    if (level.y < 0 || level.y > bounds.height) continue;
    const o = geometry.options;
    const text = `${o.showLevels ? level.value : ''}${o.showPrices ? `${o.showLevels ? ' ' : ''}(${formatPrice(level.price)})` : ''}`;
    if (!text) continue;
    const width = Math.min(bounds.width - 16, text.length * fontSize * .63 + 4), height = fontSize + 4;
    const preferredX = left >= width + 16 ? left - width - 8 : left + 8;
    const candidates = [preferredX, right - width - 8, left + 8, right + 8].flatMap(x =>
      [0, -height, height, -height * 2, height * 2, -height * 3, height * 3].map(offset => ({
        x: Math.max(8, Math.min(bounds.width - width - 8, x)),
        y: Math.max(4, Math.min(bounds.height - height - 4, level.y - height / 2 + offset)), width, height,
      })));
    const score = (rect: Rect) => occupied.filter(other => overlap(rect, other)).length * 100000
      + obstacles.filter(other => overlap(rect, other)).length * 10000
      + levelLines.filter(other => overlap(rect, other)).length * 5000
      + candles.filter(other => overlap(rect, other)).length * 1000
      + Math.abs(rect.y + height / 2 - level.y) * 4 + Math.abs(rect.x - preferredX) * .1;
    const chosen = candidates.reduce((best, candidate) => score(candidate) < score(best) ? candidate : best);
    occupied.push(chosen);
    labelPositions.set(level.value, { x: chosen.x, y: chosen.y + height / 2, anchor: 'start' });
  }
  const rendered = renderFibonacci(model, first, second, bounds, priceToY, formatPrice, draft ? .72 : 1,
    { labelPositions, fontSize, prices: exactPrices });
  return { ...rendered, obstacles: occupied };
}
