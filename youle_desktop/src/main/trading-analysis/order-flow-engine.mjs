import crypto from "node:crypto";
import { TRADING_ANALYSIS_SCHEMA_VERSION } from "./protocol.mjs";

export const ORDER_FLOW_ENGINE_ID = "order_flow";
export const ORDER_FLOW_ENGINE_VERSION = "0.1.0";

function idFor(prefix, ...parts) {
  return `${prefix}-${crypto.createHash("sha1").update(parts.join(":"), "utf8").digest("hex").slice(0, 16)}`;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function coverageWeight(status) {
  if (status === "available") return 1;
  if (status === "partial") return 0.6;
  if (status === "delayed") return 0.4;
  return 0;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((first, second) => first - second);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
}

function buildVolumeProfile(trades) {
  const prices = trades.map((trade) => trade.price);
  const minimumPrice = Math.min(...prices);
  const maximumPrice = Math.max(...prices);
  const referencePrice = trades.at(-1)?.price || minimumPrice;
  const binSize = Math.max(referencePrice * 0.0001, (maximumPrice - minimumPrice) / 24, Number.EPSILON);
  const bins = new Map();
  for (const trade of trades) {
    const key = Math.round(trade.price / binSize);
    const current = bins.get(key) || {
      key,
      price: key * binSize,
      lower: (key - 0.5) * binSize,
      upper: (key + 0.5) * binSize,
      buyQuantity: 0,
      sellQuantity: 0,
      quantity: 0,
      notional: 0,
      firstTime: trade.time,
      lastTime: trade.time,
    };
    current.quantity += trade.quantity;
    current.notional += trade.price * trade.quantity;
    current.firstTime = Math.min(current.firstTime, trade.time);
    current.lastTime = Math.max(current.lastTime, trade.time);
    if (trade.side === "buy") current.buyQuantity += trade.quantity;
    else current.sellQuantity += trade.quantity;
    bins.set(key, current);
  }
  return [...bins.values()].map((bin) => ({
    ...bin,
    delta: bin.buyQuantity - bin.sellQuantity,
    imbalanceRatio: bin.quantity ? (bin.buyQuantity - bin.sellQuantity) / bin.quantity : 0,
  }));
}

function buildCumulativeDelta(trades, maximumPoints = 120) {
  if (!trades.length) return [];
  const stride = Math.max(1, Math.ceil(trades.length / maximumPoints));
  let value = 0;
  const points = [];
  trades.forEach((trade, index) => {
    value += trade.side === "buy" ? trade.quantity : -trade.quantity;
    if ((index + 1) % stride === 0 || index === trades.length - 1) {
      points.push({
        time: trade.time,
        value,
        tradeId: trade.id,
      });
    }
  });
  return points;
}

export function runOrderFlowTheoryEngine(snapshot) {
  const orderFlow = snapshot.orderFlow;
  const trades = orderFlow?.trades || [];
  const bids = orderFlow?.depth?.bids || [];
  const asks = orderFlow?.depth?.asks || [];
  const coverage = orderFlow?.coverage || {
    trades: "unavailable",
    depth: "unavailable",
    openInterest: "unavailable",
    liquidations: "unavailable",
  };
  const enoughTrades = trades.length >= 50 && coverage.trades !== "unavailable";
  const enoughDepth = bids.length >= 5 && asks.length >= 5 && coverage.depth !== "unavailable";
  const status = enoughTrades && enoughDepth ? "succeeded" : "insufficient_data";
  const buyQuantity = trades
    .filter((trade) => trade.side === "buy")
    .reduce((total, trade) => total + trade.quantity, 0);
  const sellQuantity = trades
    .filter((trade) => trade.side === "sell")
    .reduce((total, trade) => total + trade.quantity, 0);
  const totalQuantity = buyQuantity + sellQuantity;
  const buyNotional = trades
    .filter((trade) => trade.side === "buy")
    .reduce((total, trade) => total + trade.price * trade.quantity, 0);
  const sellNotional = trades
    .filter((trade) => trade.side === "sell")
    .reduce((total, trade) => total + trade.price * trade.quantity, 0);
  const totalNotional = buyNotional + sellNotional;
  const delta = buyQuantity - sellQuantity;
  const deltaRatio = totalQuantity ? delta / totalQuantity : 0;
  const vwap = totalQuantity ? totalNotional / totalQuantity : null;
  const firstTradePrice = trades[0]?.price ?? null;
  const lastTradePrice = trades.at(-1)?.price ?? null;
  const priceChangeRatio = firstTradePrice
    ? (lastTradePrice - firstTradePrice) / firstTradePrice
    : 0;

  const topDepthLevels = 20;
  const bidQuantity = bids.slice(0, topDepthLevels).reduce((total, level) => total + level.quantity, 0);
  const askQuantity = asks.slice(0, topDepthLevels).reduce((total, level) => total + level.quantity, 0);
  const depthTotal = bidQuantity + askQuantity;
  const depthImbalanceRatio = depthTotal ? (bidQuantity - askQuantity) / depthTotal : 0;
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const midPrice = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : lastTradePrice;
  const spread = bestBid && bestAsk ? bestAsk - bestBid : null;
  const spreadBps = spread != null && midPrice ? spread / midPrice * 10_000 : null;

  const openInterestHistory = orderFlow?.openInterest?.history || [];
  const openInterestStart = openInterestHistory[0]?.value ?? null;
  const openInterestEnd = orderFlow?.openInterest?.current
    ?? openInterestHistory.at(-1)?.value
    ?? null;
  const openInterestChangeRatio = openInterestStart && openInterestEnd != null
    ? (openInterestEnd - openInterestStart) / openInterestStart
    : null;

  const profile = trades.length ? buildVolumeProfile(trades) : [];
  const cumulativeDelta = buildCumulativeDelta(trades);
  const pointOfControl = profile.slice().sort((first, second) => (
    second.quantity - first.quantity || first.price - second.price
  ))[0] || null;
  const clusterThreshold = percentile(profile.map((bin) => bin.quantity), 0.65);
  const clusters = profile
    .filter((bin) => bin.quantity >= clusterThreshold)
    .sort((first, second) => second.quantity - first.quantity || first.price - second.price)
    .slice(0, 6)
    .map((bin) => ({
      id: idFor("order-flow-cluster", snapshot.snapshotId, bin.key),
      price: bin.price,
      lower: bin.lower,
      upper: bin.upper,
      quantity: bin.quantity,
      buyQuantity: bin.buyQuantity,
      sellQuantity: bin.sellQuantity,
      delta: bin.delta,
      imbalanceRatio: bin.imbalanceRatio,
      side: bin.imbalanceRatio >= 0.18 ? "buy" : bin.imbalanceRatio <= -0.18 ? "sell" : "balanced",
      firstTime: bin.firstTime,
      lastTime: bin.lastTime,
    }));
  const imbalanceClusters = clusters.filter((cluster) => Math.abs(cluster.imbalanceRatio) >= 0.25);
  const largeTradeThreshold = percentile(trades.map((trade) => trade.price * trade.quantity), 0.985);
  const pressureEvents = trades
    .filter((trade) => trade.price * trade.quantity >= largeTradeThreshold)
    .sort((first, second) => second.price * second.quantity - first.price * first.quantity || first.time - second.time)
    .slice(0, 6)
    .sort((first, second) => first.time - second.time)
    .map((trade) => ({
      id: idFor("order-flow-pressure", snapshot.snapshotId, trade.id),
      tradeId: trade.id,
      time: trade.time,
      price: trade.price,
      quantity: trade.quantity,
      notional: trade.price * trade.quantity,
      side: trade.side,
    }));

  const coverageScore = (
    coverageWeight(coverage.trades) * 0.45
    + coverageWeight(coverage.depth) * 0.3
    + coverageWeight(coverage.openInterest) * 0.15
    + coverageWeight(coverage.liquidations) * 0.1
  );
  const flowScoreBeforeOpenInterest = deltaRatio * 0.62 + depthImbalanceRatio * 0.28;
  const oiContribution = openInterestChangeRatio == null
    ? 0
    : clamp(openInterestChangeRatio / 0.01, -1, 1)
      * Math.sign(flowScoreBeforeOpenInterest || priceChangeRatio || deltaRatio)
      * 0.1;
  const directionalScore = clamp(
    flowScoreBeforeOpenInterest + oiContribution,
    -1,
    1,
  );
  const direction = directionalScore >= 0.12
    ? "buying_pressure"
    : directionalScore <= -0.12
      ? "selling_pressure"
      : "balanced";
  const signals = [{
    signalId: idFor("order-flow-signal", snapshot.snapshotId, "pressure"),
    kind: direction,
    strength: Math.abs(directionalScore),
    status: "confirmed",
    evidenceIds: [],
  }];
  if (Math.abs(deltaRatio) >= 0.18 && Math.abs(priceChangeRatio) <= 0.0008) {
    signals.push({
      signalId: idFor("order-flow-signal", snapshot.snapshotId, "absorption"),
      kind: deltaRatio > 0 ? "possible_buy_absorption" : "possible_sell_absorption",
      strength: Math.min(1, Math.abs(deltaRatio)),
      status: "tentative",
      evidenceIds: [],
    });
  }

  const poc = pointOfControl ? {
    id: idFor("order-flow-poc", snapshot.snapshotId, pointOfControl.key),
    price: pointOfControl.price,
    lower: pointOfControl.lower,
    upper: pointOfControl.upper,
    quantity: pointOfControl.quantity,
    buyQuantity: pointOfControl.buyQuantity,
    sellQuantity: pointOfControl.sellQuantity,
    imbalanceRatio: pointOfControl.imbalanceRatio,
    startTime: orderFlow.windowStart,
    endTime: orderFlow.windowEnd,
  } : null;
  const depthSnapshot = {
    id: idFor("order-flow-depth", snapshot.snapshotId, orderFlow?.depth?.lastUpdateId || 0),
    snapshotTime: orderFlow?.depth?.snapshotTime || snapshot.snapshotTime,
    bestBid,
    bestAsk,
    midPrice,
    spread,
    spreadBps,
    bidQuantity,
    askQuantity,
    imbalanceRatio: depthImbalanceRatio,
    levelCount: Math.min(bids.length, topDepthLevels) + Math.min(asks.length, topDepthLevels),
  };
  const evidence = [
    ...(poc ? [{ evidenceId: poc.id, kind: "volume_profile_poc", source: "aggregate_trades" }] : []),
    ...clusters.map((cluster) => ({ evidenceId: cluster.id, kind: "price_volume_cluster", source: "aggregate_trades" })),
    ...pressureEvents.map((event) => ({ evidenceId: event.id, kind: "large_aggressive_trade", source: "aggregate_trades" })),
    { evidenceId: depthSnapshot.id, kind: "order_book_snapshot", source: "depth_snapshot" },
  ];
  signals.forEach((signal) => {
    signal.evidenceIds = [
      ...(poc ? [poc.id] : []),
      depthSnapshot.id,
      ...imbalanceClusters.slice(0, 2).map((cluster) => cluster.id),
    ];
  });

  return {
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    resultId: idFor("order-flow-result", snapshot.snapshotId, ORDER_FLOW_ENGINE_VERSION),
    engineId: ORDER_FLOW_ENGINE_ID,
    engineVersion: ORDER_FLOW_ENGINE_VERSION,
    snapshotId: snapshot.snapshotId,
    status,
    coverage,
    confidence: {
      structure: clamp(coverageScore * Math.min(1, trades.length / 300), 0, 1),
      coverage: coverageScore,
    },
    statistics: {
      tradeCount: trades.length,
      windowStart: orderFlow?.windowStart || 0,
      windowEnd: orderFlow?.windowEnd || 0,
      buyQuantity,
      sellQuantity,
      totalQuantity,
      buyNotional,
      sellNotional,
      totalNotional,
      delta,
      deltaRatio,
      vwap,
      firstTradePrice,
      lastTradePrice,
      priceChangeRatio,
      bidQuantity,
      askQuantity,
      depthImbalanceRatio,
      openInterestStart,
      openInterestEnd,
      openInterestChangeRatio,
      directionalScore,
      direction,
    },
    structures: {
      pointOfControl: poc,
      cumulativeDelta,
      clusters,
      imbalanceClusters,
      pressureEvents,
      depthSnapshot,
    },
    signals,
    evidence,
    missingData: Object.entries(coverage)
      .filter(([, value]) => value === "unavailable")
      .map(([key]) => key),
  };
}
