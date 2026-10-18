import { tradingChartValuesChange } from './trading-chart-calculation-cache.ts';

type Datum = Record<string, any>;
type Series = { setData(data: any[]): void; update(data: any): void };
const snapshots = new WeakMap<Series, Datum[]>();
const valueInputs = new WeakMap<Series, { values: readonly number[]; revision: number; length: number; offset: number }>();

/** Vite's version-guarded native adapter batches geometry/hover invalidation.
 * The fallback keeps non-browser fixtures and unpatched consumers compatible. */
export function withTradingChartSeriesBatch<T>(chart: unknown, paint: () => T): T {
  const api = chart as { haoloBatchUpdates?: (paint: () => T) => T } | null;
  return api?.haoloBatchUpdates ? api.haoloBatchUpdates(paint) : paint();
}

function equal(left: Datum, right: Datum) {
  if (left === right) return true;
  for (const key in left) if (key !== '_internal_originalTime' && !Object.is(left[key], right[key])) return false;
  for (const key in right) if (key !== '_internal_originalTime' && !(key in left)) return false;
  return true;
}

function copyDatum(datum: Datum) {
  // Native DataLayer.saveOriginalTime mutates its input. Keep its bookkeeping
  // out of comparisons and never pass our retained snapshot objects to it.
  const { _internal_originalTime: _ignored, ...copy } = datum;
  return copy;
}

/** The common price/whitespace paths avoid allocating thousands of identical
 * point objects before the incremental writer can discover an unchanged tail. */
export function setTradingChartPriceData(
  series: Series, candles: readonly {time: number; open: number; high: number; low: number; close: number}[],
  offset: number, closeLine: boolean,
) {
  const previous = snapshots.get(series);
  const data = candles.map((candle, i) => {
    const retained = previous?.[i], time = candle.time + offset;
    if (retained?.time === time && retained.color === undefined && retained.borderColor === undefined && retained.wickColor === undefined
      && (closeLine ? retained.value === candle.close && retained.open === undefined
        : retained.open === candle.open && retained.high === candle.high && retained.low === candle.low && retained.close === candle.close && retained.value === undefined)) return retained;
    return closeLine ? { time, value: candle.close } : { time, open: candle.open, high: candle.high, low: candle.low, close: candle.close };
  });
  setTradingChartSeriesData(series, data);
}

export function setTradingChartWhitespaceData(series: Series | null, candles: readonly {time: number}[], offset: number) {
  if (!series) return;
  const previous = snapshots.get(series);
  setTradingChartSeriesData(series, candles.map((candle, i) => {
    const time = candle.time + offset, retained = previous?.[i];
    return retained?.time === time && retained.value === undefined ? retained : { time };
  }));
}

/** Reuse unchanged indicator points instead of allocating an object per bar
 * and per series on every live refresh. Calculations remain authoritative. */
export function setTradingChartSeriesValues(
  series: Series, candles: readonly { time: number }[], values: readonly number[],
  timeOffset: number, colors?: readonly (string | undefined)[],
) {
  const change = !colors && tradingChartValuesChange(values, candles);
  const input = valueInputs.get(series);
  if (change && input?.values === values && input.revision === change.revision - 1
    && input.offset === timeOffset && values.length >= input.length && change.from >= input.length - 1) {
    const last = snapshots.get(series)?.at(-1);
    let removesTail = false;
    for (let i = change.from; last && i < candles.length; i++) {
      if (candles[i].time + timeOffset === last.time && !Number.isFinite(values[i])) removesTail = true;
    }
    if (!removesTail) {
      for (let i = change.from; i < values.length; i++) if (Number.isFinite(values[i]) && candles[i]) {
        updateTradingChartSeriesTail(series, { time: candles[i].time + timeOffset, value: values[i] });
      }
      valueInputs.set(series, { values, revision: change.revision, length: values.length, offset: timeOffset });
      return;
    }
  }
  const previous = snapshots.get(series), data: Datum[] = [];
  for (let index = 0; index < values.length; index++) {
    const value = values[index], candle = candles[index];
    if (!Number.isFinite(value) || !candle) continue;
    const time = candle.time + timeOffset, color = colors?.[index];
    const retained = previous?.[data.length];
    data.push(retained && retained.time === time && retained.value === value && retained.color === color
      ? retained : { time, value, ...(color ? { color } : {}) });
  }
  setTradingChartSeriesData(series, data);
  if (change) valueInputs.set(series, { values, revision: change.revision, length: values.length, offset: timeOffset });
}

/** All writes to an owned series go through these helpers. Retain a private
 * snapshot so reusing/mutating a caller's array cannot hide historical edits.
 * Only an unchanged prefix with the SAME final timestamp may use update().
 * Reloads, backfill, removals, period/style changes and historical corrections
 * continue to use the library's complete time-domain replacement.
 */
export function setTradingChartSeriesData(series: Series | null | undefined, data: Datum[]) {
  if (!series) return;
  valueInputs.delete(series);
  const previous = snapshots.get(series);
  let firstChanged = 0;
  if (previous) {
    while (firstChanged < previous.length && firstChanged < data.length
      && equal(previous[firstChanged], data[firstChanged])) firstChanged++;
    if (firstChanged === previous.length && firstChanged === data.length) return;
  }
  const last = previous?.at(-1);
  const tailOnly = previous && last && typeof last.time === 'number'
    && data.length >= previous.length && firstChanged >= previous.length - 1
    && data[previous.length - 1].time === last.time;
  if (tailOnly) {
    for (let index = firstChanged; index < data.length; index++) {
      const copy = copyDatum(data[index]);
      series.update({ ...copy });
      previous[index] = copy;
    }
  } else {
    const snapshot = data.map(copyDatum);
    series.setData(snapshot.map(datum => ({ ...datum })));
    snapshots.set(series, snapshot);
  }
}

/** Keep the snapshot current between full indicator refreshes, including a
 * newly opened candle; the next refresh must never update an older timestamp. */
export function updateTradingChartSeriesTail(series: Series, datum: Datum) {
  const previous = snapshots.get(series), last = previous?.at(-1);
  if (last && last.time === datum.time && equal(last, datum)) return;
  const copy = copyDatum(datum);
  series.update({ ...copy });
  if (!previous) return;
  if (last?.time === datum.time) previous[previous.length - 1] = copy;
  else if (!last || datum.time > last.time) previous.push(copy);
  else snapshots.delete(series);
}
