import crypto from "node:crypto";

export const TRADING_ALERT_SCHEMA_VERSION = 1;
export const TRADING_ALERT_STORE_VERSION = 2;
export const TRADING_ALERT_LIMITS = Object.freeze({
  maxAstDepth: 12,
  maxAstNodes: 128,
  maxContexts: 32,
  maxIntervalsPerContext: 32,
  maxMarketsPerContext: 256,
  maxDataRequirements: 64,
  maxStringLength: 4_000,
  maxParamsPerExpression: 32,
});

export const ALERT_DRAFT_STATUSES = Object.freeze([
  "interpreting",
  "awaiting_clarification",
  "awaiting_data",
  "awaiting_tool",
  "awaiting_authorization",
  "validating_dependency",
  "ready_to_simulate",
  "simulating",
  "awaiting_confirmation",
  "cancelled",
  "confirmed",
]);

export const ALERT_INSTANCE_STATUSES = Object.freeze([
  "arming",
  "monitoring",
  "reconnecting",
  "paused",
  "gap_detected",
  "triggered",
  "cooling_down",
  "completed",
  "failed",
]);

export const ALERT_ERROR_CATEGORIES = Object.freeze([
  "validation",
  "ambiguity",
  "missing_data",
  "authorization",
  "provider",
  "transport",
  "stale_data",
  "protocol",
  "evaluation",
  "simulation",
  "storage",
  "notification",
  "cancelled",
]);

const BOOLEAN_TYPES = new Set(["all", "any", "not", "condition", "sequence", "within", "sustain", "count"]);
const CONDITION_OPERATORS = new Set([
  "gt", "gte", "lt", "lte", "eq", "neq", "inside", "outside", "touch",
  "break_above", "break_below", "cross_over", "cross_under", "rises_by", "falls_by",
]);
const VALUE_TYPES = new Set(["constant", "field", "indicator", "drawing", "external", "lag", "rolling", "math"]);
const FIELD_NAMES = new Set(["open", "high", "low", "close", "volume", "last", "mark", "index"]);
const MATH_OPERATORS = new Set(["add", "sub", "mul", "div", "abs", "min", "max", "percent_change"]);
const ROLLING_OPERATORS = new Set(["min", "max", "avg", "sum"]);
const DRAWING_OUTPUTS = new Set(["price_at_time", "upper", "lower"]);
const CONFIRMATION_MODES = new Set(["intrabar", "bar_close"]);
const COVERAGE_STATUSES = new Set(["available", "delayed", "partial", "unavailable"]);
const REQUIREMENT_STATUSES = new Set(["missing", "awaiting_user", "validating", "available", "degraded"]);
const REQUIREMENT_PERMISSIONS = new Set(["public", "read_only_account", "wallet_signature"]);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/;

export class TradingAlertProtocolError extends TypeError {
  constructor(message, { code = "TRADING_ALERT_VALIDATION_FAILED", path = "" } = {}) {
    super(path ? `${path}: ${message}` : message);
    this.name = "TradingAlertProtocolError";
    this.code = code;
    this.category = "validation";
    this.path = path;
  }
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stableHash(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function fail(message, path = "", code) {
  throw new TradingAlertProtocolError(message, { path, code });
}

function plainObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("must be an object", path);
  return value;
}

function onlyKeys(value, keys, path) {
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length) fail(`contains unsupported fields: ${unknown.join(", ")}`, path);
}

function text(value, path, { max = TRADING_ALERT_LIMITS.maxStringLength, allowEmpty = false } = {}) {
  const normalized = String(value ?? "").trim();
  if (!allowEmpty && !normalized) fail("is required", path);
  if (normalized.length > max) fail(`must be at most ${max} characters`, path);
  return normalized;
}

function identifier(value, path) {
  const normalized = text(value, path, { max: 160 });
  if (!IDENTIFIER_PATTERN.test(normalized)) fail("has an invalid identifier format", path);
  return normalized;
}

function number(value, path, { min = -Number.MAX_VALUE, max = Number.MAX_VALUE, integer = false } = {}) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) fail("must be a finite number", path);
  if (integer && !Number.isInteger(normalized)) fail("must be an integer", path);
  if (normalized < min || normalized > max) fail(`must be between ${min} and ${max}`, path);
  return normalized;
}

function enumValue(value, allowed, path) {
  const normalized = String(value ?? "").trim();
  if (!allowed.has(normalized)) fail(`must be one of: ${[...allowed].join(", ")}`, path);
  return normalized;
}

function stringArray(value, path, { max = 64, identifierItems = false, allowEmpty = false } = {}) {
  if (!Array.isArray(value)) fail("must be an array", path);
  if (!allowEmpty && !value.length) fail("must not be empty", path);
  if (value.length > max) fail(`must contain at most ${max} items`, path);
  const unique = [];
  const seen = new Set();
  value.forEach((item, index) => {
    const normalized = identifierItems
      ? identifier(item, `${path}[${index}]`)
      : text(item, `${path}[${index}]`, { max: 240 });
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(normalized);
    }
  });
  return Object.freeze(unique);
}

function optionalFiniteNumber(value, path, options) {
  return value === undefined || value === null ? undefined : number(value, path, options);
}

