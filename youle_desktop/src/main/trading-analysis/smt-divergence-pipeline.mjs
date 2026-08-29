import crypto from "node:crypto";
import { runIctSmcTheoryEngine } from "./ict-smc-engine.mjs";
import { normalizeTradingMarketSnapshot, TRADING_ANALYSIS_SCHEMA_VERSION, validateStrategyDrawingPatch } from "./protocol.mjs";
import { runSmtDivergenceEngine, SMT_DIVERGENCE_ENGINE_VERSION } from "./smt-divergence-engine.mjs";

const STRATEGY_ID = "smt-divergence";

function durationMsFor(intervalValue) {
  const interval = String(intervalValue || "").toUpperCase();
  return interval === "1D" ? 86_400_000 : interval === "1W" ? 604_800_000 : Math.max(60_000, Number(interval) * 60_000 || 3_600_000);
}

function closedCandleParams(params) {
  const durationMs = durationMsFor(params?.interval);
  const snapshotTime = Math.max(1, Number(params?.snapshotTime) || Date.now());
  return {
    ...params,
    snapshotTime,
    candles: (Array.isArray(params?.candles) ? params.candles : []).filter((item) => Number(item?.time) * 1_000 + durationMs <= snapshotTime),
    contextCandles: (Array.isArray(params?.contextCandles) ? params.contextCandles : []).map((context) => ({
      ...context,
      candles: (Array.isArray(context?.candles) ? context.candles : []).filter((item) => Number(item?.time) * 1_000 + durationMsFor(context?.interval) <= snapshotTime),
    })),
  };
}

function normalizedComparisonMarkets(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).flatMap((item) => {
    const candles = Array.isArray(item?.candles) ? item.candles.slice(-600).flatMap((candle) => {
      const normalized = { time: Number(candle?.time), open: Number(candle?.open), high: Number(candle?.high), low: Number(candle?.low), close: Number(candle?.close), volume: Math.max(0, Number(candle?.volume) || 0) };
      return normalized.time > 0 && normalized.low > 0 && normalized.high >= Math.max(normalized.open, normalized.close) && normalized.low <= Math.min(normalized.open, normalized.close) ? [normalized] : [];
    }) : [];
    if (candles.length < 30) return [];
    return [{ marketId: String(item.marketId || "").slice(0, 120), symbol: String(item.symbol || "").slice(0, 40), source: String(item.source || "unknown").slice(0, 60), kind: item.kind === "venue-confirmation" ? "venue-confirmation" : "correlated-market", candles }];
  });
}

function actionPlan(snapshot, smt, ict) {
  const signal = smt.currentSignal;
  if (!signal) return { disposition: "wait", primaryBias: "neutral", validityBars: 2, observeTrigger: smt.reason, confirmation: "SMT 只确认方向；必须再等待主市场已收盘 K 线出现位移与 MSS，并回踩有效 FVG/OB" };
  const primaryPivots = ict.timeframes[0]?.structures?.pivots || [];
  const high = [...primaryPivots].reverse().find((item) => item.type === "high");
  const low = [...primaryPivots].reverse().find((item) => item.type === "low");
  if (!high || !low) return { disposition: "wait", primaryBias: signal.type, validityBars: 2, observeTrigger: "等待主市场形成可执行的已确认结构高低点", confirmation: "SMT 不可单独入场" };
  const span = Math.max(high.price - low.price, snapshot.candles.at(-1).close * 0.002);
  return { disposition: "wait", primaryBias: signal.type, longTrigger: high.price, longInvalidation: low.price, longTargets: [high.price + span, high.price + span * 2], shortTrigger: low.price, shortInvalidation: high.price, shortTargets: [low.price - span, low.price - span * 2].filter((item) => item > 0), waitZone: { lower: low.price, upper: high.price }, confirmation: `${signal.type === "bullish" ? "看涨" : "看跌"} SMT 已确认方向，但必须等待主市场已收盘 K 线出现同向位移与 MSS，再回踩有效 FVG/OB`, cancellation: "相关性跌破门槛、背离被两市场同步创新高/低否定、主市场结构反向或方案超过两个周期", validityBars: 2, observeTrigger: "观察 SMT 后的主市场位移、MSS 与 PD Array 回踩" };
}

