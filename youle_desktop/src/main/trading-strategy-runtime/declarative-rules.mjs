const RULE_ID = /^[a-z][a-z0-9-]{1,63}$/;
const ALLOWED_INDICATORS = new Set(["sma", "ema"]);
const ALLOWED_SOURCES = new Set(["open", "high", "low", "close", "volume"]);
const ALLOWED_OPERATORS = new Set(["gt", "gte", "lt", "lte", "crosses-above", "crosses-below"]);
const ALLOWED_SIDES = new Set(["long", "short"]);
const ALLOWED_DRAWING_ROLES = new Set(["primary", "support", "resistance", "entry", "stop", "target", "note"]);

function fail(message) {
  throw new TypeError(message);
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object`);
  return value;
}

function knownKeys(value, field, keys) {
  for (const key of Object.keys(value)) if (!keys.has(key)) fail(`${field}.${key} is not supported`);
}

function id(value, field) {
  const normalized = String(value || "").trim();
  if (!RULE_ID.test(normalized)) fail(`${field} is invalid`);
  return normalized;
}

function integer(value, field, min, max) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) fail(`${field} is invalid`);
  return normalized;
}

function operand(value, field, indicatorIds) {
  const source = object(value, field);
  knownKeys(source, field, new Set(["kind", "source", "indicatorId", "value", "offset"]));
  const kind = String(source.kind || "");
  const offset = source.offset === undefined ? 0 : integer(source.offset, `${field}.offset`, -100, 0);
  if (kind === "price") {
    const priceSource = String(source.source || "");
    if (!ALLOWED_SOURCES.has(priceSource)) fail(`${field}.source is invalid`);
    return Object.freeze({ kind, source: priceSource, indicatorId: null, value: null, offset });
  }
  if (kind === "indicator") {
    const indicatorId = id(source.indicatorId, `${field}.indicatorId`);
    if (!indicatorIds.has(indicatorId)) fail(`${field}.indicatorId is unknown`);
    return Object.freeze({ kind, source: null, indicatorId, value: null, offset });
  }
  if (kind === "constant") {
    const constant = Number(source.value);
    if (!Number.isFinite(constant) || Math.abs(constant) > 1_000_000_000) fail(`${field}.value is invalid`);
    return Object.freeze({ kind, source: null, indicatorId: null, value: constant, offset: 0 });
  }
  fail(`${field}.kind is invalid`);
}

export function validateDeclarativeStrategyRules(value) {
  const source = object(value, "rules");
  knownKeys(source, "rules", new Set([
    "schemaVersion",
    "minimumCandles",
    "indicators",
    "signals",
    "levels",
    "drawing",
  ]));
  if (Number(source.schemaVersion) !== 1) fail("rules.schemaVersion is unsupported");
  const minimumCandles = integer(source.minimumCandles, "rules.minimumCandles", 10, 5_000);
  if (!Array.isArray(source.indicators) || source.indicators.length > 32) fail("rules.indicators must be a bounded array");
  const indicatorIds = new Set();
  const indicators = source.indicators.map((raw, index) => {
    const item = object(raw, `rules.indicators[${index}]`);
    knownKeys(item, `rules.indicators[${index}]`, new Set(["id", "type", "source", "period"]));
    const indicatorId = id(item.id, `rules.indicators[${index}].id`);
    if (indicatorIds.has(indicatorId)) fail(`rules indicator ${indicatorId} is duplicated`);
    indicatorIds.add(indicatorId);
    const type = String(item.type || "");
    const priceSource = String(item.source || "");
    if (!ALLOWED_INDICATORS.has(type)) fail(`rules.indicators[${index}].type is invalid`);
    if (!ALLOWED_SOURCES.has(priceSource)) fail(`rules.indicators[${index}].source is invalid`);
    return Object.freeze({
      id: indicatorId,
      type,
      source: priceSource,
      period: integer(item.period, `rules.indicators[${index}].period`, 2, 1_000),
    });
  });
  if (!Array.isArray(source.signals) || !source.signals.length || source.signals.length > 16) {
    fail("rules.signals must contain 1-16 signals");
  }
  const signalIds = new Set();
  const signals = source.signals.map((raw, signalIndex) => {
    const item = object(raw, `rules.signals[${signalIndex}]`);
    knownKeys(item, `rules.signals[${signalIndex}]`, new Set(["id", "side", "all", "label"]));
    const signalId = id(item.id, `rules.signals[${signalIndex}].id`);
    if (signalIds.has(signalId)) fail(`rules signal ${signalId} is duplicated`);
    signalIds.add(signalId);
    const side = String(item.side || "");
    if (!ALLOWED_SIDES.has(side)) fail(`rules.signals[${signalIndex}].side is invalid`);
    if (!Array.isArray(item.all) || !item.all.length || item.all.length > 16) {
      fail(`rules.signals[${signalIndex}].all must contain 1-16 comparisons`);
    }
    const all = item.all.map((rawComparison, comparisonIndex) => {
      const comparison = object(rawComparison, `rules.signals[${signalIndex}].all[${comparisonIndex}]`);
      knownKeys(comparison, `rules.signals[${signalIndex}].all[${comparisonIndex}]`, new Set(["left", "operator", "right"]));
      const operator = String(comparison.operator || "");
      if (!ALLOWED_OPERATORS.has(operator)) fail(`rules comparison operator ${operator} is invalid`);
      return Object.freeze({
        left: operand(comparison.left, "rules comparison left", indicatorIds),
        operator,
        right: operand(comparison.right, "rules comparison right", indicatorIds),
      });
    });
    return Object.freeze({
      id: signalId,
      side,
      label: String(item.label || signalId).trim().slice(0, 160),
      all: Object.freeze(all),
    });
  });
  const levelsSource = object(source.levels, "rules.levels");
  knownKeys(levelsSource, "rules.levels", new Set(["breakoutLookback", "invalidationLookback", "riskMultiple"]));
  const levels = Object.freeze({
    breakoutLookback: integer(levelsSource.breakoutLookback, "rules.levels.breakoutLookback", 2, 1_000),
    invalidationLookback: integer(levelsSource.invalidationLookback, "rules.levels.invalidationLookback", 2, 1_000),
    riskMultiple: Number(levelsSource.riskMultiple),
  });
  if (!Number.isFinite(levels.riskMultiple) || levels.riskMultiple < 0.5 || levels.riskMultiple > 20) {
    fail("rules.levels.riskMultiple is invalid");
  }
  const drawingSource = object(source.drawing || {}, "rules.drawing");
  knownKeys(drawingSource, "rules.drawing", new Set(["enabled", "roles"]));
  const roles = Array.isArray(drawingSource.roles) ? drawingSource.roles.map(String) : [];
  if (roles.length > 12 || roles.some((role) => !ALLOWED_DRAWING_ROLES.has(role))) {
    fail("rules.drawing.roles contains an unsupported semantic role");
  }
  return Object.freeze({
    schemaVersion: 1,
    minimumCandles,
    indicators: Object.freeze(indicators),
    signals: Object.freeze(signals),
    levels,
    drawing: Object.freeze({ enabled: drawingSource.enabled !== false, roles: Object.freeze([...new Set(roles)]) }),
  });
}

function movingAverage(values, period, exponential) {
  const result = Array(values.length).fill(null);
  if (values.length < period) return result;
  if (!exponential) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
      total += values[index];
      if (index >= period) total -= values[index - period];
      if (index >= period - 1) result[index] = total / period;
    }
    return result;
  }
  const multiplier = 2 / (period + 1);
  let seed = values.slice(0, period).reduce((total, item) => total + item, 0) / period;
  result[period - 1] = seed;
  for (let index = period; index < values.length; index += 1) {
    seed = (values[index] - seed) * multiplier + seed;
    result[index] = seed;
  }
  return result;
}

function operandValue(operandDefinition, candles, indicators, index) {
  const target = index + operandDefinition.offset;
  if (target < 0 || target >= candles.length) return null;
  if (operandDefinition.kind === "constant") return operandDefinition.value;
  if (operandDefinition.kind === "price") return candles[target][operandDefinition.source];
  return indicators.get(operandDefinition.indicatorId)?.[target] ?? null;
}

function comparisonMatches(comparison, candles, indicators, index) {
  const left = operandValue(comparison.left, candles, indicators, index);
  const right = operandValue(comparison.right, candles, indicators, index);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (comparison.operator === "gt") return left > right;
  if (comparison.operator === "gte") return left >= right;
  if (comparison.operator === "lt") return left < right;
  if (comparison.operator === "lte") return left <= right;
  const previousLeft = operandValue(comparison.left, candles, indicators, index - 1);
  const previousRight = operandValue(comparison.right, candles, indicators, index - 1);
  if (!Number.isFinite(previousLeft) || !Number.isFinite(previousRight)) return false;
  return comparison.operator === "crosses-above"
    ? previousLeft <= previousRight && left > right
    : previousLeft >= previousRight && left < right;
}

export function evaluateDeclarativeStrategyRules(rulesValue, candleValues) {
  const rules = validateDeclarativeStrategyRules(rulesValue);
  if (!Array.isArray(candleValues)) fail("candles must be an array");
  const candles = candleValues.map((raw, index) => {
    const candle = object(raw, `candles[${index}]`);
    const normalized = Object.fromEntries(["time", "open", "high", "low", "close", "volume"].map((key) => [key, Number(candle[key] || 0)]));
    if (!Number.isFinite(normalized.time) || normalized.time <= 0
      || ![normalized.open, normalized.high, normalized.low, normalized.close].every((item) => Number.isFinite(item) && item > 0)
      || normalized.low > normalized.high) fail(`candles[${index}] is invalid`);
    return normalized;
  }).sort((left, right) => left.time - right.time);
  const requiredCandles = Math.max(
    rules.minimumCandles,
    rules.levels.breakoutLookback + 1,
    rules.levels.invalidationLookback + 1,
    ...rules.indicators.map((indicator) => indicator.period + 2),
  );
  if (candles.length < requiredCandles) {
    return Object.freeze({ status: "insufficient_data", requiredCandles, candleCount: candles.length, signals: Object.freeze([]) });
  }
  const indicators = new Map(rules.indicators.map((indicator) => [
    indicator.id,
    movingAverage(candles.map((candle) => candle[indicator.source]), indicator.period, indicator.type === "ema"),
  ]));
  const index = candles.length - 1;
  const signals = rules.signals.filter((signal) => signal.all.every((comparison) => (
    comparisonMatches(comparison, candles, indicators, index)
  ))).map((signal) => Object.freeze({ id: signal.id, side: signal.side, label: signal.label, strength: 1 }));
  const breakoutCandles = candles.slice(-(rules.levels.breakoutLookback + 1), -1);
  const invalidationCandles = candles.slice(-(rules.levels.invalidationLookback + 1), -1);
  const longTrigger = Math.max(...breakoutCandles.map((candle) => candle.high));
  const shortTrigger = Math.min(...breakoutCandles.map((candle) => candle.low));
  const longInvalidation = Math.min(...invalidationCandles.map((candle) => candle.low));
  const shortInvalidation = Math.max(...invalidationCandles.map((candle) => candle.high));
  return Object.freeze({
    status: "completed",
    candleCount: candles.length,
    lastCandle: Object.freeze(candles.at(-1)),
    signals: Object.freeze(signals),
    indicators: Object.freeze(Object.fromEntries([...indicators].map(([key, values]) => [key, values.at(-1)]))),
    levels: Object.freeze({
      longTrigger,
      shortTrigger,
      longInvalidation,
      shortInvalidation,
      longTarget: longTrigger + Math.abs(longTrigger - longInvalidation) * rules.levels.riskMultiple,
      shortTarget: shortTrigger - Math.abs(shortInvalidation - shortTrigger) * rules.levels.riskMultiple,
    }),
  });
}
