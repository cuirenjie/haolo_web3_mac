import crypto from "node:crypto";
import { runPriceActionEngine } from "./price-action-engine.mjs";
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

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const digits = Math.abs(number) >= 1_000 ? 2 : Math.abs(number) >= 1 ? 4 : 6;
  return number.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function formatTime(seconds) {
  const value = Number(seconds);
  return Number.isFinite(value)
    ? `${new Date(value * 1_000).toISOString().replace("T", " ").slice(0, 16)} UTC`
    : "—";
}

function intervalLabel(interval) {
  if (interval === "1D") return "日线";
  if (interval === "1W") return "周线";
  const minutes = Number(interval);
  if (!Number.isFinite(minutes)) return String(interval || "当前周期");
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60}小时` : `${minutes}分钟`;
}

function trendLabel(trend) {
  if (trend === "bullish") return "偏多";
  if (trend === "bearish") return "偏空";
  return "震荡等待";
}

function personalizedTradingSettings(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const numeric = (candidate, fallback, max = 100) => {
    const number = Number(candidate);
    return Number.isFinite(number) && number > 0 && number <= max ? number : fallback;
  };
  return {
    maxLossPerTradePercent: numeric(source.maxLossPerTradePercent, 2),
    minimumRiskRewardRatio: numeric(source.minimumRiskRewardRatio, 2),
    moveStopToBreakEven: source.moveStopToBreakEven !== false,
    breakEvenTriggerR: numeric(source.breakEvenTriggerR, 1),
    analysisStyle: source.analysisStyle === "detailed" ? "detailed" : "concise",
    requiredAnalysisSections: String(source.requiredAnalysisSections || "").trim().slice(0, 500),
    savedRules: (Array.isArray(source.entries) ? source.entries : [])
      .filter((entry) => entry?.scope?.startsWith?.("trading."))
      .slice(0, 16)
      .map((entry) => ({ scope: entry.scope, key: entry.key, value: entry.value })),
  };
}

export function buildPriceActionModelPrompt(snapshot, result, context = {}) {
  const directAnswer = context.responseMode === "direct";
  const preferences = personalizedTradingSettings(context.userRiskProfile);
  return [
    "你是交易分析系统的通用价格行为复核器，不负责直接操作界面，也不得套用或声称使用缠论、波浪、订单流、威科夫等某一种理论。",
    "确定性引擎已从用户当前左侧画布的真实 OHLCV 计算趋势、摆动高低点、支撑压力和条件价位。只可复核给定结果，不得创造新价格、时间或市场事实。",
    directAnswer
      ? "本次只刷新分析并回答用户的具体问题，不更新画布。answer 必须第一句直接作答，后续只写必要依据，不得套用完整盘面报告或固定章节。"
      : "本次需要生成完整盘面分析与受控绘图计划。",
    "输出必须是单个 JSON 对象，不要 Markdown 或 JSON 之外的文字。",
    JSON.stringify({
      schemaVersion: 1,
      verdict: "approve 或 revise",
      summary: "不超过80个中文字符，通俗说明等待、偏多或偏空条件",
      answer: directAnswer
        ? "直接回答用户本次问题的自然中文；结构和长短按问题决定，不用固定模板"
        : "可与 summary 相同",
      marketBias: "bullish、bearish 或 neutral",
      rationale: "不超过200个中文字符，只解释给定证据",
      confidence: 0,
    }),
    "用户要求：",
    JSON.stringify(String(context.instruction || "分析当前盘面")),
    "用户已保存的交易配置（所有仓位和计划建议必须遵守；与当前请求冲突时指出风险并给出合规备选）：",
    JSON.stringify(preferences),
    "确定性结果（价位只能引用 levels）：",
    JSON.stringify(result),
    "最近 K 线 [time,open,high,low,close,volume]：",
    JSON.stringify(snapshot.candles.slice(-120).map((candle) => [
      candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume,
    ])),
  ].join("\n");
}

export function normalizePriceActionModelReview(text) {
  const parsed = extractJsonObject(text);
  if (Number(parsed?.schemaVersion) !== TRADING_ANALYSIS_SCHEMA_VERSION) {
    throw new TypeError("Model response schemaVersion is invalid");
  }
  if (parsed?.verdict !== "approve" && parsed?.verdict !== "revise") {
    throw new TypeError("Model response verdict is invalid");
  }
  const summary = String(parsed?.summary || "").replace(/\u0000/g, "").trim().slice(0, 80);
  if (!summary) throw new TypeError("Model response summary is required");
  return {
    schemaVersion: 1,
    verdict: parsed.verdict,
    summary,
    answer: String(parsed?.answer || "").replace(/\u0000/g, "").trim().slice(0, 6_000),
    marketBias: ["bullish", "bearish", "neutral"].includes(parsed?.marketBias)
      ? parsed.marketBias
      : "neutral",
    rationale: String(parsed?.rationale || "").replace(/\u0000/g, "").trim().slice(0, 200),
    confidence: Math.min(1, Math.max(0, Number(parsed?.confidence) || 0)),
  };
}

export function buildPriceActionReport(snapshot, result, review, context = {}) {
  const candles = snapshot.candles;
  const first = candles[0];
  const latest = candles.at(-1);
  const levels = result.levels;
  const change = first.open ? ((latest.close - first.open) / first.open) * 100 : 0;
  const preferences = personalizedTradingSettings(context.userRiskProfile);
  const breakEvenText = preferences.moveStopToBreakEven
    ? `浮盈达到 ${preferences.breakEvenTriggerR}R 后，把止损移动至覆盖手续费和滑点的保本位置。`
    : "按你的偏好，不自动移动保本，继续执行原止损管理方式。";
  return [
    `## ${snapshot.marketId} · ${intervalLabel(snapshot.interval)}盘面分析`,
    context.instruction ? `你的要求：${String(context.instruction).trim()}` : "",
    "",
    "### 先看结论",
    `当前更接近**${trendLabel(result.trend)}**。${review.summary}`,
    `价格在 ${formatPrice(levels.shortTrigger)}–${formatPrice(levels.longTrigger)} 之间时，先按震荡处理，不在区间中间追涨杀跌。`,
    "",
    "### 新手执行清单",
    `- **想做多**：等本周期 K 线收盘站上 ${formatPrice(levels.longTrigger)}，最好回踩不破后再考虑；第一目标 ${formatPrice(levels.longTarget)}，跌回 ${formatPrice(levels.longInvalidation)} 下方则取消多头方案。`,
    `- **想做空**：等本周期 K 线收盘跌破 ${formatPrice(levels.shortTrigger)}，最好反抽站不回后再考虑；第一目标 ${formatPrice(levels.shortTarget)}，重新站上 ${formatPrice(levels.shortInvalidation)} 则取消空头方案。`,
    `- **继续等待**：还在 ${formatPrice(levels.waitZone.lower)}–${formatPrice(levels.waitZone.upper)} 内，或突破后很快收回区间，就当成信号未确认。`,
    `- **控制风险**：单笔止损后的实际亏损不得超过当前账户净值的 ${preferences.maxLossPerTradePercent}%；计算时包含手续费和预估滑点，再按入场价到取消价的距离倒推仓位。`,
    `- **盈亏与保本**：最低净盈亏比为 ${preferences.minimumRiskRewardRatio}:1。${breakEvenText}`,
    "",
    "### 为什么这样判断",
    `本次读取左侧画布的 ${candles.length} 根 ${intervalLabel(snapshot.interval)} K 线，范围 ${formatTime(first.time)} 至 ${formatTime(latest.time)}；区间变化 ${change >= 0 ? "+" : ""}${change.toFixed(2)}%。`,
    `短期均价约 ${formatPrice(result.indicators.ema20)}，中期均价约 ${formatPrice(result.indicators.ema50)}，最近动量 ${(result.indicators.recentReturn * 100).toFixed(2)}%，当前量能约为近期均值的 ${result.indicators.volumeRatio.toFixed(2)} 倍。`,
    review.rationale ? `模型复核补充：${review.rationale}` : "",
    `当前上涨/下跌情景权重约 ${result.riseWeight}% / ${result.fallWeight}%。这是基于当前结构的启发式权重，不是历史回测胜率。`,
    "",
    "### 数据与风险",
    "分析以发送消息时左侧已选择的品种、周期和可见 K 线为准；新 K 线会改变支撑、压力和方向判断。未收盘 K 线、跳空、滑点、资金费率和突发消息都会使计划失效。本内容不构成收益承诺或自动下单指令。",
  ].filter(Boolean).join("\n").replace(/\n{3,}/g, "\n\n");
}

