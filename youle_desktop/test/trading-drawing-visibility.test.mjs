import assert from 'node:assert/strict';
import test from 'node:test';
import { TradingDrawingVisibility, DEFAULT_TRADING_DRAWING_VISIBILITY as defaults, TRADING_VISIBILITY_LAYERS } from '../src/renderer/trading-drawing-visibility.ts';

function environment(t) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const storage = new Map(), window = new EventTarget();
  window.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  t.after(() => original ? Object.defineProperty(globalThis, 'window', original) : delete globalThis.window);
  return { storage, window };
}
const line = Object.freeze({ id: 'line', symbol: 'BTC', drawingScope: 'main' });

test('visibility stays local to conversation, survives recreation, and broadcasts to same-session panes', t => {
  environment(t);
  let updates = 0;
  const a = new TradingDrawingVisibility('a', () => {});
  const pane = new TradingDrawingVisibility('a', () => updates++);
  const b = new TradingDrawingVisibility('b', () => {});
  a.toggleAi(); a.toggle(line);
  assert.equal(updates, 2);
  assert.equal(pane.aiHidden, true); assert.equal(pane.isHidden(line), true);
  assert.equal(b.aiHidden, false); assert.equal(b.isHidden(line), false);
  a.destroy();
  const restored = new TradingDrawingVisibility('a', () => {});
  assert.equal(restored.aiHidden, true); assert.equal(restored.isHidden(line), true);
  pane.toggle(line); pane.toggleAi();
  assert.equal(restored.aiHidden, false); assert.equal(restored.isHidden(line), false);
  pane.destroy(); b.destroy(); restored.destroy();
});

test('hidden recovery skips deleted objects and never matches another market or indicator pane', t => {
  environment(t);
  const state = new TradingDrawingVisibility('a', () => {});
  const second = { ...line, id: 'second' }, indicator = { ...line, drawingScope: 'indicator:volume' };
  state.toggle(line); state.toggle(second);
  assert.equal(state.latestHidden([line, second]), second);
  assert.equal(state.latestHidden([line]), line);
  assert.equal(state.latestHidden([indicator, { ...line, symbol: 'ETH' }]), undefined);
  state.toggle(second); assert.equal(state.latestHidden([line, second]), line);
  state.toggle(line); assert.equal(state.latestHidden([line, second]), undefined);
  state.destroy();
});

test('layer switches span real split panes and preserve each pane individual hiding', t => {
  environment(t);
  const main = new TradingDrawingVisibility('thread', () => {});
  const split = new TradingDrawingVisibility('thread::split-pane:1', () => {});
  const other = new TradingDrawingVisibility('other', () => {});
  const splitLine = { ...line, id: 'split-line' };
  main.toggle(line); split.toggle(splitLine);
  split.setLayers({ manualHidden: true });
  assert.deepEqual(main.layers(), { ...defaults, aiHidden: false, manualHidden: true });
  main.toggleAi();
  assert.deepEqual(split.layers(), { ...defaults, aiHidden: true, manualHidden: true });
  assert.deepEqual(other.layers(), defaults);
  main.setLayers({ aiHidden: false, manualHidden: false });
  assert.equal(main.isHidden(line), true);
  assert.equal(main.isHidden(splitLine), false);
  assert.equal(split.isHidden(splitLine), true);
  assert.equal(split.isHidden(line), false);
  split.setLayers({ aiHidden: true, manualHidden: true });
  for (const [session, ownLine] of [['thread', line], ['thread::split-pane:1', splitLine]]) {
    const restored = new TradingDrawingVisibility(session, () => {});
    assert.deepEqual(restored.layers(), { ...defaults, aiHidden: true, manualHidden: true });
    assert.equal(restored.isHidden(ownLine), true);
    restored.destroy();
  }
  const newSplit = new TradingDrawingVisibility('thread::split-pane:2', () => {});
  assert.deepEqual(newSplit.layers(), { ...defaults, aiHidden: true, manualHidden: true });
  assert.equal(newSplit.isHidden(line), false);
  main.destroy(); split.destroy(); other.destroy(); newSplit.destroy();
});

