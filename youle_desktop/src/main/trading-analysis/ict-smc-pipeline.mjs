import crypto from "node:crypto";
import { runIctSmcTheoryEngine, ICT_SMC_ENGINE_VERSION } from "./ict-smc-engine.mjs";
import { normalizeTradingMarketSnapshot, TRADING_ANALYSIS_SCHEMA_VERSION, validateStrategyDrawingPatch } from "./protocol.mjs";

const STRATEGY_ID = "ict-smc";

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

function price(value) {
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 8 });
}

function timeframeLabel(intervalValue) {
  const interval = String(intervalValue || "").toUpperCase();
  if (interval === "1D" || interval === "1W") return interval;
  const minutes = Number(interval);
  if (Number.isFinite(minutes) && minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}H`;
  return Number.isFinite(minutes) ? `${minutes}m` : interval;
}

function zoneLabel(zone) {
  const side = zone.side === "bullish" ? "看涨" : "看跌";
  const kind = zone.kind === "OB" ? "OB（Order Block）" : zone.kind;
  return `[${timeframeLabel(zone.interval)}] ${side} ${kind}`;
}

function zoneLabelEnglish(zone) {
  const side = zone.side === "bullish" ? "bullish" : "bearish";
  const kind = zone.kind === "OB" ? "OB (Order Block)" : zone.kind;
  return `[${timeframeLabel(zone.interval)}] ${side} ${kind}`;
}

function operation(analysisId, suffix, role, tool, points, text, appearance = {}, evidenceIds = []) {
  return { op: "upsert", drawing: {
    id: `${analysisId}-${suffix}`, strategyId: STRATEGY_ID, theory: "strategy", layer: `ai/strategy/${STRATEGY_ID}`,
    tool, points, ...(text ? { text } : {}), colorToken: `strategy-${role}`,
    ...(appearance.lineStyle ? { lineStyle: appearance.lineStyle } : {}),
    ...(Number.isFinite(appearance.lineWidth) ? { lineWidth: appearance.lineWidth } : {}),
    ...(Number.isFinite(appearance.fontSize) ? { fontSize: appearance.fontSize } : {}),
    ...((tool === "note" || tool === "text") ? { bold: false } : {}),
    status: appearance.status || "confirmed", evidenceIds,
  } };
}

function actionPlan(snapshot, result) {
  const execution = result.timeframes.find((item) => item.role === "execution") || result.timeframes[0];
  const pivots = execution?.structures?.pivots || [];
  const high = [...pivots].reverse().find((item) => item.type === "high");
  const low = [...pivots].reverse().find((item) => item.type === "low");
  if (!high || !low) return { disposition: "wait", primaryBias: "neutral", validityBars: 3, observeTrigger: "等待形成已确认的高低点、流动性事件与结构位移" };
  const range = Math.max(high.price - low.price, snapshot.candles.at(-1).close * 0.002);
  return {
    disposition: "wait",
    primaryBias: result.currentBias,
    longTrigger: high.price,
    longInvalidation: low.price,
    longTargets: [high.price + range, high.price + range * 2],
    shortTrigger: low.price,
    shortInvalidation: high.price,
    shortTargets: [low.price - range, low.price - range * 2].filter((item) => item > 0),
    waitZone: { lower: low.price, upper: high.price },
    confirmation: "先出现流动性清扫，再由已收盘 K 线确认位移与 MSS/CHoCH；回踩有效 FVG、OB 或 Breaker 后才考虑执行",
    cancellation: "结构失效、PD Array 被收盘贯穿、数据覆盖降级或方案过期",
    validityBars: 4,
    observeTrigger: "观察流动性清扫、位移、MSS 与有效 PD Array 回踩是否按顺序出现",
  };
}

export function buildIctSmcDrawingPatch(snapshot, result, language = "zh-CN") {
  const english = language === "en";
  const analysisId = `ict-smc-analysis-${crypto.createHash("sha1").update(snapshot.snapshotId).digest("hex").slice(0, 18)}`;
  const execution = result.timeframes.find((item) => item.role === "execution") || result.timeframes[0];
  const structures = execution.structures;
  const ops = [];
  const selectedPivots = structures.pivots.slice(-9);
  if (selectedPivots.length > 1) ops.push(operation(analysisId, "structure", "primary", "path", selectedPivots.map((item) => ({ time: item.time, price: item.price })), english ? "ICT market structure" : "ICT 市场结构", { lineStyle: "solid", lineWidth: 2 }, selectedPivots.map((item) => item.id)));
  structures.structureEvents.slice(-3).forEach((event, index) => ops.push(operation(analysisId, `event-${index}`, event.direction === "bullish" ? "support" : "resistance", "note", [{ time: event.breakTime, price: event.breakPrice }], `${event.kind} · ${event.direction === "bullish" ? (english ? "bullish" : "看涨") : (english ? "bearish" : "看跌")}${event.displacement.confirmed ? ` · ${english ? "displacement" : "位移"}` : ""}`, { fontSize: 11 }, [event.id])));
  const zones = [
    ...structures.orderBlocks.filter((item) => item.state !== "invalidated").slice(0, 2).map((item) => ({ ...item, startTime: item.originTime })),
    ...structures.fairValueGaps.filter((item) => item.state === "open" || item.state === "partial").slice(0, 2),
    ...structures.breakers.filter((item) => item.state === "confirmed").slice(0, 1).map((item) => ({ ...item, startTime: item.originTime })),
  ];
  zones.forEach((zone, index) => ops.push(operation(analysisId, `zone-${index}`, zone.side === "bullish" ? "support" : "resistance", "rectangle", [{ time: zone.startTime, price: zone.lower }, { time: zone.endTime, price: zone.upper }], english ? zoneLabelEnglish(zone) : zoneLabel(zone), { lineStyle: "dashed", lineWidth: 0.8 }, [zone.id])));
  structures.liquidityPools.slice(0, 3).forEach((pool, index) => ops.push(operation(analysisId, `liquidity-${index}`, pool.side === "BSL" ? "resistance" : "support", "path", [{ time: pool.startTime, price: pool.price }, { time: pool.endTime, price: pool.price }], `${pool.side} · ${pool.state}`, { lineStyle: "dotted", lineWidth: 0.8 }, [pool.id])));
  const range = structures.dealingRange;
  if (range) ops.push(operation(analysisId, "equilibrium", "note", "path", [{ time: range.startTime, price: range.equilibrium }, { time: range.endTime, price: range.equilibrium }], `EQ ${price(range.equilibrium)}`, { lineStyle: "dashed", lineWidth: 0.8 }, [range.id]));
  const plan = actionPlan(snapshot, result);
  const endTime = snapshot.candles.at(-1).time;
  const startTime = snapshot.candles.at(-Math.min(80, snapshot.candles.length)).time;
  [["long", plan.longTrigger, "entry", english ? "bullish close trigger" : "多头收盘触发"], ["short", plan.shortTrigger, "entry", english ? "bearish close trigger" : "空头收盘触发"], ["long-stop", plan.longInvalidation, "stop", english ? "bullish invalidation" : "多头失效"], ["short-stop", plan.shortInvalidation, "stop", english ? "bearish invalidation" : "空头失效"]].forEach(([id, value, role, label]) => {
    if (Number(value) > 0) ops.push(operation(analysisId, `level-${id}`, role, "path", [{ time: startTime, price: Number(value) }, { time: endTime, price: Number(value) }], `${label} ${price(value)}`, { lineStyle: "dashed", lineWidth: 0.8 }));
  });
  ops.push(operation(analysisId, "summary", "note", "note", [{ time: endTime, price: snapshot.candles.at(-1).close }], `ICT/SMC · ${result.currentBias === "bullish" ? (english ? "bullish" : "偏多") : result.currentBias === "bearish" ? (english ? "bearish" : "偏空") : (english ? "neutral" : "中性")} · ${english ? "wait for close confirmation" : "等待收盘确认"}`, { fontSize: 11 }));
  return validateStrategyDrawingPatch({ schemaVersion: 1, analysisId, baseRevision: 0, marketId: snapshot.marketId, interval: snapshot.interval, operations: ops }, snapshot, STRATEGY_ID);
}

function report(snapshot, result, plan) {
  const s = result.statistics;
  const activeTf = result.timeframes[0];
  const latest = activeTf.structures.structureEvents.at(-1);
  return [
    "## ICT / SMC 分析",
    `- 当前结构：${result.currentBias === "bullish" ? "偏多" : result.currentBias === "bearish" ? "偏空" : "中性"}；${latest ? `最近事件为 ${latest.kind}，方向 ${latest.direction}` : "尚无已确认结构突破"}。`,
    `- 可复算证据：结构事件 ${s.structureEventCount}、FVG ${s.fairValueGapCount}、OB ${s.orderBlockCount}、Breaker ${s.breakerCount}、流动性池 ${s.liquidityPoolCount}、清扫 ${s.sweepCount}。`,
    "- 语义边界：FVG 是三根 K 线形成的价格不平衡；OB 必须绑定后续结构突破/位移；流动性清扫是价格行为标签，不证明某个机构的主观意图。",
    "",
    "### 条件式执行",
    `- 当前动作：等待。区间 ${plan.waitZone ? `${price(plan.waitZone.lower)}–${price(plan.waitZone.upper)}` : "尚未形成"} 内不追价。`,
    `- 确认顺序：${plan.confirmation || plan.observeTrigger}。`,
    `- 多头触发/失效：${plan.longTrigger ? `${price(plan.longTrigger)} / ${price(plan.longInvalidation)}` : "未形成"}；空头触发/失效：${plan.shortTrigger ? `${price(plan.shortTrigger)} / ${price(plan.shortInvalidation)}` : "未形成"}。`,
    `- 取消条件：${plan.cancellation || "结构或数据失效"}。`,
    "",
    "### 数据与风险",
    `使用 ${snapshot.candles.length} 根 ${snapshot.interval} K 线及 ${snapshot.contextCandles.length} 个高周期上下文；本 Skill 不读取逐笔成交或深度，不能冒充订单流证据。`,
    "本结果是条件式分析，不会创建订单，也不承诺 FVG 回补、OB 生效或目标到达。",
  ].join("\n");
}

function reportEnglish(snapshot, result, plan) {
  const s = result.statistics;
  const activeTf = result.timeframes[0];
  const latest = activeTf.structures.structureEvents.at(-1);
  const bias = result.currentBias === "bullish" ? "bullish" : result.currentBias === "bearish" ? "bearish" : "neutral";
  return [
    "## ICT / SMC analysis",
    `- Current structure: **${bias}**; ${latest ? `the latest event is ${latest.kind} (${latest.direction}).` : "no confirmed structure break yet."}`,
    `- Reproducible evidence: ${s.structureEventCount} structure events, ${s.fairValueGapCount} FVGs, ${s.orderBlockCount} OBs, ${s.breakerCount} Breakers, ${s.liquidityPoolCount} liquidity pools, and ${s.sweepCount} sweeps.`,
    "- Semantic boundary: an FVG is a three-candle price imbalance; an OB must be tied to a later break or displacement; a liquidity sweep describes price behavior and does not prove institutional intent.",
    "",
    "### Conditional execution",
    `- Current action: wait. Do not chase inside ${plan.waitZone ? `${price(plan.waitZone.lower)}–${price(plan.waitZone.upper)}` : "the unformed range"}.`,
    `- Confirmation order: ${plan.confirmation || plan.observeTrigger}.`,
    `- Bullish trigger/invalidation: ${plan.longTrigger ? `${price(plan.longTrigger)} / ${price(plan.longInvalidation)}` : "not formed"}; bearish trigger/invalidation: ${plan.shortTrigger ? `${price(plan.shortTrigger)} / ${price(plan.shortInvalidation)}` : "not formed"}.`,
    `- Cancellation: ${plan.cancellation || "structure or data invalidation"}.`,
    "",
    "### Data and risk",
    `Uses ${snapshot.candles.length} ${snapshot.interval} candles and ${snapshot.contextCandles.length} higher-timeframe contexts. This Skill does not read individual trades or depth and cannot represent order-flow evidence.`,
    "This is conditional analysis. It creates no orders and does not guarantee an FVG fill, OB reaction, or target.",
  ].join("\n");
}

export async function runTradingIctSmcPipeline(params, options = {}) {
  const snapshot = normalizeTradingMarketSnapshot(closedCandleParams(params));
  const raw = runIctSmcTheoryEngine(snapshot);
  const theoryResult = { ...raw, coverage: { candles: "available", contextCandles: snapshot.contextCandles.length ? "available" : "unavailable", orderFlow: "unavailable" }, evidence: raw.evidence.map((item) => ({ id: item.evidenceId, summary: `${item.kind} · ${item.source}` })) };
  options.onTheoryReady?.({ stage: "deterministic_theory", strategyId: "ict-smc", snapshotId: snapshot.snapshotId, candleCount: snapshot.candles.length, evidenceCount: Array.isArray(theoryResult.evidence) ? theoryResult.evidence.length : 0 });
  const plan = actionPlan(snapshot, theoryResult);
  const english = params?.language === "en";
  if (english) {
    plan.confirmation = "Wait for a liquidity sweep, then a closed-candle displacement and MSS/CHoCH confirmation; consider execution only after a valid FVG, OB, or Breaker retest.";
    plan.cancellation = "Structure invalidation, a close through the PD Array, degraded data coverage, or plan expiry.";
    plan.observeTrigger = "Watch for a liquidity sweep, displacement, MSS, and a valid PD Array retest in that order.";
  }
  const drawingPatch = buildIctSmcDrawingPatch(snapshot, theoryResult, params?.language);
  return { ok: true, schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION, snapshot: { snapshotId: snapshot.snapshotId, marketId: snapshot.marketId, interval: snapshot.interval, snapshotTime: snapshot.snapshotTime, lastClosedBarTime: snapshot.lastClosedBarTime, inputHash: snapshot.inputHash }, theoryResult, analysisPlan: { schemaVersion: 1, analysisId: drawingPatch.analysisId, revision: 0, snapshotId: snapshot.snapshotId, marketId: snapshot.marketId, interval: snapshot.interval, narrative: english ? `ICT/SMC analysis complete: ${theoryResult.currentBias}; wait for the full liquidity, displacement, structure-shift, and retest sequence.` : `ICT/SMC 已完成：${theoryResult.currentBias}，等待流动性—位移—结构转变—回踩的完整序列。`, report: english ? reportEnglish(snapshot, theoryResult, plan) : report(snapshot, theoryResult, plan), actionPlan: plan, drawingPatch }, model: { providerId: "deterministic", modelId: `ict-smc-engine-v${ICT_SMC_ENGINE_VERSION}`, requestId: null, latencyMs: 0, usage: null, finishReason: "deterministic-succeeded" } };
}
