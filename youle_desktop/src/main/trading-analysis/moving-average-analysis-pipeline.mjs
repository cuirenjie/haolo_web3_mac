import { localizeTradingAnalysisResult, tradingReportTime, tradingReportText, withTradingReportLanguage } from "./report-language.mjs";
import crypto from "node:crypto";
import { runMovingAverageAnalysisEngine } from "./moving-average-analysis-engine.mjs";
import { TRADING_ANALYSIS_SCHEMA_VERSION, normalizeTradingMarketSnapshot, validateStrategyDrawingPatch } from "./protocol.mjs";

const STRATEGY_ID = "moving-average-analysis";

function price(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 6 }) : "—";
}

function percent(value, digits = 2) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(digits)}%` : "—";
}

const REGIME_LABELS = Object.freeze({
  "bullish-alignment": "多头排列",
  "bearish-alignment": "空头排列",
  compression: "均线粘合",
  mixed: "交织/震荡",
});

const LOCATION_LABELS = Object.freeze({
  "above-all": "全部均线上方",
  "below-all": "全部均线下方",
  "inside-ribbon": "均线带内部",
});

export function buildMovingAverageAnalysisReport(snapshot, result) {
  const patterns = result.patterns.length
    ? result.patterns.map((item) => tradingReportText("- **{0}**（{3}）：{1}；{2}。", item.name, item.detail, item.eligible ? tradingReportText("与长周期背景一致，可等待价格再确认") : tradingReportText("与长周期背景冲突，仅观察，不执行"), tradingReportTime(snapshot.candles[item.confirmationIndex].time * 1_000))).join("\n")
    : tradingReportText("- 最近窗口没有通过持续性、排列、斜率和收盘确认的均线结构；不强行命名。");
  const action = result.actionPlan;
  const trigger = action.longTrigger || action.shortTrigger;
  const stop = action.longInvalidation || action.shortInvalidation;
  const targets = action.longTargets || action.shortTargets || [];
  const slopes = result.currentState.slopes;
  return [
    tradingReportText("## 均线指标结论"),
    "",
    tradingReportText("MA5/MA20/MA60 当前处于 **{0}**，价格位于 **{1}**。", REGIME_LABELS[result.currentState.trendRegime], LOCATION_LABELS[result.currentState.priceLocation]),
    tradingReportText("MA5 {0}；MA20 {1}；MA60 {2}；均线带宽 {3}；历史百分位 {4}。", price(result.currentState.ma5), price(result.currentState.ma20), price(result.currentState.ma60), percent(result.currentState.ribbonSpread), percent(result.currentState.spreadPercentile)),
    tradingReportText("近 5 根归一化斜率：MA5 {0}；MA20 {1}；MA60 {2}。", percent(slopes.short), percent(slopes.medium), percent(slopes.long)),
    "",
    tradingReportText("### 排列、交叉与回踩"),
    patterns,
    result.recentCompression
      ? tradingReportText("最近一次低带宽粘合位于 {0}，带宽 {1}、百分位 {2}；粘合本身没有方向。", tradingReportTime(result.recentCompression.time * 1_000), percent(result.recentCompression.spread), percent(result.recentCompression.percentile))
      : tradingReportText("最近 14 根已收盘 K 线没有进入均线带宽低 20% 或绝对窄幅阈值。"),
    "",
    tradingReportText("### 当前执行方案"),
    tradingReportText("- 当前动作：**等待条件触发**；方向为{0}。均线是滞后确认工具，单次触线或交叉不能直接下单。", action.primaryBias === "bullish" ? tradingReportText("偏多") : action.primaryBias === "bearish" ? tradingReportText("偏空") : tradingReportText("中性")),
    trigger ? tradingReportText("- 收盘再确认：{0} {1}；结构失效/止损参考 {2}。", action.primaryBias === "bullish" ? tradingReportText("站上") : tradingReportText("跌破"), price(trigger), price(stop)) : tradingReportText("- 尚无完整的顺势事件、触发与失效组合，不生成虚假入场价。"),
    targets.length ? tradingReportText("- 分批目标：T1 {0}；T2 {1}；触发后按真实成交价重新核对风险收益。", price(targets[0]), price(targets[1])) : tradingReportText("- 方向未确认前不生成虚假止盈价。"),
    tradingReportText("- 确认：{0}", action.confirmation),
    tradingReportText("- 继续观察：{0}", action.observeTrigger),
    tradingReportText("- 仓位：单笔预设最大风险约账户权益 1%；缺少授权账户权益、合约乘数和最小数量时不生成具体仓位。"),
    tradingReportText("- 有效期与取消：最多四个当前周期；反向排列、重新粘合、收盘穿过失效位、数据过期或目标/止损到达即取消。"),
    "",
    tradingReportText("### 数据与限制"),
    tradingReportText("本次使用 {0} 根 {1} 已收盘 K 线，排除 {2} 根未收盘 K 线。原生主图 MA 与分析引擎共同使用收盘价 SMA(5/20/60)。", result.closedCandleCount, snapshot.interval, result.excludedLiveCandles),
    tradingReportText("均线只能平滑历史价格并描述趋势，交叉在震荡区容易反复失效；动态支撑阻力是区域而非精确价位。本分析不构成收益承诺或自动订单。"),
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
      ...(lineTool ? { lineStyle: appearance.lineStyle || "dashed", lineWidth: appearance.lineWidth || 1 } : {}),
      ...(textTool ? { fontSize: appearance.fontSize || 12, bold: false } : {}),
      status: appearance.status || "confirmed",
      evidenceIds,
    },
  };
}

export function buildMovingAverageAnalysisDrawingPatch(snapshot, result) {
  const analysisId = `moving-average-analysis-${crypto.createHash("sha1").update(`${snapshot.snapshotId}:${STRATEGY_ID}`).digest("hex").slice(0, 18)}`;
  const operations = [];
  const evidenceIds = result.evidence.slice(0, 16).map((item) => item.id);
  result.patterns.slice(-5).forEach((item, patternIndex) => {
    const marker = snapshot.candles[item.confirmationIndex];
    const anchorValue = (result.series.short[item.confirmationIndex] + result.series.medium[item.confirmationIndex]) / 2;
    const atr = Number.isFinite(result.series.atr[item.confirmationIndex]) ? result.series.atr[item.confirmationIndex] : marker.close * 0.01;
    const labelIndex = Math.max(0, item.confirmationIndex - (patternIndex % 3) * 2);
    const labelPrice = item.bias === "bullish"
      ? Math.max(marker.low - atr * (0.8 + patternIndex * 0.35), Number.EPSILON)
      : marker.high + atr * (0.8 + patternIndex * 0.35);
    const crossoverAnchor = item.kind === "golden-cross" || item.kind === "death-cross"
      ? item.crossPoint
      : null;
    const anchor = crossoverAnchor && Number.isFinite(crossoverAnchor.time) && Number.isFinite(crossoverAnchor.price)
      ? { time: crossoverAnchor.time, price: Math.max(crossoverAnchor.price, Number.EPSILON) }
      : { time: marker.time, price: Math.max(anchorValue, Number.EPSILON) };
    const label = { time: snapshot.candles[labelIndex].time, price: labelPrice };
    if (crossoverAnchor) {
      operations.push(operation(analysisId, `${item.id}-label`, "note", "note", [anchor], `${item.name}${item.eligible ? "" : tradingReportText(" · 仅观察")}`, [item.id]));
    } else {
      operations.push(operation(analysisId, `${item.id}-leader`, "note", "path", [anchor, label], "", [item.id], { lineStyle: "dashed", lineWidth: 0.8 }));
      operations.push(operation(analysisId, `${item.id}-label`, "note", "note", [label], `${item.name}${item.eligible ? "" : tradingReportText(" · 仅观察")}`, [item.id]));
    }
    if (item.zone) {
      operations.push(operation(analysisId, `${item.id}-zone`, item.bias === "bullish" ? "support" : "resistance", "rectangle", [
        { time: snapshot.candles[item.startIndex].time, price: item.zone.upper },
        { time: marker.time, price: item.zone.lower },
      ], tradingReportText("MA20 动态区域"), [item.id], { lineWidth: 0.8 }));
    }
  });
  if (result.recentCompression && !result.patterns.some((item) => item.startIndex === result.recentCompression.index)) {
    const startIndex = result.recentCompression.index;
    const endIndex = Math.min(result.closedCandleCount - 1, startIndex + 6);
    const values = [];
    for (let index = startIndex; index <= endIndex; index += 1) {
      values.push(result.series.short[index], result.series.medium[index], result.series.long[index]);
    }
    const finiteValues = values.filter(Number.isFinite);
    if (finiteValues.length) operations.push(operation(analysisId, "recent-compression", "primary", "rectangle", [
      { time: snapshot.candles[startIndex].time, price: Math.max(...finiteValues) },
      { time: snapshot.candles[endIndex].time, price: Math.min(...finiteValues) },
    ], tradingReportText("均线粘合 · 等待有序发散"), [result.recentCompression.id], { lineWidth: 0.8, status: "tentative" }));
  }
  const action = result.actionPlan;
  const start = snapshot.candles[Math.max(0, result.closedCandleCount - 36)];
  const end = snapshot.candles[result.closedCandleCount - 1];
  const level = (suffix, role, value, label) => Number.isFinite(value) && value > 0 && operations.push(operation(analysisId, suffix, role, "path", [{ time: start.time, price: value }, { time: end.time, price: value }], `${label} ${price(value)}`, evidenceIds, { lineWidth: 1 }));
  level("long-trigger", "entry", action.longTrigger, tradingReportText("多头收盘触发"));
  level("short-trigger", "entry", action.shortTrigger, tradingReportText("空头收盘触发"));
  level("long-stop", "stop", action.longInvalidation, tradingReportText("多头失效"));
  level("short-stop", "stop", action.shortInvalidation, tradingReportText("空头失效"));
  (action.longTargets || action.shortTargets || []).forEach((value, index) => level(`target-${index}`, "target", value, `T${index + 1}`));
  if (!operations.length) {
    const latest = snapshot.candles[result.closedCandleCount - 1];
    const atr = Number.isFinite(result.series.atr.at(-1)) ? result.series.atr.at(-1) : latest.close * 0.01;
    operations.push(operation(analysisId, "summary", "note", "note", [{ time: latest.time, price: latest.high + atr }], tradingReportText("均线：暂无可执行结构，继续等待"), evidenceIds, { status: "tentative" }));
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

async function runMovingAverageAnalysisPipelineInternal(params) {
  const snapshot = normalizeTradingMarketSnapshot(params);
  const theoryResult = runMovingAverageAnalysisEngine(snapshot);
  const drawingPatch = buildMovingAverageAnalysisDrawingPatch(snapshot, theoryResult);
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
      narrative: `均线分析完成：当前为${REGIME_LABELS[theoryResult.currentState.trendRegime]}，识别 ${theoryResult.patterns.length} 个确认结构。`,
      report: buildMovingAverageAnalysisReport(snapshot, theoryResult),
      actionPlan: theoryResult.actionPlan,
      drawingPatch,
    },
    model: {
      providerId: "deterministic",
      modelId: "moving-average-structure-engine-v1",
      requestId: null,
      latencyMs: 0,
      usage: null,
      finishReason: "deterministic-succeeded",
    },
  };
}

export async function runMovingAverageAnalysisPipeline(params, options = {}) {
  return withTradingReportLanguage(params?.language, async () => localizeTradingAnalysisResult(await runMovingAverageAnalysisPipelineInternal(params, options), params?.language));
}
