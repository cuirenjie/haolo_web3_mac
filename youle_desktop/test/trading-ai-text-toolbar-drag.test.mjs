import assert from "node:assert/strict";
import test from "node:test";
import { TradingDrawingController } from "../src/renderer/trading-expert-drawing.ts";
import { deferTradingChartShellRender } from "../src/renderer/trading-chart-interaction.ts";
import { TradingChartToolbarVisibility } from "../src/renderer/trading-chart-toolbar-visibility.ts";

class ElementStub extends EventTarget {
  style = { left: "108px", top: "107px" };
  dataset = {};
  classes = new Set();
  classList = {
    add: (name) => this.classes.add(name),
    remove: (name) => this.classes.delete(name),
  };
  offsetWidth = 66;
  offsetHeight = 34;
  captures = new Set();
  buttons = [];
  get offsetLeft() { return parseFloat(this.style.left); }
  get offsetTop() { return parseFloat(this.style.top); }
  querySelector() { return new ElementStub(); }
  querySelectorAll() { return this.buttons; }
  setAttribute() {}
  focus() {}
  contains(element) { return element === this || this.buttons.includes(element); }
  getBoundingClientRect() { return { left: 0, top: 0, right: 500, bottom: 300 }; }
  closest(selector) {
    const action = this.dataset.aiTextSizeAction;
    return action && (selector === "[data-ai-text-size-action]"
      || selector === `[data-ai-text-size-action="${action}"]`) ? this : null;
  }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
}

