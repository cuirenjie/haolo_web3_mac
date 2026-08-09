import crypto from "node:crypto";

export const TRADING_ANALYSIS_SCHEMA_VERSION = 1;
const MAX_CANDLES = 600;
const MAX_CONTEXT_TIMEFRAMES = 3;
const MAX_CONTEXT_CANDLES = 300;
const MAX_ORDER_FLOW_TRADES = 2_000;
const MAX_ORDER_BOOK_LEVELS = 200;
const MAX_OPEN_INTEREST_POINTS = 120;
const ALLOWED_DRAWING_TOOLS = new Set(["path", "rectangle", "arrow-up", "arrow-down", "note"]);
const DRAWING_THEORY_STYLES = Object.freeze({
  chan: Object.freeze({
    layer: "ai/chan",
    colorTokens: new Set(["chan-pen", "chan-center", "chan-top", "chan-bottom", "chan-note"]),
  }),
  "order-flow": Object.freeze({
    layer: "ai/order-flow",
    colorTokens: new Set([
      "order-flow-buy",
      "order-flow-sell",
      "order-flow-poc",
      "order-flow-note",
      "order-flow-structure-bull",
      "order-flow-structure-bear",
      "order-flow-ob-bull",
      "order-flow-ob-bear",
      "order-flow-fvg-bull",
      "order-flow-fvg-bear",
      "order-flow-liquidity",
      "order-flow-equilibrium",
      "order-flow-ote",
    ]),
  }),
  wave: Object.freeze({
    layer: "ai/wave",
    colorTokens: new Set(["wave-primary", "wave-correction", "wave-alternative", "wave-fibonacci", "wave-note"]),
  }),
  wyckoff: Object.freeze({
    layer: "ai/wyckoff",
    colorTokens: new Set([
      "wyckoff-range",
      "wyckoff-demand",
      "wyckoff-supply",
      "wyckoff-phase",
      "wyckoff-event-bull",
      "wyckoff-event-bear",
      "wyckoff-projection",
      "wyckoff-note",
    ]),
  }),
  "price-action": Object.freeze({
    layer: "ai/price-action",
    colorTokens: new Set([
      "price-action-trend",
      "price-action-support",
      "price-action-resistance",
      "price-action-note",
    ]),
  }),
});
const DATA_COVERAGE_STATUSES = new Set(["available", "delayed", "partial", "unavailable"]);

