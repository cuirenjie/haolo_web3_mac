import assert from 'node:assert/strict';
import test from 'node:test';
import { tradingSendReceipt, TradingSendReceiptStore } from '../src/renderer/trading-send-receipt.ts';

const pending = {itemId:'user-1',status:'sending',createdAt:'2026-10-26T06:00:00Z'};
const user = {id:'user-1',kind:'user_text',role:'user',conversation_id:'thread'};

test('receipt is synchronous, localized, stable during waiting, and not a stored history mutation', () => {
  const messages = [user];
  for (const locale of ['zh-CN','zh-TW','en','ja','ko']) {
    const receipt = tradingSendReceipt('thread',messages,pending,locale);
    assert.ok(receipt.text);
    assert.equal(receipt.kind,'agent_text');
    assert.equal(receipt.created_at,pending.createdAt);
    assert.deepEqual(tradingSendReceipt('thread',messages,pending,locale),receipt);
  }
  assert.equal(messages.length,1);
  assert.ok(tradingSendReceipt('thread',messages,{...pending,status:'uploading'},'zh-CN'));
});

test('progress does not replace a receipt; failed or missing sends do not create one', () => {
  assert.equal(tradingSendReceipt('thread',[user],null,'zh-CN'),null);
  assert.equal(tradingSendReceipt('thread',[user],{...pending,status:'failed'},'zh-CN'),null);
  assert.equal(tradingSendReceipt('thread',[],pending,'zh-CN'),null);
  const progress={id:'progress',role:'ceo_assistant',kind:'agent_text',text:'正在准备行情'};
  assert.ok(tradingSendReceipt('thread',[user,progress],pending,'zh-CN'));
  assert.ok(tradingSendReceipt('replacement',[progress,user],pending,'zh-CN'));
  assert.equal(tradingSendReceipt('replacement',[user],pending,'zh-CN').conversation_id,'replacement');
});

const progress = {id:'progress',conversation_id:'thread',role:'ceo_assistant',kind:'agent_text',text:'正在准备行情'};
const report = {...progress,id:'report',text:'分析完成'};

test('receipt keeps its identity and position through progress, completion, rerender and a second send', () => {
  const store = new TradingSendReceiptStore();
  const first = store.project('thread',[user],pending,'zh-CN')[1];
  const messages = [user,progress,report];
  const expected = [user,first,progress,report];
  assert.deepEqual(store.project('thread',messages,pending,'zh-CN'),expected);
  assert.deepEqual(store.project('thread',messages,null,'zh-CN'),expected);
  assert.deepEqual(store.project('thread',expected,null,'zh-CN'),expected);
  const nextUser = {...user,id:'user-2'};
  const next = store.project('thread',[...messages,nextUser],{...pending,itemId:nextUser.id},'en');
  assert.deepEqual(next.slice(0,4),expected);
  assert.equal(next[4],nextUser);
  assert.equal(next[5].id,'trading-send-receipt-user-2');
  assert.equal(messages.length,3,'input history must not be mutated');
});

test('thread promotion and confirmed user IDs preserve the original bubble, including after restart', () => {
  const values = new Map();
  const storage = {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const store = new TradingSendReceiptStore(()=>storage,()=>'account-1');
  const first = store.project('draft',[user],pending,'zh-CN')[1];
  store.moveThread('draft','thread');
  store.moveThread('draft','thread');
  store.confirmUser('thread',[user.id],'confirmed-user');
  const restored = new TradingSendReceiptStore(()=>storage,()=>'account-1');
  const confirmed = {...user,id:'confirmed-user'};
  assert.deepEqual(restored.project('thread',[confirmed,progress,report],null,'en'),[
    confirmed,{...first,conversation_id:'thread'},progress,report,
  ]);
  assert.deepEqual(restored.project('draft',[user],null,'zh-CN'),[user]);
});

test('receipts are isolated by account/thread and never appear without their user message', () => {
  const values = new Map();
  const storage = {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  let account = 'one';
  const store = new TradingSendReceiptStore(()=>storage,()=>account);
  store.project('thread',[user],pending,'zh-CN');
  assert.deepEqual(store.project('thread',[],null,'zh-CN'),[]);
  assert.deepEqual(store.project('other',[user],null,'zh-CN'),[user]);
  account = 'two';
  assert.deepEqual(store.project('thread',[user],null,'zh-CN'),[user]);
  account = 'one';
  assert.equal(store.project('thread',[user],null,'zh-CN').length,2);
  const failed = {...user,__youleLocalSendStatus:'failed'};
  assert.deepEqual(store.project('thread',[failed],null,'zh-CN'),[failed]);
  assert.deepEqual(store.project('thread',[user],null,'zh-CN'),[user]);
});

test('unavailable storage still preserves the bubble in memory', () => {
  const store = new TradingSendReceiptStore(()=>{throw new Error('storage unavailable');},()=>'account');
  const first = store.project('thread',[user],pending,'ja')[1];
  assert.deepEqual(store.project('thread',[user,progress],null,'ja'),[user,first,progress]);
});
