import crypto from "node:crypto";
import { runDowTheoryEngine } from "./dow-theory-engine.mjs";
import {
  TRADING_ANALYSIS_SCHEMA_VERSION,
  normalizeTradingMarketSnapshot,
  validateStrategyDrawingPatch,
} from "./protocol.mjs";

const STRATEGY_ID = "dow-theory";

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const digits = Math.abs(number) >= 1_000 ? 2 : Math.abs(number) >= 1 ? 4 : 6;
  return number.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function directionLabel(direction) {
  if (direction === "bullish") return "上升趋势";
  if (direction === "bearish") return "下降趋势";
  if (direction === "transition") return "趋势转换/分歧";
  return "趋势未确认";
}

function confirmationLabel(result) {
  const confirmation = result.closeConfirmation;
  if (confirmation.state === "close-breakout") {
    return `已收盘 K 线${confirmation.direction === "bullish" ? "向上" : "向下"}越过主级别反应点，形成收盘确认`;
  }
  if (confirmation.state === "wick-only-unconfirmed") return "只有影线越过结构边界，收盘未确认";
  if (confirmation.state === "inside-structure") return "收盘仍在最近主级别反应高低点之间";
  return "主级别反应高低点不足，尚不能确认延续或反转";
}

function higherTimeframeLabel(value) {
  if (value.status === "aligned") return "已提供的高周期与当前主趋势同向";
  if (value.status === "contradicted") return "已提供的高周期与当前主趋势冲突";
  if (value.status === "mixed") return "高周期方向相互分歧";
  if (value.status === "partial") return "高周期结构尚未形成明确方向";
  return "未获得合格高周期数据";
}

function volumeLabel(value) {
  if (value.status === "supporting") return `成交量对当前方向形成辅助确认（方向量比 ${value.ratio}）`;
  if (value.status === "opposing") return `成交量未配合当前方向（方向量比 ${value.ratio}）`;
  if (value.status === "neutral") return `成交量辅助证据中性（方向量比 ${value.ratio}）`;
  if (value.status === "partial") return "有效成交量样本不足，只能降级观察";
  return "未获得足够成交量数据";
}

function scaleLine(scale) {
  const recent = scale.pivots.slice(-4).map((pivot) => `${pivot.label} ${formatPrice(pivot.price)}`).join(" → ");
  return `${directionLabel(scale.direction)}${recent ? `；最近摆动 ${recent}` : "；确认摆动不足"}`;
}

