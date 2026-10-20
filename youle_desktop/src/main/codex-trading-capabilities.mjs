const schema = (properties, required = []) => ({ type: "object", additionalProperties: false, properties, required });
const string = { type: "string" };
const analysis = {
  instruction: string,
  analysisKind: { enum: ["general", "strategy"], description: "Use general for market explanations, trend/continuation questions and ordinary chart analysis; omit strategyId. Use strategy for requested strategy/indicator analysis, trading plans or position management. A price movement question alone is not a request for a plan." },
  strategyId: { type: "string", description: "Exact catalog ID for a requested strategy/indicator or trade plan. Omit for general market questions; do not default those questions to price-action." },
  symbol: string, interval: string, marketId: string,
  drawingRequested: { type: "boolean" }, positionManagementRequested: { type: "boolean" },
  lookbackMs: { type: "number" }, lookbackLabel: string,
};
export const TRADING_CAPABILITIES = [
  { name: "haolo_market", action: "market_data", description: "Read this turn's captured chart and market data (updated after successful chart_open), or discover the strategy/indicator catalog. Never borrows another conversation's chart.",
    inputSchema: schema({ operation: { enum: ["context", "catalog", "data"] } }, ["operation"]) },
  { name: "haolo_chart_open", action: "chart_open", description: "Open the requested trading pair and candle interval in this conversation before live analysis. Omitted interval defaults to 1h. Waits for matching candles and updates the turn's chart context; does not analyze, draw or create a plan.",
    inputSchema: schema({ symbol: { type: "string", description: "Exchange symbol or known Chinese name, e.g. ETHUSDT, 以太坊, 闪迪, 海力士, 美光, 黄金, 原油, 谷歌. Preserve the user's name; Host resolves known aliases and checks availability. Defaults to Binance perpetual unless marketId is supplied." },
      marketId: { type: "string", description: "Exact venue/product identity, e.g. BINANCE:SPOT:ETHUSDT. Preserve explicit venue and spot/futures." },
      interval: { type: "string", description: "Candle interval, e.g. 1h, 4h, 15m or chart resolution 60, 240. Omit for 1h; forecast horizon is not candle interval." } }) },
  { name: "haolo_account_read", action: "account_read", description: "Read authenticated Binance account facts before strategy or position analysis. An unbound account is reported explicitly; public analysis may continue.",
    inputSchema: schema({ sections: { type: "array", items: { enum: ["summary", "positions", "open_orders", "position_history", "wallet_breakdown"] } }, force: { type: "boolean" } }) },
  { name: "haolo_analysis", action: "analyze_only", description: "Run general market analysis or a requested strategy/indicator in the cloud engine. For desktop charts, use haolo_chart_open first; read account before analysis. General analysis returns evidence for your written final answer, without automatic drawings or a plan. Strategy analysis returns an immutable analysisRef for haolo_chart_draw and haolo_plan_present.",
    inputSchema: schema(analysis) },
  { name: "haolo_chart_draw", action: "draw", description: "Draw verified analysis patches through Drawing Gateway using analysisRef, or preview a completed draft simulation using draftRef. Supply exactly one. Does not run analysis or accept model-generated prices. Respect no-drawing requests.",
    inputSchema: schema({ analysisRef: string, draftRef: string }) },
  { name: "haolo_plan_present", action: "present", description: "Display a requested strategy/trading plan or position-management result using its analysisRef. General market explanations must be answered in final text and cannot be presented as an entry plan. Never recomputes prices or places orders; no-trade and missing-data results remain valid outcomes.",
    inputSchema: schema({ analysisRef: string, hasRemainingWork: { type: "boolean", description: "Set true when another requested deliverable or explanation remains after this card (including comparison of strategies). Otherwise the native report completes the response; do not repeat it in final text." } }, ["analysisRef"]) },
  { name: "haolo_alerts", action: "alert_step", description: "Prepare/revise an alert draft, confirm the current simulated draft using the actual user reply, cancel it, or manage existing owned alerts. Prepare never simulates or creates monitoring. Use haolo_simulation and haolo_chart_draw before confirmation.",
    inputSchema: schema({ operation:{enum:["prepare","confirm","cancel","list","pause","resume","delete"]},draftRef:string,alertId:string },["operation"]) },
  { name: "haolo_personal_strategy", action: "personal_step", description: "Prepare/revise a personal strategy from the actual message and attachments, confirm its simulated draft, cancel, or list strategies. Preparation never simulates or activates a strategy.",
    inputSchema: schema({ operation:{enum:["prepare","confirm","cancel","list"]},draftRef:string },["operation"]) },
  { name: "haolo_simulation", action: "simulate", description: "Run the existing deterministic K-line simulator for the current alert or personal-strategy draftRef. Returns verified synthetic data for haolo_chart_draw; never creates monitoring or live orders.",
    inputSchema: schema({draftRef:string},["draftRef"]) },
  { name: "haolo_plans", action: "plan_manage", description: "Read or manage owned cloud plans. add follows the existing Add to plan behavior (save then activate reminders). Uses current server versions and original plan values; never places orders.",
    inputSchema: schema({operation:{enum:["list","read","add","activate","end","delete"]},planId:string,endReason:{enum:["take_profit","stop_loss","cancelled","expired"]}},["operation"]) },
];

export function tradingCapabilityArguments(tool, args) {
  const capability = TRADING_CAPABILITIES.find(entry => entry.name === tool);
  if (!capability) return null;
  for (const key of Object.keys(args)) {
    if (!(key in capability.inputSchema.properties)) throw new Error(`Unexpected ${tool} argument: ${key}`);
    const spec = capability.inputSchema.properties[key], value = args[key];
    if (spec.type === "string" && (typeof value !== "string" || value.length > 12000) ||
        spec.type === "boolean" && typeof value !== "boolean" ||
        spec.type === "number" && (!Number.isFinite(value) || value <= 0) ||
        spec.enum && !spec.enum.includes(value) ||
        spec.type === "array" && (!Array.isArray(value) || !value.length || value.length > 5 || value.some(item => !spec.items.enum.includes(item)))) {
      throw new Error(`Invalid ${tool} argument: ${key}`);
    }
  }
  for (const key of capability.inputSchema.required) if (!args[key]) throw new Error(`Missing ${tool} argument: ${key}`);
  if (tool === "haolo_chart_draw" && Boolean(args.analysisRef) === Boolean(args.draftRef)) throw new Error("Supply exactly one analysisRef or draftRef.");
  if (["haolo_alerts","haolo_personal_strategy"].includes(tool) && args.operation === "confirm" && !args.draftRef) throw new Error("A current draftRef is required.");
  if (tool==="haolo_alerts" && ["pause","resume","delete"].includes(args.operation) && !args.alertId) throw new Error("An alertId is required.");
  if (tool==="haolo_plans" && args.operation!=="list" && !args.planId) throw new Error("A planId is required.");
  return { ...args, action: capability.action };
}

export const isTradingBusinessTool = name => name === "haolo_trading" || TRADING_CAPABILITIES.some(tool => tool.name === name);
