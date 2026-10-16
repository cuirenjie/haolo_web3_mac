import { completeTradingModelProse } from "./model-output-language.mjs";
import { localizeTradingAnalysisResult, tradingReportText, withTradingReportLanguage } from "./report-language.mjs";
import crypto from "node:crypto";
import { runOrderFlowTheoryEngine } from "./order-flow-engine.mjs";
import { runValidatedTradingModelReview } from "./model-review.mjs";
import {
  fuseIctSmcWithOrderFlow,
  runIctSmcTheoryEngine,
} from "./ict-smc-engine.mjs";
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

function compactOrderFlowTheoryResultForModel(snapshot, theoryResult) {
  const marketStructure = theoryResult.marketStructure;
  const marketCandidateIds = new Set(marketStructure?.drawingCandidateIds || []);
  const marketCandidates = marketStructure
    ? [...smcCandidateMap(marketStructure).values()].filter((candidate) => marketCandidateIds.has(candidate.id))
    : [];
  return {
    schemaVersion: theoryResult.schemaVersion,
    resultId: theoryResult.resultId,
    engineId: theoryResult.engineId,
    engineVersion: theoryResult.engineVersion,
    snapshotId: theoryResult.snapshotId,
    status: theoryResult.status,
    coverage: theoryResult.coverage,
    confidence: theoryResult.confidence,
    statistics: theoryResult.statistics,
    structures: {
      pointOfControl: theoryResult.structures.pointOfControl,
      cumulativeDelta: theoryResult.structures.cumulativeDelta.slice(-40),
      clusters: theoryResult.structures.clusters,
      imbalanceClusters: theoryResult.structures.imbalanceClusters,
      pressureEvents: theoryResult.structures.pressureEvents,
      depthSnapshot: theoryResult.structures.depthSnapshot,
    },
    signals: theoryResult.signals,
    missingData: theoryResult.missingData,
    actionLevels: buildOrderFlowActionPlan(snapshot, theoryResult),
    marketStructure: marketStructure ? {
      engineId: marketStructure.engineId,
      engineVersion: marketStructure.engineVersion,
      status: marketStructure.status,
      confidence: marketStructure.confidence,
      statistics: marketStructure.statistics,
      currentBias: marketStructure.currentBias,
      timeframes: marketStructure.timeframes.map((timeframe) => ({
        interval: timeframe.interval,
        label: timeframe.label,
        role: timeframe.role,
        candleCount: timeframe.candleCount,
        currentBias: timeframe.currentBias,
        statistics: timeframe.statistics,
      })),
      drawingCandidateIds: marketStructure.drawingCandidateIds,
      candidates: marketCandidates,
      orderFlowConfirmation: marketStructure.orderFlowConfirmation,
    } : null,
  };
}

export function buildOrderFlowModelPrompt(snapshot, theoryResult, context = {}) {
  const directAnswer = context.responseMode === "direct";
  const english = context.language === "en";
  const compactCandles = snapshot.candles.slice(-80).map((candle) => [
    candle.time,
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume,
  ]);
  return [
    english
      ? "You are the order-flow and ICT/SMC market-structure reviewer in a trading analysis system. You never operate the UI directly."
      : "你是交易分析系统中的订单流与 ICT/SMC 市场结构复核器，不负责直接操作界面。",
    english
      ? "The deterministic order-flow engine computed CVD/Delta, volume clusters, POC, depth imbalance, and large aggressive trades from real trades, depth snapshots, and available open interest. The independent ICT/SMC engine generated BOS, CHoCH, MSS, OB, FVG, Breaker, EQ, OTE, BSL/SSL, and Sweep candidates from multi-timeframe OHLCV."
      : "确定性订单流引擎已从真实主动成交、盘口深度快照和可用持仓量计算 CVD/Delta、量价簇、POC、盘口失衡和大额主动成交；独立 ICT/SMC 引擎已从多周期 OHLCV 生成 BOS、CHoCH、MSS、OB、FVG、Breaker、EQ、OTE、BSL/SSL 与 Sweep 候选。",
    english
      ? "Review only the supplied candidate IDs, deterministic actionLevels, and coverage. Never invent structures, trades, prices, times, depth, liquidations, open interest, or other facts outside the candidates. Real order flow may confirm only structure events covered by its micro data window; historical OB/FVG items remain OHLCV market-structure facts. State any unavailable data explicitly."
      : "请只复核给定候选 ID、确定性 actionLevels 与覆盖状态，不得创造候选之外的结构、逐笔、价位、时间、盘口、爆仓、持仓量或交易事实。真实订单流只能确认其微观数据窗口覆盖的结构事件；历史 OB/FVG 等仍属于 OHLCV 市场结构。数据标记 unavailable 时必须明确缺失。",
    directAnswer
      ? (english ? "Answer the user's specific question directly and do not update the canvas. The report must answer in its first sentence and include only necessary evidence; do not use the full report template or fixed headings." : "本次只刷新分析并回答用户的具体问题，不更新画布。report 必须第一句直接作答，后续只写必要依据，不得套用完整盘面报告或固定章节。")
      : (english ? "The host generates the complete report and controlled drawings from deterministic facts. Return candidate choices, a concise summary and strategyRationale; leave report empty and do not repeat the full report." : "完整报告与受控绘图由宿主根据确定性事实生成。你只需返回候选取舍、简短 summary 和 strategyRationale；report 必须为空字符串，不要重复撰写完整报告。"),
    english
      ? "Write all user-facing summary, report, and strategyRationale text in natural English. Explain each specialist term briefly on first use. State the price that confirms a bullish bias, the price that confirms a bearish bias, the pullback area to watch, and the no-trade range. Require candle-close confirmation, controlled per-trade risk, and never encourage chasing a move."
      : "面向用户必须先说人话和条件：价格上破哪个确定性价位后偏多、跌破哪个价位后偏空、回踩哪个区域可观察止跌、什么区间内不交易。每个专业术语首次出现时用一句普通中文解释，避免连续罗列缩写；给新手的建议必须等待本周期收盘确认、控制单笔风险且不得鼓励追涨杀跌。",
    english
      ? "Output exactly one JSON object, with no Markdown or text outside JSON."
      : "输出必须是单个 JSON 对象，不要 Markdown，不要解释 JSON 之外的内容。",
    "JSON 协议：",
    JSON.stringify({
      schemaVersion: 1,
      verdict: "approve 或 revise",
      summary: english ? "A concise conclusion in complete English sentences. Prefer waiting, bullish, or bearish conditions; do not promise returns." : "不超过80个中文字符的通俗结论，优先描述等待、偏多或偏空条件，不得堆砌术语或承诺收益",
      report: directAnswer
        ? (english ? "A direct natural-English answer; prices may only come from actionLevels." : "直接回答用户本次问题的自然中文；价格只能引用 actionLevels，结构和长短按问题决定")
        : "",
      marketBias: "buying、selling 或 neutral",
      strategyRationale: "不超过200个中文字符，只解释候选证据和确认/失效条件",
      selectedClusterIds: ["最多选择两个最重要的 cluster id；空数组表示接受确定性推荐"],
      selectedPressureEventIds: ["最多选择两个最重要的 pressure event id；空数组表示接受确定性推荐"],
      selectedMarketStructureIds: ["只能选择 marketStructure.drawingCandidateIds 中最关键的候选 id；即使提供多个也会被确定性绘图预算再次精简"],
      showPointOfControl: true,
      showDealingRange: true,
      showLiquidity: true,
      confidence: 0.0,
    }),
    "用户的原始分析要求（只作为分析目标，不得据此突破候选结构和绘图权限）：",
    JSON.stringify(String(context.instruction || "请对当前盘面进行订单流分析")),
    "确定性 TheoryResult（已聚合，不包含原始逐笔和完整盘口）：",
    JSON.stringify(compactOrderFlowTheoryResultForModel(snapshot, theoryResult)),
    "最近 K 线 [time,open,high,low,close,volume]：",
    JSON.stringify(compactCandles),
  ].join("\n");
}

