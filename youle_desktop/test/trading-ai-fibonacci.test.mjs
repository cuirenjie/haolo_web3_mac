import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAiFibonacciDrawings, renderAiFibonacci } from '../src/renderer/trading-ai-fibonacci.ts';
import { nativeAiDrawingDisplayModel } from '../src/renderer/trading-ai-native-style.ts';
import { fibonacciGeometry, normalizeFibonacciOptions } from '../src/renderer/trading-fibonacci.ts';

const fixture = (prefix = 'analysis-candidate', sign = 1, origin = 80888.9, span = 4000) => [.382, .618, 1].flatMap(ratio => {
  const price = origin + sign * span * ratio;
  const line = { id: `${prefix}-fib-${ratio}`, source: 'ai', strategyId: 'wave', symbol: 'BTCUSDT', interval: '1h',
    tool: 'path', colorToken: 'wave-fibonacci', lineStyle: 'dashed', points: [{ time: 700, price }, { time: 720, price }] };
  return [line, { ...line, id: line.id + '-label', tool: 'note', points: [line.points[1]], text: `Fib ${ratio}` }];
});
const bounds = { width: 1000, height: 700 };
const project = p => ({ x: p.time, y: priceToY(p.price) });
const priceToY = p => 650 - (p - 80000) / 10;
const render = (d, obstacles = [], draft = false) => renderAiFibonacci(d, project, bounds, priceToY, p => p.toFixed(2), obstacles, draft);

test('historical Fib paths become one native group without rewriting source or adding ratios/prices', () => {
  const drawings = fixture(), before = JSON.stringify(drawings);
  drawings.forEach(d => { d.points.forEach(Object.freeze); Object.freeze(d.points); Object.freeze(d); });
  const projected = projectAiFibonacciDrawings(Object.freeze(drawings));
  assert.equal(projected.drawings.length, 1);
  const d = projected.drawings[0];
  assert.equal(d.tool, 'fib-retracement');
  assert.equal(JSON.stringify(drawings), before);
  assert.deepEqual(d.fibonacci.levels.filter(l => l.enabled).map(l => l.value), [.382, .618, 1]);
  const body = render(nativeAiDrawingDisplayModel(d)).body;
  for (const source of drawings.filter(d => d.tool === 'path')) assert.ok(body.includes(`y1="${priceToY(source.points[0].price)}"`));
  for (const color of ['#ff9800', '#089981', '#808080']) assert.ok(body.includes(`stroke="${color}"`));
  assert.equal((body.match(/trading-fibonacci-band/g) || []).length, 2);
  assert.doesNotMatch(body, /stroke-dasharray|Fib |NaN|Infinity/);
  assert.deepEqual(projectAiFibonacciDrawings(projected.drawings).drawings, projected.drawings);
});

test('bullish, bearish, very low prices and extension measurements retain exact accepted prices on log scales', () => {
  for (const sign of [1, -1]) for (const scale of [1, 1e-8]) {
    const drawings = fixture('measurement', sign, 100000 * scale, 4000 * scale);
    const d = projectAiFibonacciDrawings(drawings).drawings[0];
    const levels = fibonacciGeometry(d, { x: 300, y: 100 }, { x: 500, y: 200 }, bounds, p => Math.log(p), d.aiFibLevelPrices).levels;
    for (const source of drawings.filter(d => d.tool === 'path')) {
      const ratio = Number(source.id.split('-fib-')[1]);
      const level = levels.find(l => l.value === ratio);
      assert.equal(level.price, source.points[0].price);
      assert.equal(level.y, Math.log(source.points[0].price));
    }
  }
});

test('unrelated same-color confirmations, targets, projection zones and manual drawings stay separate', () => {
  const originals = fixture();
  const extras = ['confirmation', 'execution-target-1', 'projection', 'ratio-line-ab-xa'].map(suffix => ({ ...originals[0], id: 'analysis-candidate-' + suffix }));
  extras.push({ ...originals[0], id: 'manual-fib-.382', source: 'manual' }, { ...originals[0], id: 'plan-fib-0.382', planLevel: { kind: 'target' } });
  const result = projectAiFibonacciDrawings([...originals, ...extras]).drawings;
  assert.equal(result.length, 1 + extras.length);
  for (const extra of extras) assert.ok(result.includes(extra));
});

