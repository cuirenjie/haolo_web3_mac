import assert from 'node:assert/strict';
import test from 'node:test';
import {createDesktopNotificationQueue} from '../src/main/desktop-notification-queue.mjs';
const tick=()=>new Promise(setImmediate);
function fixture(limit=200) {
  let scope='account-a',enabled=true,fail=false;
  const shown=[],closed=[],errors=[],timers=[];
  const queue=createDesktopNotificationQueue({scope:()=>scope,enabled:()=>enabled,limit,
    present:(value,done)=>{if(fail)throw Error('fixture failure');shown.push(value.evidenceId);closed.push(done);return done;},
    onError:e=>errors.push(e),schedule:fn=>{timers.push(fn);return fn;},cancel:fn=>timers.splice(timers.indexOf(fn),1)});
  return {queue,shown,closed,errors,timers,fail:v=>fail=v,switch:()=>scope='account-b',disable:()=>enabled=false};
}
test('bursts display in order, duplicates do not replace a visible notification, and close advances once',async()=>{
  const h=fixture();for(const evidenceId of ['a','b','c','b'])h.queue.show({evidenceId});
  assert.deepEqual(h.shown,['a']);h.closed[0]();h.closed[0]();await tick();
  assert.deepEqual(h.shown,['a','b']);h.closed[1]();await tick();assert.deepEqual(h.shown,['a','b','c']);
});
test('account switch or disabled popups discard queued reminders and shutdown clears them',async()=>{
  for(const action of ['switch','disable']) {
    const h=fixture();h.queue.show({evidenceId:'a'});h.queue.show({evidenceId:'b'});
    h[action]();h.closed[0]();await tick();assert.deepEqual(h.shown,['a']);
  }
  const h=fixture();h.queue.show({evidenceId:'a'});h.queue.show({evidenceId:'b'});h.queue.clear();await tick();assert.deepEqual(h.shown,['a']);
});
test('full queue fails before receipt acceptance and can accept retry after a visible popup closes',async()=>{
  const h=fixture(1);h.queue.show({evidenceId:'a'});h.queue.show({evidenceId:'b'});
  assert.throws(()=>h.queue.show({evidenceId:'c'}),/QUEUE_FULL/);
  h.closed[0]();await tick();h.queue.show({evidenceId:'c'});h.closed[1]();await tick();assert.deepEqual(h.shown,['a','b','c']);
});
test('window creation failures retry without dropping the queued event or crashing async close',async()=>{
  const h=fixture();h.fail(true);assert.throws(()=>h.queue.show({evidenceId:'a'}),/fixture/);
  h.fail(false);h.queue.show({evidenceId:'a'});h.queue.show({evidenceId:'b'});
  h.fail(true);h.closed[0]();await tick();assert.equal(h.errors.length,1);assert.equal(h.timers.length,1);
  h.fail(false);h.timers.shift()();assert.deepEqual(h.shown,['a','b']);h.queue.clear();
});
