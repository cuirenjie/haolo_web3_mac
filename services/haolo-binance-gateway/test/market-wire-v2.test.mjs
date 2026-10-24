import test from 'node:test';
import assert from 'node:assert/strict';
import { compactMarketPayload, decodeMarketPayload, negotiateMarketCodec } from '../src/market-wire-codec.mjs';
import { createMarketFrameEncoder } from '../src/market-frame.mjs';
import { TrafficMetrics } from '../src/traffic-metrics.mjs';

const trade = { e: 'aggTrade', E: 1792850000123, a: 1834567890, s: 'BTCUSDT', p: '111222.00000001', q: '0.00001000', nq: '0.00000000', f: 90001234, l: 90001235, T: 1792850000122, m: false, st: 1 };
test('hmc2 preserves new and future fields, nested data, precision and prototypes', () => {
  const unknown = JSON.parse('{"future":{"text":"繁體中文","v":[0,false,null,"001.000"]},"__proto__":{"polluted":true},"constructor":12}');
  const events = [trade, { ...trade, ...unknown },
    { e: '24hrTicker', s: 'BTCUSDT', c: '0001.00000', ps: 'BTCUSDT', st: 1 },
    { e: 'markPriceUpdate', E: 1792850000000, s: 'BTCUSDT', p: '111222.12000000', ap: '111221.00000000', st: 1 },
    { e: 'kline', s: 'BTCUSDT', k: { t: 1792850000000, o: '0001.00000000', x: false, ...unknown } }];
  for (const data of events) for (const combined of [true, false]) {
    const event = { stream: 'btcusdt@test', data };
    const packed = compactMarketPayload(event, combined, 'hmc2');
    assert.ok(packed);
    assert.deepEqual(decodeMarketPayload(JSON.parse(JSON.stringify(packed))), combined ? event : data);
    assert.equal(compactMarketPayload(event, combined, 'hmc1'), null);
  }
  assert.equal({}.polluted, undefined);
});

test('negotiation retains old clients, handles unknown capabilities and records hmc2 separately', () => {
  assert.equal(negotiateMarketCodec(['hmc1', 'hmc2']), 'hmc2');
  assert.equal(negotiateMarketCodec(['hmc1']), 'hmc1');
  assert.equal(negotiateMarketCodec(['future']), 'json');
  assert.equal(negotiateMarketCodec(null), 'json');
  const metrics = new TrafficMetrics();
  metrics.record({ codec: 'hmc2', bytes: 20 });
  assert.match(metrics.prometheus(), /codec="hmc2"/);
});

test('new codec shares fanout work, emits each event in order and falls back when larger', () => {
  let calls = 0;
  const encode = createMarketFrameEncoder(value => { calls++; return JSON.stringify(value); });
  const event = { stream: 'btcusdt@aggTrade', data: trade };
  const frame = encode(event, true, 'hmc2');
  assert.equal(frame.codec, 'hmc2');
  assert.ok(frame.bytes < frame.jsonBytes * 0.85);
  for (let i = 0; i < 2000; i++) assert.strictEqual(encode(event, true, 'hmc2'), frame);
  assert.equal(calls, 2);
  for (let i = 0; i < 10000; i++) {
    const next = { stream: event.stream, data: { ...trade, a: i } };
    assert.deepEqual(decodeMarketPayload(JSON.parse(encode(next, false, 'hmc2').text)), next.data);
  }
  assert.equal(encode({ stream: 'x', data: { e: 'aggTrade' } }, false, 'hmc2').codec, 'json');
});

test('malformed hmc2 frames cannot overwrite known fields or misalign nested objects', () => {
  for (const frame of [
    ['hmc2', null, 0, 0], ['hmc2', null, 0, 0, []], ['hmc2', null, 0, 0, { e: 'bad' }],
    ['hmc2', null, 0, 1, null], ['hmc2', null, 0, 0, null, 'extra'], ['hmc2', null, 1, 8, null, false],
  ]) assert.throws(() => decodeMarketPayload(frame));
});
