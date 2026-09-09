import { normalizeTradingAlertInterval } from "./interval.mjs";
import crypto from "node:crypto";
import { TradingAlertEvaluator, UNKNOWN } from "./evaluator.mjs";
import { normalizeAlertRule, stableHash } from "./protocol.mjs";
import { TradingAlertError } from "./errors.mjs";

const REALISTIC_STEP_MULTIPLIERS = Object.freeze([-1.4, -1, -0.72, -0.45, -0.22, 0, 0.22, 0.45, 0.72, 1, 1.4]);
const DEFAULT_MIN_FUTURE_BARS = 6;
const CONTINUATION_MULTIPLIERS = Object.freeze([0.18, -0.12, 0.28, -0.08, 0.14, -0.2]);

function assertCandle(candle, field = "candle") {
  const numbers = [candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume];
  const validCloseTime = candle.closeTime === undefined || (Number.isFinite(candle.closeTime) && candle.closeTime > candle.time);
  if (!numbers.every(Number.isFinite) || !validCloseTime || candle.time <= 0 || candle.low <= 0 || candle.volume < 0 || candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) {
    throw new TradingAlertError(`${field} 不是合法 OHLCV`, { code: "TRADING_ALERT_SIMULATION_INVALID_CANDLE", category: "simulation" });
  }
}

function intervalMs(interval) {
  const match = normalizeTradingAlertInterval(interval).match(/^(\d+)(s|m|h|d|w)$/);
  if (!match) return 60_000;
  const multipliers = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  return Number(match[1]) * multipliers[match[2]];
}

function cloneFrames(frames) {
  return structuredClone(frames instanceof Map ? Object.fromEntries(frames) : frames);
}

function expressionHistoryWindow(expression, lookback = 0) {
  if (!expression || typeof expression !== "object") return Math.max(2, lookback + 2);
  if (expression.type === "indicator") {
    return Math.max(100, Number(expression.params?.period) || Number(expression.params?.slow) || 100) * 3 + lookback;
  }
  if (expression.type === "lag") return expressionHistoryWindow(expression.expr, lookback + Number(expression.bars || 0));
  if (expression.type === "rolling") {
    return expressionHistoryWindow(
      expression.expr,
      lookback + Number(expression.offset || 0) + Math.max(0, Number(expression.period || 1) - 1),
    );
  }
  if (Array.isArray(expression.args) && expression.args.length) {
    return Math.max(...expression.args.map((entry) => expressionHistoryWindow(entry, lookback)));
  }
  return Math.max(2, lookback + 2);
}

function simulationHistoryWindows(rule) {
  const windows = new Map(rule.contexts.map((context) => [context.contextId, 32]));
  const walk = (node) => {
    if (node?.type === "condition") {
      const condition = node.condition;
      windows.set(condition.contextId, Math.max(
        windows.get(condition.contextId) || 32,
        expressionHistoryWindow(condition.left),
        expressionHistoryWindow(condition.right),
      ));
    }
    if (node?.child) walk(node.child);
    for (const child of node?.children || node?.steps || []) walk(child);
  };
  walk(rule.root);
  return windows;
}

function simulationFramesForRule(rule, inputFrames) {
  const frames = cloneFrames(inputFrames);
  const windows = simulationHistoryWindows(rule);
  for (const context of rule.contexts) {
    const frame = frames?.[context.contextId];
    if (!Array.isArray(frame?.candles)) continue;
    const required = Math.max(2, Math.ceil(Number(windows.get(context.contextId)) || 32));
    if (frame.candles.length > required) frame.candles = frame.candles.slice(-required);
  }
  return frames;
}

function leafConditions(node, result = []) {
  if (node.type === "condition") result.push(node.condition);
  if (node.child) leafConditions(node.child, result);
  for (const child of node.children || node.steps || []) leafConditions(child, result);
  return result;
}

function targetPrices(rule, frames, futureBarOffset = 1) {
  const targets = [];
  for (const condition of leafConditions(rule.root)) {
    const context = frames[condition.contextId];
    const last = context?.candles?.at(-1);
    const constant = condition.left.type === "constant" ? condition.left.value : condition.right.type === "constant" ? condition.right.value : null;
    const fieldOnLeft = condition.left.type === "field";
    const fieldOnRight = condition.right.type === "field";
    const above = ["gt", "gte", "cross_over", "break_above"].includes(condition.operator);
    const below = ["lt", "lte", "cross_under", "break_below"].includes(condition.operator);
    const direction = (above ? 1 : below ? -1 : 0) * (fieldOnRight ? -1 : 1);
    if (Number.isFinite(constant) && (fieldOnLeft || fieldOnRight)) {
      targets.push({ contextId: condition.contextId, price: constant, direction });
    }
    const drawingExpr = condition.left.type === "drawing" ? condition.left : condition.right.type === "drawing" ? condition.right : null;
    if (drawingExpr) {
      const drawing = context?.drawings?.[drawingExpr.drawingId];
      const points = drawing?.points;
      if (points?.length >= 2 && last) {
        const stepMs = intervalMs(context.interval);
        const firstFutureOpenTime = Number(last.closeTime ?? (last.time + stepMs));
        const targetTime = firstFutureOpenTime + stepMs * Math.max(0, futureBarOffset - 1);
        const [a, b] = points;
        if (Number(b.time) !== Number(a.time)) {
          targets.push({
            contextId: condition.contextId,
            price: Number(a.price) + (targetTime - Number(a.time)) / (Number(b.time) - Number(a.time)) * (Number(b.price) - Number(a.price)),
            direction,
          });
        }
      }
    }
  }
  return targets.filter((target) => Number.isFinite(target.price) && target.price > 0);
}

