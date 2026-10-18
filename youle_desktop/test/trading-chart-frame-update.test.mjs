import test from 'node:test';
import assert from 'node:assert/strict';
import { TradingChartFrameUpdate } from '../src/renderer/trading-chart-frame-update.ts';
import { tradingChartCandleIndex } from '../src/renderer/trading-chart-legend.ts';

test('high-frequency crosshair input paints the latest sample once; cancellation prevents stale hover', t => {
  const frames = new Map(); let id = 0;
  const oldWindow = globalThis.window;
  globalThis.window = { requestAnimationFrame(fn) { frames.set(++id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); } };
  t.after(() => { globalThis.window = oldWindow; });
  const values = [], update = new TradingChartFrameUpdate(value => values.push(value));
  for (let i = 0; i < 1000; i++) update.schedule(i);
  assert.equal(frames.size, 1);
  const run = () => { const [key, fn] = frames.entries().next().value; frames.delete(key); fn(); };
  run(); assert.deepEqual(values, [999]);
  update.schedule(undefined); run(); assert.deepEqual(values, [999, undefined]);
  update.schedule(1000); update.cancel(); assert.equal(frames.size, 0);
  update.schedule(1001); run(); assert.deepEqual(values, [999, undefined, 1001]);
});

test('candle lookup is exact across session gaps, outside bounds and long history', () => {
  let reads = 0;
  const candles = Array.from({length:100000}, (_,i)=>({get time(){reads++;return i*i+100}}));
  for (const index of [0,1,55,99999]) {
    reads=0; assert.equal(tradingChartCandleIndex(candles,index*index+100),index); assert.ok(reads<=17);
  }
  for (const time of [NaN,Infinity,-1,102,1e12]) assert.equal(tradingChartCandleIndex(candles,time),-1);
  assert.equal(tradingChartCandleIndex([],1),-1);
});
