import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { TradingChartNavigation, captureManualTradingPriceRanges, restoreManualTradingPriceRanges, setTradingLogPriceRange } from "../src/renderer/trading-chart-navigation.ts";
import { deferTradingChartShellRender } from "../src/renderer/trading-chart-interaction.ts";

class ElementStub extends EventTarget {
  constructor(tag = "div") {
    super(); this.tag = tag; this.style = { setProperty(k, v) { this[k] = v; } }; this.dataset = {}; this.children = []; this.attrs = {};
    const classes = new Set();
    this.classList = { add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)), toggle: (x, on) => on ? classes.add(x) : classes.delete(x) };
    this.clientHeight = 610; this.clientWidth = 600;
    this.offsetWidth = 200; this.offsetHeight = 34; this.hidden = false;
  }
  append(...children) { children.forEach(c => { c.parentElement = this; this.children.push(c); }); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this); }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  contains(n) { return n === this || this.children.some(c => c.contains(n)); }
  focus() { document.activeElement = this; }
  closest(selector) {
    const action = selector.match(/data-navigation-action(?:="([^"]+)")?/);
    if (action ? this.dataset.navigationAction && (!action[1] || this.dataset.navigationAction === action[1]) : selector.split(", ").includes(this.tag)) return this;
    return this.parentElement?.closest(selector) ?? null;
  }
  setPointerCapture(id) { this.capturedPointer = id; }
  hasPointerCapture(id) { return this.capturedPointer === id; }
  releasePointerCapture() { this.capturedPointer = null; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    const action = selector.match(/data-navigation-action="([^"]+)"/)?.[1];
    return this.children.flatMap(c => [...((action ? c.dataset.navigationAction === action : selector === c.tag) ? [c] : []), ...c.querySelectorAll(selector)]);
  }
  getBoundingClientRect() { return { left: 10, right: 610, top: 0, bottom: 610, width: 600, height: 610 }; }
}

