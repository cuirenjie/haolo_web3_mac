export const EXTERNAL_TRADING_ROUTING_SCHEMA_VERSION = 1;
export const EXTERNAL_TRADING_ROUTING_CONFIDENCE_THRESHOLD = 0.65;

const ROUTING_KEYS = Object.freeze([
  "schemaVersion",
  "mode",
  "strategyId",
  "symbol",
  "interval",
  "lookbackMs",
  "lookbackLabel",
  "confidence",
  "clarificationQuestion",
]);
const MAX_LOOKBACK_MS = 5 * 366 * 24 * 60 * 60 * 1_000;
const QUOTE_ASSETS = ["USDT", "USDC", "USD"];
const COMMON_CRYPTO_BASE_ASSETS = new Set([
  "ADA", "APT", "ARB", "ATOM", "AVAX", "BCH", "BNB", "BTC", "DOGE", "DOT", "EGLD", "ETC", "ETH",
  "FIL", "HBAR", "ICP", "INJ", "LINK", "LTC", "MATIC", "NEAR", "OP", "PEPE", "SAND", "SHIB", "SOL",
  "SUI", "TIA", "TON", "TRX", "UNI", "XLM", "XRP", "1000BONK", "1000FLOKI", "1000PEPE",
]);
const EXPLICIT_ANALYSIS_SIGNAL = /K\s*线|行情|盘面|走势|趋势|支撑|阻力|复盘|分析|研判|看下|看看|级别/iu;

function extractJsonObject(text) {
  const source = String(text || "").trim();
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  if (first < 0 || last <= first) {
    throw new TypeError("External trading router must return one JSON object");
  }
  return JSON.parse(source.slice(first, last + 1));
}

function assertExactKeys(value) {
  const keys = Object.keys(value || {}).sort();
  const expected = [...ROUTING_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError("External trading router returned an invalid JSON shape");
  }
}

function normalizeSymbol(value) {
  if (value == null || String(value).trim() === "") return null;
  const compact = String(value).trim().toUpperCase().replace(/[\s/_-]/g, "");
  if (!/^[A-Z0-9]{2,24}$/.test(compact)) {
    throw new TypeError("External trading router symbol is invalid");
  }
  const quote = QUOTE_ASSETS.find((asset) => compact.endsWith(asset));
  if (quote) {
    if (compact.length <= quote.length) throw new TypeError("External trading router symbol is invalid");
    return compact;
  }
  // Natural-language requests commonly say “BTC” or “ETH”. External
  // analysis is currently backed by Binance perpetual public candles, so
  // resolve an unqualified base asset to its USDT market explicitly.
  if (compact.length > 12) throw new TypeError("External trading router base asset is invalid");
  return `${compact}USDT`;
}

function normalizeInterval(value) {
  if (value == null || String(value).trim() === "") return null;
  const raw = String(value).trim().toUpperCase().replace(/\s+/g, "");
  if (raw === "1D" || raw === "1W") return raw;
  const hour = raw.match(/^(\d+(?:\.\d+)?)H(?:OUR)?S?$/);
  if (hour) {
    const minutes = Number(hour[1]) * 60;
    if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 1_440) return String(minutes);
  }
  const minute = raw.match(/^(\d+)(?:M|MIN|MINUTE|MINUTES|分钟)$/u);
  if (minute) {
    const minutes = Number(minute[1]);
    if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 1_440) return String(minutes);
  }
  if (/^\d+$/.test(raw)) {
    const minutes = Number(raw);
    if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 1_440) return raw;
  }
  throw new TypeError("External trading router interval is unsupported");
}

function compactSemanticTerm(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s_\-./:：，,。！？!?()[\]{}]/gu, "");
}

function strategyCatalogEntries(strategies = []) {
  return strategies
    .filter((strategy) => strategy?.enabled !== false && String(strategy.id || "").trim())
    .map((strategy) => ({
      id: String(strategy.id).trim(),
      terms: [
        strategy.id,
        strategy.display?.name,
        strategy.mentions?.canonical,
        ...(Array.isArray(strategy.mentions?.aliases) ? strategy.mentions.aliases : []),
      ].map(compactSemanticTerm).filter(Boolean),
    }));
}