export function normalizeOrderFlowModelReview(text, theoryResult) {
  const parsed = extractJsonObject(text);
  if (Number(parsed?.schemaVersion) !== TRADING_ANALYSIS_SCHEMA_VERSION) {
    throw new TypeError("Model response schemaVersion is invalid");
  }
  if (parsed?.verdict !== "approve" && parsed?.verdict !== "revise") {
    throw new TypeError("Model response verdict is invalid");
  }
  const summary = completeTradingModelProse(parsed?.summary, "summary", 2_000);
  if (!summary) throw new TypeError("Model response summary is required");
  const candidateClusterIds = new Set(
    theoryResult.structures.imbalanceClusters.map((cluster) => cluster.id),
  );
  const candidatePressureEventIds = new Set(
    theoryResult.structures.pressureEvents.map((event) => event.id),
  );
  const requestedClusterIds = Array.isArray(parsed.selectedClusterIds)
    ? parsed.selectedClusterIds.map(String).filter((id) => candidateClusterIds.has(id))
    : [];
  const requestedPressureEventIds = Array.isArray(parsed.selectedPressureEventIds)
    ? parsed.selectedPressureEventIds.map(String).filter((id) => candidatePressureEventIds.has(id))
    : [];
  const candidateMarketStructureIds = new Set(theoryResult.marketStructure?.drawingCandidateIds || []);
  const requestedMarketStructureIds = Array.isArray(parsed.selectedMarketStructureIds)
    ? parsed.selectedMarketStructureIds.map(String).filter((id) => candidateMarketStructureIds.has(id))
    : [];
  const clusterPool = requestedClusterIds.length
    ? theoryResult.structures.imbalanceClusters.filter((cluster) => requestedClusterIds.includes(cluster.id))
    : theoryResult.structures.imbalanceClusters;
  const pressurePool = requestedPressureEventIds.length
    ? theoryResult.structures.pressureEvents.filter((event) => requestedPressureEventIds.includes(event.id))
    : theoryResult.structures.pressureEvents;
  const marketPoolIds = requestedMarketStructureIds.length
    ? [...new Set([...requestedMarketStructureIds, ...candidateMarketStructureIds])]
    : [...candidateMarketStructureIds];
  return {
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    verdict: parsed.verdict,
    summary,
    report: completeTradingModelProse(parsed?.report, "report", 24_000),
    marketBias: ["buying", "selling", "neutral"].includes(parsed?.marketBias)
      ? parsed.marketBias
      : "neutral",
    strategyRationale: completeTradingModelProse(parsed?.strategyRationale, "strategyRationale", 2_000),
    selectedClusterIds: clusterPool
      .slice()
      .sort((first, second) => (
        Math.abs(second.imbalanceRatio) * second.quantity
        - Math.abs(first.imbalanceRatio) * first.quantity
      ))
      .slice(0, 2)
      .map((cluster) => cluster.id),
    selectedPressureEventIds: pressurePool
      .slice()
      .sort((first, second) => second.notional - first.notional || second.time - first.time)
      .slice(0, 2)
      .map((event) => event.id),
    selectedMarketStructureIds: selectImportantMarketStructureIds(theoryResult, marketPoolIds),
    showPointOfControl: parsed.showPointOfControl !== false,
    showDealingRange: parsed.showDealingRange !== false,
    showLiquidity: parsed.showLiquidity !== false,
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
  };
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const digits = Math.abs(number) >= 1_000 ? 2 : Math.abs(number) >= 1 ? 4 : 6;
  return number.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function formatQuantity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number >= 0 ? "+" : ""}${(number * 100).toFixed(2)}%`;
}

function orderFlowCandleSpacing(candles) {
  const differences = candles
    .slice(-16)
    .map((candle, index, entries) => index ? candle.time - entries[index - 1].time : 0)
    .filter((difference) => Number.isFinite(difference) && difference > 0)
    .sort((first, second) => first - second);
  return differences.length ? differences[Math.floor(differences.length / 2)] : 60;
}

export function orderFlowMicroDrawingWindow(snapshot) {
  const candles = Array.isArray(snapshot?.candles) ? snapshot.candles : [];
  const orderFlow = snapshot?.orderFlow;
  const trades = Array.isArray(orderFlow?.trades) ? orderFlow.trades : [];
  if (!candles.length || !trades.length) return null;
  const spacing = orderFlowCandleSpacing(candles);
  const chartStart = candles[0].time;
  const chartEnd = candles.at(-1).time + spacing;
  const windowStart = Number(orderFlow.windowStart || trades[0]?.time);
  const windowEnd = Number(orderFlow.windowEnd || trades.at(-1)?.time);
  if (
    !Number.isFinite(windowStart)
    || !Number.isFinite(windowEnd)
    || windowEnd < chartStart
    || windowStart > chartEnd
  ) {
    return null;
  }
  const targetTime = Math.min(chartEnd, Math.max(chartStart, windowEnd));
  let candleIndex = candles.length - 1;
  while (candleIndex > 0 && candles[candleIndex].time > targetTime) candleIndex -= 1;
  const barStart = candles[candleIndex].time;
  const nextTime = candles[candleIndex + 1]?.time || barStart + spacing;
  const barSpan = Math.max(1, nextTime - barStart);
  return {
    barStart,
    barSpan,
    anchorTime: barStart,
    lineStart: barStart,
    lineEnd: nextTime,
  };
}

function orderFlowEvidenceGroups(items) {
  const groups = new Map();
  for (const item of items) {
    const side = item.side === "buy" ? "buy" : "sell";
    const group = groups.get(side) || [];
    group.push(item);
    groups.set(side, group);
  }
  return [...groups.entries()].map(([side, evidence]) => ({ side, evidence }));
}

function formatTime(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "—";
  return new Date(value * 1_000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function plainIntervalLabel(interval) {
  if (interval === "1D") return tradingReportText("日线");
  if (interval === "1W") return tradingReportText("周线");
  const minutes = Number(interval);
  if (!Number.isFinite(minutes)) return String(interval || tradingReportText("当前周期"));
  if (minutes >= 60 && minutes % 60 === 0) return tradingReportText("{0}小时", minutes / 60);
  return tradingReportText("{0}分钟", minutes);
}

function coverageLabel(status) {
  if (status === "available") return tradingReportText("可用");
  if (status === "partial") return tradingReportText("部分覆盖");
  if (status === "delayed") return tradingReportText("延迟");
  return tradingReportText("不可用");
}

function orderFlowDirectionLabel(direction) {
  if (direction === "buying_pressure") return tradingReportText("主动买方占优");
  if (direction === "selling_pressure") return tradingReportText("主动卖方占优");
  return tradingReportText("主动买卖暂时均衡");
}

function smcDirectionLabel(direction) {
  if (direction === "bullish") return tradingReportText("看涨");
  if (direction === "bearish") return tradingReportText("看跌");
  return tradingReportText("中性");
}

function smcStateLabel(state) {
  return ({
    active: tradingReportText("有效"),
    mitigated: tradingReportText("已回踩"),
    invalidated: tradingReportText("已失效"),
    open: tradingReportText("未触及"),
    partial: tradingReportText("部分回补"),
    filled: tradingReportText("已回补"),
    swept: tradingReportText("已扫并收回"),
    consumed: tradingReportText("已消耗"),
    confirmed: tradingReportText("已确认"),
  })[state] || String(state || tradingReportText("未知"));
}

function marketStructureReportLines(theoryResult) {
  const marketStructure = theoryResult.marketStructure;
  if (!marketStructure || marketStructure.status !== "succeeded") {
    return [tradingReportText("当前 K 线没有形成足够的 ICT/SMC 确定性结构，本轮不输出 OB、FVG 或流动性标签。")];
  }
  const structures = marketStructure.structures;
  const timeframeSummary = marketStructure.timeframes.map((timeframe) => (
    `${timeframe.label}（${timeframe.role === "execution" ? tradingReportText("执行周期") : tradingReportText("上下文周期")}）${smcDirectionLabel(timeframe.currentBias)}：`
    + tradingReportText("{0} 个结构突破、{1} 个 OB、", timeframe.statistics.structureEventCount, timeframe.statistics.orderBlockCount)
    + tradingReportText("{0} 个 FVG、{1} 个流动性池。", timeframe.statistics.fairValueGapCount, timeframe.statistics.liquidityPoolCount)
  )).join("\n");
  const latestEvents = structures.structureEvents.slice(-5).map((event) => (
    `${event.interval} ${event.kind} ${event.direction === "bullish" ? "↑" : "↓"} @ ${formatPrice(event.pivotPrice)}`
    + `${event.displacement.confirmed ? tradingReportText("（位移确认）") : ""}`
    + `${event.orderFlowConfirmation && event.orderFlowConfirmation !== "not_covered" ? tradingReportText("，订单流 {0}", event.orderFlowConfirmation) : ""}`
  ));
  const zones = [
    ...structures.orderBlocks.filter((block) => block.state !== "invalidated").slice(0, 4).map((block) => (
      `${block.interval} ${smcDirectionLabel(block.side)} OB ${formatPrice(block.lower)}–${formatPrice(block.upper)}（${smcStateLabel(block.state)}）`
    )),
    ...structures.fairValueGaps.filter((gap) => gap.state === "open" || gap.state === "partial").slice(0, 4).map((gap) => (
      `${gap.interval} ${smcDirectionLabel(gap.side)} FVG ${formatPrice(gap.lower)}–${formatPrice(gap.upper)}（${smcStateLabel(gap.state)}）`
    )),
  ];
  const liquidity = structures.liquidityPools.slice(0, 5).map((pool) => (
    tradingReportText("{0} {1}{2} {3}（{4} 次触及，{5}）", pool.interval, pool.side, pool.side === "BSL" ? "/EQH" : "/EQL", formatPrice(pool.price), pool.touchCount, smcStateLabel(pool.state))
  ));
  const ranges = structures.dealingRanges.map((range) => (
    `${range.interval} Dealing Range ${formatPrice(range.low)}–${formatPrice(range.high)}，`
    + `EQ ${formatPrice(range.equilibrium)}，OTE ${formatPrice(range.ote.lower)}–${formatPrice(range.ote.upper)}。`
  ));
  const confirmation = marketStructure.orderFlowConfirmation;
  return [
    timeframeSummary,
    latestEvents.length ? tradingReportText("最近结构事件：{0}。", latestEvents.join("；")) : tradingReportText("没有已确认 BOS/CHoCH/MSS。"),
    zones.length ? tradingReportText("当前重点区域：{0}。", zones.join("；")) : tradingReportText("没有仍有效或部分回补的 OB/FVG 区域。"),
    liquidity.length ? tradingReportText("流动性：{0}。", liquidity.join("；")) : tradingReportText("没有达到容差和触及次数要求的 BSL/SSL。"),
    ...ranges,
    confirmation
      ? tradingReportText("结构与当前真实订单流关系：{0}。{1}", confirmation.state, confirmation.note)
      : tradingReportText("本轮未形成结构与真实订单流的可比较关系。"),
  ];
}

export function buildOrderFlowAnalysisReport(snapshot, theoryResult, review, context = {}) {
  if (context.language === "en") return buildOrderFlowAnalysisReportEnglish(snapshot, theoryResult, review, context);
  const stats = theoryResult.statistics;
  const coverage = theoryResult.coverage;
  const poc = theoryResult.structures.pointOfControl;
  const depth = theoryResult.structures.depthSnapshot;
  const instruction = String(context.instruction || "").trim();
  const durationSeconds = Math.max(0, Number(stats.windowEnd) - Number(stats.windowStart));
  const action = buildOrderFlowActionPlan(snapshot, theoryResult);
  const flowSummary = stats.direction === "buying_pressure"
    ? tradingReportText("最近这段真实成交里，主动买单比主动卖单多 {0}", formatPercent(Math.abs(stats.deltaRatio)))
    : stats.direction === "selling_pressure"
      ? tradingReportText("最近这段真实成交里，主动卖单比主动买单多 {0}", formatPercent(Math.abs(stats.deltaRatio)))
      : tradingReportText("最近这段真实成交里，买卖双方暂时接近平衡");
  const timeframeSummary = theoryResult.marketStructure?.timeframes?.map((timeframe) => (
    `${timeframe.label}${timeframe.currentBias === "bullish" ? tradingReportText("偏多") : timeframe.currentBias === "bearish" ? tradingReportText("偏空") : tradingReportText("横盘")}`
  )).join("、") || tradingReportText("暂无可靠的大周期方向");
  const insidePullbackZone = action.pullbackBuyZone
    && action.currentPrice >= action.pullbackBuyZone.lower
    && action.currentPrice <= action.pullbackBuyZone.upper;
  const insideReboundZone = action.reboundSellZone
    && action.currentPrice >= action.reboundSellZone.lower
    && action.currentPrice <= action.reboundSellZone.upper;
  const pullbackLine = action.pullbackBuyZone
    ? insidePullbackZone
      ? tradingReportText("回调观察：当前已进入 {0}–{1} 支撑区，必须先出现止跌和主动买单重新占优，不能直接抄底。", formatPrice(action.pullbackBuyZone.lower), formatPrice(action.pullbackBuyZone.upper))
      : tradingReportText("回调观察：价格回到 {0}–{1} 后止跌，并重新出现主动买单占优时，才考虑小仓位试多。", formatPrice(action.pullbackBuyZone.lower), formatPrice(action.pullbackBuyZone.upper))
    : tradingReportText("回调观察：当前没有足够清晰的支撑区，不建议因为价格下跌就直接抄底。");
  const reboundLine = action.reboundSellZone
    ? insideReboundZone
      ? tradingReportText("反弹观察：当前已进入 {0}–{1} 压力区，必须先看到冲高受阻和主动卖单重新占优，不能直接做空。", formatPrice(action.reboundSellZone.lower), formatPrice(action.reboundSellZone.upper))
      : tradingReportText("反弹观察：价格反弹到 {0}–{1} 后受阻，并重新出现主动卖单占优时，才考虑偏空方案。", formatPrice(action.reboundSellZone.lower), formatPrice(action.reboundSellZone.upper))
    : tradingReportText("反弹观察：当前没有足够清晰的压力区，不建议只因短线冲高就直接做空。");
  return [
    tradingReportText("## {0} · 订单流交易计划", snapshot.marketId),
    instruction ? tradingReportText("分析要求：{0}", instruction) : "",
    "",
    tradingReportText("### 先看结论"),
    tradingReportText("当前价格约 {0}。{1}，但只有离开下面的等待区才算方向确认。", formatPrice(action.currentPrice), flowSummary),
    tradingReportText("- **上破 {0} 后偏多**：等待当前 {1} K 线收盘站稳该价位，同时主动买单继续占优；第一关注目标 {2}。若随后跌回 {3} 下方，多头方案取消。", formatPrice(action.longTrigger), plainIntervalLabel(snapshot.interval), formatPrice(action.longTarget), formatPrice(action.shortTrigger)),
    tradingReportText("- **跌破 {0} 后偏空**：等待当前 {1} K 线收盘确认，同时主动卖单继续占优；第一关注目标 {2}。若随后重新站上 {3}，空头方案取消。", formatPrice(action.shortTrigger), plainIntervalLabel(snapshot.interval), formatPrice(action.shortTarget), formatPrice(action.longTrigger)),
    tradingReportText("- **{0}–{1} 之间先等待**：这里方向没有确认，追涨和抄底都容易来回止损。", formatPrice(action.shortTrigger), formatPrice(action.longTrigger)),
    `- ${pullbackLine}`,
    `- ${reboundLine}`,
    "",
    tradingReportText("### 新手执行清单"),
    tradingReportText("1. 不在区间中间猜方向，只等 K 线收盘确认关键价位。"),
    tradingReportText("2. 突破后如果下一根 K 线马上收回区间，按假突破处理，不追单。"),
    tradingReportText("3. 单笔预设亏损建议控制在账户的 0.5%–1%，止损触发后不补仓摊平。"),
    tradingReportText("4. 永续合约优先低杠杆或不用杠杆；第一目标到达后可分批止盈，而不是等待一次卖在最高点。"),
    "",
    tradingReportText("### 为什么这样看（通俗版）"),
    tradingReportText("- {0}；主要成交密集价约 {1}，可把它理解为短线多空反复争夺的成本区。", flowSummary, formatPrice(poc?.price)),
    tradingReportText("- 盘口前 {0} 档目前{1}，差异约 {2}；挂单随时可能撤走，所以只作辅助确认。", Math.floor(depth.levelCount / 2), stats.depthImbalanceRatio >= 0 ? tradingReportText("买单相对更多") : tradingReportText("卖单相对更多"), formatPercent(Math.abs(stats.depthImbalanceRatio))),
    tradingReportText("- 多周期价格结构：{0}。图上只保留最近的趋势转折、主要支撑/压力和上下方止损集中区。", timeframeSummary),
    stats.openInterestChangeRatio == null
      ? tradingReportText("- 持仓量没有完整的起止序列，本轮不据此判断新增资金方向。")
      : tradingReportText("- 持仓量变化 {0}，只作辅助，不单独作为开仓理由。", formatPercent(stats.openInterestChangeRatio)),
    "",
    tradingReportText("### 数据说明（可跳过）"),
    tradingReportText("本次读取 {0} 笔真实聚合成交，覆盖 {1} 至 {2}，约 {3} 秒；主动成交 {4}、盘口 {5}、持仓量 {6}、爆仓数据 {7}。", stats.tradeCount, formatTime(stats.windowStart), formatTime(stats.windowEnd), durationSeconds.toFixed(0), coverageLabel(coverage.trades), coverageLabel(coverage.depth), coverageLabel(coverage.openInterest), coverageLabel(coverage.liquidations)),
    tradingReportText("图上的订单区、缺口和结构突破来自 K 线市场结构；只有最近真实成交窗口与事件重叠时，订单流才可用于确认。盘口是 REST 快照，不是完整增量队列。"),
    "",
    tradingReportText("### 风险说明"),
    tradingReportText("关键价位会随新 K 线和订单流变化而重算。以上是条件式观察方案，不是保证成交、保证盈利或经过历史校准的涨跌概率。"),
  ].join("\n").replace(/\n{3,}/g, "\n\n");
}

function buildOrderFlowAnalysisReportEnglish(snapshot, theoryResult, review, context = {}) {
  const stats = theoryResult.statistics;
  const coverage = theoryResult.coverage;
  const poc = theoryResult.structures.pointOfControl;
  const depth = theoryResult.structures.depthSnapshot;
  const action = buildOrderFlowActionPlan(snapshot, theoryResult);
  const durationSeconds = Math.max(0, Number(stats.windowEnd) - Number(stats.windowStart));
  const flowSummary = stats.direction === "buying_pressure"
    ? `Recent aggressive trades show buyers ahead by ${formatPercent(Math.abs(stats.deltaRatio))}`
    : stats.direction === "selling_pressure"
      ? `Recent aggressive trades show sellers ahead by ${formatPercent(Math.abs(stats.deltaRatio))}`
      : "Recent aggressive buying and selling are roughly balanced";
  const timeframeSummary = theoryResult.marketStructure?.timeframes?.map((timeframe) => (
    `${timeframe.label} ${timeframe.currentBias === "bullish" ? "bullish" : timeframe.currentBias === "bearish" ? "bearish" : "range-bound"}`
  )).join(", ") || "no reliable higher-timeframe bias";
  const pullback = action.pullbackBuyZone
    ? `Pullback watch: after price returns to ${formatPrice(action.pullbackBuyZone.lower)}–${formatPrice(action.pullbackBuyZone.upper)}, wait for a hold and renewed buying pressure before considering a small long.`
    : "Pullback watch: no clear support zone is available; do not buy simply because price fell.";
  const rebound = action.reboundSellZone
    ? `Rebound watch: after price reaches ${formatPrice(action.reboundSellZone.lower)}–${formatPrice(action.reboundSellZone.upper)}, wait for rejection and renewed selling pressure before considering a short.`
    : "Rebound watch: no clear resistance zone is available; do not short simply because price rose.";
  return [
    `## ${snapshot.marketId} · Order-flow trading plan`,
    context.instruction ? `Request: ${context.instruction}` : "",
    "",
    "### Outlook",
    `Current price is about ${formatPrice(action.currentPrice)}. ${flowSummary}. Direction is confirmed only outside the waiting range.`,
    `- **Bullish above ${formatPrice(action.longTrigger)}**: wait for the current ${plainIntervalLabelEnglish(snapshot.interval)} candle to close above it while buying pressure remains dominant. First target: ${formatPrice(action.longTarget)}. A move back below ${formatPrice(action.shortTrigger)} cancels the bullish plan.`,
    `- **Bearish below ${formatPrice(action.shortTrigger)}**: wait for a confirming close below it while selling pressure remains dominant. First target: ${formatPrice(action.shortTarget)}. A move back above ${formatPrice(action.longTrigger)} cancels the bearish plan.`,
    `- **Wait between ${formatPrice(action.shortTrigger)} and ${formatPrice(action.longTrigger)}**: direction is unconfirmed; chasing breakouts or buying dips here is prone to whipsaws.`,
    `- ${pullback}`,
    `- ${rebound}`,
    "",
    "### Beginner checklist",
    "1. Do not guess in the middle of the range; wait for a candle close beyond a key level.",
    "2. If the next candle closes back inside the range, treat the move as a false breakout and do not chase it.",
    "3. Keep planned loss per trade around 0.5%–1% of account equity; do not average down after a stop.",
    "4. Prefer low or no leverage on perpetuals. Consider taking partial profit at the first target instead of trying to exit at the exact high or low.",
    "",
    "### Why this view",
    `- ${flowSummary}; the point of control is about ${formatPrice(poc?.price)}, a short-term area where both sides have traded heavily.`,
    `- The first ${Math.floor(depth.levelCount / 2)} depth levels show relatively more ${stats.depthImbalanceRatio >= 0 ? "buy" : "sell"} orders (about ${formatPercent(Math.abs(stats.depthImbalanceRatio))}); orders can be cancelled, so this is supporting evidence only.`,
    `- Multi-timeframe structure: ${timeframeSummary}. The chart keeps only recent shifts, major support/resistance, and liquidity zones above and below price.`,
    stats.openInterestChangeRatio == null
      ? "- Open interest lacks a complete start/end sequence, so it is not used to infer new directional positioning."
      : `- Open interest changed by ${formatPercent(stats.openInterestChangeRatio)}; supporting evidence only, never a standalone entry reason.`,
    "",
    "### Data notes",
    `Read ${stats.tradeCount} real aggregate trades from ${formatTime(stats.windowStart)} to ${formatTime(stats.windowEnd)} (${durationSeconds.toFixed(0)} seconds). Trades: ${coverageLabelEnglish(coverage.trades)}; depth: ${coverageLabelEnglish(coverage.depth)}; open interest: ${coverageLabelEnglish(coverage.openInterest)}; liquidations: ${coverageLabelEnglish(coverage.liquidations)}.`,
    "Chart order zones, gaps, and structure breaks come from OHLCV market structure. Order flow confirms a structure only when its real-trade window overlaps the event. Depth is a REST snapshot, not a complete incremental queue.",
    "",
    "### Risk",
    "Key levels are recalculated as new candles and order flow arrive. This is a conditional observation plan, not a promise of execution, profit, or calibrated probability.",
  ].join("\n").replace(/\n{3,}/g, "\n\n");
}

