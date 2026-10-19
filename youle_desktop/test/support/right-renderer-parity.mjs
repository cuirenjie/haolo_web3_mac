import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import * as plans from '../../src/renderer/execution-plans.ts';
import * as view from '../../src/main/execution-plan-card-view.mjs';
import * as cloud from '../../src/main/cloud-plan-contract.mjs';

const names=['renderMessageExecutionPlan','renderExecutionPlanCardContent','renderAddToPlanAction','executionPlanCandidateKey'];
function compile(file) {
  const source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
  const functions=names.map(name=>{const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(node,name);return node.getText(ast);});
  return ts.transpileModule(functions.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
}
const current=compile(new URL('../../src/renderer/main.ts',import.meta.url));
const original=process.env.HAOLO_RIGHT_BASELINE_ROOT?compile(path.join(process.env.HAOLO_RIGHT_BASELINE_ROOT,'youle_desktop/src/renderer/main.ts')):null;
function harness(source,language) {
  const candidates=new Map(),escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const deps={...plans,...view,...cloud,state:{settings:{language},executionPlans:[]},executionPlanCandidatesBySource:candidates,
    escapeHtml:escape,escapeAttr:escape,formatMessageText:escape,syncExecutionPlansForCurrentAccount:()=>{},
    loadMessageExecutionPlanFontSize:()=>13,MESSAGE_EXECUTION_PLAN_FONT_SIZES:[11,12,13,14,16,18,20]};
  return Function(...Object.keys(deps),source+`;return {${names.join(',')},candidates:executionPlanCandidatesBySource};`)(...Object.values(deps));
}
export function renderCurrentReports(reports) {
  const runtime=harness(current,reports[0].locale==='zh-Hant'?'zh-TW':reports[0].locale);
  const message={id:'mixed-message',conversation_id:'mixed-thread',cloudReports:reports,executionPlanPresentation:'execution-plan'};
  const text=reports.map(report=>report.report).join('\n\n---\n\n');
  return {rendered:runtime.renderMessageExecutionPlan(message,text),actions:runtime.renderAddToPlanAction(message,text),bindings:[...runtime.candidates]};
}
export function verifyRendererParity(report) {
  if(!original)return;
  const reports=Array.isArray(report)?report:[report],text=reports.map(row=>row.report).join('\n\n---\n\n');
  const language=reports[0].locale==='zh-Hant'?'zh-TW':reports[0].locale;
  const before=harness(original,language),after=harness(current,language);
  for(const executionPlanPresentation of [undefined,'execution-plan','plain']) {
    const message={id:'original-message',conversation_id:'original-thread',executionPlanPresentation};
    assert.deepEqual(after.renderMessageExecutionPlan({...message,cloudReports:reports},text),
      before.renderMessageExecutionPlan(message,text),'original message card markup and report partitions');
    assert.equal(after.renderAddToPlanAction({...message,cloudReports:reports},text),
      before.renderAddToPlanAction(message,text),'original add-plan actions');
  }
}
