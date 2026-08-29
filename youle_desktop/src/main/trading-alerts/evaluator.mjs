import { stableHash } from "./protocol.mjs";
import { createBuiltinIndicatorRegistry } from "./indicator-registry.mjs";
import { drawingPriceAtTime, drawingTolerance } from "./drawing-geometry.mjs";

export const UNKNOWN = "unknown";
const finite = Number.isFinite;

function triNot(value) { return value === UNKNOWN ? UNKNOWN : !value; }
function triAll(values) { return values.includes(false) ? false : values.includes(UNKNOWN) ? UNKNOWN : true; }
function triAny(values) { return values.includes(true) ? true : values.includes(UNKNOWN) ? UNKNOWN : false; }

function frameAt(frames, contextId) {
  return frames instanceof Map ? frames.get(contextId) : frames?.[contextId];
}

function valueAt(expr, context, index, services) {
  if (!context) return { value: UNKNOWN, reason: "context_missing" };
  const candles = context.candles || [];
  const candle = candles[index];
  if (expr.type === "constant") return { value: expr.value };
  if (expr.type === "field") {
    const value = expr.field === "last" ? context.last ?? candle?.close : expr.field === "mark" ? context.mark : expr.field === "index" ? context.index : candle?.[expr.field];
    return finite(value) ? { value } : { value: UNKNOWN, reason: `field_unavailable:${expr.field}` };
  }
  if (expr.type === "lag") {
    const laggedIndex = index - expr.bars;
    return laggedIndex >= 0
      ? valueAt(expr.expr, context, laggedIndex, services)
      : { value: UNKNOWN, reason: "lag_history_insufficient" };
  }
  if (expr.type === "rolling") {
    const end = index - expr.offset;
    const start = end - expr.period + 1;
    if (start < 0 || end < start) return { value: UNKNOWN, reason: "rolling_history_insufficient" };
    const entries = [];
    for (let cursor = start; cursor <= end; cursor += 1) {
      const entry = valueAt(expr.expr, context, cursor, services);
      if (entry.value === UNKNOWN) return entry;
      entries.push(entry.value);
    }
    const value = expr.op === "min"
      ? Math.min(...entries)
      : expr.op === "max"
        ? Math.max(...entries)
        : expr.op === "sum"
          ? entries.reduce((sum, entry) => sum + entry, 0)
          : entries.reduce((sum, entry) => sum + entry, 0) / entries.length;
    return finite(value) ? { value } : { value: UNKNOWN, reason: "rolling_non_finite" };
  }
  if (expr.type === "indicator") return services.indicators.evaluate(expr, candles, index);
  if (expr.type === "drawing") {
    const drawing = context.drawings?.[expr.drawingId] || services.drawings?.[expr.drawingId];
    if (!drawing || drawing.deleted) return { value: UNKNOWN, reason: "drawing_missing" };
    // A chart plots the whole OHLC candle at its opening timestamp. Sampling a
    // drawing at closeTime shifts sloped lines by one complete bar, so a candle
    // can be reported as touching a point it visibly has not reached yet.
    return drawingPriceAtTime(drawing, candle?.time ?? context.time);
  }
  if (expr.type === "external") {
    const key = `${expr.capability}.${expr.field}`;
    const value = context.external?.[key] ?? services.external?.[key];
    return finite(value) ? { value } : { value: UNKNOWN, reason: `external_unavailable:${key}` };
  }
  const operands = expr.args.map((arg) => valueAt(arg, context, index, services));
  if (operands.some((entry) => entry.value === UNKNOWN)) return { value: UNKNOWN, reason: operands.find((entry) => entry.reason)?.reason || "operand_unknown" };
  const values = operands.map((entry) => entry.value);
  let value;
  if (expr.op === "add") value = values.reduce((sum, item) => sum + item, 0);
  else if (expr.op === "sub") value = values[0] - values[1];
  else if (expr.op === "mul") value = values.reduce((sum, item) => sum * item, 1);
  else if (expr.op === "div") value = values[1] === 0 ? Number.NaN : values[0] / values[1];
  else if (expr.op === "abs") value = Math.abs(values[0]);
  else if (expr.op === "min") value = Math.min(...values);
  else if (expr.op === "max") value = Math.max(...values);
  else if (expr.op === "percent_change") value = values[1] === 0 ? Number.NaN : (values[0] / values[1] - 1) * 100;
  return finite(value) ? { value } : { value: UNKNOWN, reason: "math_non_finite" };
}

function compare(operator, left, right, previousLeft, previousRight, tolerance) {
  if ([left, right].includes(UNKNOWN)) return UNKNOWN;
  const close = Math.abs(left - right) <= tolerance;
  if (operator === "gt") return left > right;
  if (operator === "gte") return left >= right;
  if (operator === "lt") return left < right;
  if (operator === "lte") return left <= right;
  if (operator === "eq" || operator === "touch") return close;
  if (operator === "neq") return !close;
  if (operator === "inside") return Math.abs(left) <= Math.abs(right) + tolerance;
  if (operator === "outside") return Math.abs(left) > Math.abs(right) + tolerance;
  if (operator === "rises_by") return left - right >= tolerance;
  if (operator === "falls_by") return right - left >= tolerance;
  if ([previousLeft, previousRight].includes(UNKNOWN)) return UNKNOWN;
  if (operator === "cross_over" || operator === "break_above") return previousLeft <= previousRight + tolerance && left > right + tolerance;
  if (operator === "cross_under" || operator === "break_below") return previousLeft >= previousRight - tolerance && left < right - tolerance;
  return UNKNOWN;
}

function eventPosition(context, fallbackTime) {
  const index = Number.isInteger(context?.index) ? context.index : (context?.candles?.length || 1) - 1;
  const candle = context?.candles?.[index];
  return { index, time: Number(candle?.closeTime ?? candle?.time ?? context?.time ?? fallbackTime) };
}

