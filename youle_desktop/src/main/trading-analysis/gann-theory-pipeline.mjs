import { localizeTradingAnalysisResult, tradingReportText, withTradingReportLanguage } from "./report-language.mjs";
import crypto from "node:crypto";
import { runGannTheoryEngine } from "./gann-theory-engine.mjs";
import {
  TRADING_ANALYSIS_SCHEMA_VERSION,
  normalizeTradingMarketSnapshot,
  validateStrategyDrawingPatch,
} from "./protocol.mjs";

const STRATEGY_ID = "gann-theory";
const LABELED_FAN_RATIOS = new Set(["1x4", "1x2", "1x1", "2x1", "4x1"]);

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const digits = Math.abs(number) >= 1_000 ? 2 : Math.abs(number) >= 1 ? 4 : 8;
  return number.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function directionLabel(direction) {
  return direction === "bullish" ? tradingReportText("低点锚定的上升投影") : tradingReportText("高点锚定的下降投影");
}

function calibrationLabel(result) {
  const method = result.calibration.method === "same-type-pivot"
    ? tradingReportText("同类确认转折点")
    : result.calibration.method === "opposite-pivot-fallback"
      ? tradingReportText("相邻反向摆动（降级校准）")
      : tradingReportText("近期中位波幅（保底校准）");
  return tradingReportText("{0}：1x1={1} 价格单位/Bar，基础周期 {2} Bar", method, formatPrice(result.calibration.pricePerBar), result.calibration.cycleBars);
}

export function buildGannTheoryReport(snapshot, result) {
  const action = result.actionPlan;
  const bullish = result.direction === "bullish";
  const trigger = bullish ? action.longTrigger : action.shortTrigger;
  const invalidation = bullish ? action.longInvalidation : action.shortInvalidation;
  const targets = bullish ? action.longTargets : action.shortTargets;
  const visibleSpiral = result.spiral.visibleLevels
    .map((level) => `${level.side === "up" ? "+" : "-"}${level.angle}° ${formatPrice(level.price)}`)
    .join("；");
  return [
    tradingReportText("## 江恩理论结论"),
    "",
    tradingReportText("当前使用 **{0}**。锚点为 {1} {2}；当前价相对 1x1 为 **{3}**。", directionLabel(result.direction), result.anchor.type === "low" ? tradingReportText("确认低点") : tradingReportText("确认高点"), formatPrice(result.anchor.price), result.fan.relativeToOneByOne === "above" ? tradingReportText("上方") : tradingReportText("下方")),
    "",
    tradingReportText("### 标尺与锚点"),
    tradingReportText("- 校准：{0}。1x1 是数学上的价格/Bar 斜率，不以屏幕是否呈 45° 判断。", calibrationLabel(result)),
    tradingReportText("- 锚点质量：{0}；本轮投影 {1} 个基础周期。", result.anchorQuality === "confirmed-local-extreme" ? tradingReportText("局部确认转折点") : tradingReportText("分段确认极值（降级）"), result.projection.turns),
    tradingReportText("- 最后已收盘价：{0}；排除 {1} 根未收盘 K 线。", formatPrice(result.lastClosedCandle.close), result.excludedLiveCandles),
    "",
    tradingReportText("### 江恩角度线"),
    tradingReportText("- 已绘制九条角度线：{0}；1x1 当前投影价 {1}。", result.fan.lines.map((line) => line.ratio).join("、"), formatPrice(result.fan.oneByOneAtLatest)),
    tradingReportText("- 角度线只提供动态支撑/阻力候选。单独触线、盘中穿越或视觉上的 45° 均不是交易信号。"),
    "",
    tradingReportText("### 江恩方格与轮中轮"),
    tradingReportText("- 外层方格覆盖 {0} Bar 与 {1} 价格范围，并按 1/4、1/2、3/4 同时分割价格和时间。", result.projection.spanBars, formatPrice(result.projection.priceRange)),
    tradingReportText("- 轮中轮以同一锚点的 1/2 与 1/4 嵌套方格表达，共享同一标尺；不把普通缩放矩形冒充另一套周期。"),
    "",
    tradingReportText("### Square of Nine / 数字螺旋"),
    tradingReportText("- 锚点 {0} 先按 priceUnit={1} 移动小数尺度，再按 ((√标准化锚点 ± 因子)² × priceUnit) 计算。", formatPrice(result.spiral.anchorPrice), formatPrice(result.spiral.priceUnit)),
    tradingReportText("- 图上最近层级：{0}。完整角度表为 45° 至 360°；这些是候选价位，不是保证反转的预测。", visibleSpiral || tradingReportText("无可用层级")),
    "",
    tradingReportText("### 标准执行方案"),
    tradingReportText("- 当前动作：等待条件触发；方向为{0}。", bullish ? tradingReportText("偏多") : tradingReportText("偏空")),
    tradingReportText("- 条件触发：已收盘 K 线{0} {1}，随后回踩/反抽不重新收回。", bullish ? tradingReportText("站上") : tradingReportText("跌破"), formatPrice(trigger)),
    tradingReportText("- 结构失效/止损参考：{0}；分批目标：T1 {1}，T2 {2}。", formatPrice(invalidation), formatPrice(targets[0]), formatPrice(targets[1])),
    tradingReportText("- 共振检查：当前{0} 1x1，{1}数字螺旋层级；共振也必须由已收盘价格行为确认。", action.confluence.nearOneByOne ? tradingReportText("接近") : tradingReportText("未接近"), action.confluence.nearSquareOfNine ? tradingReportText("接近") : tradingReportText("未接近")),
    tradingReportText("- 确认要求：{0}", action.confirmation),
    tradingReportText("- 取消条件：{0}。方案最多有效 {1} 个当前周期。", action.cancellation, action.validityBars),
    tradingReportText("- 仓位与风险：由统一执行计划把单笔预设亏损限制在账户权益约 1%；缺少账户权益、合约乘数和最小下单单位时不生成数量。"),
    "",
    tradingReportText("### 数据与限制"),
    tradingReportText("本次使用 {0} 根 {1} 已收盘 K 线。所有锚点、标尺、方格与价位均可由相同输入复算。", result.closedCandleCount, snapshot.interval),
    tradingReportText("未使用占星、行星日期或不可复算的神秘数规则；江恩工具属于条件框架，不承诺转折、目标到达或收益，也不会自动创建订单。"),
  ].join("\n");
}

