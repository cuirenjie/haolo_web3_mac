export const NEWS_CATEGORIES: readonly ['featured', 'whales', 'main-force', 'market', 'listings', 'fed', 'trump'];
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];
