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
  ["布伦特原油", "BZUSDT"],
  ["布倫特原油", "BZUSDT"],
  ["WTI原油", "CLUSDT"],
  ["美光", "MUUSDT"],
  ["SKHYNIX", "SKHYNIXUSDT"],
  ["闪迪", "SNDKUSDT"],
  ["閃迪", "SNDKUSDT"],
  ["海力士", "SKHYNIXUSDT"],
  ["英伟达", "NVDAUSDT"],
  ["英偉達", "NVDAUSDT"],
  ["辉达", "NVDAUSDT"],
  ["輝達", "NVDAUSDT"],
  ["特斯拉", "TSLAUSDT"],
  ["黄金", "XAUUSDT"],
  ["黃金", "XAUUSDT"],
  ["白银", "XAGUSDT"],
  ["白銀", "XAGUSDT"],
  ["铂金", "XPTUSDT"],
  ["鉑金", "XPTUSDT"],
  ["钯金", "XPDUSDT"],
  ["鈀金", "XPDUSDT"],
  ["铜", "COPPERUSDT"],
  ["銅", "COPPERUSDT"],
  ["天然气", "NATGASUSDT"],
  ["天然氣", "NATGASUSDT"],
  ["英特尔", "INTCUSDT"],
  ["英特爾", "INTCUSDT"],
  ["罗宾汉", "HOODUSDT"],
  ["羅賓漢", "HOODUSDT"],
  ["微策略", "MSTRUSDT"],
  ["亚马逊", "AMZNUSDT"],
  ["亞馬遜", "AMZNUSDT"],
  ["帕兰泰尔", "PLTRUSDT"],
  ["帕蘭泰爾", "PLTRUSDT"],
  ["微软", "MSFTUSDT"],
  ["微軟", "MSFTUSDT"],
  ["博通", "AVGOUSDT"],
  ["阿里巴巴", "BABAUSDT"],
  ["摩根大通", "JPMUSDT"],
  ["西部数据", "WDCUSDT"],
  ["西部數據", "WDCUSDT"],
  ["太空探索", "SPCXUSDT"],
  ["伯克希尔", "BRKBUSDT"],
  ["伯克希爾", "BRKBUSDT"],
  ["苹果", "AAPLUSDT"],
  ["蘋果", "AAPLUSDT"],
  ["谷歌", "GOOGLUSDT"],
  ["币安人生", "币安人生USDT"],
  ["幣安人生", "币安人生USDT"],
  ["龙虾", "龙虾USDT"],
  ["龍蝦", "龙虾USDT"],
]);

const RESERVED_BASE_ASSETS = new Set([
  "ATR", "BOLL", "BOS", "CHOCH", "EMA", "EQ", "FVG", "ICT", "KDJ", "MACD", "MSS",
  "OB", "OTE", "RSI", "SMC", "SMA", "SSL", "VPVR",
]);
const HAN_NON_ASSET_FRAGMENT = /(?:分析|研判|判断|预测|复盘|解读|查看|看看|看下|看一下|帮我|当前|现在|今天|明天|未来|后续|后面|接下来|下一|下个|一个|这个|该|分钟|小时|日线|周线|行情|盘面|走势|趋势|方向|价格|结构|支撑|压力|阻力|给出|开单|下单|点位|目标|止损|止盈|做多|做空|看多|看空|多空|涨|跌|多还是空|空还是多|怎么样|怎么走|是否|可以|应该)/u;