function analysisId(snapshot) {
  return `gann-analysis-${crypto.createHash("sha1")
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
      status: appearance.status || "tentative",
      evidenceIds,
    },
  };
}

function appendHorizontalLevel(operations, analysis, result, suffix, role, price, text, evidenceIds) {
  if (!Number.isFinite(price) || price <= 0) return;
  operations.push(operation(
    analysis,
    suffix,
    role,
    "path",
    [{ time: result.anchor.time, price }, { time: result.projection.endTime, price }],
    text,
    { lineStyle: "dashed", lineWidth: 0.8 },
    evidenceIds,
  ));
}

export function buildGannTheoryDrawingPatch(snapshot, result) {
  const analysis = analysisId(snapshot);
  const evidenceIds = result.evidence.slice(0, 12).map((item) => item.id);
  const operations = [];
  for (const line of result.fan.lines) {
    operations.push(operation(
      analysis,
      `fan-${line.ratio.replace("x", "-")}`,
      line.ratio === "1x1" ? "primary" : "note",
      "path",
      [line.start, line.end],
      LABELED_FAN_RATIOS.has(line.ratio) ? tradingReportText("江恩 {0}", line.ratio) : undefined,
      { lineStyle: line.ratio === "1x1" ? "solid" : "dotted", lineWidth: line.ratio === "1x1" ? 2 : 0.8 },
      [result.anchor.id, "gann-scale-calibration"],
    ));
  }
  operations.push(operation(
    analysis,
    "square-outer",
    "primary",
    "rectangle",
    [result.square.outer.start, result.square.outer.end],
    tradingReportText("江恩方格 · {0} Bar", result.projection.spanBars),
    { lineStyle: "dashed", lineWidth: 1.2 },
    [result.anchor.id, "gann-scale-calibration"],
  ));
  for (const nested of result.square.nestedSquares) {
    operations.push(operation(
      analysis,
      nested.id,
      "note",
      "rectangle",
      [nested.start, nested.end],
      nested.fraction === 0.5 ? tradingReportText("轮中轮 1/2") : undefined,
      { lineStyle: "dotted", lineWidth: 0.8 },
      [result.anchor.id, "gann-scale-calibration"],
    ));
  }
  for (const level of result.square.priceLevels) {
    operations.push(operation(
      analysis,
      `square-price-${String(level.fraction).replace(".", "-")}`,
      "note",
      "path",
      [{ time: result.square.outer.start.time, price: level.price }, { time: result.square.outer.end.time, price: level.price }],
      level.fraction === 0.5 ? tradingReportText("价格 1/2") : undefined,
      { lineStyle: "dotted", lineWidth: 0.8 },
      ["gann-scale-calibration"],
    ));
  }
  const lowerPrice = Math.min(result.square.outer.start.price, result.square.outer.end.price);
  const upperPrice = Math.max(result.square.outer.start.price, result.square.outer.end.price);
  for (const level of result.square.timeLevels) {
    operations.push(operation(
      analysis,
      `square-time-${String(level.fraction).replace(".", "-")}`,
      "note",
      "path",
      [{ time: level.time, price: lowerPrice }, { time: level.time, price: upperPrice }],
      level.fraction === 0.5 ? tradingReportText("时间 1/2") : undefined,
      { lineStyle: "dotted", lineWidth: 0.8 },
      ["gann-scale-calibration"],
    ));
  }
  result.square.diagonals.forEach((diagonal, index) => operations.push(operation(
    analysis,
    `square-diagonal-${index}`,
    "note",
    "path",
    [diagonal.start, diagonal.end],
    undefined,
    { lineStyle: "dotted", lineWidth: 0.8 },
    ["gann-scale-calibration"],
  )));
  for (const level of result.spiral.visibleLevels) {
    const role = level.price >= result.lastClosedCandle.close ? "resistance" : "support";
    appendHorizontalLevel(
      operations,
      analysis,
      result,
      `spiral-${level.side}-${level.angle}`,
      role,
      level.price,
      tradingReportText("数字螺旋 {0}{1}° {2}", level.side === "up" ? "+" : "-", level.angle, formatPrice(level.price)),
      [result.anchor.id, "gann-square-of-nine-scale"],
    );
  }
  const action = result.actionPlan;
  appendHorizontalLevel(operations, analysis, result, "long-trigger", "entry", action.longTrigger, tradingReportText("多头收盘触发 {0}", formatPrice(action.longTrigger)), evidenceIds);
  appendHorizontalLevel(operations, analysis, result, "short-trigger", "entry", action.shortTrigger, tradingReportText("空头收盘触发 {0}", formatPrice(action.shortTrigger)), evidenceIds);
  appendHorizontalLevel(operations, analysis, result, "long-stop", "stop", action.longInvalidation, tradingReportText("多头结构失效 {0}", formatPrice(action.longInvalidation)), evidenceIds);
  appendHorizontalLevel(operations, analysis, result, "short-stop", "stop", action.shortInvalidation, tradingReportText("空头结构失效 {0}", formatPrice(action.shortInvalidation)), evidenceIds);
  (action.longTargets || action.shortTargets || []).forEach((price, index) => appendHorizontalLevel(
    operations,
    analysis,
    result,
    `target-${index}`,
    "target",
    price,
    `T${index + 1} ${formatPrice(price)}`,
    evidenceIds,
  ));
  operations.push(operation(
    analysis,
    "summary",
    "note",
    "note",
    [{ time: result.lastClosedCandle.time, price: result.lastClosedCandle.close }],
    tradingReportText("江恩：{0} · 1x1 {1} · 等待收盘确认", directionLabel(result.direction), formatPrice(result.fan.oneByOneAtLatest)),
    { fontSize: 11, bold: false },
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

async function runTradingGannTheoryPipelineInternal(params) {
  const snapshot = normalizeTradingMarketSnapshot(params);
  const theoryResult = runGannTheoryEngine(snapshot);
  const drawingPatch = buildGannTheoryDrawingPatch(snapshot, theoryResult);
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
      narrative: `江恩理论分析完成：已用 ${calibrationLabel(theoryResult)} 绘制九条角度线、方格/轮中轮和 Square of Nine 数字螺旋价位。`,
      report: buildGannTheoryReport(snapshot, theoryResult),
      actionPlan: theoryResult.actionPlan,
      drawingPatch,
    },
    model: {
      providerId: "deterministic",
      modelId: GANN_THEORY_MODEL_ID,
      requestId: null,
      latencyMs: 0,
      usage: null,
      finishReason: "deterministic-succeeded",
    },
  };
}

export const GANN_THEORY_MODEL_ID = "gann-time-price-geometry-engine-v1";

export async function runTradingGannTheoryPipeline(params, options = {}) {
  return withTradingReportLanguage(params?.language, async () => localizeTradingAnalysisResult(await runTradingGannTheoryPipelineInternal(params, options), params?.language));
}
