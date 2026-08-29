import crypto from "node:crypto";
import { runKdjAnalysisEngine } from "./kdj-analysis-engine.mjs";
import { TRADING_ANALYSIS_SCHEMA_VERSION, normalizeTradingMarketSnapshot, validateStrategyDrawingPatch, validateStrategyIndicatorDrawingPatch } from "./protocol.mjs";

const STRATEGY_ID = "kdj-analysis";
const KDJ_LABEL_ROWS = Object.freeze([44, 38, 32, 26, 20]);
const INDICATOR_LEADER_TIME_EPSILON_SECONDS = 1;

const DIVERGENCE_LABELS = Object.freeze({
  "regular-bearish": "顶背离",
  "regular-bullish": "底背离",
  "hidden-bullish": "隐藏看涨背离",
  "hidden-bearish": "隐藏看跌背离",
});
const ZONE_LABELS = Object.freeze({ overbought: "超买区", oversold: "超卖区", neutral: "中性区" });

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 6 }) : "—";
}

function operation(analysisId, suffix, role, tool, points, text, evidenceIds = [], appearance = {}) {
  const lineTool = tool === "path";
  return {
    op: "upsert",
    drawing: {
      id: `${analysisId}-${suffix}`,
      strategyId: STRATEGY_ID,
      theory: "strategy",
      layer: `ai/strategy/${STRATEGY_ID}`,
      tool,
      points,
      ...(text ? { text } : {}),
      colorToken: `strategy-${role}`,
      ...(lineTool ? { lineStyle: appearance.lineStyle || "dashed", lineWidth: appearance.lineWidth || 1.2 } : {}),
      ...((tool === "note" || tool === "text") ? { fontSize: appearance.fontSize || 12, bold: false } : {}),
      ...((tool === "note" || tool === "text") && Number.isFinite(appearance.markerSize) ? { markerSize: appearance.markerSize } : {}),
      status: appearance.status || "confirmed",
      evidenceIds,
    },
  };
}

function kdjAnnotationOperations(analysisId, params) {
  if (!Number.isFinite(params.targetTime) || !Number.isFinite(params.targetValue)) return [];
  const target = { time: params.targetTime, value: params.targetValue };
  const label = { time: params.targetTime, value: KDJ_LABEL_ROWS[params.ordinal % KDJ_LABEL_ROWS.length] };
  const leaderLabel = { ...label, time: label.time + INDICATOR_LEADER_TIME_EPSILON_SECONDS };
  return [
    operation(analysisId, `${params.id}-leader`, "note", "path", [target, leaderLabel], "", params.evidenceIds, { lineStyle: "dashed", lineWidth: 0.8, status: params.status }),
    operation(analysisId, `${params.id}-dot`, "note", "note", [target], "", params.evidenceIds, { markerSize: 0.35, status: params.status }),
    operation(analysisId, `${params.id}-label`, "note", "text", [label], params.text, params.evidenceIds, { markerSize: 0, fontSize: 11, status: params.status }),
  ];
}

