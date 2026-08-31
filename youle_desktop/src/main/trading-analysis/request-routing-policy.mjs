const MAX_LOOKBACK_MS = 5 * 366 * 24 * 60 * 60 * 1_000;
const QUOTE_ASSETS = ["USDT", "USDC", "USD"];
const NAMED_ASSETS = new Map([
  ["比特币", "BTCUSDT"],
  ["大饼", "BTCUSDT"],
  ["以太坊", "ETHUSDT"],
  ["以太", "ETHUSDT"],
  ["币安币", "BNBUSDT"],
  ["狗狗币", "DOGEUSDT"],
  ["瑞波币", "XRPUSDT"],
  ["索拉纳", "SOLUSDT"],
]);

const RESERVED_BASE_ASSETS = new Set([
  "ATR", "BOLL", "BOS", "CHOCH", "EMA", "EQ", "FVG", "ICT", "KDJ", "MACD", "MSS",
  "OB", "OTE", "RSI", "SMC", "SMA", "SSL", "VPVR",
]);

const PURE_CONCEPT_REQUEST = /(?:什么是|啥是|是什么意思|定义|概念|原理|区别|如何理解|怎么理解|怎么学习|如何学习|入门|教程|科普|公式|如何计算|怎么计算|what\s+is|what\s+are|define|definition|explain|concept|formula|difference\s+between)/iu;
const CURRENT_OR_ACTIONABLE_REQUEST = /(?:当前|现在|最新|实时|此刻|今天|左侧|这张|这个盘|能不能|是否可以|该不该|应该|怎么样|咋样|怎么看|怎么买|怎么卖|怎么走|做多|做空|买入|卖出|入场|止损|止盈|目标位|失效位|支撑|压力|阻力|突破|跌破|回踩|刷新|更新|重画|重新分析|current|live|latest|right\s+now|entry|stop|target|support|resistance|breakout)/iu;
const MARKET_ANALYSIS_ACTION = /(?:分析|研判|看盘|复盘|解读|看看|看下|看一下|帮我看|怎么看|如何看|判断|预测|扫描|画线|画图|绘图|标注|重画|刷新|更新|analyse|analyze|review|inspect|scan|draw|mark)/iu;
const MARKET_OBJECT = /(?:K\s*线|蜡烛|图表|盘面|行情|走势|趋势|价格|结构|支撑|压力|阻力|形态|背离|均线|成交量|订单流|流动性|FVG|BOS|CHoCH|MSS|盘口|仓位健康|强平风险|爆仓风险|kline|candlestick|chart|market|price|trend|setup|support|resistance|order\s*flow|liquidity)/iu;
const ACTIONABLE_MARKET_QUESTION = /(?:能不能|是否可以|该不该|适不适合|现在|当前|最新|实时).{0,24}(?:买|卖|做多|做空|入场|加仓|减仓|止损|止盈|持有|开仓|平仓|怎么走|安全吗|风险)|(?:支撑|压力|阻力|入场位|止损位|止盈位|目标位|失效位).{0,12}(?:在哪|多少|是什么|怎么看)|(?:can|should|is\s+it\s+safe).{0,24}(?:buy|sell|long|short|enter|hold|close)/iu;
const POSITION_MARKET_REVIEW = /(?:仓位健康|持仓健康|强平风险|爆仓风险|仓位安全吗|持仓安全吗|该怎么操作)/iu;
const EXPLICIT_NO_DRAWING = /(?:不要|不用|无需|不需要|别)(?:重新)?(?:绘图|画图|画线|重画|标注)|(?:只要|仅要|只需).{0,12}(?:文字|结论|回答).{0,12}(?:不要|不用|无需).{0,8}(?:绘图|画图|画线)|(?:do\s+not|don't|without)\s+(?:draw|redraw|drawing|mark)/iu;

export function normalizeTradingRoutingText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/([\p{Script=Han}])[\r\n]+\s*([\p{Script=Han}])/gu, "$1$2")
    .replace(/\r\n?/g, "\n")
    .replace(/@(?:策略|指标)\s*：\s*/gu, (match) => match.includes("指标") ? "@指标:" : "@策略:")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12_000);
}

export function explicitNoDrawingRequested(text) {
  return EXPLICIT_NO_DRAWING.test(normalizeTradingRoutingText(text));
}

function normalizedSymbol(value) {
  const compact = String(value || "").trim().toUpperCase().replace(/[\s/_-]/g, "");
  if (!compact || !/^[A-Z0-9\p{Script=Han}]{2,24}$/u.test(compact)) return null;
  const quote = QUOTE_ASSETS.find((asset) => compact.endsWith(asset));
  if (quote) return compact.length > quote.length ? compact : null;
  if (compact.length > 12 || RESERVED_BASE_ASSETS.has(compact)) return null;
  return `${compact}USDT`;
}

