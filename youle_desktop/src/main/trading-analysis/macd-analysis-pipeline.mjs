import { localizeTradingAnalysisResult, tradingReportTime, tradingReportText, withTradingReportLanguage } from "./report-language.mjs";
import crypto from "node:crypto";
import { runMacdAnalysisEngine } from "./macd-analysis-engine.mjs";
import { TRADING_ANALYSIS_SCHEMA_VERSION, normalizeTradingMarketSnapshot, validateStrategyDrawingPatch, validateStrategyIndicatorDrawingPatch } from "./protocol.mjs";

const STRATEGY_ID = "macd-analysis";

function price(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 6 }) : "—";
}

const DIVERGENCE_LABELS = Object.freeze({
  "regular-bearish": "顶背离", "regular-bullish": "底背离", "hidden-bullish": "隐藏看涨背离", "hidden-bearish": "隐藏看跌背离",
});

export function buildMacdAnalysisReport(snapshot, result) {
  const patterns = result.patterns.length ? result.patterns.map((item) => tradingReportText("- **{0}**：{1}；完成于 {2}。", item.name, item.detail, tradingReportTime(snapshot.candles[item.endIndex].time * 1_000))).join("\n") : tradingReportText("- 最近窗口没有同时满足顺序、零轴位置和收盘条件的八大经典形态；不强行命名。");
  const divergences = result.divergences.length ? result.divergences.map((item) => tradingReportText("- **{0}**：价格 {1} → {2}；DIF {3} → {4}；柱体{5}。", DIVERGENCE_LABELS[item.kind], price(item.priceFirst), price(item.priceSecond), price(item.difFirst), price(item.difSecond), item.histogramAgrees ? tradingReportText("同向确认") : tradingReportText("未同步确认"))).join("\n") : tradingReportText("- 最近确认摆动中没有通过幅度、间隔和右侧 K 线确认的顶/底或隐藏背离。");
  const action = result.actionPlan;
  const trigger = action.longTrigger || action.shortTrigger;
  const stop = action.longInvalidation || action.shortInvalidation;
  const targets = action.longTargets || action.shortTargets || [];
  return [
    tradingReportText("## MACD 指标结论"), "",
    tradingReportText("MACD(12,26,9) 当前位于 **{0}**，DIF/DEA 为 **{1}**，柱体动能正在 **{2}**。", result.currentState.zone === "above-zero" ? tradingReportText("零轴上") : result.currentState.zone === "below-zero" ? tradingReportText("零轴下") : tradingReportText("零轴附近"), result.currentState.relation === "bullish" ? tradingReportText("多头关系") : tradingReportText("空头关系"), result.currentState.momentum === "expanding" ? tradingReportText("扩张") : tradingReportText("收缩")),
    tradingReportText("DIF {0}；DEA {1}；MACD 柱 {2}；最近 20 根交叉 {3} 次，震荡噪声风险{4}。", price(result.currentState.dif), price(result.currentState.dea), price(result.currentState.histogram), result.currentState.whipsawCount, result.currentState.whipsawRisk === "high" ? tradingReportText("高") : result.currentState.whipsawRisk === "medium" ? tradingReportText("中") : tradingReportText("低")),
    "", tradingReportText("### 八大经典组合形态"), patterns,
    "", tradingReportText("### 背离"), divergences,
    "", tradingReportText("### 标准执行方案"),
    tradingReportText("- 当前动作：**等待条件触发**；方向为{0}。MACD 不能单独触发下单。", action.primaryBias === "bullish" ? tradingReportText("偏多") : action.primaryBias === "bearish" ? tradingReportText("偏空") : tradingReportText("中性")),
    trigger ? tradingReportText("- 收盘触发：{0} {1}；结构失效/止损参考 {2}。", action.primaryBias === "bullish" ? tradingReportText("站上") : tradingReportText("跌破"), price(trigger), price(stop)) : tradingReportText("- 尚无合格价格触发、止损或目标，继续观察。"),
    targets.length ? tradingReportText("- 分批目标：T1 {0}；T2 {1}；只在触发后计算执行。", price(targets[0]), price(targets[1])) : tradingReportText("- 未触发前不生成虚假止盈价。"),
    tradingReportText("- 确认：{0}", action.confirmation), tradingReportText("- 继续观察：{0}", action.observeTrigger),
    tradingReportText("- 仓位：单笔预设最大风险约账户权益 1%；缺少权益、合约乘数和最小数量时不生成仓位数量。"),
    tradingReportText("- 有效期与取消：最多四个当前周期；DIF/DEA 反向交叉、结构失效、频繁震荡交叉、数据过期或目标/止损到达即取消。"),
    "", tradingReportText("### 数据与限制"),
    tradingReportText("本次使用 {0} 根 {1} 已收盘 K 线，排除 {2} 根未收盘 K 线。Haolo 柱体采用 DIF−DEA；部分中文平台显示 2×(DIF−DEA)，符号和交叉时点相同但数值不同。", result.closedCandleCount, snapshot.interval, result.excludedLiveCandles),
    tradingReportText("经典中文名称是 DIF/DEA 几何序列的教育性别名，不证明所谓主力行为，也不构成收益承诺或自动订单。"),
  ].join("\n");
}

