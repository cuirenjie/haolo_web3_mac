import { repairExternalTradingRoutingFromText } from "../trading-analysis/external-strategy-router.mjs";

export const TRADING_AUTOMATION_EXECUTION_PROFILE = "trading-agent-v1";
export const TRADING_AUTOMATION_MODEL = "gpt-5.6-sol";
export const TRADING_AUTOMATION_REASONING_EFFORT = "ultra";

const DEFAULT_CONTEXT = Object.freeze({
  provider: "binance",
  venue: "Binance",
  marketType: "perpetual",
  marketId: "BINANCE:FUTURES:BTCUSDT",
  symbol: "BTCUSDT",
  interval: "60",
  resolution: "60",
});

const ANALYSIS_SIGNAL = /(?:K\s*线|行情|盘面|走势|趋势|价格|价位|报价|涨跌|振幅|成交量|资金费率|持仓量|支撑|压力|阻力|复盘|研判|分析|看盘|监控|监测|盯盘|提醒|预警|突破|跌破|买点|卖点|入场|止损|止盈|交易计划|缠论|波浪|威科夫|订单流|ICT|SMC|SMT)/iu;
const KNOWLEDGE_ONLY_SIGNAL = /(?:什么是|是什么意思|概念|定义|原理|教程|教学|怎么理解|如何理解|介绍一下)/iu;

function firstText(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function normalizedSymbol(value, { appendUsdt = true } = {}) {
  const compact = String(value || "").trim().toUpperCase().replace(/[\s/_-]/g, "");
  if (!/^[A-Z0-9_\p{Script=Han}]{2,40}$/u.test(compact)) return "";
  return appendUsdt && !/(?:USDT|USDC|USD)$/u.test(compact) ? `${compact}USDT` : compact;
}

export function normalizeTradingAutomationInterval(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!raw) return "";
  if (["1D", "D", "DAILY", "日线", "日級別", "日级别"].includes(raw)) return "1D";
  if (["1W", "W", "WEEKLY", "周线", "週線", "周级别", "週級別"].includes(raw)) return "1W";
  const hour = raw.match(/^(\d+(?:\.\d+)?)H(?:OUR)?S?$/u);
  if (hour) {
    const minutes = Number(hour[1]) * 60;
    return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1_440 ? String(minutes) : "";
  }
  const minute = raw.match(/^(\d+)(?:M|MIN|MINUTE|MINUTES|分钟|分鐘)?$/u);
  if (!minute) return "";
  const minutes = Number(minute[1]);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1_440 ? String(minutes) : "";
}