function op(analysisId, suffix, role, tool, points, text, style = {}, evidenceIds = []) {
  return { op: "upsert", drawing: { id: `${analysisId}-${suffix}`, strategyId: STRATEGY_ID, theory: "strategy", layer: `ai/strategy/${STRATEGY_ID}`, tool, points, ...(text ? { text } : {}), colorToken: `strategy-${role}`, ...(style.lineStyle ? { lineStyle: style.lineStyle } : {}), ...(Number.isFinite(style.lineWidth) ? { lineWidth: style.lineWidth } : {}), ...(Number.isFinite(style.fontSize) ? { fontSize: style.fontSize } : {}), ...((tool === "note" || tool === "text") ? { bold: false } : {}), status: "confirmed", evidenceIds } };
}

function drawingPatch(snapshot, smt, plan) {
  const analysisId = `smt-analysis-${crypto.createHash("sha1").update(`${snapshot.snapshotId}:${smt.pair?.comparisonMarketId || "none"}`).digest("hex").slice(0, 18)}`;
  const operations = [];
  const signal = smt.currentSignal;
  if (signal) {
    const points = [signal.primary.previous, signal.primary.current].map((item) => ({ time: item.time, price: item.price }));
    operations.push(op(analysisId, "primary-extremes", signal.type === "bullish" ? "support" : "resistance", "path", points, `${signal.type === "bullish" ? "看涨" : "看跌"} SMT · ${signal.leader === "primary" ? "主市场扫流动性" : "对照市场扫流动性"}`, { lineStyle: "dashed", lineWidth: 1.2 }, [signal.id]));
    operations.push(op(analysisId, "signal", "note", "note", [{ time: signal.primary.current.time, price: signal.primary.current.price }], `${smt.pair.comparisonSymbol} 未同步确认 · 等待 MSS`, { fontSize: 11 }, [signal.id]));
  } else {
    operations.push(op(analysisId, "summary", "note", "note", [{ time: snapshot.candles.at(-1).time, price: snapshot.candles.at(-1).close }], `SMT：${smt.status === "succeeded" ? "当前无有效背离" : "相关市场数据不足"}`, { fontSize: 11 }, smt.evidence.map((item) => item.id)));
  }
  const startTime = snapshot.candles.at(-Math.min(60, snapshot.candles.length)).time;
  const endTime = snapshot.candles.at(-1).time;
  const preferred = signal?.type;
  const levels = preferred === "bullish"
    ? [["trigger", plan.longTrigger, "entry", "多头收盘触发"], ["stop", plan.longInvalidation, "stop", "多头失效"], ...(plan.longTargets || []).map((value, index) => [`target-${index}`, value, "target", `T${index + 1}`])]
    : preferred === "bearish"
      ? [["trigger", plan.shortTrigger, "entry", "空头收盘触发"], ["stop", plan.shortInvalidation, "stop", "空头失效"], ...(plan.shortTargets || []).map((value, index) => [`target-${index}`, value, "target", `T${index + 1}`])]
      : [];
  levels.forEach(([id, value, role, label]) => { if (Number(value) > 0) operations.push(op(analysisId, String(id), String(role), "path", [{ time: startTime, price: Number(value) }, { time: endTime, price: Number(value) }], `${label} ${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 8 })}`, { lineStyle: "dashed", lineWidth: 0.8 }, signal ? [signal.id] : [])); });
  return validateStrategyDrawingPatch({ schemaVersion: 1, analysisId, baseRevision: 0, marketId: snapshot.marketId, interval: snapshot.interval, operations }, snapshot, STRATEGY_ID);
}

