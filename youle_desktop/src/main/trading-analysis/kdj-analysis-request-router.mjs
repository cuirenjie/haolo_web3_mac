export const KDJ_ANALYSIS_ROUTING_SCHEMA_VERSION = 1;

const TOKENS = [
  "@指标:KDJ", "@指标：KDJ", "@指标:KDJ指标", "@指标：KDJ指标",
  "@指标:KDJ分析", "@指标：KDJ分析", "@指标:随机指标KDJ", "@指标：随机指标KDJ",
  "@指标:随机指标", "@指标：随机指标",
];

export function stripKdjAnalysisMentionLiteral(text) {
  let source = String(text || "");
  for (const token of TOKENS) source = source.split(token).join("");
  return source.trim();
}

export function buildKdjAnalysisRequestRoutingPrompt(params = {}) {
  return [
    "你是 Haolo KDJ 指标分析请求路由器，只分类，不执行分析。",
    '输出单个 JSON：{"schemaVersion":1,"mode":"conversation 或 chart-analysis","intent":"expert-question、screenshot-question、chart-analysis 或 chart-drawing","symbol":null,"interval":null,"lookbackMs":null,"lookbackLabel":null,"confidence":0到1}。',
    "涉及当前图表的 KDJ(9,3,3)、K/D/J、80/20、金叉死叉、钝化、顶底背离、隐藏背离或画线时使用 chart-analysis；仅问概念使用 conversation。",
    "只发送 KDJ mention 时分析当前画布并绘图。未明确指定的行情参数必须为 null。",
    `用户输入：${JSON.stringify({ text: String(params.text || "").slice(0, 12_000), hasImageAttachment: params.hasImageAttachment === true, hasCurrentAnalysis: params.hasCurrentAnalysis === true })}`,
  ].join("\n");
}

export function normalizeKdjAnalysisRequestRoutingModelResponse(text, userText, context = {}) {
  const parsed = JSON.parse(String(text || "").trim());
  if (Number(parsed?.schemaVersion) !== 1) throw new TypeError("KDJ router schemaVersion is invalid");
  const chart = parsed.mode === "chart-analysis" && Number(parsed.confidence) >= 0.65;
  return {
    classification: { schemaVersion: 1, mode: parsed.mode, intent: parsed.intent, confidence: Number(parsed.confidence) },
    request: {
      mode: chart ? "chart-analysis" : "conversation",
      instruction: stripKdjAnalysisMentionLiteral(userText),
      symbol: chart && typeof parsed.symbol === "string" ? parsed.symbol : null,
      interval: chart && typeof parsed.interval === "string" ? parsed.interval : null,
      lookbackMs: chart && Number.isInteger(parsed.lookbackMs) ? parsed.lookbackMs : null,
      lookbackLabel: chart && typeof parsed.lookbackLabel === "string" ? parsed.lookbackLabel : null,
      drawingRequested: chart && (parsed.intent === "chart-drawing" || context.hasCurrentAnalysis !== true),
    },
  };
}
