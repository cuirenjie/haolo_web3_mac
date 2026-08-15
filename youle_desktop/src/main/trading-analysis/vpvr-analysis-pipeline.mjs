import crypto from "node:crypto";
import { runVpvrAnalysisEngine } from "./vpvr-analysis-engine.mjs";
import { TRADING_ANALYSIS_SCHEMA_VERSION, normalizeTradingMarketSnapshot, validateStrategyDrawingPatch } from "./protocol.mjs";

const STRATEGY_ID = "vpvr-analysis";
const LOCATION_LABELS = Object.freeze({
  "above-value-area": "价值区上方",
  "below-value-area": "价值区下方",
  "near-poc": "POC 附近",
  "inside-upper-value-area": "价值区上半部",
  "inside-lower-value-area": "价值区下半部",
});
const ACCEPTANCE_LABELS = Object.freeze({
  accepted: "高接受/均衡区域",
  "low-acceptance": "低接受区域",
  transition: "价值区内的过渡区域",
});

function number(value) {
  return Number.isFinite(Number(value))
    ? Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 8 })
    : "—";
}

function percent(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : "—";
}

function levelName(level) {
  return level.kinds.join("/").replace("Profile High", "可见区间高点").replace("Profile Low", "可见区间低点");
}

function levelLines(levels, fallback) {
  if (!levels.length) return fallback;
  return levels.map((level, index) => (
    `- ${index + 1}. **${number(level.priceLow)}–${number(level.priceHigh)}**（${levelName(level)}，中心 ${number(level.price)}）`
  )).join("\n");
}

function compactLevelSummary(levels) {
  return levels.length
    ? levels.map((level) => `${number(level.priceLow)}–${number(level.priceHigh)}（${levelName(level)}）`).join("；")
    : "当前可见范围没有独立于现价区的显著节点";
}

export function buildVpvrAnalysisNarrative(result) {
  return [
    `支撑位：${compactLevelSummary(result.levels.supports)}。`,
    `阻力位：${compactLevelSummary(result.levels.resistances)}。`,
    `VPVR 市场信息：POC ${number(result.profile.pocPrice)}，70% 价值区 ${number(result.profile.valueAreaLow)}–${number(result.profile.valueAreaHigh)}，当前价位于${LOCATION_LABELS[result.marketInsights.location]}，属于${ACCEPTANCE_LABELS[result.marketInsights.acceptance]}。`,
  ].join("\n");
}

export function buildVpvrAnalysisReport(snapshot, result) {
  const profile = result.profile;
  const insights = result.marketInsights;
  const nearestHvn = insights.nearestHvn
    ? `最近 HVN 位于 **${number(insights.nearestHvn.priceLow)}–${number(insights.nearestHvn.priceHigh)}**，代表可见范围内成交更集中、市场接受度较高的价格区。`
    : "当前可见范围没有形成独立且显著的 HVN 峰值。";
  const nearestLvn = insights.nearestLvn
    ? `最近 LVN 位于 **${number(insights.nearestLvn.priceLow)}–${number(insights.nearestLvn.priceHigh)}**，代表成交稀疏、价格更可能快速穿越或快速拒绝的低接受区。`
    : "当前可见范围没有形成独立且显著的 LVN 谷值。";
  return [
    "## VPVR 成交量分布结论",
    "",
    "### 支撑位",
    levelLines(result.levels.supports, "- 当前价下方未形成独立于现价区的显著 VPVR 支撑节点。"),
    "",
    "### 阻力位",
    levelLines(result.levels.resistances, "- 当前价上方未形成独立于现价区的显著 VPVR 阻力节点。"),
    "",
    "### VPVR 市场信息",
    `- 当前价 **${number(insights.currentPrice)}** 位于 **${LOCATION_LABELS[insights.location]}**，当前所处位置归类为 **${ACCEPTANCE_LABELS[insights.acceptance]}**。`,
    `- POC 为 **${number(profile.pocPrice)}**；70% 价值区为 **${number(profile.valueAreaLow)}–${number(profile.valueAreaHigh)}**，实际覆盖 ${percent(profile.valueAreaShare)} 的估算成交量，价值区宽度占整个可见价格范围 ${percent(insights.valueAreaWidthShare)}。`,
    `- ${nearestHvn}`,
    `- ${nearestLvn}`,
    `- 当前价下方累计成交量占 ${percent(insights.belowVolumeShare)}，上方占 ${percent(insights.aboveVolumeShare)}；这描述成交分布重心，不代表买卖方向。`,
    `- 本次按当前可见窗口的 ${result.candleCount} 根 ${snapshot.interval} K 线、${result.rowCount} 个价格档位计算；包含 ${result.developingCandleCount} 根尚在发展的 K 线。由于输入只有 OHLCV、没有更低周期或逐笔成交价，档位成交量是按每根 K 线高低区间重叠比例分配的估算值；缩放、平移或新成交都会使 VPVR、POC、VAH/VAL 与节点重新计算。`,
  ].join("\n");
}

