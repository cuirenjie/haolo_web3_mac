export const ICT_SMC_ROUTING_SCHEMA_VERSION = 1;
export const ICT_SMC_ROUTING_CONFIDENCE_THRESHOLD = 0.65;

const EXACT_KEYS = ["schemaVersion", "mode", "intent", "symbol", "interval", "lookbackMs", "lookbackLabel", "confidence"];

export function stripTradingIctSmcMentionLiteral(text) {
  return String(text || "")
    .replace(/@策略[：:](?:ICT\/SMC|ICT|SMC|聪明钱概念|聪明钱)/gi, "")
    .trim();
}

export function buildIctSmcRequestRoutingPrompt(params = {}) {
  return [
    "你是 Haolo 的 ICT/SMC 请求路由器，只分类并提取用户明确写出的行情参数，不做交易分析。",
    `只返回 JSON：${JSON.stringify({ schemaVersion: 1, mode: "conversation 或 chart-analysis", intent: "expert-question、screenshot-question、chart-analysis 或 chart-drawing", symbol: null, interval: null, lookbackMs: null, lookbackLabel: null, confidence: 1 })}`,
    "分析流动性池/清扫、BOS、CHoCH、MSS、位移、FVG、订单块、Breaker、Premium/Discount、OTE 或要求绘图时用 chart-analysis。",
    "只有概念、规则、局限或截图讨论时用 conversation。只发送策略提及时按当前画布 chart-analysis。",
    "不得把 FVG 说成无成交区，不得把任意反向 K 线认作订单块，不得声称已经观察到机构主观意图。",
    `上下文：${JSON.stringify({ text: String(params.text || "").slice(0, 12_000), hasImageAttachment: params.hasImageAttachment === true, hasCurrentAnalysis: params.hasCurrentAnalysis === true })}`,
  ].join("\n");
}

function symbol(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toUpperCase();
  if (!/^[A-Z0-9_\p{Script=Han}]{5,24}$/u.test(normalized)) throw new TypeError("ICT/SMC symbol is invalid");
  return normalized;
}

function interval(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toUpperCase();
  if (normalized === "1D" || normalized === "1W") return normalized;
  if (!/^\d+$/.test(normalized) || Number(normalized) < 1 || Number(normalized) > 1_440) throw new TypeError("ICT/SMC interval is invalid");
  return String(Number(normalized));
}

export function normalizeIctSmcRequestRoutingModelResponse(text, userText, context = {}) {
  const source = String(text || "").trim();
  if (!source.startsWith("{") || !source.endsWith("}")) throw new TypeError("ICT/SMC router must return one JSON object");
  const parsed = JSON.parse(source);
  const keys = Object.keys(parsed || {}).sort();
  if (keys.length !== EXACT_KEYS.length || keys.some((key, index) => key !== [...EXACT_KEYS].sort()[index])) throw new TypeError("ICT/SMC router shape is invalid");
  if (Number(parsed.schemaVersion) !== 1) throw new TypeError("ICT/SMC router schema is invalid");
  const mode = parsed.mode === "chart-analysis" ? "chart-analysis" : parsed.mode === "conversation" ? "conversation" : null;
  if (!mode) throw new TypeError("ICT/SMC router mode is invalid");
  const confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new TypeError("ICT/SMC router confidence is invalid");
  const accepted = mode === "chart-analysis" && confidence < ICT_SMC_ROUTING_CONFIDENCE_THRESHOLD ? "conversation" : mode;
  const lookbackMs = parsed.lookbackMs == null ? null : Number(parsed.lookbackMs);
  if (lookbackMs !== null && (!Number.isSafeInteger(lookbackMs) || lookbackMs < 60_000 || lookbackMs > 5 * 366 * 86_400_000)) throw new TypeError("ICT/SMC lookback is invalid");
  const request = {
    mode: accepted,
    instruction: stripTradingIctSmcMentionLiteral(userText),
    symbol: accepted === "chart-analysis" ? symbol(parsed.symbol) : null,
    interval: accepted === "chart-analysis" ? interval(parsed.interval) : null,
    lookbackMs: accepted === "chart-analysis" ? lookbackMs : null,
    lookbackLabel: accepted === "chart-analysis" && lookbackMs ? String(parsed.lookbackLabel || "").trim().slice(0, 32) : null,
    drawingRequested: accepted === "chart-analysis" && (parsed.intent === "chart-drawing" || context.hasCurrentAnalysis !== true),
  };
  return { classification: { schemaVersion: 1, mode, intent: String(parsed.intent || ""), confidence }, request };
}
