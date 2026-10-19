import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFibonacciOptions, fibonacciOptionsForDrawing, fibonacciVisibleAtInterval, renderFibonacci } from '../src/renderer/trading-fibonacci.ts';
import { drawingToWire, drawingFromWire } from '../src/renderer/manual-drawing-sync.ts';
import { tradingManualDrawingMatchesContext } from '../src/renderer/trading-expert-drawing.ts';

const base = () => ({ id: 'fib', tool: 'fib-retracement', symbol: 'binance:usdm:ETHUSDT', points: [{ time: 1800000000, price: 200 }, { time: 1800003600, price: 100 }] });
const render = (drawing, project = p => 400 - p) => renderFibonacci(drawing, { x: 120, y: 200 }, { x: 420, y: 300 }, { width: 800, height: 600 }, project, p => p.toFixed(2));
test('22 independent levels normalize imported data without accepting invalid SVG values', () => {
  const defaults = normalizeFibonacciOptions();
  assert.equal(defaults.levels.length, 22); assert.equal(defaults.levels.filter(l => l.enabled).length, 11);
  const options = normalizeFibonacciOptions({ levels: [{ value: NaN, color: '<svg>', enabled: false }, { value: -.5, color: '#2962FF80' }], trendWidth: -1, lineStyle: 'invalid', fillOpacity: 8 });
  assert.deepEqual(options.levels[0], { value: 0, color: '#808080', enabled: false });
  assert.equal(options.levels[1].value, -.5); assert.equal(options.levels[1].color, '#2962ff80');
  assert.equal(options.trendWidth, 2); assert.equal(options.lineStyle, 'solid'); assert.equal(options.fillOpacity, .2);
  defaults.levels[0].color = '#000000'; assert.equal(normalizeFibonacciOptions().levels[0].color, '#808080');
});
test('enabled values, independent trend styles and extension affect real geometry and hit areas', () => {
  const drawing = base(), fib = drawing.fibonacci = normalizeFibonacciOptions();
  fib.levels.forEach(l => l.enabled = false); fib.levels[0] = { value: .25, color: '#ff980080', enabled: true };
  fib.levels[1] = { value: 1, color: '#2962ff', enabled: true };
  fib.extendLeft = fib.extendRight = true; fib.lineWidth = 4; fib.lineStyle = 'dotted'; fib.trendColor = '#e91e63'; fib.trendWidth = 3;
  let result = render(drawing);
  assert.match(result.body, /data-fibonacci-level="0.25"/); assert.doesNotMatch(result.body, /data-fibonacci-level="0.236"/);
  assert.match(result.body, /x1="0" y1="275" x2="800"/); assert.match(result.hit, /x1="0" y1="275" x2="800"/);
  assert.match(result.body, /stroke="#ff980080" stroke-width="4"[^>]*stroke-dasharray="2 4"/);
  assert.match(result.body, /trading-fibonacci-connector[^>]*stroke="#e91e63" stroke-width="3"/);
  fib.trendVisible = false; fib.fillVisible = false; fib.showLevels = fib.showPrices = false;
  result = render(drawing); assert.doesNotMatch(result.body, /connector|band|label/); assert.equal((result.hit.match(/<line/g) || []).length, 2);
});
test('level positions use the actual price projection for logarithmic charts', () => {
  const result = render(base(), price => price > 0 ? Math.log(price) * 100 : null);
  assert.match(result.body, new RegExp(`y1="${Math.log(150) * 100}"`));
  assert.doesNotMatch(result.body, /NaN|Infinity/);
});
test('toolbar overrides remain editable and settings survive the wire format', () => {
  const drawing = { ...base(), fibonacci: normalizeFibonacciOptions(), color: '#12345678', lineWidth: 4, lineStyle: 'dashed' };
  const o = fibonacciOptionsForDrawing(drawing);
  assert.ok(o.levels.every(l => l.color === '#12345678')); assert.equal(o.lineWidth, 4);
  assert.equal(drawing.fibonacci.levels[0].color, '#808080');
  assert.deepEqual(drawingFromWire(drawingToWire(drawing), drawing.symbol).fibonacci, drawing.fibonacci);
});
test('visibility uses period ranges, numeric minutes and month case without deleting drawings', () => {
  const d = base(), o = d.fibonacci = normalizeFibonacciOptions();
  o.visibility.hours = { enabled: true, min: 2, max: 4 }; o.visibility.months.enabled = false;
  assert.equal(fibonacciVisibleAtInterval(o, '1h'), false); assert.equal(fibonacciVisibleAtInterval(o, '240'), true);
  assert.equal(fibonacciVisibleAtInterval(o, '1m'), true); assert.equal(fibonacciVisibleAtInterval(o, '1M'), false);
  // Visibility only affects rendering, so hidden drawings remain reachable by
  // selection, clear, undo and storage operations in the same market/pane.
  assert.equal(tradingManualDrawingMatchesContext(d, d.symbol, '1h'), true);
  assert.equal(tradingManualDrawingMatchesContext(d, d.symbol, '2h'), true);
});