function resolveStrategyId(value, strategies = []) {
  const target = compactSemanticTerm(value);
  if (!target) return null;
  const entries = strategyCatalogEntries(strategies);
  const exact = entries.find((entry) => entry.terms.includes(target));
  if (exact) return exact.id;
  // Accommodate model outputs such as “缠论分析” or “Chan Theory” while
  // still requiring a sufficiently distinctive catalog term.
  const contained = entries
    .flatMap((entry) => entry.terms.map((term) => ({ entry, term })))
    .filter(({ term }) => term.length >= 2 && (target.includes(term) || term.includes(target)))
    .sort((first, second) => second.term.length - first.term.length)[0];
  return contained?.entry.id || null;
}

function explicitSymbolFromText(text, strategies = []) {
  const source = String(text || "");
  const quoted = source.match(/\b([A-Za-z0-9]{2,24})\s*(?:[/_-]\s*)?(USDT|USDC|USD)\b/iu);
  if (quoted) return normalizeSymbol(`${quoted[1]}${quoted[2]}`);
  const strategyTerms = new Set(strategyCatalogEntries(strategies).flatMap((entry) => entry.terms));
  const candidates = source.match(/\b[A-Za-z][A-Za-z0-9]{1,11}\b/gu) || [];
  for (const candidate of candidates) {
    const normalized = candidate.toUpperCase();
    if (COMMON_CRYPTO_BASE_ASSETS.has(normalized) && !strategyTerms.has(compactSemanticTerm(candidate))) {
      return normalizeSymbol(normalized);
    }
  }
  return null;
}

function explicitIntervalFromText(text) {
  const source = String(text || "");
  const hour = source.match(/(\d+(?:\.\d+)?)\s*(?:h(?:ours?)?|小时)/iu);
  if (hour) return normalizeInterval(`${hour[1]}h`);
  const minute = source.match(/(\d+)\s*(?:m(?:in(?:ute)?s?)?|分钟|分)/iu);
  if (minute) return normalizeInterval(`${minute[1]}m`);
  if (/(?:1\s*d|日线|日级别|日周期|daily)/iu.test(source)) return "1D";
  if (/(?:1\s*w|周线|周级别|周周期|weekly)/iu.test(source)) return "1W";
  return null;
}

export function repairExternalTradingRoutingFromText({ text, route = {}, strategies = [] } = {}) {
  const source = String(text || "");
  const compactSource = compactSemanticTerm(source);
  const strategyId = resolveStrategyId(route.strategyId, strategies)
    || strategyCatalogEntries(strategies).find((entry) => entry.terms.some((term) => term.length >= 2 && compactSource.includes(term)))?.id
    || null;
  const symbol = route.symbol || explicitSymbolFromText(source, strategies);
  const interval = route.interval || explicitIntervalFromText(source);
  const repaired = {
    ...route,
    strategyId,
    symbol,
    interval,
    lookbackMs: route.lookbackMs ?? null,
    lookbackLabel: route.lookbackLabel ?? null,
  };
  if (strategyId && symbol && interval && (route.mode === "analysis" || EXPLICIT_ANALYSIS_SIGNAL.test(source))) {
    return {
      ...repaired,
      mode: "analysis",
      confidence: Math.max(Number(route.confidence) || 0, 0.96),
      clarificationQuestion: null,
    };
  }
  return repaired;
}

function normalizeLookback(value, label) {
  if (value == null && label == null) return { lookbackMs: null, lookbackLabel: null };
  const lookbackMs = Number(value);
  const lookbackLabel = String(label || "").trim().slice(0, 32);
  if (!Number.isInteger(lookbackMs) || lookbackMs < 60_000 || lookbackMs > MAX_LOOKBACK_MS || !lookbackLabel) {
    throw new TypeError("External trading router lookback is invalid");
  }
  return { lookbackMs, lookbackLabel };
}

function strategyCatalogText(strategies = []) {
  return strategies
    .filter((strategy) => strategy?.enabled !== false)
    .map((strategy) => {
      const aliases = Array.isArray(strategy.mentions?.aliases) && strategy.mentions.aliases.length
        ? `；别名：${strategy.mentions.aliases.join("、")}`
        : "";
      return `- ${strategy.id}: ${strategy.display?.name || strategy.id}${aliases}`;
    })
    .join("\n");
}