function normalizeScalarRecord(value, path) {
  if (value === undefined || value === null) return Object.freeze({});
  const object = plainObject(value, path);
  const entries = Object.entries(object);
  if (entries.length > TRADING_ALERT_LIMITS.maxParamsPerExpression) {
    fail(`must contain at most ${TRADING_ALERT_LIMITS.maxParamsPerExpression} parameters`, path);
  }
  const result = {};
  for (const [key, raw] of entries) {
    const normalizedKey = identifier(key, `${path}.${key}`);
    if (!["string", "number", "boolean"].includes(typeof raw) || (typeof raw === "number" && !Number.isFinite(raw))) {
      fail("parameter values must be finite scalar values", `${path}.${key}`);
    }
    result[normalizedKey] = raw;
  }
  return Object.freeze(result);
}

function normalizeWindow(value, path) {
  const object = plainObject(value, path);
  onlyKeys(object, ["value", "unit"], path);
  const unit = enumValue(object.unit, new Set(["events", "bars", "milliseconds"]), `${path}.unit`);
  const windowValue = number(object.value, `${path}.value`, {
    min: 1,
    max: unit === "milliseconds" ? 31_536_000_000 : 100_000,
    integer: true,
  });
  return Object.freeze({ value: windowValue, unit });
}

function normalizeTolerance(value, path) {
  if (value === undefined || value === null) return undefined;
  const object = plainObject(value, path);
  onlyKeys(object, ["mode", "value"], path);
  const mode = enumValue(object.mode, new Set(["absolute", "percent", "ticks", "atr"]), `${path}.mode`);
  const toleranceValue = number(object.value, `${path}.value`, { min: 0, max: 1_000_000 });
  if (mode === "percent" && toleranceValue > 100) fail("percent tolerance cannot exceed 100", `${path}.value`);
  return Object.freeze({ mode, value: toleranceValue });
}

function normalizeValueExpression(value, path, state, depth) {
  if (depth > TRADING_ALERT_LIMITS.maxAstDepth) fail("expression depth limit exceeded", path);
  state.nodes += 1;
  if (state.nodes > TRADING_ALERT_LIMITS.maxAstNodes) fail("AST node limit exceeded", path);
  const object = plainObject(value, path);
  const type = enumValue(object.type, VALUE_TYPES, `${path}.type`);
  if (type === "constant") {
    onlyKeys(object, ["type", "value"], path);
    return Object.freeze({ type, value: number(object.value, `${path}.value`) });
  }
  if (type === "field") {
    onlyKeys(object, ["type", "field"], path);
    return Object.freeze({ type, field: enumValue(object.field, FIELD_NAMES, `${path}.field`) });
  }
  if (type === "lag") {
    onlyKeys(object, ["type", "expr", "bars"], path);
    return Object.freeze({
      type,
      expr: normalizeValueExpression(object.expr, `${path}.expr`, state, depth + 1),
      bars: number(object.bars, `${path}.bars`, { min: 1, max: 5_000, integer: true }),
    });
  }
  if (type === "rolling") {
    onlyKeys(object, ["type", "op", "expr", "period", "offset"], path);
    return Object.freeze({
      type,
      op: enumValue(object.op, ROLLING_OPERATORS, `${path}.op`),
      expr: normalizeValueExpression(object.expr, `${path}.expr`, state, depth + 1),
      period: number(object.period, `${path}.period`, { min: 1, max: 5_000, integer: true }),
      offset: object.offset === undefined
        ? 0
        : number(object.offset, `${path}.offset`, { min: 0, max: 5_000, integer: true }),
    });
  }
  if (type === "indicator") {
    onlyKeys(object, ["type", "name", "params", "output", "version"], path);
    const output = object.output === undefined ? undefined : identifier(object.output, `${path}.output`);
    const version = object.version === undefined ? undefined : text(object.version, `${path}.version`, { max: 80 });
    return Object.freeze({
      type,
      name: identifier(object.name, `${path}.name`).toLowerCase(),
      params: normalizeScalarRecord(object.params, `${path}.params`),
      ...(output ? { output } : {}),
      ...(version ? { version } : {}),
    });
  }
  if (type === "drawing") {
    onlyKeys(object, ["type", "drawingId", "output"], path);
    return Object.freeze({
      type,
      drawingId: identifier(object.drawingId, `${path}.drawingId`),
      output: enumValue(object.output, DRAWING_OUTPUTS, `${path}.output`),
    });
  }
  if (type === "external") {
    onlyKeys(object, ["type", "capability", "field", "params", "version"], path);
    const version = object.version === undefined ? undefined : text(object.version, `${path}.version`, { max: 80 });
    return Object.freeze({
      type,
      capability: identifier(object.capability, `${path}.capability`),
      field: identifier(object.field, `${path}.field`),
      params: normalizeScalarRecord(object.params, `${path}.params`),
      ...(version ? { version } : {}),
    });
  }
  onlyKeys(object, ["type", "op", "args"], path);
  const op = enumValue(object.op, MATH_OPERATORS, `${path}.op`);
  if (!Array.isArray(object.args) || !object.args.length || object.args.length > 16) {
    fail("math args must contain 1 to 16 expressions", `${path}.args`);
  }
  if (["abs"].includes(op) && object.args.length !== 1) fail(`${op} requires exactly one argument`, `${path}.args`);
  if (["div", "percent_change"].includes(op) && object.args.length !== 2) fail(`${op} requires exactly two arguments`, `${path}.args`);
  return Object.freeze({
    type,
    op,
    args: Object.freeze(object.args.map((arg, index) => normalizeValueExpression(arg, `${path}.args[${index}]`, state, depth + 1))),
  });
}