export function tradingAutomationBinanceInterval(value) {
  const interval = normalizeTradingAutomationInterval(value);
  if (interval === "1D") return "1d";
  if (interval === "1W") return "1w";
  const minutes = Number(interval);
  if (!Number.isInteger(minutes) || minutes < 1) return "1h";
  if (minutes % 1_440 === 0) return `${minutes / 1_440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

export function normalizeTradingAutomationContext(value = {}, { withDefaults = true } = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const marketId = firstText(source.marketId, source.market_id).toUpperCase();
  const marketIdParts = marketId.split(":");
  const provider = firstText(source.provider, marketIdParts[0]).toLowerCase()
    || (withDefaults ? DEFAULT_CONTEXT.provider : "");
  const symbol = normalizedSymbol(firstText(source.symbol, marketIdParts.at(-1)), {
    appendUsdt: provider === "binance",
  }) || (withDefaults ? DEFAULT_CONTEXT.symbol : "");
  const rawMarketType = firstText(source.marketType, source.market_type, marketIdParts.at(-2)).toLowerCase();
  const marketType = rawMarketType === "spot" ? "spot" : "perpetual";
  const interval = normalizeTradingAutomationInterval(
    firstText(source.interval, source.resolution),
  ) || (withDefaults ? DEFAULT_CONTEXT.interval : "");
  const normalizedMarketId = provider === "binance" && symbol
    ? `BINANCE:${marketType === "spot" ? "SPOT" : "FUTURES"}:${symbol}`
    : marketId;
  if (!withDefaults && (!provider || !symbol || !interval)) return null;
  return Object.freeze({
    provider: provider || DEFAULT_CONTEXT.provider,
    venue: firstText(source.venue) || (provider === "binance" ? "Binance" : provider || DEFAULT_CONTEXT.venue),
    marketType,
    marketId: normalizedMarketId || DEFAULT_CONTEXT.marketId,
    symbol: symbol || DEFAULT_CONTEXT.symbol,
    interval: interval || DEFAULT_CONTEXT.interval,
    resolution: interval || DEFAULT_CONTEXT.resolution,
  });
}

export function isTradingAutomationJob(job = {}) {
  return job.executionProfile === TRADING_AUTOMATION_EXECUTION_PROFILE
    || job.createdBy === "auto_task_ui"
    || job.trustedAutoTaskUi === true
    || String(job.id || "").startsWith("auto-task-ui-");
}

export function resolveTradingAutomationRoute({ prompt = "", context = null, strategies = [] } = {}) {
  const text = String(prompt || "").trim();
  const savedContext = normalizeTradingAutomationContext(context || {}, { withDefaults: true });
  const repaired = repairExternalTradingRoutingFromText({
    text,
    route: {
      mode: "analysis",
      strategyId: null,
      symbol: null,
      interval: null,
      lookbackMs: null,
      lookbackLabel: null,
      confidence: 1,
      clarificationQuestion: null,
    },
    strategies,
  });
  const explicitAnalysis = ANALYSIS_SIGNAL.test(text);
  const knowledgeOnly = KNOWLEDGE_ONLY_SIGNAL.test(text)
    && !/(?:当前|现在|实时|最新|今日|今天|我的|持仓|账户|价格|价位)/u.test(text);
  if ((!explicitAnalysis && !repaired.strategyId) || knowledgeOnly) {
    return Object.freeze({ mode: "conversation", reason: knowledgeOnly ? "knowledge-only" : "no-market-analysis-signal" });
  }
  return Object.freeze({
    mode: "analysis",
    strategyId: repaired.strategyId || null,
    symbol: repaired.symbol || savedContext.symbol,
    interval: repaired.interval || savedContext.interval,
    lookbackMs: repaired.lookbackMs ?? null,
    lookbackLabel: repaired.lookbackLabel ?? null,
    provider: repaired.symbol ? "binance" : savedContext.provider,
    venue: repaired.symbol ? "Binance" : savedContext.venue,
    marketType: savedContext.marketType,
    marketId: repaired.symbol
      ? `BINANCE:${savedContext.marketType === "spot" ? "SPOT" : "FUTURES"}:${repaired.symbol}`
      : savedContext.marketId,
    drawingRequested: true,
    executionPlanRequested: true,
    source: repaired.strategyId ? "strategy-router" : "general-price-action",
  });
}

export function buildTradingAutomationDeveloperInstructions(job = {}) {
  if (!isTradingAutomationJob(job)) return "";
  const context = normalizeTradingAutomationContext(job.tradingContext || {}, { withDefaults: true });
  return [
    "<haolo_trading_automation>",
    "This scheduled run belongs to the HaoLo trading agent. Trading routing and trading safety take precedence over the legacy generic desktop-task behavior.",
    "- Classify the request as market analysis, strategy analysis, account/position review, trading-plan management, trade execution, alert/monitoring, or trading knowledge before acting.",
    "- Market/strategy analysis must use the fresh trading runtime result supplied by the host. Do not replace it with remembered prices, a generic web summary, or an improvised text-only answer.",
    "- The host trading path is: request routing -> normalized market identity and fresh market snapshot -> deterministic price-action or requested strategy engine -> model review -> personal risk and read-only account context -> ExecutionPlanV1 -> validated drawing artifact/result persistence.",
    "- Apply the user's current saved trading preferences and risk limits. Never invent account balances, positions, order status, prices, fills, or market data.",
    "- Treat the scheduled context only as a fallback when the task does not explicitly name a market or interval. Fresh data for the current run always wins over earlier thread content.",
    "- Do not place, cancel, or modify a live order merely because analysis produced an execution plan. A live trading action still requires an explicit user instruction plus the existing account, permission, risk, and confirmation gates; otherwise fail closed and report the plan only.",
    "- Do not silently fall back to the pre-trading generic automation persona. If a required trading service is unavailable, report that trading-chain failure clearly.",
    `- Scheduled trading context: ${JSON.stringify(context)}`,
    "</haolo_trading_automation>",
  ].join("\n");
}