test('legacy AI visibility and manual layer state survive session promotion and reload', t => {
  const { storage } = environment(t);
  storage.set('haolo.trading-market.drawing-visibility.v1.temporary', '{"aiHidden":true,"hidden":[]}');
  const state = new TradingDrawingVisibility('temporary', () => {});
  assert.deepEqual(state.layers(), { ...defaults, aiHidden: true, manualHidden: false });
  state.setLayers({ manualHidden: true });
  state.switchSession('permanent', true);
  state.switchSession('other', false);
  assert.deepEqual(state.layers(), defaults);
  state.switchSession('permanent', false);
  assert.deepEqual(state.layers(), { ...defaults, aiHidden: true, manualHidden: true });
  state.destroy();
});

test('thread promotion preserves hidden state while ordinary session switches load their own state', t => {
  environment(t);
  const state = new TradingDrawingVisibility('temporary', () => {});
  state.toggleAi(); state.toggle(line);
  state.switchSession('permanent', true);
  state.switchSession('unrelated', false);
  assert.equal(state.aiHidden, false); assert.equal(state.isHidden(line), false);
  state.switchSession('permanent', false);
  assert.equal(state.aiHidden, true); assert.equal(state.isHidden(line), true);
  state.destroy();
});

test('malformed or unavailable local storage does not break visibility controls', t => {
  const { storage, window } = environment(t);
  const key = 'haolo.trading-market.drawing-visibility.v1.a';
  for (const invalid of ['null', '{', '[]', '{"aiHidden":1,"hidden":[null,3]}']) {
    storage.set(key, invalid);
    const state = new TradingDrawingVisibility('a', () => {});
    assert.equal(state.aiHidden, false); assert.equal(state.isHidden(line), false);
    state.destroy();
  }
  window.localStorage.setItem = () => { throw Error('quota'); };
  const state = new TradingDrawingVisibility('a', () => {});
  state.toggleAi(); state.toggle(line);
  assert.equal(state.aiHidden, true); assert.equal(state.isHidden(line), true);
  state.destroy();
});

test('all five independent switches persist, sync split panes and survive promotion without clearing individual choices', t => {
  environment(t);
  const main = new TradingDrawingVisibility('temporary', () => {});
  const split = new TradingDrawingVisibility('temporary::split-pane:1', () => {});
  main.toggle(line);
  for (const { key } of TRADING_VISIBILITY_LAYERS) {
    main.setAll(false);
    split.setLayers({ [key]: true });
    assert.deepEqual(main.layers(), { ...defaults, [key]: true });
    assert.equal(main.allHidden, false);
    const restored = new TradingDrawingVisibility('temporary', () => {});
    assert.deepEqual(restored.layers(), main.layers());
    assert.equal(restored.isHidden(line), true);
    restored.destroy();
  }
  main.setAll(true);
  assert.equal(split.allHidden, true);
  main.switchSession('permanent', true);
  main.switchSession('other', false);
  assert.deepEqual(main.layers(), defaults);
  main.switchSession('permanent', false);
  assert.equal(main.allHidden, true);
  main.setAll(false);
  assert.deepEqual(main.layers(), defaults);
  assert.equal(main.isHidden(line), true);
  main.destroy(); split.destroy();
});

test('legacy global data hiding seeds missing conversation choices without overriding explicit choices', t => {
  const { storage } = environment(t);
  storage.set('haolo.trading-market.drawing-visibility.v1.legacy', '{"aiHidden":true,"hidden":[]}');
  const main = new TradingDrawingVisibility('legacy', () => {});
  const split = new TradingDrawingVisibility('legacy::split-pane:1', () => {});
  main.migrateLegacyDataVisibility(true);
  assert.equal(main.aiHidden, true);
  assert.equal(main.dataHidden, true);
  assert.equal(split.dataHidden, true);
  main.setLayers({ dataHidden: false });
  main.migrateLegacyDataVisibility(true);
  assert.equal(main.dataHidden, false, 'explicit Show wins over the historical global switch');
  const restored = new TradingDrawingVisibility('legacy', () => {});
  restored.migrateLegacyDataVisibility(true);
  assert.equal(restored.dataHidden, false);
  main.switchSession('fresh', false);
  main.migrateLegacyDataVisibility(false);
  assert.equal(main.dataHidden, false);
  main.migrateLegacyDataVisibility(true);
  assert.equal(main.dataHidden, true);
  main.destroy(); split.destroy(); restored.destroy();
});