const PURE_CONCEPT_REQUEST = /(?:什么是|啥是|是什么意思|定义|概念|原理|区别|如何理解|怎么理解|怎么学习|如何学习|学习|教我|入门|新手|小白|教程|科普|推荐|适合|怎么选|如何选|公式|如何计算|怎么计算|what\s+is|what\s+are|define|definition|explain|concept|tutorial|learn|recommend|formula|difference\s+between)/iu;
const CURRENT_OR_ACTIONABLE_REQUEST = /(?:当前|现在|最新|实时|此刻|今天|左侧|这张|这个盘|能不能|是否可以|该不该|应该|怎么样|咋样|怎么看|怎么买|怎么卖|怎么走|做多|做空|买入|卖出|入场|止损|止盈|目标位|失效位|支撑|压力|阻力|突破|跌破|回踩|刷新|更新|重画|重新分析|current|live|latest|right\s+now|entry|stop|target|support|resistance|breakout)/iu;
const MARKET_ANALYSIS_ACTION = /(?:分析|研判|看盘|复盘|解读|看看|看下|看一下|帮我看|怎么看|如何看|判断|预测|扫描|画线|画图|绘图|标注|重画|刷新|更新|analyse|analyze|review|inspect|scan|draw|mark)/iu;
const MARKET_OBJECT = /(?:K\s*线|蜡烛|图表|盘面|行情|走势|趋势|价格|结构|支撑|压力|阻力|形态|背离|均线|成交量|订单流|流动性|FVG|BOS|CHoCH|MSS|盘口|仓位健康|强平风险|爆仓风险|kline|candlestick|chart|market|price|trend|setup|support|resistance|order\s*flow|liquidity)/iu;
const ACTIONABLE_MARKET_QUESTION = /(?:能不能|是否可以|该不该|适不适合|现在|当前|最新|实时).{0,24}(?:买|卖|做多|做空|入场|加仓|减仓|止损|止盈|持有|开仓|平仓|怎么走|安全吗|风险)|(?:支撑|压力|阻力|入场位|止损位|止盈位|目标位|失效位).{0,12}(?:在哪|多少|是什么|怎么看)|(?:can|should|is\s+it\s+safe).{0,24}(?:buy|sell|long|short|enter|hold|close)/iu;
const POSITION_MARKET_REVIEW = /(?:仓位健康|持仓健康|强平风险|爆仓风险|仓位安全吗|持仓安全吗|该怎么操作)/iu;
// Position questions often contain no explicit "分析" verb (for example,
// "SKHYNIX 我在 1240 做空，强平价 1462，我在哪里平仓"). They still need a
// fresh market read before the account context can be interpreted. Keep this
// matcher narrow enough that static education such as "什么是平仓" remains a
// conversation request.
const POSITION_MANAGEMENT_MARKET_REQUEST = /(?:仓位|持仓|强平|爆仓|做多|做空|开仓|平仓|加仓|减仓).{0,40}(?:怎么|如何|哪里|多少|建议|操作|管理|风险|止损|止盈|平仓|减仓|加仓|是否|合适|安全|健康|合理|重不重|轻不轻)|(?:怎么|如何|哪里|多少|建议|操作|管理|风险|止损|止盈|是否|合适|安全|健康|合理|重不重|轻不轻).{0,40}(?:仓位|持仓|强平|爆仓|开仓|平仓|加仓|减仓)/iu;
const MARKET_DIRECTION_OR_LEVEL_REQUEST = /(?:多还是空|空还是多|偏多|偏空|看多|看空|涨还是跌|跌还是涨|会涨|会跌|上涨|下跌|方向|开单|下单|入场|进场|点位|目标|止损|止盈|支撑|压力|阻力)/iu;
const MARKET_IDEA_REQUEST = /(?:思路|交易计划|操作计划|交易方案|操作方案|布局|机会|setup)/iu;
const FRESH_MARKET_REFERENCE = /(?:当前|现在|最新|实时|此刻|今天|未来|后续|接下来|下一|下个|这个盘|这张图|K\s*线|图表|盘面|行情|走势|价格)/iu;
const TRADING_DOMAIN_REFERENCE = /(?:交易|市场|币|股票|指数|黄金|原油|外汇|期货|现货|永续|合约|仓位|持仓|开仓|平仓|买|卖|多|空|涨|跌|入场|止损|止盈|支撑|压力|阻力|趋势|结构|形态|K\s*线|盘面|行情|走势|价格|成交量|订单流|流动性|BTC|ETH|SOL|BNB|XRP|DOGE|USDT|USDC)/iu;
const EXPLICIT_NO_DRAWING = /(?:不要|不用|无需|不需要|别)(?:重新)?(?:绘图|画图|画线|重画|标注)|(?:只要|仅要|只需).{0,12}(?:文字|结论|回答).{0,12}(?:不要|不用|无需).{0,8}(?:绘图|画图|画线)|(?:do\s+not|don't|without)\s+(?:draw|redraw|drawing|mark)/iu;
const CHINESE_INTERVAL_NUMBER_PATTERN = "[零〇一二两三四五六七八九十百千]+";

function chineseInteger(value) {
  const source = String(value || "").trim();
  if (!source) return null;
  const digits = new Map([
    ["零", 0], ["〇", 0], ["一", 1], ["二", 2], ["两", 2], ["三", 3],
    ["四", 4], ["五", 5], ["六", 6], ["七", 7], ["八", 8], ["九", 9],
  ]);
  const units = new Map([["十", 10], ["百", 100], ["千", 1_000]]);
  if (![...source].some((character) => units.has(character))) {
    const compact = [...source].map((character) => digits.get(character));
    if (compact.some((digit) => digit == null)) return null;
    return Number(compact.join(""));
  }
  let total = 0;
  let current = 0;
  for (const character of source) {
    if (digits.has(character)) {
      current = digits.get(character);
      continue;
    }
    const unit = units.get(character);
    if (!unit) return null;
    total += (current || 1) * unit;
    current = 0;
  }
  return total + current;
}

function naturalIntervalNumber(value) {
  const source = String(value || "").trim();
  if (/^\d+(?:\.\d+)?$/.test(source)) return Number(source);
  return chineseInteger(source);
}

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

export function isTradingConceptOnlyRequest(text) {
  const source = normalizeTradingRoutingText(text);
  if (!source || !PURE_CONCEPT_REQUEST.test(source)) return false;
  return !CURRENT_OR_ACTIONABLE_REQUEST.test(source)
    && !ACTIONABLE_MARKET_QUESTION.test(source)
    && !POSITION_MARKET_REVIEW.test(source)
    && !(MARKET_ANALYSIS_ACTION.test(source) && MARKET_OBJECT.test(source));
}

export function normalizeTradingRoutingSymbol(value) {
  const compact = String(value || "").trim().toUpperCase().replace(/[\s/_-]/g, "");
  if (!compact || !/^[A-Z0-9\p{Script=Han}]{2,24}$/u.test(compact)) return null;
  const quote = QUOTE_ASSETS.find((asset) => compact.endsWith(asset));
  if (quote) {
    const base = compact.slice(0, -quote.length);
    // A Han/ASCII mixture before the quote is almost always sentence text
    // glued to a ticker (for example `根据我的仓位ETHUSDT`). Let the intent
    // model own normal extraction; this deterministic recovery parser must
    // fail closed instead of creating an impossible market symbol.
    if (!base || (/\p{Script=Han}/u.test(base)
      && (/[A-Z0-9]/u.test(base) || HAN_NON_ASSET_FRAGMENT.test(base)))) return null;
    return compact;
  }
  // Arbitrary Han text is natural language far more often than a ticker. Bare
  // exchange-native Han symbols are accepted only in the bounded market-token
  // positions below; sentence fragments and action language fail closed here.
  if (/\p{Script=Han}/u.test(compact)) {
    if (compact.length > 12 || HAN_NON_ASSET_FRAGMENT.test(compact)) return null;
    return `${compact}USDT`;
  }
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
  const compactSource = source.replace(/\s+/g, "").toUpperCase();
  const excluded = excludedAssetTerms(excludedTerms);
  for (const [name, symbol] of NAMED_ASSETS) {
    const compactName = name.replace(/\s+/g, "").toUpperCase();
    if (compactSource.includes(compactName) && !excluded.has(compactName)) return symbol;
  }
  const pairedAfterAction = source.match(/(?:分析|研判|复盘|解读|查看|看下|看一下|看看|帮我看|analy[sz]e|review)\s*(?:一下|下)?\s*([A-Za-z0-9\p{Script=Han}]{1,20})\s*(?:[/_-]\s*)?(USDT|USDC|USD)\b/iu);
  const pairedStandalone = source.match(/(?:^|[\s：:,，(（])([A-Za-z0-9\p{Script=Han}]{1,20})\s*(?:[/_-]\s*)?(USDT|USDC|USD)\b/iu);
  const pairedBase = pairedAfterAction?.[1] || pairedStandalone?.[1] || null;
  const pairedQuote = pairedAfterAction?.[2] || pairedStandalone?.[2] || null;
  if (pairedBase && pairedQuote) {
    const symbol = normalizeTradingRoutingSymbol(`${pairedBase}${pairedQuote}`);
    if (symbol && !excluded.has(String(pairedBase).toUpperCase())) return symbol;
  }

  const intervalNumber = `(?:\\d+(?:\\.\\d+)?|${CHINESE_INTERVAL_NUMBER_PATTERN})`;
  const intervalUnit = "(?:m|min(?:ute)?s?|分钟|分|h|hours?|小时|d|days?|天|日|w|weeks?|周)";
  const intervalBoundary = "(?=$|[\\s的这当现盘行走图K线，。,.!?！？])";
  const marketTypeQualifier = "(?:(?:现货|永续(?:合约)?|合约|期货|spot|perpetual|futures?)(?:的)?\\s*)?";
  const actionBeforeInterval = source.match(new RegExp(
    `(?:分析|研判|复盘|解读|查看|看下|看一下|看看|帮我看|analy[sz]e|review)\\s*([A-Za-z][A-Za-z0-9]{1,11}|[\\p{Script=Han}]{2,12}?)(?:的)?\\s*${marketTypeQualifier}(?=${intervalNumber}\\s*${intervalUnit}${intervalBoundary})`,
    "iu",
  ));
  const standaloneBeforeInterval = source.match(new RegExp(
    `(?:^|\\s)([A-Za-z][A-Za-z0-9]{1,11}|[\\p{Script=Han}]{2,12}?)(?:的)?\\s*${marketTypeQualifier}(?=${intervalNumber}\\s*${intervalUnit}${intervalBoundary})`,
    "iu",
  ));
  const latinAfterAction = source.match(/(?:分析|研判|复盘|解读|查看|看下|看一下|看看|帮我看|analy[sz]e|review)\s*(?:一下|下)?\s*([A-Za-z][A-Za-z0-9]{1,11})(?=\s*(?:的|现货|永续|合约|期货|spot|perpetual|futures?|当前|现在|行情|盘面|走势|图表|K\s*线|$))/iu);
  // A generic Han ticker has no lexical boundary of its own. Require a
  // following market qualifier/object instead of accepting any sentence tail.
  const hanAfterAction = source.match(/(?:分析|研判|复盘|解读|查看|看下|看一下|看看|帮我看)\s*(?:一下|下)?\s*([\p{Script=Han}]{2,12}?)(?=\s*(?:的|现货|永续|合约|期货|当前|现在|行情|盘面|走势|图表|K\s*线))/u);
  const latinBeforeMarketObject = source.match(/(?:^|[\s：:,，(（])([A-Za-z][A-Za-z0-9]{1,11})(?=\s*(?:的)?\s*(?:现货|永续|合约|期货|spot|perpetual|futures?|当前|现在|行情|盘面|走势|趋势|价格|支撑|压力|阻力|图表|K\s*线|怎么样|咋样|怎么看|怎么走|能不能|能买吗|能卖吗|能做多吗|能做空吗))/iu);
  const standaloneTicker = source.match(/^([A-Z][A-Z0-9]{1,11})(?:[?？])?$/u);
  const candidate = actionBeforeInterval?.[1] || standaloneBeforeInterval?.[1] || latinAfterAction?.[1] || hanAfterAction?.[1] || latinBeforeMarketObject?.[1] || standaloneTicker?.[1] || null;
  if (!candidate) {
    // Exchange-native tickers are frequently glued directly to Chinese text,
    // so a word-boundary based parser misses inputs such as
    // `SKHYNIX我在1240做空`. Accept an uppercase ticker token at a non-ASCII
    // boundary, while keeping the existing reserved-token and quote checks.
    const embeddedTicker = source.match(/(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]{2,11})(?=$|[^A-Za-z0-9])/u);
    if (!embeddedTicker) return null;
    const compactTicker = embeddedTicker[1].toUpperCase();
    if (excluded.has(compactTicker) || RESERVED_BASE_ASSETS.has(compactTicker)) return null;
    return normalizeTradingRoutingSymbol(compactTicker);
  }
  const compactCandidate = String(candidate).toUpperCase().replace(/[^A-Z0-9\p{Script=Han}]/gu, "");
  if (excluded.has(compactCandidate) || RESERVED_BASE_ASSETS.has(compactCandidate)) return null;
  return normalizeTradingRoutingSymbol(candidate);
}

export function explicitTradingIntervalFromText(text) {
  const source = normalizeTradingRoutingText(text).replace(new RegExp(
    `(?:未来|接下来|后续|随后|下一|下个|下一个)\\s*(?:\\d+(?:\\.\\d+)?|${CHINESE_INTERVAL_NUMBER_PATTERN})\\s*(?:分钟|分|小时|时|天|日|周|minutes?|hours?|days?|weeks?)`,
    "giu",
  ), " ");
  const hour = source.match(new RegExp(`(\\d+(?:\\.\\d+)?|${CHINESE_INTERVAL_NUMBER_PATTERN})\\s*(?:h(?:ours?)?|小时)`, "iu"));
  if (hour) {
    const minutes = Number(naturalIntervalNumber(hour[1])) * 60;
    if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 1_440) return String(minutes);
  }
  const minute = source.match(new RegExp(`(\\d+|${CHINESE_INTERVAL_NUMBER_PATTERN})\\s*(?:m(?:in(?:ute)?s?)?|分钟|分)`, "iu"));
  if (minute) {
    const minutes = Number(naturalIntervalNumber(minute[1]));
    if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 1_440) return String(minutes);
  }
  if (/(?:[1一]\s*(?:d|天|日)|日线|日级别|日周期|daily)/iu.test(source)) return "1D";
  if (/(?:[1一]\s*(?:w|周)|周线|周级别|周周期|weekly)/iu.test(source)) return "1W";
  return null;
}

