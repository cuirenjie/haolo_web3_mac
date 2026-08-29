import { runPriceActionSignalEngine } from "./price-action-signal-engine.mjs";
import { runPriceActionStructureEngine } from "./price-action-structure-engine.mjs";
import {
  priceActionLastClosedCandleIndex,
  runPriceActionCandlestickPatternEngine,
} from "./price-action-candlestick-pattern-engine.mjs";

function closedSnapshot(snapshot, lastClosedCandleIndex) {
  if (lastClosedCandleIndex < 0) throw new TypeError("price-action requires at least one closed candle");
  if (lastClosedCandleIndex >= snapshot.candles.length - 1) return snapshot;
  const candles = Object.freeze(snapshot.candles.slice(0, lastClosedCandleIndex + 1));
  return Object.freeze({
    ...snapshot,
    candles,
    lastClosedBarTime: candles.at(-1).time,
  });
}

export function runPriceActionStrategyEngine(snapshot) {
  const lastClosedCandleIndex = priceActionLastClosedCandleIndex(snapshot);
  const confirmedSnapshot = closedSnapshot(snapshot, lastClosedCandleIndex);
  const structure = runPriceActionStructureEngine(confirmedSnapshot);
  const candlestickPatterns = runPriceActionCandlestickPatternEngine(snapshot, structure);
  const signals = runPriceActionSignalEngine(confirmedSnapshot, structure, candlestickPatterns);
  const primary = signals.primaryActiveCandidate;
  const evidence = [
    Object.freeze({
      id: `price-action-market-${structure.market.regime}`,
      summary: `市场结构 ${structure.market.regime}，结构事件 ${structure.market.event}`,
    }),
    ...structure.swings.slice(-8).map((swing) => Object.freeze({ id: swing.id, summary: `${swing.label} ${swing.price}` })),
    ...structure.zones.slice(0, 8).map((zone) => Object.freeze({ id: zone.id, summary: `${zone.role} 区 ${zone.lower}-${zone.upper}，触点 ${zone.touches}` })),
    ...candlestickPatterns.recentPatterns.slice(0, 8).map((pattern) => Object.freeze({
      id: pattern.id,
      summary: `${pattern.name} ${pattern.direction}，形态 ${pattern.formationStatus}，方向 ${pattern.confirmation}，K线 ${pattern.startIndex + 1}-${pattern.endIndex + 1}`,
    })),
    ...(primary ? [Object.freeze({ id: primary.id, summary: `${primary.setupName} ${primary.lifecycle} ${primary.context}` })] : []),
  ];
  return Object.freeze({
    schemaVersion: 1,
    engine: Object.freeze({
      id: "price-action",
      version: "1.2.0",
      mode: "deterministic-ohlc-only",
      inputs: Object.freeze(["time", "open", "high", "low", "close"]),
      excludedInputs: Object.freeze(["volume", "orderBook", "trades", "openInterest", "funding", "MACD", "RSI", "movingAverages"]),
      subengines: Object.freeze([structure.engineId, candlestickPatterns.engineId, signals.engineId]),
    }),
    status: "succeeded",
    bias: primary?.direction || structure.market.direction,
    marketStructure: structure.market,
    pivots: Object.freeze({ profiles: structure.profiles, swings: structure.swings }),
    zones: structure.zones,
    candlePressure: Object.freeze({ latest: signals.latest, recent: signals.recent }),
    candlestickPatterns: Object.freeze({
      catalog: candlestickPatterns.catalog,
      latestPattern: candlestickPatterns.latestPattern,
      recentPatterns: candlestickPatterns.recentPatterns,
      drawablePatterns: candlestickPatterns.drawablePatterns,
      actionablePatterns: candlestickPatterns.actionablePatterns,
    }),
    setups: Object.freeze({
      primaryActiveCandidate: primary,
      activeCandidates: signals.activeCandidates,
      historicalCandidates: signals.historicalCandidates,
    }),
    evidence: Object.freeze(evidence),
    statistics: Object.freeze({
      candleCount: snapshot.candles.length,
      closedCandleCount: confirmedSnapshot.candles.length,
      profileCount: structure.profiles.length,
      swingCount: structure.swings.length,
      zoneCount: structure.zones.length,
      candlestickPatternCount: candlestickPatterns.patterns.length,
      recentCandlestickPatternCount: candlestickPatterns.recentPatterns.length,
      activeSetupCount: signals.activeCandidates.length,
      historicalSetupCount: signals.historicalCandidates.length,
    }),
    limitations: Object.freeze([
      "OHLC 只能推断价格压力，不能证明真实资金流、主动买卖量或机构行为",
      "单根 K 线脱离市场结构和关键区域不构成交易场景",
      "所有触发只接受已收盘 K 线，方案过期后必须用最新快照重算",
    ]),
  });
}