export function buildExternalTradingRoutingPrompt({ text, strategies = [], pendingContext = "" } = {}) {
  const payload = {
    text: String(text || "").slice(0, 12_000),
    pendingContext: String(pendingContext || "").slice(0, 12_000),
  };
  return [
    "你是 Haolo 外部通道的交易请求语义路由器，只负责判断是否需要真实行情策略分析，不回答用户问题。",
    "用户可以用完全自然、口语化、没有固定格式的中文或英文表达；必须理解同义表达，例如“帮我看下BTC 1h的K线用缠论来分析”“按波浪看看”“这个币现在怎么走”。",
    "只有用户明确要求读取当前/最近 K 线、复盘盘面、分析趋势或使用某个策略分析时，才返回 analysis。只问概念、规则或泛泛知识时返回 conversation。",
    "analysis 必须选择一个已安装且 enabled 的 strategyId。无法确定策略、缺少交易对或缺少周期时返回 clarification。不要擅自猜测交易对或周期。交易对可以是 BTC 这类基础资产，输出时仍写 BTC；宿主会解析为 BTCUSDT。",
    "lookbackMs/lookbackLabel 只有用户明确给出范围时才填写；没有范围时设为 null，宿主会按策略最低数据要求读取足够 K 线。",
    "输出必须是单个 JSON 对象，不要 Markdown 或 JSON 之外的文字。字段必须且只能包含：",
    JSON.stringify({
      schemaVersion: EXTERNAL_TRADING_ROUTING_SCHEMA_VERSION,
      mode: "analysis、conversation 或 clarification",
      strategyId: "已安装策略 id；非 analysis 时为 null",
      symbol: "用户明确写出的交易对或基础资产；否则 null",
      interval: "分钟数字字符串、1D 或 1W；例如 1h 输出 60；否则 null",
      lookbackMs: "明确范围对应的整数毫秒；否则 null",
      lookbackLabel: "明确范围的简短中文；否则 null",
      confidence: "0 到 1",
      clarificationQuestion: "需要用户补充时的一句自然中文问题，否则 null",
    }),
    "已安装策略：",
    strategyCatalogText(strategies),
    "当 mode=clarification 时，问题要直接说明缺少什么，例如“你想用哪种策略？请说缠论、波浪理论或威科夫。”或“请补充交易对和周期，例如 BTC 1h。”不要要求用户遵守固定命令格式。",
    "用户输入：",
    JSON.stringify(payload),
  ].join("\n");
}

export function normalizeExternalTradingRoutingModelResponse(text, strategies = []) {
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("External trading router response is invalid");
  }
  assertExactKeys(parsed);
  if (Number(parsed.schemaVersion) !== EXTERNAL_TRADING_ROUTING_SCHEMA_VERSION) {
    throw new TypeError("External trading router schemaVersion is invalid");
  }
  const mode = ["analysis", "conversation", "clarification"].includes(parsed.mode)
    ? parsed.mode
    : null;
  if (!mode) throw new TypeError("External trading router mode is invalid");
  const confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new TypeError("External trading router confidence is invalid");
  }
  const availableIds = new Set(
    strategies.filter((strategy) => strategy?.enabled !== false).map((strategy) => String(strategy.id || "").trim()).filter(Boolean),
  );
  const rawStrategyId = parsed.strategyId == null || String(parsed.strategyId).trim() === ""
    ? null
    : String(parsed.strategyId).trim();
  const strategyId = rawStrategyId ? resolveStrategyId(rawStrategyId, strategies) : null;
  if (rawStrategyId && (!strategyId || !availableIds.has(strategyId))) {
    throw new TypeError("External trading router strategy is unavailable");
  }
  const symbol = normalizeSymbol(parsed.symbol);
  const interval = normalizeInterval(parsed.interval);
  const lookback = normalizeLookback(parsed.lookbackMs, parsed.lookbackLabel);
  const clarificationQuestion = String(parsed.clarificationQuestion || "").replace(/\u0000/g, "").trim().slice(0, 240) || null;
  const canAnalyze = mode === "analysis" && strategyId && symbol && interval && confidence >= EXTERNAL_TRADING_ROUTING_CONFIDENCE_THRESHOLD;
  const acceptedMode = canAnalyze ? "analysis" : mode === "conversation" && confidence >= EXTERNAL_TRADING_ROUTING_CONFIDENCE_THRESHOLD ? "conversation" : "clarification";
  return {
    mode: acceptedMode,
    strategyId: acceptedMode === "conversation" ? null : strategyId,
    symbol: acceptedMode === "conversation" ? null : symbol,
    interval: acceptedMode === "conversation" ? null : interval,
    lookbackMs: acceptedMode === "conversation" ? null : lookback.lookbackMs,
    lookbackLabel: acceptedMode === "conversation" ? null : lookback.lookbackLabel,
    confidence,
    clarificationQuestion,
  };
}
