import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import ts from 'typescript';
import {YouleApiClient} from '../src/main/youle-api-client.mjs';
import {sharedSnapshotPosition,sharedSnapshotTime} from '../src/main/binance-account/shared-snapshot.mjs';
import {binanceAccountReadErrorResult} from '../src/shared/binance-account-errors.mjs';
import {createAccountPnlUpdates} from '../src/renderer/binance-account-pnl.ts';
import {createBinanceAccountUiState,renderBinanceAccountPage} from '../src/renderer/binance-account-ui.ts';

const origins=(process.env.HAOLO_PNL_FIXTURE_ORIGINS||'').split(',');
assert.equal(origins.length,2);for(const origin of origins)assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
const id='00000000-0000-0000-0000-000000000524';
const main=ts.createSourceFile('main.mjs',readFileSync(new URL('../src/main/main.mjs',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const norm=main.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='normalizeSharedBinanceSnapshot').getText(main);
const normalize=new Function('sharedSnapshotPosition','sharedSnapshotTime',`${norm};return normalizeSharedBinanceSnapshot;`)(sharedSnapshotPosition,sharedSnapshotTime);
let handler;
function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(main)==='ipcMain.handle'&&n.arguments[0]?.text==='binanceAccount:getSnapshot')handler=n.arguments[1].getText(main);ts.forEachChild(n,visit);}visit(main);
const preload=ts.createSourceFile('preload.mjs',readFileSync(new URL('../src/main/preload.mjs',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const invokeSource=preload.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='invokeBinanceAccountSnapshot').getText(preload);
const onSource=preload.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(preload)==='on')).getText(preload);
const results=[];
const sessions=origins.map((origin,index)=>{
  const bus=new EventEmitter(), updates=createAccountPnlUpdates(), ui=createBinanceAccountUiState();
  ui.loaded=true;ui.status={bound:true};
  let completeAt=0;
  const client=new YouleApiClient({onAccountPnl:fields=>bus.emit('binanceAccount:pnl',{},fields)});
  client.loaded=true;client.baseUrl=origin;client.token='fixture-session-'+index;
  const deps={assertExternalModelsIpcSender(){},requireBinanceAccountOwner:async()=>({ownerId:'fixture'}),
    readBinanceAccountStatusWithSharedBinding:async()=>({serverCredentialsBound:true,serverConnectionId:id}),
    getYouleApiClient:()=>client,normalizeSharedBinanceSnapshot:normalize,sameBinanceBindingOwner:()=>true,
    binanceAccountReadErrorResult,console:{info(){}}};
  const invokeMain=new Function(...Object.keys(deps),`return (${handler});`)(...Object.values(deps));
  bus.invoke=async(_channel,params)=>invokeMain({},params);
  const {invoke,on}=new Function('ipcRenderer',`${invokeSource};${onSource};return {invoke:invokeBinanceAccountSnapshot,on};`)(bus);
  on('binanceAccount:pnl',value=>{updates.remember(value);ui.snapshot=updates.apply(ui.snapshot);completeAt=Date.now();});
  return {client,ui,async run(){
    const start=Date.now();ui.snapshot=updates.apply(await invoke({force:true}));
    assert.equal(ui.snapshot.realizedPnlToday,null);
    assert.match(renderBinanceAccountPage(ui),/更新中/);
    for(let i=0;i<200&&ui.snapshot.realizedPnlToday==null;i++)await new Promise(r=>setTimeout(r,50));
    assert.equal(ui.snapshot.realizedPnlToday,0);assert.equal(ui.snapshot.todayPnl,2);
    assert.doesNotMatch(renderBinanceAccountPage(ui),/更新中|等待更新/);
    results.push({api:index+1,completionMs:completeAt-start,todayPnl:ui.snapshot.todayPnl,realized:ui.snapshot.realizedPnlToday});
  }};
});
try{
  await Promise.all(sessions.map(s=>s.run()));
  const stats=await (await fetch(origins[0]+'/fixture/stats')).json();
  assert.equal(stats.income,1,'two separate API processes and clients share one signed income query');
  assert.equal(stats.account,2,'one core per independent client, no duplicate core for income');
  const output=new URL('../.cache/account-pnl-20261023/chain.json',import.meta.url);
  mkdirSync(new URL('.',output),{recursive:true});
  writeFileSync(output,JSON.stringify({ok:true,results,stats,checks:['two real API processes','real PostgreSQL cache/lease','real signed synthetic exchange + Lua','actual SDK/main IPC/preload','renderer completion without polling']},null,2));
  console.log(JSON.stringify({ok:true,results,stats}));
}finally{for(const s of sessions)s.client.accountSnapshotComponents?.invalidate();}