function normalizeCondition(value, path, state, depth) {
  const object = plainObject(value, path);
  onlyKeys(object, ["conditionId", "contextId", "operator", "left", "right", "tolerance", "confirmation"], path);
  const confirmation = object.confirmation === undefined
    ? undefined
    : enumValue(object.confirmation, CONFIRMATION_MODES, `${path}.confirmation`);
  const tolerance = normalizeTolerance(object.tolerance, `${path}.tolerance`);
  return Object.freeze({
    conditionId: identifier(object.conditionId, `${path}.conditionId`),
    contextId: identifier(object.contextId, `${path}.contextId`),
    operator: enumValue(object.operator, CONDITION_OPERATORS, `${path}.operator`),
    left: normalizeValueExpression(object.left, `${path}.left`, state, depth + 1),
    right: normalizeValueExpression(object.right, `${path}.right`, state, depth + 1),
    ...(tolerance ? { tolerance } : {}),
    ...(confirmation ? { confirmation } : {}),
  });
}

function normalizeBooleanNode(value, path, state, depth = 1) {
  if (depth > TRADING_ALERT_LIMITS.maxAstDepth) fail("AST depth limit exceeded", path);
  state.nodes += 1;
  if (state.nodes > TRADING_ALERT_LIMITS.maxAstNodes) fail("AST node limit exceeded", path);
  const object = plainObject(value, path);
  const type = enumValue(object.type, BOOLEAN_TYPES, `${path}.type`);
  if (type === "all" || type === "any") {
    onlyKeys(object, ["type", "children"], path);
    if (!Array.isArray(object.children) || object.children.length < 2 || object.children.length > 64) {
      fail(`${type} requires 2 to 64 children`, `${path}.children`);
    }
    return Object.freeze({
      type,
      children: Object.freeze(object.children.map((child, index) => normalizeBooleanNode(child, `${path}.children[${index}]`, state, depth + 1))),
    });
  }
  if (type === "not") {
    onlyKeys(object, ["type", "child"], path);
    return Object.freeze({ type, child: normalizeBooleanNode(object.child, `${path}.child`, state, depth + 1) });
  }
  if (type === "condition") {
    onlyKeys(object, ["type", "condition"], path);
    return Object.freeze({ type, condition: normalizeCondition(object.condition, `${path}.condition`, state, depth + 1) });
  }
  if (type === "sequence") {
    onlyKeys(object, ["type", "steps", "within"], path);
    if (!Array.isArray(object.steps) || object.steps.length < 2 || object.steps.length > 32) {
      fail("sequence requires 2 to 32 steps", `${path}.steps`);
    }
    const within = object.within === undefined ? undefined : normalizeWindow(object.within, `${path}.within`);
    return Object.freeze({
      type,
      steps: Object.freeze(object.steps.map((step, index) => normalizeBooleanNode(step, `${path}.steps[${index}]`, state, depth + 1))),
      ...(within ? { within } : {}),
    });
  }
  if (type === "within") {
    onlyKeys(object, ["type", "child", "window"], path);
    return Object.freeze({
      type,
      child: normalizeBooleanNode(object.child, `${path}.child`, state, depth + 1),
      window: normalizeWindow(object.window, `${path}.window`),
    });
  }
  if (type === "sustain") {
    onlyKeys(object, ["type", "child", "count", "unit"], path);
    return Object.freeze({
      type,
      child: normalizeBooleanNode(object.child, `${path}.child`, state, depth + 1),
      count: number(object.count, `${path}.count`, { min: 1, max: 100_000, integer: true }),
      unit: enumValue(object.unit, new Set(["events", "bars"]), `${path}.unit`),
    });
  }
  onlyKeys(object, ["type", "child", "atLeast", "window"], path);
  return Object.freeze({
    type,
    child: normalizeBooleanNode(object.child, `${path}.child`, state, depth + 1),
    atLeast: number(object.atLeast, `${path}.atLeast`, { min: 1, max: 100_000, integer: true }),
    window: normalizeWindow(object.window, `${path}.window`),
  });
}

function normalizeMarketSelector(value, path) {
  const object = plainObject(value, path);
  const kind = enumValue(object.kind, new Set(["fixed", "current", "universe"]), `${path}.kind`);
  if (kind === "fixed") {
    onlyKeys(object, ["kind", "marketIds"], path);
    return Object.freeze({
      kind,
      marketIds: stringArray(object.marketIds, `${path}.marketIds`, {
        max: TRADING_ALERT_LIMITS.maxMarketsPerContext,
        identifierItems: true,
      }).map((entry) => entry.toUpperCase()),
    });
  }
  if (kind === "current") {
    onlyKeys(object, ["kind"], path);
    return Object.freeze({ kind });
  }
  onlyKeys(object, ["kind", "provider", "venue", "marketType", "quoteAsset", "frozenMarketIds"], path);
  const quoteAsset = object.quoteAsset === undefined ? undefined : identifier(object.quoteAsset, `${path}.quoteAsset`).toUpperCase();
  const frozenMarketIds = object.frozenMarketIds === undefined
    ? undefined
    : stringArray(object.frozenMarketIds, `${path}.frozenMarketIds`, {
      max: TRADING_ALERT_LIMITS.maxMarketsPerContext,
      identifierItems: true,
      allowEmpty: true,
    }).map((entry) => entry.toUpperCase());
  return Object.freeze({
    kind,
    provider: identifier(object.provider, `${path}.provider`).toLowerCase(),
    venue: identifier(object.venue, `${path}.venue`).toLowerCase(),
    marketType: identifier(object.marketType, `${path}.marketType`).toLowerCase(),
    ...(quoteAsset ? { quoteAsset } : {}),
    ...(frozenMarketIds ? { frozenMarketIds: Object.freeze(frozenMarketIds) } : {}),
  });
}