function plainIntervalLabelEnglish(interval) {
  if (interval === "1D") return "daily";
  if (interval === "1W") return "weekly";
  const minutes = Number(interval);
  if (!Number.isFinite(minutes)) return String(interval || "current");
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}H`;
  return `${minutes}m`;
}

function coverageLabelEnglish(status) {
  return ({ available: "available", partial: "partial", delayed: "delayed", unavailable: "unavailable" })[status] || "unavailable";
}

function smcCandidateMap(marketStructure) {
  const structures = marketStructure?.structures || {};
  const candidates = [
    ...(structures.structureEvents || []),
    ...(structures.fairValueGaps || []),
    ...(structures.orderBlocks || []),
    ...(structures.breakers || []),
    ...(structures.liquidityPools || []),
    ...(structures.sweeps || []),
    ...(structures.dealingRanges || []),
  ];
  return new Map(candidates.map((candidate) => [candidate.id, candidate]));
}

function candidateTime(candidate) {
  return Number(
    candidate.breakTime
    || candidate.createdTime
    || candidate.originTime
    || candidate.time
    || candidate.endTime
    || candidate.startTime
    || 0,
  );
}

function zoneDistance(candidate, currentPrice) {
  if (!Number.isFinite(currentPrice)) return Number.POSITIVE_INFINITY;
  if (currentPrice < candidate.lower) return candidate.lower - currentPrice;
  if (currentPrice > candidate.upper) return currentPrice - candidate.upper;
  return 0;
}

function selectImportantMarketStructureIds(theoryResult, allowedIds) {
  const marketStructure = theoryResult.marketStructure;
  if (!marketStructure || marketStructure.status !== "succeeded") return [];
  const lookup = smcCandidateMap(marketStructure);
  const allowed = new Set(allowedIds || marketStructure.drawingCandidateIds || []);
  const candidates = [...allowed].map((id) => lookup.get(id)).filter(Boolean);
  const executionInterval = marketStructure.timeframes.find((timeframe) => timeframe.role === "execution")?.interval;
  const currentPrice = Number(
    theoryResult.statistics.lastTradePrice
    || theoryResult.structures.depthSnapshot?.midPrice
    || 0,
  );
  const selected = [];
  const seen = new Set();
  const add = (candidate) => {
    if (!candidate?.id || seen.has(candidate.id) || selected.length >= 9) return;
    seen.add(candidate.id);
    selected.push(candidate);
  };
  const eventPriority = { MSS: 3, CHoCH: 2, BOS: 1 };
  const events = candidates
    .filter((candidate) => eventPriority[candidate.kind])
    .sort((first, second) => (
      Number(second.interval === executionInterval) - Number(first.interval === executionInterval)
      || eventPriority[second.kind] - eventPriority[first.kind]
      || Number(Boolean(second.displacement?.confirmed)) - Number(Boolean(first.displacement?.confirmed))
      || candidateTime(second) - candidateTime(first)
    ));
  events.slice(0, 2).forEach(add);

  const validZoneStates = new Set(["active", "mitigated", "open", "partial", "confirmed"]);
  const zones = candidates.filter((candidate) => (
    (candidate.kind === "OB" || candidate.kind === "FVG" || candidate.kind === "Breaker")
    && validZoneStates.has(candidate.state)
  ));
  const rankZones = (side) => zones
    .filter((candidate) => candidate.side === side)
    .sort((first, second) => {
      const firstWrongSide = side === "bullish"
        ? Number(first.lower > currentPrice)
        : Number(first.upper < currentPrice);
      const secondWrongSide = side === "bullish"
        ? Number(second.lower > currentPrice)
        : Number(second.upper < currentPrice);
      return firstWrongSide - secondWrongSide
        || zoneDistance(first, currentPrice) - zoneDistance(second, currentPrice)
        || Number(second.interval === executionInterval) - Number(first.interval === executionInterval)
        || candidateTime(second) - candidateTime(first);
    });
  add(rankZones("bullish")[0]);
  add(rankZones("bearish")[0]);
  add(zones
    .slice()
    .sort((first, second) => (
      Number(second.interval === executionInterval) - Number(first.interval === executionInterval)
      || zoneDistance(first, currentPrice) - zoneDistance(second, currentPrice)
      || candidateTime(second) - candidateTime(first)
    ))
    .find((candidate) => !seen.has(candidate.id)));

  const openLiquidity = candidates.filter((candidate) => (
    (candidate.kind === "BSL" || candidate.kind === "SSL") && candidate.state === "open"
  ));
  const above = openLiquidity
    .filter((candidate) => candidate.kind === "BSL" && candidate.price > currentPrice)
    .sort((first, second) => first.price - second.price || candidateTime(second) - candidateTime(first));
  const below = openLiquidity
    .filter((candidate) => candidate.kind === "SSL" && candidate.price < currentPrice)
    .sort((first, second) => second.price - first.price || candidateTime(second) - candidateTime(first));
  add(above[0]);
  add(below[0]);

  add(candidates
    .filter((candidate) => candidate.kind === "Sweep")
    .sort((first, second) => candidateTime(second) - candidateTime(first))
    [0]);
  add(candidates
    .filter((candidate) => candidate.kind === "DealingRange")
    .sort((first, second) => (
      Number(second.interval === executionInterval) - Number(first.interval === executionInterval)
      || candidateTime(second) - candidateTime(first)
    ))
    [0]);
  return selected.map((candidate) => candidate.id);
}

function nearestAbove(values, currentPrice) {
  return values
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > currentPrice * 1.00005)
    .sort((first, second) => first - second)[0] ?? null;
}

function nearestBelow(values, currentPrice) {
  return values
    .map(Number)
    .filter((value) => Number.isFinite(value) && value < currentPrice * 0.99995)
    .sort((first, second) => second - first)[0] ?? null;
}

export function buildOrderFlowActionPlan(snapshot, theoryResult) {
  const latestCandle = snapshot.candles.at(-1);
  const currentPrice = Number(latestCandle?.close || theoryResult.statistics.lastTradePrice || 0);
  const marketStructure = theoryResult.marketStructure;
  const structures = marketStructure?.structures || {};
  const execution = marketStructure?.timeframes?.find((timeframe) => timeframe.role === "execution");
  const atr = Number(execution?.statistics?.atr || 0);
  const recentClosed = snapshot.candles.slice(Math.max(0, snapshot.candles.length - 31), -1);
  const recentHigh = recentClosed.length ? Math.max(...recentClosed.map((candle) => candle.high)) : null;
  const recentLow = recentClosed.length ? Math.min(...recentClosed.map((candle) => candle.low)) : null;
  const zoneStates = new Set(["active", "mitigated", "open", "partial", "confirmed"]);
  const zones = [
    ...(structures.orderBlocks || []),
    ...(structures.fairValueGaps || []),
    ...(structures.breakers || []),
  ].filter((candidate) => zoneStates.has(candidate.state));
  const nearestZone = (side) => zones
    .filter((candidate) => candidate.side === side)
    .sort((first, second) => {
      const firstWrongSide = side === "bullish" ? Number(first.lower > currentPrice) : Number(first.upper < currentPrice);
      const secondWrongSide = side === "bullish" ? Number(second.lower > currentPrice) : Number(second.upper < currentPrice);
      return firstWrongSide - secondWrongSide || zoneDistance(first, currentPrice) - zoneDistance(second, currentPrice);
    })[0] || null;
  const supportZone = nearestZone("bullish");
  const resistanceZone = nearestZone("bearish");
  const events = structures.structureEvents || [];
  const ranges = (structures.dealingRanges || []).filter((range) => range.interval === snapshot.interval);
  const executionRange = ranges.at(-1) || (structures.dealingRanges || []).at(-1) || null;
  const bsl = (structures.liquidityPools || []).filter((pool) => pool.kind === "BSL" && pool.state === "open");
  const ssl = (structures.liquidityPools || []).filter((pool) => pool.kind === "SSL" && pool.state === "open");
  const longTriggerCandidates = [
    recentHigh,
    executionRange?.high,
    resistanceZone?.upper,
    ...events.map((event) => event.pivotPrice),
  ];
  const shortTriggerCandidates = [
    recentLow,
    executionRange?.low,
    supportZone?.lower,
    ...events.map((event) => event.pivotPrice),
  ];
  const fallbackDistance = Math.max(atr * 0.35, currentPrice * 0.0015, Number.EPSILON);
  const minimumTriggerDistance = Math.max(atr * 0.2, currentPrice * 0.0005, Number.EPSILON);
  const longTrigger = nearestAbove(longTriggerCandidates, currentPrice + minimumTriggerDistance)
    ?? currentPrice + fallbackDistance;
  const shortTrigger = nearestBelow(shortTriggerCandidates, currentPrice - minimumTriggerDistance)
    ?? currentPrice - fallbackDistance;
  const minimumTargetDistance = Math.max(atr * 0.4, currentPrice * 0.001, Number.EPSILON);
  const longTarget = nearestAbove([
    ...bsl.map((pool) => pool.price),
    executionRange?.high,
    resistanceZone?.upper,
    recentHigh,
    ...events.map((event) => event.pivotPrice),
  ], longTrigger + minimumTargetDistance) ?? longTrigger + Math.max(minimumTargetDistance, fallbackDistance);
  const shortTarget = nearestBelow([
    ...ssl.map((pool) => pool.price),
    executionRange?.low,
    supportZone?.lower,
    recentLow,
    ...events.map((event) => event.pivotPrice),
  ], shortTrigger - minimumTargetDistance) ?? shortTrigger - Math.max(minimumTargetDistance, fallbackDistance);
  return {
    currentPrice,
    longTrigger,
    longTarget,
    longInvalidation: shortTrigger,
    shortTrigger,
    shortTarget,
    shortInvalidation: longTrigger,
    waitZone: { lower: shortTrigger, upper: longTrigger },
    pullbackBuyZone: supportZone ? { lower: supportZone.lower, upper: supportZone.upper } : null,
    reboundSellZone: resistanceZone ? { lower: resistanceZone.lower, upper: resistanceZone.upper } : null,
    confirmation: "等待当前 K 线周期收盘站稳/跌破，并要求主动成交方向同步",
  };
}

function structureColorToken(direction) {
  return direction === "bullish" ? "order-flow-structure-bull" : "order-flow-structure-bear";
}

function zoneColorToken(kind, side) {
  if (kind === "FVG") return side === "bullish" ? "order-flow-fvg-bull" : "order-flow-fvg-bear";
  return side === "bullish" ? "order-flow-ob-bull" : "order-flow-ob-bear";
}

function smcTimeframeLabel(candidate) {
  if (candidate.interval === "1D" || candidate.interval === "1W") return candidate.interval;
  const minutes = Number(candidate.interval);
  if (Number.isFinite(minutes) && minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}H`;
  return Number.isFinite(minutes) ? `${minutes}m` : String(candidate.interval || "");
}

