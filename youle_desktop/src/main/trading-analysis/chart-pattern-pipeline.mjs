import { localizeTradingAnalysisResult, tradingReportTime, tradingReportText, withTradingReportLanguage } from "./report-language.mjs";
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
  return tradingReportTime(Number(seconds) * 1_000);
}

function categoryLabel(category) {
  if (category === "reversal") return tradingReportText("反转形态");
  if (category === "continuation") return tradingReportText("延续形态");
  return tradingReportText("双向形态");
}

function directionLabel(direction) {
  if (direction === "bullish") return tradingReportText("看涨");
  if (direction === "bearish") return tradingReportText("看跌");
  return tradingReportText("中性待突破");
}

function lifecycleLabel(lifecycle) {
  if (lifecycle === "confirmed") return tradingReportText("已由收盘突破确认");
  if (lifecycle === "failed") return tradingReportText("已判定为假突破/失效");
  if (lifecycle === "invalidated") return tradingReportText("已失效");
  if (lifecycle === "completed") return tradingReportText("目标已完成，原方案结束");
  if (lifecycle === "partial-target-reached") return tradingReportText("第一目标已到达，不再追价");
  if (lifecycle === "expired") return tradingReportText("已过期");
  return tradingReportText("结构成立，等待收盘突破");
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

export function buildChartPatternActionPlan(snapshot, candidate) {
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
  if (candidate.context?.entryBlockedReason) {
    return Object.freeze({ primaryBias: "neutral", disposition: "wait", currentPrice,
      confirmation: "父结构边界距离不足一份结构风险，保留形态观察，等待边界突破或新结构后重算" });
  }
  if (candidate.category === "bilateral" && candidate.direction === "neutral") {
    const blocked = candidate.context?.blockedDirections || [];
    return Object.freeze({
      primaryBias: "neutral",
      currentPrice,
      ...(!blocked.includes("bullish") ? {
        longTrigger: candidate.longLevels.trigger,
        longInvalidation: candidate.longLevels.stop,
        longTarget: candidate.longLevels.targets[0],
        longTargets: candidate.longLevels.targets,
      } : {}),
      ...(!blocked.includes("bearish") ? {
        shortTrigger: candidate.shortLevels.trigger,
        shortInvalidation: candidate.shortLevels.stop,
        shortTarget: candidate.shortLevels.targets[0],
        shortTargets: candidate.shortLevels.targets,
      } : {}),
      confirmation: blocked.length ? "保持中性；仅保留父结构空间足够的方向，等待对应边界收盘突破后重算"
        : "保持双向中性；只接受已收盘 K 线有效突破对应边界，区间内不执行",
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

function contextReport(candidate) {
  const context = candidate.context;
  if (!context) return [];
  const retest = { "not-broken": "等待突破", "not-seen": "尚未出现回踩", held: "回踩边界守住", failed: "回踩收回结构内部" };
  return [
    tradingReportText("- 回踩状态：{0}。", tradingReportText(retest[context.retest.state])),
    tradingReportText("- 量能证据：整理后半段/前半段 {0}；突破量/此前均量 {1}。量能仅作辅助，不把缺失量当成缩量。",
      context.volume.formationRatio?.toFixed(2) ?? tradingReportText("不可用"), context.volume.breakoutRatio?.toFixed(2) ?? tradingReportText("不可用")),
    ...(context.parentPatternName ? [tradingReportText("- 嵌套结构：本周期内的小结构位于 {0} 框架中；这不是额外周期的数据确认。", context.parentPatternName)] : []),
    ...(context.parentRoom ? [tradingReportText("- 父结构空间：对侧边界 {0}，距触发位约 {1}R（R 为触发至止损距离）；不足 1R 时仅观察，不生成入场条件。",
      formatPrice(context.parentRoom.boundary), context.parentRoom.rewardRisk.toFixed(2))] : []),
    ...(context.retestCompression?.state === "contracted" ? [tradingReportText("- 回踩后收缩：最近三根真实波幅约为形成期 ATR 的 {0} 倍；仍需边界守住，不能单独触发。", context.retestCompression.rangeAtrRatio.toFixed(2))] : []),
    ...(context.climaxRetest?.state === "observed" ? [tradingReportText("- 极值量价：首次极值量为此前均量 {0} 倍，再测同侧极值量为首次的 {1}；价格推进有限，仅作疲弱证据，不证明反转。",
      context.climaxRetest.firstVolumeRatio.toFixed(2), context.climaxRetest.retestVolumeRatio.toFixed(2))] : []),
    ...(context.conflictingCandidateIds.length ? [tradingReportText("- 相反场景：同窗口还有 {0} 个方向冲突的有效结构，应等待各自边界确认。", context.conflictingCandidateIds.length)] : []),
  ];
}

export function buildChartPatternReport(snapshot, theoryResult) {
  const candidate = theoryResult.structures.primaryActiveCandidate;
  if (!candidate) return buildChartPatternNoCandidateReport(snapshot, theoryResult);
  if (candidate.lifecycle === "failed") {
    return [
      tradingReportText("## 图表形态扫描结论"),
      "",
      tradingReportText("识别到 **{0}** 的历史结构，但突破后重新收回边界，当前按**假突破/失效**处理。分析已完成，不生成追单方案。", candidate.patternName),
      "",
      tradingReportText("### 失效证据"),
      tradingReportText("- 结构点：{0}。", pointSummary(candidate)),
      tradingReportText("- 首次突破：{0} 收于 {1}。", formatTime(candidate.breakout.time), formatPrice(candidate.breakout.close)),
      tradingReportText("- 重新收回：第 {0} 根输入 K 线重新进入结构边界。", candidate.breakout.failedAtIndex + 1),
      "",
      tradingReportText("### 当前执行方案"),
      tradingReportText("- 当前动作：取消原触发，不交易。"),
      tradingReportText("- 重新分析：等待新的边界、触点和已收盘突破形成后再计算止损与目标。"),
    ].join("\n");
  }
  const bilateralDeveloping = candidate.category === "bilateral" && candidate.direction === "neutral";
  const levels = candidate.actionLevels;
  const blocked = candidate.context?.blockedDirections || [];
  return [
    tradingReportText("## 图表形态结论"),
    "",
    tradingReportText("识别到 **{0}**（{1}，{2}）；{3}。", candidate.patternName, categoryLabel(candidate.category), directionLabel(candidate.direction), lifecycleLabel(candidate.lifecycle)),
    "",
    tradingReportText("### 结构与确认"),
    tradingReportText("- 结构点：{0}。", pointSummary(candidate)),
    tradingReportText("- 几何状态：{0} 个已确认触点，形态高度 {1}，规则得分 {2}%。", candidate.points.length, formatPrice(candidate.height), (candidate.score * 100).toFixed(1)),
    tradingReportText("- 突破状态：{0}。", candidate.lifecycle === "confirmed" ? tradingReportText("{0} 的已收盘 K 线向{1}突破 {2}", formatTime(candidate.breakout.time), candidate.breakout.direction === "up" ? tradingReportText("上") : tradingReportText("下"), formatPrice(candidate.breakout.boundary)) : tradingReportText("尚未出现越过波动缓冲的有效收盘突破，盘中影线不计确认")),
    ...contextReport(candidate),
    "",
    tradingReportText("### 条件式执行"),
    ...(candidate.context?.entryBlockedReason ? [
      tradingReportText("- 当前动作：父结构空间不足，保留几何观察，等待重新分析。"),
    ] : bilateralDeveloping ? [
      ...(blocked.length ? [tradingReportText("保持中性；仅保留父结构空间足够的方向，等待对应边界收盘突破后重算")]
        : [tradingReportText("- 当前方向：中性；向上收盘突破 {0} 才启用多头场景，向下收盘突破 {1} 才启用空头场景。", formatPrice(candidate.longLevels.trigger), formatPrice(candidate.shortLevels.trigger))]),
      blocked.includes("bullish") ? tradingReportText("- 多头：父结构空间不足，仅观察。")
        : tradingReportText("- 多头触发 {0}；止损 {1}；T1 {2}；T2 {3}。", formatPrice(candidate.longLevels.trigger), formatPrice(candidate.longLevels.stop), formatPrice(candidate.longLevels.targets[0]), formatPrice(candidate.longLevels.targets[1])),
      blocked.includes("bearish") ? tradingReportText("- 空头：父结构空间不足，仅观察。")
        : tradingReportText("- 空头触发 {0}；止损 {1}；T1 {2}；T2 {3}。", formatPrice(candidate.shortLevels.trigger), formatPrice(candidate.shortLevels.stop), formatPrice(candidate.shortLevels.targets[0]), formatPrice(candidate.shortLevels.targets[1])),
    ] : [
      tradingReportText("- 方向与触发：{0}；{1} {2}。", directionLabel(candidate.direction), candidate.lifecycle === "confirmed" ? tradingReportText(candidate.direction === "bullish" ? "突破已出现，回踩后价格须继续高于" : "突破已出现，反抽后价格须继续低于") : tradingReportText("等待收盘确认"), formatPrice(levels.trigger)),
      tradingReportText("- 止损/失效：{0}；收盘重新进入形态或触及结构失效位即取消。", formatPrice(levels.stop)),
      tradingReportText("- 分批目标：T1 {0}；T2 {1}；按{2}的 61.8% / 100% 投射。", formatPrice(levels.targets[0]), formatPrice(levels.targets[1]), candidate.patternId.includes("flag") || candidate.patternId.includes("pennant") ? tradingReportText("旗杆长度") : tradingReportText("形态高度")),
    ]),
    tradingReportText("- 方案有效期：三个当前周期；未触发、发生假突破或输入数据变化后必须重算。"),
    "",
    tradingReportText("### 数据与限制"),
    tradingReportText("本次使用 {0} 根 {1} 已收盘 K 线，并行扫描 {2} 个摆动尺度和 {3} 个独立类别子引擎。", snapshot.candles.length, snapshot.interval, theoryResult.pivots.profiles.length, theoryResult.engine.subengines.length),
    tradingReportText("图表形态提供条件和风险边界，不保证趋势、目标或收益；执行前仍需核对交易所规格、滑点和账户风险。"),
  ].join("\n");
}

export function buildChartPatternNoCandidateReport(snapshot, theoryResult) {
  const swings = theoryResult.pivots.swings.slice(-6);
  const historicalCandidates = theoryResult.structures?.historicalCandidates || [];
  const latestHistorical = historicalCandidates[0] || null;
  const swingText = swings.length
    ? swings.map((point) => tradingReportText("{0}点 {1}", point.type === "high" ? tradingReportText("高") : tradingReportText("低"), formatPrice(point.price))).join("，")
    : tradingReportText("当前窗口没有足够的交替摆动点");
  return [
    tradingReportText("## 图表形态扫描结论"),
    "",
    tradingReportText(latestHistorical ? "扫描已经正常完成；已识别的结构均已完成、失效或过期，当前没有新的形态入场信号。"
      : "扫描已经正常完成；当前没有同时通过先前趋势、几何触点、ATR 深度和边界规则的合格形态。这不是分析失败。"),
    "",
    tradingReportText("### 扫描范围"),
    tradingReportText("- 数据：{0} 根 {1} 已收盘 K 线。", snapshot.candles.length, snapshot.interval),
    tradingReportText("- 子引擎：反转、延续、双向三类，共核验 {0} 个核心形态定义。", theoryResult.engine.subengines.reduce((sum, item) => sum + item.supportedPatternIds.length, 0)),
    tradingReportText("- 最近观察摆动：{0}。", swingText),
    ...(latestHistorical ? [
      tradingReportText("- 历史结构：发现 {0} 个历史候选；最近的 {1}：{2}。保留近期结构供复盘，不生成新的入场价。", historicalCandidates.length, latestHistorical.patternName, lifecycleLabel(latestHistorical.lifecycle)),
    ] : []),
    "",
    tradingReportText("### 当前执行方案"),
    tradingReportText("- 当前动作：不交易，等待新的已确认摆动和收盘突破。"),
    tradingReportText("- 入场、止损、目标：不生成；缺少合格结构时给出具体价格属于虚假精度。"),
    tradingReportText("- 重新分析条件：出现新的局部高低点、形成第四/第五个有效触点，或切换到用户明确指定的观察周期。"),
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
  const span = priceSpan(candidate);
  const offset = Math.min(span * 0.15, Math.max(span * 0.025, point.price * 0.0004));
  const minimum = Math.min(...candidate.points.map(p => p.price)) + offset;
  const maximum = Math.max(...candidate.points.map(p => p.price)) - offset;
  // Keep extremum labels inside the structure's price band so the native
  // candle autoscale does not clip labels above its highest wick.
  return { time: point.time, price: Math.max(minimum, Math.min(maximum,
    point.price + (point.type === "high" ? offset : -offset))) };
}

function appendBoundary(operations, analysis, candidate, name, boundary, role, snapshot, endAt = null) {
  if (!boundary || !Number.isFinite(boundary.slope) || !Number.isFinite(boundary.intercept)) return;
  const first = snapshot.candles[boundary.startIndex];
  let latestIndex = isCurrentCandidate(candidate) ? snapshot.candles.length - 1
    : Math.min(snapshot.candles.length - 1, candidate.lifecycleState?.terminalIndex ?? candidate.points.at(-1).index);
  if (Number.isFinite(candidate.metrics?.apexIndex)) latestIndex = Math.min(latestIndex, Math.floor(candidate.metrics.apexIndex));
  if (Number.isInteger(endAt)) latestIndex = Math.min(latestIndex, endAt);
  const latest = snapshot.candles[latestIndex];
  if (!first || !latest || latestIndex <= boundary.startIndex
    || boundary.intercept + boundary.slope * latestIndex <= 0) return;
  operations.push(operation(
    analysis,
    `boundary-${name}`,
    role,
    "path",
    [
      { time: first.time, price: boundary.intercept + boundary.slope * boundary.startIndex },
      { time: latest.time, price: boundary.intercept + boundary.slope * latestIndex },
    ],
    /upper/i.test(name) ? "阻力边界" : /lower/i.test(name) ? "支撑边界" : "颈线",
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

function buildCandidateDrawingPatch(snapshot, candidate, showLevels = true, showDetails = true) {
  const analysis = analysisId(snapshot, candidate.id, candidate.lifecycle);
  const current = isCurrentCandidate(candidate);
  const primaryRole = !current ? "note" : candidate.direction === "bearish" ? "resistance" : candidate.direction === "bullish" ? "support" : "primary";
  let structurePoints = candidate.points;
  if (/cup|rounding/.test(candidate.patternId)) {
    const start = candidate.points[0].index, end = candidate.points.at(-1).index;
    const indices = new Set(candidate.points.map(p => p.index));
    for (let i = start; i <= end; i += Math.max(1, Math.ceil((end - start) / 20))) indices.add(i);
    structurePoints = [...indices].sort((a, b) => a - b).map(i => candidate.points.find(p => p.index === i)
      || { time: snapshot.candles[i].time, price: snapshot.candles[i].close });
  }
  const operations = [operation(
    analysis,
    "structure",
    primaryRole,
    "path",
    structurePoints,
    undefined,
    { lineStyle: current ? "solid" : "dotted", lineWidth: current ? 3 : 1.5, status: current ? "confirmed" : "tentative" },
    candidate.evidenceIds,
  )];
  if (showDetails) candidate.points.forEach((point, index) => operations.push(operation(
    analysis,
    `label-${index}`,
    primaryRole,
    "text",
    [labelAnchor(candidate, point)],
    point.label,
    { fontSize: 12, bold: true, status: "confirmed" },
    [point.id],
  )));
  if (showDetails) {
  appendBoundary(operations, analysis, candidate, "upper", candidate.boundaries?.upper, current ? "resistance" : "note", snapshot);
  appendBoundary(operations, analysis, candidate, "lower", candidate.boundaries?.lower, current ? "support" : "note", snapshot);
  appendBoundary(operations, analysis, candidate, "neckline", candidate.boundaries?.neckline, current ? "entry" : "note", snapshot);
  appendBoundary(operations, analysis, candidate, "expandUpper", candidate.boundaries?.expandUpper, current ? "resistance" : "note", snapshot, candidate.points[4]?.index);
  appendBoundary(operations, analysis, candidate, "expandLower", candidate.boundaries?.expandLower, current ? "support" : "note", snapshot, candidate.points[4]?.index);
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
      tradingReportText("结构边界 {0}", formatPrice(breakout.price)),
      { lineStyle: "dashed", lineWidth: 1.5, status: "confirmed" },
      candidate.evidenceIds,
    ));
  }
  }
  if (current && showLevels && !candidate.context?.entryBlockedReason) {
    if (candidate.category === "bilateral" && candidate.direction === "neutral") {
      if (!candidate.context?.blockedDirections?.includes("bullish")) appendLevels(operations, analysis, candidate, candidate.longLevels, tradingReportText("多"), snapshot);
      if (!candidate.context?.blockedDirections?.includes("bearish")) appendLevels(operations, analysis, candidate, candidate.shortLevels, tradingReportText("空"), snapshot);
    } else {
      appendLevels(operations, analysis, candidate, candidate.actionLevels, "", snapshot);
    }
  }
  if (current && candidate.breakout?.state === "confirmed") {
    const candle = snapshot.candles[candidate.breakout.index];
    operations.push(operation(
      analysis,
      "breakout",
      candidate.breakout.direction === "up" ? "support" : "resistance",
      candidate.breakout.direction === "up" ? "arrow-up" : "arrow-down",
      [{ time: candle.time, price: candidate.breakout.close }],
      tradingReportText("收盘突破确认"),
      { status: "confirmed" },
      candidate.evidenceIds,
    ));
  }
  const compactState = { confirmed: "已确认", developing: "形成中", failed: "已失效", invalidated: "已失效",
    completed: "已完成", "partial-target-reached": "已到第一目标", expired: "已过期" };
  operations.push(operation(
    analysis,
    "summary",
    "note",
    "note",
    [candidate.points[0]],
    `${candidate.patternName} · ${current ? `${directionLabel(candidate.direction)} · ` : ""}${tradingReportText(compactState[candidate.lifecycle] || "形成中")}${candidate.context?.entryBlockedReason ? ` · ${tradingReportText("父结构空间不足，仅观察")}` : ""}${current ? "" : ` · ${tradingReportText("历史参考，不是新入场信号")}`}`,
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

export function buildChartPatternDrawingPatch(snapshot, theoryResult) {
  const candidates = theoryResult.structures.displayCandidates
    || [theoryResult.structures.primaryActiveCandidate].filter(Boolean);
  if (!candidates.length) return buildChartPatternNoCandidateDrawingPatch(snapshot, theoryResult);
  const patches = candidates.slice(0, 3).map((candidate, index) => buildCandidateDrawingPatch(snapshot, candidate,
    candidate.id === theoryResult.structures.primaryActiveCandidate?.id, index === 0));
  return validateStrategyDrawingPatch({ ...patches[0], analysisId: analysisId(snapshot, "structures-v2"),
    operations: patches.flatMap(patch => patch.operations) }, snapshot, STRATEGY_ID);
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
      ? tradingReportText("当前无有效形态：历史结构已失效、完成或过期")
      : tradingReportText("观察摆动：未通过核心图表形态硬规则"),
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

async function runTradingChartPatternAnalysisPipelineInternal(params) {
  // Filter before normalization, which intentionally removes transport-only closed flags.
  const match = /^(\d+)([mhdwHDW]?)$/.exec(String(params.interval));
  const seconds = match ? Number(match[1]) * ({ m: 60, h: 3600, H: 3600, d: 86400, D: 86400, w: 604800, W: 604800, "": 60 }[match[2]]) : null;
  const cutoff = Number(params.snapshotTime ?? Date.now()) / 1000;
  const closedIndexes = params.candles.flatMap((c, i) => c.closed !== false && (params.sessionCloseTimes?.[i] !== undefined
    ? params.sessionCloseTimes[i] <= cutoff : !seconds || Number(c.time) + seconds <= cutoff) ? [i] : []);
  const snapshot = normalizeTradingMarketSnapshot({ ...params, candles: closedIndexes.map(i => params.candles[i]),
    ...(params.sessionCloseTimes ? { sessionCloseTimes: closedIndexes.map(i => params.sessionCloseTimes[i]) } : {}) });
  const theoryResult = runChartPatternEngine(snapshot);
  const drawingPatch = buildChartPatternDrawingPatch(snapshot, theoryResult);
  const report = buildChartPatternReport(snapshot, theoryResult);
  const candidate = theoryResult.structures.primaryActiveCandidate;
  const narrative = candidate
    ? candidate.context?.entryBlockedReason
      ? tradingReportText("{0}扫描完成：父结构空间不足，仅保留结构与边界观察。", candidate.patternName)
      : `${candidate.patternName}扫描完成：${lifecycleLabel(candidate.lifecycle)}；已绘制结构、边界和条件价位。`
    : theoryResult.structures.historicalCandidates.length
      ? "图表形态扫描已完成：近期历史结构按状态保留，当前没有新的形态入场信号。"
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
      actionPlan: buildChartPatternActionPlan(snapshot, candidate),
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

export async function runTradingChartPatternAnalysisPipeline(params, options = {}) {
  return withTradingReportLanguage(params?.language, async () => localizeTradingAnalysisResult(await runTradingChartPatternAnalysisPipelineInternal(params, options), params?.language));
}
