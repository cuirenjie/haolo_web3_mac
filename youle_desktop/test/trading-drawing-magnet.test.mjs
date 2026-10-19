import assert from 'node:assert/strict';
import test from 'node:test';
import { TradingDrawingController } from '../src/renderer/trading-expert-drawing.ts';
import { normalizeTradingMagnetPreferences, readTradingMagnetPreferences, writeTradingMagnetPreferences, TRADING_MAGNET_STORAGE_KEY } from '../src/renderer/trading-drawing-magnet.ts';
import { translateDrawingText } from '../src/renderer/app-language.mjs';

function fixture() {
  const candles = [100, 160, 400, 460].map(time => ({ time, open: 100, high: 120, low: 80, close: 110 }));
  const series = { priceToCoordinate: price => 300 - price, coordinateToPrice: y => 300 - y, options: () => ({ visible: true }) };
  const offset = 28800;
  const scale = {
    coordinateToLogical: x => x / 100,
    logicalToCoordinate: i => i * 100,
    timeToCoordinate: time => candles.findIndex(c => c.time + offset === time) * 100,
    timeToIndex: time => candles.findIndex(c => c.time + offset === time),
  };
  const controller = Object.assign(Object.create(TradingDrawingController.prototype), {
    magnetEnabled: true, magnetMode: 'weak', magnetModifierHeld: false, snapToIndicators: false,
    drawingScope: 'main', timeOffsetSeconds: offset,
    getCandles: () => candles, getChart: () => ({ timeScale: () => scale }),
    getCandleSeries: () => series, getMagnetIndicatorSeries: () => [],
  });
  return { controller, candles, series, scale, offset };
}

test('weak magnet captures nearby OHLC; distant points retain both free coordinates', () => {
  const { controller: d } = fixture();
  assert.deepEqual(d.screenToDrawingPoint({ x: 105, y: 193 }, true), { time: 160, price: 110 });
  assert.deepEqual(d.screenToDrawingPoint({ x: 105, y: 50 }, true), { time: 172, price: 250 });
  assert.deepEqual(d.screenToDrawingPoint({ x: 140, y: 193 }, true), d.screenToDrawingPoint({ x: 140, y: 193 }, false));
});

test('strong magnet removes both pixel thresholds and selects the nearest of all four OHLC prices', () => {
  const { controller: d } = fixture(); d.magnetMode = 'strong';
  for (const [y, price] of [[30, 120], [195, 100], [190, 110], [290, 80]]) {
    assert.deepEqual(d.screenToDrawingPoint({ x: 140, y }, true), { time: 160, price });
  }
});

test('strong magnet never invents bars in future or before loaded history', () => {
  const { controller: d } = fixture(); d.magnetMode = 'strong';
  assert.deepEqual(d.screenToDrawingPoint({ x: 410, y: 40 }, true), { time: 526, price: 260 });
  assert.deepEqual(d.screenToDrawingPoint({ x: -110, y: 40 }, true), { time: 34, price: 260 });
});

test('Ctrl/Command temporarily inverts enablement without changing stored strength', () => {
  const { controller: d } = fixture();
  const screen = { x: 105, y: 193 };
  for (const enabled of [false, true]) for (const held of [false, true]) {
    d.magnetEnabled = enabled; d.magnetModifierHeld = held;
    assert.deepEqual(d.screenToDrawingPoint(screen, true), enabled !== held ? { time: 160, price: 110 } : { time: 172, price: 107 });
    assert.deepEqual(d.screenToDrawingPoint(screen, false), { time: 172, price: 107 }, 'geometry conversions bypass the magnet');
    assert.equal(d.magnetEnabled, enabled);
  }
});

test('indicator switch competes with OHLC at the same bar and uses the indicator scale', () => {
  const { controller: d, offset } = fixture();
  const study = {
    options: () => ({ visible: true }),
    dataByIndex: i => ({ time: [100, 160, 400, 460][i] + offset, value: 35 }),
    priceToCoordinate: value => value * 2, // y=70, drawing price=230
  };
  d.getMagnetIndicatorSeries = () => [study];
  d.magnetMode = 'strong';
  assert.equal(d.screenToDrawingPoint({ x: 105, y: 72 }, true).price, 120);
  d.snapToIndicators = true;
  assert.deepEqual(d.screenToDrawingPoint({ x: 105, y: 72 }, true), { time: 160, price: 230 });
  assert.equal(d.screenToDrawingPoint({ x: 105, y: 190 }, true).price, 110, 'OHLC can still win');
  d.magnetMode = 'weak';
  assert.deepEqual(d.screenToDrawingPoint({ x: 105, y: 72 }, true), { time: 160, price: 230 });
});

