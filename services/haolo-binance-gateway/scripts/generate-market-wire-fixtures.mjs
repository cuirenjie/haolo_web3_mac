// Reproduce the shared Node/Dart contract fixtures; no live market dependency.
import fs from 'node:fs';
import { compactMarketPayload } from '../src/market-wire-codec.mjs';
const time = 1789455600000;
const events = [
  { e: 'aggTrade', E: time + 1000, s: 'BTCUSDT', a: 9007199254740991, p: '123456789.12345678901234567890', q: '0.00000000000000000001', f: 12, l: 15, T: time + 1000, m: false, M: null },
  { e: 'kline', E: time + 2000, s: 'BTCUSDT', k: { t: time, T: time + 59999, s: 'BTCUSDT', i: '1M', f: 10, L: 16, o: '100.00000000', c: '102.1234567890', h: '110.0', l: '90', v: '25.0', n: 1, x: false, q: '2500.0', V: '1.000', Q: '100.00', B: '0' } },
  { e: '24hrTicker', E: time + 3000, s: 'BTCUSDT', p: '-1.000', P: '-0.1', w: '100.0', x: '99', c: '101', Q: '0.0001', b: '100', B: '1', a: '102', A: '2', o: '100', h: '110', l: '90', v: '1.20', q: '120.0', O: time - 86400000, C: time, F: 0, L: 20, n: 21 },
  { e: '24hrMiniTicker', E: time + 4000, s: 'BTCUSDT', c: '101', o: '100', h: '110', l: '90', v: '1.000', q: '100.00' },
  { u: 9007199254740991, s: 'BTCUSDT', b: '100.0000000000000001', B: '0.0', a: '100.0000000000000002', A: '0.0001' },
  { e: 'markPriceUpdate', E: time + 5000, s: 'BTCUSDT', p: '100.00100', i: '100.01', P: '100.000', r: '-0.00010000', T: time + 3600000 },
  { e: 'aggTrade', s: '合约USDT', p: '0', m: false },
];
const fixtures = events.flatMap((data, index) => [false, true].map(combined => {
  const stream = index === 1 ? 'btcusdt@kline_1M' : 'btcusdt@' + (data.e ?? 'bookTicker');
  return { name: `${index}-${combined ? 'combined' : 'raw'}`, json: combined ? { stream, data } : data,
    compact: compactMarketPayload({ stream, data }, combined) };
}));
fs.mkdirSync(new URL('../test/fixtures/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../test/fixtures/market-wire-hmc1.json', import.meta.url), JSON.stringify(fixtures, null, 2) + '\n');
console.log(`Generated ${fixtures.length} hmc1 fixtures`);