function smcCandidateOperations(analysisId, candidate, latestTime, review) {
  const timeframe = smcTimeframeLabel(candidate);
  if (candidate.kind === "BOS" || candidate.kind === "CHoCH" || candidate.kind === "MSS") {
    const token = structureColorToken(candidate.direction);
    const direction = candidate.direction === "bullish" ? "多" : "空";
    const label = candidate.kind === "BOS"
      ? `[${timeframe}] ${candidate.direction === "bullish" ? "上破关键高点" : "跌破关键低点"}（BOS）`
      : `[${timeframe}] 趋势转${direction}（${candidate.kind}）`;
    return [{
      op: "upsert",
      drawing: {
        id: `${analysisId}-${candidate.id}`,
        theory: "order-flow",
        tool: "path",
        points: [
          { time: candidate.pivotTime, price: candidate.pivotPrice },
          { time: candidate.breakTime, price: candidate.pivotPrice },
        ],
        colorToken: token,
        status: "confirmed",
        evidenceIds: [candidate.id, candidate.pivotId],
      },
    }, {
      op: "upsert",
      drawing: {
        id: `${analysisId}-${candidate.id}-label`,
        theory: "order-flow",
        tool: "note",
        points: [{ time: candidate.breakTime, price: candidate.pivotPrice }],
        text: label,
        colorToken: token,
        status: "confirmed",
        evidenceIds: [candidate.id],
      },
    }];
  }
  if (candidate.kind === "OB" || candidate.kind === "Breaker" || candidate.kind === "FVG") {
    const token = zoneColorToken(candidate.kind, candidate.side);
    const startTime = candidate.originTime || candidate.createdTime || candidate.startTime;
    const zoneEnd = Math.max(candidate.endTime || latestTime, latestTime);
    const direction = candidate.side === "bullish" ? "支撑" : "压力";
    const plainKind = candidate.kind === "FVG"
      ? candidate.side === "bullish" ? "回调缺口" : "反弹缺口"
      : candidate.kind === "Breaker" ? "关键反转区" : "主要订单区";
    return [{
      op: "upsert",
      drawing: {
        id: `${analysisId}-${candidate.id}`,
        theory: "order-flow",
        tool: "rectangle",
        points: [
          { time: startTime, price: candidate.upper },
          { time: zoneEnd, price: candidate.lower },
        ],
        colorToken: token,
        status: candidate.status === "tentative" ? "tentative" : "confirmed",
        evidenceIds: [candidate.id, candidate.breakEventId, candidate.sourceOrderBlockId].filter(Boolean),
      },
    }, {
      op: "upsert",
      drawing: {
        id: `${analysisId}-${candidate.id}-label`,
        theory: "order-flow",
        tool: "note",
        points: [{ time: startTime, price: candidate.upper }],
        text: `[${timeframe}] ${direction}：${plainKind}（${candidate.kind}）`,
        colorToken: token,
        status: candidate.status === "tentative" ? "tentative" : "confirmed",
        evidenceIds: [candidate.id],
      },
    }];
  }
  if (candidate.kind === "BSL" || candidate.kind === "SSL") {
    if (!review.showLiquidity) return [];
    const token = "order-flow-liquidity";
    return [{
      op: "upsert",
      drawing: {
        id: `${analysisId}-${candidate.id}`,
        theory: "order-flow",
        tool: "path",
        points: [
          { time: candidate.startTime, price: candidate.price },
          { time: Math.max(candidate.endTime, candidate.startTime + 1), price: candidate.price },
        ],
        colorToken: token,
        status: candidate.state === "open" ? "tentative" : "confirmed",
        evidenceIds: [candidate.id, ...(candidate.pivotIds || [])],
      },
    }, {
      op: "upsert",
      drawing: {
        id: `${analysisId}-${candidate.id}-label`,
        theory: "order-flow",
        tool: "note",
        points: [{ time: candidate.endTime, price: candidate.price }],
        text: candidate.kind === "BSL"
          ? `[${timeframe}] 上方止损集中区（BSL）`
          : `[${timeframe}] 下方止损集中区（SSL）`,
        colorToken: token,
        status: candidate.state === "open" ? "tentative" : "confirmed",
        evidenceIds: [candidate.id],
      },
    }];
  }
  if (candidate.kind === "Sweep") {
    if (!review.showLiquidity) return [];
    const token = structureColorToken(candidate.direction);
    return [{
      op: "upsert",
      drawing: {
        id: `${analysisId}-${candidate.id}`,
        theory: "order-flow",
        tool: candidate.direction === "bullish" ? "arrow-up" : "arrow-down",
        points: [{ time: candidate.time, price: candidate.price }],
        colorToken: token,
        status: "confirmed",
        evidenceIds: [candidate.id, candidate.liquidityPoolId],
      },
    }, {
      op: "upsert",
      drawing: {
        id: `${analysisId}-${candidate.id}-label`,
        theory: "order-flow",
        tool: "note",
        points: [{ time: candidate.time, price: candidate.price }],
        text: candidate.direction === "bullish"
          ? `[${timeframe}] 扫低后收回（Sweep）`
          : `[${timeframe}] 扫高后回落（Sweep）`,
        colorToken: token,
        status: "confirmed",
        evidenceIds: [candidate.id],
      },
    }];
  }
  if (candidate.kind === "DealingRange") {
    if (!review.showDealingRange) return [];
    return [{
      op: "upsert",
      drawing: {
        id: `${analysisId}-${candidate.id}-eq`,
        theory: "order-flow",
        tool: "path",
        points: [
          { time: candidate.startTime, price: candidate.equilibrium },
          { time: Math.max(candidate.endTime, candidate.startTime + 1), price: candidate.equilibrium },
        ],
        colorToken: "order-flow-equilibrium",
        status: "confirmed",
        evidenceIds: [candidate.id],
      },
    }, {
      op: "upsert",
      drawing: {
        id: `${analysisId}-${candidate.id}-eq-label`,
        theory: "order-flow",
        tool: "note",
        points: [{ time: candidate.endTime, price: candidate.equilibrium }],
        text: `[${timeframe}] EQ 50%`,
        colorToken: "order-flow-equilibrium",
        status: "confirmed",
        evidenceIds: [candidate.id],
      },
    }, {
      op: "upsert",
      drawing: {
        id: `${analysisId}-${candidate.id}-ote`,
        theory: "order-flow",
        tool: "rectangle",
        points: [
          { time: candidate.impulseEndTime, price: candidate.ote.upper },
          { time: Math.max(candidate.endTime, candidate.impulseEndTime + 1), price: candidate.ote.lower },
        ],
        colorToken: "order-flow-ote",
        status: "tentative",
        evidenceIds: [candidate.id],
      },
    }, {
      op: "upsert",
      drawing: {
        id: `${analysisId}-${candidate.id}-ote-label`,
        theory: "order-flow",
        tool: "note",
        points: [{ time: candidate.impulseEndTime, price: candidate.ote.upper }],
        text: `[${timeframe}] OTE 0.618–0.786`,
        colorToken: "order-flow-ote",
        status: "tentative",
        evidenceIds: [candidate.id],
      },
    }];
  }
  return [];
}

