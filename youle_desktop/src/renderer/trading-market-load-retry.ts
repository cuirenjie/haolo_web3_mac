const MARKET_LOAD_RETRY_WINDOW_MS = 30_000;
const MARKET_LOAD_RETRY_INTERVAL_MS = 1_500;

// Keep the initial chart loading state through short gateway/network outages.
// The deadline covers requests and backoff together, including a hung request.
export async function retryTradingMarketLoad<T>(
  load: (signal: AbortSignal) => Promise<T>,
  options: {
    signal: AbortSignal;
    shouldRetry: (error: unknown) => boolean;
    cooldownRemaining: () => number;
  },
): Promise<T> {
  options.signal.throwIfAborted();
  const controller = new AbortController();
  let lastError: unknown;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => controller.abort(options.signal.reason);
  options.signal.addEventListener("abort", cancel, { once: true });
  const deadline = setTimeout(() => controller.abort(
    lastError ?? new Error("行情加载失败"),
  ), MARKET_LOAD_RETRY_WINDOW_MS);
  let rejectCancelled!: (reason: unknown) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
  const onAbort = () => rejectCancelled(controller.signal.reason);
  controller.signal.addEventListener("abort", onAbort, { once: true });
  const wait = (ms: number) => Promise.race([
    new Promise<void>((resolve) => { retryTimer = setTimeout(resolve, ms); }),
    cancelled,
  ]);
  try {
    while (true) {
      controller.signal.throwIfAborted();
      // A cooldown may have been set by another chart or the watchlist.
      const cooldown = options.cooldownRemaining();
      if (cooldown > 0) {
        await wait(cooldown);
        continue;
      }
      try {
        return await Promise.race([load(controller.signal), cancelled]);
      } catch (error) {
        controller.signal.throwIfAborted();
        if (!options.shouldRetry(error)) throw error;
        lastError = error;
        const retryAfterMs = Number((error as { retryAfterMs?: number })?.retryAfterMs);
        await wait(Math.max(
          MARKET_LOAD_RETRY_INTERVAL_MS,
          Number.isFinite(retryAfterMs) ? retryAfterMs : 0,
          options.cooldownRemaining(),
        ));
      }
    }
  } finally {
    clearTimeout(deadline);
    clearTimeout(retryTimer);
    options.signal.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
