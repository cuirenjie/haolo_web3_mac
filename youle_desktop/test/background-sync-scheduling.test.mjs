import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {createCloudPlanRefresher} from '../src/renderer/cloud-plan-sync.ts';
import {applyTradingAlertsSnapshot,createTradingAlertsUiState} from '../src/renderer/trading-alerts-ui.ts';

test('idle resources do no short polling; one daily timer, resume catchup and topic isolation',async()=>{
  const prior={window:globalThis.window,document:globalThis.document,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
  const timers=new Map();let next=0;const window=new EventTarget(),document=Object.assign(new EventTarget(),{hidden:false});
  Object.assign(globalThis,{window,document,setTimeout:(run,delay)=>{const id=++next;timers.set(id,{run,delay});return id;},clearTimeout:id=>timers.delete(id)});
  try{
    const {onBackgroundSync,SYNC_DAY_MS}=await import('../src/renderer/background-sync.ts?idle-contract');
    const calls={settings:0,drawings:0,plans:0,alerts:0};
    const unsub=Object.keys(calls).map(topic=>onBackgroundSync(topic,()=>calls[topic]++));
    assert.equal(timers.size,1);
    const timer=[...timers.values()][0];assert.ok(timer.delay>=SYNC_DAY_MS&&timer.delay<=SYNC_DAY_MS+1800000);
    window.dispatchEvent(new CustomEvent('haolo:sync-changed',{detail:{topics:['settings']}}));
    assert.deepEqual(calls,{settings:1,drawings:0,plans:0,alerts:0});
    document.hidden=true;timer.run();assert.equal(calls.settings,1);
    document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));
    assert.deepEqual(calls,{settings:2,drawings:1,plans:1,alerts:1});
    window.dispatchEvent(new Event('focus'));assert.equal(calls.settings,2);
    unsub.forEach(run=>run());window.dispatchEvent(new Event('online'));assert.equal(calls.settings,2);
  } finally {Object.assign(globalThis,prior);}
});
test('a plan change arriving during an active read is coalesced into one followup',async()=>{
  let release,calls=0,applied=0;
  const refresh=createCloudPlanRefresher({eventDriven:true,scope:()=> 'a',read:()=>[],
    load:()=>{calls++;return calls===1?new Promise(resolve=>release=resolve):Promise.resolve({ok:true,reports:[]});},
    apply:()=>applied++,save:()=>true,changed:()=>{},cacheFailure:()=>assert.fail(),failure:()=>assert.fail()});
  const first=refresh();await refresh();await refresh();
  assert.equal(calls,1);release({ok:true,reports:[]});await first;await new Promise(setImmediate);
  assert.equal(calls,2);assert.equal(applied,2);
});
test('contact startup, request loading and implicit refresh all stop before network calls',async()=>{
  const source=fs.readFileSync(new URL('../src/renderer/main.ts',import.meta.url),'utf8');
  for(const name of ['loadContacts','loadContactRequests','syncContactRequestsAndContacts']){
    const match=source.match(new RegExp(`async function ${name}[^\\n]+\\n([\\s\\S]*?)\\n}`));
    assert.ok(match);let network=0;
    const body=match[1];
    const compiled=ts.transpileModule(`const run=async function(options={}){${body}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    const run=Function('CONTACTS_ENABLED','api',compiled+';return run;')(false,new Proxy({},{get(){network++;throw Error('Unexpected contact access');}}));
    // Early return runs synchronously before any potential awaited operation.
    await run();assert.equal(network,0);
  }
  assert.match(source,/function startContactRequestSync\(\)\s*{\s*if \(!CONTACTS_ENABLED\)/);
});

test('background alert reads preserve the original page without loading, error or connection notices',async()=>{
  const source=fs.readFileSync(new URL('../src/renderer/main.ts',import.meta.url),'utf8');
  const code=source.match(/async function refreshTradingAlerts\([^\n]+\n[\s\S]*?\n}/)?.[0];
  assert.ok(code);
  const compiled=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const state={activeView:'alerts',auth:{authenticated:true,baseUrl:'https://example',profile:{id:'a'}},tradingAlerts:createTradingAlertsUiState()};
  state.tradingAlerts.loaded=true;
  state.tradingAlerts.alerts=[{alertId:'existing'}];
  let renders=0,resolve;
  const api={tradingAlertsSnapshot:()=>new Promise(done=>resolve=done)};
  const run=Function('state','api','render','applyTradingAlertsSnapshot','errorMessage',compiled+';return refreshTradingAlerts;')(
    state,api,()=>renders++,applyTradingAlertsSnapshot,String);
  const before=structuredClone(state.tradingAlerts);
  let pending=run({silent:true});
  assert.deepEqual(state.tradingAlerts,before);assert.equal(renders,0);
  resolve({ok:false,error:{message:'sync failed'}});await pending;
  assert.deepEqual(state.tradingAlerts,before);assert.equal(renders,0);
  api.tradingAlertsSnapshot=async()=>{throw Error('offline');};await run({silent:true});
  assert.deepEqual(state.tradingAlerts,before);assert.equal(renders,0);
  api.tradingAlertsSnapshot=()=>new Promise(done=>resolve=done);
  pending=run({silent:true});state.auth.profile.id='b';resolve({ok:true,data:{alerts:[{alertId:'old-account'}]}});await pending;
  assert.deepEqual(state.tradingAlerts,before);assert.equal(renders,0);
  api.tradingAlertsSnapshot=async()=>({ok:true,data:{alerts:[{alertId:'current'}]}});
  await run({silent:true});assert.equal(state.tradingAlerts.alerts[0].alertId,'current');assert.equal(renders,1);
  // Manual page access keeps its existing failure behavior.
  api.tradingAlertsSnapshot=async()=>{throw Error('manual request failed');};await run();
  assert.equal(state.tradingAlerts.error,'Error: manual request failed');
});

test('foreground alert reads cannot publish delayed data or errors after an account changes',async()=>{
  const source=fs.readFileSync(new URL('../src/renderer/main.ts',import.meta.url),'utf8');
  const code=source.match(/async function refreshTradingAlerts\([^\n]+\n[\s\S]*?\n}/)[0];
  const compiled=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  for(const fail of [false,true])for(const sameAccount of [false,true]){
    const state={activeView:'alerts',auth:{authenticated:true,baseUrl:'https://fixture',profile:{id:'a'}},tradingAlerts:createTradingAlertsUiState()};
    let resolve,reject,renders=0;
    const api={tradingAlertsSnapshot:()=>new Promise((yes,no)=>{resolve=yes;reject=no;})};
    const run=Function('state','api','render','applyTradingAlertsSnapshot','errorMessage',compiled+';return refreshTradingAlerts;')(
      state,api,()=>renders++,applyTradingAlertsSnapshot,String);
    const pending=run();assert.equal(state.tradingAlerts.loading,true);
    state.auth.profile.id=sameAccount?'a':'b';
    state.tradingAlerts=createTradingAlertsUiState();
    const before=structuredClone(state.tradingAlerts);
    if(fail)reject(Error('old failure'));else resolve({ok:true,data:{cloudLoaded:true,alerts:[{alertId:'old'}]}});
    await pending;
    assert.deepEqual(state.tradingAlerts,before);assert.equal(renders,1);
  }
});