function excludedAssetTerms(values = []) {
  return new Set(values
    .map((value) => String(value || "").toUpperCase().replace(/[^A-Z0-9\p{Script=Han}]/gu, ""))
    .filter(Boolean));
}

export function explicitTradingSymbolFromText(text, { excludedTerms = [] } = {}) {
  const source = normalizeTradingRoutingText(text);
  const excluded = excludedAssetTerms(excludedTerms);
  for (const [name, symbol] of NAMED_ASSETS) {
    if (source.includes(name) && !excluded.has(name.toUpperCase())) return symbol;
  }
  const pairedAfterAction = source.match(/(?:分析|研判|复盘|解读|查看|看下|看一下|看看|帮我看|analy[sz]e|review)\s*(?:一下|下)?\s*([A-Za-z0-9\p{Script=Han}]{1,20})\s*(?:[/_-]\s*)?(USDT|USDC|USD)\b/iu);
  const pairedStandalone = source.match(/(?:^|[\s：:,，(（])([A-Za-z0-9\p{Script=Han}]{1,20})\s*(?:[/_-]\s*)?(USDT|USDC|USD)\b/iu);
  const pairedBase = pairedAfterAction?.[1] || pairedStandalone?.[1] || null;
  const pairedQuote = pairedAfterAction?.[2] || pairedStandalone?.[2] || null;
  if (pairedBase && pairedQuote) {
    const symbol = normalizedSymbol(`${pairedBase}${pairedQuote}`);
    if (symbol && !excluded.has(String(pairedBase).toUpperCase())) return symbol;
  }

  const actionBeforeInterval = source.match(/(?:分析|研判|复盘|解读|查看|看下|看一下|看看|帮我看|analy[sz]e|review)\s*([A-Za-z][A-Za-z0-9]{1,11}|[\p{Script=Han}]{2,12}?)(?:的)?\s*(?=\d+(?:\.\d+)?\s*(?:m|min(?:ute)?s?|分钟|分|h|hours?|小时|d|days?|天|日|w|weeks?|周)(?=$|[\s的这当现盘行走图K线，。,.!?！？]))/iu);
  const standaloneBeforeInterval = source.match(/(?:^|\s)([A-Za-z][A-Za-z0-9]{1,11}|[\p{Script=Han}]{2,12}?)(?:的)?\s*(?=\d+(?:\.\d+)?\s*(?:m|min(?:ute)?s?|分钟|分|h|hours?|小时|d|days?|天|日|w|weeks?|周)(?=$|[\s的这当现盘行走图K线，。,.!?！？]))/iu);
  const afterAction = source.match(/(?:分析|研判|复盘|解读|查看|看下|看一下|看看|帮我看|analy[sz]e|review)\s*(?:一下|下)?\s*([A-Za-z][A-Za-z0-9]{1,11}|[\p{Script=Han}]{2,12}?)(?=\s*(?:的|当前|现在|行情|盘面|走势|图表|K\s*线|$))/iu);
  const latinBeforeMarketObject = source.match(/(?:^|[\s：:,，(（])([A-Za-z][A-Za-z0-9]{1,11})(?=\s*(?:的)?\s*(?:当前|现在|行情|盘面|走势|趋势|价格|支撑|压力|阻力|图表|K\s*线|怎么样|咋样|怎么看|怎么走|能不能|能买吗|能卖吗|能做多吗|能做空吗))/iu);
  const standaloneTicker = source.match(/^([A-Z][A-Z0-9]{1,11})(?:[?？])?$/u);
  const candidate = actionBeforeInterval?.[1] || standaloneBeforeInterval?.[1] || afterAction?.[1] || latinBeforeMarketObject?.[1] || standaloneTicker?.[1] || null;
  if (!candidate) return null;
  const compactCandidate = String(candidate).toUpperCase().replace(/[^A-Z0-9\p{Script=Han}]/gu, "");
  if (excluded.has(compactCandidate) || RESERVED_BASE_ASSETS.has(compactCandidate)) return null;
  return normalizedSymbol(candidate);
}

export function explicitTradingIntervalFromText(text) {
  const source = normalizeTradingRoutingText(text);
  const hour = source.match(/(\d+(?:\.\d+)?)\s*(?:h(?:ours?)?|小时)/iu);
  if (hour) {
    const minutes = Number(hour[1]) * 60;
    if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 1_440) return String(minutes);
  }
  const minute = source.match(/(\d+)\s*(?:m(?:in(?:ute)?s?)?|分钟|分)/iu);
  if (minute) {
    const minutes = Number(minute[1]);
    if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 1_440) return String(minutes);
  }
  if (/(?:1\s*d|日线|日级别|日周期|daily)/iu.test(source)) return "1D";
  if (/(?:1\s*w|周线|周级别|周周期|weekly)/iu.test(source)) return "1W";
  return null;
}

