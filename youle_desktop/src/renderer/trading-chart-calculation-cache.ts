type CandleTime = { time: number };
type Change = { source: readonly CandleTime[]; revision: number; from: number };
type Entry = { revision: number; values: number[]; sums: number[] };
const changes = new WeakMap<readonly number[], Change>();

/** A hint is valid only for the exact candle input used by the calculator. */
export function tradingChartValuesChange(values: readonly number[], candles: readonly CandleTime[]) {
  const change = changes.get(values);
  return change?.source === candles ? change : undefined;
}

/** Retain recursive state at each closed bar. Re-evaluating an open bar starts
 * from its predecessor, never from the previous tick's provisional result.
 * One prefix comparison also detects corrections, backfill and time changes.
 * Arithmetic order matches the existing full-history calculators, including
 * the rolling-sum (main chart) vs window-sum (sub/split chart) distinction.
 */
export class TradingChartCalculationCache {
  private source: readonly CandleTime[] = [];
  private times: number[] = [];
  private input: number[] = [];
  private entries = new Map<string, Entry>();
  private revision = 0;
  private changedFrom = 0;

  update(values: readonly number[], candles: readonly CandleTime[]) {
    let from = 0;
    while (from < values.length && from < this.input.length
      && Object.is(values[from], this.input[from]) && candles[from]?.time === this.times[from]) from++;
    this.changedFrom = from;
    this.source = candles;
    this.revision++;
    for (const [key, entry] of this.entries) if (entry.revision < this.revision - 1) this.entries.delete(key);
    this.input.length = this.times.length = values.length;
    for (let i = from; i < values.length; i++) { this.input[i] = values[i]; this.times[i] = candles[i]?.time; }
  }

  private entry(key: string) {
    let entry = this.entries.get(key);
    if (!entry) { entry = { revision: 0, values: [], sums: [] }; this.entries.set(key, entry); }
    const from = entry.revision === this.revision ? this.input.length
      : entry.revision === this.revision - 1 ? this.changedFrom : 0;
    entry.values.length = entry.sums.length = this.input.length;
    entry.revision = this.revision;
    changes.set(entry.values, { source: this.source, revision: this.revision, from: this.changedFrom });
    return { entry, from };
  }

  sma(period: number, windowed = false) {
    const { entry, from } = this.entry(`sma:${period}:${windowed}`), { values, sums } = entry;
    for (let i = from; i < this.input.length; i++) {
      values[i] = Number.NaN;
      if (period <= 0 || i < period - 1) continue;
      let sum = 0;
      // Seed once for rolling sums; finite window sums deliberately restart.
      if (!windowed && i > period - 1) sum = sums[i - 1] + (this.input[i] - this.input[i - period]);
      else for (let j = i - period + 1; j <= i; j++) sum += windowed && !Number.isFinite(this.input[j]) ? Number.NaN : this.input[j];
      sums[i] = sum;
      values[i] = sum / period;
    }
    return values;
  }

  ema(period: number, finiteSeed = false) {
    const { entry, from } = this.entry(`ema:${period}:${finiteSeed}`), { values } = entry;
    const first = finiteSeed ? this.input.findIndex(Number.isFinite) : 0;
    const seed = first + period - 1, factor = 2 / (period + 1);
    for (let i = from; i < this.input.length; i++) {
      values[i] = Number.NaN;
      if (first < 0 || period <= 0 || i < seed) continue;
      if (i === seed) {
        let sum = 0;
        for (let j = first; j <= seed; j++) sum += finiteSeed && !Number.isFinite(this.input[j]) ? Number.NaN : this.input[j];
        values[i] = sum / period;
      } else if (!finiteSeed || Number.isFinite(this.input[i])) values[i] = this.input[i] * factor + values[i - 1] * (1 - factor);
    }
    return values;
  }

  boll(period: number, multiplier: number, windowed = false) {
    const middle = this.sma(period, windowed);
    const upper = this.entry(`boll-upper:${period}:${multiplier}:${windowed}`);
    const lower = this.entry(`boll-lower:${period}:${multiplier}:${windowed}`);
    for (let i = upper.from; i < this.input.length; i++) {
      let variance = 0;
      for (let j = Math.max(0, i - period + 1); j <= i; j++) variance += (this.input[j] - middle[i]) ** 2;
      const deviation = Math.sqrt(variance / period) * multiplier;
      upper.entry.values[i] = middle[i] + deviation;
      lower.entry.values[i] = middle[i] - deviation;
    }
    return { upper: upper.entry.values, middle, lower: lower.entry.values };
  }

  bbi(periods: readonly number[], windowed = false) {
    const averages = periods.map(period => this.sma(period, windowed));
    const { entry, from } = this.entry(`bbi:${periods.join(',')}:${windowed}`);
    for (let i = from; i < this.input.length; i++) {
      let sum = 0;
      for (const average of averages) { const value = average[i]; sum += Number.isFinite(value) ? value : Number.NaN; }
      entry.values[i] = sum / averages.length;
    }
    return entry.values;
  }
}