test('hidden, whitespace, wrong-time, NaN and unprojectable indicator values are excluded', () => {
  const { controller: d, offset } = fixture();
  d.magnetMode = 'strong'; d.snapToIndicators = true;
  const base = { dataByIndex: () => ({ time: 160 + offset, value: 230 }), priceToCoordinate: v => 300 - v };
  for (const study of [
    { ...base, options: () => ({ visible: false }) },
    { ...base, dataByIndex: () => ({ time: 160 + offset }) },
    { ...base, dataByIndex: () => null },
    { ...base, dataByIndex: () => ({ time: 100 + offset, value: 230 }) },
    { ...base, dataByIndex: () => ({ time: 160 + offset, value: NaN }) },
    { ...base, priceToCoordinate: () => null },
  ]) {
    d.getMagnetIndicatorSeries = () => [study];
    assert.equal(d.screenToDrawingPoint({ x: 105, y: 70 }, true).price, 120);
  }
});

test('indicator panes never snap oscillator coordinates to instrument OHLC', () => {
  const { controller: d, series, offset } = fixture();
  d.drawingScope = 'indicator:macd'; d.magnetMode = 'strong';
  d.getMagnetIndicatorSeries = () => [{ ...series, dataByIndex: () => ({ time: 160 + offset, value: -3 }) }];
  assert.deepEqual(d.screenToDrawingPoint({ x: 105, y: 301 }, true), { time: 172, price: -1 });
  d.snapToIndicators = true;
  assert.deepEqual(d.screenToDrawingPoint({ x: 105, y: 301 }, true), { time: 160, price: -3 });
});

test('nearest price is measured visually on inverted/logarithmic scales', () => {
  const { controller: d, series } = fixture(); d.magnetMode = 'strong';
  series.priceToCoordinate = p => Math.log(p) * 100;
  series.coordinateToPrice = y => Math.exp(y / 100);
  const y = (Math.log(100) + Math.log(110)) * 50 + 0.01;
  assert.equal(d.screenToDrawingPoint({ x: 100, y }, true).price, 110);
  series.priceToCoordinate = p => -Math.log(p) * 100;
  series.coordinateToPrice = y => Math.exp(-y / 100);
  assert.equal(d.screenToDrawingPoint({ x: 100, y: -y }, true).price, 110);
});

test('moving an object snaps one anchor and preserves all screen distances', () => {
  const { controller: d } = fixture();
  d.magnetMode = 'strong'; d.dragState = { magnetAnchorIndex: 0 };
  const drawing = { points: [{ time: 172, price: 150 }, { time: 292, price: 130 }] };
  const before = drawing.points.map(p => d.pointToScreen(p));
  d.snapMovedDrawing(drawing);
  const after = drawing.points.map(p => d.pointToScreen(p));
  assert.deepEqual(drawing.points[0], { time: 160, price: 120 });
  assert.ok(Math.abs((before[1].x - before[0].x) - (after[1].x - after[0].x)) < 1e-7);
  assert.ok(Math.abs((before[1].y - before[0].y) - (after[1].y - after[0].y)) < 1e-7);
});

test('preferences are defensive, persistent and remain usable without local storage', () => {
  const oldWindow = globalThis.window;
  const data = new Map();
  try {
    globalThis.window = { localStorage: { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) } };
    assert.deepEqual(readTradingMagnetPreferences(), { enabled: false, mode: 'weak', snapToIndicators: false });
    const saved = { enabled: true, mode: 'strong', snapToIndicators: true };
    writeTradingMagnetPreferences(saved); assert.deepEqual(readTradingMagnetPreferences(), saved);
    data.set(TRADING_MAGNET_STORAGE_KEY, '{broken');
    assert.equal(readTradingMagnetPreferences().mode, 'weak');
    assert.deepEqual(normalizeTradingMagnetPreferences({ enabled: 'yes', mode: 'invalid', snapToIndicators: 1 }), { enabled: false, mode: 'weak', snapToIndicators: false });
    globalThis.window = { get localStorage() { throw Error('unavailable'); } };
    assert.doesNotThrow(() => writeTradingMagnetPreferences(saved));
    assert.equal(readTradingMagnetPreferences().enabled, false);
  } finally { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; }
});

test('magnet labels have reviewed English translations', () => {
  for (const [zh, en] of [['弱磁铁', 'Weak magnet'], ['强磁铁', 'Strong magnet'], ['吸附到指标', 'Snap to indicators'], ['磁铁模式', 'Magnet mode']]) {
    assert.equal(translateDrawingText(zh, 'en'), en);
  }
});
