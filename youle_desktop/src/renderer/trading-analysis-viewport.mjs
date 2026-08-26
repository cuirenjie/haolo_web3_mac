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

/**
 * Builds a readable post-analysis viewport from the annotations that were
 * actually drawn. The range deliberately favours the latest part of a
 * very large patch: showing every historical candle again would make the
 * annotations unreadable, which is the problem this focus step is solving.
 */
export function tradingAnalysisDrawingFocusRange(patch, candles, plotWidth) {
  if (!Array.isArray(candles) || candles.length < 2 || !Array.isArray(patch?.operations)) return null;
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