function frameConstraints(frame) {
  const candles = frame.candles || [];
  const recent = candles.slice(-24);
  const ranges = recent.map((candle, index) => {
    const previousClose = index ? recent[index - 1].close : candle.open;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });
  const bodies = recent.map((candle) => Math.abs(candle.close - candle.open));
  const volumes = recent.map((candle) => Number(candle.volume || 0)).filter(Number.isFinite);
  const price = Math.max(Number(candles.at(-1)?.close || 0), Number.EPSILON);
  const tickSize = Math.max(0, Number(frame.tickSize || 0));
  const atr = ranges.length ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : price * 0.001;
  const averageBody = bodies.length ? bodies.reduce((sum, value) => sum + value, 0) / bodies.length : atr * 0.5;
  const typicalMove = Math.max(tickSize * 2, price * 0.00025, atr * 0.48, averageBody * 0.8);
  // The history, rather than a fixed percentage, defines what is plausible for
  // this market and interval. The generous outer guard only protects malformed
  // source data; normal 15m/1h paths remain governed by ATR and recent bodies.
  const maxMove = Math.min(price * 0.1, Math.max(tickSize * 4, price * 0.0015, atr * 1.6, typicalMove * 2.2));
  const baseVolume = Math.max(1, volumes.length ? volumes.reduce((sum, value) => sum + value, 0) / volumes.length : 1);
  return Object.freeze({ tickSize, atr, averageBody, typicalMove, maxMove, baseVolume });
}

function snapPrice(value, tickSize, mode = "round") {
  if (!tickSize) return value;
  const scaled = value / tickSize;
  return (mode === "ceil" ? Math.ceil(scaled) : mode === "floor" ? Math.floor(scaled) : Math.round(scaled)) * tickSize;
}

function createNextCandle(previous, close, stepMs, sequence, constraints = {}, volumeOverride) {
  const tickSize = Number(constraints.tickSize || 0);
  const open = previous.close;
  close = snapPrice(close, tickSize);
  const body = Math.abs(close - open);
  const atr = Math.max(Number(constraints.atr || 0), Math.abs(open) * 0.0005, tickSize * 2);
  const upperWick = Math.max(tickSize, atr * (0.08 + (sequence % 4) * 0.025), body * (0.08 + (sequence % 3) * 0.035));
  const lowerWick = Math.max(tickSize, atr * (0.07 + ((sequence + 2) % 4) * 0.025), body * (0.07 + ((sequence + 1) % 3) * 0.035));
  const time = Number(previous.closeTime ?? (previous.time + stepMs));
  const volumeVariation = 0.88 + (sequence % 5) * 0.055;
  const derivedVolume = Number(constraints.baseVolume || previous.volume || 1) * volumeVariation
    * (1 + Math.min(1.25, body / Math.max(atr, 1)) * 0.45);
  const candle = {
    time,
    closeTime: time + stepMs,
    open,
    high: snapPrice(Math.max(open, close) + upperWick, tickSize, "ceil"),
    low: Math.max(tickSize || Number.EPSILON, snapPrice(Math.min(open, close) - lowerWick, tickSize, "floor")),
    close,
    volume: Math.max(1, Number.isFinite(Number(volumeOverride)) ? Number(volumeOverride) : derivedVolume),
    simulated: true,
  };
  assertCandle(candle);
  return candle;
}

function scoreResult(result) {
  if (result.value === true) return -1_000_000;
  if (!Array.isArray(result.trace) || !result.trace.length) return 1_000_000;
  return result.trace.reduce((sum, entry) => {
    if (entry.value === true) return sum;
    if (entry.value === UNKNOWN || !Number.isFinite(entry.left) || !Number.isFinite(entry.right)) return sum + 100;
    return sum + Math.abs(entry.left - entry.right) / Math.max(Math.abs(entry.right), 1) + 1;
  }, 0);
}