function drawingOperation(analysisId, suffix, role, level, startTime, endTime, evidenceIds) {
  return {
    op: "upsert",
    drawing: {
      id: `${analysisId}-${suffix}`,
      strategyId: STRATEGY_ID,
      theory: "strategy",
      layer: `ai/strategy/${STRATEGY_ID}`,
      tool: "path",
      points: [{ time: startTime, price: level.price }, { time: endTime, price: level.price }],
      text: `${levelName(level)} ${number(level.priceLow)}–${number(level.priceHigh)}`,
      colorToken: `strategy-${role}`,
      lineStyle: "dashed",
      lineWidth: 0.8,
      status: "confirmed",
      evidenceIds,
    },
  };
}

export function buildVpvrAnalysisDrawingPatch(snapshot, result) {
  const analysisId = `vpvr-analysis-${crypto.createHash("sha1").update(`${snapshot.snapshotId}:${STRATEGY_ID}`).digest("hex").slice(0, 18)}`;
  const startTime = snapshot.candles[0].time;
  const endTime = snapshot.candles.at(-1).time;
  const operations = [
    ...result.levels.supports.slice(0, 3).map((level, index) => drawingOperation(
      analysisId,
      `support-${index}`,
      "support",
      level,
      startTime,
      endTime,
      [`vpvr-support-${index}-${result.lastProfileBarTime}`],
    )),
    ...result.levels.resistances.slice(0, 3).map((level, index) => drawingOperation(
      analysisId,
      `resistance-${index}`,
      "resistance",
      level,
      startTime,
      endTime,
      [`vpvr-resistance-${index}-${result.lastProfileBarTime}`],
    )),
  ];
  if (!operations.length) {
    operations.push(drawingOperation(
      analysisId,
      "poc",
      "primary",
      { price: result.profile.pocPrice, priceLow: result.profile.rows[result.profile.pocIndex].priceLow, priceHigh: result.profile.rows[result.profile.pocIndex].priceHigh, kinds: ["POC"] },
      startTime,
      endTime,
      [`vpvr-poc-${result.lastProfileBarTime}`],
    ));
  }
  return validateStrategyDrawingPatch({
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    analysisId,
    baseRevision: 0,
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    operations,
  }, snapshot, STRATEGY_ID);
}

export async function runVpvrAnalysisPipeline(params) {
  const snapshot = normalizeTradingMarketSnapshot(params, { minimumCandles: 8 });
  const theoryResult = runVpvrAnalysisEngine(snapshot);
  const drawingPatch = buildVpvrAnalysisDrawingPatch(snapshot, theoryResult);
  const narrative = buildVpvrAnalysisNarrative(theoryResult);
  return {
    ok: true,
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    snapshot: {
      snapshotId: snapshot.snapshotId,
      marketId: snapshot.marketId,
      interval: snapshot.interval,
      snapshotTime: snapshot.snapshotTime,
      lastClosedBarTime: theoryResult.lastClosedBarTime,
      inputHash: snapshot.inputHash,
    },
    theoryResult,
    analysisPlan: {
      schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
      analysisId: drawingPatch.analysisId,
      revision: 0,
      snapshotId: snapshot.snapshotId,
      marketId: snapshot.marketId,
      interval: snapshot.interval,
      narrative,
      report: buildVpvrAnalysisReport(snapshot, theoryResult),
      actionPlan: theoryResult.actionPlan,
      drawingPatch,
    },
    model: {
      providerId: "deterministic",
      modelId: "vpvr-visible-range-volume-profile-engine-v1",
      requestId: null,
      latencyMs: 0,
      usage: null,
      finishReason: "deterministic-succeeded",
    },
  };
}
