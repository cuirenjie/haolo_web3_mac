export const TRADING_WAVE_INSUFFICIENT_DATA_CODE = "TRADING_WAVE_INSUFFICIENT_DATA";
export const TRADING_WAVE_AUTO_EXPANSION_MAX_CANDLES = 2_500;
export const TRADING_WAVE_HISTORY_BATCH_CANDLES = 500;
export const TRADING_CHAN_INSUFFICIENT_DATA_CODE = "TRADING_CHAN_INSUFFICIENT_DATA";
export const TRADING_CHAN_AUTO_EXPANSION_MAX_CANDLES = 600;
export const TRADING_CHAN_HISTORY_BATCH_CANDLES = 500;
export const TRADING_WYCKOFF_INSUFFICIENT_DATA_CODE = "TRADING_WYCKOFF_INSUFFICIENT_DATA";
export const TRADING_WYCKOFF_AUTO_EXPANSION_MAX_CANDLES = 600;
export const TRADING_WYCKOFF_HISTORY_BATCH_CANDLES = 500;
export const TRADING_CANDLE_WINDOW_INSUFFICIENT_DATA_CODE = "TRADING_CANDLE_WINDOW_INSUFFICIENT_DATA";
export const TRADING_CANDLE_WINDOW_AUTO_EXPANSION_MAX_CANDLES = 600;
export const TRADING_CANDLE_WINDOW_HISTORY_BATCH_CANDLES = 500;

const TRADING_WAVE_MIN_EXPANDED_CANDLES = 120;

export interface TradingWaveExpansionCandle {
  time: number;
}

export interface TradingWaveExpansionResponse {
  ok?: boolean;
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
  };
}

export type TradingAnalysisExpansionResponse = TradingWaveExpansionResponse;

export type TradingWaveExpansionEvent =
  | {
      type: "window";
      fromCount: number;
      toCount: number;
    }
  | {
      type: "history";
      candleCount: number;
      maxCandleCount: number;
    };

export type TradingAnalysisExpansionEvent = TradingWaveExpansionEvent;

export interface TradingWaveAutoExpansionResult<
  Candle extends TradingWaveExpansionCandle,
  Response extends TradingWaveExpansionResponse,
> {
  response: Response;
  candles: Candle[];
  attemptCounts: number[];
  historyLoadCount: number;
  exhausted: boolean;
}

export type TradingAnalysisAutoExpansionResult<
  Candle extends TradingWaveExpansionCandle,
  Response extends TradingAnalysisExpansionResponse,
> = TradingWaveAutoExpansionResult<Candle, Response>;

export function isTradingAnalysisInsufficientDataResponse(
  response: TradingAnalysisExpansionResponse | null | undefined,
  insufficientDataCode: string,
) {
  return response?.ok !== true
    && response?.error?.code === insufficientDataCode;
}

export function isTradingWaveInsufficientDataResponse(
  response: TradingWaveExpansionResponse | null | undefined,
) {
  return isTradingAnalysisInsufficientDataResponse(
    response,
    TRADING_WAVE_INSUFFICIENT_DATA_CODE,
  );
}

export function nextTradingWaveAnalysisCandleCount(
  currentCount: number,
  availableCount: number,
  maxCandleCount = TRADING_WAVE_AUTO_EXPANSION_MAX_CANDLES,
) {
  const current = Math.max(0, Math.trunc(Number(currentCount) || 0));
  const maximum = Math.max(current, Math.trunc(Number(maxCandleCount) || 0));
  const available = Math.min(
    maximum,
    Math.max(current, Math.trunc(Number(availableCount) || 0)),
  );
  if (current >= available) return current;
  return Math.min(available, Math.max(TRADING_WAVE_MIN_EXPANDED_CANDLES, current * 2));
}

function candlesThroughTime<Candle extends TradingWaveExpansionCandle>(
  candles: ReadonlyArray<Candle>,
  endTime: number,
) {
  const byTime = new Map<number, Candle>();
  for (const candle of candles) {
    const time = Number(candle?.time);
    if (!Number.isFinite(time) || time > endTime) continue;
    byTime.set(time, candle);
  }
  return [...byTime.values()].sort((first, second) => first.time - second.time);
}

