// Request size is a weight decision, not a promise about how many rows exist.
export function binanceCandleBackfillLimit(startTime, sourceMs, marketType, now = Date.now()) {
  if (startTime == null) return 2;
  const span = Number(sourceMs);
  const missing = span > 0 ? Math.ceil(Math.max(0, now - Number(startTime)) / span) + 2 : 499;
  return Math.max(2, Math.min(marketType === "spot" ? 1000 : 499, missing));
}

export function binanceCandleHistoryComplete(candles, sourceMs, now, sourceInterval = null) {
  if (!Array.isArray(candles) || !candles.length) return false;
  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];
    if (Number(current.time) <= Number(previous.time)) return false;
    // Calendar months have a variable duration; their boundary is checked in UTC.
    if (sourceInterval === "1M") {
      const date = new Date(Number(previous.time) * 1000);
      const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000;
      if (current.time !== next) return false;
    } else if (sourceMs > 0 && (current.time - previous.time) * 1000 !== sourceMs) return false;
    if (previous.closed !== true) return false;
  }
  if (Number.isFinite(now) && sourceMs > 0) {
    const tail = Number(candles.at(-1).time) * 1000;
    const date = new Date(tail);
    const end = sourceInterval === "1M"
      ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
      : tail + sourceMs;
    if (tail > now || end <= now) return false;
  }
  return true;
}