function normalizeDrawingBinding(value, path) {
  if (value === undefined || value === null) return undefined;
  const object = plainObject(value, path);
  onlyKeys(object, ["drawingId", "drawingRevision", "marketId", "interval", "geometryMode"], path);
  return Object.freeze({
    drawingId: identifier(object.drawingId, `${path}.drawingId`),
    drawingRevision: number(object.drawingRevision, `${path}.drawingRevision`, { min: 1, max: Number.MAX_SAFE_INTEGER, integer: true }),
    marketId: identifier(object.marketId, `${path}.marketId`).toUpperCase(),
    interval: identifier(object.interval, `${path}.interval`).toLowerCase(),
    geometryMode: enumValue(object.geometryMode, new Set(["segment", "ray", "extended"]), `${path}.geometryMode`),
  });
}

function normalizeContext(value, index) {
  const path = `contexts[${index}]`;
  const object = plainObject(value, path);
  onlyKeys(object, ["contextId", "marketSelector", "intervals", "drawingBinding"], path);
  const intervals = stringArray(object.intervals, `${path}.intervals`, {
    max: TRADING_ALERT_LIMITS.maxIntervalsPerContext,
    identifierItems: true,
  }).map((entry) => entry.toLowerCase());
  const drawingBinding = normalizeDrawingBinding(object.drawingBinding, `${path}.drawingBinding`);
  const marketSelector = normalizeMarketSelector(object.marketSelector, `${path}.marketSelector`);
  if (drawingBinding) {
    if (marketSelector.kind !== "fixed" || marketSelector.marketIds.length !== 1 || marketSelector.marketIds[0] !== drawingBinding.marketId) {
      fail("drawing binding requires exactly its fixed market", `${path}.marketSelector`);
    }
    if (intervals.length !== 1 || intervals[0] !== drawingBinding.interval) {
      fail("drawing binding requires exactly its fixed interval", `${path}.intervals`);
    }
  }
  return Object.freeze({
    contextId: identifier(object.contextId, `${path}.contextId`),
    marketSelector,
    intervals: Object.freeze(intervals),
    ...(drawingBinding ? { drawingBinding } : {}),
  });
}

export function normalizeDataRequirement(value, path = "dataRequirement") {
  const object = plainObject(value, path);
  onlyKeys(object, [
    "requirementId", "capability", "fields", "markets", "minFrequencyMs", "maxLatencyMs",
    "historyWindow", "permission", "status", "candidateProviders", "selectedProvider",
  ], path);
  const markets = object.markets === undefined
    ? undefined
    : stringArray(object.markets, `${path}.markets`, { max: 256, identifierItems: true, allowEmpty: true }).map((entry) => entry.toUpperCase());
  const selectedProvider = object.selectedProvider === undefined
    ? undefined
    : identifier(object.selectedProvider, `${path}.selectedProvider`).toLowerCase();
  return Object.freeze({
    requirementId: identifier(object.requirementId, `${path}.requirementId`),
    capability: identifier(object.capability, `${path}.capability`),
    fields: stringArray(object.fields, `${path}.fields`, { max: 128, identifierItems: true }),
    ...(markets ? { markets: Object.freeze(markets) } : {}),
    ...(object.minFrequencyMs === undefined ? {} : { minFrequencyMs: number(object.minFrequencyMs, `${path}.minFrequencyMs`, { min: 1, max: 86_400_000, integer: true }) }),
    ...(object.maxLatencyMs === undefined ? {} : { maxLatencyMs: number(object.maxLatencyMs, `${path}.maxLatencyMs`, { min: 0, max: 86_400_000, integer: true }) }),
    ...(object.historyWindow === undefined ? {} : { historyWindow: number(object.historyWindow, `${path}.historyWindow`, { min: 0, max: 1_000_000, integer: true }) }),
    permission: enumValue(object.permission, REQUIREMENT_PERMISSIONS, `${path}.permission`),
    status: enumValue(object.status, REQUIREMENT_STATUSES, `${path}.status`),
    candidateProviders: stringArray(object.candidateProviders ?? [], `${path}.candidateProviders`, {
      max: 64,
      identifierItems: true,
      allowEmpty: true,
    }).map((entry) => entry.toLowerCase()),
    ...(selectedProvider ? { selectedProvider } : {}),
  });
}