function buildEvent(rule, frames, eventId, time) {
  // evaluatePath owns this frame set. Reusing it avoids cloning every context
  // for every candidate bar; the evaluator only reads frames.
  const normalizedFrames = frames;
  for (const context of rule.contexts) {
    const frame = normalizedFrames[context.contextId];
    const last = frame.candles.at(-1);
    frame.index = frame.candles.length - 1;
    frame.closed = true;
    frame.coverage = "available";
    frame.receivedAt = time;
    frame.time = last.closeTime || last.time;
  }
  return { eventId, time, intervalMs: Math.min(...rule.contexts.map((context) => intervalMs(context.intervals[0]))), frames: normalizedFrames };
}

function constraintsForFrames(rule, frames) {
  return Object.fromEntries(rule.contexts.map((context) => [context.contextId, frameConstraints(frames[context.contextId])]));
}

function evaluatePath(rule, originalFrames, path, constraintsByContext = constraintsForFrames(rule, originalFrames), { includeInputHash = false } = {}) {
  const frames = cloneFrames(originalFrames);
  const evaluator = new TradingAlertEvaluator({ hashInputs: false });
  const results = [];
  let lastEvent = null;
  for (let index = 0; index < path.length; index += 1) {
    const point = path[index];
    for (const context of rule.contexts) {
      const frame = frames[context.contextId];
      const previous = frame.candles.at(-1);
      const step = intervalMs(context.intervals[0]);
      const scaledClose = point.contextCloses?.[context.contextId] ?? (context.contextId === rule.evaluationPolicy.anchorContextId
        ? point.close
        : previous.close * (1 + Number(point.change || 0)));
      const explicitVolume = point.contextVolumes?.[context.contextId]
        ?? (context.contextId === rule.evaluationPolicy.anchorContextId ? point.volume : undefined);
      frame.candles.push(createNextCandle(
        previous,
        scaledClose,
        step,
        index,
        constraintsByContext[context.contextId],
        explicitVolume,
      ));
    }
    const time = Math.max(...Object.values(frames).map((frame) => frame.candles.at(-1).closeTime));
    lastEvent = buildEvent(rule, frames, `simulation-event-${index + 1}`, time);
    const result = evaluator.evaluate(rule, lastEvent);
    results.push(result);
    if (result.triggered) break;
  }
  if (includeInputHash && lastEvent && results.length) {
    const index = results.length - 1;
    results[index] = Object.freeze({
      ...results[index],
      inputHash: stableHash({
        ruleHash: rule.ruleHash,
        eventId: lastEvent.eventId,
        time: lastEvent.time,
        frames: lastEvent.frames,
      }),
    });
  }
  return { frames, results, result: results.at(-1) };
}

function candidateCloses(state, constraints, targets) {
  const natural = REALISTIC_STEP_MULTIPLIERS.map((multiplier) => state.price + constraints.typicalMove * multiplier);
  const directed = targets.map((target) => {
    const targetPrice = target.price + Number(target.direction || 0) * Math.max(constraints.tickSize, constraints.typicalMove * 0.12);
    const distance = targetPrice - state.price;
    const move = Math.sign(distance) * Math.min(Math.abs(distance), constraints.maxMove, Math.max(constraints.typicalMove * 0.35, Math.abs(distance) * 0.72));
    return state.price + move;
  });
  return [...new Set([...natural, ...directed]
    .map((value) => snapPrice(Math.max(Number.EPSILON, value), constraints.tickSize))
    .filter((value) => Math.abs(value - state.price) <= constraints.maxMove + Math.max(constraints.tickSize, 1e-8))
    .map((value) => Number(value.toPrecision(14))))];
}

function directVolumeTarget(condition, trace) {
  if (!condition || !trace) return null;
  const leftVolume = condition.left?.type === "field" && condition.left.field === "volume";
  const rightVolume = condition.right?.type === "field" && condition.right.field === "volume";
  if (leftVolume === rightVolume) return null;
  const threshold = leftVolume ? Number(trace.right) : Number(trace.left);
  if (!Number.isFinite(threshold) || threshold < 0) return null;
  const epsilon = Math.max(1, Math.abs(threshold) * 0.025, Number(trace.tolerance || 0) * 1.05);
  const operator = String(condition.operator);
  const above = ["gt", "gte", "cross_over", "break_above"].includes(operator);
  const below = ["lt", "lte", "cross_under", "break_below"].includes(operator);
  let volume;
  if (above) volume = leftVolume ? threshold + epsilon : Math.max(1, threshold - epsilon);
  else if (below) volume = leftVolume ? Math.max(1, threshold - epsilon) : threshold + epsilon;
  else if (["eq", "touch"].includes(operator)) volume = Math.max(1, threshold);
  else return null;
  return Number.isFinite(volume) ? { contextId: condition.contextId, volume } : null;
}

