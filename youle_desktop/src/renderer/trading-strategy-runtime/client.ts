import {
  normalizeTradingStrategyRequest,
  type TradingStrategyCatalogItem,
  type TradingStrategyRequest,
} from "./catalog";

export interface TradingStrategyDesktopClient {
  classifyTradingStrategyRequest?(params: {
    strategyId: string;
    text: string;
    hasImageAttachment?: boolean;
    hasCurrentAnalysis?: boolean;
    model?: string | null;
    reasoningEffort?: "max";
  }): Promise<unknown>;
  listTradingStrategies?(): Promise<unknown>;
}

export async function classifyTradingStrategyForSend(
  client: TradingStrategyDesktopClient,
  strategy: TradingStrategyCatalogItem,
  text: string,
  hasImageAttachment: boolean,
  hasCurrentAnalysis = false,
  model?: string | null,
): Promise<TradingStrategyRequest> {
  if (typeof client.classifyTradingStrategyRequest !== "function") {
    return normalizeTradingStrategyRequest(strategy, text, null);
  }
  try {
    const result = await client.classifyTradingStrategyRequest({
      strategyId: strategy.id,
      text,
      hasImageAttachment,
      hasCurrentAnalysis,
      model,
      reasoningEffort: "max",
    }) as { ok?: boolean; request?: unknown } | null;
    return normalizeTradingStrategyRequest(
      strategy,
      text,
      result?.ok === true ? result.request : null,
    );
  } catch {
    return normalizeTradingStrategyRequest(strategy, text, null);
  }
}
