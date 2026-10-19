import { localizeTradingAnalysisResult, tradingReportTime, tradingReportText, withTradingReportLanguage } from "./report-language.mjs";
import crypto from "node:crypto";
import { runRsiAnalysisEngine } from "./rsi-analysis-engine.mjs";
import { TRADING_ANALYSIS_SCHEMA_VERSION, normalizeTradingMarketSnapshot, validateStrategyDrawingPatch, validateStrategyIndicatorDrawingPatch } from "./protocol.mjs";

const STRATEGY_ID = "rsi-analysis";
const INDICATOR_LEADER_TIME_EPSILON_SECONDS = 1;

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 6 }) : "—";
}

const DIVERGENCE_LABELS = Object.freeze({
  "regular-bearish": "顶背离",
  "regular-bullish": "底背离",
  "hidden-bullish": "隐藏看涨背离",
  "hidden-bearish": "隐藏看跌背离",
});

const ZONE_LABELS = Object.freeze({ overbought: "超买区", oversold: "超卖区", neutral: "中性区" });
const RANGE_LABELS = Object.freeze({ "bullish-range": "多头区间", "bearish-range": "空头区间", "neutral-range": "中性/混合区间" });

export function buildRsiAnalysisReport(snapshot, result) {
  const divergences = result.divergences.length
    ? result.divergences.map((item) => tradingReportText("- **{0}**：价格 {1} → {2}；RSI {3} → {4}；第二摆动点已获得右侧 K 线确认。", DIVERGENCE_LABELS[item.kind], number(item.priceFirst), number(item.priceSecond), number(item.rsiFirst), number(item.rsiSecond))).join("\n")
    : tradingReportText("- 最近确认摆动中没有同时通过间隔、幅度、RSI 差值和右侧 K 线确认的顶/底或隐藏背离。");
  const failureSwings = result.failureSwings.length
    ? result.failureSwings.map((item) => tradingReportText("- **{0}**：四段顺序完整，RSI 已在收盘后{1}中间摆动 {2}。", item.name, item.bias === "bullish" ? tradingReportText("上破") : tradingReportText("下破"), number(item.breakoutValue))).join("\n")
    : tradingReportText("- 最近窗口没有完成“极值 → 反弹/回落 → 次级摆动 → 突破中间摆动”的四段失败摆动。");
  const latestEvents = result.thresholdEvents.length
    ? result.thresholdEvents.slice(-4).map((item) => tradingReportText("{0}（读数 {1}，时间 {2}）", item.name, number(item.value), tradingReportTime(snapshot.candles[item.index].time * 1_000))).join("；")
    : tradingReportText("最近 24 根已收盘 K 线没有 70/30 或 50 中轴交叉");
  const action = result.actionPlan;
  const trigger = action.longTrigger || action.shortTrigger;
  const stop = action.longInvalidation || action.shortInvalidation;
  const targets = action.longTargets || action.shortTargets || [];
  return [
    tradingReportText("## RSI 指标结论"),
    "",
    tradingReportText("RSI(14) 当前为 **{0}**，位于 **{1}**、50 中轴{2}，动量{3}。", number(result.currentState.value), ZONE_LABELS[result.currentState.zone], result.currentState.centerRelation === "above-50" ? tradingReportText("上方") : tradingReportText("下方"), result.currentState.momentum === "rising" ? tradingReportText("上行") : result.currentState.momentum === "falling" ? tradingReportText("下行") : tradingReportText("走平")),
    tradingReportText("最近 RSI 区间 {0}–{1}，归类为 **{2}**。超买/超卖只描述动量状态，不等于立即反转。", number(result.currentState.recentLow), number(result.currentState.recentHigh), RANGE_LABELS[result.currentState.rangeRegime]),
    "",
    tradingReportText("### 阈值与中轴"),
    tradingReportText("- {0}。强趋势中 RSI 可在极值区停留较久，阈值事件只作上下文。", latestEvents),
    "",
    tradingReportText("### 失败摆动"),
    failureSwings,
    "",
    tradingReportText("### 背离"),
    divergences,
    "",
    tradingReportText("### 标准执行方案"),
    tradingReportText("- 当前动作：**等待条件触发**；方向为{0}。RSI 不能单独触发下单。", action.primaryBias === "bullish" ? tradingReportText("偏多") : action.primaryBias === "bearish" ? tradingReportText("偏空") : tradingReportText("中性")),
    trigger ? tradingReportText("- 收盘触发：{0} {1}；结构失效/止损参考 {2}。", action.primaryBias === "bullish" ? tradingReportText("站上") : tradingReportText("跌破"), number(trigger), number(stop)) : tradingReportText("- 尚无确认背离或完整失败摆动，不生成虚假入场、止损和目标。"),
    targets.length ? tradingReportText("- 分批目标：T1 {0}；T2 {1}；触发后按真实成交价重新核对风险收益。", number(targets[0]), number(targets[1])) : tradingReportText("- 方向未确认前不生成虚假止盈价。"),
    tradingReportText("- 确认：{0}", action.confirmation),
    tradingReportText("- 继续观察：{0}", action.observeTrigger),
    tradingReportText("- 仓位：单笔预设最大风险约账户权益 1%；缺少权益、合约乘数和最小数量时不生成仓位数量。"),
    tradingReportText("- 有效期与取消：最多四个当前周期；反向失败摆动、证据摆动失效、价格触及失效位、数据过期或目标/止损到达即取消。"),
    "",
    tradingReportText("### 数据与限制"),
    tradingReportText("本次使用 {0} 根 {1} 已收盘 K 线，排除 {2} 根未收盘 K 线。分析引擎、原生 RSI 副图与预警计算统一使用 Wilder RSI(14)。", result.closedCandleCount, snapshot.interval, result.excludedLiveCandles),
    tradingReportText("RSI 是动量振荡器，不是与基准比较的相对强弱；背离和失败摆动均不构成收益承诺或自动订单。"),
  ].join("\n");
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

const RSI_LABEL_ROWS = Object.freeze([44, 38, 32, 26, 20]);

function rsiLabelAnchor(snapshot, targetIndex, ordinal) {
  const candle = snapshot.candles[targetIndex];
  return {
    time: candle.time,
    value: RSI_LABEL_ROWS[ordinal % RSI_LABEL_ROWS.length],
  };
}

function rsiAnnotationOperations(analysisId, snapshot, result, params) {
  const targetCandle = snapshot.candles[params.targetIndex];
  if (!targetCandle || !Number.isFinite(params.targetValue)) return [];
  const target = { time: targetCandle.time, value: params.targetValue };
  const label = rsiLabelAnchor(snapshot, params.targetIndex, params.ordinal);
  const leaderLabel = { ...label, time: label.time + INDICATOR_LEADER_TIME_EPSILON_SECONDS };
  return [
    operation(analysisId, `${params.id}-leader`, "note", "path", [target, leaderLabel], "", params.evidenceIds, { lineStyle: "dashed", lineWidth: 0.8, status: params.status }),
    operation(analysisId, `${params.id}-dot`, "note", "note", [target], "", params.evidenceIds, { markerSize: 0.35, status: params.status }),
    operation(analysisId, `${params.id}-label`, "note", "text", [label], params.text, params.evidenceIds, { markerSize: 0, fontSize: 11, status: params.status }),
  ];
}

export function buildRsiAnalysisDrawingPatch(snapshot, result) {
  const analysisId = `rsi-analysis-${crypto.createHash("sha1").update(`${snapshot.snapshotId}:${STRATEGY_ID}`).digest("hex").slice(0, 18)}-price`;
  const operations = [];
  const action = result.actionPlan;
  const start = snapshot.candles[Math.max(0, result.closedCandleCount - 36)];
  const end = snapshot.candles[result.closedCandleCount - 1];
  const evidenceIds = result.evidence.slice(0, 12).map((item) => item.id);
  const level = (suffix, role, value, label) => Number.isFinite(value) && value > 0 && operations.push(operation(analysisId, suffix, role, "path", [{ time: start.time, price: value }, { time: end.time, price: value }], `${label} ${number(value)}`, evidenceIds));
  level("long-trigger", "entry", action.longTrigger, tradingReportText("多头收盘触发"));
  level("short-trigger", "entry", action.shortTrigger, tradingReportText("空头收盘触发"));
  level("long-stop", "stop", action.longInvalidation, tradingReportText("多头失效"));
  level("short-stop", "stop", action.shortInvalidation, tradingReportText("空头失效"));
  (action.longTargets || action.shortTargets || []).forEach((value, index) => level(`target-${index}`, "target", value, `T${index + 1}`));
  return operations.length
    ? validateStrategyDrawingPatch({ schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION, analysisId, baseRevision: 0, marketId: snapshot.marketId, interval: snapshot.interval, operations }, snapshot, STRATEGY_ID)
    : null;
}

export function buildRsiIndicatorDrawingPatch(snapshot, result) {
  const analysisId = `rsi-analysis-${crypto.createHash("sha1").update(`${snapshot.snapshotId}:${STRATEGY_ID}`).digest("hex").slice(0, 18)}-indicator`;
  const operations = [];
  let annotationOrdinal = 0;
  for (const item of result.divergences.slice(-3)) {
    const first = snapshot.candles[item.firstIndex];
    const second = snapshot.candles[item.secondIndex];
    const role = item.kind.includes("bullish") ? "support" : "resistance";
    operations.push(operation(analysisId, item.id, role, "path", [{ time: first.time, value: item.rsiFirst }, { time: second.time, value: item.rsiSecond }], "", [item.id], { lineWidth: 1.5 }));
    operations.push(...rsiAnnotationOperations(analysisId, snapshot, result, {
      id: item.id,
      targetIndex: item.secondIndex,
      targetValue: item.rsiSecond,
      ordinal: annotationOrdinal,
      text: tradingReportText("{0} · RSI确认", DIVERGENCE_LABELS[item.kind]),
      evidenceIds: [item.id],
      status: "confirmed",
    }));
    annotationOrdinal += 1;
  }
  for (const item of result.failureSwings.slice(-2)) {
    const indices = [item.firstIndex, item.middleIndex, item.secondIndex, item.confirmationIndex];
    operations.push(operation(analysisId, `${item.id}-path`, item.bias === "bullish" ? "support" : "resistance", "path", indices.map((index) => ({ time: snapshot.candles[index].time, value: result.series[index] })), "", [item.id], { lineStyle: "solid", lineWidth: 1.5 }));
    operations.push(...rsiAnnotationOperations(analysisId, snapshot, result, {
      id: item.id,
      targetIndex: item.confirmationIndex,
      targetValue: result.series[item.confirmationIndex],
      ordinal: annotationOrdinal,
      text: tradingReportText("{0} · 收盘确认", item.name),
      evidenceIds: [item.id],
      status: "confirmed",
    }));
    annotationOrdinal += 1;
  }
  const occupiedTimes = new Set(operations.filter((item) => item.drawing.markerSize === 0.35).map((item) => item.drawing.points[0]?.time));
  for (const item of result.thresholdEvents.slice(-3)) {
    const candle = snapshot.candles[item.index];
    if (!candle || occupiedTimes.has(candle.time)) continue;
    operations.push(...rsiAnnotationOperations(analysisId, snapshot, result, {
      id: item.id,
      targetIndex: item.index,
      targetValue: item.value,
      ordinal: annotationOrdinal,
      text: `${item.name} · ${number(item.value)}`,
      evidenceIds: [item.id],
      status: item.type.endsWith("enter") ? "tentative" : "confirmed",
    }));
    annotationOrdinal += 1;
    occupiedTimes.add(candle.time);
  }
  if (!operations.length) {
    const index = Math.max(0, result.closedCandleCount - 1);
    operations.push(...rsiAnnotationOperations(analysisId, snapshot, result, {
      id: "summary",
      targetIndex: index,
      targetValue: result.series[index],
      ordinal: 0,
      text: tradingReportText("RSI：暂无确认背离/失败摆动，继续等待"),
      evidenceIds: result.evidence.slice(0, 8).map((item) => item.id),
      status: "tentative",
    }));
  }
  return validateStrategyIndicatorDrawingPatch({ schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION, analysisId, baseRevision: 0, marketId: snapshot.marketId, interval: snapshot.interval, indicatorId: "rsi", operations }, snapshot, STRATEGY_ID, "rsi");
}

async function runRsiAnalysisPipelineInternal(params) {
  const snapshot = normalizeTradingMarketSnapshot(params);
  const theoryResult = runRsiAnalysisEngine(snapshot);
  const drawingPatch = buildRsiAnalysisDrawingPatch(snapshot, theoryResult);
  const indicatorDrawingPatch = buildRsiIndicatorDrawingPatch(snapshot, theoryResult);
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
      narrative: `RSI 分析完成：识别 ${theoryResult.failureSwings.length} 个失败摆动、${theoryResult.divergences.length} 个确认背离。`,
      report: buildRsiAnalysisReport(snapshot, theoryResult),
      actionPlan: theoryResult.actionPlan,
      drawingPatch,
      indicatorDrawingPatch,
    },
    model: { providerId: "deterministic", modelId: "rsi-analysis-pattern-divergence-engine-v1", requestId: null, latencyMs: 0, usage: null, finishReason: "deterministic-succeeded" },
  };
}

export async function runRsiAnalysisPipeline(params, options = {}) {
  return withTradingReportLanguage(params?.language, async () => localizeTradingAnalysisResult(await runRsiAnalysisPipelineInternal(params, options), params?.language));
}