function finiteNumber(value, field) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) throw new TypeError(`${field} must be finite`);
  return normalized;
}
function normalizeCandle(value, index) {
  const time = finiteNumber(value?.time, `candles[${index}].time`);
  const open = finiteNumber(value?.open, `candles[${index}].open`);
  const high = finiteNumber(value?.high, `candles[${index}].high`);
  const low = finiteNumber(value?.low, `candles[${index}].low`);
  const close = finiteNumber(value?.close, `candles[${index}].close`);
  const volume = Math.max(0, finiteNumber(value?.volume ?? 0, `candles[${index}].volume`));
  if (time <= 0 || low <= 0 || high < low || high < Math.max(open, close) || low > Math.min(open, close)) {
    throw new TypeError(`candles[${index}] has invalid OHLC values`);
  }
  return { time, open, high, low, close, volume };
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeCoverageStatus(value, fallback = "unavailable") {
  const normalized = String(value || "").trim();
  return DATA_COVERAGE_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizeOrderFlowLevel(value, context) {
  const price = finiteNumber(Array.isArray(value) ? value[0] : value?.price, `${context}.price`);
  const quantity = finiteNumber(Array.isArray(value) ? value[1] : value?.quantity, `${context}.quantity`);
  if (price <= 0 || quantity < 0) throw new TypeError(`${context} is invalid`);
  return { price, quantity };
}

function normalizeOrderFlow(value) {
  if (!value || typeof value !== "object") return undefined;
  const rawTrades = Array.isArray(value.trades) ? value.trades.slice(-MAX_ORDER_FLOW_TRADES) : [];
  const tradesById = new Map();
  rawTrades.forEach((trade, index) => {
    const time = finiteNumber(trade?.time, `orderFlow.trades[${index}].time`);
    const price = finiteNumber(trade?.price, `orderFlow.trades[${index}].price`);
    const quantity = finiteNumber(trade?.quantity, `orderFlow.trades[${index}].quantity`);
    const side = trade?.side === "buy" || trade?.side === "sell" ? trade.side : null;
    if (time <= 0 || price <= 0 || quantity <= 0 || !side) {
      throw new TypeError(`orderFlow.trades[${index}] is invalid`);
    }
    const id = String(trade?.id ?? `${time}:${price}:${quantity}:${side}`).slice(0, 120);
    tradesById.set(id, { id, time, price, quantity, side });
  });
  const trades = [...tradesById.values()].sort((first, second) => first.time - second.time);
  const depthValue = value.depth && typeof value.depth === "object" ? value.depth : {};
  const bids = (Array.isArray(depthValue.bids) ? depthValue.bids : [])
    .slice(0, MAX_ORDER_BOOK_LEVELS)
    .map((level, index) => normalizeOrderFlowLevel(level, `orderFlow.depth.bids[${index}]`))
    .sort((first, second) => second.price - first.price);
  const asks = (Array.isArray(depthValue.asks) ? depthValue.asks : [])
    .slice(0, MAX_ORDER_BOOK_LEVELS)
    .map((level, index) => normalizeOrderFlowLevel(level, `orderFlow.depth.asks[${index}]`))
    .sort((first, second) => first.price - second.price);
  const openInterestValue = value.openInterest && typeof value.openInterest === "object"
    ? value.openInterest
    : {};
  const currentOpenInterest = Number(openInterestValue.current);
  const openInterestHistory = (Array.isArray(openInterestValue.history) ? openInterestValue.history : [])
    .slice(-MAX_OPEN_INTEREST_POINTS)
    .map((point, index) => {
      const time = finiteNumber(point?.time, `orderFlow.openInterest.history[${index}].time`);
      const amount = finiteNumber(point?.value, `orderFlow.openInterest.history[${index}].value`);
      if (time <= 0 || amount < 0) throw new TypeError(`orderFlow.openInterest.history[${index}] is invalid`);
      return { time, value: amount };
    })
    .sort((first, second) => first.time - second.time);
  const coverageValue = value.coverage && typeof value.coverage === "object" ? value.coverage : {};
  const coverage = {
    trades: normalizeCoverageStatus(coverageValue.trades, trades.length ? "available" : "unavailable"),
    depth: normalizeCoverageStatus(coverageValue.depth, bids.length && asks.length ? "partial" : "unavailable"),
    openInterest: normalizeCoverageStatus(
      coverageValue.openInterest,
      Number.isFinite(currentOpenInterest) || openInterestHistory.length ? "partial" : "unavailable",
    ),
    liquidations: normalizeCoverageStatus(coverageValue.liquidations, "unavailable"),
  };
  const inferredStart = trades[0]?.time ?? 0;
  const inferredEnd = trades.at(-1)?.time ?? 0;
  const windowStart = Math.max(0, Number(value.windowStart) || inferredStart);
  const windowEnd = Math.max(windowStart, Number(value.windowEnd) || inferredEnd);
  return Object.freeze({
    source: String(value.source || "unknown").trim().slice(0, 80),
    windowStart,
    windowEnd,
    trades: Object.freeze(trades.map((trade) => Object.freeze(trade))),
    depth: Object.freeze({
      snapshotTime: Math.max(0, Number(depthValue.snapshotTime) || 0),
      lastUpdateId: Math.max(0, Number(depthValue.lastUpdateId) || 0),
      bids: Object.freeze(bids.map((level) => Object.freeze(level))),
      asks: Object.freeze(asks.map((level) => Object.freeze(level))),
    }),
    openInterest: Object.freeze({
      current: Number.isFinite(currentOpenInterest) && currentOpenInterest >= 0 ? currentOpenInterest : null,
      history: Object.freeze(openInterestHistory.map((point) => Object.freeze(point))),
    }),
    coverage: Object.freeze(coverage),
  });
}

function normalizeContextCandles(value, primaryInterval) {
  if (!Array.isArray(value)) return Object.freeze([]);
  const byInterval = new Map();
  value.slice(0, MAX_CONTEXT_TIMEFRAMES).forEach((context, contextIndex) => {
    const interval = String(context?.interval || "").trim().slice(0, 24);
    if (!interval || interval === primaryInterval || !Array.isArray(context?.candles)) return;
    const byTime = new Map();
    context.candles.slice(-MAX_CONTEXT_CANDLES).forEach((candle, candleIndex) => {
      const normalized = normalizeCandle(candle, `contextCandles[${contextIndex}].candles[${candleIndex}]`);
      byTime.set(normalized.time, normalized);
    });
    const candles = [...byTime.values()].sort((first, second) => first.time - second.time);
    if (candles.length < 30) return;
    byInterval.set(interval, Object.freeze({
      interval,
      candles: Object.freeze(candles.map((candle) => Object.freeze(candle))),
    }));
  });
  return Object.freeze([...byInterval.values()]);
}

export function normalizeTradingMarketSnapshot(value = {}) {
  const marketId = String(value?.marketId || "").trim().toUpperCase().slice(0, 120);
  const interval = String(value?.interval || "").trim().slice(0, 24);
  if (!marketId || !interval) throw new TypeError("marketId and interval are required");
  if (!Array.isArray(value?.candles)) throw new TypeError("candles must be an array");
  const byTime = new Map();
  value.candles.slice(-MAX_CANDLES).forEach((candle, index) => {
    const normalized = normalizeCandle(candle, index);
    byTime.set(normalized.time, normalized);
  });
  const candles = [...byTime.values()].sort((first, second) => first.time - second.time);
  if (candles.length < 30) throw new TypeError("At least 30 valid candles are required");
  const snapshotTime = Math.max(finiteNumber(value?.snapshotTime ?? Date.now(), "snapshotTime"), 1);
  const orderFlow = normalizeOrderFlow(value?.orderFlow);
  const contextCandles = normalizeContextCandles(value?.contextCandles, interval);
  const inputHash = stableHash({ marketId, interval, candles, contextCandles, orderFlow });
  return Object.freeze({
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    snapshotId: `snapshot-${inputHash.slice(0, 24)}`,
    marketId,
    interval,
    snapshotTime,
    lastClosedBarTime: candles.at(-1).time,
    candles: Object.freeze(candles.map((candle) => Object.freeze(candle))),
    contextCandles,
    orderFlow,
    inputHash,
  });
}

function normalizePoint(value, context) {
  const time = finiteNumber(value?.time, `${context}.time`);
  const price = finiteNumber(value?.price, `${context}.price`);
  if (time <= 0 || price <= 0) throw new TypeError(`${context} is outside valid bounds`);
  return { time, price };
}

export function validateTradingDrawingPatch(value, snapshot) {
  if (Number(value?.schemaVersion) !== TRADING_ANALYSIS_SCHEMA_VERSION) {
    throw new TypeError("Unsupported drawing patch schemaVersion");
  }
  if (String(value?.marketId || "") !== snapshot.marketId || String(value?.interval || "") !== snapshot.interval) {
    throw new TypeError("Drawing patch market identity does not match snapshot");
  }
  const operations = Array.isArray(value?.operations) ? value.operations : [];
  if (!operations.length || operations.length > 64) throw new TypeError("Drawing patch operation count is invalid");
  const sanitizedOperations = operations.map((operation, operationIndex) => {
    if (operation?.op !== "upsert" || !operation?.drawing || typeof operation.drawing !== "object") {
      throw new TypeError(`operations[${operationIndex}] is invalid`);
    }
    const drawing = operation.drawing;
    const tool = String(drawing.tool || "");
    const colorToken = String(drawing.colorToken || "");
    const theory = drawing.theory === "order-flow"
      ? "order-flow"
      : drawing.theory === "wave"
        ? "wave"
        : drawing.theory === "wyckoff"
          ? "wyckoff"
        : drawing.theory === "price-action"
          ? "price-action"
          : "chan";
    const style = DRAWING_THEORY_STYLES[theory];
    if (!ALLOWED_DRAWING_TOOLS.has(tool) || !style.colorTokens.has(colorToken)) {
      throw new TypeError(`operations[${operationIndex}] uses an unsupported drawing style`);
    }
    const rawPoints = Array.isArray(drawing.points) ? drawing.points : [];
    if (!rawPoints.length || rawPoints.length > 64) throw new TypeError(`operations[${operationIndex}] point count is invalid`);
    const points = rawPoints.map((point, pointIndex) => normalizePoint(point, `operations[${operationIndex}].points[${pointIndex}]`));
    if (tool === "path" && points.length < 2) throw new TypeError("A path requires at least two points");
    if (tool === "rectangle" && points.length !== 2) throw new TypeError("A rectangle requires two points");
    if ((tool === "arrow-up" || tool === "arrow-down" || tool === "note") && points.length !== 1) {
      throw new TypeError(`${tool} requires one point`);
    }
    return {
      op: "upsert",
      drawing: {
        id: String(drawing.id || `ai-${operationIndex}`).slice(0, 160),
        symbol: snapshot.marketId,
        theory,
        layer: style.layer,
        tool,
        points,
        text: typeof drawing.text === "string" ? drawing.text.slice(0, 120) : undefined,
        colorToken,
        locked: true,
        status: drawing.status === "tentative" ? "tentative" : "confirmed",
        evidenceIds: Array.isArray(drawing.evidenceIds)
          ? drawing.evidenceIds.map((item) => String(item).slice(0, 160)).slice(0, 32)
          : [],
      },
    };
  });
  return {
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    analysisId: String(value.analysisId || "").slice(0, 160),
    baseRevision: Math.max(0, Number(value.baseRevision) || 0),
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    operations: sanitizedOperations,
  };
}