export function explicitTradingLookbackFromText(text) {
  const source = normalizeTradingRoutingText(text);
  const match = source.match(/(?:最近|过去|近|last|past)\s*(\d+)\s*(分钟|分|小时|时|天|日|周|个月|月|minutes?|hours?|days?|weeks?|months?)/iu);
  if (!match) return { lookbackMs: null, lookbackLabel: null };
  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count < 1) return { lookbackMs: null, lookbackLabel: null };
  const unit = String(match[2]).toLowerCase();
  const multiplier = /分钟|分|minute/u.test(unit)
    ? 60_000
    : /小时|时|hour/u.test(unit)
      ? 3_600_000
      : /周|week/u.test(unit)
        ? 7 * 86_400_000
        : /个月|月|month/u.test(unit)
          ? 30 * 86_400_000
          : 86_400_000;
  const lookbackMs = count * multiplier;
  if (!Number.isSafeInteger(lookbackMs) || lookbackMs > MAX_LOOKBACK_MS) {
    return { lookbackMs: null, lookbackLabel: null };
  }
  return { lookbackMs, lookbackLabel: `${count}${match[2]}`.slice(0, 32) };
}

export function extractExplicitTradingParameters(text, options = {}) {
  return {
    symbol: explicitTradingSymbolFromText(text, options),
    interval: explicitTradingIntervalFromText(text),
    ...explicitTradingLookbackFromText(text),
  };
}

export function isExplicitMarketAnalysisRequest(text) {
  const source = normalizeTradingRoutingText(text);
  if (!source) return false;
  const conceptual = PURE_CONCEPT_REQUEST.test(source);
  const currentOrActionable = CURRENT_OR_ACTIONABLE_REQUEST.test(source);
  if (conceptual && !currentOrActionable) return false;
  if (/^(?:分析|研判|看盘|复盘|看看|看下|看一下|刷新|更新|重画|画图|绘图|画线)(?:一下|下|吧)?[。.!！?？]*$/iu.test(source)) return true;
  if (POSITION_MARKET_REVIEW.test(source)) return true;
  if (ACTIONABLE_MARKET_QUESTION.test(source)) return true;
  if (MARKET_ANALYSIS_ACTION.test(source) && MARKET_OBJECT.test(source)) return true;
  const parameters = extractExplicitTradingParameters(source);
  if (parameters.symbol && /(?:怎么样|咋样|怎么看|怎么走|能不能|能买吗|能卖吗|能做多吗|能做空吗)/iu.test(source)) return true;
  if (/^[A-Z][A-Z0-9]{1,11}$/u.test(source.replace(/[?？]$/u, ""))
    && !RESERVED_BASE_ASSETS.has(source.replace(/[?？]$/gu, "").toUpperCase())) return true;
  if (parameters.symbol && parameters.interval) return true;
  if (parameters.symbol && (MARKET_ANALYSIS_ACTION.test(source) || currentOrActionable)) return true;
  return false;
}

export function deterministicMarketChartRouting(text, options = {}) {
  if (!isExplicitMarketAnalysisRequest(text)) return null;
  const instruction = normalizeTradingRoutingText(text);
  const parameters = extractExplicitTradingParameters(instruction, options);
  const drawingRequested = !explicitNoDrawingRequested(instruction);
  return Object.freeze({
    request: Object.freeze({
      mode: "chart-analysis",
      instruction,
      ...parameters,
      drawingRequested,
      analysisFollowup: false,
    }),
    classification: Object.freeze({
      schemaVersion: 1,
      mode: "chart-analysis",
      intent: drawingRequested ? "chart-drawing" : "chart-analysis",
      confidence: 1,
      source: "deterministic-market-analysis",
    }),
  });
}

export function deterministicStrategyChartRouting(text, manifest = {}) {
  const names = [
    manifest?.mentions?.canonical,
    ...(manifest?.mentions?.aliases || []),
    manifest?.display?.name,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  let instruction = normalizeTradingRoutingText(text);
  const normalizedNames = [...new Set(names.map(normalizeTradingRoutingText))]
    .sort((left, right) => right.length - left.length);
  for (const name of normalizedNames) {
    for (const group of ["策略", "指标"]) {
      instruction = instruction
        .split(`@${group}:${name}`)
        .join("");
    }
  }
  instruction = normalizeTradingRoutingText(instruction);
  const parameters = extractExplicitTradingParameters(instruction, { excludedTerms: names });
  const drawingRequested = !explicitNoDrawingRequested(instruction);
  return Object.freeze({
    mode: "chart-analysis",
    instruction,
    ...parameters,
    drawingRequested,
  });
}
