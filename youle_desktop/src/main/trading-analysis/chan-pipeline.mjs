import crypto from "node:crypto";
import { containsHanCharacters } from "../assistant-output-language.mjs";
import { runChanTheoryEngine } from "./chan-engine.mjs";
import { runValidatedTradingModelReview } from "./model-review.mjs";
import {
  TRADING_ANALYSIS_SCHEMA_VERSION,
  normalizeTradingMarketSnapshot,
  validateTradingDrawingPatch,
} from "./protocol.mjs";

function extractJsonObject(text) {
  const source = String(text || "").trim();
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  if (first < 0 || last <= first) throw new TypeError("Model response did not contain a JSON object");
  return JSON.parse(source.slice(first, last + 1));
}
export function buildChanModelPrompt(snapshot, theoryResult, context = {}) {
  const directAnswer = context.responseMode === "direct";
  const english = context.language === "en";
  const compactCandles = snapshot.candles.slice(-160).map((candle) => [
    candle.time,
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume,
  ]);
  return [
    "你是交易分析系统中的缠论复核器，不负责直接操作界面。",
    "确定性缠论引擎已经完成包含处理、分型、笔和中枢候选计算。请只基于给定候选进行复核与绘图取舍，不得创造候选之外的时间、价格、ID 或交易事实。",
    directAnswer
      ? "本次只刷新分析并回答用户的具体问题，不更新画布。report 必须第一句直接作答，后续只写必要依据，不得套用完整盘面报告或固定章节。"
      : "本次需要生成完整盘面分析与受控绘图计划。",
    "输出必须是单个 JSON 对象，不要 Markdown，不要解释 JSON 之外的内容。",
    "JSON 协议：",
    JSON.stringify({
      schemaVersion: 1,
      verdict: "approve 或 revise",
      summary: english
        ? "English-only chart summary, at most 80 characters; no profit guarantees or Chinese characters"
        : "不超过80个中文字符的盘面结构说明，不得承诺收益",
      report: english
        ? "Answer in English only. Describe the confirmed/tentative structures, central zones, invalidation and risk; no invented prices or profit guarantees. In direct mode, answer only the user's question."
        : directAnswer
        ? "直接回答用户本次问题的自然中文；结构和长短按问题决定，不用固定模板"
        : "面向用户的完整中文缠论分析，说明范围、已确认/暂定结构、中枢、当前走势、失效条件与风险；不得承诺收益，不得虚构候选结构之外的价格；不要输出 Markdown 标题之外的 JSON",
      marketBias: "bullish、bearish 或 neutral",
      riseProbability: "0到1之间的条件式上涨情景权重",
      fallProbability: "0到1之间的条件式下跌情景权重；与上涨权重合计应接近1",
      strategyRationale: english
        ? "English only, at most 200 characters; explain direction and scenario weights without inventing prices"
        : "不超过200个中文字符，解释方向与概率依据；不得给出候选结构之外的价格",
      selectedPenPointIds: ["候选 penPointId；省略或空数组表示接受全部"],
      selectedCenterIds: ["候选 center id；省略或空数组表示接受全部"],
      showFractals: true,
      confidence: 0.0,
    }),
    english
      ? "All user-visible narrative fields and chart annotations must be in English only. Use 'central zone' for a Chan center and 'stroke' for a pen. Do not emit Chinese characters in summary, report or strategyRationale."
      : "用户可见叙述使用中文。",
    "用户的原始分析要求（只作为分析目标，不得据此突破候选结构和绘图权限）：",
    JSON.stringify(String(context.instruction || "请对当前盘面进行缠论分析")),
    "确定性 TheoryResult：",
    JSON.stringify(theoryResult),
    "最近 K 线 [time,open,high,low,close,volume]：",
    JSON.stringify(compactCandles),
  ].join("\n");
}