export function explicitTradingForecastHorizonFromText(text) {
  const source = normalizeTradingRoutingText(text);
  const implicitOne = source.match(/(?:下一|下个|下一个)\s*(分钟|分|小时|时|天|日|周|minute|hour|day|week)s?/iu);
  const match = source.match(new RegExp(
    `(?:未来|接下来|后续|随后|下一|下个|下一个)\\s*(\\d+(?:\\.\\d+)?|${CHINESE_INTERVAL_NUMBER_PATTERN})\\s*(分钟|分|小时|时|天|日|周|minutes?|hours?|days?|weeks?)`,
    "iu",
  ));
  if (!match && !implicitOne) return null;
  const count = match ? naturalIntervalNumber(match[1]) : 1;
  if (!Number.isFinite(count) || count <= 0) return null;
  const unit = String(match?.[2] || implicitOne?.[1] || "").toLowerCase();
  const multiplier = /分钟|分|minute/u.test(unit)
    ? 60_000
    : /小时|时|hour/u.test(unit)
      ? 3_600_000
      : /周|week/u.test(unit)
        ? 7 * 86_400_000
        : 86_400_000;
  const horizonMs = Number(count) * multiplier;
  return Number.isSafeInteger(horizonMs) && horizonMs <= MAX_LOOKBACK_MS ? horizonMs : null;
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
  const symbol = explicitTradingSymbolFromText(text, options);
  return {
    symbol,
    // Missing target fields are resolved independently against the chart that
    // was visible when the user sent the request. A forecast horizon such as
    // “未来一小时” must never silently change the candle interval.
    interval: explicitTradingIntervalFromText(text),
    ...explicitTradingLookbackFromText(text),
    forecastHorizonMs: explicitTradingForecastHorizonFromText(text),
  };
}

