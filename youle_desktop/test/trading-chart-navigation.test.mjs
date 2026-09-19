import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { TradingChartNavigation, captureManualTradingPriceRanges, restoreManualTradingPriceRanges, setTradingLogPriceRange } from "../src/renderer/trading-chart-navigation.ts";
import { deferTradingChartShellRender } from "../src/renderer/trading-chart-interaction.ts";

class ElementStub extends EventTarget {
  constructor(tag = "div") {
    super(); this.tag = tag; this.style = {}; this.dataset = {}; this.children = []; this.attrs = {};
    const classes = new Set();
    this.classList = { add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)), toggle: (x, on) => on ? classes.add(x) : classes.delete(x) };
    this.clientHeight = 610; this.clientWidth = 600;
  }
  append(...children) { children.forEach(c => { c.parentElement = this; this.children.push(c); }); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this); }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  contains(n) { return n === this || this.children.some(c => c.contains(n)); }
  focus() { document.activeElement = this; }
  closest(selector) { return selector.split(", ").includes(this.tag) ? this : null; }
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
    resetTimeScale: () => { range = { from: 200, to: 500 }; }, scrollToPosition: () => {} };
  const chart = { panes: () => panes, priceScale: (side, i) => side === "left" ? { width: () => 0 } : scales[i], timeScale: () => ts, applyOptions() {} };
  const element = new ElementStub(); let paints = 0; let focus = null;
  const options = { getScaleAnchor: () => "right", onFocus: i => { focus = i; }, getCandles: () => Array.from({ length: 301 }, (_, i) => ({ time: i * 3600, volume: 1 })) };
  const navigation = new TradingChartNavigation(element, () => chart, () => paints++, options);
  t.after(() => { navigation.destroy(); for (const [k, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, k, descriptor); else delete globalThis[k]; });
  const send = (type, props = {}, consumed = false, target) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: 1, isPrimary: true, pointerType: "mouse", button: 0, clientX: 250, clientY: 100, deltaX: 0, deltaY: 0, deltaMode: 0 }, props);
    (target ?? (["pointerdown", "wheel", "dblclick", "keydown"].includes(type) ? element : win)).dispatchEvent(event);
    assert.equal(event.defaultPrevented, consumed, `${type} event ownership`);
  };
  const paint = () => { const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn()); };
  return { win, chart, scales, panes, element, navigation, options, frames, rangeListeners, sizeListeners, send, paint, paints: () => paints, range: () => range, focus: () => focus };
}

test('A/L controls are absent; price settings and shortcuts still target main after indicator focus', t => {
  const f = fixture(t);
  f.send('pointerdown', { clientY: 400 }); f.send('pointerup');
  assert.deepEqual(f.navigation.controls.children.map(b => b.dataset.navigationAction), ['zoom-out', 'zoom-in', 'left', 'right', 'reset', 'lock-vertical']);
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
  const f = fixture(t);
  f.send('contextmenu', { clientY: 400 }, true, f.element);
  const buttons = f.navigation.menu.children;
  assert.equal(buttons.length, 3);
  assert.match(buttons[1].textContent, /副图/);
  buttons[1].dispatchEvent(new Event('click'));
  assert.deepEqual(f.scales.map(s => s.autoScale), [true, false]);
  f.paint();
  assert.equal(f.scales[0].autoScale, true);
});

