export function binanceCandleBackfillLimit(startTime: number | undefined, sourceMs: number | null, marketType: string, now?: number): number;
export function binanceCandleHistoryComplete(candles: ReadonlyArray<{time: number; closed?: boolean}>, sourceMs: number | null, now?: number, sourceInterval?: string | null): boolean;