export class TradingAlertEvaluator {
  constructor({ indicatorRegistry = createBuiltinIndicatorRegistry(), drawings = {}, external = {}, tickSize = 0, hashInputs = true } = {}) {
    this.services = { indicators: indicatorRegistry, drawings, external, tickSize };
    this.hashInputs = hashInputs !== false;
    this.state = new Map();
  }

  evaluate(rule, event) {
    const frames = event.frames || {};
    const staleContexts = [];
    const closeTimes = [];
    for (const context of rule.contexts) {
      const frame = frameAt(frames, context.contextId);
      const age = Number(event.time) - Number(frame?.receivedAt ?? frame?.time ?? 0);
      if (!frame || frame.coverage === "unavailable" || frame.coverage === "partial" || frame.coverage === "delayed" || age > rule.evaluationPolicy.maxDataAgeMs) staleContexts.push(context.contextId);
      const position = eventPosition(frame, event.time);
      if (Number.isFinite(position.time)) closeTimes.push(position.time);
    }
    if (staleContexts.length) return this.result(rule, event, UNKNOWN, { reason: "data_unavailable_or_stale", staleContexts });
    if (rule.evaluationPolicy.joinMode === "same_close_time" && new Set(closeTimes).size > 1) {
      return this.result(rule, event, UNKNOWN, { reason: "contexts_not_aligned", closeTimes });
    }
    const trace = [];
    const value = this.evaluateNode(rule.root, "root", rule, event, trace);
    return this.result(rule, event, value, { trace });
  }

  evaluateNode(node, key, rule, event, trace) {
    if (node.type === "condition") {
      const context = frameAt(event.frames, node.condition.contextId);
      const { index } = eventPosition(context, event.time);
      if (node.condition.confirmation === "bar_close" && context.closed !== true) return UNKNOWN;
      const left = valueAt(node.condition.left, context, index, this.services);
      const right = valueAt(node.condition.right, context, index, this.services);
      const previousLeft = index > 0 ? valueAt(node.condition.left, context, index - 1, this.services) : { value: UNKNOWN };
      const previousRight = index > 0 ? valueAt(node.condition.right, context, index - 1, this.services) : { value: UNKNOWN };
      const tolerance = drawingTolerance(node.condition.tolerance, { tickSize: context.tickSize || this.services.tickSize, atr: context.atr || 0, reference: right.value });
      const value = compare(node.condition.operator, left.value, right.value, previousLeft.value, previousRight.value, tolerance);
      trace.push({ key, conditionId: node.condition.conditionId, value, left: left.value, right: right.value, previousLeft: previousLeft.value, previousRight: previousRight.value, tolerance });
      return value;
    }
    if (node.type === "not") return triNot(this.evaluateNode(node.child, `${key}.not`, rule, event, trace));
    if (node.type === "all") return triAll(node.children.map((child, i) => this.evaluateNode(child, `${key}.${i}`, rule, event, trace)));
    if (node.type === "any") return triAny(node.children.map((child, i) => this.evaluateNode(child, `${key}.${i}`, rule, event, trace)));
    const state = this.state.get(key) || { count: 0, hits: [], step: 0, startedAt: null };
    const now = Number(event.time);
    if (node.type === "sequence") {
      const active = this.evaluateNode(node.steps[state.step], `${key}.${state.step}`, rule, event, trace);
      if (active === true && state.lastStepEventId !== event.eventId) {
        if (state.step === 0) state.startedAt = now;
        state.step += 1;
        state.lastStepEventId = event.eventId;
      }
      const expired = node.within && state.startedAt && now - state.startedAt > windowMilliseconds(node.within, event);
      const completed = state.step >= node.steps.length && !expired;
      if (completed || expired) Object.assign(state, { step: 0, startedAt: null, lastStepEventId: null });
      this.state.set(key, state);
      return completed;
    }
    const current = this.evaluateNode(node.child, `${key}.0`, rule, event, trace);
    if (node.type === "sustain") {
      if (state.lastCountEventId !== event.eventId) {
        state.count = current === true ? state.count + 1 : current === false ? 0 : state.count;
        state.lastCountEventId = event.eventId;
      }
      this.state.set(key, state);
      return current === UNKNOWN ? UNKNOWN : state.count >= node.count;
    }
    if (node.type === "count" || node.type === "within") {
      const span = windowMilliseconds(node.window, event);
      if (current === true && state.lastHitEventId !== event.eventId) {
        state.hits.push(now);
        state.lastHitEventId = event.eventId;
      }
      state.hits = state.hits.filter((time) => now - time <= span);
      this.state.set(key, state);
      return node.type === "count" ? state.hits.length >= node.atLeast : state.hits.length > 0;
    }
    return UNKNOWN;
  }

  result(rule, event, value, extra) {
    const inputHash = this.hashInputs
      ? stableHash({ ruleHash: rule.ruleHash, eventId: event.eventId, time: event.time, frames: event.frames })
      : null;
    return Object.freeze({ value, triggered: value === true, inputHash, eventId: event.eventId, evaluatedAt: event.time, ...extra });
  }

  exportState() { return structuredClone(Object.fromEntries(this.state)); }
  importState(value = {}) { this.state = new Map(Object.entries(structuredClone(value))); }
}

function windowMilliseconds(window, event) {
  if (window.unit === "milliseconds") return window.value;
  return window.value * Math.max(1, Number(event.intervalMs) || 1);
}

export function evaluateReplay(rule, events, options = {}) {
  const evaluator = new TradingAlertEvaluator(options);
  return Object.freeze(events.map((event) => evaluator.evaluate(rule, event)));
}