test('lock keeps native auto-fit active during coalesced scrolling; unlock restores free dragging', t => {
  const f = fixture(t), ts = f.chart.timeScale(), positions = [], native = [];
  f.options.getAutoScale = () => false;
  f.options.onAutoScaleChange = () => assert.fail('lock must not change the saved A setting');
  f.scales[0].autoScale = false;
  ts.scrollPosition = () => 8; ts.scrollToPosition = position => positions.push(position);
  f.chart.applyOptions = options => native.push(options.handleScroll);
  f.navigation.runAction('lock-vertical'); f.paint();
  const lock = f.navigation.controls.querySelector('[data-navigation-action="lock-vertical"]');
  assert.equal(lock.getAttribute('aria-pressed'), 'true');
  assert.match(lock.getAttribute('title'), /随可见 K 线自动适配价格/);
  f.send('pointerdown', {}, true);
  f.send('pointermove', { clientX: 270, clientY: 180 }, true);
  f.send('pointermove', { clientX: 290, clientY: 200 }, true);
  assert.deepEqual(positions, []); f.paint(); assert.deepEqual(positions, [-12]);
  assert.deepEqual(f.scales.map(s => s.changes), [[true], []]);
  f.paint(); assert.equal(f.scales[0].autoScale, true);
  f.send('pointermove', { clientX: 310, clientY: 210 }, true); f.send('pointerup');
  assert.deepEqual(positions, [-12, -22]);
  f.navigation.runAction('lock-vertical'); f.paint();
  assert.equal(lock.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(native.map(o => o.pressedMouseMove), [false, true]);
  assert.equal(f.scales[0].autoScale, false);
  delete f.options.onAutoScaleChange;
  f.send('pointerdown'); f.send('pointermove', { clientY: 160 }); f.send('pointerup');
  assert.equal(f.scales[0].autoScale, false);
});

test('linear lock refits every visible range and data update, while unlocked prices remain manual', t => {
  const f = fixture(t), ts = f.chart.timeScale(); let revision = 0;
  f.options.getAutoScale = () => false;
  f.options.getLockedPriceRange = range => range && ({ from: 100 + range.from + revision, to: 200 + range.to + revision });
  f.navigation.runAction('lock-vertical'); f.paint();
  assert.deepEqual(f.scales[0].range, { from: 100, to: 500 });
  ts.setVisibleLogicalRange({ from: 40, to: 100 });
  f.navigation.schedule(); f.paint();
  assert.deepEqual(f.scales[0].range, { from: 140, to: 300 });
  revision = 20; f.navigation.schedule(); f.paint();
  assert.deepEqual(f.scales[0].range, { from: 160, to: 320 });
  assert.deepEqual(f.scales[1].changes, []);
  f.navigation.runAction('lock-vertical');
  ts.setVisibleLogicalRange({ from: 100, to: 200 }); f.paint(); f.paint();
  assert.deepEqual(f.scales[0].range, { from: 160, to: 320 });
});

test('locked log and percentage use native auto-fit without linear range writes or preference changes', t => {
  const f = fixture(t); let auto = false;
  f.options.getAutoScale = () => auto;
  f.options.onAutoScaleChange = value => { auto = value; };
  f.options.getLockedPriceRange = () => assert.fail('linear prices cannot be written into transformed axes');
  f.scales[0].mode = 1;
  f.navigation.runAction('lock-vertical'); f.paint(); f.paint();
  assert.equal(f.scales[0].autoScale, true); assert.equal(auto, false);
  f.navigation.setMode(2); f.navigation.setAutoScale(false); f.paint(); f.paint();
  assert.equal(f.scales[0].autoScale, true); assert.equal(auto, false);
  f.navigation.setAutoScale(true);
  f.navigation.runAction('lock-vertical'); f.paint();
  assert.equal(f.scales[0].autoScale, true); assert.equal(auto, true);
});

test('auto-off fits initial/reset prices once, preserves indicators and reports manual override', t => {
  const f = fixture(t); let auto = false;
  f.options.getAutoScale = () => auto; f.options.onAutoScaleChange = enabled => { auto = enabled; };
  f.paint(); assert.equal(f.scales[0].autoScale, true); f.paint(); assert.deepEqual(f.scales.map(s => s.autoScale), [false, true]);
  f.navigation.setAutoScale(true); f.paint(); assert.equal(f.scales[0].autoScale, true);
  f.send('pointerdown'); f.send('pointermove', { clientY: 160 }); f.send('pointerup');
  assert.equal(auto, false);
  f.navigation.reset(); f.paint(); f.paint(); assert.deepEqual(f.scales.map(s => s.autoScale), [false, true]);
});

test('shell renders cannot detach a chart mid-drag and are released by up, cancel, blur and destruction', t => {
  const f = fixture(t);
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
  const f = fixture(t);
  let resumed = 0;
  f.send('wheel', { deltaY: 10 });
  assert.equal(deferTradingChartShellRender(() => resumed++), true);
  await new Promise(r => setTimeout(r, 150));
  assert.equal(resumed, 1);
  f.send('wheel', { deltaY: 10 });
  assert.equal(deferTradingChartShellRender(() => resumed++), true);
  f.navigation.destroy();
  assert.equal(resumed, 2);
});

test("horizontal pan preserves Auto, deliberate vertical drag freezes just the target pane", t => {
  const f = fixture(t);
  f.send("pointerdown"); f.send("pointermove", { clientX: 450, clientY: 102 }); f.send("pointerup");
  assert.equal(f.scales[0].autoScale, true);
  f.send("pointerdown"); f.send("pointermove", { clientY: 140 }); f.send("pointermove", { clientY: 170 });
  assert.deepEqual(f.scales.map(s => s.changes), [[false], []]);
});
test("axis and separator gestures stay native; indicator drag targets its own scale", t => {
  const f = fixture(t);
  f.send("pointerdown", { clientX: 580 }); f.send("pointermove", { clientY: 240 }); f.send("pointerup");
  f.send("pointerdown", { clientY: 305 }); f.send("pointermove", { clientY: 400 }); f.send("pointerup");
  assert.deepEqual(f.scales.map(s => s.changes), [[], []]);
  f.send("pointerdown", { clientY: 400 }); f.send("pointermove", { clientY: 450 });
  assert.equal(f.focus(), 1); assert.deepEqual(f.scales.map(s => s.changes), [[], [false]]);
});
test("Shift measures without changing the viewport, keeps its result, and next click clears it", t => {
  const f = fixture(t); const before = { ...f.range() };
  f.send("pointerdown", { shiftKey: true }, true);
  f.send("pointermove", { clientX: 450, clientY: 200 }, true);
  f.send("pointerup", { clientX: 450, clientY: 200 }, true);
  assert.deepEqual(f.range(), before); assert.equal(f.scales[0].autoScale, true);
  assert.match(f.navigation.measurement.children[0].textContent, /-20.00%/);
  assert.match(f.navigation.measurement.children[0].textContent, /100.*4.2d/);
  f.send("pointerdown"); assert.equal(f.navigation.measurement, null);
});
test("zoom tool supports reversed drags, clamps endpoints, and returns to cursor", t => {
  const f = fixture(t); f.navigation.setTool("zoom");
  f.send("pointerdown", {}, true); f.send("pointermove", { clientX: -100, clientY: 250 }, true);
  f.send("pointerup", { clientX: -100, clientY: 250 }, true);
  assert.deepEqual(f.range(), { from: 0, to: 120 });
  assert.ok(f.scales[0].range.from > 110 && f.scales[0].range.to < 170);
  assert.equal(f.scales[0].autoScale, false); assert.equal(f.navigation.getTool(), null);
});
test("two-click zoom previews after first release and completes on second click", t => {
  const f = fixture(t); f.navigation.setTool("zoom");
  f.send("pointerdown", {}, true); f.send("pointerup");
  assert.equal(f.navigation.selection.awaitingClick, true);
  f.send("pointermove", { clientX: 450, clientY: 250 });
  f.send("pointerdown", { clientX: 450, clientY: 250 }, true);
  f.send("pointerup", { clientX: 450, clientY: 250 }, true);
  assert.deepEqual(f.range(), { from: 120, to: 220 });
});
test("Escape, cancel, blur, second touch and reload release selections without applying them", t => {
  const f = fixture(t);
  for (const cancel of [() => f.send("keydown", { key: "Escape" }, true), () => f.send("pointercancel"), () => f.win.dispatchEvent(new Event("blur")), () => f.send("pointerdown", { pointerId: 2, isPrimary: false }), () => f.navigation.cancelGesture()]) {
    f.navigation.setTool("zoom"); f.send("pointerdown", {}, true); cancel();
    f.send("pointermove", { clientX: 450, clientY: 240 }); f.send("pointerup");
    assert.deepEqual(f.range(), { from: 0, to: 300 }); assert.equal(f.scales[0].autoScale, true); assert.equal(f.navigation.selection, null);
  }
});
test("Ctrl wheel always focuses cursor, ordinary wheel uses the configured default", t => {
  const f = fixture(t);
  f.send("wheel", { deltaY: -100 }); assert.equal(f.chart.timeScale().options().rightBarStaysOnScroll, true);
  f.send("wheel", { deltaY: -100, ctrlKey: true }); assert.equal(f.chart.timeScale().options().rightBarStaysOnScroll, false);
  f.options.getScaleAnchor = () => "cursor";
  f.send("wheel", { deltaY: -100, ctrlKey: true }); assert.equal(f.chart.timeScale().options().rightBarStaysOnScroll, false);
  f.send("wheel", { deltaY: -100 }); assert.equal(f.chart.timeScale().options().rightBarStaysOnScroll, false);
});
test("Shift wheel pans once, preserves bar spacing and Auto, and normalizes line deltas", t => {
  const f = fixture(t);
  f.send("wheel", { deltaY: 100, shiftKey: true }, true); assert.deepEqual(f.range(), { from: 50, to: 350 });
  f.send("wheel", { deltaX: -100, shiftKey: true }, true); assert.deepEqual(f.range(), { from: 0, to: 300 });
  f.send("wheel", { deltaY: 1, deltaMode: 1, shiftKey: true }, true); assert.deepEqual(f.range(), { from: 16, to: 316 });
  assert.equal(f.scales[0].autoScale, true);
});
test("wheel on price axis changes only the price span", t => {
  const f = fixture(t); f.send("wheel", { clientX: 580, deltaY: -100 }, true);
  assert.deepEqual(f.range(), { from: 0, to: 300 });
  assert.ok(f.scales[0].range.to - f.scales[0].range.from < 100); assert.equal(f.scales[0].autoScale, false);
});
test("focused chart navigation keys pan, zoom, reset and toggle scales", t => {
  const f = fixture(t);
  f.send("keydown", { key: "ArrowLeft" }, true); assert.deepEqual(f.range(), { from: -1, to: 299 });
  f.send("keydown", { key: "ArrowRight", ctrlKey: true }, true); assert.deepEqual(f.range(), { from: 9, to: 309 });
  f.send("keydown", { key: "ArrowUp", ctrlKey: true }, true); assert.equal(f.range().to - f.range().from, 240);
  f.send("keydown", { key: "l", altKey: true }, true); assert.equal(f.scales[0].mode, 1);
  f.send("keydown", { key: "p", altKey: true }, true); assert.equal(f.scales[0].mode, 2);
  f.send("keydown", { key: "i", altKey: true }, true); assert.equal(f.scales[0].invertScale, true);
  f.send("keydown", { key: "r", altKey: true }, true); assert.equal(f.scales[0].autoScale, true); assert.deepEqual(f.range(), { from: 200, to: 500 });
});
test("global keyboard events and editable targets do not navigate a chart", t => {
  const f = fixture(t); f.send("keydown", { key: "r", altKey: true }, false, f.win);
  const input = new ElementStub("input");
  const e = new Event("keydown", { cancelable: true }); Object.assign(e, { key: "ArrowLeft" }); Object.defineProperty(e, "target", { value: input });
  f.navigation.keyDown(e); assert.equal(e.defaultPrevented, false); assert.deepEqual(f.range(), { from: 0, to: 300 });
});
test("double-click maximizes and restores pane proportions; axes stay native", t => {
  const f = fixture(t); f.send("dblclick", {}, true); assert.deepEqual(f.panes.map(p => p.factor), [1, 0]);
  f.send("dblclick", {}, true); assert.deepEqual(f.panes.map(p => p.factor), [1, 1]);
  f.send("dblclick", { clientX: 580 }); assert.deepEqual(f.panes.map(p => p.factor), [1, 1]);
});
test("manual theme snapshots preserve scale ownership and ignore changed modes", t => {
  const f = fixture(t); f.scales[0].autoScale = false;
  const snapshot = captureManualTradingPriceRanges(f.chart); f.scales[0].range = { from: 0, to: 1 };
  restoreManualTradingPriceRanges(snapshot); assert.deepEqual(f.scales[0].range, { from: 100, to: 200 });
  f.scales[0].mode = 1; assert.deepEqual(captureManualTradingPriceRanges(f.chart), []);
  f.scales[0].range = { from: 50, to: 150 }; restoreManualTradingPriceRanges(snapshot); assert.deepEqual(f.scales[0].range, { from: 50, to: 150 });
});
test("bursts coalesce overlay paints and destroy removes listeners and pending frames", t => {
  const f = fixture(t); f.send("wheel"); f.send("wheel"); assert.equal(f.frames.size, 1);
  f.paint(); f.paint(); assert.equal(f.paints(), 2); assert.equal(f.frames.size, 0);
  f.send("pointerdown"); f.navigation.destroy(); f.send("pointermove", { clientY: 200 });
  assert.deepEqual(f.scales[0].changes, []); assert.equal(f.frames.size, 0);
});
test("new controls, measurement and menus use theme tokens in default and interactive states", () => {
  const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const section = css.split(".trading-chart-navigable {")[1].split(".trading-market-brand {")[0];
  assert.doesNotMatch(section, /#[\da-f]{3,8}\b/i);
  for (const state of [":hover", ":focus-visible", ":active", ":disabled", '[aria-pressed="true"]']) assert.ok(section.includes(state));
  assert.match(section, /color: var\(--trading-market-text\)/); assert.match(section, /background: var\(--trading-market-panel\)/);
  assert.match(section, /stroke: currentColor/);
  const language = readFileSync(new URL("../src/renderer/app-language.mjs", import.meta.url), "utf8");
  assert.match(language, /Measure \(Shift \+ click or drag\)/); assert.doesNotMatch(language, /Shift \+ drag the chart to zoom a selection/);
});


test("percentage axis drag scales manually and double-click collapse restores proportions", t => {
  const f = fixture(t); f.scales[0].mode = 2;
  f.send("pointerdown", { clientX: 580 }, true);
  f.send("pointermove", { clientX: 580, clientY: 170 }, true); f.send("pointerup", { clientX: 580, clientY: 170 });
  assert.equal(f.scales[0].autoScale, false); assert.ok(f.scales[0].range.to - f.scales[0].range.from > 100);
  f.send("dblclick", { ctrlKey: true }, true); assert.equal(f.panes[0].factor, 0.1);
  f.send("dblclick", { ctrlKey: true }, true); assert.equal(f.panes[0].factor, 1);
});

test("log ranges delegate raw prices to the native autoscaler and restore every provider", t => {
  const f = fixture(t), scale = f.scales[0]; scale.mode = 1;
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
  const f = fixture(t); let paints = 0;
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
  const f = fixture(t), ts = f.chart.timeScale(); let applied = 0;
  const apply = ts.applyOptions;
  ts.applyOptions = options => { applied++; apply(options); };
  for (let i = 0; i < 100; i++) f.send("wheel", { deltaY: 12 });
  assert.equal(applied, 0);
  for (let i = 0; i < 100; i++) f.send("wheel", { deltaY: 12, ctrlKey: true });
  assert.equal(applied, 1);
  f.send("wheel", { deltaY: 12 }); assert.equal(applied, 2);
});

test("zoom controls recover clipped prices after a box zoom and fit each local pane", t => {
  const f = fixture(t);
  f.navigation.setTool("zoom");
  f.send("pointerdown", {}, true);
  f.send("pointerup", { clientX: 450, clientY: 125 }, true);
  assert.equal(f.scales[0].autoScale, false);
  f.scales[1].setAutoScale(false);
  const boxed = { ...f.range() };
  f.navigation.runAction("zoom-out");
  assert.ok(f.range().to - f.range().from > boxed.to - boxed.from);
  assert.ok(f.scales.every(s => s.autoScale));
  for (const action of ["zoom-in", "zoom-out"]) {
    f.scales[0].setAutoScale(false);
    f.navigation.runAction(action);
    assert.equal(f.scales[0].autoScale, true);
  }
});

test("zoom buttons cancel pending box selections so a later pointer cannot re-freeze prices", t => {
  const f = fixture(t);
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
  const f = fixture(t), ts = f.chart.timeScale(), initial = { ...f.range() };
  for (let i = 0; i < 100; i++) { f.navigation.zoom(0.8); f.navigation.zoom(1.25); }
  assert.deepEqual(f.range(), initial);
  for (const [factor, span] of [[1.25, 1079], [0.8, 4]]) {
    for (let i = 0; i < 100; i++) f.navigation.zoom(factor);
    const limit = { ...f.range() };
    assert.ok(Math.abs(limit.to - limit.from - span) < 1e-6);
    assert.ok(Math.abs((limit.from + limit.to) / 2 - 150) < 1e-6);
    for (let i = 0; i < 100; i++) f.navigation.zoom(factor);
    assert.deepEqual(f.range(), limit);
  }
  ts.applyOptions({ minBarSpacing: 2, maxBarSpacing: 20 });
  f.navigation.zoom(1e10); assert.equal(f.range().to - f.range().from, 269);
  f.navigation.zoom(1e-10); assert.equal(f.range().to - f.range().from, 26);
});

test("invalid zoom requests and unavailable geometry leave the view untouched", t => {
  const f = fixture(t), ts = f.chart.timeScale();
  f.scales[0].setAutoScale(false);
  for (const factor of [0, -1, NaN, Infinity, 1]) f.navigation.zoom(factor);
  const width = ts.width;
  for (const value of [0, NaN, Infinity]) { ts.width = () => value; f.navigation.zoom(1.25); }
  ts.width = width;
  assert.deepEqual(f.range(), { from: 0, to: 300 }); assert.equal(f.scales[0].autoScale, false);
});

test("temporary measurements are invalidated by axes, navigation, viewport and price geometry changes", t => {
  const f = fixture(t);
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
  const f = fixture(t), scale = f.scales[0]; scale.mode = 1;
  const provider = base => base(), options = { autoscaleInfoProvider: provider };
  const series = { options: () => options, applyOptions: o => Object.assign(options, o), coordinateToPrice: () => 1 };
  f.panes[0].getSeries = () => [series];
  scale.applyOptions = () => { throw new Error("native scale failure"); };
  assert.throws(() => setTradingLogPriceRange(f.panes[0], scale, 0.99999, 1.00001), /native scale failure/);
  assert.equal(options.autoscaleInfoProvider, provider); assert.equal(scale.autoScale, true);
});

test("measurement data subscriptions are retired after updates, cancellation and destroy", t => {
  const f = fixture(t), listeners = new Set();
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