function normalizeEvaluationPolicy(value) {
  const path = "evaluationPolicy";
  const object = plainObject(value, path);
  onlyKeys(object, ["clock", "anchorContextId", "joinMode", "maxDataAgeMs", "unknownPolicy"], path);
  return Object.freeze({
    clock: enumValue(object.clock, new Set(["tick", "trade", "bar_update", "bar_close", "mixed"]), `${path}.clock`),
    anchorContextId: identifier(object.anchorContextId, `${path}.anchorContextId`),
    joinMode: enumValue(object.joinMode, new Set(["latest_closed", "same_close_time", "explicit_window"]), `${path}.joinMode`),
    maxDataAgeMs: number(object.maxDataAgeMs, `${path}.maxDataAgeMs`, { min: 1, max: 86_400_000, integer: true }),
    unknownPolicy: enumValue(object.unknownPolicy, new Set(["do_not_trigger"]), `${path}.unknownPolicy`),
  });
}

function normalizeTriggerPolicy(value) {
  const path = "triggerPolicy";
  const object = plainObject(value, path);
  onlyKeys(object, ["mode", "edge", "rearm", "cooldownMs", "maxTriggersTotal", "maxTriggersPerDay", "resumePolicy"], path);
  const mode = enumValue(object.mode, new Set(["once", "repeat"]), `${path}.mode`);
  const result = {
    mode,
    edge: enumValue(object.edge, new Set(["false_to_true"]), `${path}.edge`),
    rearm: enumValue(object.rearm, new Set(["must_become_false", "next_bar", "after_cooldown"]), `${path}.rearm`),
    resumePolicy: enumValue(object.resumePolicy, new Set(["baseline_only_no_catch_up"]), `${path}.resumePolicy`),
  };
  const cooldownMs = optionalFiniteNumber(object.cooldownMs, `${path}.cooldownMs`, { min: 0, max: 31_536_000_000, integer: true });
  const maxTriggersTotal = optionalFiniteNumber(object.maxTriggersTotal, `${path}.maxTriggersTotal`, { min: 1, max: 1_000_000, integer: true });
  const maxTriggersPerDay = optionalFiniteNumber(object.maxTriggersPerDay, `${path}.maxTriggersPerDay`, { min: 1, max: 1_000_000, integer: true });
  if (mode === "once" && maxTriggersTotal !== undefined && maxTriggersTotal !== 1) {
    fail("once mode can only have maxTriggersTotal=1", `${path}.maxTriggersTotal`);
  }
  if (result.rearm === "after_cooldown" && cooldownMs === undefined) {
    fail("after_cooldown requires cooldownMs", `${path}.cooldownMs`);
  }
  if (cooldownMs !== undefined) result.cooldownMs = cooldownMs;
  if (maxTriggersTotal !== undefined) result.maxTriggersTotal = maxTriggersTotal;
  if (maxTriggersPerDay !== undefined) result.maxTriggersPerDay = maxTriggersPerDay;
  return Object.freeze(result);
}

function collectConditionContextIds(node, result = new Set()) {
  if (node.type === "condition") result.add(node.condition.contextId);
  if (node.child) collectConditionContextIds(node.child, result);
  for (const child of node.children || node.steps || []) collectConditionContextIds(child, result);
  return result;
}

function collectConditionIds(node, result = []) {
  if (node.type === "condition") result.push(node.condition.conditionId);
  if (node.child) collectConditionIds(node.child, result);
  for (const child of node.children || node.steps || []) collectConditionIds(child, result);
  return result;
}

export function alertRuleSemanticPayload(rule) {
  return {
    schemaVersion: rule.schemaVersion,
    title: rule.title,
    root: rule.root,
    contexts: rule.contexts,
    evaluationPolicy: rule.evaluationPolicy,
    triggerPolicy: rule.triggerPolicy,
    dataRequirements: rule.dataRequirements,
    sourceText: rule.sourceText,
    normalizedSummary: rule.normalizedSummary,
  };
}

export function alertRuleHash(rule) {
  return stableHash(alertRuleSemanticPayload(rule));
}