function volumeAdjustedEvaluations(rule, originalFrames, path, constraintsByContext, initialEvaluation) {
  const conditions = new Map(leafConditions(rule.root).map((condition) => [condition.conditionId, condition]));
  const adjustments = (initialEvaluation.result?.trace || [])
    .map((trace) => directVolumeTarget(conditions.get(trace.conditionId), trace))
    .filter(Boolean);
  if (!adjustments.length) return [];
  const variants = [];
  const seen = new Set();
  const addVariant = (contextVolumes) => {
    const normalized = Object.fromEntries(Object.entries(contextVolumes)
      .filter(([, volume]) => Number.isFinite(Number(volume)) && Number(volume) >= 0)
      .map(([contextId, volume]) => [contextId, Number(Number(volume).toPrecision(14))]));
    const key = stableHash(normalized);
    if (!Object.keys(normalized).length || seen.has(key)) return;
    seen.add(key);
    const finalPoint = path.at(-1);
    const adjustedPath = [
      ...path.slice(0, -1),
      {
        ...finalPoint,
        ...(normalized[rule.evaluationPolicy.anchorContextId] !== undefined
          ? { volume: normalized[rule.evaluationPolicy.anchorContextId] }
          : {}),
        ...(Object.keys(normalized).some((contextId) => contextId !== rule.evaluationPolicy.anchorContextId)
          ? { contextVolumes: normalized }
          : {}),
      },
    ];
    variants.push({
      path: adjustedPath,
      evaluated: evaluatePath(rule, originalFrames, adjustedPath, constraintsByContext),
    });
  };
  adjustments.forEach((adjustment) => addVariant({ [adjustment.contextId]: adjustment.volume }));
  addVariant(Object.fromEntries(adjustments.map((adjustment) => [adjustment.contextId, adjustment.volume])));
  return variants;
}

function pathFromMultipliers(initialPrice, constraints, multipliers, maxBars) {
  const path = [];
  let price = initialPrice;
  for (let index = 0; index < maxBars; index += 1) {
    const multiplier = multipliers[index % multipliers.length];
    const move = Math.abs(multiplier) > 2 ? Math.sign(multiplier) * constraints.maxMove * 0.94 : multiplier * constraints.typicalMove;
    const close = snapPrice(Math.max(Number.EPSILON, price + move), constraints.tickSize);
    path.push({ close, change: (close - price) / Math.max(price, Number.EPSILON), previousClose: price });
    price = close;
  }
  return path;
}

function targetFollowingPath(rule, frames, primaryId, constraintsByContext, maxBars) {
  const path = [];
  const prices = Object.fromEntries(rule.contexts.map((context) => [
    context.contextId,
    frames[context.contextId].candles.at(-1).close,
  ]));
  for (let index = 0; index < maxBars; index += 1) {
    const targets = targetPrices(rule, frames, index + 1);
    if (!targets.length) break;
    const primaryPreviousClose = prices[primaryId];
    const contextCloses = {};
    for (const context of rule.contexts) {
      const contextId = context.contextId;
      const target = targets.find((entry) => entry.contextId === contextId);
      if (!target) continue;
      const constraints = constraintsByContext[contextId];
      const price = prices[contextId];
      const goal = target.price + Number(target.direction || 0)
        * Math.max(constraints.tickSize, constraints.typicalMove * 0.12);
      const distance = goal - price;
      const move = Math.sign(distance) * Math.min(Math.abs(distance), constraints.maxMove * 0.94);
      const close = snapPrice(Math.max(Number.EPSILON, price + move), constraints.tickSize);
      contextCloses[contextId] = close;
      prices[contextId] = close;
    }
    if (!Object.keys(contextCloses).length) break;
    const close = contextCloses[primaryId] ?? primaryPreviousClose;
    path.push({
      close,
      change: (close - primaryPreviousClose) / Math.max(primaryPreviousClose, Number.EPSILON),
      previousClose: primaryPreviousClose,
      contextCloses,
    });
  }
  return path;
}

function seedPaths(rule, frames, primaryId, initialPrice, constraintsByContext, maxBars) {
  const constraints = constraintsByContext[primaryId];
  const patterns = [
    [-0.45, -1.4, -0.72, -0.22, 0.22, -0.12],
    [0.45, 1.4, 0.72, 0.22, -0.22, 0.12],
    [-3, -3, -3, -1, -0.45, 0.22],
    [3, 3, 3, 1, 0.45, -0.22],
    [3, 3, -3, -3, -3, -1],
    [-3, -3, 3, 3, 3, 1],
  ];
  const directed = targetFollowingPath(rule, frames, primaryId, constraintsByContext, maxBars);
  return [directed, ...patterns.map((pattern) => pathFromMultipliers(initialPrice, constraints, pattern, maxBars))].filter((path) => path.length);
}

