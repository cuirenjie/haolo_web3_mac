import test from 'node:test';
import assert from 'node:assert/strict';
import { TradingChartMomentum } from '../src/renderer/trading-chart-momentum.ts';

const flick = () => {
  const motion = new TradingChartMomentum();
  for (let t = 0; t <= 64; t += 16) motion.add(t * 1.2, t * .4, t);
  return motion;
};

test('release glides in both axes, decelerates monotonically and stops without reversing', () => {
  const m = flick(); assert.equal(m.start(64, 800, 600, true), true);
  let x = Infinity, y = Infinity, distance = 0, frames = 0;
  for (let t = 80; m.active && t < 2000; t += 16) {
    const d = m.step(t); assert.ok(d && d.x >= 0 && d.x <= x && d.y >= 0 && d.y <= y);
    x = d.x; y = d.y; distance += x; frames++;
  }
  assert.equal(m.active, false); assert.ok(frames > 30 && frames < 100);
  assert.ok(distance > 300 && distance < 340);
});

test('analytical decay travels the same distance at 60, 120, 144 and 240 Hz', () => {
  const positions = [60, 120, 144, 240].map(hz => {
    const m = flick(); m.start(64, 800, 600, true);
    let x = 0, last = 64;
    for (let t = 64 + 1000 / hz; t < 664; t += 1000 / hz) { x += m.step(t).x; last = t; }
    if (last < 664) x += m.step(664).x;
    return x;
  });
  assert.ok(positions.every(x => Math.abs(x - positions[0]) < 1e-8));
});

test('paused release, clicks, slow precision moves and invalid samples do not fling', () => {
  const stale = flick(); assert.equal(stale.start(140, 800, 600, true), false);
  for (const delta of [0, .1]) {
    const m = new TradingChartMomentum();
    m.add(0, 0, 0); m.add(delta, delta, 16); m.add(NaN, Infinity, 32);
    assert.equal(m.start(16, 800, 600, true), false);
  }
  const held = flick(); held.add(76.8, 25.6, 140); assert.equal(held.start(140, 800, 600, true), false);
});

test('last direction wins after a reversal; stationary Y and vertical lock do not drift', () => {
  const m = flick();
  m.add(60, 25.6, 80); m.add(40, 25.6, 96); m.add(20, 25.6, 112);
  assert.equal(m.start(112, 800, 600, false), true);
  const d = m.step(128); assert.ok(d.x < 0); assert.equal(d.y, 0);
});

test('high polling rates retain a bounded recent history and still estimate speed', () => {
  const m = new TradingChartMomentum();
  for (let t = 0; t < 10000; t++) m.add(t, t / 2, t);
  assert.ok(m.samples.length <= 64); assert.ok(m.start(9999, 800, 600, true));
  assert.ok(m.step(10015).x > 10);
});

test('flick distance is bounded by viewport size; boundaries stop only the blocked axis', () => {
  const m = new TradingChartMomentum();
  m.add(0, 0, 0); m.add(10000, 10000, 32); assert.ok(m.start(32, 300, 200, true));
  let x = 0; for (let t = 48; t <= 192; t += 16) x += m.step(t).x;
  m.block('y'); assert.equal(m.step(208).y, 0);
  for (let t = 224; m.active; t += 16) x += m.step(t).x;
  assert.ok(x < 255); m.stop(); assert.equal(m.step(1000), null);
});

test('a stalled/background frame cancels instead of jumping; stop clears old samples', () => {
  const m = flick(); m.start(64, 800, 600, true);
  assert.equal(m.step(300), null); assert.equal(m.active, false);
  m.stop(); assert.equal(m.start(320, 800, 600, true), false);
});