function fixture(t) {
  const previous = new Map(["window", "document", "Element", "Node"].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const win = new EventTarget(); const frames = new Map(); let frameId = 0;
  win.requestAnimationFrame = fn => { frames.set(++frameId, fn); return frameId; };
  win.cancelAnimationFrame = id => frames.delete(id);
  for (const [key, value] of Object.entries({ window: win, document: { createElement: tag => new ElementStub(tag), activeElement: null }, Element: ElementStub, Node: ElementStub })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const scales = [0, 1].map(() => ({
    autoScale: true, mode: 0, range: { from: 100, to: 200 }, changes: [], invertScale: false, scaleMargins: { top: 0, bottom: 0 },
    width: () => 60, options() { return this; }, getVisibleRange() { return this.range; },
    setAutoScale(v) { this.autoScale = v; this.changes.push(v); },
    setVisibleRange(r) { this.range = r; this.autoScale = false; }, applyOptions(o) { Object.assign(this, o); },
  }));
  const panes = scales.map((_, i) => ({
    paneIndex: () => i, getHeight: () => 300, factor: 1, setHeight(h) { this.factor = h / 300; },
    getStretchFactor() { return this.factor; }, setStretchFactor(f) { this.factor = f; },
    getHTMLElement: () => ({ getBoundingClientRect: () => ({ left: 10, right: 610, top: i * 310, bottom: i * 310 + 300 }) }),
    getSeries: () => [{ options: () => ({}), coordinateToPrice: () => null }, { options: () => ({}), coordinateToPrice: y => 200 - y / 3, subscribeDataChanged() {}, unsubscribeDataChanged() {} }],
  }));
  let range = { from: 0, to: 300 }; const tsOptions = { barSpacing: 2, minBarSpacing: 0.5, maxBarSpacing: 0, rightBarStaysOnScroll: true };
  const rangeListeners = new Set(), sizeListeners = new Set();
  const ts = { coordinateToLogical: x => x / 2, setVisibleLogicalRange: r => { range = r; }, getVisibleLogicalRange: () => range,
    subscribeVisibleLogicalRangeChange: fn => rangeListeners.add(fn), unsubscribeVisibleLogicalRangeChange: fn => rangeListeners.delete(fn),
    subscribeSizeChange: fn => sizeListeners.add(fn), unsubscribeSizeChange: fn => sizeListeners.delete(fn),
    options: () => tsOptions, applyOptions: o => Object.assign(tsOptions, o), height: () => 28, width: () => 540,
    resetTimeScale: () => { range = { from: 200, to: 500 }; }, scrollPosition: () => range.to - 300,
    scrollToPosition: position => { if (!Number.isFinite(position)) return; const delta = position - (range.to - 300); range = { from: range.from + delta, to: range.to + delta }; } };
  const nativeScroll = [];
  const layout = { fontSize: 11 };
  const chart = { panes: () => panes, priceScale: (side, i) => side === "left" ? { width: () => 0 } : scales[i], timeScale: () => ts,
    options: () => ({ layout }),
    applyOptions(options) {
      if (options.handleScroll) nativeScroll.push(options.handleScroll);
      if (options.layout) Object.assign(layout, options.layout);
      if (options.rightPriceScale) scales.forEach(scale => scale.applyOptions(options.rightPriceScale));
    } };
  const element = new ElementStub(); let paints = 0; let focus = null;
  const options = { getScaleAnchor: () => "right", onFocus: i => { focus = i; }, getCandles: () => Array.from({ length: 301 }, (_, i) => ({ time: i * 3600, volume: 1 })) };
  const navigation = new TradingChartNavigation(element, () => chart, () => paints++, options);
  t.after(() => { navigation.destroy(); for (const [k, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, k, descriptor); else delete globalThis[k]; });
  const send = (type, props = {}, consumed = false, target) => {
    const event = new Event(type, { cancelable: true });
    const { timeStamp, ...values } = props;
    Object.assign(event, { pointerId: 1, isPrimary: true, pointerType: "mouse", button: 0, clientX: 250, clientY: 100, deltaX: 0, deltaY: 0, deltaMode: 0 }, values);
    if (timeStamp !== undefined) Object.defineProperty(event, 'timeStamp', { value: timeStamp });
    (target ?? (["pointerdown", "wheel", "dblclick", "keydown"].includes(type) ? element : win)).dispatchEvent(event);
    assert.equal(event.defaultPrevented, consumed, `${type} event ownership`);
  };
  const paint = (time = 0) => { const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn(time)); };
  return { win, chart, scales, panes, element, navigation, options, frames, rangeListeners, sizeListeners, nativeScroll, send, paint, paints: () => paints, range: () => range, focus: () => focus };
}

// Manual gesture tests retain the unlocked production default and start with
// the same initial auto-fit used by the chart workspace.
function freeDragFixture(t) {
  const f = fixture(t);
  f.navigation.setAutoScale(true);
  f.scales[0].changes.length = 0;
  return f;
}

function momentumFixture(t) {
  const f = freeDragFixture(t);
  const moves = [];
  f.chart.haoloPanByPixels = (x, y, pane) => {
    moves.push({ x, y, pane });
    const ts = f.chart.timeScale(); ts.scrollToPosition(ts.scrollPosition() - x / ts.options().barSpacing, false);
    return { x, y };
  };
  f.flick = (start = 0, locked = false) => {
    f.send('pointerdown', { timeStamp: start }, locked);
    for (let i = 1; i <= 4; i++) f.send('pointermove', { clientX: 250 + i * 12, clientY: 100 + i * 4, timeStamp: start + i * 16 }, locked);
    f.send('pointerup', { clientX: 298, clientY: 116, timeStamp: start + 64 });
  };
  return { ...f, moves };
}

test('release momentum holds shell ownership through the last paint and stops naturally', t => {
  const f = momentumFixture(t); let resumed = 0;
  f.flick(); assert.ok(f.navigation.coasting);
  assert.equal(deferTradingChartShellRender(() => resumed++), true);
  for (let time = 80; time < 2000 && f.navigation.coasting; time += 16) f.paint(time);
  assert.equal(f.navigation.coasting, null); assert.equal(resumed, 1);
  assert.ok(f.moves.length > 30); assert.ok(f.moves[0].x > f.moves.at(-1).x);
  assert.ok(f.moves.some(m => m.y > 0));
  f.paint(2000); f.paint(2016); assert.equal(f.frames.size, 0);
});

test('new drag and wheel take over momentum without releasing the chart between gestures', async t => {
  const f = momentumFixture(t); let resumed = 0;
  f.flick(); deferTradingChartShellRender(() => resumed++); f.paint(80);
  f.send('pointerdown', { timeStamp: 90 }); await Promise.resolve();
  assert.equal(f.navigation.coasting, null); assert.equal(resumed, 0);
  f.send('pointerup', { timeStamp: 95 }); assert.equal(resumed, 1);
  f.flick(100); deferTradingChartShellRender(() => resumed++); f.paint(180);
  f.send('wheel', { deltaY: 12 }, true); assert.equal(f.navigation.coasting, null); assert.equal(resumed, 1);
  await new Promise(r => setTimeout(r, 150)); assert.equal(resumed, 2);
});

test('Escape, cancel, blur, context change and destroy stop all release movement', async t => {
  for (const end of [f => f.send('keydown', { key: 'Escape' }, true), f => f.navigation.cancelGesture(),
    f => f.win.dispatchEvent(new Event('blur')), f => f.navigation.setVerticalLocked(true), f => f.navigation.destroy()]) {
    await t.test(String(end), t => {
      const f = momentumFixture(t); f.flick(); f.paint(80); const count = f.moves.length;
      end(f); f.paint(96); f.paint(112);
      assert.equal(f.moves.length, count); assert.equal(f.navigation.coasting, null);
    });
  }
});

test('locked navigation glides horizontally and native boundaries terminate the animation', t => {
  const f = momentumFixture(t); f.navigation.setVerticalLocked(true); f.flick(0, true); f.paint(80);
  assert.ok(f.moves.length); assert.ok(f.moves.every(m => m.y === 0));
  f.chart.haoloPanByPixels = () => ({ x: 0, y: 0 }); f.paint(96);
  assert.equal(f.navigation.coasting, null);
});

test('reduced motion, drawing selection, axis adjustment and touch never start mouse momentum', t => {
  const f = momentumFixture(t);
  f.win.matchMedia = () => ({ matches: true }); f.flick(); assert.equal(f.navigation.coasting, null);
  f.win.matchMedia = () => ({ matches: false });
  for (const props of [{ clientX: 580 }, { pointerType: 'touch' }]) {
    f.send('pointerdown', { timeStamp: 0, ...props });
    for (let i = 1; i <= 4; i++) f.send('pointermove', { clientY: 100 + i * 10, timeStamp: i * 16, ...props });
    f.send('pointerup', { timeStamp: 64, ...props }); assert.equal(f.navigation.coasting, null);
  }
  f.navigation.setTool('measure'); f.send('pointerdown', { timeStamp: 100 }, true);
  f.send('pointermove', { clientX: 350, timeStamp: 132 }, true);
  f.send('pointerup', { clientX: 350, timeStamp: 148 }, true);
  assert.equal(f.navigation.coasting, null);
});

test('horizontal wheel bursts retain every delta and write the native scale only once per frame', t => {
  const f = fixture(t); let writes = 0;
  const ts = f.chart.timeScale(), write = ts.scrollToPosition;
  ts.scrollToPosition = (...args) => { writes++; write(...args); };
  for (let i = 0; i < 100; i++) f.send('wheel', { deltaX: 2 }, true);
  assert.equal(writes, 0); f.paint(); assert.equal(writes, 1); assert.deepEqual(f.range(), { from: 100, to: 400 });
  f.send('wheel', { deltaX: -200 }, true); f.paint(); assert.deepEqual(f.range(), { from: 0, to: 300 });
});

test('shared navigation buttons preserve the armed tool until click; unrelated controls still cancel', t => {
  const f = fixture(t);
  const workspace = new ElementStub('[data-trading-market-workspace]');
  const toolbar = new ElementStub('[data-drawing-toolbar]');
  workspace.append(f.element, toolbar);
  const control = new ElementStub('[data-drawing-action]'); toolbar.append(control);
  for (const tool of ['measure', 'zoom']) {
    f.navigation.setTool(tool);
    f.send('pointerdown', {}, true); f.send('pointerup');
    const selection = f.navigation.selection;
    assert.ok(selection);
    for (const action of ['measure', 'zoom-in']) {
      control.dataset.drawingAction = action;
      f.navigation.outsidePointerDown({target: control});
      assert.equal(f.navigation.getTool(), tool);
      assert.equal(f.navigation.selection, selection);
    }
    control.dataset.drawingAction = 'select-group-tool';
    f.navigation.outsidePointerDown({target: control});
    assert.equal(f.navigation.getTool(), null);
    assert.equal(f.navigation.selection, null);
    // A matching button in another workspace is still outside this chart.
    const foreign = new ElementStub('[data-drawing-toolbar]'); foreign.append(control);
    control.dataset.drawingAction = 'measure';
    toolbar.children = [];
    f.navigation.setTool(tool);
    f.navigation.outsidePointerDown({target: control});
    assert.equal(f.navigation.getTool(), null);
    toolbar.append(control);
  }
});

test('floating toolbar grips do not focus, pan or zoom the chart', t => {
  const f = fixture(t);
  const toolbar = new ElementStub('[role=toolbar]'), grip = new ElementStub('span');
  toolbar.append(grip); f.element.append(toolbar);
  const editor = new ElementStub('textarea'); editor.focus();
  const before = f.range();
  f.navigation.pointerDown({ target: grip, isPrimary: true, button: 0, clientX: 250, clientY: 100 });
  f.send('pointermove', { clientX: 310, clientY: 140 }); f.send('pointerup');
  f.navigation.wheel({ target: grip, deltaX: 0, deltaY: -100 }); f.paint();
  assert.equal(document.activeElement, editor);
  assert.equal(f.focus(), null);
  assert.equal(f.navigation.drag, null);
  assert.deepEqual(f.range(), before);
});

test('A/L controls are absent; price settings and shortcuts still target main after indicator focus', t => {
  const f = freeDragFixture(t);
  f.send('pointerdown', { clientY: 400 }); f.send('pointerup');
  assert.equal(f.element.children.length, 0);
  f.navigation.setAutoScale(false); f.paint();
  assert.deepEqual(f.scales.map(s => s.autoScale), [false, true]);
  f.navigation.setAutoScale(true); f.navigation.setMode(1); f.paint();
  assert.deepEqual(f.scales.map(s => s.mode), [1, 0]);
  assert.deepEqual(f.scales.map(s => s.autoScale), [true, true]);
  f.send('keydown', { key: 'p', altKey: true }, true);
  assert.deepEqual(f.scales.map(s => s.mode), [2, 0]);
  f.send('keydown', { key: 'l', altKey: true }, true);
  assert.deepEqual(f.scales.map(s => s.mode), [1, 0]);
});

test('indicator menu keeps local auto and inversion but cannot change indicator units', t => {
  const f = freeDragFixture(t);
  f.send('contextmenu', { clientY: 400 }, true, f.element);
  const buttons = f.navigation.menu.children;
  assert.equal(buttons.length, 3);
  assert.match(buttons[1].textContent, /副图/);
  buttons[1].dispatchEvent(new Event('click'));
  assert.deepEqual(f.scales.map(s => s.autoScale), [true, false]);
  f.paint();
  assert.equal(f.scales[0].autoScale, true);
});

test('remove all drawings is an immediate menu action on both main and indicator panes', t => {
  const f = fixture(t);
  let cleared = 0;
  f.options.onRemoveAllDrawings = () => { cleared++; };
  for (const clientY of [100, 400]) {
    const initialRange = { ...f.range() };
    f.send('contextmenu', { clientY }, true, f.element);
    const button = f.navigation.menu.children.at(-1);
    assert.equal(button.textContent, '移除所有绘图');
    assert.equal(button.getAttribute('role'), 'menuitem');
    assert.equal(button.getAttribute('aria-checked'), undefined);
    assert.equal(cleared, clientY === 100 ? 0 : 1, 'opening the menu cannot delete');
    button.dispatchEvent(new Event('click'));
    assert.equal(cleared, clientY === 100 ? 1 : 2);
    assert.equal(f.navigation.menu, null);
    assert.equal(document.activeElement, f.element);
    assert.deepEqual(f.range(), initialRange, 'removal preserves the chart viewport');
  }
});

test('price lock starts disabled, fits after enabling, and can be unlocked and relocked', t => {
  const f = fixture(t), ts = f.chart.timeScale(), positions = [], native = f.nativeScroll;
  f.options.getAutoScale = () => false;
  f.options.onAutoScaleChange = () => assert.fail('lock must not change the saved A setting');
  f.scales[0].autoScale = false;
  ts.scrollPosition = () => 8; ts.scrollToPosition = position => positions.push(position);
  assert.equal(f.navigation.isVerticalLocked(), false);
  assert.deepEqual(native, [{ pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true }]);
  f.scales[0].changes.length = 0;
  f.navigation.setVerticalLocked(true);
  f.paint();
  assert.equal(f.navigation.isVerticalLocked(), true);
  f.send('pointerdown', {}, true);
  f.send('pointermove', { clientX: 270, clientY: 180 }, true);
  f.send('pointermove', { clientX: 290, clientY: 200 }, true);
  assert.deepEqual(positions, []); f.paint(); assert.deepEqual(positions, [-12]);
  assert.deepEqual(f.scales.map(s => s.changes), [[true], []]);
  f.paint(); assert.equal(f.scales[0].autoScale, true);
  f.send('pointermove', { clientX: 310, clientY: 210 }, true); f.send('pointerup');
  assert.deepEqual(positions, [-12, -22]);
  f.navigation.setVerticalLocked(!f.navigation.isVerticalLocked()); f.paint();
  assert.equal(f.navigation.isVerticalLocked(), false);
  assert.deepEqual(native.map(o => o.pressedMouseMove), [true, false, true]);
  assert.equal(f.scales[0].autoScale, false);
  delete f.options.onAutoScaleChange;
  f.send('pointerdown'); f.send('pointermove', { clientY: 160 }); f.send('pointerup');
  assert.equal(f.scales[0].autoScale, false);
  f.navigation.setVerticalLocked(!f.navigation.isVerticalLocked()); f.paint();
  assert.equal(f.navigation.isVerticalLocked(), true);
  assert.equal(f.scales[0].autoScale, true);
});

test('linear lock refits every visible range and data update, while unlocked prices remain manual', t => {
  const f = fixture(t), ts = f.chart.timeScale(); let revision = 0;
  f.options.getAutoScale = () => false;
  f.options.getLockedPriceRange = range => range && ({ from: 100 + range.from + revision, to: 200 + range.to + revision });
  f.navigation.setVerticalLocked(true);
  f.paint();
  assert.deepEqual(f.scales[0].range, { from: 100, to: 500 });
  ts.setVisibleLogicalRange({ from: 40, to: 100 });
  f.navigation.schedule(); f.paint();
  assert.deepEqual(f.scales[0].range, { from: 140, to: 300 });
  revision = 20; f.navigation.schedule(); f.paint();
  assert.deepEqual(f.scales[0].range, { from: 160, to: 320 });
  assert.deepEqual(f.scales[1].changes, []);
  f.navigation.setVerticalLocked(!f.navigation.isVerticalLocked());
  ts.setVisibleLogicalRange({ from: 100, to: 200 }); f.paint(); f.paint();
  assert.deepEqual(f.scales[0].range, { from: 160, to: 320 });
});

test('locked log and percentage use native auto-fit without linear range writes or preference changes', t => {
  const f = fixture(t); let auto = false;
  f.options.getAutoScale = () => auto;
  f.options.onAutoScaleChange = value => { auto = value; };
  f.options.getLockedPriceRange = () => assert.fail('linear prices cannot be written into transformed axes');
  f.scales[0].mode = 1;
  f.navigation.setVerticalLocked(true);
  f.paint(); f.paint();
  assert.equal(f.scales[0].autoScale, true); assert.equal(auto, false);
  f.navigation.setMode(2); f.navigation.setAutoScale(false); f.paint(); f.paint();
  assert.equal(f.scales[0].autoScale, true); assert.equal(auto, false);
  f.navigation.setAutoScale(true);
  f.navigation.setVerticalLocked(!f.navigation.isVerticalLocked()); f.paint();
  assert.equal(f.scales[0].autoScale, true); assert.equal(auto, true);
});

test('explicit auto-off fits initially, manual override persists, and reset restores Auto', t => {
  const f = freeDragFixture(t); let auto = false;
  f.options.getAutoScale = () => auto; f.options.onAutoScaleChange = enabled => { auto = enabled; };
  f.paint(); assert.equal(f.scales[0].autoScale, true); f.paint(); assert.deepEqual(f.scales.map(s => s.autoScale), [false, true]);
  f.navigation.setAutoScale(true); f.paint(); assert.equal(f.scales[0].autoScale, true);
  f.send('pointerdown'); f.send('pointermove', { clientY: 160 }); f.send('pointerup');
  assert.equal(auto, false);
  f.navigation.reset(); f.paint(); f.paint(); assert.deepEqual(f.scales.map(s => s.autoScale), [true, true]);
  assert.equal(auto, true);
});

test('shell renders cannot detach a chart mid-drag and are released by up, cancel, blur and destruction', t => {
  const f = freeDragFixture(t);
  let resumed = 0;
  for (const finish of [() => f.send('pointerup'), () => f.send('pointercancel'), () => f.win.dispatchEvent(new Event('blur')), () => f.navigation.destroy()]) {
    f.send('pointerdown');
    assert.equal(deferTradingChartShellRender(() => resumed++), true);
    const before = resumed;
    f.send('pointermove', { clientX: 270 });
    assert.equal(resumed, before);
    finish();
    assert.equal(resumed, before + 1);
    assert.equal(deferTradingChartShellRender(() => resumed++), false);
  }
});

test('continuous wheel input holds the shell until scrolling settles', async t => {
  const f = freeDragFixture(t);
  let resumed = 0;
  f.send('wheel', { deltaY: 10 }, true);
  assert.equal(deferTradingChartShellRender(() => resumed++), true);
  await new Promise(r => setTimeout(r, 150));
  assert.equal(resumed, 1);
  f.send('wheel', { deltaY: 10 }, true);
  assert.equal(deferTradingChartShellRender(() => resumed++), true);
  f.navigation.destroy();
  assert.equal(resumed, 2);
});

test("horizontal pan preserves Auto, deliberate vertical drag freezes just the target pane", t => {
  const f = freeDragFixture(t);
  f.send("pointerdown"); f.send("pointermove", { clientX: 450, clientY: 102 }); f.send("pointerup");
  assert.equal(f.scales[0].autoScale, true);
  f.send("pointerdown"); f.send("pointermove", { clientY: 140 }); f.send("pointermove", { clientY: 170 });
  assert.deepEqual(f.scales.map(s => s.changes), [[false], []]);
});
test("axis and separator gestures stay native; indicator drag targets its own scale", t => {
  const f = freeDragFixture(t);
  f.send("pointerdown", { clientX: 580 }); f.send("pointermove", { clientY: 240 }); f.send("pointerup");
  f.send("pointerdown", { clientY: 305 }); f.send("pointermove", { clientY: 400 }); f.send("pointerup");
  assert.deepEqual(f.scales.map(s => s.changes), [[], []]);
  f.send("pointerdown", { clientY: 400 }); f.send("pointermove", { clientY: 450 });
  assert.equal(f.focus(), 1); assert.deepEqual(f.scales.map(s => s.changes), [[], [false]]);
});
test("Shift measures without changing the viewport, keeps its result, and next click clears it", t => {
  const f = freeDragFixture(t); const before = { ...f.range() };
  f.send("pointerdown", { shiftKey: true }, true);
  f.send("pointermove", { clientX: 450, clientY: 200 }, true);
  f.send("pointerup", { clientX: 450, clientY: 200 }, true);
  assert.deepEqual(f.range(), before); assert.equal(f.scales[0].autoScale, true);
  assert.equal(f.navigation.measurement.children[0].textContent, '−33.33 (−20.00%) −3,333\n100根K线, 4天 4小时\n成交量 101');
  f.send("pointerdown"); assert.equal(f.navigation.measurement, null);
});
test("zoom tool supports reversed drags, clamps endpoints, and returns to cursor", t => {
  const f = freeDragFixture(t); f.navigation.setTool("zoom");
  f.send("pointerdown", {}, true); f.send("pointermove", { clientX: -100, clientY: 250 }, true);
  f.send("pointerup", { clientX: -100, clientY: 250 }, true);
  assert.deepEqual(f.range(), { from: 0, to: 120 });
  assert.ok(f.scales[0].range.from > 110 && f.scales[0].range.to < 170);
  assert.equal(f.scales[0].autoScale, false); assert.equal(f.navigation.getTool(), null);
});
test("two-click zoom previews after first release and completes on second click", t => {
  const f = freeDragFixture(t); f.navigation.setTool("zoom");
  f.send("pointerdown", {}, true); f.send("pointerup");
  assert.equal(f.navigation.selection.awaitingClick, true);
  f.send("pointermove", { clientX: 450, clientY: 250 });
  f.send("pointerdown", { clientX: 450, clientY: 250 }, true);
  f.send("pointerup", { clientX: 450, clientY: 250 }, true);
  assert.deepEqual(f.range(), { from: 120, to: 220 });
});
test("Escape, cancel, blur, second touch and reload release selections without applying them", t => {
  const f = freeDragFixture(t);
  for (const cancel of [() => f.send("keydown", { key: "Escape" }, true), () => f.send("pointercancel"), () => f.win.dispatchEvent(new Event("blur")), () => f.send("pointerdown", { pointerId: 2, isPrimary: false }), () => f.navigation.cancelGesture()]) {
    f.navigation.setTool("zoom"); f.send("pointerdown", {}, true); cancel();
    f.send("pointermove", { clientX: 450, clientY: 240 }); f.send("pointerup");
    assert.deepEqual(f.range(), { from: 0, to: 300 }); assert.equal(f.scales[0].autoScale, true); assert.equal(f.navigation.selection, null);
  }
});
test("Ctrl wheel always focuses cursor, ordinary wheel uses the configured default", t => {
  const f = freeDragFixture(t);
  f.send("wheel", { deltaY: -100 }, true); assert.equal(f.chart.timeScale().options().rightBarStaysOnScroll, true);
  f.send("wheel", { deltaY: -100, ctrlKey: true }, true); assert.equal(f.chart.timeScale().options().rightBarStaysOnScroll, false);
  f.options.getScaleAnchor = () => "cursor";
  f.send("wheel", { deltaY: -100, ctrlKey: true }, true); assert.equal(f.chart.timeScale().options().rightBarStaysOnScroll, false);
  f.send("wheel", { deltaY: -100 }, true); assert.equal(f.chart.timeScale().options().rightBarStaysOnScroll, false);
});
test("Shift wheel pans once, preserves bar spacing and Auto, and normalizes line deltas", t => {
  const f = freeDragFixture(t);
  f.send("wheel", { deltaY: 100, shiftKey: true }, true); f.paint(); assert.deepEqual(f.range(), { from: 50, to: 350 });
  f.send("wheel", { deltaX: -100, shiftKey: true }, true); f.paint(); assert.deepEqual(f.range(), { from: 0, to: 300 });
  f.send("wheel", { deltaY: 1, deltaMode: 1, shiftKey: true }, true); f.paint(); assert.deepEqual(f.range(), { from: 16, to: 316 });
  assert.equal(f.scales[0].autoScale, true);
});
test("wheel on right price axis scales typography and width without changing candle or price ranges", t => {
  const f = freeDragFixture(t); f.send("wheel", { clientX: 580, deltaY: -100 }, true);
  f.paint();
  assert.deepEqual(f.range(), { from: 0, to: 300 });
  assert.deepEqual(f.scales[0].range, { from: 100, to: 200 });
  assert.equal(f.scales[0].autoScale, true);
  assert.ok(f.chart.options().layout.fontSize > 11);
  assert.equal(f.scales[0].minimumWidth, Math.ceil(60 * f.chart.options().layout.fontSize / 11));
  f.send("wheel", { clientX: 580, deltaY: 100 }, true); f.paint();
  assert.ok(Math.abs(f.chart.options().layout.fontSize - 11) < 1e-8);
  for (let i = 0; i < 20; i++) f.send("wheel", { clientX: 580, deltaY: -100 }, true);
  f.paint(); assert.equal(f.chart.options().layout.fontSize, 24);
  for (let i = 0; i < 30; i++) f.send("wheel", { clientX: 580, deltaY: 100 }, true);
  f.paint(); assert.equal(f.chart.options().layout.fontSize, 8);
  f.send("wheel", { clientX: 250, deltaY: -100 }, true); f.paint();
  assert.ok(f.range().to - f.range().from < 300);
  assert.equal(f.chart.options().layout.fontSize, 8);
  const span = f.range().to - f.range().from;
  f.send("wheel", { clientX: 580, deltaY: -100 }, true);
  f.send("wheel", { clientX: 250, deltaY: -100 }, true);
  f.paint(); f.paint();
  assert.ok(f.range().to - f.range().from < span, "moving off the axis cannot restore over a later chart zoom");
});
test("focused chart navigation keys pan, zoom, reset and toggle scales", t => {
  const f = freeDragFixture(t);
  f.send("keydown", { key: "ArrowLeft" }, true); assert.deepEqual(f.range(), { from: -1, to: 299 });
  f.send("keydown", { key: "ArrowRight", ctrlKey: true }, true); assert.deepEqual(f.range(), { from: 9, to: 309 });
  f.send("keydown", { key: "ArrowUp", ctrlKey: true }, true); assert.equal(f.range().to - f.range().from, 240);
  f.send("keydown", { key: "l", altKey: true }, true); assert.equal(f.scales[0].mode, 1);
  f.send("keydown", { key: "p", altKey: true }, true); assert.equal(f.scales[0].mode, 2);
  f.send("keydown", { key: "i", altKey: true }, true); assert.equal(f.scales[0].invertScale, true);
  f.send("keydown", { key: "r", altKey: true }, true); assert.equal(f.scales[0].autoScale, true); assert.deepEqual(f.range(), { from: 200, to: 500 });
});
test("global keyboard events and editable targets do not navigate a chart", t => {
  const f = freeDragFixture(t); f.send("keydown", { key: "r", altKey: true }, false, f.win);
  const input = new ElementStub("input");
  const e = new Event("keydown", { cancelable: true }); Object.assign(e, { key: "ArrowLeft" }); Object.defineProperty(e, "target", { value: input });
  f.navigation.keyDown(e); assert.equal(e.defaultPrevented, false); assert.deepEqual(f.range(), { from: 0, to: 300 });
});
test("double-click maximizes and restores pane proportions; axes stay native", t => {
  const f = freeDragFixture(t); f.send("dblclick", {}, true); assert.deepEqual(f.panes.map(p => p.factor), [1, 0]);
  f.send("dblclick", {}, true); assert.deepEqual(f.panes.map(p => p.factor), [1, 1]);
  f.send("dblclick", { clientX: 580 }, true); assert.deepEqual(f.panes.map(p => p.factor), [1, 1]);
});
test("manual theme snapshots preserve scale ownership and ignore changed modes", t => {
  const f = freeDragFixture(t); f.scales[0].autoScale = false;
  const snapshot = captureManualTradingPriceRanges(f.chart); f.scales[0].range = { from: 0, to: 1 };
  restoreManualTradingPriceRanges(snapshot); assert.deepEqual(f.scales[0].range, { from: 100, to: 200 });
  f.scales[0].mode = 1; assert.deepEqual(captureManualTradingPriceRanges(f.chart), []);
  f.scales[0].range = { from: 50, to: 150 }; restoreManualTradingPriceRanges(snapshot); assert.deepEqual(f.scales[0].range, { from: 50, to: 150 });
});
test("bursts coalesce overlay paints and destroy removes listeners and pending frames", t => {
  const f = freeDragFixture(t); f.send("wheel"); f.send("wheel"); assert.equal(f.frames.size, 1);
  f.paint(); f.paint(); assert.equal(f.paints(), 2); assert.equal(f.frames.size, 0);
  f.send("pointerdown"); f.navigation.destroy(); f.send("pointermove", { clientY: 200 });
  assert.deepEqual(f.scales[0].changes, []); assert.equal(f.frames.size, 0);
});
test("new controls, measurement and menus use theme tokens in default and interactive states", () => {
  const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const section = css.split(".trading-chart-navigable {")[1].split(".trading-market-brand {")[0];
  assert.doesNotMatch(section, /#[\da-f]{3,8}\b/i);
  for (const state of [":hover", ":focus-visible", ":active"]) assert.ok(section.includes(state));
  assert.match(section, /color: var\(--trading-market-text\)/); assert.match(section, /background: var\(--trading-market-panel\)/);
  assert.match(section, /stroke: currentColor/);
  assert.match(section, /\.trading-chart-floating-toolbar\[hidden\] \{ display: none; \}/);
  assert.match(section, /background: var\(--trading-chart-navigation-close-bg\)/);
  assert.match(section, /color: var\(--trading-chart-navigation-close-text\)/);
  assert.match(section, /\.trading-chart-toolbar-close \{[\s\S]*?place-items: center;[\s\S]*?width: 20px;[\s\S]*?height: 20px;[\s\S]*?padding: 0;[\s\S]*?border-radius: 50%;/);
  const themes = css.match(/(?:^\.trading-expert-market|^html\[data-theme="dark"\] \.trading-expert-market) \{[^}]*--trading-chart-navigation-close-bg:[^}]*\}/gm);
  assert.equal(themes.length, 2);
  for (const tokens of themes) {
    for (const token of ['bg', 'hover', 'text']) assert.ok(tokens.includes(`--trading-chart-navigation-close-${token}:`));
  }
  const language = readFileSync(new URL("../src/renderer/app-language.mjs", import.meta.url), "utf8");
  assert.match(language, /Measure \(Shift \+ click or drag\)/); assert.doesNotMatch(language, /Shift \+ drag the chart to zoom a selection/);
});


test("percentage axis drag scales manually and double-click collapse restores proportions", t => {
  const f = freeDragFixture(t); f.scales[0].mode = 2;
  f.send("pointerdown", { clientX: 580 }, true);
  f.send("pointermove", { clientX: 580, clientY: 170 }, true); f.send("pointerup", { clientX: 580, clientY: 170 });
  assert.equal(f.scales[0].autoScale, false); assert.ok(f.scales[0].range.to - f.scales[0].range.from > 100);
  f.send("dblclick", { ctrlKey: true }, true); assert.equal(f.panes[0].factor, 0.1);
  f.send("dblclick", { ctrlKey: true }, true); assert.equal(f.panes[0].factor, 1);
});

test("log ranges delegate raw prices to the native autoscaler and restore every provider", t => {
  const f = freeDragFixture(t), scale = f.scales[0]; scale.mode = 1;
  const customProvider = () => ({ priceRange: { minValue: 10, maxValue: 20 } });
  const original = [undefined, customProvider];
  const series = original.map(provider => {
    const options = { autoscaleInfoProvider: provider };
    return { options: () => options, applyOptions: o => Object.assign(options, o), coordinateToPrice: () => 100000 };
  });
  const left = { options: () => ({ priceScaleId: "left" }), applyOptions: () => assert.fail("unrelated axis changed") };
  f.panes[0].getSeries = () => [...series, left];
  scale.applyOptions = o => {
    Object.assign(scale, o);
    for (const item of series) assert.deepEqual(item.options().autoscaleInfoProvider(), { priceRange: { minValue: 99999.99, maxValue: 100000.01 } });
  };
  assert.equal(setTradingLogPriceRange(f.panes[0], scale, 99999.99, 100000.01), true);
  assert.equal(scale.autoScale, false); assert.equal(scale.mode, 1);
  assert.equal(series[1].options().autoscaleInfoProvider, customProvider);
  const native = { priceRange: { minValue: 1, maxValue: 2 } };
  assert.equal(series[0].options().autoscaleInfoProvider(() => native), native);
  for (const range of [[NaN, 1], [1, Infinity], [2, 1], [1, 1]]) assert.equal(setTradingLogPriceRange(f.panes[0], scale, ...range), false);
});

test("native layout notifications during a paint cannot enqueue a second paint in the same frame", t => {
  const f = freeDragFixture(t); let paints = 0;
  f.navigation.redraw = () => {
    if (++paints === 1) f.rangeListeners.forEach(fn => fn({ from: 5, to: 305 }));
  };
  f.paint(); assert.equal(paints, 1); assert.equal(f.frames.size, 1);
  f.paint(); assert.equal(paints, 2); assert.equal(f.frames.size, 0);
  f.navigation.schedule(12); f.navigation.schedule();
  for (let i = 0; i < 12; i++) { assert.equal(f.frames.size, 1); f.paint(); }
  assert.equal(paints, 14); assert.equal(f.frames.size, 0);
});

test("repeated wheels reuse the configured anchor without forcing native options/layout updates", t => {
  const f = freeDragFixture(t), ts = f.chart.timeScale(); let applied = 0;
  const apply = ts.applyOptions;
  ts.applyOptions = options => { applied++; apply(options); };
  for (let i = 0; i < 100; i++) f.send("wheel", { deltaY: 12 }, true);
  assert.equal(applied, 0);
  for (let i = 0; i < 100; i++) f.send("wheel", { deltaY: 12, ctrlKey: true }, true);
  assert.equal(applied, 1);
  f.send("wheel", { deltaY: 12 }, true); assert.equal(applied, 2);
});

test("wheel and zoom buttons restore candle Auto after box/axis adjustment, leaving indicator axes alone", t => {
  const f = freeDragFixture(t); let auto = false;
  f.options.getAutoScale = () => auto;
  f.options.onAutoScaleChange = enabled => { auto = enabled; };
  f.navigation.setTool("zoom");
  f.send("pointerdown", {}, true);
  f.send("pointerup", { clientX: 450, clientY: 125 }, true);
  assert.equal(f.scales[0].autoScale, false);
  f.scales[1].setAutoScale(false);
  const indicatorRange = { ...f.scales[1].range };
  const boxed = { ...f.range() };
  f.navigation.runAction("zoom-out");
  assert.ok(f.range().to - f.range().from > boxed.to - boxed.from);
  assert.deepEqual(f.scales.map(s => s.autoScale), [true, false]);
  for (const action of ["zoom-in", "zoom-out"]) {
    f.navigation.setAutoScale(false);
    f.navigation.runAction(action);
    assert.equal(f.scales[0].autoScale, true); assert.equal(auto, true);
  }
  f.navigation.setAutoScale(false);
  f.send('wheel', { deltaY: 100 }, true); f.paint();
  f.paint(); f.paint();
  assert.equal(auto, true);
  assert.deepEqual(f.scales.map(s => s.autoScale), [true, false]);
  assert.deepEqual(f.scales[1].range, indicatorRange);
  f.navigation.reset(); f.paint(); assert.ok(f.scales.every(s => s.autoScale));
});

test("zoom buttons cancel pending box selections so a later pointer cannot re-freeze prices", t => {
  const f = freeDragFixture(t);
  f.navigation.setTool("zoom");
  f.send("pointerdown", {}, true); f.send("pointerup");
  f.send("pointermove", { clientX: 450, clientY: 125 });
  assert.equal(f.navigation.selection.awaitingClick, true);
  f.navigation.runAction("zoom-in");
  const zoomed = { ...f.range() };
  assert.equal(f.navigation.selection, null); assert.equal(f.navigation.getTool(), null);
  f.send("pointerdown"); f.send("pointerup");
  assert.deepEqual(f.range(), zoomed); assert.equal(f.scales[0].autoScale, true);
});

test("repeated zoom is reversible within limits and cannot pan past either spacing limit", t => {
  const f = freeDragFixture(t), ts = f.chart.timeScale(), initial = { ...f.range() };
  for (let i = 0; i < 100; i++) { f.navigation.zoom(0.8); f.navigation.zoom(1.25); }
  assert.deepEqual(f.range(), initial);
  for (const [factor, span] of [[1.25, 375.25], [0.8, 4]]) {
    for (let i = 0; i < 100; i++) f.navigation.zoom(factor);
    const limit = { ...f.range() };
    assert.ok(Math.abs(limit.to - limit.from - span) < 1e-6);
    assert.ok(Math.abs(limit.to - 300) < 1e-6);
    for (let i = 0; i < 100; i++) f.navigation.zoom(factor);
    assert.deepEqual(f.range(), limit);
  }
  ts.applyOptions({ minBarSpacing: 2, maxBarSpacing: 20 });
  f.navigation.zoom(1e10); assert.equal(f.range().to - f.range().from, 269);
  f.navigation.zoom(1e-10); assert.equal(f.range().to - f.range().from, 26);
});

test("invalid zoom requests and unavailable geometry leave the view untouched", t => {
  const f = freeDragFixture(t), ts = f.chart.timeScale();
  f.scales[0].setAutoScale(false);
  for (const factor of [0, -1, NaN, Infinity, 1]) f.navigation.zoom(factor);
  const width = ts.width;
  for (const value of [0, NaN, Infinity]) { ts.width = () => value; f.navigation.zoom(1.25); }
  ts.width = width;
  assert.deepEqual(f.range(), { from: 0, to: 300 }); assert.equal(f.scales[0].autoScale, false);
});

test("temporary measurements are invalidated by axes, navigation, viewport and price geometry changes", t => {
  const f = freeDragFixture(t);
  const measure = () => {
    f.send("pointerdown", { shiftKey: true }, true);
    f.send("pointerup", { clientX: 450, clientY: 200 }, true);
    assert.ok(f.navigation.measurement);
  };
  for (const invalidate of [
    () => f.send("pointerdown", { clientY: 609 }),
    () => f.send("keydown", { key: "ArrowLeft" }, true),
    () => f.navigation.zoom(0.8),
    () => f.navigation.runAction("auto"),
    () => f.rangeListeners.forEach(fn => fn({ from: 1, to: 200 })),
    () => f.sizeListeners.forEach(fn => fn(800, 28)),
    () => { const old = f.panes[0].getHeight; f.panes[0].getHeight = () => 350; f.navigation.schedule(); f.paint(); f.panes[0].getHeight = old; },
  ]) {
    measure(); invalidate(); assert.equal(f.navigation.measurement, null); f.send("pointerup");
  }
  f.navigation.destroy(); assert.equal(f.rangeListeners.size, 0); assert.equal(f.sizeListeners.size, 0);
});

test("log range setup restores custom providers and Auto after a native failure", t => {
  const f = freeDragFixture(t), scale = f.scales[0]; scale.mode = 1;
  const provider = base => base(), options = { autoscaleInfoProvider: provider };
  const series = { options: () => options, applyOptions: o => Object.assign(options, o), coordinateToPrice: () => 1 };
  f.panes[0].getSeries = () => [series];
  scale.applyOptions = () => { throw new Error("native scale failure"); };
  assert.throws(() => setTradingLogPriceRange(f.panes[0], scale, 0.99999, 1.00001), /native scale failure/);
  assert.equal(options.autoscaleInfoProvider, provider); assert.equal(scale.autoScale, true);
});

test("measurement data subscriptions are retired after updates, cancellation and destroy", t => {
  const f = freeDragFixture(t), listeners = new Set();
  const series = { options: () => ({}), coordinateToPrice: y => 200 - y / 3,
    subscribeDataChanged: fn => listeners.add(fn), unsubscribeDataChanged: fn => listeners.delete(fn) };
  f.panes[0].getSeries = () => [series];
  for (const finish of [() => [...listeners].forEach(fn => fn()), () => f.navigation.cancelGesture(), () => f.navigation.destroy()]) {
    f.send("pointerdown", { shiftKey: true }, true);
    f.send("pointerup", { clientX: 450, clientY: 200 }, true);
    assert.equal(listeners.size, 1); finish();
    assert.equal(listeners.size, 0); assert.equal(f.navigation.measurement, null);
  }
});

test('wheel bursts change the time range once per paint and match button zoom', t => {
  const f = freeDragFixture(t), ts = f.chart.timeScale(), start = { ...f.range() };
  let writes = 0; const set = ts.setVisibleLogicalRange;
  ts.setVisibleLogicalRange = range => { writes++; set(range); };
  for (let i = 0; i < 10; i++) f.send('wheel', { deltaY: -10 }, true);
  assert.equal(writes, 0); assert.deepEqual(f.range(), start);
  f.paint(); assert.equal(writes, 1);
  const wheel = { ...f.range() };
  assert.equal(wheel.to, start.to); assert.ok(wheel.from > start.from);
  set(start); f.navigation.zoom(Math.exp(-0.2));
  assert.ok(Math.abs(f.range().from - wheel.from) < 1e-8);
  assert.ok(f.scales.every(s => s.autoScale));
});

test('cursor anchor survives ordinary and Ctrl zoom while pixel and line wheel units agree', t => {
  const f = freeDragFixture(t), ts = f.chart.timeScale();
  f.options.getScaleAnchor = () => 'cursor';
  const start = { ...f.range() }, ratio = 240 / 540, anchor = 300 * ratio;
  f.send('wheel', { deltaY: -32 }, true); f.paint();
  const pixels = { ...f.range() };
  assert.ok(Math.abs(pixels.from + (pixels.to - pixels.from) * ratio - anchor) < 1e-8);
  ts.setVisibleLogicalRange(start);
  f.options.getScaleAnchor = () => 'right';
  f.send('wheel', { deltaY: -1, deltaMode: 1, ctrlKey: true }, true); f.paint();
  assert.deepEqual(f.range(), pixels);
});

test('missing anchor preference defaults to cursor and accounts for the left price axis', t => {
  const f = freeDragFixture(t), ts = f.chart.timeScale();
  delete f.options.getScaleAnchor;
  const priceScale = f.chart.priceScale;
  f.chart.priceScale = (side, i) => side === 'left' ? { width: () => 40 } : priceScale(side, i);
  for (const clientX of [105, 270, 440]) {
    ts.setVisibleLogicalRange({ from: 50, to: 250 });
    const ratio = (clientX - 10 - 40) / ts.width(), index = 50 + 200 * ratio;
    f.send('wheel', { deltaY: -80, clientX }, true); f.paint();
    const range = f.range();
    assert.ok(Math.abs(range.from + (range.to - range.from) * ratio - index) < 1e-8);
    assert.equal(ts.options().rightBarStaysOnScroll, false);
  }
});

test('zoom at a spacing limit still restores Auto after a vertical drag', t => {
  const f = freeDragFixture(t); let auto = false;
  f.options.getAutoScale = () => auto;
  f.options.onAutoScaleChange = enabled => { auto = enabled; };
  for (let i = 0; i < 50; i++) { f.send('wheel', { deltaY: -100 }, true); f.paint(); }
  const limit = { ...f.range() };
  f.navigation.setAutoScale(false);
  f.send('wheel', { deltaY: -100 }, true); f.paint(); f.paint();
  assert.deepEqual(f.range(), limit); assert.equal(auto, true); assert.equal(f.scales[0].autoScale, true);
});

test('wheel limits stop drift, reverse immediately, and recover from empty future space', t => {
  const f = freeDragFixture(t), ts = f.chart.timeScale();
  for (const direction of [1, -1]) {
    for (let i = 0; i < 100; i++) { f.send('wheel', { deltaY: direction * 100 }, true); f.paint(); }
    const limit = { ...f.range() };
    f.send('wheel', { deltaY: direction * 100 }, true); f.paint();
    assert.deepEqual(f.range(), limit);
    assert.ok(limit.from < 300 && limit.to > 0);
    f.send('wheel', { deltaY: -direction * 100 }, true); f.paint();
    assert.notDeepEqual(f.range(), limit);
  }
  ts.setVisibleLogicalRange({ from: 4000, to: 4100 });
  f.send('wheel', { deltaY: -100 }, true); f.paint();
  assert.ok(f.range().from < 300 && f.range().to > 0);
});

test('price-axis reset persists Auto and does not affect other panes', t => {
  const f = freeDragFixture(t); let auto = false;
  f.options.getAutoScale = () => auto;
  f.options.onAutoScaleChange = enabled => { auto = enabled; };
  f.scales.forEach(s => s.setAutoScale(false));
  f.send('dblclick', { clientX: 580 }, true); f.paint(); f.paint();
  assert.equal(auto, true); assert.deepEqual(f.scales.map(s => s.autoScale), [true, false]);
  f.send('wheel', { deltaY: 40 }, true); f.paint();
  assert.deepEqual(f.scales.map(s => s.autoScale), [true, false]);
});

test('continuous wheels do not release a deferred shell render between events', t => {
  const f = freeDragFixture(t); let resumed = 0;
  f.send('wheel', { deltaY: 10 }, true);
  assert.equal(deferTradingChartShellRender(() => resumed++), true);
  for (let i = 0; i < 20; i++) f.send('wheel', { deltaY: 10 }, true);
  assert.equal(resumed, 0);
  f.paint(); assert.equal(resumed, 0);
  f.win.dispatchEvent(new Event('blur')); assert.equal(resumed, 1);
});

test('cancel, reset and destroy discard pending wheel work; inputs and no data do not zoom', t => {
  const f = freeDragFixture(t), ts = f.chart.timeScale();
  for (const cancel of [() => f.win.dispatchEvent(new Event('blur')), () => f.navigation.cancelGesture()]) {
    const before = { ...f.range() };
    f.send('wheel', { deltaY: 20 }, true); cancel(); f.paint();
    assert.deepEqual(f.range(), before);
  }
  f.send('wheel', { deltaY: 20 }, true); f.navigation.reset();
  const reset = { ...f.range() }; f.paint(); assert.deepEqual(f.range(), reset);
  const input = new ElementStub('input'), event = new Event('wheel', { cancelable: true });
  Object.assign(event, { deltaY: 100, deltaX: 0 }); Object.defineProperty(event, 'target', { value: input });
  f.navigation.wheel(event); assert.equal(event.defaultPrevented, false);
  f.options.getCandles = () => [];
  f.send('wheel', { deltaY: 20 }, true); f.paint(); assert.deepEqual(f.range(), reset);
  f.send('wheel', { deltaY: 20 }, true); f.navigation.destroy(); f.paint(); assert.deepEqual(ts.getVisibleLogicalRange(), reset);
});

test('new history and refresh leave a settled view alone until the next requested zoom', t => {
  const f = freeDragFixture(t), ts = f.chart.timeScale();
  f.send('wheel', { deltaY: -40 }, true); f.paint(); f.paint();
  const before = { ...f.range() };
  f.options.getCandles = () => Array.from({ length: 501 }, (_, i) => ({time:i}));
  ts.setVisibleLogicalRange({ from: before.from + 200, to: before.to + 200 });
  f.navigation.schedule(); f.paint(); f.paint();
  assert.deepEqual(f.range(), { from: before.from + 200, to: before.to + 200 });
});
