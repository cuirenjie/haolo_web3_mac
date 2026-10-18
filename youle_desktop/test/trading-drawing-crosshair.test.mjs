import assert from 'node:assert/strict';
import test from 'node:test';
import { TradingDrawingCrosshair } from '../src/renderer/trading-drawing-crosshair.ts';

function browser(t) {
  const originalWindow = globalThis.window, originalMouseEvent = globalThis.MouseEvent;
  const frames = new Map();
  let nextFrame = 0;
  let bridge;
  globalThis.window = Object.assign(new EventTarget(), {
    requestAnimationFrame(fn) { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  globalThis.MouseEvent = class extends Event {
    constructor(type, init = {}) {
      super(type, init);
      for (const [key, value] of Object.entries(init)) {
        if (!['bubbles', 'cancelable', 'composed'].includes(key)) this[key] = value;
      }
    }
  };
  t.after(() => {
    bridge?.destroy();
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalMouseEvent === undefined) delete globalThis.MouseEvent; else globalThis.MouseEvent = originalMouseEvent;
  });
  const overlay = Object.assign(new EventTarget(), { isConnected: true });
  const events = [];
  const canvas = name => {
    const element = Object.assign(new EventTarget(), { isConnected: true,
      getBoundingClientRect: () => ({ left: 10, top: 20, right: 410, bottom: 320, width: 400, height: 300 }) });
    for (const type of ['mouseenter', 'mousemove', 'mouseleave', 'mousedown', 'mouseup']) {
      element.addEventListener(type, e => events.push({ name, type, x: e.clientX, y: e.clientY, buttons: e.buttons, shift: e.shiftKey }));
    }
    return element;
  };
  let surface = canvas('main');
  bridge = new TradingDrawingCrosshair(overlay, () => surface);
  const pointer = (type, x = 50, y = 60, options = {}) => overlay.dispatchEvent(Object.assign(new Event(type), {
    clientX: x, clientY: y, screenX: x, screenY: y, pointerType: 'mouse', isPrimary: true, buttons: 1, ...options,
  }));
  return { bridge, events, pointer, frames, overlay, canvas,
    replace(next) { surface = next; },
    paint() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); },
  };
}

test('drawing hover coalesces high-rate pointers without forwarding chart drag buttons', t => {
  const b = browser(t);
  b.pointer('pointerenter');b.paint();
  b.pointer('pointerdown');
  for (let i = 0; i < 100; i++) b.pointer('pointermove', 100 + i, 100, { shiftKey: true });
  assert.equal(b.frames.size, 1);
  assert.equal(b.events.length, 1);
  b.paint();
  assert.deepEqual(b.events.at(-1), { name: 'main', type: 'mousemove', x: 199, y: 100, buttons: 0, shift: true });
  b.pointer('pointerup', 200, 110);b.paint();
  assert.equal(b.events.at(-1).x, 200);
  assert.equal(b.events.some(e => e.type === 'mousedown' || e.type === 'mouseup'), false);
});

test('capture outside plot, cancel and blur clear crosshair and pending frames; reentry recovers', t => {
  const b = browser(t);
  for (const end of ['outside', 'pointerleave', 'pointercancel', 'blur']) {
    b.pointer('pointermove');b.paint();
    assert.equal(b.events.at(-1).type, 'mouseenter');
    b.pointer('pointermove', 250, 200);
    if (end === 'outside') { b.pointer('pointermove', 500, 200);b.paint(); }
    else if (end === 'blur') window.dispatchEvent(new Event('blur'));
    else b.pointer(end);
    assert.equal(b.frames.size, 0);
    assert.equal(b.events.at(-1).type, 'mouseleave');
    const count = b.events.length;b.paint();assert.equal(b.events.length, count);
  }
});

test('pane replacement and hidden or detached plots cannot leave stale crosshairs', t => {
  const b = browser(t);
  b.pointer('pointermove');b.paint();
  b.replace(b.canvas('rebuilt'));
  b.pointer('pointermove', 150, 160);b.paint();
  assert.deepEqual(b.events.slice(-2).map(e => [e.name, e.type]), [['main', 'mouseleave'], ['rebuilt', 'mouseenter']]);
  b.overlay.isConnected = false;
  b.pointer('pointermove');b.paint();
  assert.equal(b.events.at(-1).type, 'mouseleave');
  b.overlay.isConnected = true;
  const hidden = b.canvas('hidden');
  hidden.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
  b.replace(hidden);const count = b.events.length;
  b.pointer('pointermove');b.paint();assert.equal(b.events.length, count);
});

test('touch and secondary pointers do not synthesize mouse hover; primary pens do', t => {
  const b = browser(t);
  b.pointer('pointermove', 50, 60, { pointerType: 'touch' });
  b.pointer('pointermove', 50, 60, { isPrimary: false });
  assert.equal(b.frames.size, 0);
  b.pointer('pointermove', 70, 80, { pointerType: 'pen' });b.paint();
  assert.equal(b.events.at(-1).x, 70);
});

test('destroy removes event listeners and cancels a pending paint', t => {
  const b = browser(t);
  b.pointer('pointermove');b.paint();b.pointer('pointermove', 200, 200);
  b.bridge.destroy();b.bridge.destroy();
  assert.equal(b.frames.size, 0);
  assert.equal(b.events.at(-1).type, 'mouseleave');
  const count = b.events.length;
  b.pointer('pointermove');b.paint();window.dispatchEvent(new Event('blur'));
  assert.equal(b.events.length, count);
});
