import type { DrawingCandle } from './trading-drawing-extra-tools.ts';

export interface VolumeHistoryRequest {
  market: string;
  resolution: string;
  start: number;
  end: number; // exclusive UTC seconds, including the complete final chart bar
}
export interface VolumeHistoryResult { candles: DrawingCandle[]; tickSize?: number }
export type VolumeHistoryLoader = (request: VolumeHistoryRequest, signal: AbortSignal) => Promise<VolumeHistoryResult>;
export async function fetchVolumeHistoryPages(request: VolumeHistoryRequest, loadPage: (count: number, endMs: number) => Promise<readonly DrawingCandle[]>, signal: AbortSignal) {
  const result = new Map<number, DrawingCandle>();
  let cursor = request.end * 1000 - 1;
  const seconds = volumeResolutionSeconds(request.resolution);
  if (!(seconds > 0) || !Number.isFinite(request.start) || !Number.isFinite(request.end) || request.end <= request.start) return [];
  for (let page = 0; page < 60 && cursor >= request.start * 1000; page++) {
    signal.throwIfAborted();
    const count = Math.min(1000, Math.ceil((cursor / 1000 - request.start) / seconds) + 2);
    const rows = await loadPage(count, cursor);
    signal.throwIfAborted();
    const valid = rows.filter(c => Number.isFinite(c.time) && c.time * 1000 <= cursor);
    if (!valid.length) break;
    for (const c of valid) if (c.time >= request.start && c.time < request.end) result.set(c.time, c);
    const first = Math.min(...valid.map(c => c.time));
    if (first <= request.start || result.size >= MAX_PROFILE_SOURCE_BARS) break;
    cursor = first * 1000 - 1;
  }
  return [...result.values()].sort((a, b) => a.time - b.time);
}
export const MAX_PROFILE_SOURCE_BARS = 50_000;
export function volumeResolutionSeconds(resolution: string) {
  const m = /^(\d+)([SDWM]?)$/.exec(resolution.toUpperCase());
  if (!m) return 0;
  return Number(m[1]) * ({ S: 1, D: 86400, W: 604800, M: 2592000, '': 60 }[m[2]] ?? 0);
}
export function volumeBarEnd(time: number, resolution: string) {
  const months = /^(\d+)M$/.exec(resolution);
  if (months) { const d = new Date(time * 1000); d.setUTCMonth(d.getUTCMonth() + Number(months[1])); return d.getTime() / 1000; }
  return time + volumeResolutionSeconds(resolution);
}
export function volumeProfileResolution(tool: string, chart: string, seconds: number, futures: boolean) {
  const chartSeconds = volumeResolutionSeconds(chart);
  const fixed = tool === 'fixed-range-volume';
  const sequence = fixed ? ['1', '5', '15', '30', '60', '240', '1D'] : ['1', '3', '5', '15', '30', '60', '240', '1D'];
  if (fixed && (chartSeconds < 60 || seconds <= 300)) return '1S';
  // AVP's help page omits the futures exception. The supplied ETHUSD_261225
  // daily screenshots reproduce both POCs (2701.73 / 2709.29) with 4h bars;
  // the generic AVP sequence produces 2491.03 for the first anchor instead.
  if (futures) return ['1D', '240', '60', '30', '15', '5', '1'].find(r => volumeResolutionSeconds(r) < chartSeconds) ?? '1';
  return sequence.find(r => Math.ceil(seconds / volumeResolutionSeconds(r)) < 5000) ?? '1D';
}

// Do not silently treat truncated or stale lower-timeframe data as a complete
// distribution. Replace a chart bar only when its child bars reconcile in both
// volume and price. Each parent contributes exactly once, including the live bar.
export function reconcileVolumeHistory(parents: readonly DrawingCandle[], children: readonly DrawingCandle[], resolution: string, tick = 0) {
  const sorted = [...new Map(children.filter(c => [c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)
    && c.high >= c.low && c.volume! >= 0).map(c => [c.time, c])).values()].sort((a, b) => a.time - b.time);
  const candles: DrawingCandle[] = [];
  let cursor = 0, covered = 0;
  for (const parent of parents) {
    const end = volumeBarEnd(parent.time, resolution);
    while (cursor < sorted.length && sorted[cursor].time < parent.time) cursor++;
    const group: DrawingCandle[] = [];
    while (cursor < sorted.length && sorted[cursor].time < end) group.push(sorted[cursor++]);
    const volume = group.reduce((sum, c) => sum + c.volume!, 0);
    const priceTolerance = Math.max(tick * .51, Math.abs(parent.close) * 1e-9, 1e-10);
    const matches = group.length > 0 && Number.isFinite(parent.volume)
      && Math.abs(volume - parent.volume!) <= Math.max(1e-8, Math.abs(parent.volume!) * 1e-5)
      && Math.abs(Math.max(...group.map(c => c.high)) - parent.high) <= priceTolerance
      && Math.abs(Math.min(...group.map(c => c.low)) - parent.low) <= priceTolerance
      && Math.abs(group[0].open - parent.open) <= priceTolerance
      && Math.abs(group.at(-1)!.close - parent.close) <= priceTolerance;
    if (matches) { candles.push(...group); covered++; } else candles.push(parent);
  }
  return { candles, covered, total: parents.length };
}

