export function normalizeNewsVote(value: unknown, expectedId: string): {
  id: string; vote: number; bullish: number; bearish: number;
};
export function normalizeNewsItem(value: unknown): ReturnType<typeof normalizeNewsVote> & {
  title: string; content: string; timestamp: number; important: boolean; source: string; url: string;
  markets: Array<{ coin: string; quote: string; symbol: string; venue: string; marketType: string; changePercent: number | null }>;
};