export function normalizeAlertRule(value = {}) {
  const object = plainObject(value, "rule");
  onlyKeys(object, [
    "schemaVersion", "ruleId", "revision", "title", "root", "contexts", "evaluationPolicy",
    "triggerPolicy", "dataRequirements", "sourceText", "normalizedSummary", "createdAt", "ruleHash",
  ], "rule");
  if (Number(object.schemaVersion) !== TRADING_ALERT_SCHEMA_VERSION) fail("unsupported schemaVersion", "rule.schemaVersion");
  if (!Array.isArray(object.contexts) || !object.contexts.length || object.contexts.length > TRADING_ALERT_LIMITS.maxContexts) {
    fail(`must contain 1 to ${TRADING_ALERT_LIMITS.maxContexts} contexts`, "rule.contexts");
  }
  const contexts = Object.freeze(object.contexts.map(normalizeContext));
  const contextIds = contexts.map((context) => context.contextId);
  if (new Set(contextIds).size !== contextIds.length) fail("contextId values must be unique", "rule.contexts");
  const state = { nodes: 0 };
  const root = normalizeBooleanNode(object.root, "rule.root", state);
  const referencedContexts = collectConditionContextIds(root);
  for (const contextId of referencedContexts) {
    if (!contextIds.includes(contextId)) fail(`references unknown context ${contextId}`, "rule.root");
  }
  const conditionIds = collectConditionIds(root);
  if (new Set(conditionIds).size !== conditionIds.length) fail("conditionId values must be unique", "rule.root");
  const evaluationPolicy = normalizeEvaluationPolicy(object.evaluationPolicy);
  if (!contextIds.includes(evaluationPolicy.anchorContextId)) {
    fail("anchorContextId must reference a declared context", "rule.evaluationPolicy.anchorContextId");
  }
  const requirements = object.dataRequirements ?? [];
  if (!Array.isArray(requirements) || requirements.length > TRADING_ALERT_LIMITS.maxDataRequirements) {
    fail(`must contain at most ${TRADING_ALERT_LIMITS.maxDataRequirements} requirements`, "rule.dataRequirements");
  }
  const dataRequirements = Object.freeze(requirements.map((requirement, index) => normalizeDataRequirement(requirement, `rule.dataRequirements[${index}]`)));
  const requirementIds = dataRequirements.map((entry) => entry.requirementId);
  if (new Set(requirementIds).size !== requirementIds.length) fail("requirementId values must be unique", "rule.dataRequirements");
  const normalized = {
    schemaVersion: TRADING_ALERT_SCHEMA_VERSION,
    ruleId: identifier(object.ruleId, "rule.ruleId"),
    revision: number(object.revision, "rule.revision", { min: 1, max: Number.MAX_SAFE_INTEGER, integer: true }),
    title: text(object.title, "rule.title", { max: 200 }),
    root,
    contexts,
    evaluationPolicy,
    triggerPolicy: normalizeTriggerPolicy(object.triggerPolicy),
    dataRequirements,
    sourceText: text(object.sourceText, "rule.sourceText"),
    normalizedSummary: text(object.normalizedSummary, "rule.normalizedSummary"),
    createdAt: number(object.createdAt, "rule.createdAt", { min: 1, max: Number.MAX_SAFE_INTEGER, integer: true }),
  };
  const computedHash = alertRuleHash(normalized);
  if (object.ruleHash !== undefined && object.ruleHash !== computedHash) fail("does not match normalized rule", "rule.ruleHash");
  return Object.freeze({ ...normalized, ruleHash: computedHash });
}

export function createAlertRuleRevision(previousRule, nextValue) {
  const previous = normalizeAlertRule(previousRule);
  const candidate = plainObject(nextValue, "nextRule");
  return normalizeAlertRule({
    ...candidate,
    schemaVersion: TRADING_ALERT_SCHEMA_VERSION,
    ruleId: previous.ruleId,
    revision: previous.revision + 1,
    createdAt: previous.createdAt,
  });
}

export function normalizeAlertDraft(value = {}) {
  const object = plainObject(value, "draft");
  onlyKeys(object, [
    "schemaVersion", "draftId", "sourceText", "status", "rule", "missingFields", "ambiguities",
    "questions", "conversation", "dataRequirements", "createdAt", "updatedAt", "originThreadId", "error",
  ], "draft");
  if (Number(object.schemaVersion) !== TRADING_ALERT_SCHEMA_VERSION) fail("unsupported schemaVersion", "draft.schemaVersion");
  const createdAt = number(object.createdAt, "draft.createdAt", { min: 1, max: Number.MAX_SAFE_INTEGER, integer: true });
  const updatedAt = number(object.updatedAt, "draft.updatedAt", { min: createdAt, max: Number.MAX_SAFE_INTEGER, integer: true });
  const requirements = object.dataRequirements ?? [];
  if (!Array.isArray(requirements) || requirements.length > TRADING_ALERT_LIMITS.maxDataRequirements) {
    fail(`must contain at most ${TRADING_ALERT_LIMITS.maxDataRequirements} requirements`, "draft.dataRequirements");
  }
  const error = object.error === undefined || object.error === null
    ? undefined
    : text(object.error, "draft.error", { max: 1_000 });
  const conversation = object.conversation ?? [];
  if (!Array.isArray(conversation) || conversation.length > 32) {
    fail("must contain at most 32 turns", "draft.conversation");
  }
  return Object.freeze({
    schemaVersion: TRADING_ALERT_SCHEMA_VERSION,
    draftId: identifier(object.draftId, "draft.draftId"),
    sourceText: text(object.sourceText, "draft.sourceText"),
    status: enumValue(object.status, new Set(ALERT_DRAFT_STATUSES), "draft.status"),
    rule: object.rule === undefined || object.rule === null ? null : normalizeAlertRule(object.rule),
    missingFields: stringArray(object.missingFields ?? [], "draft.missingFields", { max: 64, allowEmpty: true }),
    ambiguities: stringArray(object.ambiguities ?? [], "draft.ambiguities", { max: 64, allowEmpty: true }),
    questions: stringArray(object.questions ?? [], "draft.questions", { max: 32, allowEmpty: true }),
    conversation: Object.freeze(conversation.map((turn, index) => {
      const normalizedTurn = plainObject(turn, `draft.conversation[${index}]`);
      onlyKeys(normalizedTurn, ["role", "text"], `draft.conversation[${index}]`);
      return Object.freeze({
        role: enumValue(normalizedTurn.role, new Set(["user", "assistant"]), `draft.conversation[${index}].role`),
        text: text(normalizedTurn.text, `draft.conversation[${index}].text`, { max: 8_000 }),
      });
    })),
    dataRequirements: Object.freeze(requirements.map((requirement, index) => normalizeDataRequirement(requirement, `draft.dataRequirements[${index}]`))),
    createdAt,
    updatedAt,
    ...(object.originThreadId ? { originThreadId: identifier(object.originThreadId, "draft.originThreadId") } : {}),
    ...(error ? { error } : {}),
  });
}

