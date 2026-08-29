export const SMT_ROUTING_SCHEMA_VERSION = 1;
const KEYS = ["schemaVersion", "mode", "intent", "symbol", "interval", "lookbackMs", "lookbackLabel", "confidence"];

export function stripTradingSmtMentionLiteral(text) {
  return String(text || "").replace(/@策略[：:](?:SMT背离|SMT|Smart Money Technique)/gi, "").trim();
}

export function buildSmtDivergenceRequestRoutingPrompt(params = {}) {
  return [
    "你是 Haolo 的 SMT 背离请求路由器，只分类并提取主图参数，不做交易分析。",
    `只返回 JSON：${JSON.stringify({ schemaVersion: 1, mode: "conversation 或 chart-analysis", intent: "expert-question、screenshot-question、chart-analysis 或 chart-drawing", symbol: null, interval: null, lookbackMs: null, lookbackLabel: null, confidence: 1 })}`,
    "分析相关市场高低点未同步、SMT divergence、跨市场确认或要求绘图时使用 chart-analysis；概念与局限问题用 conversation。",
    "SMT 是 Smart Money Technique 的跨市场确认线索，不得扩写为已证实的操纵或独立入场信号。只提及策略时分析当前画布。",
    `上下文：${JSON.stringify({ text: String(params.text || "").slice(0, 12_000), hasImageAttachment: params.hasImageAttachment === true, hasCurrentAnalysis: params.hasCurrentAnalysis === true })}`,
  ].join("\n");
}

export function normalizeSmtDivergenceRequestRoutingModelResponse(text, userText, context = {}) {
  const source = String(text || "").trim();
  if (!source.startsWith("{") || !source.endsWith("}")) throw new TypeError("SMT router must return one JSON object");
  const parsed = JSON.parse(source);
  const keys = Object.keys(parsed || {}).sort();
  if (keys.length !== KEYS.length || keys.some((key, index) => key !== [...KEYS].sort()[index])) throw new TypeError("SMT router shape is invalid");
  const mode = parsed.mode === "chart-analysis" ? "chart-analysis" : parsed.mode === "conversation" ? "conversation" : null;
  const confidence = Number(parsed.confidence);
  if (!mode || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new TypeError("SMT router response is invalid");
  const accepted = mode === "chart-analysis" && confidence < 0.65 ? "conversation" : mode;
  const rawSymbol = parsed.symbol == null ? null : String(parsed.symbol).trim().toUpperCase();
  if (rawSymbol && !/^[A-Z0-9]{5,24}$/.test(rawSymbol)) throw new TypeError("SMT symbol is invalid");
  const rawInterval = parsed.interval == null ? null : String(parsed.interval).trim().toUpperCase();
  if (rawInterval && rawInterval !== "1D" && rawInterval !== "1W" && (!/^\d+$/.test(rawInterval) || Number(rawInterval) < 1 || Number(rawInterval) > 1_440)) throw new TypeError("SMT interval is invalid");
  const lookbackMs = parsed.lookbackMs == null ? null : Number(parsed.lookbackMs);
  if (lookbackMs !== null && (!Number.isSafeInteger(lookbackMs) || lookbackMs < 60_000 || lookbackMs > 5 * 366 * 86_400_000)) throw new TypeError("SMT lookback is invalid");
  return { classification: { schemaVersion: 1, mode, intent: String(parsed.intent || ""), confidence }, request: { mode: accepted, instruction: stripTradingSmtMentionLiteral(userText), symbol: accepted === "chart-analysis" ? rawSymbol : null, interval: accepted === "chart-analysis" ? rawInterval : null, lookbackMs: accepted === "chart-analysis" ? lookbackMs : null, lookbackLabel: accepted === "chart-analysis" && lookbackMs ? String(parsed.lookbackLabel || "").slice(0, 32) : null, drawingRequested: accepted === "chart-analysis" && (parsed.intent === "chart-drawing" || context.hasCurrentAnalysis !== true) } };
}