export async function runTradingWaveAnalysisWithAutoExpansion<
  Candle extends TradingWaveExpansionCandle,
  Response extends TradingWaveExpansionResponse,
>(options: {
  initialCandles: ReadonlyArray<Candle>;
  getAvailableCandles: () => ReadonlyArray<Candle>;
  analyze: (candles: ReadonlyArray<Candle>) => Promise<Response>;
  loadMoreHistory?: () => Promise<unknown>;
  onExpansion?: (event: TradingWaveExpansionEvent) => void;
  maxCandleCount?: number;
}): Promise<TradingWaveAutoExpansionResult<Candle, Response>> {
  return runTradingAnalysisWithAutoExpansion({
    ...options,
    insufficientDataCode: TRADING_WAVE_INSUFFICIENT_DATA_CODE,
  });
}

export async function runTradingAnalysisWithAutoExpansion<
  Candle extends TradingWaveExpansionCandle,
  Response extends TradingAnalysisExpansionResponse,
>(options: {
  initialCandles: ReadonlyArray<Candle>;
  getAvailableCandles: () => ReadonlyArray<Candle>;
  analyze: (candles: ReadonlyArray<Candle>) => Promise<Response>;
  insufficientDataCode: string;
  loadMoreHistory?: () => Promise<unknown>;
  onExpansion?: (event: TradingAnalysisExpansionEvent) => void;
  maxCandleCount?: number;
}): Promise<TradingAnalysisAutoExpansionResult<Candle, Response>> {
  let analysisCandles = [...options.initialCandles];
  if (!analysisCandles.length) throw new TypeError("initialCandles is required");
  const insufficientDataCode = String(options.insufficientDataCode || "").trim();
  if (!insufficientDataCode) throw new TypeError("insufficientDataCode is required");
  const analysisEndTime = Math.max(...analysisCandles.map((candle) => Number(candle.time)));
  if (!Number.isFinite(analysisEndTime)) throw new TypeError("initialCandles contains invalid time");
  const maxCandleCount = Math.max(
    analysisCandles.length,
    Math.trunc(Number(options.maxCandleCount) || TRADING_WAVE_AUTO_EXPANSION_MAX_CANDLES),
  );
  const attemptCounts: number[] = [];
  let historyLoadCount = 0;

  while (true) {
    attemptCounts.push(analysisCandles.length);
    const response = await options.analyze(analysisCandles);
    if (!isTradingAnalysisInsufficientDataResponse(response, insufficientDataCode)) {
      return {
        response,
        candles: analysisCandles,
        attemptCounts,
        historyLoadCount,
        exhausted: false,
      };
    }

    const availableCandles = candlesThroughTime(options.getAvailableCandles(), analysisEndTime);
    const nextCount = nextTradingWaveAnalysisCandleCount(
      analysisCandles.length,
      availableCandles.length,
      maxCandleCount,
    );
    if (nextCount > analysisCandles.length) {
      options.onExpansion?.({
        type: "window",
        fromCount: analysisCandles.length,
        toCount: nextCount,
      });
      analysisCandles = availableCandles.slice(-nextCount);
      continue;
    }

    if (!options.loadMoreHistory || availableCandles.length >= maxCandleCount) {
      return {
        response,
        candles: analysisCandles,
        attemptCounts,
        historyLoadCount,
        exhausted: true,
      };
    }

    options.onExpansion?.({
      type: "history",
      candleCount: availableCandles.length,
      maxCandleCount,
    });
    await options.loadMoreHistory();
    historyLoadCount += 1;
    const updatedAvailableCandles = candlesThroughTime(options.getAvailableCandles(), analysisEndTime);
    if (updatedAvailableCandles.length <= availableCandles.length) {
      return {
        response,
        candles: analysisCandles,
        attemptCounts,
        historyLoadCount,
        exhausted: true,
      };
    }
    const expandedCount = nextTradingWaveAnalysisCandleCount(
      analysisCandles.length,
      updatedAvailableCandles.length,
      maxCandleCount,
    );
    if (expandedCount > analysisCandles.length) {
      options.onExpansion?.({
        type: "window",
        fromCount: analysisCandles.length,
        toCount: expandedCount,
      });
      analysisCandles = updatedAvailableCandles.slice(-expandedCount);
    }
  }
}