export function normalizeMonitoringGap(value = {}) {
  const object = plainObject(value, "gap");
  onlyKeys(object, ["gapId", "alertId", "startedAt", "endedAt", "reason", "lastGoodEventAt", "resumedAt", "catchUpEvaluated"], "gap");
  const startedAt = number(object.startedAt, "gap.startedAt", { min: 1, max: Number.MAX_SAFE_INTEGER, integer: true });
  const endedAt = number(object.endedAt, "gap.endedAt", { min: startedAt, max: Number.MAX_SAFE_INTEGER, integer: true });
  const lastGoodEventAt = optionalFiniteNumber(object.lastGoodEventAt, "gap.lastGoodEventAt", { min: 1, max: endedAt, integer: true });
  if (object.catchUpEvaluated !== false) fail("must be false", "gap.catchUpEvaluated");
  return Object.freeze({
    gapId: identifier(object.gapId, "gap.gapId"),
    alertId: identifier(object.alertId, "gap.alertId"),
    startedAt,
    endedAt,
    reason: enumValue(object.reason, new Set(["app_stopped", "system_sleep", "network_offline", "provider_disconnected", "unknown"]), "gap.reason"),
    ...(lastGoodEventAt === undefined ? {} : { lastGoodEventAt }),
    resumedAt: number(object.resumedAt, "gap.resumedAt", { min: endedAt, max: Number.MAX_SAFE_INTEGER, integer: true }),
    catchUpEvaluated: false,
  });
}

export function normalizeAlertInstance(value = {}) {
  const object = plainObject(value, "alert");
  onlyKeys(object, [
    "schemaVersion", "alertId", "draftId", "rule", "ruleHash", "simulationId", "confirmationId",
    "status", "enabled", "createdAt", "updatedAt", "armedAt", "lastEvaluatedAt", "lastTriggeredAt",
    "triggerCount", "rearmState", "latestGapId", "latestEvidenceId", "originThreadId", "failure",
  ], "alert");
  if (Number(object.schemaVersion) !== TRADING_ALERT_SCHEMA_VERSION) fail("unsupported schemaVersion", "alert.schemaVersion");
  const rule = normalizeAlertRule(object.rule);
  if (object.ruleHash !== rule.ruleHash) fail("does not match rule", "alert.ruleHash");
  const createdAt = number(object.createdAt, "alert.createdAt", { min: 1, max: Number.MAX_SAFE_INTEGER, integer: true });
  const updatedAt = number(object.updatedAt, "alert.updatedAt", { min: createdAt, max: Number.MAX_SAFE_INTEGER, integer: true });
  const optionalTime = (field) => optionalFiniteNumber(object[field], `alert.${field}`, { min: createdAt, max: Number.MAX_SAFE_INTEGER, integer: true });
  const failure = object.failure === undefined || object.failure === null
    ? undefined
    : text(object.failure, "alert.failure", { max: 1_000 });
  return Object.freeze({
    schemaVersion: TRADING_ALERT_SCHEMA_VERSION,
    alertId: identifier(object.alertId, "alert.alertId"),
    draftId: identifier(object.draftId, "alert.draftId"),
    rule,
    ruleHash: rule.ruleHash,
    simulationId: identifier(object.simulationId, "alert.simulationId"),
    confirmationId: identifier(object.confirmationId, "alert.confirmationId"),
    status: enumValue(object.status, new Set(ALERT_INSTANCE_STATUSES), "alert.status"),
    enabled: Boolean(object.enabled),
    createdAt,
    updatedAt,
    ...(optionalTime("armedAt") === undefined ? {} : { armedAt: optionalTime("armedAt") }),
    ...(optionalTime("lastEvaluatedAt") === undefined ? {} : { lastEvaluatedAt: optionalTime("lastEvaluatedAt") }),
    ...(optionalTime("lastTriggeredAt") === undefined ? {} : { lastTriggeredAt: optionalTime("lastTriggeredAt") }),
    triggerCount: number(object.triggerCount, "alert.triggerCount", { min: 0, max: Number.MAX_SAFE_INTEGER, integer: true }),
    rearmState: enumValue(object.rearmState, new Set(["unarmed", "armed", "waiting_false", "cooldown"]), "alert.rearmState"),
    ...(object.latestGapId ? { latestGapId: identifier(object.latestGapId, "alert.latestGapId") } : {}),
    ...(object.latestEvidenceId ? { latestEvidenceId: identifier(object.latestEvidenceId, "alert.latestEvidenceId") } : {}),
    ...(object.originThreadId ? { originThreadId: identifier(object.originThreadId, "alert.originThreadId") } : {}),
    ...(failure ? { failure } : {}),
  });
}