test('different analyses and horizons do not merge; inconsistent ratios fall back intact', () => {
  const both = [...fixture('one'), ...fixture('two')];
  assert.equal(projectAiFibonacciDrawings(both).drawings.length, 2);
  const bad = fixture(); bad[2] = { ...bad[2], points: bad[2].points.map(p => ({ ...p, price: p.price + 15 })) };
  assert.deepEqual(projectAiFibonacciDrawings(bad).drawings, bad);
  const horizons = fixture().map((d, i) => ({ ...d, points: d.points.map(p => ({ ...p, time: p.time + Math.floor(i / 2) * 20 })) }));
  assert.equal(projectAiFibonacciDrawings(horizons).drawings.length, 3);
});

test('single levels during playback use native lines without displaying future ratios or fill', () => {
  const d = projectAiFibonacciDrawings(fixture().slice(0, 1)).drawings[0];
  const body = render(d, [], true).body;
  assert.equal((body.match(/<g class="trading-fibonacci-level"/g) || []).length, 1);
  assert.match(body, /x1="700"[^>]*x2="720"/);
  assert.doesNotMatch(body, /trading-fibonacci-band|data-fibonacci-level="0.618"/);
});

test('narrow groups widen within plot, remain price-accurate and do not stick to offscreen edges', () => {
  const d = projectAiFibonacciDrawings(fixture()).drawings[0];
  const body = render(d).body;
  assert.match(body, /x1="700"[^>]*x2="920"/);
  const offscreen = { ...d, points: d.points.map(p => ({ ...p, time: p.time + 400 })) };
  assert.equal(render(offscreen).body, '');
  const edge = { ...d, points: d.points.map(p => ({ ...p, time: p.time + 270 })) };
  assert.match(render(edge).body, /x1="772"[^>]*x2="992"/);
});

test('labels avoid plan lines and each other without changing level line coordinates', () => {
  const d = projectAiFibonacciDrawings(fixture()).drawings[0];
  const y = priceToY(d.aiFibLevelPrices.get(.618));
  const obstacle = { x: 0, y: y - 2, width: 1000, height: 4 };
  const result = render(d, [obstacle]);
  for (const rect of result.obstacles) assert.ok(rect.y + rect.height + 4 <= obstacle.y || rect.y >= obstacle.y + obstacle.height + 4);
  assert.ok(result.body.includes(`y1="${y}"`));
  for (let i = 0; i < result.obstacles.length; i++) for (let j = i + 1; j < result.obstacles.length; j++) {
    const a = result.obstacles[i], b = result.obstacles[j];
    assert.ok(a.y + a.height <= b.y || b.y + b.height <= a.y || a.x + a.width <= b.x || b.x + b.width <= a.x);
  }
});

test('native AI retracements use native per-level colors for every strategy including legacy exceptions', () => {
  for (const strategyId of ['wave', 'harmonic', 'ict-smc', 'price-action', 'wyckoff', undefined]) {
    const d = { ...fixture()[0], strategyId, tool: 'fib-retracement', color: '#123456', lineWidth: 3,
      fibonacci: normalizeFibonacciOptions(), points: [{ time: 200, price: 84000 }, { time: 600, price: 81000 }] };
    const display = nativeAiDrawingDisplayModel(d);
    assert.equal(display.color, undefined);
    assert.match(render(display).body, /stroke="#ff9800" stroke-width="2"/);
    assert.equal(d.color, '#123456');
  }
});

test('positive accepted levels still render when their extrapolated zero anchor is negative on a log chart', () => {
  const source = fixture('extension', 1, -10, 100);
  const d = projectAiFibonacciDrawings(source).drawings[0];
  const logY = p => p > 0 ? 600 - Math.log(p) * 70 : null;
  const result = renderAiFibonacci(d, p => { const y = logY(p.price); return y === null ? null : { x: p.time, y }; }, bounds, logY, p => p.toFixed(2));
  assert.equal((result.body.match(/<g class="trading-fibonacci-level"/g) || []).length, 3);
  assert.doesNotMatch(result.body, /NaN|Infinity/);
});

test('labels moved inside the band avoid the native lines as well as candles', () => {
  const d = projectAiFibonacciDrawings(fixture()).drawings[0];
  const candles = [{ x: 0, y: 0, width: 700, height: 700 }];
  const result = renderAiFibonacci(d, project, bounds, priceToY, p => p.toFixed(2), [], false, candles);
  for (const rect of result.obstacles) {
    assert.ok(rect.x >= 700);
    for (const price of d.aiFibLevelPrices.values()) assert.ok(rect.y + rect.height < priceToY(price) || rect.y > priceToY(price));
  }
});