export function buildPriceActionDrawingPatch(snapshot, result, review) {
  const analysisId = `price-action-${crypto.createHash("sha1")
    .update(JSON.stringify([snapshot.snapshotId, result.levels, review]))
    .digest("hex")
    .slice(0, 18)}`;
  const firstTime = snapshot.candles[Math.max(0, snapshot.candles.length - 48)].time;
  const lastTime = snapshot.candles.at(-1).time;
  const pathPivots = result.pivots.slice(-7);
  const trendPoints = pathPivots.length >= 2
    ? pathPivots.map((pivot) => ({ time: pivot.time, price: pivot.price }))
    : [
        { time: firstTime, price: snapshot.candles[Math.max(0, snapshot.candles.length - 48)].close },
        { time: lastTime, price: result.levels.currentPrice },
      ];
  const status = review.verdict === "approve" ? "confirmed" : "tentative";
  const operations = [
    {
      op: "upsert",
      drawing: {
        id: `${analysisId}-trend`,
        theory: "price-action",
        tool: "path",
        points: trendPoints,
        colorToken: "price-action-trend",
        status,
        evidenceIds: pathPivots.map((pivot) => pivot.id),
      },
    },
    {
      op: "upsert",
      drawing: {
        id: `${analysisId}-resistance`,
        theory: "price-action",
        tool: "path",
        points: [{ time: firstTime, price: result.levels.resistance }, { time: lastTime, price: result.levels.resistance }],
        colorToken: "price-action-resistance",
        status: "confirmed",
        evidenceIds: ["resistance"],
      },
    },
    {
      op: "upsert",
      drawing: {
        id: `${analysisId}-support`,
        theory: "price-action",
        tool: "path",
        points: [{ time: firstTime, price: result.levels.support }, { time: lastTime, price: result.levels.support }],
        colorToken: "price-action-support",
        status: "confirmed",
        evidenceIds: ["support"],
      },
    },
    {
      op: "upsert",
      drawing: {
        id: `${analysisId}-summary`,
        theory: "price-action",
        tool: "note",
        points: [{ time: lastTime, price: result.levels.currentPrice }],
        text: `结论：${trendLabel(result.trend)}；上破 ${formatPrice(result.levels.longTrigger)} 偏多，跌破 ${formatPrice(result.levels.shortTrigger)} 偏空`,
        colorToken: "price-action-note",
        status,
        evidenceIds: ["trend", "support", "resistance"],
      },
    },
    {
      op: "upsert",
      drawing: {
        id: `${analysisId}-resistance-note`,
        theory: "price-action",
        tool: "note",
        points: [{ time: firstTime, price: result.levels.resistance }],
        text: `上方压力 ${formatPrice(result.levels.resistance)}：收盘站稳后再考虑偏多`,
        colorToken: "price-action-resistance",
        status: "confirmed",
        evidenceIds: ["resistance"],
      },
    },
    {
      op: "upsert",
      drawing: {
        id: `${analysisId}-support-note`,
        theory: "price-action",
        tool: "note",
        points: [{ time: firstTime, price: result.levels.support }],
        text: `下方支撑 ${formatPrice(result.levels.support)}：收盘跌破后再考虑偏空`,
        colorToken: "price-action-support",
        status: "confirmed",
        evidenceIds: ["support"],
      },
    },
  ];
  return validateTradingDrawingPatch({
    schemaVersion: 1,
    analysisId,
    baseRevision: 0,
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    operations,
  }, snapshot);
}