export function isExplicitMarketAnalysisRequest(text) {
  const source = normalizeTradingRoutingText(text);
  if (!source) return false;
  const bareNamedAsset = source.replace(/[\s?？!！。,.，]+/gu, "").toUpperCase();
  if ([...NAMED_ASSETS.keys()].some((name) => name.replace(/\s+/g, "").toUpperCase() === bareNamedAsset)) {
    return true;
  }
  const conceptual = isTradingConceptOnlyRequest(source);
  if (conceptual) return false;
  if (/^(?:分析|研判|看盘|复盘|看看|看下|看一下|刷新|更新|重画|画图|绘图|画线)(?:一下|下|吧)?[。.!！?？]*$/iu.test(source)) return true;
  if (POSITION_MARKET_REVIEW.test(source)) return true;
  if (POSITION_MANAGEMENT_MARKET_REQUEST.test(source)) return true;
  if (ACTIONABLE_MARKET_QUESTION.test(source)) return true;
  if (MARKET_DIRECTION_OR_LEVEL_REQUEST.test(source) && (
    MARKET_ANALYSIS_ACTION.test(source)
    || FRESH_MARKET_REFERENCE.test(source)
    || extractExplicitTradingParameters(source).symbol
  )) return true;
  if (MARKET_ANALYSIS_ACTION.test(source) && MARKET_OBJECT.test(source)) return true;
  const parameters = extractExplicitTradingParameters(source);
  // A bare strategy/chart instruction such as “分析4小时” names the target
  // candle resolution even though it omits a redundant noun like “K线” or
  // “盘面”. Forecast horizons are removed by explicitTradingIntervalFromText,
  // so “分析未来4小时走势” still inherits the open chart interval.
  if (parameters.interval && MARKET_ANALYSIS_ACTION.test(source)) return true;
  if (parameters.symbol && /(?:怎么样|咋样|怎么看|怎么走|能不能|能买吗|能卖吗|能做多吗|能做空吗)/iu.test(source)) return true;
  if (/^[A-Z][A-Z0-9]{1,11}$/u.test(source.replace(/[?？]$/u, ""))
    && !RESERVED_BASE_ASSETS.has(source.replace(/[?？]$/gu, "").toUpperCase())) return true;
  // Only an interval written in the message may satisfy the symbol+interval
  // intent rule; a missing interval is inherited later from the open chart.
  if (parameters.symbol && explicitTradingIntervalFromText(source)) return true;
  if (parameters.symbol && (
    MARKET_ANALYSIS_ACTION.test(source)
    || CURRENT_OR_ACTIONABLE_REQUEST.test(source)
    || MARKET_IDEA_REQUEST.test(source)
  )) return true;
  if (!conceptual && TRADING_DOMAIN_REFERENCE.test(source) && (
    /(?:分析|研判|判断|预测|看看|看下|怎么看|怎么走|是否|能否|能不能|应该|未来|接下来|下一|下个)/iu.test(source)
  )) return true;
  return false;
}

