const MIN_READABLE_CANDLES = 48;
const MAX_IDEAL_CANDLES = 112;
const MIN_MAXIMUM_CANDLES = 72;
const MAX_MAXIMUM_CANDLES = 220;
const IDEAL_CANDLE_WIDTH_PX = 10;
const MINIMUM_CANDLE_WIDTH_PX = 5.5;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function logicalIndexAtTime(candles, time) {
  if (!candles.length || !Number.isFinite(time)) return null;
  const lastIndex = candles.length - 1;
  const firstTime = Number(candles[0]?.time);
  const lastTime = Number(candles[lastIndex]?.time);
  if (!Number.isFinite(firstTime) || !Number.isFinite(lastTime)) return null;
  const startStep = Math.max(1, Number(candles[1]?.time) - firstTime || lastTime - firstTime || 1);
  const endStep = Math.max(1, lastTime - Number(candles[lastIndex - 1]?.time) || lastTime - firstTime || 1);
  if (time <= firstTime) return (time - firstTime) / startStep;
  if (time >= lastTime) return lastIndex + (time - lastTime) / endStep;

  let lowerIndex = 0;
  let upperIndex = lastIndex;
  while (upperIndex - lowerIndex > 1) {
    const middleIndex = Math.floor((lowerIndex + upperIndex) / 2);
    if (Number(candles[middleIndex]?.time) <= time) lowerIndex = middleIndex;
    else upperIndex = middleIndex;
  }
  const lowerTime = Number(candles[lowerIndex]?.time);
  const upperTime = Number(candles[upperIndex]?.time);
  const span = upperTime - lowerTime;
  return span > 0 ? lowerIndex + (time - lowerTime) / span : lowerIndex;
}

const planTokens = new Set(['strategy-entry', 'strategy-stop', 'strategy-target']);
const isPlanLevel = drawing => planTokens.has(drawing?.colorToken)
  && drawing.points?.length && drawing.points.every(point => point.price === drawing.points[0].price);

export const isWyckoffAnalysisDrawing = drawing => drawing?.theory === 'wyckoff'
  || drawing?.strategyId === 'wyckoff'
  // Stored native drawings retain their validated semantic token, not theory.
  || (typeof drawing?.colorToken === 'string' && drawing.colorToken.startsWith('wyckoff-'));

/** Wyckoff phases describe one complete range: never crop its earlier phases
 * just to reach the generic minimum candle width. Plan line endpoints are
 * presentation anchors, so only the actual Wyckoff structure sets the window.
 */
function wyckoffFocusRange(drawings, candles, plotWidth) {
  const indices = drawings.filter(drawing => isWyckoffAnalysisDrawing(drawing) && !isPlanLevel(drawing))
    .flatMap(drawing => (drawing.points || [])
      .map(point => logicalIndexAtTime(candles, Number(point.time)))
      .filter(index => index !== null && Number.isFinite(index)));
  if (!indices.length) return null;
  const minimumCount = clamp(Math.round((Number(plotWidth) || 0) / IDEAL_CANDLE_WIDTH_PX),
    MIN_READABLE_CANDLES, MAX_IDEAL_CANDLES);
  const start = Math.min(...indices);
  let end = Math.max(...indices);
  const last = candles.length - 1;
  if (last - end >= 0 && last - end <= minimumCount * .25) end = last;
  const span = Math.max(1, end - start + 1);
  const leftPadding = Math.max(3, Math.ceil(span * .05));
  const rightPadding = Math.max(6, Math.ceil(span * .16));
  const extra = Math.max(0, minimumCount - span - leftPadding - rightPadding);
  return { from: start - leftPadding - extra * .75, to: end + rightPadding + extra * .25 };
}

/** Fit the recent structure, not the arbitrary endpoints of full-width price lines.
 * Keep candles about 8–14px wide and reserve the right side for plan labels.
 * Price fitting then uses this same time window plus ALL plan prices.
 */
export function tradingAnalysisPlanFocusRange(drawings, candles, plotWidth) {
  if (!Array.isArray(candles) || candles.length < 2) return null;
  const wyckoffRange = wyckoffFocusRange(drawings, candles, plotWidth);
  if (wyckoffRange) return wyckoffRange;
  if (!drawings.some(isPlanLevel)) return null;
  const structure = drawings.filter(drawing => !isPlanLevel(drawing));
  const indices = (structure.length ? structure : drawings).flatMap(drawing => (drawing.points || [])
    .map(point => logicalIndexAtTime(candles, Number(point.time)))
    .filter(index => index !== null && Number.isFinite(index)));
  if (!indices.length) return null;
  const width = Math.max(1, Number(plotWidth) || 1);
  const minimumCount = clamp(Math.round(width / 14), 36, 72);
  const maximumCount = clamp(Math.round(width / 8), 48, 140);
  const last = candles.length - 1;
  let end = Math.max(...indices);
  if (last - end >= 0 && last - end <= maximumCount * .25) end = last;
  // A distant annotation must not push all real candles out of view.
  end = Math.min(end, last + maximumCount * .2);
  const start = Math.min(Math.min(...indices), end);
  const contentCount = end - start + 1;
  const count = clamp(Math.ceil(contentCount / .8) + 3, minimumCount, maximumCount);
  const rightPadding = Math.max(6, Math.ceil(count * .18));
  const to = end + rightPadding;
  // Keep enough recent candles even for a plan with a single anchor. A long
  // structure needs only three candles of context before its first anchor.
  const from = Math.max(-.5, Math.min(start - 3, end - minimumCount * .8), to - count);
  return { from, to: Math.max(to, from + minimumCount) };
}