function report(snapshot, smt, plan) {
  const correlation = smt.statistics?.correlation;
  const signal = smt.currentSignal;
  return [
    "## SMT 背离分析",
    `- 配对：${smt.pair ? `${smt.pair.primaryMarketId} ↔ ${smt.pair.comparisonMarketId}` : "不可用"}。`,
    `- 数据门槛：${smt.statistics ? `对齐 ${smt.statistics.alignedCandleCount} 根、收益相关系数 ${correlation?.toFixed(3) ?? "不可用"}（门槛 0.45）` : smt.reason}。`,
    `- 结论：${signal ? `${signal.type === "bullish" ? "看涨" : "看跌"} SMT 已确认；${signal.explanation}` : smt.reason}。`,
    `- 跨场所校验：${smt.statistics?.venueCorrelation == null ? "Hyperliquid 同品种数据不可用" : `Binance/Hyperliquid 同品种收益相关系数 ${smt.statistics.venueCorrelation.toFixed(3)}`}；该项仅校验数据与跨场所错位，不冒充经典跨资产 SMT。`,
    "",
    "### 条件式执行",
    "- 当前动作：等待。SMT 是方向确认线索，不是独立入场信号。",
    `- 下一层确认：${plan.confirmation}。`,
    `- 观察：${plan.observeTrigger}。`,
    `- 取消：${plan.cancellation || "相关性、背离或主市场结构不再成立"}。`,
    "",
    "### 数据与风险",
    `主市场使用当前画布 ${snapshot.interval} 已收盘 K 线；对照数据来自只读公开市场快照。任何数据缺口、周期错位或相关性不足都会降级为数据不足。`,
    "SMT 描述的是相关市场未同步确认，不能证明机构操纵、不能自动创建订单，也不保证反转。",
  ].join("\n");
}

export async function runTradingSmtDivergencePipeline(params) {
  const comparisons = normalizedComparisonMarkets(params.comparisonMarkets);
  const baseSnapshot = normalizeTradingMarketSnapshot(closedCandleParams(params));
  const combinedHash = crypto.createHash("sha256").update(JSON.stringify({ primary: baseSnapshot.inputHash, comparisons })).digest("hex");
  const snapshot = Object.freeze({ ...baseSnapshot, snapshotId: `snapshot-${combinedHash.slice(0, 24)}`, inputHash: combinedHash });
  const smt = runSmtDivergenceEngine(snapshot, comparisons);
  const ict = runIctSmcTheoryEngine(snapshot);
  const plan = actionPlan(snapshot, smt, ict);
  const patch = drawingPatch(snapshot, smt, plan);
  const theoryResult = { ...smt, ictConfirmation: { currentBias: ict.currentBias, latestStructureEvent: ict.timeframes[0]?.structures?.structureEvents?.at(-1) || null }, direction: smt.currentSignal?.type || "neutral", signals: smt.currentSignal ? [{ ...smt.currentSignal, direction: smt.currentSignal.type, strength: 0.75 }] : [] };
  return { ok: true, schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION, snapshot: { snapshotId: snapshot.snapshotId, marketId: snapshot.marketId, interval: snapshot.interval, snapshotTime: snapshot.snapshotTime, lastClosedBarTime: snapshot.lastClosedBarTime, inputHash: snapshot.inputHash }, theoryResult, analysisPlan: { schemaVersion: 1, analysisId: patch.analysisId, revision: 0, snapshotId: snapshot.snapshotId, marketId: snapshot.marketId, interval: snapshot.interval, narrative: smt.currentSignal ? `识别到${smt.currentSignal.type === "bullish" ? "看涨" : "看跌"} SMT，等待主市场 MSS 与回踩确认。` : `SMT 分析完成：${smt.reason}。`, report: report(snapshot, smt, plan), actionPlan: plan, drawingPatch: patch }, model: { providerId: "deterministic", modelId: `smt-divergence-engine-v${SMT_DIVERGENCE_ENGINE_VERSION}`, requestId: null, latencyMs: 0, usage: null, finishReason: "deterministic-succeeded" } };
}