export function classifyTradingQuestionKinds(text) {
  const source = normalizeTradingRoutingText(text);
  const kinds = [];
  const push = (kind, pattern) => {
    if (pattern.test(source) && !kinds.includes(kind)) kinds.push(kind);
  };
  push("direction", /(?:多还是空|空还是多|偏多|偏空|看多|看空|涨还是跌|跌还是涨|会涨|会跌|方向|怎么走)/iu);
  push("entry", /(?:开单|下单|入场|进场|开仓|点位|能买吗|能卖吗|做多|做空)/iu);
  push("stop", /(?:止损|失效|取消条件)/iu);
  push("target", /(?:止盈|目标|看到哪里|空间)/iu);
  push("support_resistance", /(?:支撑|压力|阻力|区间|边界)/iu);
  push("pattern", /(?:形态|结构|背离|中枢|波浪|缠论|威科夫|谐波|订单流|裸K|道氏)/iu);
  push("explanation", /(?:为什么|为何|依据|逻辑|凭什么|原因)/iu);
  push("position_risk", /(?:仓位|持仓|强平|爆仓|风险|加仓|减仓|平仓)/iu);
  if (!kinds.length && PURE_CONCEPT_REQUEST.test(source)) kinds.push("concept");
  if (!kinds.length) kinds.push("general");
  return Object.freeze(kinds);
}

