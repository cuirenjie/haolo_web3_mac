import assert from 'node:assert/strict';
import test from 'node:test';
import {createInteractionRenderGuard} from '../src/renderer/interaction-render-guard.ts';

function fixture() {
  const view = new EventTarget(), doc = new EventTarget(), timers = new Map();
  let seq = 0;
  view.reportError = error => { view.lastError = error; };
  Object.assign(view, {setTimeout: fn => {timers.set(++seq, fn); return seq;}, clearTimeout: id => timers.delete(id)});
  doc.defaultView = view;
  const root = {isConnected: true, contains(node) {return node === this || node?.parent && this.contains(node.parent);}};
  const button = {parent: root, isConnected: true, contains: root.contains, closest: () => button};
  const icon = {parent: button, isConnected: true, contains: root.contains, closest: () => button};
  const unrelated = {isConnected: true, contains: root.contains};
  const guard = createInteractionRenderGuard(doc);
  const emit = (type, target = icon, fields = {}) => {
    const event = new Event(type);
    Object.assign(event, {pointerId: 1, pointerType: 'mouse', buttons: 1, ...fields});
    Object.defineProperty(event, 'target', {value: target});
    Object.defineProperty(event, 'composedPath', {value: () => [target, root, doc, view]});
    view.dispatchEvent(event);
  };
  const flush = () => {while (timers.size) {const batch = [...timers.values()]; timers.clear(); batch.forEach(fn => fn());}};
  return {view, doc, root, button, icon, unrelated, guard, emit, flush};
}

test('retains the pressed node through pointerup, coalesces updates, never replays input', () => {
  const f = fixture(); let rendered = 0, clicks = 0;
  f.view.addEventListener('click', () => clicks++);
  f.emit('pointerdown');
  assert.equal(f.guard.defer(f.root, () => rendered = 1), true);
  assert.equal(f.guard.defer(f.root, () => rendered = 2), true);
  f.emit('pointerup');
  assert.equal(rendered, 0);
  assert.equal(f.guard.defer(f.root, () => rendered = 3), true);
  f.emit('click'); f.flush();
  assert.equal(rendered, 3); assert.equal(clicks, 1);
  f.guard.dispose();
});

test('the native click handler may render synchronously and supersedes its pending render', () => {
  const f = fixture(); let rendered = 0;
  f.emit('pointerdown'); f.guard.defer(f.root, () => rendered += 10);
  f.view.addEventListener('click', () => {
    assert.equal(f.guard.defer(f.root, () => rendered += 100), false);
    rendered++;
  });
  f.emit('pointerup'); f.emit('click'); f.flush();
  assert.equal(rendered, 1); f.guard.dispose();
});

test('local updates outside the pressed region are not delayed', () => {
  const f = fixture(); f.emit('pointerdown');
  assert.equal(f.guard.defer(f.unrelated, () => {}), false);
  assert.equal(f.guard.defer(f.button, () => {}), true);
  f.guard.dispose();
});

for (const release of ['pointercancel', 'blur', 'drag-release', 'lost-release']) {
  test(`${release} releases pending rendering even without a click`, () => {
    const f = fixture(); let rendered = 0;
    f.emit('pointerdown'); f.guard.defer(f.root, () => rendered++);
    if (release === 'drag-release') f.emit('pointerup');
    else if (release === 'lost-release') f.emit('pointermove', f.icon, {buttons: 0});
    else f.emit(release, release === 'blur' ? f.view : f.icon);
    f.flush(); assert.equal(rendered, 1); f.guard.dispose();
  });
}

test('Space activation survives an update between keydown and keyup', () => {
  const f = fixture(); let rendered = 0;
  f.emit('keydown', f.button, {key: ' '});
  assert.equal(f.guard.defer(f.root, () => rendered++), true);
  f.emit('keyup', f.button, {key: ' '}); assert.equal(rendered, 0);
  f.emit('click', f.button, {pointerId: -1}); f.flush();
  assert.equal(rendered, 1); f.guard.dispose();
});

test('focus moving between controls must not cancel a held pointer', () => {
  const f = fixture(); let rendered = 0;
  f.emit('pointerdown'); f.guard.defer(f.root, () => rendered++);
  f.emit('blur', f.unrelated); f.flush();
  assert.equal(rendered, 0);
  f.emit('pointerup'); f.emit('click'); f.flush();
  assert.equal(rendered, 1); f.guard.dispose();
});

test('releasing one touch does not release a second touch', () => {
  const f = fixture(); let rendered = 0;
  const other = {parent: f.root, isConnected: true, contains: f.root.contains};
  f.emit('pointerdown', f.icon, {pointerId: 2, pointerType: 'touch'});
  f.emit('pointerdown', other, {pointerId: 3, pointerType: 'touch'});
  f.guard.defer(f.root, () => rendered++);
  f.emit('pointercancel', f.icon, {pointerId: 2}); f.flush(); assert.equal(rendered, 0);
  f.emit('pointercancel', other, {pointerId: 3}); f.flush(); assert.equal(rendered, 1);
  f.guard.dispose();
});

test('detached scopes are discarded, and a new press is not released by an old timer', () => {
  const f = fixture(); let rendered = 0;
  f.emit('pointerdown'); f.guard.defer(f.button, () => rendered++); f.emit('pointerup');
  f.emit('pointerdown'); f.flush(); assert.equal(rendered, 0);
  f.button.isConnected = false;
  f.emit('pointercancel'); f.flush(); assert.equal(rendered, 0); f.guard.dispose();
});

test('one failing redraw cannot strand other pending regions', () => {
  const f = fixture(); let rendered = 0;
  f.emit('pointerdown');
  f.guard.defer(f.button, () => { throw new Error('failed region'); });
  f.guard.defer(f.root, () => rendered++);
  f.emit('pointercancel'); f.flush();
  assert.equal(f.view.lastError.message, 'failed region');
  assert.equal(rendered, 1); f.guard.dispose();
});

test('independent operations sharing a region coalesce by their own stable key', () => {
  const f = fixture(), operations = [];
  f.emit('pointerdown');
  f.guard.defer(f.root, () => operations.push('obsolete header'), 'header');
  f.guard.defer(f.root, () => operations.push('buttons'), 'buttons');
  f.guard.defer(f.root, () => operations.push('latest header'), 'header');
  f.emit('pointerup'); f.emit('click'); f.flush();
  assert.deepEqual(operations, ['latest header', 'buttons']); f.guard.dispose();
});