export function normalizeChanModelReview(text, theoryResult) {
  const parsed = extractJsonObject(text);
  if (Number(parsed?.schemaVersion) !== TRADING_ANALYSIS_SCHEMA_VERSION) {
    throw new TypeError("Model response schemaVersion is invalid");
  }
  if (parsed?.verdict !== "approve" && parsed?.verdict !== "revise") {
    throw new TypeError("Model response verdict is invalid");
  }
  const summary = String(parsed?.summary || "").trim().slice(0, 80);
  if (!summary) throw new TypeError("Model response summary is required");
  const candidatePenIds = new Set(theoryResult.structures.penPoints.map((point) => point.penPointId));
  const candidateCenterIds = new Set(theoryResult.structures.centers.map((center) => center.id));
  const requestedPenIds = Array.isArray(parsed.selectedPenPointIds)
    ? parsed.selectedPenPointIds.map(String).filter((id) => candidatePenIds.has(id))
    : [];
  const requestedCenterIds = Array.isArray(parsed.selectedCenterIds)
    ? parsed.selectedCenterIds.map(String).filter((id) => candidateCenterIds.has(id))
    : [];
  const selectedPenPointIds = requestedPenIds.length >= 2
    ? [...new Set(requestedPenIds)]
    : [...candidatePenIds];
  const selectedCenterIds = requestedCenterIds.length
    ? [...new Set(requestedCenterIds)]
    : [...candidateCenterIds];
  const marketBias = ["bullish", "bearish", "neutral"].includes(parsed?.marketBias)
    ? parsed.marketBias
    : "neutral";
  const rawRiseProbability = Number(parsed?.riseProbability);
  const rawFallProbability = Number(parsed?.fallProbability);
  const probabilityTotal = rawRiseProbability + rawFallProbability;
  const hasProbabilities = Number.isFinite(rawRiseProbability)
    && Number.isFinite(rawFallProbability)
    && rawRiseProbability >= 0
    && rawFallProbability >= 0
    && probabilityTotal > 0;
  return {
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    verdict: parsed.verdict,
    summary,
    report: String(parsed?.report || "").replace(/\u0000/g, "").trim().slice(0, 6_000),
    selectedPenPointIds,
    selectedCenterIds,
    showFractals: parsed.showFractals !== false,
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
    marketBias,
    riseProbability: hasProbabilities ? rawRiseProbability / probabilityTotal : null,
    fallProbability: hasProbabilities ? rawFallProbability / probabilityTotal : null,
    strategyRationale: String(parsed?.strategyRationale || "").replace(/\u0000/g, "").trim().slice(0, 200),
  };
}

function formatReportPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const digits = Math.abs(number) >= 1_000 ? 2 : Math.abs(number) >= 1 ? 4 : 6;
  return number.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function formatReportTime(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return "—";
  return new Date(value * 1_000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function intervalReportLabel(interval) {
  const source = String(interval || "").toUpperCase();
  const match = /^(\d+)([DW]?)$/.exec(source);
  if (!match) return source;
  const amount = Number(match[1]);
  if (match[2] === "D") return `${amount}日`;
  if (match[2] === "W") return `${amount}周`;
  return amount % 60 === 0 ? `${amount / 60}小时` : `${amount}分钟`;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatReportPriceEnglish(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const digits = Math.abs(number) >= 1_000 ? 2 : Math.abs(number) >= 1 ? 4 : 6;
  return number.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function formatReportTimeEnglish(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return "—";
  return new Date(value * 1_000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function intervalReportLabelEnglish(interval) {
  const source = String(interval || "").toUpperCase();
  const match = /^(\d+)([DW]?)$/.exec(source);
  if (!match) return source;
  const amount = Number(match[1]);
  if (match[2] === "D") return `${amount}D`;
  if (match[2] === "W") return `${amount}W`;
  return amount % 60 === 0 ? `${amount / 60}H` : `${amount}M`;
}

function englishMarketLabel(marketId) {
  const value = String(marketId || "").trim();
  return value && !containsHanCharacters(value) ? value : "Current market";
}

function englishChanReviewNarrative(review, fallback) {
  const report = String(review?.report || "").replace(/\u0000/g, "").trim();
  if (report && !containsHanCharacters(report)) return report;
  const summary = String(review?.summary || "").replace(/\u0000/g, "").trim();
  if (summary && !containsHanCharacters(summary)) return summary;
  return fallback;
}

function buildChanEnglishAnalysisReport(snapshot, theoryResult, review, context = {}) {
  const candles = snapshot.candles;
  const first = candles[0];
  const latest = candles.at(-1);
  const penPoints = theoryResult.structures.penPoints;
  const centers = theoryResult.structures.centers;
  const latestPoint = penPoints.at(-1);
  const previousPoint = penPoints.at(-2);
  const latestCenter = centers.at(-1);
  const changePercent = first?.open
    ? ((latest.close - first.open) / first.open) * 100
    : 0;
  const segmentDirection = latestPoint && previousPoint
    ? latestPoint.price >= previousPoint.price ? "upward stroke" : "downward stroke"
    : "an unconfirmed terminal stroke";
  const centerText = latestCenter
    ? `The latest confirmed central zone is ${formatReportPriceEnglish(latestCenter.lower)}–${formatReportPriceEnglish(latestCenter.upper)}, formed from ${formatReportTimeEnglish(latestCenter.startTime)} to ${formatReportTimeEnglish(latestCenter.endTime)}.`
    : "No confirmed central zone meets the overlap requirement in this sample; confidence should remain lower.";
  const outlook = buildChanMarketOutlook(snapshot, theoryResult, review);
  const bias = outlook.bias === "偏多" ? "bullish" : outlook.bias === "偏空" ? "bearish" : "range-bound / neutral";
  const centerPosition = latestCenter
    ? latest.close > latestCenter.upper
      ? "above the latest central zone"
      : latest.close < latestCenter.lower
        ? "below the latest central zone"
        : "inside the latest central zone"
    : "without a confirmed central zone";
  const penDirection = latestPoint && previousPoint
    ? latestPoint.price >= previousPoint.price ? "up" : "down"
    : "unconfirmed";
  const momentumStart = candles.slice(-Math.min(48, candles.length))[0]?.open || latest.open;
  const recentReturn = momentumStart ? (latest.close - momentumStart) / momentumStart : 0;
  const modelFallback = `The deterministic review identifies ${segmentDirection}; the latest close is ${centerPosition}.`;
  const modelNarrative = englishChanReviewNarrative(review, modelFallback);
  const modelRationale = String(review?.strategyRationale || "").replace(/\u0000/g, "").trim();
  const rationale = modelRationale && !containsHanCharacters(modelRationale)
    ? ` Model review: ${modelRationale}`
    : "";
  const instruction = String(context.instruction || "").trim();
  const safeInstruction = instruction && !containsHanCharacters(instruction)
    ? `Requested analysis: ${instruction}`
    : "";
  const market = englishMarketLabel(snapshot.marketId);
  const interval = intervalReportLabelEnglish(snapshot.interval);
  return [
    `## ${market} · ${interval} Chan analysis`,
    safeInstruction,
    "",
    "### Data range",
    `This review uses ${candles.length} candles from ${formatReportTimeEnglish(first?.time)} to ${formatReportTimeEnglish(latest?.time)}. The opening price was ${formatReportPriceEnglish(first?.open)}, the latest close is ${formatReportPriceEnglish(latest?.close)}, and the change is ${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%.`,
    "",
    "### Chan structure",
    `The deterministic engine merged ${theoryResult.statistics.mergedCandleCount} of ${theoryResult.statistics.sourceCandleCount} source candles, identifying ${theoryResult.statistics.fractalCount} fractals, ${theoryResult.statistics.penPointCount} pen endpoints, and ${theoryResult.statistics.centerCount} central-zone candidates. The chart shows the latest ${penPoints.length} selected pen endpoints and ${centers.length} central zones.`,
    `The terminal structure is ${segmentDirection === "upward stroke" ? "an" : "a"} ${segmentDirection}; its latest endpoint is ${formatReportTimeEnglish(latestPoint?.time)} at ${formatReportPriceEnglish(latestPoint?.price)}. ${centerText}`,
    "",
    "### Overall assessment",
    modelNarrative,
    "",
    "### Current view and scenario weights",
    `The current structural bias is **${bias}**. With this ${interval} sample and the confirmed structure unchanged, the upside scenario weight is about ${outlook.risePercent}% and the downside scenario weight is about ${outlook.fallPercent}%.`,
    `Main basis: the latest stroke is ${penDirection}, the latest close is ${centerPosition}, and recent ${Math.min(48, candles.length)}-candle momentum is ${recentReturn >= 0 ? "positive" : "negative"}.${rationale}`,
    "These are heuristic scenario weights, not back-tested win rates. New candles, false breakouts, or structural reclassification can change them.",
    "",
    "### Conditional trading plan",
    `- **Long setup**: wait for a closed candle to hold above ${formatReportPriceEnglish(outlook.longTrigger)}, then consider a long only after a retest does not fall back below that level; structural invalidation is ${formatReportPriceEnglish(outlook.longInvalidation)}, with a first reference target at ${formatReportPriceEnglish(outlook.longTarget)}.`,
    `- **Short setup**: wait for a closed candle to hold below ${formatReportPriceEnglish(outlook.shortTrigger)}, then consider a short only after a rebound fails below that level; structural invalidation is ${formatReportPriceEnglish(outlook.shortInvalidation)}, with a first reference target at ${formatReportPriceEnglish(outlook.shortTarget)}.`,
    `- **Wait zone**: while price remains between ${formatReportPriceEnglish(outlook.shortTrigger)} and ${formatReportPriceEnglish(outlook.longTrigger)}, treat the market as range-bound and avoid chasing from the middle; a quick reclaim after either trigger is a false breakout.`,
    "- **Risk control**: use closed candles only, size from the invalidation distance and maximum tolerable loss, and account for leverage, funding, slippage, and liquidation risk on perpetual contracts.",
    "",
    "### Observation and invalidation",
    latestCenter
      ? `Watch whether price leaves the central zone ${formatReportPriceEnglish(latestCenter.lower)}–${formatReportPriceEnglish(latestCenter.upper)} with follow-through, and whether the move weakens or returns inside. A sustained return into the zone means the breakout direction is not confirmed.`
      : "Wait for additional closed candles to confirm new fractals, strokes, and an overlapping central zone; an incomplete structure can change with the next candle.",
    "This report separates structural identification from directional forecasting. It is not a return promise or an automatic trading instruction; unclosed candles, data coverage, and Chan conventions can invalidate tentative structures.",
  ].join("\n").replace(/\n{3,}/g, "\n\n");
}

function averageTrueRange(candles, period = 14) {
  const sample = candles.slice(-Math.max(2, period + 1));
  if (sample.length < 2) return 0;
  const ranges = [];
  for (let index = 1; index < sample.length; index += 1) {
    const candle = sample[index];
    const previousClose = sample[index - 1].close;
    ranges.push(Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    ));
  }
  return ranges.reduce((total, value) => total + value, 0) / ranges.length;
}

function nearestLevelAbove(price, levels) {
  const candidates = levels
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > price);
  return candidates.length ? Math.min(...candidates) : null;
}

function nearestLevelBelow(price, levels) {
  const candidates = levels
    .map(Number)
    .filter((value) => Number.isFinite(value) && value < price);
  return candidates.length ? Math.max(...candidates) : null;
}

export function buildChanMarketOutlook(snapshot, theoryResult, review = {}) {
  const candles = snapshot.candles;
  const latest = candles.at(-1);
  const recent = candles.slice(-Math.min(48, candles.length));
  const penPoints = theoryResult.structures.penPoints;
  const latestPoint = penPoints.at(-1);
  const previousPoint = penPoints.at(-2);
  const latestTop = [...penPoints].reverse().find((point) => point.type === "top");
  const latestBottom = [...penPoints].reverse().find((point) => point.type === "bottom");
  const latestCenter = theoryResult.structures.centers.at(-1);
  const recentResistance = Math.max(...recent.map((candle) => candle.high));
  const recentSupport = Math.min(...recent.map((candle) => candle.low));
  const atr = averageTrueRange(candles);
  const fallbackDistance = Math.max(atr, latest.close * 0.005);

  const longTrigger = nearestLevelAbove(latest.close, [
    latestCenter?.upper,
    latestTop?.price,
    recentResistance,
  ]) ?? Math.max(latest.high, recentResistance, latest.close + fallbackDistance);
  const shortTrigger = nearestLevelBelow(latest.close, [
    latestCenter?.lower,
    latestBottom?.price,
    recentSupport,
  ]) ?? Math.min(latest.low, recentSupport, latest.close - fallbackDistance);
  const longInvalidation = nearestLevelBelow(longTrigger, [
    latestCenter?.lower,
    latestBottom?.price,
    shortTrigger,
  ]) ?? longTrigger - fallbackDistance;
  const shortInvalidation = nearestLevelAbove(shortTrigger, [
    latestCenter?.upper,
    latestTop?.price,
    longTrigger,
  ]) ?? shortTrigger + fallbackDistance;
  const longRisk = Math.max(longTrigger - longInvalidation, fallbackDistance * 0.5);
  const shortRisk = Math.max(shortInvalidation - shortTrigger, fallbackDistance * 0.5);

  const momentumStart = recent[0]?.open || latest.open;
  const recentReturn = momentumStart ? (latest.close - momentumStart) / momentumStart : 0;
  const recentAverageClose = recent.reduce((total, candle) => total + candle.close, 0) / recent.length;
  let structureScore = clamp(recentReturn / 0.04, -1, 1) * 0.12;
  if (latestPoint && previousPoint) {
    structureScore += latestPoint.price >= previousPoint.price ? 0.08 : -0.08;
  }
  if (latestCenter) {
    const centerWidth = Math.max(latestCenter.upper - latestCenter.lower, Number.EPSILON);
    if (latest.close > latestCenter.upper) structureScore += 0.1;
    else if (latest.close < latestCenter.lower) structureScore -= 0.1;
    else structureScore += clamp(
      (latest.close - (latestCenter.lower + latestCenter.upper) / 2) / centerWidth,
      -0.5,
      0.5,
    ) * 0.1;
  }
  if (latest.close > recentAverageClose) structureScore += 0.04;
  else if (latest.close < recentAverageClose) structureScore -= 0.04;

  let riseProbability = 0.5 + structureScore;
  if (Number.isFinite(review.riseProbability) && Number.isFinite(review.fallProbability)) {
    riseProbability = riseProbability * 0.55 + Number(review.riseProbability) * 0.45;
  } else if (review.marketBias === "bullish") {
    riseProbability += 0.04;
  } else if (review.marketBias === "bearish") {
    riseProbability -= 0.04;
  }
  const confidence = clamp(Number(review.confidence) || 0, 0, 1);
  riseProbability = 0.5 + (riseProbability - 0.5) * (0.7 + confidence * 0.3);
  riseProbability = clamp(riseProbability, 0.25, 0.75);
  const risePercent = Math.round(riseProbability * 100);
  const fallPercent = 100 - risePercent;
  const bias = risePercent >= 56 ? "偏多" : risePercent <= 44 ? "偏空" : "震荡中性";
  const centerPosition = latestCenter
    ? latest.close > latestCenter.upper
      ? "位于最近中枢上方"
      : latest.close < latestCenter.lower
        ? "位于最近中枢下方"
        : "仍在最近中枢内部"
    : "尚无确认中枢";
  const penDirection = latestPoint && previousPoint
    ? latestPoint.price >= previousPoint.price ? "末笔向上" : "末笔向下"
    : "末笔方向待确认";

  return {
    bias,
    risePercent,
    fallPercent,
    longTrigger,
    shortTrigger,
    longInvalidation,
    shortInvalidation,
    longTarget: longTrigger + longRisk * 1.5,
    shortTarget: Math.max(Number.EPSILON, shortTrigger - shortRisk * 1.5),
    basis: `${penDirection}，最新收盘${centerPosition}，最近 ${recent.length} 根 K 线动量${recentReturn >= 0 ? "为正" : "为负"}`,
    modelRationale: String(review.strategyRationale || "").trim(),
  };
}

export function buildChanAnalysisReport(snapshot, theoryResult, review, context = {}) {
  if (context.language === "en") {
    return buildChanEnglishAnalysisReport(snapshot, theoryResult, review, context);
  }
  const candles = snapshot.candles;
  const first = candles[0];
  const latest = candles.at(-1);
  const penPoints = theoryResult.structures.penPoints;
  const centers = theoryResult.structures.centers;
  const latestPoint = penPoints.at(-1);
  const previousPoint = penPoints.at(-2);
  const latestCenter = centers.at(-1);
  const changePercent = first?.open
    ? ((latest.close - first.open) / first.open) * 100
    : 0;
  const segmentDirection = latestPoint && previousPoint
    ? latestPoint.price >= previousPoint.price ? "向上笔" : "向下笔"
    : "尚未形成可判断的末笔";
  const centerText = latestCenter
    ? `最近确认中枢区间为 ${formatReportPrice(latestCenter.lower)}–${formatReportPrice(latestCenter.upper)}，形成于 ${formatReportTime(latestCenter.startTime)} 至 ${formatReportTime(latestCenter.endTime)}。`
    : "当前样本尚未识别出满足重叠条件的确认中枢，走势判断应降低确定性。";
  const modelNarrative = review.report || review.summary;
  const outlook = buildChanMarketOutlook(snapshot, theoryResult, review);
  const instruction = String(context.instruction || "").trim();
  return [
    `## ${snapshot.marketId} · ${intervalReportLabel(snapshot.interval)}缠论分析`,
    instruction ? `分析要求：${instruction}` : "",
    "",
    "### 数据范围",
    `本次使用 ${candles.length} 根 K 线，时间范围 ${formatReportTime(first?.time)} 至 ${formatReportTime(latest?.time)}。区间开盘 ${formatReportPrice(first?.open)}，最新收盘 ${formatReportPrice(latest?.close)}，区间变动 ${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%。`,
    "",
    "### 缠论结构",
    `确定性引擎在原始 ${theoryResult.statistics.sourceCandleCount} 根 K 线中，合并后得到 ${theoryResult.statistics.mergedCandleCount} 根，识别 ${theoryResult.statistics.fractalCount} 个分型、${theoryResult.statistics.penPointCount} 个笔端点和 ${theoryResult.statistics.centerCount} 个中枢候选。本次画布展示最近 ${penPoints.length} 个已选笔端点和 ${centers.length} 个中枢。`,
    `当前末端结构为${segmentDirection}；最近笔端点位于 ${formatReportTime(latestPoint?.time)}、价格 ${formatReportPrice(latestPoint?.price)}。${centerText}`,
    "",
    "### 综合判断",
    modelNarrative,
    "",
    "### 当下行情判断与涨跌情景概率",
    `当前结构判断为**${outlook.bias}**。在本次 ${intervalReportLabel(snapshot.interval)} K 线样本和当前已确认结构不变的前提下，上涨情景权重约 ${outlook.risePercent}%，下跌情景权重约 ${outlook.fallPercent}%。`,
    `主要依据：${outlook.basis}。${outlook.modelRationale ? `模型复核补充：${outlook.modelRationale}` : ""}`,
    "上述概率是当前结构的启发式情景权重，不是经过历史回测校准的胜率；新 K 线、假突破或结构重构会使概率变化。",
    "",
    "### 条件交易计划",
    `- **多头方案**：等待本周期已收盘 K 线有效站上 ${formatReportPrice(outlook.longTrigger)}，并确认回踩不重新跌回该价位下方后再考虑做多；结构失效参考 ${formatReportPrice(outlook.longInvalidation)}，第一目标参考 ${formatReportPrice(outlook.longTarget)}。`,
    `- **空头方案**：等待本周期已收盘 K 线有效跌破 ${formatReportPrice(outlook.shortTrigger)}，并确认反抽无法重新站回该价位上方后再考虑做空；结构失效参考 ${formatReportPrice(outlook.shortInvalidation)}，第一目标参考 ${formatReportPrice(outlook.shortTarget)}。`,
    `- **观望条件**：价格仍处于 ${formatReportPrice(outlook.shortTrigger)}–${formatReportPrice(outlook.longTrigger)} 之间时，优先按震荡处理，不在区间中部追涨杀跌；若上下触发后很快收回区间，按假突破处理。`,
    "- **风险控制**：只使用已收盘 K 线确认，不把盘中瞬时刺破当成有效信号；仓位应以失效位对应的最大可承受亏损倒推，永续合约还需考虑杠杆、资金费率、滑点和强平风险。",
    "",
    "### 观察与失效条件",
    latestCenter
      ? `后续重点观察价格能否有效离开中枢 ${formatReportPrice(latestCenter.lower)}–${formatReportPrice(latestCenter.upper)}，以及离开后是否出现力度衰减或重新回到中枢。回到并持续停留在中枢内，应视为原离开方向尚未确认。`
      : "后续需要等待更多已收盘 K 线确认新的分型、笔和重叠区间；未完成结构可能随新 K 线变化。",
    "本报告区分结构识别与涨跌预测，不构成收益承诺或自动交易指令。未收盘 K 线、数据覆盖和缠论口径差异都可能使暂定结构发生变化。",
  ].join("\n").replace(/\n{3,}/g, "\n\n");
}

export function buildChanDrawingPatch(snapshot, theoryResult, review, context = {}) {
  const english = context.language === "en";
  const penIds = new Set(review.selectedPenPointIds);
  const centerIds = new Set(review.selectedCenterIds);
  const penPoints = theoryResult.structures.penPoints.filter((point) => penIds.has(point.penPointId));
  const centers = theoryResult.structures.centers.filter((center) => centerIds.has(center.id));
  if (penPoints.length < 2) throw new TypeError("The approved Chan drawing plan requires at least two pen points");
  const analysisId = `chan-analysis-${crypto.createHash("sha1")
    .update(JSON.stringify([snapshot.snapshotId, review]))
    .digest("hex")
    .slice(0, 18)}`;
  const operations = [{
    op: "upsert",
    drawing: {
      id: `${analysisId}-pens`,
      tool: "path",
      points: penPoints.map((point) => ({ time: point.time, price: point.price })),
      colorToken: "chan-pen",
      status: "confirmed",
      evidenceIds: penPoints.map((point) => point.penPointId),
    },
  }];
  for (const center of centers) {
    operations.push({
      op: "upsert",
      drawing: {
        id: `${analysisId}-${center.id}`,
        tool: "rectangle",
        points: [
          { time: center.startTime, price: center.upper },
          { time: center.endTime, price: center.lower },
        ],
        colorToken: "chan-center",
        status: "confirmed",
        evidenceIds: center.penPointIds,
      },
    });
  }
  if (review.showFractals) {
    for (const point of penPoints.slice(-10)) {
      operations.push({
        op: "upsert",
        drawing: {
          id: `${analysisId}-${point.id}`,
          tool: point.type === "top" ? "arrow-down" : "arrow-up",
          points: [{ time: point.time, price: point.price }],
          colorToken: point.type === "top" ? "chan-top" : "chan-bottom",
          status: "confirmed",
          evidenceIds: [point.penPointId],
        },
      });
    }
  }
  const latestPoint = penPoints.at(-1);
  const previousPoint = penPoints.at(-2);
  const referencePoint = penPoints.at(-3) ?? previousPoint;
  const latestCandle = snapshot.candles.at(-1);
  const latestCenter = centers.at(-1);
  const noteStatus = review.verdict === "approve" ? "confirmed" : "tentative";
  const penDirection = latestPoint.price >= previousPoint.price ? "向上" : "向下";
  const pointTypeLabel = (point) => point.type === "top" ? "顶分型" : "底分型";
  const englishDirection = latestPoint.price >= previousPoint.price ? "up" : "down";
  const englishPointType = (point) => point.type === "top" ? "top" : "bottom";
  const englishSummary = containsHanCharacters(review.summary)
    ? `Structure: latest stroke ${englishDirection}; close ${formatReportPrice(latestCandle.close)}${latestCenter ? ` ${latestCandle.close > latestCenter.upper ? "above" : latestCandle.close < latestCenter.lower ? "below" : "inside"} the central zone` : ""}.`
    : `Summary: ${review.summary}`;
  const annotations = [{
    id: "summary",
    point: { time: latestCandle.time, price: latestCandle.close },
    text: english ? englishSummary : `盘面结论：${review.summary}`,
    evidenceIds: [latestPoint.penPointId],
  }, {
    id: "latest-pen",
    point: { time: latestPoint.time, price: latestPoint.price },
    text: english
      ? `Latest ${englishDirection} stroke: ${formatReportPrice(previousPoint.price)} → ${formatReportPrice(latestPoint.price)}; confirmed ${englishPointType(latestPoint)} fractal.`
      : `末端${penDirection}笔：${formatReportPrice(previousPoint.price)} → ${formatReportPrice(latestPoint.price)}；最新确认为${pointTypeLabel(latestPoint)}。`,
    evidenceIds: [previousPoint.penPointId, latestPoint.penPointId],
  }, {
    id: "previous-fractal",
    point: { time: referencePoint.time, price: referencePoint.price },
    text: english
      ? `Prior ${englishPointType(referencePoint)} fractal ${formatReportPrice(referencePoint.price)} (${referencePoint === previousPoint ? "stroke origin" : "structure reference"}). ${englishDirection === "up" ? "Below the key low weakens the up structure" : "Above the key high weakens the down structure"}.`
      : `前序关键${pointTypeLabel(referencePoint)} ${formatReportPrice(referencePoint.price)}：${referencePoint === previousPoint ? "末笔起点" : "最近结构参照"}；${penDirection === "向上" ? "跌回关键低点下方则上行结构转弱" : "升回关键高点上方则下行结构转弱"}。`,
    evidenceIds: [referencePoint.penPointId, previousPoint.penPointId],
  }];
  if (latestCenter) {
    const centerPosition = latestCandle.close > latestCenter.upper
      ? "位于中枢上方"
      : latestCandle.close < latestCenter.lower
        ? "位于中枢下方"
        : "仍在中枢内部";
    annotations.splice(1, 0, {
      id: "latest-center",
      point: {
        time: latestCenter.startTime,
        price: (latestCenter.lower + latestCenter.upper) / 2,
      },
      text: english
        ? `Latest central zone ${formatReportPrice(latestCenter.lower)}–${formatReportPrice(latestCenter.upper)}; close ${latestCandle.close > latestCenter.upper ? "above" : latestCandle.close < latestCenter.lower ? "below" : "inside"} the zone. Watch the post-breakout retest.`
        : `最近中枢 ${formatReportPrice(latestCenter.lower)}–${formatReportPrice(latestCenter.upper)}：最新收盘${centerPosition}；关注离开后的回抽确认。`,
      evidenceIds: latestCenter.penPointIds,
    });
  }
  for (const annotation of annotations) {
    operations.push({
      op: "upsert",
      drawing: {
        id: `${analysisId}-note-${annotation.id}`,
        tool: "note",
        points: [annotation.point],
        text: annotation.text,
        colorToken: "chan-note",
        status: noteStatus,
        evidenceIds: annotation.evidenceIds,
      },
    });
  }
  return validateTradingDrawingPatch({
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    analysisId,
    baseRevision: 0,
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    operations,
  }, snapshot);
}

export async function runTradingChanAnalysisPipeline(params, options = {}) {
  const snapshot = normalizeTradingMarketSnapshot(params);
  const theoryResult = runChanTheoryEngine(snapshot, options.chanEngineOptions);
  if (theoryResult.status !== "succeeded") {
    const error = new Error("当前 K 线不足以形成可绘制的缠论笔结构");
    error.code = "TRADING_CHAN_INSUFFICIENT_DATA";
    throw error;
  }
  options.onTheoryReady?.({ stage: "deterministic_theory", strategyId: "chan", snapshotId: snapshot.snapshotId, candleCount: snapshot.candles.length, evidenceCount: Array.isArray(theoryResult.evidence) ? theoryResult.evidence.length : 0 });
  if (!options.modelRegistry || typeof options.modelRegistry.analyze !== "function") {
    throw new TypeError("modelRegistry is required");
  }
  const providerId = String(options.providerId || "").trim();
  const requestId = `chan-request-${crypto.randomUUID()}`;
  const modelRequest = {
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    requestId,
    task: "chan-theory-review-and-drawing-plan",
    theoryId: "chan",
    snapshotId: snapshot.snapshotId,
    prompt: buildChanModelPrompt(snapshot, theoryResult, {
      instruction: params?.instruction,
      responseMode: params?.responseMode,
      language: params?.language,
    }),
    responseFormat: "json",
  };
  const reviewed = await runValidatedTradingModelReview({
    modelRegistry: options.modelRegistry,
    providerId,
    request: modelRequest,
    signal: options.signal,
    theoryResult,
    validateResponse: (text) => normalizeChanModelReview(text, theoryResult),
  });
  const { modelResponse, review: modelReview } = reviewed;
  const actionPlan = buildChanMarketOutlook(snapshot, theoryResult, modelReview);
  const drawingPatch = buildChanDrawingPatch(snapshot, theoryResult, modelReview, { language: params?.language });
  const report = buildChanAnalysisReport(snapshot, theoryResult, modelReview, {
    instruction: params?.instruction,
    language: params?.language,
  });
  return {
    ok: true,
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    snapshot: {
      snapshotId: snapshot.snapshotId,
      marketId: snapshot.marketId,
      interval: snapshot.interval,
      snapshotTime: snapshot.snapshotTime,
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
      narrative: params?.responseMode === "direct"
        ? (modelReview.report || modelReview.summary)
        : modelReview.summary,
      report,
      actionPlan,
      confidence: modelReview.confidence,
      drawingPatch,
    },
    model: {
      providerId: modelResponse.providerId,
      modelId: modelResponse.modelId,
      requestId: modelResponse.requestId,
      latencyMs: modelResponse.latencyMs,
      usage: modelResponse.usage,
      finishReason: modelResponse.finishReason,
      reasoningEffort: reviewed.reasoningEffort,
      reviewAttempts: reviewed.attempts.length,
      escalationReason: reviewed.escalationReason,
    },
  };
}