// Exercise the real controller handlers and sizing lifecycle, replacing only
// DOM geometry/rendering and storage. Native hit testing is checked in Electron QA.
function fixture(t) {
  const documentStub = new EventTarget();
  const windowStub = new EventTarget();
  windowStub.localStorage = { getItem: () => null };
  const restoreGlobals = [];
  for (const [name, value] of Object.entries({
    document: documentStub, window: windowStub, Element: ElementStub, Node: ElementStub,
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    restoreGlobals.push(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  class Controller extends TradingDrawingController {
    plotBounds() { return this.bounds ?? { width: 500, height: 300 }; }
    redraw() { if (this.aiDrawings.length) this.updateAiTextSizeToolbar(this.plotBounds()); }
    renderAiCursor() {}
    updateToolbarState() {}
    persistAiDrawings() { this.saved = (this.saved ?? 0) + 1; }
    setStatus() {}
    topmostAiTextSizeTarget() {
      return { drawing: this.aiDrawings[0], bounds: this.labelBounds ?? { x: 180, y: 100, width: 160, height: 48 } };
    }
  }
  const host = new ElementStub();
  const controller = new Controller({
    host, chartElement: host, overlay: host,
    getChart: () => null, getCandleSeries: () => null,
    getSymbol: () => "ETHUSDT", getInterval: () => "1h", getCandles: () => [],
    timeOffsetSeconds: 0, controlActive: false,
  });
  const toolbar = controller.aiTextSizeToolbar;
  const button = (action) => {
    const element = new ElementStub();
    element.dataset.aiTextSizeAction = action;
    return element;
  };
  const decrease = button("decrease");
  const increase = button("increase");
  const dismiss = button("dismiss");
  toolbar.buttons = [decrease, increase];
  controller.aiDrawings = ["first", "second"].map((id) => ({
    id, tool: "note", symbol: "ETHUSDT", interval: "1h", source: "ai", fontSize: 10,
  }));
  controller.redraw();
  const event = (values = {}) => ({
    pointerId: 1, button: 0, isPrimary: true, clientX: 120, clientY: 120, detail: 1,
    target: increase, preventDefault() {}, stopPropagation() {}, ...values,
  });
  const down = (values) => controller.handleAiTextSizeToolbarPointerDown(event(values));
  const move = (values) => controller.handleAiTextSizeToolbarPointerMove(event(values));
  const up = (values) => controller.handleAiTextSizeToolbarPointerUp(event(values));
  const click = (values) => controller.handleAiTextSizeToolbarClick(event(values));
  const position = () => ({ x: toolbar.offsetLeft, y: toolbar.offsetTop });
  t.after(() => {
    try { controller.destroy(); }
    finally { restoreGlobals.forEach((restore) => restore()); }
  });
  return { controller, toolbar, host, increase, decrease, dismiss, event, down, move, up, click, position, windowStub };
}

test("clicks and small pointer jitter still resize every label without pinning the toolbar", (t) => {
  const f = fixture(t);
  f.down();
  f.move({ clientX: 122, clientY: 121 });
  f.up({ clientX: 122, clientY: 121 });
  f.click();
  assert.deepEqual(f.controller.aiDrawings.map((d) => d.fontSize), [11, 11]);
  assert.equal(f.controller.aiTextSizeToolbarPosition, null);
  assert.equal(f.controller.saved, 1);
  f.click({ target: f.decrease, detail: 0 });
  assert.deepEqual(f.controller.aiDrawings.map((d) => d.fontSize), [10, 10]);
});

test("dragging either button moves the group, suppresses its click and survives label reflow", (t) => {
  const f = fixture(t);
  for (const target of [f.increase, f.decrease]) {
    const start = f.position();
    f.down({ target });
    f.move({ clientX: 180, clientY: 155 });
    assert.ok(f.toolbar.hasPointerCapture(1));
    assert.ok(f.toolbar.classes.has("dragging"));
    f.up({ clientX: 180, clientY: 155 });
    f.click({ target });
    assert.deepEqual(f.position(), { x: start.x + 60, y: start.y + 35 });
    assert.deepEqual(f.controller.aiDrawings.map((d) => d.fontSize), [10, 10]);
    assert.equal(f.controller.saved, undefined);
    assert.equal(f.toolbar.hasPointerCapture(1), false);
    assert.equal(f.toolbar.classes.has("dragging"), false);
    f.controller.labelBounds = { x: 10, y: 20, width: 160, height: 48 };
    f.controller.redraw();
    assert.deepEqual(f.position(), { x: start.x + 60, y: start.y + 35 });
  }
  f.down(); f.up(); f.click();
  assert.deepEqual(f.controller.aiDrawings.map((d) => d.fontSize), [11, 11]);
});

test("drag position clamps to all edges and reclamps after chart resize", (t) => {
  const f = fixture(t);
  f.down();
  f.move({ clientX: -1000, clientY: -1000 });
  assert.deepEqual(f.position(), { x: 8, y: 12 });
  f.move({ clientX: 1000, clientY: 1000 });
  assert.deepEqual(f.position(), { x: 422, y: 258 });
  f.up({ clientX: 1000, clientY: 1000 });
  f.controller.bounds = { width: 250, height: 150 };
  f.controller.redraw();
  assert.deepEqual(f.position(), { x: 172, y: 108 });
});

test("dismissal survives annotation hover/focus, redraws and tool changes until the whole canvas is re-entered", (t) => {
  const f = fixture(t);
  const initial = f.position();
  f.down(); f.move({ clientX: 180 }); f.up({ clientX: 180 });
  assert.notDeepEqual(f.position(), initial);
  f.down({ target: f.dismiss });
  assert.equal(f.controller.aiTextSizeToolbarDrag, null);
  f.click({ target: f.dismiss });
  assert.equal(f.toolbar.hidden, true);
  f.controller.aiTextSizeTrigger = () => ({ dataset: { aiTextSizeTrigger: "first" } });
  f.controller.handleAiTextPointerOver(f.event());
  f.controller.handleAiTextFocusIn(f.event());
  f.controller.showAiTextSizeToolbar("first");
  f.controller.redraw();
  assert.equal(f.toolbar.hidden, true);
  f.controller.activeTool = 'trend-line'; f.controller.redraw();
  f.controller.activeTool = 'cursor'; f.controller.redraw();
  assert.equal(f.toolbar.hidden, true);
  f.host.dispatchEvent(new Event('pointerenter'));
  assert.equal(f.toolbar.hidden, true, 'interior transitions never arm recovery');
  f.host.dispatchEvent(new Event('pointerleave'));
  assert.equal(f.toolbar.hidden, true);
  f.host.dispatchEvent(new Event('pointerenter'));
  assert.equal(f.toolbar.hidden, false);
  assert.deepEqual(f.position(), initial, 're-entry restores the default annotation anchor');
});

test('toolbar drag protects its DOM from shell renders and never changes label data', t => {
  const f = fixture(t); let renders = 0;
  f.down(); assert.equal(deferTradingChartShellRender(() => renders++), true);
  f.move({ clientX: 180 }); assert.equal(renders, 0);
  f.up({ clientX: 180 }); assert.equal(renders, 1);
  assert.deepEqual(f.controller.aiDrawings.map(d => d.fontSize), [10, 10]);
});

test('two toolbars dismiss independently and share viewport recovery without leaking listeners', t => {
  const f = fixture(t), other = new ElementStub(); let restored = 0;
  const visibility = new TradingChartToolbarVisibility(other, f.host, f.host, () => { restored++; visibility.setAvailable(true); });
  t.after(() => visibility.destroy());
  visibility.setAvailable(true);
  f.click({ target: f.dismiss });
  assert.equal(f.toolbar.hidden, true); assert.equal(other.hidden, false);
  visibility.dismiss();
  f.controller.hideAiTextSizeToolbar(); f.controller.redraw();
  assert.equal(f.toolbar.hidden, true); assert.equal(other.hidden, true);
  f.host.dispatchEvent(new Event('pointerleave')); f.host.dispatchEvent(new Event('pointerenter'));
  assert.equal(f.toolbar.hidden, false); assert.equal(other.hidden, false); assert.equal(restored, 1);
  f.controller.destroy(); f.controller.destroy();
  assert.ok(f.host.classes.has('trading-chart-toolbar-viewport'));
  visibility.dismiss(); f.host.dispatchEvent(new Event('pointerleave')); f.host.dispatchEvent(new Event('pointerenter'));
  assert.equal(restored, 2);
  visibility.destroy(); assert.equal(f.host.classes.has('trading-chart-toolbar-viewport'), false);
  f.host.dispatchEvent(new Event('pointerleave')); f.host.dispatchEvent(new Event('pointerenter'));
  assert.equal(restored, 2);
});

test("secondary input is ignored and cancellation, capture loss, blur and hiding release a drag", (t) => {
  const f = fixture(t);
  f.down({ button: 2 });
  f.down({ isPrimary: false });
  assert.equal(f.controller.aiTextSizeToolbarDrag, null);
  for (const finish of [
    () => f.controller.handleAiTextSizeToolbarPointerCancel(f.event()),
    () => f.toolbar.dispatchEvent(Object.assign(new Event("lostpointercapture"), { pointerId: 1 })),
    () => f.windowStub.dispatchEvent(new Event("blur")),
    () => f.controller.hideAiTextSizeToolbar(),
    () => f.controller.destroy(),
  ]) {
    f.down();
    const start = f.position();
    f.move({ pointerId: 2, clientX: 180 });
    assert.deepEqual(f.position(), start);
    f.move({ clientX: 180 });
    finish();
    assert.equal(f.controller.aiTextSizeToolbarDrag, null);
    assert.equal(f.toolbar.hasPointerCapture(1), false);
    assert.equal(f.toolbar.classes.has("dragging"), false);
  }
});

test("keyboard activation and disabled buttons remain correct after dragging", (t) => {
  const f = fixture(t);
  f.down(); f.move({ clientX: 180 }); f.up({ clientX: 180 });
  f.click({ detail: 0 });
  assert.deepEqual(f.controller.aiDrawings.map((d) => d.fontSize), [11, 11]);
  f.controller.aiDrawings.forEach((d) => { d.fontSize = 36; });
  f.controller.redraw();
  assert.equal(f.increase.disabled, true);
  f.click({ detail: 0 });
  assert.deepEqual(f.controller.aiDrawings.map((d) => d.fontSize), [36, 36]);
});
