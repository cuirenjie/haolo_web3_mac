import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { volumeProfileResolution, volumeBarEnd, fetchVolumeHistoryPages, reconcileVolumeHistory, VolumeProfileHistory } from '../src/renderer/trading-volume-history.ts';
import { calculateFixedVolume, volumeRowLayout } from '../src/renderer/trading-volume-drawings.ts';
const near = (a, b, e = 1e-8) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const candle = (time, open, high, low, close, volume) => ({ time, open, high, low, close, volume });
const parents = [candle(0, 10, 14, 10, 11, 100), candle(3600, 11, 14, 10, 13, 100)];
const children = [candle(0, 10, 11, 10, 11, 80), candle(1800, 11, 14, 11, 11, 20), candle(3600, 11, 14, 10, 13, 100)];
const points = [{ time: 0, price: 0 }, { time: 3600, price: 0 }];
const settle = () => new Promise(r => setImmediate(r));

test('recorded ETHUSDZ2026 bars reproduce both screenshot POCs without network access', () => {
  const data = JSON.parse(fs.readFileSync(new URL('./fixtures/ethusd-261225-volume-reference.json', import.meta.url), 'utf8'));
  const unpack = rows => rows.map(([time, open, high, low, close, volume]) => candle(time, open, high, low, close, volume));
  const daily = unpack(data.daily), lower = unpack(data.lower4h);
  for (const [date, expected] of [['2026-08-26', 2701.73], ['2026-09-23', 2709.29]]) {
    const start = Date.parse(date + 'T00:00:00Z') / 1000;
    const selected = daily.filter(c => c.time >= start), r = reconcileVolumeHistory(selected, lower, '1D', data.tickSize);
    const p = calculateFixedVolume(selected, [{ time: start, price: 0 }, { time: selected.at(-1).time, price: 0 }], {}, { candles: r.candles, tickSize: data.tickSize });
    assert.equal(r.covered, selected.length);
    assert.equal(Number(p.poc.toFixed(2)), expected);
    near(p.total, selected.reduce((s, c) => s + c.volume, 0));
    near(p.total, p.bins.reduce((s, b) => s + b.volume, 0), p.total * 1e-10);
  }
});

test('profile source period reproduces futures screenshots and published spot rules', () => {
  for (const tool of ['fixed-range-volume', 'anchored-volume-profile']) {
    assert.equal(volumeProfileResolution(tool, '1D', 60 * 86400, true), '240');
    assert.equal(volumeProfileResolution(tool, '60', 100 * 3600, true), '30');
    assert.equal(volumeProfileResolution(tool, '1W', 500 * 86400, true), '1D');
  }
  assert.equal(volumeProfileResolution('anchored-volume-profile', '1D', 7 * 86400, false), '3');
  assert.equal(volumeProfileResolution('fixed-range-volume', '1D', 7 * 86400, false), '5');
  assert.equal(volumeProfileResolution('fixed-range-volume', '5', 300, false), '1S');
  assert.equal(volumeProfileResolution('fixed-range-volume', '30S', 86400, true), '1S');
  const feb = Date.UTC(2024, 1, 1) / 1000;
  assert.equal(volumeBarEnd(feb, '1M'), Date.UTC(2024, 2, 1) / 1000);
});

test('row rounding follows the 100 tick official example and clips its final partial row', () => {
  const layout = volumeRowLayout(10, 11, { rows: 30 }, .01);
  assert.equal(layout.count, 34); near(layout.step, .03);
  const p = calculateFixedVolume([candle(0, 10, 11, 10, 11, 100)], [{ time: 0, price: 0 }, { time: 0, price: 0 }], { rows: 30 }, { tickSize: .01 });
  near(p.bins.at(-1).high - p.bins.at(-1).low, .01);
  near(p.bins.reduce((sum, b) => sum + b.volume, 0), 100);
  assert.equal(volumeRowLayout(200, 300, { rowLayout: 'ticks', ticksPerRow: 25 }, .01).count, 400);
  assert.equal(volumeRowLayout(10, 11, { rows: 500 }, .25).count, 4);
  const flat = calculateFixedVolume([candle(0, 10, 10, 10, 10, 1)], [{ time: 0, price: 0 }, { time: 0, price: 0 }], {}, { tickSize: .01 });
  assert.equal(flat.poc, 10);
});

test('lower bars change distribution without changing total volume; each parent counts once', () => {
  const r = reconcileVolumeHistory(parents, children, '60', .01);
  assert.equal(r.covered, 2);
  const lower = calculateFixedVolume(parents, points, { rows: 4 }, { candles: r.candles, tickSize: .01 });
  assert.deepEqual(lower.bins.map(b => Math.round(b.volume)), [105, 32, 32, 32]);
  near(lower.total, 200); near(lower.bins.reduce((s, b) => s + b.volume, 0), 200);
  assert.equal(lower.poc, 10.5);
  const partial = reconcileVolumeHistory(parents, children.slice(1), '60', .01);
  assert.equal(partial.covered, 1); assert.deepEqual(partial.candles, parents);
  const duplicate = reconcileVolumeHistory(parents, [...children, children[1]], '60', .01);
  assert.deepEqual(duplicate, r);
});