export async function runTradingPriceActionAnalysisPipeline(params, options = {}) {
  const snapshot = normalizeTradingMarketSnapshot(params);
  const theoryResult = runPriceActionEngine(snapshot);
  if (!options.modelRegistry || typeof options.modelRegistry.analyze !== "function") {
    throw new TypeError("modelRegistry is required");
  }
  const providerId = String(options.providerId || "").trim();
  const requestId = `price-action-request-${crypto.randomUUID()}`;
  const modelResponse = await options.modelRegistry.analyze(providerId, {
    schemaVersion: 1,
    requestId,
    task: "price-action-review-and-drawing-plan",
    theoryId: "price_action",
    snapshotId: snapshot.snapshotId,
    prompt: buildPriceActionModelPrompt(snapshot, theoryResult, {
      instruction: params?.instruction,
      responseMode: params?.responseMode,
      userRiskProfile: params?.userRiskProfile,
    }),
    responseFormat: "json",
  }, { signal: options.signal });
  const modelReview = normalizePriceActionModelReview(modelResponse.text);
  const drawingPatch = buildPriceActionDrawingPatch(snapshot, theoryResult, modelReview);
  const report = buildPriceActionReport(snapshot, theoryResult, modelReview, {
    instruction: params?.instruction,
    userRiskProfile: params?.userRiskProfile,
  });
  return {
    ok: true,
    schemaVersion: 1,
    snapshot: {
      snapshotId: snapshot.snapshotId,
      marketId: snapshot.marketId,
      interval: snapshot.interval,
      snapshotTime: snapshot.snapshotTime,
      inputHash: snapshot.inputHash,
    },
    theoryResult,
    analysisPlan: {
      schemaVersion: 1,
      analysisId: drawingPatch.analysisId,
      revision: 0,
      snapshotId: snapshot.snapshotId,
      marketId: snapshot.marketId,
      interval: snapshot.interval,
      narrative: params?.responseMode === "direct"
        ? (modelReview.answer || modelReview.summary)
        : modelReview.summary,
      report,
      confidence: modelReview.confidence,
      actionPlan: theoryResult.levels,
      drawingPatch,
    },
    model: {
      providerId: modelResponse.providerId,
      modelId: modelResponse.modelId,
      requestId: modelResponse.requestId,
      latencyMs: modelResponse.latencyMs,
      usage: modelResponse.usage,
      finishReason: modelResponse.finishReason,
    },
  };
}