interface CacheEntry {
  request: VolumeHistoryRequest;
  result?: VolumeHistoryResult;
  controller?: AbortController;
  updated: number;
  error?: string;
  live: boolean;
}
export interface VolumeHistorySnapshot extends VolumeHistoryResult {
  resolution: string;
  state: 'loading' | 'lower' | 'mixed' | 'chart';
  covered: number;
  total: number;
}
export class VolumeProfileHistory {
  private entries = new Map<string, CacheEntry>();
  private context = '';
  private disposed = false;
  private wake?: ReturnType<typeof setTimeout>;
  private wakeAt = Infinity;
  private loader: VolumeHistoryLoader;
  private changed: () => void;
  private now: () => number;
  constructor(loader: VolumeHistoryLoader, changed: () => void, now = () => Date.now()) {
    this.loader = loader; this.changed = changed; this.now = now;
  }
  useContext(context: string) {
    if (context === this.context) return;
    this.context = context;
    for (const entry of this.entries.values()) entry.controller?.abort();
    this.entries.clear();
    clearTimeout(this.wake); this.wake = undefined; this.wakeAt = Infinity;
  }
  get(request: VolumeHistoryRequest, parents: readonly DrawingCandle[], chart: string, tick: number, enabled = true): VolumeHistorySnapshot {
    const now = this.now(), live = request.end * 1000 > now;
    const key = `${request.market}|${chart}|${request.resolution}|${request.start}|${live ? 'live' : request.end}`;
    let entry = this.entries.get(key);
    const seconds = volumeResolutionSeconds(request.resolution);
    if (!entry && enabled && !this.disposed) {
      entry = { request, updated: 0, live };
      this.entries.set(key, entry);
      if (this.entries.size > 24) { const oldKey = this.entries.keys().next().value!; this.entries.get(oldKey)?.controller?.abort(); this.entries.delete(oldKey); }
    }
    if (entry && enabled && !entry.controller && !this.disposed && [...this.entries.values()].filter(e => e.controller).length < 2
      && (entry.updated === 0 || now - entry.updated >= (entry.error ? 60_000 : live ? 5_000 : Infinity))) {
      const controller = new AbortController(); entry.controller = controller; entry.request = request;
      const target = entry;
      // Refresh the tail including the entire live chart candle: this also
      // recovers missing children if the previous live snapshot was incomplete.
      const tailStart = entry.result?.candles.length && live
        ? Math.max(request.start, Math.min(parents.at(-1)?.time ?? request.start, entry.result.candles.at(-1)!.time)) : request.start;
      const load = { ...request, start: tailStart, end: Math.min(request.end, now / 1000 + 1) };
      const count = Math.ceil((load.end - load.start) / seconds);
      const work = seconds > 0 && count > 0 && count <= MAX_PROFILE_SOURCE_BARS
        ? Promise.resolve().then(() => this.loader(load, controller.signal)) : Promise.reject(new Error('VOLUME_HISTORY_RANGE_UNAVAILABLE'));
      void work.then(result => {
        if (controller.signal.aborted || this.disposed || this.entries.get(key) !== target) return;
        const old = target.result?.candles.filter(c => c.time < load.start) ?? [];
        const candles = [...new Map([...old, ...result.candles].filter(c => c.time >= request.start && c.time < load.end).map(c => [c.time, c])).values()].sort((a, b) => a.time - b.time);
        target.result = { candles, tickSize: result.tickSize ?? target.result?.tickSize };
        target.error = candles.length ? undefined : 'VOLUME_HISTORY_UNAVAILABLE';
      }).catch(error => {
        if (!controller.signal.aborted) target.error = String(error);
      }).finally(() => {
        if (controller.signal.aborted || this.disposed || this.entries.get(key) !== target) return;
        target.controller = undefined; target.updated = this.now();
        this.changed();
        if (live || target.error) this.scheduleWake(target.error ? 60_000 : 5_000);
      });
    }
    const effectiveTick = entry?.result?.tickSize ?? tick;
    const reconciled = reconcileVolumeHistory(parents, entry?.result?.candles ?? [], chart, effectiveTick);
    return { ...reconciled, tickSize: effectiveTick, resolution: request.resolution,
      state: reconciled.covered === parents.length && parents.length > 0 ? 'lower' : reconciled.covered ? 'mixed' : entry?.controller ? 'loading' : 'chart' };
  }
  private scheduleWake(ms: number) {
    const at = this.now() + ms;
    if (this.wake !== undefined && this.wakeAt <= at) return;
    clearTimeout(this.wake); this.wakeAt = at;
    this.wake = setTimeout(() => { this.wake = undefined; this.wakeAt = Infinity; if (!this.disposed) this.changed(); }, ms);
  }
  destroy() { this.disposed = true; for (const entry of this.entries.values()) entry.controller?.abort(); this.entries.clear(); clearTimeout(this.wake); }
}