export function deterministicMarketChartRouting(text, options = {}) {
  if (!isExplicitMarketAnalysisRequest(text)) return null;
  const instruction = normalizeTradingRoutingText(text);
  const parameters = extractExplicitTradingParameters(instruction, options);
  const drawingRequested = !explicitNoDrawingRequested(instruction);
  const questionKinds = classifyTradingQuestionKinds(instruction);
  const positionManagementRequested = questionKinds.includes("position_risk");
  return Object.freeze({
    request: Object.freeze({
      mode: "chart-analysis",
      instruction,
      ...parameters,
      questionKinds,
      ...(positionManagementRequested ? { positionManagementRequested: true } : {}),
      drawingRequested,
      analysisFollowup: false,
    }),
    classification: Object.freeze({
      schemaVersion: 1,
      mode: "chart-analysis",
      intent: positionManagementRequested
        ? "position-management"
        : drawingRequested ? "chart-drawing" : "chart-analysis",
      confidence: 1,
      source: "deterministic-market-analysis",
    }),
  });
}

export function deterministicStrategyRequestRouting(text, manifest = {}) {
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
  const bareAnalysisCommand = /^(?:(?:帮我|请)\s*)?(?:分析|研判|看盘|复盘|看看|看下|看一下)(?:一下|下|吧)?[。.!！?？]*$/iu.test(instruction);
  const chartAnalysis = !instruction || bareAnalysisCommand || isExplicitMarketAnalysisRequest(instruction);
  const drawingRequested = chartAnalysis && !explicitNoDrawingRequested(instruction);
  const questionKinds = classifyTradingQuestionKinds(instruction);
  const positionManagementRequested = chartAnalysis && questionKinds.includes("position_risk");
  return Object.freeze({
    mode: chartAnalysis ? "chart-analysis" : "conversation",
    instruction,
    symbol: chartAnalysis ? parameters.symbol : null,
    interval: chartAnalysis ? parameters.interval : null,
    lookbackMs: chartAnalysis ? parameters.lookbackMs : null,
    lookbackLabel: chartAnalysis ? parameters.lookbackLabel : null,
    forecastHorizonMs: chartAnalysis ? parameters.forecastHorizonMs : null,
    questionKinds,
    ...(positionManagementRequested ? { positionManagementRequested: true } : {}),
    drawingRequested,
  });
}

// Compatibility export for callers that have not migrated their import name.
export const deterministicStrategyChartRouting = deterministicStrategyRequestRouting;
