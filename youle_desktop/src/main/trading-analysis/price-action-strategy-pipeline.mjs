import crypto from "node:crypto";
import { runPriceActionStrategyEngine } from "./price-action-strategy-engine.mjs";
import {
  TRADING_ANALYSIS_SCHEMA_VERSION,
  normalizeTradingMarketSnapshot,
  validateStrategyDrawingPatch,
} from "./protocol.mjs";

const STRATEGY_ID = "price-action";
const PRICE_ACTION_EXECUTION_POLICY = Object.freeze({
  validityBars: 4,
  observeTrigger: "观察触发价附近的已收盘 K 线实体、影线、收盘位置以及回踩/反抽是否守住",
});

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const digits = Math.abs(number) >= 1_000 ? 2 : Math.abs(number) >= 1 ? 4 : 6;
  return number.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function formatTime(seconds) {
  return new Date(Number(seconds) * 1_000).toLocaleString("zh-CN", { hour12: false });
}

function regimeLabel(regime) {
  if (regime === "uptrend") return "HH/HL 上升结构";
  if (regime === "downtrend") return "LH/LL 下降结构";
  if (regime === "transition") return "结构转换/分歧";
  return "横向区间";
}

function lifecycleLabel(lifecycle) {
  if (lifecycle === "confirmed") return "触发已由收盘确认";
  if (lifecycle === "invalidated") return "已失效";
  if (lifecycle === "partial-target-reached") return "第一目标已到达，停止追价";
  if (lifecycle === "completed") return "第二目标已完成，原方案结束";
  if (lifecycle === "expired") return "已过期";
  return "结构已形成，等待条件触发";
}

function directionLabel(direction) {
  if (direction === "bullish") return "偏多";
  if (direction === "bearish") return "偏空";
  return "双向等待";
}

