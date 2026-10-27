import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../src/main/main.mjs',import.meta.url),'utf8');
const parsed=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const body=parsed.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='tradingAlertsCombinedSnapshot').getText(parsed);
for(const boundary of ['local','session','remote'])test(`alert snapshot fences account changes while awaiting ${boundary}`,async()=>{
  let token='alice', release;
  const pause=value=>new Promise(resolve=>{release=()=>resolve(value);});
  const client={get token(){return token;},getSession:()=>boundary==='session'?pause({authenticated:true}):Promise.resolve({authenticated:true})};
  const run=Function('getYouleApiClient','getTradingAlertService','cloudPriceAlerts',body+';return tradingAlertsCombinedSnapshot;')(
    ()=>client,async()=>({snapshot:()=>boundary==='local'?pause({alerts:[{id:'old-local'}]}):Promise.resolve({alerts:[]})}),
    {snapshot:()=>boundary==='remote'?pause({alerts:[{id:'old-remote'}]}):Promise.resolve({alerts:[]})});
  const result=assert.rejects(run(),/ALERT_SESSION_CHANGED/);
  for(let i=0;i<10&&!release;i++)await new Promise(setImmediate);
  assert.equal(typeof release,'function');token='bob';release();await result;
});
