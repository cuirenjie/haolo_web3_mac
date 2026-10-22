import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import ts from 'typescript';
import {YouleApiClient} from '../src/main/youle-api-client.mjs';
import {binanceAccountReadErrorResult,binanceCredentialErrorResult} from '../src/shared/binance-account-errors.mjs';
import {sharedSnapshotPosition,sharedSnapshotTime} from '../src/main/binance-account/shared-snapshot.mjs';

const origin=process.env.HAOLO_QUOTA_FIXTURE_ORIGIN;
assert.match(origin||'',/^http:\/\/127\.0\.0\.1:\d+$/);
const client=new YouleApiClient();
client.loaded=true;client.baseUrl=origin;client.token='fixture-session';client.serviceFetch=fetch;
const id='00000000-0000-0000-0000-000000000446';
const source=ts.createSourceFile('main.mjs',readFileSync(new URL('../src/main/main.mjs',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const normalizeNode=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='normalizeSharedBinanceSnapshot');
const normalize=new Function('sharedSnapshotPosition','sharedSnapshotTime',`${normalizeNode.getText(source)};return normalizeSharedBinanceSnapshot;`)(sharedSnapshotPosition,sharedSnapshotTime);
let handler;
function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(source)==='ipcMain.handle'&&n.arguments[0]?.text==='binanceAccount:getSnapshot')handler=n.arguments[1].getText(source);ts.forEachChild(n,visit);}
visit(source);
const deps={assertExternalModelsIpcSender(){},requireBinanceAccountOwner:async()=>({ownerId:'owner'}),
  readBinanceAccountStatusWithSharedBinding:async()=>({serverCredentialsBound:true,serverConnectionId:id}),
  getYouleApiClient:()=>client,normalizeSharedBinanceSnapshot:normalize,sameBinanceBindingOwner:()=>true,
  binanceAccountReadErrorResult,binanceCredentialErrorResult,console:{info(){}}};
const invokeMain=new Function(...Object.keys(deps),`return (${handler});`)(...Object.values(deps));
const preload=ts.createSourceFile('preload.mjs',readFileSync(new URL('../src/main/preload.mjs',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const invokeSource=preload.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='invokeBinanceAccountSnapshot').getText(preload);
const invoke=new Function('ipcRenderer',`${invokeSource};return invokeBinanceAccountSnapshot;`)({invoke:async(_channel,params)=>invokeMain({},params)});
const first=await invoke({force:true,live:true,summary:true});
assert.equal(first.marginBalance,100);assert.equal(first.realizedPnlToday,null);
await new Promise(r=>setTimeout(r,250));
const second=await invoke({live:true,summary:true});
assert.equal(second.realizedPnlToday,3);assert.equal(second.todayPnl,5);
let stats=await (await fetch(origin+'/fixture/status')).json();
assert.equal(stats.account,1,'core API and optional P&L share a core observation');
assert.equal(stats.income,1);
await fetch(origin+'/fixture/cooldown',{method:'POST'});
await assert.rejects(invoke({force:true}),e=>e.code==='BINANCE_RATE_LIMITED'&&e.scope==='binance_account'&&e.retryAfterMs>=60000&&!e.message.includes('模型'));
const requests=(await (await fetch(origin+'/fixture/status')).json()).upstream;
for(let i=0;i<8;i++)await assert.rejects(invoke({force:true}),e=>e.status===429);
assert.equal((await (await fetch(origin+'/fixture/status')).json()).upstream,requests);
const result={ok:true,checks:['SDK/HTTP/API/signed exchange/Lua/core cache','actual main IPC and preload','independent P&L','domain-specific cooldown','manual retry suppression'],...stats};
writeFileSync(new URL('../.cache/binance-quota-M1-445/chain.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