export function normalizeTriggerEvidence(value = {}) {
  const object = plainObject(value, "evidence");
  onlyKeys(object, [
    "schemaVersion", "evidenceId", "alertId", "ruleRevision", "ruleHash", "triggerEventId", "triggeredAt",
    "contexts", "conditionResults", "inputHash",
  ], "evidence");
  if (Number(object.schemaVersion) !== TRADING_ALERT_SCHEMA_VERSION) fail("unsupported schemaVersion", "evidence.schemaVersion");
  if (!Array.isArray(object.contexts) || !object.contexts.length || object.contexts.length > 64) fail("must contain 1 to 64 contexts", "evidence.contexts");
  if (!Array.isArray(object.conditionResults) || !object.conditionResults.length || object.conditionResults.length > TRADING_ALERT_LIMITS.maxAstNodes) {
    fail("must contain condition results", "evidence.conditionResults");
  }
  const contexts = object.contexts.map((context, index) => {
    const path = `evidence.contexts[${index}]`;
    const entry = plainObject(context, path);
    onlyKeys(entry, ["marketId", "interval", "eventTime", "candle", "source", "coverage", "drawings"], path);
    const drawings = entry.drawings === undefined ? [] : Array.isArray(entry.drawings) ? entry.drawings : fail("must be an array", `${path}.drawings`);
    if (drawings.length > 32) fail("must contain at most 32 drawings", `${path}.drawings`);
    return Object.freeze({
      marketId: identifier(entry.marketId, `${path}.marketId`).toUpperCase(),
      interval: identifier(entry.interval, `${path}.interval`).toLowerCase(),
      eventTime: number(entry.eventTime, `${path}.eventTime`, { min: 1, max: Number.MAX_SAFE_INTEGER, integer: true }),
      ...(entry.candle === undefined ? {} : { candle: structuredClone(entry.candle) }),
      source: text(entry.source, `${path}.source`, { max: 160 }),
      coverage: structuredClone(plainObject(entry.coverage, `${path}.coverage`)),
      ...(drawings.length ? { drawings: Object.freeze(drawings.map((drawing, drawingIndex) => {
        const drawingPath = `${path}.drawings[${drawingIndex}]`;
        const item = plainObject(drawing, drawingPath);
        onlyKeys(item, ["drawingId", "marketId", "interval", "geometryMode", "points", "revision"], drawingPath);
        if (!Array.isArray(item.points) || item.points.length < 2 || item.points.length > 16) fail("must contain 2 to 16 points", `${drawingPath}.points`);
        return Object.freeze({ drawingId: identifier(item.drawingId, `${drawingPath}.drawingId`), marketId: identifier(item.marketId, `${drawingPath}.marketId`).toUpperCase(), interval: identifier(item.interval, `${drawingPath}.interval`).toLowerCase(), geometryMode: enumValue(item.geometryMode, new Set(["segment", "ray", "extended"]), `${drawingPath}.geometryMode`), revision: number(item.revision, `${drawingPath}.revision`, { min: 1, max: Number.MAX_SAFE_INTEGER, integer: true }), points: Object.freeze(item.points.map((point, pointIndex) => { const value = plainObject(point, `${drawingPath}.points[${pointIndex}]`); onlyKeys(value, ["time", "price"], `${drawingPath}.points[${pointIndex}]`); return Object.freeze({ time: number(value.time, `${drawingPath}.points[${pointIndex}].time`, { min: 1, max: Number.MAX_SAFE_INTEGER, integer: true }), price: number(value.price, `${drawingPath}.points[${pointIndex}].price`, { min: Number.EPSILON }) }); })) });
      })) } : {}),
    });
  });
  const conditionResults = object.conditionResults.map((condition, index) => {
    const path = `evidence.conditionResults[${index}]`;
    const entry = plainObject(condition, path);
    onlyKeys(entry, ["conditionId", "result", "previousValues", "currentValues"], path);
    const result = entry.result === true || entry.result === false || entry.result === "unknown"
      ? entry.result
      : fail("must be true, false, or unknown", `${path}.result`);
    return Object.freeze({
      conditionId: identifier(entry.conditionId, `${path}.conditionId`),
      result,
      ...(entry.previousValues === undefined ? {} : { previousValues: structuredClone(plainObject(entry.previousValues, `${path}.previousValues`)) }),
      ...(entry.currentValues === undefined ? {} : { currentValues: structuredClone(plainObject(entry.currentValues, `${path}.currentValues`)) }),
    });
  });
  return Object.freeze({
    schemaVersion: TRADING_ALERT_SCHEMA_VERSION,
    evidenceId: identifier(object.evidenceId, "evidence.evidenceId"),
    alertId: identifier(object.alertId, "evidence.alertId"),
    ruleRevision: number(object.ruleRevision, "evidence.ruleRevision", { min: 1, max: Number.MAX_SAFE_INTEGER, integer: true }),
    ruleHash: text(object.ruleHash, "evidence.ruleHash", { max: 64 }),
    triggerEventId: identifier(object.triggerEventId, "evidence.triggerEventId"),
    triggeredAt: number(object.triggeredAt, "evidence.triggeredAt", { min: 1, max: Number.MAX_SAFE_INTEGER, integer: true }),
    contexts: Object.freeze(contexts),
    conditionResults: Object.freeze(conditionResults),
    inputHash: text(object.inputHash, "evidence.inputHash", { max: 64 }),
  });
}

export function normalizeCoverage(value, path = "coverage") {
  return enumValue(value, COVERAGE_STATUSES, path);
}
