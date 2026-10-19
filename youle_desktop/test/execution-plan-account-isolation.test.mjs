import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';

const ast = ts.createSourceFile('main.ts', fs.readFileSync(new URL('../src/renderer/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
function harness(name, cloud = true) {
  const plan = {id:'same-id',status:'pending',linkedAlertId:'alert-A',...(cloud ? {cloudReport:{planRecords:[{id:'remote-A',scenario:{conditionHash:'A'}}]}} : {})};
  const other = {id:'same-id',status:'pending',title:'Account B'};
  const state = {executionPlansScope:'A',executionPlans:[plan],settings:{language:'en'},tradingAlerts:{alerts:[]}};
  const writes = [], notices = [], calls = [];
  let resolve, reject, confirmResolve;
  const pending = new Promise((yes, no) => {resolve=yes;reject=no;});
  const deps = {state,executionPlanAlertSyncBusyIds:new Set(),executionPlanDeleteBusyIds:new Set(),render:()=>{},
    transitionExecutionPlan:(p,status)=>({...p,status}),syncExecutionPlanLinkedAlert:()=>pending,
    saveExecutionPlans:(scope,plans)=>{writes.push({scope,plans});return true;},showToast:m=>notices.push(m),errorMessage:e=>e.message,
    confirmInApp:()=>new Promise(r=>confirmResolve=r),refreshTradingAlerts:async()=>calls.push('refresh'),
    api:{tradingCloudPlans:async()=>{calls.push('delete');return pending;},tradingAlertsDelete:async()=>{calls.push('delete');return pending;}}};
  const node = ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
  const run = Function(...Object.keys(deps),ts.transpileModule(node.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+`;return ${name};`)(...Object.values(deps));
  return {run,state,other,writes,notices,calls,resolve,reject,confirm:()=>confirmResolve(true),switch:()=>{state.executionPlansScope='B';state.executionPlans=[other];}};
}

for (const failed of [false,true]) test(`late lifecycle ${failed?'failure':'success'} cannot modify another account`,async()=>{
  const h=harness('updateExecutionPlanLifecycle');const run=h.run('same-id','ended');
  h.switch();if(failed)h.reject(Error('old-account failure'));else h.resolve({alertId:'alert-A'});
  await run;assert.deepEqual(h.state.executionPlans,[h.other]);assert.deepEqual(h.writes,[]);assert.deepEqual(h.notices,[]);
});

test('account switch while confirming deletion prevents the request',async()=>{
  const h=harness('deleteExecutionPlan');const run=h.run('same-id');h.switch();h.confirm();await run;
  assert.deepEqual(h.calls,[]);assert.deepEqual(h.writes,[]);assert.deepEqual(h.state.executionPlans,[h.other]);
});

for (const failed of [false,true]) test(`late cloud deletion ${failed?'failure':'success'} cannot overwrite another account`,async()=>{
  const h=harness('deleteExecutionPlan');const run=h.run('same-id');h.confirm();await new Promise(setImmediate);
  assert.deepEqual(h.calls,['delete']);h.switch();if(failed)h.reject(Error('delete failed'));else h.resolve({ok:true});
  await run;assert.deepEqual(h.state.executionPlans,[h.other]);assert.deepEqual(h.writes,[]);assert.deepEqual(h.notices,[]);
});

test('failed local alert deletion restores only its original account cache',async()=>{
  const h=harness('deleteExecutionPlan',false);const run=h.run('same-id');h.confirm();await new Promise(setImmediate);
  assert.deepEqual(h.writes.map(w=>w.scope),['A']);h.switch();h.reject(Error('offline'));await run;
  assert.deepEqual(h.writes.map(w=>w.scope),['A','A']);assert.equal(h.writes[1].plans[0].linkedAlertId,'alert-A');
  assert.deepEqual(h.state.executionPlans,[h.other]);assert.deepEqual(h.notices,[]);
});