export function buildDowTheoryReport(snapshot, result) {
  const action = result.actionPlan;
  const direction = result.scales.primary.direction;
  const contextLines = result.confirmations.higherTimeframes.contexts.length
    ? result.confirmations.higherTimeframes.contexts.map((context) => `${context.interval} ${directionLabel(context.direction)}`).join("；")
    : "无";
  const levelLines = direction === "bullish" && action.longTrigger
    ? [
      `- 多头触发：已收盘 K 线站上 ${formatPrice(action.longTrigger)}，回踩不重新跌破后才考虑执行。`,
      `- 失效/止损参考：${formatPrice(action.longInvalidation)}；分批目标：T1 ${formatPrice(action.longTargets[0])}，T2 ${formatPrice(action.longTargets[1])}。`,
    ]
    : direction === "bearish" && action.shortTrigger
      ? [
        `- 空头触发：已收盘 K 线跌破 ${formatPrice(action.shortTrigger)}，反抽不重新站回后才考虑执行。`,
        `- 失效/止损参考：${formatPrice(action.shortInvalidation)}；分批目标：T1 ${formatPrice(action.shortTargets[0])}，T2 ${formatPrice(action.shortTargets[1])}。`,
      ]
      : ["- 当前主趋势未确认：不生成虚假入场、止损或目标价，继续等待完整高低点序列。"];
  return [
    "## 道氏理论结论",
    "",
    `当前主级别为 **${directionLabel(direction)}**；${confirmationLabel(result)}。`,
    "",
    "### 三层趋势",
    `- 主要趋势：${scaleLine(result.scales.primary)}。`,
    `- 次级运动：${scaleLine(result.scales.secondary)}。`,
    `- 小级别波动：${scaleLine(result.scales.minor)}。`,
    "",
    "### 确认与边界",
    `- 收盘价：${confirmationLabel(result)}；影线刺破不计作确认。`,
    `- 高周期上下文：${higherTimeframeLabel(result.confirmations.higherTimeframes)}；明细：${contextLines}。这是产品化的多周期证据，不是经典双指数确认。`,
    `- 成交量：${volumeLabel(result.confirmations.volume)}；成交量只作辅助，不能单独改写价格趋势。`,
    `- 经典市场相互确认：不可用。${result.confirmations.classicAverages.reason}。`,
    `- 市场阶段：不自动命名。${result.phase.reason}。`,
    "",
    "### 条件式执行",
    `- 当前动作：等待条件触发；方向判断为${direction === "bullish" ? "偏多" : direction === "bearish" ? "偏空" : "中性"}。`,
    ...levelLines,
    `- 确认要求：${action.confirmation}`,
    "- 仓位与风险：单笔预设亏损上限由统一执行计划按账户权益约 1% 约束；没有账户权益和合约规格时不生成数量。",
    "- 取消条件：结构失效、高周期冲突扩大、数据覆盖下降、触发后重新收回结构内或方案超过六个当前周期。",
    "",
    "### 数据与限制",
    `本次使用 ${result.closedCandleCount} 根 ${snapshot.interval} 已收盘 K 线；排除 ${result.excludedLiveCandles} 根未收盘 K 线。结构、触发和价格可由相同输入复算。`,
    "道氏理论用于判断趋势环境和确认条件，不承诺趋势持续、目标到达或收益，也不创建自动订单。",
  ].join("\n");
}

function analysisId(snapshot) {
  return `dow-analysis-${crypto.createHash("sha1")
    .update(`${snapshot.snapshotId}:${STRATEGY_ID}`)
    .digest("hex")
    .slice(0, 18)}`;
}

function operation(analysis, suffix, role, tool, points, text, appearance = {}, evidenceIds = []) {
  return {
    op: "upsert",
    drawing: {
      id: `${analysis}-${suffix}`,
      strategyId: STRATEGY_ID,
      theory: "strategy",
      layer: `ai/strategy/${STRATEGY_ID}`,
      tool,
      points: points.map((point) => ({ time: point.time, price: Math.max(Number.EPSILON, point.price) })),
      ...(text ? { text } : {}),
      colorToken: `strategy-${role}`,
      ...(appearance.lineStyle ? { lineStyle: appearance.lineStyle } : {}),
      ...(Number.isFinite(appearance.lineWidth) ? { lineWidth: appearance.lineWidth } : {}),
      ...(Number.isFinite(appearance.fontSize) ? { fontSize: appearance.fontSize } : {}),
      ...(typeof appearance.bold === "boolean" ? { bold: appearance.bold } : {}),
      status: appearance.status || "confirmed",
      evidenceIds,
    },
  };
}

function appendLevel(operations, analysis, snapshot, suffix, role, price, label, evidenceIds) {
  if (!Number.isFinite(price) || price <= 0) return;
  const start = snapshot.candles[Math.max(0, snapshot.candles.length - 48)];
  const end = snapshot.candles.at(-1);
  operations.push(operation(
    analysis,
    suffix,
    role,
    "path",
    [{ time: start.time, price }, { time: end.time, price }],
    label,
    { lineStyle: "dashed", lineWidth: 1.2, status: "tentative" },
    evidenceIds,
  ));
}

