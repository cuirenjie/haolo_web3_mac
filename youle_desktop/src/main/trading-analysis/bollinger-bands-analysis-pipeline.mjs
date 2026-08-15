import crypto from "node:crypto";
import { runBollingerBandsAnalysisEngine } from "./bollinger-bands-analysis-engine.mjs";
import { TRADING_ANALYSIS_SCHEMA_VERSION, normalizeTradingMarketSnapshot, validateStrategyDrawingPatch } from "./protocol.mjs";

const STRATEGY_ID = "bollinger-bands-analysis";

function price(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 6 }) : "—";
}

function percent(value, digits = 2) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(digits)}%` : "—";
}

const LOCATION_LABELS = Object.freeze({
  "above-upper": "上轨外",
  "upper-half": "中轨与上轨之间",
  "lower-half": "中轨与下轨之间",
  "below-lower": "下轨外",
});

const REGIME_LABELS = Object.freeze({ squeeze: "缩口", expanding: "扩张", normal: "常态" });

export function buildBollingerBandsAnalysisReport(snapshot, result) {
  const patterns = result.patterns.length
    ? result.patterns.map((item) => `- **${item.name}**：${item.detail}；由 ${new Date(snapshot.candles[item.startIndex].time * 1_000).toLocaleString("zh-CN", { hour12: false })} 至 ${new Date(snapshot.candles[item.endIndex].time * 1_000).toLocaleString("zh-CN", { hour12: false })}。`).join("\n")
    : "- 最近窗口没有通过顺序、带宽、外轨和收盘确认的 M 顶、W 底、缩口突破或假突破；不强行命名。";
  const action = result.actionPlan;
  const trigger = action.longTrigger || action.shortTrigger;
  const stop = action.longInvalidation || action.shortInvalidation;
  const targets = action.longTargets || action.shortTargets || [];
  const walk = result.bandWalk ? `检测到 **${result.bandWalk.name}**：${result.bandWalk.detail}。沿带运行表示趋势证据，不等于追价信号。` : "当前没有满足重复触轨、外半带收盘比例和中轨斜率的沿带运行。";
  return [
    "## 布林带指标结论",
    "",
    `BOLL(20,2) 当前价格位于 **${LOCATION_LABELS[result.currentState.location]}**，带宽状态为 **${REGIME_LABELS[result.currentState.volatilityRegime]}**，中轨${result.currentState.middleSlope > 0.001 ? "上行" : result.currentState.middleSlope < -0.001 ? "下行" : "近似走平"}。`,
    `上轨 ${price(result.currentState.upper)}；中轨 ${price(result.currentState.middle)}；下轨 ${price(result.currentState.lower)}；%B ${price(result.currentState.percentB)}；BandWidth ${percent(result.currentState.bandwidth)}；历史百分位 ${percent(result.currentState.bandwidthPercentile)}。`,
    "",
    "### 结构与波动",
    walk,
    result.recentSqueeze ? `最近一次低带宽出现在 ${new Date(result.recentSqueeze.time * 1_000).toLocaleString("zh-CN", { hour12: false })}，BandWidth ${percent(result.recentSqueeze.bandwidth)}、百分位 ${percent(result.recentSqueeze.percentile)}；缩口本身不提供方向。` : "最近 12 根已收盘 K 线没有进入自身带宽历史的低 20% 区域。",
    "",
    "### 经典形态",
    patterns,
    "",
    "### 当前执行方案",
    `- 当前动作：**等待条件触发**；方向为${action.primaryBias === "bullish" ? "偏多" : action.primaryBias === "bearish" ? "偏空" : "中性"}。单次触轨不能触发下单。`,
    trigger ? `- 收盘再确认：${action.primaryBias === "bullish" ? "站上" : "跌破"} ${price(trigger)}；结构失效/止损参考 ${price(stop)}。` : "- 尚无完整的方向、触发与失效组合，不生成虚假入场价。",
    targets.length ? `- 分批目标：T1 ${price(targets[0])}；T2 ${price(targets[1])}；只在触发后按真实成交价重新核对风险收益。` : "- 方向未确认前不生成虚假止盈价。",
    `- 确认：${action.confirmation}`,
    `- 继续观察：${action.observeTrigger}`,
    "- 仓位：单笔预设最大风险约账户权益 1%；缺少权益、合约乘数和最小数量时不生成仓位数量。",
    "- 有效期与取消：最多四个当前周期；收回结构内部、相反方向越轨确认、失效位触发、数据过期或目标/止损到达即取消。",
    "",
    "### 数据与限制",
    `本次使用 ${result.closedCandleCount} 根 ${snapshot.interval} 已收盘 K 线，排除 ${result.excludedLiveCandles} 根未收盘 K 线。原生主图 BOLL 与分析引擎共同使用 SMA(20) 和 2 倍总体标准差。`,
    "布林带描述相对高低与波动状态，不证明超买超卖，不保证缩口后的方向，也不构成收益承诺或自动订单。",
  ].join("\n");
}

function operation(analysisId, suffix, role, tool, points, text, evidenceIds = [], appearance = {}) {
  const lineTool = ["path", "rectangle", "circle", "ellipse"].includes(tool);
  const textTool = tool === "note" || tool === "text";
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
      ...(textTool ? { fontSize: appearance.fontSize || 12, bold: false } : {}),
      status: appearance.status || "confirmed",
      evidenceIds,
    },
  };
}

export function buildBollingerBandsAnalysisDrawingPatch(snapshot, result) {
  const analysisId = `bollinger-bands-analysis-${crypto.createHash("sha1").update(`${snapshot.snapshotId}:${STRATEGY_ID}`).digest("hex").slice(0, 18)}`;
  const operations = [];
  const evidenceIds = result.evidence.slice(0, 16).map((item) => item.id);
  for (const item of result.patterns.slice(-4)) {
    const role = item.bias === "bullish" ? "support" : "resistance";
    if (Array.isArray(item.pivotIndices)) {
      const points = item.pivotIndices.map((index) => ({
        time: snapshot.candles[index].time,
        price: item.kind === "m-top"
          ? (index === item.pivotIndices[1] ? snapshot.candles[index].low : snapshot.candles[index].high)
          : (index === item.pivotIndices[1] ? snapshot.candles[index].high : snapshot.candles[index].low),
      }));
      points.push({ time: snapshot.candles[item.confirmationIndex].time, price: item.neckline });
      operations.push(operation(analysisId, `${item.id}-structure`, role, "path", points, "", [item.id], { lineStyle: "solid", lineWidth: 1.4 }));
    } else {
      const indices = [item.startIndex, item.breakoutIndex, item.confirmationIndex].filter((index, offset, all) => Number.isInteger(index) && all.indexOf(index) === offset);
      if (indices.length >= 2) operations.push(operation(analysisId, `${item.id}-sequence`, role, "path", indices.map((index) => ({ time: snapshot.candles[index].time, price: snapshot.candles[index].close })), "", [item.id], { lineWidth: 1.2 }));
    }
    const marker = snapshot.candles[item.confirmationIndex];
    const width = result.series.upper[item.confirmationIndex] - result.series.lower[item.confirmationIndex];
    const labelPrice = item.bias === "bullish" ? marker.low - width * 0.15 : marker.high + width * 0.15;
    operations.push(operation(analysisId, `${item.id}-label`, "note", "note", [{ time: marker.time, price: Math.max(labelPrice, Number.EPSILON) }], `${item.name} · 收盘确认`, [item.id]));
  }
  if (result.recentSqueeze && !result.patterns.some((item) => item.startIndex === result.recentSqueeze.index)) {
    const startIndex = result.recentSqueeze.index;
    const endIndex = Math.min(result.closedCandleCount - 1, startIndex + 6);
    const upper = Math.max(...result.series.upper.slice(startIndex, endIndex + 1).filter(Number.isFinite));
    const lower = Math.min(...result.series.lower.slice(startIndex, endIndex + 1).filter(Number.isFinite));
    operations.push(operation(analysisId, "recent-squeeze", "primary", "rectangle", [{ time: snapshot.candles[startIndex].time, price: upper }, { time: snapshot.candles[endIndex].time, price: lower }], "缩口观察区 · 等待方向", [result.recentSqueeze.id], { lineWidth: 1 }));
  }
  if (result.bandWalk) {
    const seriesKey = result.bandWalk.bias === "bullish" ? "upper" : "lower";
    const indices = [result.bandWalk.startIndex, Math.floor((result.bandWalk.startIndex + result.bandWalk.endIndex) / 2), result.bandWalk.endIndex];
    operations.push(operation(analysisId, result.bandWalk.id, "primary", "path", indices.map((index) => ({ time: snapshot.candles[index].time, price: result.series[seriesKey][index] })), result.bandWalk.name, [result.bandWalk.id], { lineStyle: "dotted", lineWidth: 1 }));
  }
  const action = result.actionPlan;
  const start = snapshot.candles[Math.max(0, result.closedCandleCount - 36)];
  const end = snapshot.candles[result.closedCandleCount - 1];
  const level = (suffix, role, value, label) => Number.isFinite(value) && value > 0 && operations.push(operation(analysisId, suffix, role, "path", [{ time: start.time, price: value }, { time: end.time, price: value }], `${label} ${price(value)}`, evidenceIds));
  level("long-trigger", "entry", action.longTrigger, "多头收盘触发");
  level("short-trigger", "entry", action.shortTrigger, "空头收盘触发");
  level("long-stop", "stop", action.longInvalidation, "多头失效");
  level("short-stop", "stop", action.shortInvalidation, "空头失效");
  (action.longTargets || action.shortTargets || []).forEach((value, index) => level(`target-${index}`, "target", value, `T${index + 1}`));
  if (!operations.length) {
    const latest = snapshot.candles[result.closedCandleCount - 1];
    const width = result.currentState.upper - result.currentState.lower;
    operations.push(operation(analysisId, "summary", "note", "note", [{ time: latest.time, price: latest.high + width * 0.12 }], "布林带：暂无可执行形态，继续等待", evidenceIds, { status: "tentative" }));
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

export async function runBollingerBandsAnalysisPipeline(params) {
  const snapshot = normalizeTradingMarketSnapshot(params);
  const theoryResult = runBollingerBandsAnalysisEngine(snapshot);
  const drawingPatch = buildBollingerBandsAnalysisDrawingPatch(snapshot, theoryResult);
  return {
    ok: true,
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    snapshot: {
      snapshotId: snapshot.snapshotId,
      marketId: snapshot.marketId,
      interval: snapshot.interval,
      snapshotTime: snapshot.snapshotTime,
      lastClosedBarTime: theoryResult.lastClosedCandle.time,
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
      narrative: `布林带分析完成：带宽处于${REGIME_LABELS[theoryResult.currentState.volatilityRegime]}状态，识别 ${theoryResult.patterns.length} 个确认形态。`,
      report: buildBollingerBandsAnalysisReport(snapshot, theoryResult),
      actionPlan: theoryResult.actionPlan,
      drawingPatch,
    },
    model: {
      providerId: "deterministic",
      modelId: "bollinger-bands-structure-engine-v1",
      requestId: null,
      latencyMs: 0,
      usage: null,
      finishReason: "deterministic-succeeded",
    },
  };
}
