import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createNotificationSession} from '../src/main/notification-session.mjs';

class Notification extends EventEmitter {
  closed = 0;
  close() { this.closed++; this.emit('close'); }
}
test('native notifications open only in their original account, including delayed navigation', () => {
  let account='alice', opened=0, navigate;
  const session=createNotificationSession(()=>account), note=new Notification();
  session.track(note,current=>{ opened++; navigate=()=>current() && 'old-chart'; });
  note.emit('click'); assert.equal(opened,1); assert.equal(navigate(),'old-chart');
  account='bob'; assert.equal(navigate(),false);
  note.emit('click'); assert.equal(opened,1);
});
test('logout closes notifications and invalidates old clicks even after the same account returns', () => {
  const session=createNotificationSession(()=> 'alice');let opened=0;
  const old=new Notification(), fresh=new Notification();
  session.track(old,()=>opened++);session.clear();
  assert.equal(old.closed,1);old.emit('click');assert.equal(opened,0);
  session.track(fresh,()=>opened++);fresh.emit('click');assert.equal(opened,1);
  session.clear();assert.equal(fresh.closed,1);assert.equal(old.closed,1);
});
test('already closed notifications are released and a failing native close cannot block others', () => {
  const session=createNotificationSession(()=> 'alice');
  const closed=new Notification(), failing=new Notification(), live=new Notification();
  for(const note of [closed,failing,live])session.track(note,()=>assert.fail('stale click'));
  closed.close(); failing.close=()=>{throw Error('OS object expired');};session.clear();
  assert.equal(closed.closed,1);assert.equal(live.closed,1);
  failing.emit('click');
});