export function tradingAnalysisVisibleTimeRange(candles, logicalRange) {
  if (!logicalRange || candles.length < 2) return null;
  const timeAt = index => {
    const lower = clamp(Math.floor(index), 0, candles.length - 2);
    return Number(candles[lower].time) + (index - lower)
      * (Number(candles[lower + 1].time) - Number(candles[lower].time));
  };
  return { from: timeAt(logicalRange.from), to: timeAt(logicalRange.to) };
}

/**
 * Builds a readable post-analysis viewport from the annotations that were
 * actually drawn. The range deliberately favours the latest part of a
 * very large patch: showing every historical candle again would make the
 * annotations unreadable, which is the problem this focus step is solving.
 */
export function tradingAnalysisDrawingFocusRange(patch, candles, plotWidth) {
  if (!Array.isArray(candles) || candles.length < 2 || !Array.isArray(patch?.operations)) return null;
  const planRange = tradingAnalysisPlanFocusRange(patch.operations.flatMap(operation => operation?.drawing ? [operation.drawing] : []), candles, plotWidth);
  if (planRange) return planRange;
  const logicalPoints = patch.operations.flatMap((operation) => {
    const points = Array.isArray(operation?.drawing?.points) ? operation.drawing.points : [];
    return points.flatMap((point) => {
      const logical = logicalIndexAtTime(candles, Number(point?.time));
      return logical === null || !Number.isFinite(logical) ? [] : [logical];
    });
  });
  if (!logicalPoints.length) return null;

  const width = Math.max(1, Number(plotWidth) || 0);
  const idealVisibleCount = clamp(
    Math.round(width / IDEAL_CANDLE_WIDTH_PX),
    MIN_READABLE_CANDLES,
    MAX_IDEAL_CANDLES,
  );
  const maximumVisibleCount = Math.max(idealVisibleCount, clamp(
    Math.round(width / MINIMUM_CANDLE_WIDTH_PX),
    MIN_MAXIMUM_CANDLES,
    MAX_MAXIMUM_CANDLES,
  ));

  let contentFrom = Math.min(...logicalPoints);
  let contentTo = Math.max(...logicalPoints);
  const lastCandleIndex = candles.length - 1;
  const latestGap = lastCandleIndex - contentTo;
  if (latestGap >= 0 && latestGap <= Math.max(6, Math.round(idealVisibleCount * 0.2))) {
    contentTo = lastCandleIndex;
  }

  const contentSpan = Math.max(1, contentTo - contentFrom + 1);
  const desiredVisibleCount = clamp(
    Math.ceil(contentSpan * 1.35),
    idealVisibleCount,
    maximumVisibleCount,
  );
  const minimumRightPadding = clamp(Math.round(desiredVisibleCount * 0.08), 5, 18);
  const availableContentSpan = Math.max(1, desiredVisibleCount - minimumRightPadding);
  if (contentSpan > availableContentSpan) {
    // Keep the newest annotations prominent when a single old anchor or a
    // long historical path would otherwise compress the whole drawing patch.
    contentFrom = contentTo - availableContentSpan + 1;
  }

  const visibleContentSpan = Math.max(1, contentTo - contentFrom + 1);
  const freeSpace = Math.max(0, desiredVisibleCount - visibleContentSpan);
  const rightPadding = Math.min(
    freeSpace,
    Math.max(minimumRightPadding, Math.round(freeSpace * 0.15)),
  );
  const leftPadding = Math.max(0, freeSpace - rightPadding);
  let from = contentFrom - leftPadding;
  let to = contentTo + rightPadding;

  if (from < -0.5) {
    to += -0.5 - from;
    from = -0.5;
  }
  return { from, to };
}

/**
 * Lets lightweight-charts apply its time/price scale changes before AI
 * playback paints the first stroke. The timeout keeps background or hidden
 * workspaces from blocking analysis when animation frames are throttled.
 */
export function waitForTradingAnalysisViewportPaint(scheduler = globalThis) {
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null && typeof scheduler.clearTimeout === "function") {
        scheduler.clearTimeout(timeoutId);
      }
      resolve();
    };
    const requestFrame = typeof scheduler.requestAnimationFrame === "function"
      ? (callback) => scheduler.requestAnimationFrame(callback)
      : null;
    if (typeof scheduler.setTimeout === "function") {
      timeoutId = scheduler.setTimeout(finish, 120);
    }
    if (!requestFrame) {
      queueMicrotask(finish);
      return;
    }
    requestFrame(() => requestFrame(finish));
  });
}