function buildMarketStructureDrawingOperations(analysisId, snapshot, theoryResult, review) {
  const marketStructure = theoryResult.marketStructure;
  if (!marketStructure || marketStructure.status !== "succeeded") return [];
  const lookup = smcCandidateMap(marketStructure);
  const operations = [];
  for (const id of review.selectedMarketStructureIds) {
    const candidate = lookup.get(id);
    if (!candidate) continue;
    const candidateOperations = smcCandidateOperations(
      analysisId,
      candidate,
      snapshot.candles.at(-1).time,
      review,
    );
    if (operations.length + candidateOperations.length > 20) break;
    operations.push(...candidateOperations);
  }
  return operations;
}

export function buildOrderFlowDrawingPatch(snapshot, theoryResult, review) {
  const clusterIds = new Set(review.selectedClusterIds);
  const pressureEventIds = new Set(review.selectedPressureEventIds);
  const clusters = theoryResult.structures.imbalanceClusters
    .filter((cluster) => clusterIds.has(cluster.id))
    .slice(0, 2);
  const pressureEvents = theoryResult.structures.pressureEvents
    .filter((event) => pressureEventIds.has(event.id))
    .slice(0, 2);
  const poc = theoryResult.structures.pointOfControl;
  const microWindow = orderFlowMicroDrawingWindow(snapshot);
  const analysisId = `order-flow-analysis-${crypto.createHash("sha1")
    .update(JSON.stringify([snapshot.snapshotId, review]))
    .digest("hex")
    .slice(0, 18)}`;
  const operations = buildMarketStructureDrawingOperations(analysisId, snapshot, theoryResult, review);
  if (microWindow && poc && review.showPointOfControl) {
    operations.push({
      op: "upsert",
      drawing: {
        id: `${analysisId}-${poc.id}`,
        theory: "order-flow",
        tool: "path",
        points: [
          { time: microWindow.lineStart, price: poc.price },
          { time: microWindow.lineEnd, price: poc.price },
        ],
        colorToken: "order-flow-poc",
        status: "confirmed",
        evidenceIds: [poc.id],
      },
    });
    operations.push({
      op: "upsert",
      drawing: {
        id: `${analysisId}-${poc.id}-label`,
        theory: "order-flow",
        tool: "note",
        points: [{ time: microWindow.anchorTime, price: poc.price }],
        text: tradingReportText("成交密集价（POC）{0}", formatPrice(poc.price)),
        colorToken: "order-flow-poc",
        status: "confirmed",
        evidenceIds: [poc.id],
      },
    });
  }
  for (const { side, evidence } of microWindow ? orderFlowEvidenceGroups(clusters) : []) {
    const upper = Math.max(...evidence.map((cluster) => cluster.upper));
    const lower = Math.min(...evidence.map((cluster) => cluster.lower));
    const evidenceIds = evidence.map((cluster) => cluster.id);
    const label = side === "buy" ? tradingReportText("主动买入失衡区") : tradingReportText("主动卖出失衡区");
    for (const cluster of evidence) {
      operations.push({
        op: "upsert",
        drawing: {
          id: `${analysisId}-${cluster.id}`,
          theory: "order-flow",
          tool: "rectangle",
          points: [
            { time: microWindow.lineStart, price: cluster.upper },
            { time: microWindow.lineEnd, price: cluster.lower },
          ],
          colorToken: side === "buy" ? "order-flow-buy" : "order-flow-sell",
          status: "confirmed",
          evidenceIds: [cluster.id],
        },
      });
    }
    operations.push({
      op: "upsert",
      drawing: {
        id: `${analysisId}-micro-cluster-${side}-label`,
        theory: "order-flow",
        tool: "note",
        points: [{ time: microWindow.anchorTime, price: side === "buy" ? upper : lower }],
        text: evidence.length > 1 ? tradingReportText("{0}（{1}处）", label, evidence.length) : label,
        colorToken: side === "buy" ? "order-flow-buy" : "order-flow-sell",
        status: "confirmed",
        evidenceIds,
      },
    });
  }
  for (const { side, evidence } of microWindow ? orderFlowEvidenceGroups(pressureEvents) : []) {
    const strongest = [...evidence].sort((first, second) => (
      second.notional - first.notional || second.time - first.time
    ))[0];
    const evidenceIds = evidence.map((event) => event.id);
    const label = side === "buy" ? tradingReportText("大额主动买入") : tradingReportText("大额主动卖出");
    for (const event of evidence) {
      operations.push({
        op: "upsert",
        drawing: {
          id: `${analysisId}-${event.id}`,
          theory: "order-flow",
          tool: side === "buy" ? "arrow-up" : "arrow-down",
          points: [{ time: microWindow.anchorTime, price: event.price }],
          colorToken: side === "buy" ? "order-flow-buy" : "order-flow-sell",
          status: "confirmed",
          evidenceIds: [event.id],
        },
      });
    }
    operations.push({
      op: "upsert",
      drawing: {
        id: `${analysisId}-micro-pressure-${side}-label`,
        theory: "order-flow",
        tool: "note",
        points: [{ time: microWindow.anchorTime, price: strongest.price }],
        text: evidence.length > 1 ? `${label} ×${evidence.length}` : label,
        colorToken: side === "buy" ? "order-flow-buy" : "order-flow-sell",
        status: "confirmed",
        evidenceIds,
      },
    });
  }
  const latestCandle = snapshot.candles.at(-1);
  const action = buildOrderFlowActionPlan(snapshot, theoryResult);
  const notes = [{
    id: "action",
    point: { time: latestCandle.time, price: latestCandle.close },
    text: tradingReportText("关键价位：上破 {0} 偏多｜跌破 {1} 偏空｜区间内等待", formatPrice(action.longTrigger), formatPrice(action.shortTrigger)),
    evidenceIds: [
      ...(theoryResult.signals[0]?.evidenceIds || []),
      ...(theoryResult.marketStructure?.signals?.[0]?.evidenceIds || []),
    ],
  }];
  for (const note of notes) {
    operations.push({
      op: "upsert",
      drawing: {
        id: `${analysisId}-note-${note.id}`,
        theory: "order-flow",
        tool: "note",
        points: [note.point],
        text: note.text,
        colorToken: "order-flow-note",
        status: review.verdict === "approve" ? "confirmed" : "tentative",
        evidenceIds: note.evidenceIds,
      },
    });
  }
  return validateTradingDrawingPatch({
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    analysisId,
    baseRevision: 0,
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    operations: operations.slice(0, 32),
  }, snapshot);
}