export function buildDowTheoryDrawingPatch(snapshot, result) {
  const analysis = analysisId(snapshot);
  const operations = [];
  const primary = result.scales.primary.pivots.slice(-12);
  const secondary = result.scales.secondary.pivots.slice(-12);
  if (primary.length >= 2) operations.push(operation(
    analysis,
    "primary-structure",
    "primary",
    "path",
    primary,
    undefined,
    { lineStyle: "solid", lineWidth: 2.5 },
    primary.map((pivot) => pivot.id),
  ));
  primary.forEach((pivot, index) => operations.push(operation(
    analysis,
    `primary-label-${index}`,
    "primary",
    "text",
    [{ time: pivot.time, price: pivot.price + (pivot.type === "high" ? 1 : -1) * Math.max(result.rangeUnit * 0.4, pivot.price * 0.0004) }],
    pivot.label,
    { fontSize: 12, bold: true },
    [pivot.id],
  )));
  if (secondary.length >= 2) operations.push(operation(
    analysis,
    "secondary-movement",
    "note",
    "path",
    secondary,
    undefined,
    { lineStyle: "dotted", lineWidth: 1.2 },
    secondary.map((pivot) => pivot.id),
  ));
  const evidenceIds = result.evidence.slice(0, 12).map((item) => item.id);
  const action = result.actionPlan;
  appendLevel(operations, analysis, snapshot, "long-trigger", "entry", action.longTrigger, `多头收盘触发 ${formatPrice(action.longTrigger)}`, evidenceIds);
  appendLevel(operations, analysis, snapshot, "short-trigger", "entry", action.shortTrigger, `空头收盘触发 ${formatPrice(action.shortTrigger)}`, evidenceIds);
  appendLevel(operations, analysis, snapshot, "long-stop", "stop", action.longInvalidation, `多头失效 ${formatPrice(action.longInvalidation)}`, evidenceIds);
  appendLevel(operations, analysis, snapshot, "short-stop", "stop", action.shortInvalidation, `空头失效 ${formatPrice(action.shortInvalidation)}`, evidenceIds);
  (action.longTargets || action.shortTargets || []).forEach((price, index) => appendLevel(
    operations,
    analysis,
    snapshot,
    `target-${index}`,
    "target",
    price,
    `T${index + 1} ${formatPrice(price)}`,
    evidenceIds,
  ));
  const latest = result.lastClosedCandle;
  operations.push(operation(
    analysis,
    "summary",
    "note",
    "note",
    [{ time: latest.time, price: latest.close }],
    `道氏：${directionLabel(result.scales.primary.direction)} · ${confirmationLabel(result)}`,
    { status: result.closeConfirmation.state === "close-breakout" ? "confirmed" : "tentative" },
    evidenceIds,
  ));
  return validateStrategyDrawingPatch({
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    analysisId: analysis,
    baseRevision: 0,
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    operations,
  }, snapshot, STRATEGY_ID);
}

function snapshotSummary(snapshot, result) {
  return {
    snapshotId: snapshot.snapshotId,
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    snapshotTime: snapshot.snapshotTime,
    lastClosedBarTime: result.lastClosedCandle.time,
    inputHash: snapshot.inputHash,
  };
}

export async function runTradingDowTheoryPipeline(params) {
  const snapshot = normalizeTradingMarketSnapshot(params);
  const theoryResult = runDowTheoryEngine(snapshot);
  const drawingPatch = buildDowTheoryDrawingPatch(snapshot, theoryResult);
  return {
    ok: true,
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    snapshot: snapshotSummary(snapshot, theoryResult),
    theoryResult,
    analysisPlan: {
      schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
      analysisId: drawingPatch.analysisId,
      revision: 0,
      snapshotId: snapshot.snapshotId,
      marketId: snapshot.marketId,
      interval: snapshot.interval,
      narrative: `道氏理论分析完成：主要趋势为${directionLabel(theoryResult.scales.primary.direction)}，已绘制主要趋势、次级运动和条件价位。`,
      report: buildDowTheoryReport(snapshot, theoryResult),
      actionPlan: theoryResult.actionPlan,
      drawingPatch,
    },
    model: {
      providerId: "deterministic",
      modelId: DOW_THEORY_MODEL_ID,
      requestId: null,
      latencyMs: 0,
      usage: null,
      finishReason: "deterministic-succeeded",
    },
  };
}

export const DOW_THEORY_MODEL_ID = "dow-theory-trend-context-engine-v1";
