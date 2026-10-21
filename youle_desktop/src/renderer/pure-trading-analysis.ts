import { OFFICIAL_TRADING_CATALOG } from "../shared/official-trading-catalog.mjs";
import type { TradingStrategyCatalogItem, TradingStrategyRequest } from "./trading-strategy-runtime/catalog";
import type { TradingAnalysisTaskTarget } from "./trading-expert-market";

const cloudModels = new Set(["deepseek-flash", "gpt-5.6-sol", "gpt-6-sol", "gpt-6-astra"]);
const officialIds = new Set(OFFICIAL_TRADING_CATALOG.map(item => item.id));
const normalize = (text: string) => text.normalize("NFKC").trim().toLowerCase().replace(/\s*:\s*/gu, ":");

export interface PureTradingAnalysis {
  strategy: TradingStrategyCatalogItem;
  target: TradingAnalysisTaskTarget;
  model: string;
  explicitModelSelection: boolean;
  instruction: string;
}

/** A whole-token shortcut, deliberately not a natural-language intent router. */
export function resolvePureTradingAnalysis(input: {
  text: string;
  catalog: readonly TradingStrategyCatalogItem[];
  target: TradingAnalysisTaskTarget | null;
  desktopExecution: boolean;
  busy: boolean;
  pendingWorkflow: boolean;
  attachments: readonly unknown[];
  references: readonly unknown[];
  quote: unknown;
  model: string;
  explicitModelSelection: boolean;
}): PureTradingAnalysis | null {
  if (!input.desktopExecution || input.busy || input.pendingWorkflow || !input.target
    || input.attachments.length || input.references.length || input.quote
    || !cloudModels.has(input.model) || !input.target.marketId || !input.target.interval) return null;
  const source = normalize(input.text);
  const matches = input.catalog.filter(item => item.enabled !== false
    && officialIds.has(item.id) && item.implementation.kind === "cloud-v1"
    && item.capabilities.includes("chart-analysis")
    && item.mentionTokens.some(token => normalize(token) === source));
  if (matches.length !== 1) return null;
  return Object.freeze({ strategy: matches[0], target: input.target, model: input.model,
    explicitModelSelection: input.explicitModelSelection, instruction: input.text });
}

export function pureTradingAnalysisRequest(selection: PureTradingAnalysis, userItemId: string): TradingStrategyRequest {
  return {
    mode: "chart-analysis", instruction: selection.instruction,
    // An explicit symbol tells the existing runner to resolve a new chart. Use
    // the captured target instead, including its viewport and split panes.
    marketId: selection.target.marketId, symbol: null, interval: selection.target.interval,
    lookbackMs: null, lookbackLabel: null, drawingRequested: true, deferPresentation: false,
    drawingTurnId: userItemId,
    executionModel: { model: selection.model, explicitModelSelection: selection.explicitModelSelection },
  };
}