test('stale volume or mismatched OHLC falls back per chart bar instead of hiding volume', () => {
  for (const key of ['open', 'close', 'high', 'low', 'volume']) {
    const corrupt = structuredClone(children);
    const index = key === 'close' || key === 'high' ? 1 : 0;
    corrupt[index][key] += key === 'low' ? -1 : 1;
    const r = reconcileVolumeHistory(parents, corrupt, '60', .01);
    assert.equal(r.covered, 1, key); assert.equal(r.candles[0], parents[0], key);
    near(r.candles.reduce((s, c) => s + c.volume, 0), 200);
  }
  const live = structuredClone(parents); live[1].volume += 15;
  const r = reconcileVolumeHistory(live, children, '60', .01);
  assert.equal(r.covered, 1); near(r.candles.reduce((s, c) => s + c.volume, 0), 215);
});

test('history pagination includes the complete final parent and excludes the next bar', async () => {
  const data = Array.from({ length: 2505 }, (_, i) => candle(i * 60, 10, 11, 9, 10, 1));
  const calls = [];
  const result = await fetchVolumeHistoryPages({ market: 'A', resolution: '1', start: 5 * 60, end: 2504 * 60 }, async (count, end) => {
    calls.push({ count, end }); return data.filter(c => c.time * 1000 <= end).slice(-Math.min(count, 1000));
  }, new AbortController().signal);
  assert.equal(result.length, 2499); assert.equal(result[0].time, 300); assert.equal(result.at(-1).time, 2503 * 60);
  assert.equal(calls.length, 3); assert.ok(calls.every(c => c.count <= 1000));
  assert.ok(calls[1].end < calls[0].end);
});

test('paging stops when a provider ignores the historic end time and honors cancellation', async () => {
  let count = 0;
  const req = { market: 'A', resolution: '1', start: 0, end: 7200 };
  const r = await fetchVolumeHistoryPages(req, async () => { count++; return [candle(6000, 1, 1, 1, 1, 1)]; }, new AbortController().signal);
  assert.equal(count, 2); assert.equal(r.length, 1);
  const controller = new AbortController();
  await assert.rejects(fetchVolumeHistoryPages(req, async () => { controller.abort(); return []; }, controller.signal), { name: 'AbortError' });
});

test('cached closed ranges share one fetch, preserve exchange tick size, and do not load previews', async () => {
  let calls = 0;
  const cache = new VolumeProfileHistory(async () => { calls++; return { candles: children, tickSize: .25 }; }, () => {}, () => 8000_000);
  try {
    const req = { market: 'A', resolution: '30', start: 0, end: 7200 };
    cache.useContext('A|60');
    cache.get(req, parents, '60', .01, false); await settle(); assert.equal(calls, 0);
    assert.equal(cache.get(req, parents, '60', .01).state, 'loading');
    cache.get(req, parents, '60', .01); await settle();
    const ready = cache.get(req, parents, '60', .01);
    assert.equal(calls, 1); assert.equal(ready.tickSize, .25); assert.equal(ready.state, 'lower');
  } finally { cache.destroy(); }
});

test('live refresh replaces the tail, retains older children, and does not double count', async () => {
  let now = 5000_000; const calls = [];
  const cache = new VolumeProfileHistory(async req => { calls.push(req); return { candles: children.filter(c => c.time >= req.start) }; }, () => {}, () => now);
  const req = { market: 'A', resolution: '30', start: 0, end: 7200 };
  try {
    cache.get(req, parents, '60', .01); await settle();
    now += 6000; cache.get(req, parents, '60', .01); await settle();
    assert.equal(calls.length, 2); assert.equal(calls[1].start, 3600);
    const r = cache.get(req, parents, '60', .01);
    assert.equal(r.candles.length, 3); near(r.candles.reduce((s, c) => s + c.volume, 0), 200);
  } finally { cache.destroy(); }
});

test('late results cannot cross symbols and destroyed controllers cannot repaint', async () => {
  const pending = []; let changed = 0;
  const cache = new VolumeProfileHistory((req, signal) => new Promise(resolve => pending.push({ req, signal, resolve })), () => changed++, () => 8000_000);
  const req = { market: 'A', resolution: '30', start: 0, end: 7200 };
  cache.useContext('A|60'); cache.get(req, parents, '60', .01); await settle();
  cache.useContext('B|60'); assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve({ candles: children, tickSize: 50 }); await settle(); assert.equal(changed, 0);
  const next = { ...req, market: 'B' }; cache.get(next, parents, '60', .01); await settle();
  cache.destroy(); pending[1].resolve({ candles: children }); await settle(); assert.equal(changed, 0);
});

test('failed requests use chart data and back off instead of hammering on every redraw', async () => {
  let now = 8000_000, calls = 0;
  const cache = new VolumeProfileHistory(async () => { calls++; throw Error('offline'); }, () => {}, () => now);
  const req = { market: 'A', resolution: '30', start: 0, end: 7200 };
  try {
    cache.get(req, parents, '60', .01); await settle();
    for (let i = 0; i < 20; i++) cache.get(req, parents, '60', .01);
    await settle(); assert.equal(calls, 1); assert.equal(cache.get(req, parents, '60', .01).state, 'chart');
    now += 60_001; cache.get(req, parents, '60', .01); await settle(); assert.equal(calls, 2);
  } finally { cache.destroy(); }
});