function operation(analysisId, suffix, role, tool, points, text, evidenceIds = [], appearance = {}) {
  const lineTool = ["path", "rectangle", "circle", "ellipse"].includes(tool);
  const textTool = ["note", "text"].includes(tool);
  return { op: "upsert", drawing: { id: `${analysisId}-${suffix}`, strategyId: STRATEGY_ID, theory: "strategy", layer: `ai/strategy/${STRATEGY_ID}`, tool, points, ...(text ? { text } : {}), colorToken: `strategy-${role}`, ...(lineTool ? { lineStyle: appearance.lineStyle || "dashed", lineWidth: appearance.lineWidth || 1.2 } : {}), ...(textTool ? { fontSize: appearance.fontSize || 12, bold: false } : {}), status: appearance.status || "confirmed", evidenceIds } };
}

export function buildMacdAnalysisDrawingPatch(snapshot, result) {
  const analysisId = `macd-analysis-${crypto.createHash("sha1").update(`${snapshot.snapshotId}:${STRATEGY_ID}`).digest("hex").slice(0, 18)}-price`;
  const operations = [];
  const action = result.actionPlan;
  const start = snapshot.candles[Math.max(0, snapshot.candles.length - 36)], end = snapshot.candles.at(-1);
  const level = (suffix, role, value, label) => Number.isFinite(value) && operations.push(operation(analysisId, suffix, role, "path", [{ time: start.time, price: value }, { time: end.time, price: value }], `${label} ${price(value)}`, result.evidence.slice(0, 8).map((item) => item.id)));
  level("long-trigger", "entry", action.longTrigger, tradingReportText("多头收盘触发")); level("short-trigger", "entry", action.shortTrigger, tradingReportText("空头收盘触发"));
  level("long-stop", "stop", action.longInvalidation, tradingReportText("多头失效")); level("short-stop", "stop", action.shortInvalidation, tradingReportText("空头失效"));
  (action.longTargets || action.shortTargets || []).forEach((value, index) => level(`target-${index}`, "target", value, `T${index + 1}`));
  return operations.length
    ? validateStrategyDrawingPatch({ schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION, analysisId, baseRevision: 0, marketId: snapshot.marketId, interval: snapshot.interval, operations }, snapshot, STRATEGY_ID)
    : null;
}

function indicatorOperation(analysisId, suffix, role, tool, points, text, evidenceIds = [], appearance = {}) {
  const lineTool = tool === "path";
  const textTool = tool === "note" || tool === "text";
  return { op: "upsert", drawing: { id: `${analysisId}-${suffix}`, strategyId: STRATEGY_ID, theory: "strategy", layer: `ai/strategy/${STRATEGY_ID}`, tool, points, ...(text ? { text } : {}), colorToken: `strategy-${role}`, ...(lineTool ? { lineStyle: appearance.lineStyle || "dashed", lineWidth: appearance.lineWidth || 1.2 } : {}), ...(textTool ? { fontSize: appearance.fontSize || 12, bold: false } : {}), status: appearance.status || "confirmed", evidenceIds } };
}

