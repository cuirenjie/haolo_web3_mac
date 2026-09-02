export type TradingQuestionKind =
  | "direction"
  | "entry"
  | "stop"
  | "target"
  | "support_resistance"
  | "pattern"
  | "explanation"
  | "position_risk"
  | "concept"
  | "general";

export interface ExplicitTradingParameters {
  symbol: string | null;
  interval: string | null;
  lookbackMs: number | null;
  lookbackLabel: string | null;
  forecastHorizonMs: number | null;
}

export interface TradingRoutingRequest extends ExplicitTradingParameters {
  mode: "conversation" | "chart-analysis";
  instruction: string;
  questionKinds: readonly TradingQuestionKind[];
  drawingRequested: boolean;
  analysisFollowup?: boolean;
}

export interface TradingStrategyRoutingManifest {
  mentions?: { canonical?: string; aliases?: readonly string[] };
  display?: { name?: string };
}

export function normalizeTradingRoutingText(value: unknown): string;
export function normalizeTradingRoutingSymbol(value: unknown): string | null;
export function explicitNoDrawingRequested(text: unknown): boolean;
export function isTradingConceptOnlyRequest(text: unknown): boolean;
export function explicitTradingSymbolFromText(text: unknown, options?: { excludedTerms?: readonly string[] }): string | null;
export function explicitTradingIntervalFromText(text: unknown): string | null;
export function explicitTradingLookbackFromText(text: unknown): { lookbackMs: number | null; lookbackLabel: string | null };
export function explicitTradingForecastHorizonFromText(text: unknown): number | null;
export function extractExplicitTradingParameters(text: unknown, options?: { excludedTerms?: readonly string[] }): ExplicitTradingParameters;
export function isExplicitMarketAnalysisRequest(text: unknown): boolean;
export function classifyTradingQuestionKinds(text: unknown): readonly TradingQuestionKind[];
export function deterministicMarketChartRouting(text: unknown, options?: { excludedTerms?: readonly string[] }): {
  request: TradingRoutingRequest;
  classification: { schemaVersion: 1; mode: "chart-analysis"; intent: "chart-analysis" | "chart-drawing"; confidence: 1; source: string };
} | null;
export function deterministicStrategyRequestRouting(text: unknown, manifest?: TradingStrategyRoutingManifest): TradingRoutingRequest;
export const deterministicStrategyChartRouting: typeof deterministicStrategyRequestRouting;
