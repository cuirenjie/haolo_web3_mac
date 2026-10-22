import assert from 'node:assert/strict';
import test from 'node:test';
import {pureAnalysisPresentationGroups,revealPureAnalysisReport} from '../src/renderer/pure-analysis-presentation.ts';
import {renderTradingAnswer} from './helpers/trading-answer-presentation.mjs';
import {cloudPlanCardFixture} from './support/cloud-plan-card-fixture.mjs';
import {tradingTranscriptInjectionItems,parseTradingTranscriptMarkerText,withTradingTranscriptItems} from '../src/main/trading-expert-transcript.mjs';

const prefix='trading-price-action-progress-1792584000000-abcdef';
function fixture(legacy=false) {
  return [
    {id:'user',type:'userMessage',text:'@策略:裸K'},
    {id:`${prefix}-1`,type:'agentMessage',phase:'commentary',text:'读取画布',__youleExecutionPlanPresentation:'plain'},
    {id:legacy?'trading-expert-report-1792584000001-abc':`pure-${prefix}-report`,type:'agentMessage',phase:'final_answer',
      text:'完整分析结论与风险说明',__youleCloudReports:[cloudPlanCardFixture()],__youleExecutionPlanPresentation:'execution-plan'},
    {id:`${prefix}-2`,type:'agentMessage',phase:'commentary',text:'正在逐笔绘制分析标注。',__youleExecutionPlanPresentation:'plain'},
    {id:`${prefix}-3`,type:'agentMessage',phase:legacy?'final_answer':'commentary',text:'price-action-ohlc-engine-v1 云端报告和条件校验已完成。',__youleExecutionPlanPresentation:'plain'},
    {id:`${prefix}-4`,type:'agentMessage',phase:legacy?'final_answer':'commentary',text:'BTCUSDT 分析与绘图已完成。',__youleExecutionPlanPresentation:'plain'},
  ];
}
for(const legacy of [false,true]) test(`${legacy?'previous client history':'new pure analysis'} has one report, one process header and no trailing completion bubbles`,()=>{
  const items=fixture(legacy),result=renderTradingAnswer(items);
  assert.deepEqual(result.messages.map(m=>m.id),['user',items[2].id]);
  assert.equal((result.html.match(/class="turn-result-toggle/g)||[]).length,1);
  assert.equal((result.html.match(/class="message-execution-plan execution-plan-surface"/g)||[]).length,1);
  assert.doesNotMatch(result.html,/云端报告和条件校验已完成|分析与绘图已完成/);
  const expanded=renderTradingAnswer(items,{expanded:true});
  assert.match(expanded.html,/正在逐笔绘制分析标注/);assert.equal(expanded.messages.length,items.length);
  assert.equal((expanded.html.match(/class="turn-result-toggle/g)||[]).length,1);
  const live=renderTradingAnswer(items,{complete:false});assert.deepEqual(live.messages.map(m=>m.id),['user',items[2].id]);
  assert.equal(live.messages.some(m=>m.turnResult),false);
});

test('persisted and hydrated previous-client messages fold without changing records or rerunning analysis',()=>{
  const items=fixture(true),records=items.map((item,index)=>({id:item.id,role:item.type==='userMessage'?'user':'assistant',
    text:item.text,phase:item.phase,cloudReports:item.__youleCloudReports,executionPlanPresentation:item.__youleExecutionPlanPresentation,
    createdAt:new Date(1792584000000+index*1000).toISOString()}));
  const parsed=tradingTranscriptInjectionItems(records).map(item=>parseTradingTranscriptMarkerText(item.content[0].text));
  const {thread}=withTradingTranscriptItems({thread:{id:'history',turns:[]}},parsed);
  const hydrated=thread.turns[0].items.map(item=>({...item,turnId:thread.turns[0].id}));
  const before=JSON.stringify(hydrated),rendered=renderTradingAnswer(hydrated);
  assert.deepEqual(rendered.messages.map(m=>m.id),['user',items[2].id]);assert.equal(JSON.stringify(hydrated),before);
});

test('separate requests, ordinary answers, errors, stop notices and attachments are never swallowed',()=>{
  const first=fixture(),notice={id:`${prefix}-notice-5`,type:'agentMessage',phase:'final_answer',text:'已停止绘图',__youleExecutionPlanPresentation:'plain'};
  const result=renderTradingAnswer([...first,notice]);assert.deepEqual(result.messages.map(m=>m.id),['user',first[2].id,notice.id]);
  for(const replacement of ['@策略:裸K 解释原因','@策略:裸K @指标:MACD']) {
    const items=fixture(true);items[0].text=replacement;assert.equal(pureAnalysisPresentationGroups(items).length,0);
  }
  const native=fixture(true);native[2].__youleNativeResponseComplete=false;assert.equal(pureAnalysisPresentationGroups(native).length,0);
  const extra={id:'ordinary-agent-answer',type:'agentMessage',phase:'final_answer',text:'独立问题的回答'};
  assert.ok(renderTradingAnswer([...first,extra]).messages.some(m=>m.id===extra.id));
  const attached={...first[4],attachments:[{name:'requested.txt'}]};
  assert.ok(renderTradingAnswer([...first.slice(0,4),attached]).messages.some(m=>m.id===attached.id));
  const second=fixture().map(item=>({...item,id:item.id.replace(prefix,prefix+'c')}));
  assert.equal(renderTradingAnswer([...first,...second]).messages.filter(m=>m.cloudReports?.length).length,2);
});

test('report reveal emits exact growing Unicode prefixes, yields between updates and stops promptly',async()=>{
  const text='完整报告😀入场条件、风险及失效条件。'.repeat(15),chunks=[],ticks=[];let active=true;
  await revealPureAnalysisReport(text,{isActive:()=>active,onText:value=>chunks.push(value),wait:async ms=>ticks.push(ms)});
  assert.ok(chunks.length>10);assert.equal(chunks.length,ticks.length);assert.ok(chunks.every((value,index)=>text.startsWith(value)&&value.length<text.length&&(!index||value.length>chunks[index-1].length)));
  assert.ok(chunks.every(value=>!/[\uD800-\uDBFF]$/.test(value)));
  assert.ok(ticks.every(ms=>ms===100), '80ms / 0.8 = 100ms: reveal at 80 percent of the previous speed with unchanged chunks');
  const stopped=[];await revealPureAnalysisReport(text,{isActive:()=>active,onText:value=>{stopped.push(value);active=false;},wait:async()=>{}});
  assert.equal(stopped.length,1);
});