function plausibilityPenalty(path, constraints) {
  const point = path.at(-1);
  if (!point) return 0;
  const normalizedMove = Math.abs(point.close - point.previousClose) / Math.max(constraints.typicalMove, Number.EPSILON);
  const previous = path.at(-2);
  const reversal = previous && Math.sign(previous.close - previous.previousClose) !== Math.sign(point.close - point.previousClose) ? 0.035 : 0;
  const volumeRatio = Number.isFinite(Number(point.volume))
    ? Math.max(Number.EPSILON, Number(point.volume) / Math.max(Number(constraints.baseVolume || 1), Number.EPSILON))
    : 1;
  const volumePenalty = Math.abs(Math.log(volumeRatio)) * 0.012;
  return normalizedMove * 0.018 + Math.max(0, normalizedMove - 1.4) * 0.08 + reversal + volumePenalty;
}

function satisfiedConditionIds(node, traceByConditionId) {
  if (node.type === "condition") {
    return traceByConditionId.get(node.condition.conditionId)?.value === true
      ? [node.condition.conditionId]
      : null;
  }
  if (node.type === "all") {
    const children = node.children.map((child) => satisfiedConditionIds(child, traceByConditionId));
    return children.every(Boolean) ? children.flat() : null;
  }
  if (node.type === "any") {
    const children = node.children
      .map((child) => satisfiedConditionIds(child, traceByConditionId))
      .filter(Boolean);
    return children.length ? children.flat() : null;
  }
  if (node.type === "not") return null;
  if (node.type === "sequence") {
    const active = node.steps
      .map((step) => satisfiedConditionIds(step, traceByConditionId))
      .filter(Boolean);
    return active.length ? active.flat() : null;
  }
  return satisfiedConditionIds(node.child, traceByConditionId);
}

function drawingValueFromTrace(condition, trace, previous = false) {
  if (condition.left.type === "drawing") return previous ? trace.previousLeft : trace.left;
  if (condition.right.type === "drawing") return previous ? trace.previousRight : trace.right;
  return Number.NaN;
}

function expressionContainsIndicatorOrVolume(expression) {
  if (!expression || typeof expression !== "object") return false;
  if (expression.type === "indicator") return true;
  if (expression.type === "field" && expression.field === "volume") return true;
  if (expression.expr && expressionContainsIndicatorOrVolume(expression.expr)) return true;
  return (expression.args || []).some(expressionContainsIndicatorOrVolume);
}

function isMainPriceIndicatorExpression(expression) {
  if (!expression || expression.type !== "indicator") return false;
  return ["ma", "sma", "ema", "boll"].includes(String(expression.name || "").toLowerCase());
}

function exactMainIndicatorCrossPoint(condition, trace, previousCandle, triggerCandle) {
  if (
    !["cross_over", "cross_under"].includes(condition.operator)
    || !isMainPriceIndicatorExpression(condition.left)
    || !isMainPriceIndicatorExpression(condition.right)
    || !previousCandle
    || !triggerCandle
    || ![trace.left, trace.right, trace.previousLeft, trace.previousRight].every(Number.isFinite)
  ) return null;
  const previousDifference = trace.previousLeft - trace.previousRight;
  const currentDifference = trace.left - trace.right;
  const denominator = currentDifference - previousDifference;
  if (!Number.isFinite(denominator) || denominator === 0) return null;
  const rawProgress = -previousDifference / denominator;
  if (!Number.isFinite(rawProgress) || rawProgress < 0 || rawProgress > 1) return null;
  const leftAtCross = trace.previousLeft + (trace.left - trace.previousLeft) * rawProgress;
  const rightAtCross = trace.previousRight + (trace.right - trace.previousRight) * rawProgress;
  const time = previousCandle.time + (triggerCandle.time - previousCandle.time) * rawProgress;
  const price = (leftAtCross + rightAtCross) / 2;
  if (!Number.isFinite(time) || time <= 0 || !Number.isFinite(price) || price <= 0) return null;
  return { time, price };
}

function priceValueFromTrace(condition, trace) {
  const priceFields = new Set(["open", "high", "low", "close", "last", "mark", "index"]);
  if (condition.left.type === "field" && priceFields.has(condition.left.field)) return Number(trace.left);
  if (condition.right.type === "field" && priceFields.has(condition.right.field)) return Number(trace.right);
  return Number.NaN;
}

/**
 * Returns one visual evidence point for every satisfied price condition on the
 * actual logical trigger path. A drawing context is deliberately evaluated
 * against its own frame; drawing_1/drawing_2 are often chart-compatible
 * sibling contexts rather than the evaluation anchor.
 */
