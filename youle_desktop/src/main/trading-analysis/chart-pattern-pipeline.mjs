import crypto from "node:crypto";
import { runChartPatternEngine } from "./chart-pattern-engine.mjs";
import {
  TRADING_ANALYSIS_SCHEMA_VERSION,
  normalizeTradingMarketSnapshot,
  validateStrategyDrawingPatch,
} from "./protocol.mjs";

const STRATEGY_ID = "chart-patterns";

function analysisId(snapshot, ...parts) {
  return `chart-pattern-analysis-${crypto.createHash("sha1")
    .update(JSON.stringify([snapshot.snapshotId, ...parts]))
    .digest("hex")
    .slice(0, 18)}`;
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const digits = Math.abs(number) >= 1_000 ? 2 : Math.abs(number) >= 1 ? 4 : 6;
  return number.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function formatTime(seconds) {
  return new Date(Number(seconds) * 1_000).toLocaleString("zh-CN", { hour12: false });
}

function categoryLabel(category) {
  if (category === "reversal") return "反转形态";
  if (category === "continuation") return "延续形态";
  return "双向形态";
}

function directionLabel(direction) {
  if (direction === "bullish") return "看涨";
  if (direction === "bearish") return "看跌";
  return "中性待突破";
}

function lifecycleLabel(lifecycle) {
  if (lifecycle === "confirmed") return "已由收盘突破确认";
  if (lifecycle === "failed") return "已判定为假突破/失效";
  if (lifecycle === "invalidated") return "已失效";
  if (lifecycle === "completed") return "目标已完成，原方案结束";
  if (lifecycle === "partial-target-reached") return "第一目标已到达，不再追价";
  if (lifecycle === "expired") return "已过期";
  return "结构成立，等待收盘突破";
}

function isCurrentCandidate(candidate) {
  return candidate?.tradeState === "active"
    || candidate?.tradeState === "awaiting-breakout"
    || candidate?.tradeState === "awaiting-confirmation";
}

function snapshotSummary(snapshot) {
  return {
    snapshotId: snapshot.snapshotId,
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    snapshotTime: snapshot.snapshotTime,
    inputHash: snapshot.inputHash,
  };
}

function candidateActionPlan(snapshot, candidate) {
  if (!candidate || !isCurrentCandidate(candidate)) {
    return Object.freeze({
      primaryBias: "neutral",
      disposition: "wait",
      confirmation: candidate
        ? "该结构发生假突破或重新收回边界，取消原触发并等待新结构"
        : "当前没有仍处于有效期、且同时通过几何、趋势和触点规则的传统图表形态",
    });
  }
  const currentPrice = snapshot.candles.at(-1).close;
  if (candidate.category === "bilateral" && candidate.direction === "neutral") {
    return Object.freeze({
      primaryBias: "neutral",
      currentPrice,
      longTrigger: candidate.longLevels.trigger,
      longInvalidation: candidate.longLevels.stop,
      longTarget: candidate.longLevels.targets[0],
      longTargets: candidate.longLevels.targets,
      shortTrigger: candidate.shortLevels.trigger,
      shortInvalidation: candidate.shortLevels.stop,
      shortTarget: candidate.shortLevels.targets[0],
      shortTargets: candidate.shortLevels.targets,
      confirmation: "保持双向中性；只接受已收盘 K 线有效突破对应边界，区间内不执行",
      disposition: "wait",
    });
  }
  const levels = candidate.actionLevels;
  const bullish = candidate.direction === "bullish";
  return Object.freeze({
    primaryBias: candidate.direction,
    currentPrice,
    ...(bullish ? {
      longTrigger: levels.trigger,
      longInvalidation: levels.stop,
      longTarget: levels.targets[0],
      longTargets: levels.targets,
    } : {
      shortTrigger: levels.trigger,
      shortInvalidation: levels.stop,
      shortTarget: levels.targets[0],
      shortTargets: levels.targets,
    }),
    confirmation: candidate.lifecycle === "confirmed"
      ? `已有当前周期已收盘 K 线${bullish ? "站上" : "跌破"}结构边界；只在回踩/反抽不重新收回边界时执行`
      : `形态尚未确认；必须等待当前周期已收盘 K 线${bullish ? "站上" : "跌破"} ${formatPrice(levels.trigger)}`,
    disposition: "wait",
  });
}

function pointSummary(candidate) {
  return candidate.points
    .map((point) => `${point.label}=${formatPrice(point.price)}（${formatTime(point.time)}）`)
    .join("，");
}

export function buildChartPatternReport(snapshot, theoryResult) {
  const candidate = theoryResult.structures.primaryActiveCandidate;
  if (!candidate) return buildChartPatternNoCandidateReport(snapshot, theoryResult);
  if (candidate.lifecycle === "failed") {
    return [
      "## 图表形态扫描结论",
      "",
      `识别到 **${candidate.patternName}** 的历史结构，但突破后重新收回边界，当前按**假突破/失效**处理。分析已完成，不生成追单方案。`,
      "",
      "### 失效证据",
      `- 结构点：${pointSummary(candidate)}。`,
      `- 首次突破：${formatTime(candidate.breakout.time)} 收于 ${formatPrice(candidate.breakout.close)}。`,
      `- 重新收回：第 ${candidate.breakout.failedAtIndex + 1} 根输入 K 线重新进入结构边界。`,
      "",
      "### 当前执行方案",
      "- 当前动作：取消原触发，不交易。",
      "- 重新分析：等待新的边界、触点和已收盘突破形成后再计算止损与目标。",
    ].join("\n");
  }
  const bilateralDeveloping = candidate.category === "bilateral" && candidate.direction === "neutral";
  const levels = candidate.actionLevels;
  return [
    "## 图表形态结论",
    "",
    `识别到 **${candidate.patternName}**（${categoryLabel(candidate.category)}，${directionLabel(candidate.direction)}）；${lifecycleLabel(candidate.lifecycle)}。`,
    "",
    "### 结构与确认",
    `- 结构点：${pointSummary(candidate)}。`,
    `- 几何状态：${candidate.points.length} 个已确认触点，形态高度 ${formatPrice(candidate.height)}，规则得分 ${(candidate.score * 100).toFixed(1)}%。`,
    `- 突破状态：${candidate.lifecycle === "confirmed" ? `${formatTime(candidate.breakout.time)} 的已收盘 K 线向${candidate.breakout.direction === "up" ? "上" : "下"}突破 ${formatPrice(candidate.breakout.boundary)}` : "尚未出现越过波动缓冲的有效收盘突破，盘中影线不计确认"}。`,
    "",
    "### 条件式执行",
    ...(bilateralDeveloping ? [
      `- 当前方向：中性；向上收盘突破 ${formatPrice(candidate.longLevels.trigger)} 才启用多头场景，向下收盘突破 ${formatPrice(candidate.shortLevels.trigger)} 才启用空头场景。`,
      `- 多头失效/目标：止损参考 ${formatPrice(candidate.longLevels.stop)}；T1 ${formatPrice(candidate.longLevels.targets[0])}；T2 ${formatPrice(candidate.longLevels.targets[1])}。`,
      `- 空头失效/目标：止损参考 ${formatPrice(candidate.shortLevels.stop)}；T1 ${formatPrice(candidate.shortLevels.targets[0])}；T2 ${formatPrice(candidate.shortLevels.targets[1])}。`,
    ] : [
      `- 方向与触发：${directionLabel(candidate.direction)}；${candidate.lifecycle === "confirmed" ? "突破已出现，仍需观察回踩/反抽是否守住" : "等待收盘确认"} ${formatPrice(levels.trigger)}。`,
      `- 止损/失效：${formatPrice(levels.stop)}；收盘重新进入形态或触及结构失效位即取消。`,
      `- 分批目标：T1 ${formatPrice(levels.targets[0])}；T2 ${formatPrice(levels.targets[1])}；按${candidate.patternId.includes("flag") || candidate.patternId.includes("pennant") ? "旗杆长度" : "形态高度"}的 61.8% / 100% 投射。`,
    ]),
    "- 方案有效期：三个当前周期；未触发、发生假突破或输入数据变化后必须重算。",
    "",
    "### 数据与限制",
    `本次使用 ${snapshot.candles.length} 根 ${snapshot.interval} 已收盘 K 线，并行扫描 ${theoryResult.pivots.profiles.length} 个摆动尺度和 ${theoryResult.engine.subengines.length} 个独立类别子引擎。`,
    "图表形态提供条件和风险边界，不保证趋势、目标或收益；执行前仍需核对交易所规格、滑点和账户风险。",
  ].join("\n");
}

export function buildChartPatternNoCandidateReport(snapshot, theoryResult) {
  const swings = theoryResult.pivots.swings.slice(-6);
  const historicalCandidates = theoryResult.structures?.historicalCandidates || [];
  const latestHistorical = historicalCandidates[0] || null;
  const swingText = swings.length
    ? swings.map((point) => `${point.type === "high" ? "高" : "低"}点 ${formatPrice(point.price)}`).join("，")
    : "当前窗口没有足够的交替摆动点";
  return [
    "## 图表形态扫描结论",
    "",
    "扫描已经正常完成；当前没有同时通过先前趋势、几何触点、ATR 深度和边界规则的合格形态。这不是分析失败。",
    "",
    "### 扫描范围",
    `- 数据：${snapshot.candles.length} 根 ${snapshot.interval} 已收盘 K 线。`,
    `- 子引擎：反转、延续、双向三类，共核验 ${theoryResult.engine.subengines.reduce((sum, item) => sum + item.supportedPatternIds.length, 0)} 个核心形态定义。`,
    `- 最近观察摆动：${swingText}。`,
    ...(latestHistorical ? [
      `- 历史排除：发现 ${historicalCandidates.length} 个曾成立的历史结构；最近的 ${latestHistorical.patternName} 已${lifecycleLabel(latestHistorical.lifecycle)}，不会绘制为当前形态，也不会生成入场价。`,
    ] : []),
    "",
    "### 当前执行方案",
    "- 当前动作：不交易，等待新的已确认摆动和收盘突破。",
    "- 入场、止损、目标：不生成；缺少合格结构时给出具体价格属于虚假精度。",
    "- 重新分析条件：出现新的局部高低点、形成第四/第五个有效触点，或切换到用户明确指定的观察周期。",
  ].join("\n");
}

function operation(analysis, suffix, role, tool, points, text = undefined, appearance = {}, evidenceIds = []) {
  return {
    op: "upsert",
    drawing: {
      id: `${analysis}-${suffix}`,
      strategyId: STRATEGY_ID,
      theory: "strategy",
      layer: `ai/strategy/${STRATEGY_ID}`,
      tool,
      points: points.map((point) => ({ time: point.time, price: point.price })),
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

function priceSpan(candidate) {
  return Math.max(...candidate.points.map((point) => point.price)) - Math.min(...candidate.points.map((point) => point.price));
}

function labelAnchor(candidate, point) {
  const offset = Math.max(priceSpan(candidate) * 0.025, point.price * 0.0004);
  return { time: point.time, price: Math.max(Number.EPSILON, point.price + (point.type === "high" ? offset : -offset)) };
}

function appendBoundary(operations, analysis, candidate, name, boundary, role, snapshot) {
  if (!boundary || !Number.isFinite(boundary.slope) || !Number.isFinite(boundary.intercept)) return;
  const first = snapshot.candles[boundary.startIndex];
  const latestIndex = snapshot.candles.length - 1;
  const latest = snapshot.candles[latestIndex];
  if (!first || !latest) return;
  operations.push(operation(
    analysis,
    `boundary-${name}`,
    role,
    "path",
    [
      { time: first.time, price: boundary.intercept + boundary.slope * boundary.startIndex },
      { time: latest.time, price: boundary.intercept + boundary.slope * latestIndex },
    ],
    name === "upper" ? "阻力边界" : name === "lower" ? "支撑边界" : "颈线",
    { lineStyle: "dashed", lineWidth: 1.5, status: "confirmed" },
    candidate.evidenceIds,
  ));
}

function appendLevels(operations, analysis, candidate, levels, prefix, snapshot) {
  if (!levels) return;
  const latest = snapshot.candles.at(-1);
  const start = candidate.points.at(-1);
  const specs = [
    ["entry", levels.trigger, `${prefix}触发 ${formatPrice(levels.trigger)}`],
    ["stop", levels.stop, `${prefix}失效 ${formatPrice(levels.stop)}`],
    ["target", levels.targets[0], `${prefix}T1 ${formatPrice(levels.targets[0])}`],
    ["target", levels.targets[1], `${prefix}T2 ${formatPrice(levels.targets[1])}`],
  ];
  specs.forEach(([role, price, text], index) => operations.push(operation(
    analysis,
    `level-${prefix || "main"}-${index}`,
    role,
    "path",
    [{ time: start.time, price }, { time: latest.time, price }],
    text,
    { lineStyle: "dashed", lineWidth: 1.5, status: candidate.lifecycle === "confirmed" ? "confirmed" : "tentative" },
    candidate.evidenceIds,
  )));
}

export function buildChartPatternDrawingPatch(snapshot, theoryResult) {
  const candidate = theoryResult.structures.primaryActiveCandidate;
  if (!candidate) return buildChartPatternNoCandidateDrawingPatch(snapshot, theoryResult);
  const analysis = analysisId(snapshot, candidate.id, candidate.lifecycle);
  const primaryRole = candidate.direction === "bearish" ? "resistance" : candidate.direction === "bullish" ? "support" : "primary";
  const operations = [operation(
    analysis,
    "structure",
    primaryRole,
    "path",
    candidate.points,
    undefined,
    { lineStyle: "solid", lineWidth: 3, status: "confirmed" },
    candidate.evidenceIds,
  )];
  candidate.points.forEach((point, index) => operations.push(operation(
    analysis,
    `label-${index}`,
    primaryRole,
    "text",
    [labelAnchor(candidate, point)],
    point.label,
    { fontSize: 12, bold: true, status: "confirmed" },
    [point.id],
  )));
  appendBoundary(operations, analysis, candidate, "upper", candidate.boundaries?.upper, "resistance", snapshot);
  appendBoundary(operations, analysis, candidate, "lower", candidate.boundaries?.lower, "support", snapshot);
  appendBoundary(operations, analysis, candidate, "neckline", candidate.boundaries?.neckline, "entry", snapshot);
  if (candidate.boundaries?.breakout?.price) {
    const breakout = candidate.boundaries.breakout;
    operations.push(operation(
      analysis,
      "cup-breakout",
      "entry",
      "path",
      [
        { time: snapshot.candles[breakout.startIndex].time, price: breakout.price },
        { time: snapshot.candles[Math.min(snapshot.candles.length - 1, breakout.endIndex)].time, price: breakout.price },
      ],
      `杯口 ${formatPrice(breakout.price)}`,
      { lineStyle: "dashed", lineWidth: 1.5, status: "confirmed" },
      candidate.evidenceIds,
    ));
  }
  if (candidate.lifecycle !== "failed") {
    if (candidate.category === "bilateral" && candidate.direction === "neutral") {
      appendLevels(operations, analysis, candidate, candidate.longLevels, "多", snapshot);
      appendLevels(operations, analysis, candidate, candidate.shortLevels, "空", snapshot);
    } else {
      appendLevels(operations, analysis, candidate, candidate.actionLevels, "", snapshot);
    }
  }
  if (candidate.breakout?.state === "confirmed") {
    const candle = snapshot.candles[candidate.breakout.index];
    operations.push(operation(
      analysis,
      "breakout",
      candidate.breakout.direction === "up" ? "support" : "resistance",
      candidate.breakout.direction === "up" ? "arrow-up" : "arrow-down",
      [{ time: candle.time, price: candidate.breakout.close }],
      "收盘突破确认",
      { status: "confirmed" },
      candidate.evidenceIds,
    ));
  }
  operations.push(operation(
    analysis,
    "summary",
    "note",
    "note",
    [candidate.points[0]],
    `${candidate.patternName} · ${categoryLabel(candidate.category)} · ${lifecycleLabel(candidate.lifecycle)}`,
    { status: candidate.lifecycle === "confirmed" ? "confirmed" : "tentative" },
    candidate.evidenceIds,
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

export function buildChartPatternNoCandidateDrawingPatch(snapshot, theoryResult) {
  const analysis = analysisId(snapshot, "no-qualified-candidate");
  const swings = theoryResult.pivots.swings.slice(-6);
  const latest = snapshot.candles.at(-1);
  const hasHistorical = Boolean(theoryResult.structures?.historicalCandidates?.length);
  const anchor = hasHistorical
    ? { time: latest.time, price: latest.close }
    : swings.at(-1) || { time: latest.time, price: latest.close };
  const evidenceIds = swings.map((point) => point.id);
  const operations = [];
  if (swings.length >= 2 && !hasHistorical) {
    operations.push(operation(
      analysis,
      "observation",
      "note",
      "path",
      swings,
      undefined,
      { lineStyle: "dotted", lineWidth: 1, status: "tentative" },
      evidenceIds,
    ));
  }
  operations.push(operation(
    analysis,
    "note",
    "note",
    "note",
    [anchor],
    hasHistorical
      ? "当前无有效形态：历史结构已失效、完成或过期"
      : "观察摆动：未通过核心图表形态硬规则",
    { status: "tentative" },
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

export async function runTradingChartPatternAnalysisPipeline(params) {
  const snapshot = normalizeTradingMarketSnapshot(params);
  const theoryResult = runChartPatternEngine(snapshot);
  const drawingPatch = buildChartPatternDrawingPatch(snapshot, theoryResult);
  const report = buildChartPatternReport(snapshot, theoryResult);
  const candidate = theoryResult.structures.primaryActiveCandidate;
  const narrative = candidate
    ? `${candidate.patternName}扫描完成：${lifecycleLabel(candidate.lifecycle)}；已绘制结构、边界和条件价位。`
    : theoryResult.structures.historicalCandidates.length
      ? "图表形态扫描已完成：只发现已失效、完成或过期的历史结构，未绘制旧形态并保持不交易。"
      : "图表形态扫描已完成：当前没有通过硬规则的候选，已标记观察摆动并保持不交易。";
  return {
    ok: true,
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    snapshot: snapshotSummary(snapshot),
    theoryResult,
    analysisPlan: {
      schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
      analysisId: drawingPatch.analysisId,
      revision: 0,
      snapshotId: snapshot.snapshotId,
      marketId: snapshot.marketId,
      interval: snapshot.interval,
      narrative,
      report,
      actionPlan: candidateActionPlan(snapshot, candidate),
      drawingPatch,
    },
    model: {
      providerId: "deterministic",
      modelId: "traditional-chart-pattern-engine-v2",
      requestId: null,
      latencyMs: 0,
      usage: null,
      finishReason: `deterministic-${theoryResult.status}`,
    },
  };
}