export function buildMacdIndicatorDrawingPatch(snapshot, result) {
  const analysisId = `macd-analysis-${crypto.createHash("sha1").update(`${snapshot.snapshotId}:${STRATEGY_ID}`).digest("hex").slice(0, 18)}-indicator`;
  const operations = [];
  for (const item of result.divergences.slice(-3)) {
    const first = snapshot.candles[item.firstIndex], second = snapshot.candles[item.secondIndex];
    const role = item.kind.includes("bullish") ? "support" : "resistance";
    operations.push(indicatorOperation(analysisId, item.id, role, "path", [{ time: first.time, value: item.difFirst }, { time: second.time, value: item.difSecond }], "", [item.id], { lineWidth: 1.5 }));
    operations.push(indicatorOperation(analysisId, `${item.id}-label`, "note", "note", [{ time: second.time, value: item.difSecond }], tradingReportText("{0} · DIF确认{1}", DIVERGENCE_LABELS[item.kind], item.histogramAgrees ? tradingReportText(" · 柱体确认") : ""), [item.id]));
  }
  for (const item of result.patterns.slice(-3)) {
    const candle = snapshot.candles[item.endIndex];
    const value = [result.series.dif[item.endIndex], result.series.dea[item.endIndex], result.series.histogram[item.endIndex]].find(Number.isFinite) ?? 0;
    operations.push(indicatorOperation(analysisId, item.id, "note", "note", [{ time: candle.time, value }], `${item.name} · ${item.detail}`, [item.id]));
  }
  if (!operations.length) {
    const endIndex = Math.max(0, result.closedCandleCount - 1);
    const end = snapshot.candles[endIndex] || snapshot.candles.at(-1);
    const value = [result.series.dif[endIndex], result.series.dea[endIndex], result.series.histogram[endIndex]].find(Number.isFinite) ?? 0;
    operations.push(indicatorOperation(analysisId, "summary", "note", "note", [{ time: end.time, value }], tradingReportText("MACD：暂无合格形态/背离，继续等待"), result.evidence.slice(0, 8).map((item) => item.id), { status: "tentative" }));
  }
  return validateStrategyIndicatorDrawingPatch({ schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION, analysisId, baseRevision: 0, marketId: snapshot.marketId, interval: snapshot.interval, indicatorId: "macd", operations }, snapshot, STRATEGY_ID, "macd");
}

async function runMacdAnalysisPipelineInternal(params) {
  const snapshot = normalizeTradingMarketSnapshot(params);
  const theoryResult = runMacdAnalysisEngine(snapshot);
  const drawingPatch = buildMacdAnalysisDrawingPatch(snapshot, theoryResult);
  const indicatorDrawingPatch = buildMacdIndicatorDrawingPatch(snapshot, theoryResult);
  return { ok: true, schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION, snapshot: { snapshotId: snapshot.snapshotId, marketId: snapshot.marketId, interval: snapshot.interval, snapshotTime: snapshot.snapshotTime, lastClosedBarTime: theoryResult.lastClosedCandle.time, inputHash: snapshot.inputHash }, theoryResult, analysisPlan: { schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION, analysisId: indicatorDrawingPatch.analysisId, revision: 0, snapshotId: snapshot.snapshotId, marketId: snapshot.marketId, interval: snapshot.interval, narrative: `MACD 分析完成：识别 ${theoryResult.patterns.length} 个经典形态、${theoryResult.divergences.length} 个确认背离。`, report: buildMacdAnalysisReport(snapshot, theoryResult), actionPlan: theoryResult.actionPlan, drawingPatch, indicatorDrawingPatch }, model: { providerId: "deterministic", modelId: "macd-analysis-pattern-divergence-engine-v1", requestId: null, latencyMs: 0, usage: null, finishReason: "deterministic-succeeded" } };
}

export async function runMacdAnalysisPipeline(params, options = {}) {
  return withTradingReportLanguage(params?.language, async () => localizeTradingAnalysisResult(await runMacdAnalysisPipelineInternal(params, options), params?.language));
}