async function runTradingOrderFlowAnalysisPipelineInternal(params, options = {}) {
  const snapshot = normalizeTradingMarketSnapshot(params);
  const orderFlowResult = runOrderFlowTheoryEngine(snapshot);
  if (orderFlowResult.status !== "succeeded") {
    const missing = orderFlowResult.missingData.length
      ? `（缺少：${orderFlowResult.missingData.join("、")}）`
      : "";
    const error = new Error(`当前真实订单流数据不足，至少需要 50 笔主动成交和双边 5 档深度${missing}`);
    error.code = "TRADING_ORDER_FLOW_INSUFFICIENT_DATA";
    throw error;
  }
  const marketStructure = fuseIctSmcWithOrderFlow(
    runIctSmcTheoryEngine(snapshot),
    orderFlowResult,
    snapshot,
  );
  const theoryResult = {
    ...orderFlowResult,
    engineVersion: "0.2.0",
    marketStructure,
    structures: {
      ...orderFlowResult.structures,
      marketStructure: marketStructure.structures,
    },
    signals: [...orderFlowResult.signals, ...marketStructure.signals],
    evidence: [...orderFlowResult.evidence, ...marketStructure.evidence],
  };
  options.onTheoryReady?.({ stage: "deterministic_theory", strategyId: "order-flow", snapshotId: snapshot.snapshotId, candleCount: snapshot.candles.length, evidenceCount: Array.isArray(theoryResult.evidence) ? theoryResult.evidence.length : 0 });
  if (!options.modelRegistry || typeof options.modelRegistry.analyze !== "function") {
    throw new TypeError("modelRegistry is required");
  }
  const providerId = String(options.providerId || "").trim();
  const requestId = `order-flow-request-${crypto.randomUUID()}`;
  const modelRequest = {
    language: params?.language,
    allowedLanguageLiterals: [snapshot.marketId, snapshot.marketId.split(":").at(-1), snapshot.marketId.split(":").at(-1)?.replace(/USDT$/, "")],
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    requestId,
    task: "order-flow-theory-review-and-drawing-plan",
    theoryId: "order_flow",
    snapshotId: snapshot.snapshotId,
    prompt: buildOrderFlowModelPrompt(snapshot, theoryResult, {
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
    validateResponse: (text) => normalizeOrderFlowModelReview(text, theoryResult),
  });
  const { modelResponse, review: modelReview } = reviewed;
  const deterministicActionPlan = buildOrderFlowActionPlan(snapshot, theoryResult);
  const primaryBias = modelReview.marketBias === "buying"
    ? "bullish"
    : modelReview.marketBias === "selling"
      ? "bearish"
      : "neutral";
  const actionPlan = { ...deterministicActionPlan, primaryBias };
  const drawingPatch = buildOrderFlowDrawingPatch(snapshot, theoryResult, modelReview);
  const report = buildOrderFlowAnalysisReport(snapshot, theoryResult, modelReview, {
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
      orderFlowCoverage: theoryResult.coverage,
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

export async function runTradingOrderFlowAnalysisPipeline(params, options = {}) {
  return withTradingReportLanguage(params?.language, async () => localizeTradingAnalysisResult(await runTradingOrderFlowAnalysisPipelineInternal(params, options), params?.language));
}