export function exactConditionTriggerPoints(rule, proof, completedFrames, originalFrames, triggerBarIndex) {
  const conditions = new Map(leafConditions(rule.root).map((condition) => [condition.conditionId, condition]));
  const traceByConditionId = new Map(proof.trace.map((entry) => [entry.conditionId, entry]));
  const satisfiedIds = satisfiedConditionIds(rule.root, traceByConditionId) || [];
  const candidates = satisfiedIds.map((conditionId) => ({
    condition: conditions.get(conditionId),
    trace: traceByConditionId.get(conditionId),
  })).filter(({ condition, trace }) => condition && trace);
  const points = [];

  for (const { condition, trace } of candidates) {
    const contextId = condition.contextId;
    const candles = completedFrames[contextId]?.candles || [];
    const originalCount = originalFrames[contextId]?.candles?.length || 0;
    const triggerFrameIndex = originalCount + triggerBarIndex;
    const triggerCandle = candles[triggerFrameIndex];
    if (!triggerCandle) continue;
    const drawingExpression = condition.left.type === "drawing"
      ? condition.left
      : condition.right.type === "drawing" ? condition.right : null;

    if (drawingExpression) {
      let time = triggerCandle.time;
      let price = drawingValueFromTrace(condition, trace);
      if (["cross_over", "cross_under", "break_above", "break_below"].includes(condition.operator)) {
        const previousCandle = candles[triggerFrameIndex - 1];
        if (!previousCandle || ![trace.left, trace.right, trace.previousLeft, trace.previousRight].every(Number.isFinite)) continue;
        const previousDifference = trace.previousLeft - trace.previousRight;
        const currentDifference = trace.left - trace.right;
        const denominator = currentDifference - previousDifference;
        if (!Number.isFinite(denominator) || denominator === 0) continue;
        const progress = Math.max(0, Math.min(1, -previousDifference / denominator));
        const previousDrawingPrice = drawingValueFromTrace(condition, trace, true);
        const currentDrawingPrice = drawingValueFromTrace(condition, trace);
        if (![previousDrawingPrice, currentDrawingPrice].every(Number.isFinite)) continue;
        time = previousCandle.time + (triggerCandle.time - previousCandle.time) * progress;
        price = previousDrawingPrice + (currentDrawingPrice - previousDrawingPrice) * progress;
      } else if (!Number.isFinite(price)) {
        continue;
      } else if (price < triggerCandle.low || price > triggerCandle.high) {
        // A one-sided comparison such as close > trendline can be satisfied
        // without physically touching the line. Keep that condition visible
        // by anchoring its evidence to the evaluated K-line price instead.
        const evaluatedPrice = priceValueFromTrace(condition, trace);
        if (!Number.isFinite(evaluatedPrice) || evaluatedPrice <= 0) continue;
        price = evaluatedPrice;
      }
      points.push({
        kind: "drawing",
        contextId,
        drawingId: drawingExpression.drawingId,
        time,
        price,
        conditionId: condition.conditionId,
        conditionIds: [condition.conditionId],
      });
      continue;
    }

    const indicatorCross = exactMainIndicatorCrossPoint(
      condition,
      trace,
      candles[triggerFrameIndex - 1],
      triggerCandle,
    );
    if (indicatorCross) {
      points.push({
        kind: "indicator",
        contextId,
        time: indicatorCross.time,
        price: indicatorCross.price,
        conditionId: condition.conditionId,
        conditionIds: [condition.conditionId],
      });
      continue;
    }

    if (
      expressionContainsIndicatorOrVolume(condition.left)
      || expressionContainsIndicatorOrVolume(condition.right)
    ) continue;
    const price = priceValueFromTrace(condition, trace);
    if (!Number.isFinite(price) || price <= 0) continue;
    points.push({
      kind: "price",
      contextId,
      time: triggerCandle.time,
      price,
      conditionId: condition.conditionId,
      conditionIds: [condition.conditionId],
    });
  }

  const grouped = new Map();
  for (const point of points) {
    const key = point.kind === "drawing"
      ? `${point.contextId}|${point.drawingId}|${Number(point.time).toFixed(6)}|${Number(point.price).toFixed(8)}`
      : `${point.kind}|${point.contextId}|${point.conditionId}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.conditionIds.push(...point.conditionIds.filter((id) => !existing.conditionIds.includes(id)));
      continue;
    }
    grouped.set(key, { ...point, conditionIds: [...point.conditionIds] });
  }
  return Object.freeze([...grouped.values()].map((point) => Object.freeze({
    ...point,
    conditionIds: Object.freeze(point.conditionIds),
  })));
}

function appendRealisticContinuation(rule, frames, generatedCount, minimumBars, constraintsByContext) {
  if (generatedCount >= minimumBars) return frames;
  const completed = cloneFrames(frames);
  for (let index = generatedCount; index < minimumBars; index += 1) {
    for (const context of rule.contexts) {
      const frame = completed[context.contextId];
      const previous = frame.candles.at(-1);
      const constraints = constraintsByContext[context.contextId];
      const multiplier = CONTINUATION_MULTIPLIERS[(index + context.contextId.length) % CONTINUATION_MULTIPLIERS.length];
      const close = previous.close + constraints.typicalMove * multiplier;
      frame.candles.push(createNextCandle(previous, close, intervalMs(context.intervals[0]), index, constraints));
    }
  }
  return completed;
}

export async function planAlertSimulation({ rule: ruleValue, frames: inputFrames, maxBars = 48, beamWidth = 160, minFutureBars = DEFAULT_MIN_FUTURE_BARS, signal } = {}) {
  const rule = normalizeAlertRule(ruleValue);
  const frames = simulationFramesForRule(rule, inputFrames);
  for (const context of rule.contexts) {
    const frame = frames[context.contextId];
    if (!frame?.candles?.length) throw new TradingAlertError(`缺少 ${context.contextId} 的 K 线历史`, { code: "TRADING_ALERT_SIMULATION_HISTORY_MISSING", category: "simulation" });
    frame.interval ||= context.intervals[0];
    frame.candles.forEach((candle, index) => assertCandle(candle, `${context.contextId}.candles[${index}]`));
  }
  const primaryId = rule.evaluationPolicy.anchorContextId;
  const initialPrice = frames[primaryId].candles.at(-1).close;
  const constraintsByContext = constraintsForFrames(rule, frames);
  const primaryConstraints = constraintsByContext[primaryId];
  const minimumPathBars = Math.max(1, Math.min(maxBars, Math.floor(Number(minFutureBars) || DEFAULT_MIN_FUTURE_BARS)));
  const minimumTriggerBars = Math.min(3, minimumPathBars);
  let earlyTrigger = null;
  for (const path of seedPaths(rule, frames, primaryId, initialPrice, constraintsByContext, maxBars)) {
    const evaluated = evaluatePath(rule, frames, path, constraintsByContext);
    const evaluations = [{ path, evaluated }, ...volumeAdjustedEvaluations(rule, frames, path, constraintsByContext, evaluated)];
    for (const variant of evaluations) {
      if (!variant.evaluated.result?.triggered) continue;
      const effectivePath = variant.path.slice(0, variant.evaluated.results.length);
      const candidate = {
        path: effectivePath,
        price: effectivePath.at(-1).close,
        score: scoreResult(variant.evaluated.result),
        evaluated: variant.evaluated,
      };
      if (effectivePath.length >= minimumTriggerBars) return finalizeSimulation(rule, frames, candidate, constraintsByContext, minimumPathBars, minimumTriggerBars);
      if (!earlyTrigger || effectivePath.length > earlyTrigger.path.length) earlyTrigger = candidate;
    }
  }
  let beam = [{ path: [], score: Number.POSITIVE_INFINITY, price: initialPrice }];
  let best = null;
  for (let bar = 0; bar < maxBars; bar += 1) {
    if (signal?.aborted) throw new TradingAlertError("模拟已取消", { code: "TRADING_ALERT_SIMULATION_CANCELLED", category: "cancelled" });
    const candidates = [];
    for (const state of beam) {
      const targets = targetPrices(rule, frames, state.path.length + 1).filter((target) => target.contextId === primaryId);
      for (const close of candidateCloses(state, primaryConstraints, targets)) {
        const change = (close - state.price) / Math.max(state.price, Number.EPSILON);
        const path = [...state.path, { close, change, previousClose: state.price }];
        const evaluated = evaluatePath(rule, frames, path, constraintsByContext);
        const evaluations = [{ path, evaluated }, ...volumeAdjustedEvaluations(rule, frames, path, constraintsByContext, evaluated)];
        for (const variant of evaluations) {
          const score = scoreResult(variant.evaluated.result) + plausibilityPenalty(variant.path, primaryConstraints) + variant.path.length * 1e-6;
          const candidate = { path: variant.path, price: close, score, evaluated: variant.evaluated };
          if (!best || score < best.score) best = candidate;
          if (variant.evaluated.result?.triggered) {
            if (variant.path.length >= minimumTriggerBars) return finalizeSimulation(rule, frames, candidate, constraintsByContext, minimumPathBars, minimumTriggerBars);
            if (!earlyTrigger || variant.path.length > earlyTrigger.path.length || score < earlyTrigger.score) earlyTrigger = candidate;
            continue;
          }
          candidates.push(candidate);
        }
      }
    }
    candidates.sort((a, b) => a.score - b.score || a.price - b.price);
    beam = candidates.slice(0, beamWidth).map(({ path, price, score }) => ({ path, price, score }));
    if (!beam.length) break;
    // A resolved promise only yields to the microtask queue and can still starve
    // Electron's native window event loop. Keep direct callers responsive too;
    // production simulations run in a worker, while tests and utilities may not.
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (earlyTrigger) return finalizeSimulation(rule, frames, earlyTrigger, constraintsByContext, minimumPathBars, minimumTriggerBars);
  throw new TradingAlertError("在当前数据与搜索预算内无法构造经 Evaluator 验证的触发路径；需要用户补充口径或提高模拟预算", {
    code: "TRADING_ALERT_SIMULATION_NO_VALID_PATH",
    category: "simulation",
    details: { bestScore: best?.score ?? null, barsExplored: maxBars },
  });
}

function finalizeSimulation(rule, originalFrames, candidate, constraintsByContext, minimumBars, minimumTriggerBars) {
  candidate = {
    ...candidate,
    evaluated: evaluatePath(rule, originalFrames, candidate.path, constraintsByContext, { includeInputHash: true }),
  };
  const simulationId = `simulation-${crypto.randomUUID()}`;
  const triggerBarIndex = candidate.evaluated.results.findIndex((result) => result.triggered);
  const completedFrames = appendRealisticContinuation(rule, candidate.evaluated.frames, candidate.evaluated.results.length, minimumBars, constraintsByContext);
  const generated = {};
  for (const context of rule.contexts) {
    const initialCount = originalFrames[context.contextId].candles.length;
    generated[context.contextId] = completedFrames[context.contextId].candles.slice(initialCount);
  }
  const proof = candidate.evaluated.result;
  const traceByConditionId = new Map(proof.trace.map((entry) => [entry.conditionId, entry]));
  const activeConditionIds = Object.freeze(satisfiedConditionIds(rule.root, traceByConditionId) || []);
  const triggerPoints = exactConditionTriggerPoints(rule, proof, completedFrames, originalFrames, triggerBarIndex);
  const triggerPoint = triggerPoints[0]
    ? Object.freeze({
        time: triggerPoints[0].time,
        price: triggerPoints[0].price,
        conditionId: triggerPoints[0].conditionId,
      })
    : null;
  const maxMoveByContext = Object.fromEntries(Object.entries(constraintsByContext).map(([contextId, value]) => [contextId, value.maxMove]));
  return Object.freeze({
    schemaVersion: 1,
    simulationId,
    ruleId: rule.ruleId,
    ruleHash: rule.ruleHash,
    createdAt: Date.now(),
    generated: Object.freeze(generated),
    triggerBarIndex,
    activeConditionIds,
    ...(triggerPoint ? { triggerPoint } : {}),
    ...(triggerPoints.length ? { triggerPoints } : {}),
    triggerEventId: proof.eventId,
    proof,
    inputHash: stableHash({ ruleHash: rule.ruleHash, originalFrames, generated }),
    overlay: Object.freeze({
      layerId: `alert-simulation/${simulationId}`,
      isolated: true,
      candles: generated,
      realism: Object.freeze({ minimumFutureBars: minimumBars, minimumTriggerBars, generatedBars: generated[rule.evaluationPolicy.anchorContextId].length, maxMoveByContext: Object.freeze(maxMoveByContext) }),
      annotations: Object.freeze([
        { kind: "trigger", eventId: proof.eventId, label: "模拟触发", tone: "warning" },
        ...proof.trace.map((entry) => ({ kind: "condition", conditionId: entry.conditionId, label: `${entry.conditionId}: ${entry.value === true ? "满足" : entry.value}` })),
      ]),
    }),
  });
}

export function verifySimulation(ruleValue, originalFrames, simulation) {
  const rule = normalizeAlertRule(ruleValue);
  if (simulation.ruleHash !== rule.ruleHash) return { valid: false, reason: "rule_hash_mismatch" };
  const anchor = rule.evaluationPolicy.anchorContextId;
  const generated = simulation.generated[anchor] || [];
  const path = generated.map((candle, index) => ({
    close: candle.close,
    volume: candle.volume,
    contextCloses: Object.fromEntries(rule.contexts
      .filter((context) => simulation.generated[context.contextId]?.[index])
      .map((context) => [context.contextId, simulation.generated[context.contextId][index].close])),
    contextVolumes: Object.fromEntries(rule.contexts
      .filter((context) => simulation.generated[context.contextId]?.[index])
      .map((context) => [context.contextId, simulation.generated[context.contextId][index].volume])),
  }));
  const frames = simulationFramesForRule(rule, originalFrames);
  const result = evaluatePath(rule, frames, path, constraintsForFrames(rule, frames), { includeInputHash: true }).result;
  return { valid: result?.triggered === true && result.inputHash === simulation.proof.inputHash, result };
}

export function chartSwitchRequest(ruleValue) {
  const rule = normalizeAlertRule(ruleValue);
  const context = rule.contexts.find((entry) => entry.contextId === rule.evaluationPolicy.anchorContextId);
  if (context.marketSelector.kind !== "fixed") return null;
  return Object.freeze({ marketId: context.marketSelector.marketIds[0], interval: context.intervals[0], reason: "alert_simulation_context" });
}