export function buildKdjAnalysisReport(snapshot, result) {
  const crossovers = result.crossovers.length
    ? result.crossovers.slice(-5).map((item) => `- **${item.name}**：K/D 精确交点 ${number(item.crossPoint.value)}；${item.eligible ? "位于有效极值区域，可作为方向证据" : "位于中位区，只作观察"}。`).join("\n")
    : "- 最近窗口没有已收盘 K 线确认的 K/D 交叉。";
  const divergences = result.divergences.length
    ? result.divergences.map((item) => `- **${DIVERGENCE_LABELS[item.kind]}**：价格 ${number(item.priceFirst)} → ${number(item.priceSecond)}；D 线 ${number(item.dFirst)} → ${number(item.dSecond)}；第二摆动点已有两根右侧已收盘 K 线确认。`).join("\n")
    : "- 最近确认摆动中没有同时通过间隔、幅度、D 线差值与右侧 K 线确认的背离。";
  const events = result.extremeEvents.length
    ? result.extremeEvents.slice(-5).map((item) => `${item.name}（${number(item.value)}）`).join("；")
    : "最近 24 根已收盘 K 线没有 D 线出区或 J 线极值穿越";
  const action = result.actionPlan;
  const trigger = action.longTrigger || action.shortTrigger;
  const stop = action.longInvalidation || action.shortInvalidation;
  const targets = action.longTargets || action.shortTargets || [];
  return [
    "## KDJ 指标结论",
    "",
    `KDJ(9,3,3) 当前 K **${number(result.currentState.k)}**、D **${number(result.currentState.d)}**、J **${number(result.currentState.j)}**，位于 **${ZONE_LABELS[result.currentState.zone]}**，排列为 **${result.currentState.alignment === "bullish" ? "多头" : result.currentState.alignment === "bearish" ? "空头" : "混合"}**。`,
    `D 线动量${result.currentState.dMomentum === "rising" ? "上行" : result.currentState.dMomentum === "falling" ? "下行" : "走平"}；${result.currentState.saturation === "none" ? "当前未形成连续钝化" : `已形成 ${result.currentState.saturationBars} 根已收盘 K 线的${result.currentState.saturation === "high-persistence" ? "高位" : "低位"}钝化`}。J 线允许真实超出 0–100，不做截断。`,
    "",
    "### K/D 交叉",
    crossovers,
    "",
    "### 极值区与钝化",
    `- ${events}。80/20 是动量状态，不是立即反转指令；趋势中 KDJ 可以持续钝化。`,
    "",
    "### D 线背离",
    divergences,
    "",
    "### 标准执行方案",
    `- 当前动作：**等待条件触发**；方向为${action.primaryBias === "bullish" ? "偏多" : action.primaryBias === "bearish" ? "偏空" : "中性"}。KDJ 不得单独触发下单。`,
    trigger ? `- 收盘触发：${action.primaryBias === "bullish" ? "站上" : "跌破"} ${number(trigger)}；结构失效/止损参考 ${number(stop)}。` : "- 尚无有效低位金叉、高位死叉或确认背离，不生成虚假入场、止损和目标。",
    targets.length ? `- 分批目标：T1 ${number(targets[0])}；T2 ${number(targets[1])}；触发后按真实成交价重新核对风险收益。` : "- 方向未确认前不生成虚假止盈价。",
    `- 确认：${action.confirmation}`,
    `- 继续观察：${action.observeTrigger}`,
    "- 仓位：单笔预设最大风险约账户权益 1%；缺少权益、合约乘数和最小数量时不生成仓位数量。",
    "- 有效期与取消：最多四个当前周期；K/D 反向交叉、背离摆动失效、价格触及失效位、数据过期或目标/止损到达即取消。",
    "",
    "### 数据与限制",
    `本次使用 ${result.closedCandleCount} 根 ${snapshot.interval} 已收盘 K 线，排除 ${result.excludedLiveCandles} 根未收盘 K 线。分析引擎、原生 KDJ 副图与预警计算统一使用 9,3,3 递推公式，K/D 初值均为 50。`,
    "KDJ 是随机动量振荡器；超买/超卖、交叉、背离和 J 线极值均不构成收益承诺或自动订单。",
  ].join("\n");
}

export function buildKdjAnalysisDrawingPatch(snapshot, result) {
  const analysisId = `kdj-analysis-${crypto.createHash("sha1").update(`${snapshot.snapshotId}:${STRATEGY_ID}`).digest("hex").slice(0, 18)}-price`;
  const operations = [];
  const action = result.actionPlan;
  const start = snapshot.candles[Math.max(0, result.closedCandleCount - 36)];
  const end = snapshot.candles[result.closedCandleCount - 1];
  const evidenceIds = result.evidence.slice(0, 12).map((item) => item.id);
  const level = (suffix, role, value, label) => Number.isFinite(value) && value > 0 && operations.push(operation(analysisId, suffix, role, "path", [{ time: start.time, price: value }, { time: end.time, price: value }], `${label} ${number(value)}`, evidenceIds));
  level("long-trigger", "entry", action.longTrigger, "多头收盘触发");
  level("short-trigger", "entry", action.shortTrigger, "空头收盘触发");
  level("long-stop", "stop", action.longInvalidation, "多头失效");
  level("short-stop", "stop", action.shortInvalidation, "空头失效");
  (action.longTargets || action.shortTargets || []).forEach((value, index) => level(`target-${index}`, "target", value, `T${index + 1}`));
  return operations.length
    ? validateStrategyDrawingPatch({ schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION, analysisId, baseRevision: 0, marketId: snapshot.marketId, interval: snapshot.interval, operations }, snapshot, STRATEGY_ID)
    : null;
}