function factLabel(fact) {
  return ({
    "doji": "十字/犹豫K",
    "bullish-rejection": "下影拒绝",
    "bearish-rejection": "上影拒绝",
    "strong-bull": "强势多头收盘K",
    "strong-bear": "强势空头收盘K",
    "bullish-engulfing": "看涨实体吞没",
    "bearish-engulfing": "看跌实体吞没",
    "inside-bar": "Inside Bar",
    "bullish-outside": "看涨 Outside Bar",
    "bearish-outside": "看跌 Outside Bar",
    "outside-bar": "Outside Bar",
  })[fact] || fact;
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

function isCurrentCandidate(candidate) {
  return ["active", "awaiting-breakout", "awaiting-confirmation"].includes(candidate?.tradeState);
}

function candidateActionPlan(snapshot, candidate) {
  if (!candidate || !isCurrentCandidate(candidate)) {
    return Object.freeze({
      ...PRICE_ACTION_EXECUTION_POLICY,
      primaryBias: "neutral",
      disposition: "wait",
      confirmation: "当前没有同时满足市场结构、关键区域、K线压力和有效期的裸K场景；不生成虚假入场价",
    });
  }
  const currentPrice = snapshot.candles.at(-1).close;
  if (candidate.direction === "neutral") {
    return Object.freeze({
      ...PRICE_ACTION_EXECUTION_POLICY,
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
      confirmation: "Inside Bar 只代表压缩；等待已收盘 K 线突破母 K 高/低，突破前不得预判方向",
      disposition: "wait",
    });
  }
  const bullish = candidate.direction === "bullish";
  const levels = candidate.actionLevels;
  return Object.freeze({
    ...PRICE_ACTION_EXECUTION_POLICY,
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
      ? `触发已经由当前周期已收盘 K 线确认；仍需确认价格不重新穿越 ${formatPrice(levels.stop)} 的结构失效位`
      : `等待当前周期已收盘 K 线${bullish ? "站上" : "跌破"}信号 K 极值 ${formatPrice(levels.trigger)}`,
    disposition: "wait",
  });
}

function zoneLine(zone) {
  return `${zone.role === "support" ? "支撑" : zone.role === "resistance" ? "阻力" : "决策"}区 ${formatPrice(zone.lower)}–${formatPrice(zone.upper)}（${zone.touches} 个触点）`;
}

function setupLines(candidate) {
  if (!candidate) return [];
  if (candidate.direction === "neutral") return [
    `- 场景：**${candidate.setupName}**；${lifecycleLabel(candidate.lifecycle)}。`,
    `- 多头条件：收盘站上 ${formatPrice(candidate.longLevels.trigger)}；失效 ${formatPrice(candidate.longLevels.stop)}；T1/T2 ${formatPrice(candidate.longLevels.targets[0])} / ${formatPrice(candidate.longLevels.targets[1])}。`,
    `- 空头条件：收盘跌破 ${formatPrice(candidate.shortLevels.trigger)}；失效 ${formatPrice(candidate.shortLevels.stop)}；T1/T2 ${formatPrice(candidate.shortLevels.targets[0])} / ${formatPrice(candidate.shortLevels.targets[1])}。`,
  ];
  const levels = candidate.actionLevels;
  return [
    `- 场景：**${candidate.setupName}**（${directionLabel(candidate.direction)}）；${lifecycleLabel(candidate.lifecycle)}。`,
    `- 上下文：${candidate.context}。`,
    `- 条件触发：${formatPrice(levels.trigger)}；结构止损/失效：${formatPrice(levels.stop)}。`,
    `- 分批目标：T1 ${formatPrice(levels.targets[0])}；T2 ${formatPrice(levels.targets[1])}。`,
  ];
}

function candlestickPatternLine(pattern) {
  const direction = directionLabel(pattern.direction);
  const formationConfirmed = pattern.formationStatus
    ? pattern.formationStatus === "confirmed"
    : pattern.complete !== false;
  const formation = formationConfirmed ? "形态所含 K 线均已收盘" : "形态包含未收盘 K 线，只作预览";
  const confirmation = pattern.confirmation === "confirmed" ? "方向跟随已确认" : pattern.confirmation === "not-required" ? "无需方向确认" : "方向跟随待确认";
  const location = pattern.zone
    ? `位于${pattern.zone.role === "support" ? "支撑" : pattern.zone.role === "resistance" ? "阻力" : "决策"}区`
    : "未绑定重复触点关键区";
  return `- **${pattern.name}**（${direction}，${pattern.candleCount} 根）：${pattern.explanation}；${location}；${formation}；${confirmation}${pattern.actionable ? "；已满足形态级位置与确认门槛" : "；不单独构成交易"}。`;
}

export function buildPriceActionStrategyReport(snapshot, result) {
  const candidate = result.setups.primaryActiveCandidate;
  const latest = result.candlePressure.latest;
  const zones = result.zones
    .filter((zone) => zone.role !== "decision" || snapshot.candles.at(-1).close >= zone.lower && snapshot.candles.at(-1).close <= zone.upper)
    .slice(0, 4);
  const historical = result.setups.historicalCandidates[0] || null;
  const recentCandlestickPatterns = result.candlestickPatterns.recentPatterns.slice(0, 6);
  return [
    "## 裸K / Price Action 分析结论",
    "",
    candidate
      ? `当前识别到 **${candidate.setupName}**，方向为**${directionLabel(candidate.direction)}**；${lifecycleLabel(candidate.lifecycle)}。`
      : "扫描已经正常完成；当前没有合格且仍在有效期内的裸K交易场景。这不是分析失败，当前动作是不交易。",
    "",
    "### 市场结构",
    `- 当前结构：**${regimeLabel(result.marketStructure.regime)}**；结构事件：${result.marketStructure.event === "bullish-structure-break" ? "向上收盘突破最近确认高点" : result.marketStructure.event === "bearish-structure-break" ? "向下收盘跌破最近确认低点" : "没有新的收盘结构突破"}。`,
    `- 最近摆动：${result.pivots.swings.slice(-6).map((swing) => `${swing.label} ${formatPrice(swing.price)}`).join("；") || "确认摆动不足"}。`,
    `- 关键区域：${zones.map(zoneLine).join("；") || "当前窗口没有形成至少两个触点的稳定区域"}。`,
    "",
    "### K线压力（仅 OHLC 推断）",
    `- 最新收盘 ${formatPrice(latest.close)}；实体占整根 ${(latest.bodyRatio * 100).toFixed(1)}%，收盘位于高低区间的 ${(latest.closeLocation * 100).toFixed(1)}% 位置。`,
    `- 可复算事实：${latest.facts.length ? latest.facts.map(factLabel).join("、") : "普通K线，没有满足冻结阈值的拒绝、吞没、强收盘或压缩事实"}。`,
    "- 这些事实只表示该周期的价格压力；没有成交量、盘口和逐笔数据时，不能声称识别到真实资金流或机构买卖。",
    "",
    "### 明确K线形态",
    ...(recentCandlestickPatterns.length
      ? recentCandlestickPatterns.map(candlestickPatternLine)
      : ["- 最近 24 根输入 K 线没有满足几何与前置趋势门槛的命名形态；不会为增加命中数量而放宽定义。"]),
    "- 图中只圈选最近、去重后的最多四个组合形态；包含未收盘 K 线的形态只作预览，圆圈也不代表方向必然兑现。",
    "",
    "### 条件式执行",
    ...setupLines(candidate),
    ...(!candidate ? [
      "- 当前动作：等待，不交易；不生成入场、止损和目标价，避免虚假精度。",
      "- 重新分析：出现新的确认摆动、价格回到高质量关键区、形成带上下文的拒绝/吞没/Inside Bar，或发生收盘突破—回踩后再运行。",
      ...(historical ? [`- 历史排除：最近的 ${historical.setupName} 已${lifecycleLabel(historical.lifecycle)}，不会绘制成当前机会。`] : []),
    ] : [
      "- 执行前提：只按已收盘 K 线触发；盘中影线越价不算确认。",
      "- 方案有效期：触发前最多四个当前周期；触发后最多四个当前周期，达到目标、触及失效位或过期均结束原方案。",
    ]),
    "",
    "### 数据与风险",
    `本次只读取 ${snapshot.candles.length} 根 ${snapshot.interval} K 线的 time/open/high/low/close，范围 ${formatTime(snapshot.candles[0].time)} 至 ${formatTime(snapshot.candles.at(-1).time)}；未把成交量或技术指标作为信号。`,
    "裸K分析是条件式风险框架，不是收益承诺或自动订单；跳空、滑点、资金费率、新闻和新 K 线都可能使结论失效。",
  ].join("\n");
}

function analysisId(snapshot, ...parts) {
  return `price-action-analysis-${crypto.createHash("sha1").update(JSON.stringify([snapshot.snapshotId, ...parts])).digest("hex").slice(0, 18)}`;
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

function selectedZones(snapshot, result) {
  const price = snapshot.candles.at(-1).close;
  const supports = result.zones.filter((zone) => zone.upper <= price || zone.role === "support")
    .sort((a, b) => Math.abs(a.center - price) - Math.abs(b.center - price));
  const resistances = result.zones.filter((zone) => zone.lower >= price || zone.role === "resistance")
    .sort((a, b) => Math.abs(a.center - price) - Math.abs(b.center - price));
  return [...supports.slice(0, 1), ...resistances.slice(0, 1)]
    .filter((zone, index, zones) => zones.findIndex((item) => item.id === zone.id) === index);
}

function appendLevels(operations, analysis, snapshot, candidate, levels, prefix = "") {
  if (!levels) return;
  const startIndex = Math.max(0, candidate.signalIndex - 10);
  const start = snapshot.candles[startIndex];
  const latest = snapshot.candles.at(-1);
  [
    ["entry", levels.trigger, `${prefix}触发 ${formatPrice(levels.trigger)}`],
    ["stop", levels.stop, `${prefix}失效 ${formatPrice(levels.stop)}`],
    ["target", levels.targets[0], `${prefix}T1 ${formatPrice(levels.targets[0])}`],
    ["target", levels.targets[1], `${prefix}T2 ${formatPrice(levels.targets[1])}`],
  ].forEach(([role, price, text], index) => operations.push(operation(
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

function appendCandlestickPatterns(operations, analysis, snapshot, result) {
  const candles = snapshot.candles;
  const defaultInterval = candles.length > 1 ? candles.at(-1).time - candles.at(-2).time : 3_600;
  for (const [index, pattern] of result.candlestickPatterns.drawablePatterns.entries()) {
    const first = candles[pattern.startIndex];
    const last = candles[pattern.endIndex];
    if (!first || !last) continue;
    const interval = pattern.endIndex > pattern.startIndex
      ? Math.max(1, (last.time - first.time) / (pattern.endIndex - pattern.startIndex))
      : defaultInterval;
    const pricePadding = Math.max((pattern.high - pattern.low) * 0.16, last.close * 0.00045);
    const role = pattern.direction === "bullish" ? "support" : pattern.direction === "bearish" ? "resistance" : "note";
    const leftTime = Math.max(1, first.time - interval * 0.48);
    const rightTime = last.time + interval * 0.48;
    const centerTime = (leftTime + rightTime) / 2;
    const candleCount = pattern.endIndex - pattern.startIndex + 1;
    const formationConfirmed = pattern.formationStatus
      ? pattern.formationStatus === "confirmed"
      : pattern.complete !== false;
    const formationLabel = formationConfirmed ? "" : " · 待收盘";
    const formationDrawingStatus = formationConfirmed ? "confirmed" : "tentative";
    if (candleCount >= 2) {
      operations.push(operation(
        analysis,
        `candlestick-pattern-${index}`,
        role,
        "ellipse",
        [{ time: leftTime, price: Math.max(Number.EPSILON, pattern.low - pricePadding) }, { time: rightTime, price: pattern.high + pricePadding }],
        pattern.name,
        { lineStyle: "solid", lineWidth: 0.8, status: formationDrawingStatus },
        [pattern.id, ...pattern.evidenceIds],
      ));
    }
    operations.push(operation(
      analysis,
      `candlestick-pattern-label-${index}`,
      role,
      "text",
      [{ time: centerTime, price: pattern.high + pricePadding }],
      `${pattern.name}${formationLabel}`,
      { fontSize: 12, bold: false, status: formationDrawingStatus },
      [pattern.id, ...pattern.evidenceIds],
    ));
  }
}

export function buildPriceActionStrategyDrawingPatch(snapshot, result) {
  const candidate = result.setups.primaryActiveCandidate;
  const analysis = analysisId(snapshot, candidate?.id || "no-current-setup", result.marketStructure.regime);
  const operations = [];
  const swings = result.pivots.swings.slice(-8);
  if (swings.length >= 2) {
    operations.push(operation(
      analysis,
      "market-structure",
      "primary",
      "path",
      swings,
      undefined,
      { lineStyle: "solid", lineWidth: 2.5, status: "confirmed" },
      swings.map((swing) => swing.id),
    ));
    const span = Math.max(...swings.map((swing) => swing.price)) - Math.min(...swings.map((swing) => swing.price));
    swings.forEach((swing, index) => operations.push(operation(
      analysis,
      `swing-label-${index}`,
      "primary",
      "text",
      [{ time: swing.time, price: Math.max(Number.EPSILON, swing.price + (swing.type === "high" ? 1 : -1) * Math.max(span * 0.025, swing.price * 0.00035)) }],
      swing.label,
      { fontSize: 12, bold: true, status: "confirmed" },
      [swing.id],
    )));
  }
  const latest = snapshot.candles.at(-1);
  for (const [index, zone] of selectedZones(snapshot, result).entries()) {
    const start = snapshot.candles[Math.max(0, zone.mostRecentIndex - 24)] || snapshot.candles[0];
    const role = zone.role === "resistance" ? "resistance" : zone.role === "support" ? "support" : "note";
    operations.push(operation(
      analysis,
      `zone-${index}`,
      role,
      "rectangle",
      [{ time: start.time, price: zone.lower }, { time: latest.time, price: zone.upper }],
      zoneLine(zone),
      { lineStyle: "dashed", lineWidth: 1.5, status: "confirmed" },
      zone.evidenceIds,
    ));
  }
  appendCandlestickPatterns(operations, analysis, snapshot, result);
  if (candidate) {
    const signalRole = candidate.direction === "bearish" ? "resistance" : candidate.direction === "bullish" ? "support" : "note";
    operations.push(operation(
      analysis,
      "signal",
      signalRole,
      candidate.direction === "bearish" ? "arrow-down" : candidate.direction === "bullish" ? "arrow-up" : "note",
      [{ time: candidate.signal.time, price: candidate.direction === "bearish" ? candidate.signal.high : candidate.direction === "bullish" ? candidate.signal.low : candidate.signal.close }],
      `${candidate.setupName} · ${lifecycleLabel(candidate.lifecycle)}`,
      { status: candidate.lifecycle === "confirmed" ? "confirmed" : "tentative" },
      candidate.evidenceIds,
    ));
    if (candidate.direction === "neutral") {
      appendLevels(operations, analysis, snapshot, candidate, candidate.longLevels, "多");
      appendLevels(operations, analysis, snapshot, candidate, candidate.shortLevels, "空");
    } else appendLevels(operations, analysis, snapshot, candidate, candidate.actionLevels);
  } else {
    operations.push(operation(
      analysis,
      "no-current-setup",
      "note",
      "note",
      [{ time: latest.time, price: latest.close }],
      `裸K扫描完成：${regimeLabel(result.marketStructure.regime)}，当前无合格入场场景`,
      { status: "tentative" },
      result.evidence.slice(0, 8).map((item) => item.id),
    ));
  }
  return validateStrategyDrawingPatch({
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    analysisId: analysis,
    baseRevision: 0,
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    operations,
  }, snapshot, STRATEGY_ID);
}

export async function runTradingPriceActionStrategyPipeline(params) {
  const snapshot = normalizeTradingMarketSnapshot(params);
  const theoryResult = runPriceActionStrategyEngine(snapshot);
  const drawingPatch = buildPriceActionStrategyDrawingPatch(snapshot, theoryResult);
  const report = buildPriceActionStrategyReport(snapshot, theoryResult);
  const candidate = theoryResult.setups.primaryActiveCandidate;
  const narrative = candidate
    ? `${candidate.setupName}扫描完成：${lifecycleLabel(candidate.lifecycle)}；已绘制市场结构、关键区域、明确K线形态和条件价位。`
    : `裸K分析已完成：已绘制当前市场结构、关键区域和 ${theoryResult.candlestickPatterns.drawablePatterns.length} 个明确K线形态；没有合格当前场景时保持不交易。`;
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
      modelId: "price-action-ohlc-engine-v1",
      requestId: null,
      latencyMs: 0,
      usage: null,
      finishReason: "deterministic-succeeded",
    },
  };
}
