// Read-only comparison against the user's ETHUSDZ2026 screenshots. No account,
// credentials, market substitution, or application data is involved.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { calculateFixedVolume, volumeProfilePoints } from '../src/renderer/trading-volume-drawings.ts';
import { fetchVolumeHistoryPages, reconcileVolumeHistory, volumeProfileResolution } from '../src/renderer/trading-volume-history.ts';
const output = new URL('../.cache/volume-profile-accuracy/', import.meta.url);
const symbol = 'ETHUSD_261225', market = 'BINANCE:COINM:' + symbol;
const utc = date => Date.parse(date + 'T00:00:00Z') / 1000;
const start = utc('2026-08-20'), end = utc('2026-10-20');
const requests = [];
async function json(path, params = {}) {
  const url = new URL('https://dapi.binance.com' + path);
  url.search = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const data = await response.json();
  if (!response.ok || data.code < 0) throw Error(`${response.status}: ${JSON.stringify(data)}`);
  return data;
}
const info = await json('/dapi/v1/exchangeInfo');
const contract = info.symbols.find(s => s.symbol === symbol);
assert.ok(contract, 'The exact dated contract must be available; do not substitute ETHUSDT.');
const tickSize = Number(contract.filters.find(f => f.filterType === 'PRICE_FILTER').tickSize);
async function history(resolution, interval) {
  return fetchVolumeHistoryPages({ market, resolution, start, end }, async (count, endTime) => {
    const rows = await json('/dapi/v1/klines', { symbol, interval, limit: count, endTime });
    requests.push({ interval, count: rows.length, endTime });
    return rows.map(c => ({ time: c[0] / 1000, open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5] }));
  }, new AbortController().signal);
}
const daily = await history('1D', '1d');
const lower = await history('240', '4h');
const generic = await history('30', '30m');
const cases = [
  { tool: 'fixed-range-volume', anchor: '2026-08-20', last: '2026-09-25' },
  { tool: 'fixed-range-volume', anchor: '2026-08-20', last: '2026-10-19' },
  { tool: 'anchored-volume-profile', anchor: '2026-08-26', expectedPoc: 2701.73 },
  { tool: 'anchored-volume-profile', anchor: '2026-09-23', expectedPoc: 2709.29 },
];
const scenarios = cases.map(c => {
  const points = [{ time: utc(c.anchor), price: 0 }, ...(c.last ? [{ time: utc(c.last), price: 0 }] : [])];
  const range = volumeProfilePoints({ tool: c.tool, points }, daily);
  const parents = daily.filter(d => d.time >= range[0].time && d.time <= range[1].time);
  const reconciled = reconcileVolumeHistory(parents, lower, '1D', tickSize);
  const profile = calculateFixedVolume(daily, range, {}, { candles: reconciled.candles, tickSize });
  const chartOnly = calculateFixedVolume(daily, range, {}, { tickSize });
  const genericBars = reconcileVolumeHistory(parents, generic, '1D', tickSize);
  const genericProfile = calculateFixedVolume(daily, range, {}, { candles: genericBars.candles, tickSize });
  const sum = parents.reduce((s, b) => s + b.volume, 0);
  assert.ok(Math.abs(profile.bins.reduce((s, b) => s + b.volume, 0) - sum) < sum * 1e-10, 'Volume must be conserved.');
  const poc = Number(profile.poc.toFixed(2));
  if (c.expectedPoc !== undefined) assert.equal(poc, c.expectedPoc, `Screenshot POC for ${c.anchor}`);
  return { ...c, resolution: volumeProfileResolution(c.tool, '1D', end - utc(c.anchor), true), poc, chartOnlyPoc: Number(chartOnly.poc.toFixed(2)), generic30mPoc: Number(genericProfile.poc.toFixed(2)), totalVolume: sum,
    coverage: { covered: reconciled.covered, total: reconciled.total }, low: profile.low, high: profile.high, rows: profile.bins.length,
    bins: profile.bins, val: profile.val, vah: profile.vah };
});
await fs.mkdir(output, { recursive: true });
const snapshot = { fetchedAt: new Date().toISOString(), symbol, market, tickSize, daily, lower, requests };
await fs.writeFile(new URL('snapshot.json', output), JSON.stringify(snapshot));
const report = { result: 'PASS', symbol, tickSize, fetchedAt: snapshot.fetchedAt, rows: 24, valueArea: 70, note: 'Screenshot POCs match. Live-day volume changes after the screenshot; full bin values were not supplied by TradingView.', scenarios };
await fs.writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, scenarios: scenarios.map(({ bins, ...c }) => c) }, null, 2));
