export const IFIND_BUSINESS_ENABLED: boolean;
export function tradingMarketUnavailableMessage(language?: string): string;
export function tradingMarketAvailable(market: { id?: string; provider?: string; assetClass?: string } | null | undefined): boolean;
