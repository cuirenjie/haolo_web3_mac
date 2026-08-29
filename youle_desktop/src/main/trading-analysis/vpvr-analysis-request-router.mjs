export const VPVR_ANALYSIS_ROUTING_SCHEMA_VERSION = 1;

const TOKENS = [
  "@指标:VPVR", "@指标：VPVR", "@指标:VPVR分析", "@指标：VPVR分析",
  "@指标:可见范围成交量分布", "@指标：可见范围成交量分布",
  "@指标:成交量分布", "@指标：成交量分布", "@指标:Volume Profile", "@指标：Volume Profile",
];

export function stripVpvrAnalysisMentionLiteral(text) {
  let source = String(text || "");
  for (const token of TOKENS) source = source.split(token).join("");
  return source.trim();
}

export function buildVpvrAnalysisRequestRoutingPrompt(params = {}) {
  return [
    "你是 Haolo VPVR 指标分析请求路由器，只分类，不执行分析。",
    '输出单个 JSON：{"schemaVersion":1,"mode":"conversation 或 chart-analysis","intent":"expert-question、screenshot-question、chart-analysis 或 chart-drawing","symbol":null,"interval":null,"lookbackMs":null,"lookbackLabel":null,"confidence":0到1}。',
    "涉及当前图表可见范围成交量分布、POC、70%价值区、VAH、VAL、HVN、LVN、成交量密集区、支撑或阻力时使用 chart-analysis；仅问概念时使用 conversation。",
    "只发送 VPVR mention 时分析当前可见画布并绘制支撑阻力。结论只允许说明支撑、阻力以及 VPVR 能揭示的市场接受度和成交分布信息，不生成方向、入场、止损、止盈、仓位或订单。",
    "除非用户明确要求固定回看区间，否则 lookbackMs 和 lookbackLabel 必须为 null。未明确指定的品种与周期必须为 null。",
    `用户输入：${JSON.stringify({ text: String(params.text || "").slice(0, 12_000), hasImageAttachment: params.hasImageAttachment === true, hasCurrentAnalysis: params.hasCurrentAnalysis === true })}`,
  ].join("\n");
}

export function normalizeVpvrAnalysisRequestRoutingModelResponse(text, userText, context = {}) {
  const parsed = JSON.parse(String(text || "").trim());
  if (Number(parsed?.schemaVersion) !== 1) throw new TypeError("VPVR router schemaVersion is invalid");
  const chart = parsed.mode === "chart-analysis" && Number(parsed.confidence) >= 0.65;
  return {
    classification: { schemaVersion: 1, mode: parsed.mode, intent: parsed.intent, confidence: Number(parsed.confidence) },
    request: {
      mode: chart ? "chart-analysis" : "conversation",
      instruction: stripVpvrAnalysisMentionLiteral(userText),
      symbol: chart && typeof parsed.symbol === "string" ? parsed.symbol : null,
      interval: chart && typeof parsed.interval === "string" ? parsed.interval : null,
      lookbackMs: chart && Number.isInteger(parsed.lookbackMs) ? parsed.lookbackMs : null,
      lookbackLabel: chart && typeof parsed.lookbackLabel === "string" ? parsed.lookbackLabel : null,
      drawingRequested: chart && (parsed.intent === "chart-drawing" || context.hasCurrentAnalysis !== true),
    },
  };
}