export function buildKdjIndicatorDrawingPatch(snapshot, result) {
  const analysisId = `kdj-analysis-${crypto.createHash("sha1").update(`${snapshot.snapshotId}:${STRATEGY_ID}`).digest("hex").slice(0, 18)}-indicator`;
  const operations = [];
  let ordinal = 0;
  for (const item of result.divergences.slice(-2)) {
    const first = snapshot.candles[item.firstIndex];
    const second = snapshot.candles[item.secondIndex];
    const role = item.kind.includes("bullish") ? "support" : "resistance";
    operations.push(operation(analysisId, item.id, role, "path", [{ time: first.time, value: item.dFirst }, { time: second.time, value: item.dSecond }], "", [item.id], { lineWidth: 1.5 }));
    operations.push(...kdjAnnotationOperations(analysisId, {
      id: item.id,
      targetTime: second.time,
      targetValue: item.dSecond,
      ordinal,
      text: `${DIVERGENCE_LABELS[item.kind]} · D线`,
      evidenceIds: [item.id],
      status: "confirmed",
    }));
    ordinal += 1;
  }
  for (const item of result.crossovers.slice(-3)) {
    operations.push(...kdjAnnotationOperations(analysisId, {
      id: item.id,
      targetTime: item.crossPoint.time,
      targetValue: item.crossPoint.value,
      ordinal,
      text: `${item.name}${item.eligible ? "" : " · 仅观察"}`,
      evidenceIds: [item.id],
      status: item.eligible ? "confirmed" : "tentative",
    }));
    ordinal += 1;
  }
  const occupiedTimes = new Set(operations.filter((item) => item.drawing.id.endsWith("-dot")).map((item) => item.drawing.points[0]?.time));
  for (const item of result.extremeEvents.slice(-2)) {
    const candle = snapshot.candles[item.index];
    if (!candle || occupiedTimes.has(candle.time)) continue;
    operations.push(...kdjAnnotationOperations(analysisId, {
      id: item.id,
      targetTime: candle.time,
      targetValue: item.value,
      ordinal,
      text: `${item.name} · ${number(item.value)}`,
      evidenceIds: [item.id],
      status: "confirmed",
    }));
    ordinal += 1;
    occupiedTimes.add(candle.time);
  }
  if (!operations.length) {
    const index = Math.max(0, result.closedCandleCount - 1);
    operations.push(...kdjAnnotationOperations(analysisId, {
      id: "summary",
      targetTime: snapshot.candles[index].time,
      targetValue: result.series.d[index],
      ordinal: 0,
      text: "KDJ：暂无有效交叉/背离，继续等待",
      evidenceIds: result.evidence.slice(0, 8).map((item) => item.id),
      status: "tentative",
    }));
  }
  return validateStrategyIndicatorDrawingPatch({
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    analysisId,
    baseRevision: 0,
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    indicatorId: "kdj",
    operations,
  }, snapshot, STRATEGY_ID, "kdj");
}

export async function runKdjAnalysisPipeline(params) {
  const snapshot = normalizeTradingMarketSnapshot(params);
  const theoryResult = runKdjAnalysisEngine(snapshot);
  const drawingPatch = buildKdjAnalysisDrawingPatch(snapshot, theoryResult);
  const indicatorDrawingPatch = buildKdjIndicatorDrawingPatch(snapshot, theoryResult);
  return {
    ok: true,
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    snapshot: { snapshotId: snapshot.snapshotId, marketId: snapshot.marketId, interval: snapshot.interval, snapshotTime: snapshot.snapshotTime, lastClosedBarTime: theoryResult.lastClosedCandle.time, inputHash: snapshot.inputHash },
    theoryResult,
    analysisPlan: {
      schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
      analysisId: indicatorDrawingPatch.analysisId,
      revision: 0,
      snapshotId: snapshot.snapshotId,
      marketId: snapshot.marketId,
      interval: snapshot.interval,
      narrative: `KDJ 分析完成：识别 ${theoryResult.crossovers.length} 个 K/D 交叉、${theoryResult.divergences.length} 个确认背离。`,
      report: buildKdjAnalysisReport(snapshot, theoryResult),
      actionPlan: theoryResult.actionPlan,
      drawingPatch,
      indicatorDrawingPatch,
    },
    model: { providerId: "deterministic", modelId: "kdj-analysis-pattern-divergence-engine-v1", requestId: null, latencyMs: 0, usage: null, finishReason: "deterministic-succeeded" },
  };
}
