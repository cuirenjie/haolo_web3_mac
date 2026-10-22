import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import {setup} from './helpers/cloud-renderer-harness.mjs';
import {OFFICIAL_TRADING_CATALOG} from '../src/shared/official-trading-catalog.mjs';
import {cloudMarketContext} from '../src/main/trading-strategy-runtime/cloud-runtime.mjs';
import {captureCloudAnalysisPanes} from '../src/renderer/cloud-analysis-panes.ts';
import {TRADING_INDICATORS,calculateTradingIndicator} from '../src/renderer/trading-expert-indicators.ts';
import {calculateTradingVolumeProfile} from '../src/renderer/trading-volume-profile.ts';
import {computeSma,computeEma,computeBbi,computeBollingerBands,computeTdSequential,atm1TrendCandles,atm4MaBand} from '../src/renderer/trading-expert-market.ts';

const intervals={'1':'1m','3':'3m','5':'5m','15':'15m','30':'30m','60':'1h','120':'2h','240':'4h','360':'6h','480':'8h','720':'12h','1D':'1d','1W':'1w'};
function target(symbol,interval,paneIndex) {
  return {paneIndex,interval,market:{id:`BINANCE:FUTURES:${symbol}`,symbol,baseAsset:symbol.replace('USDT',''),quoteAsset:'USDT',provider:'binance',marketType:'perpetual'},
    candles:Array.from({length:100},(_,i)=>({time:1700000000+i*600,open:10,high:12,low:9,close:11,volume:100}))};
}
function layout(s,targets) {
  const first=targets[0];Object.assign(s.workspace,{markets:targets.map(t=>t.market),selectedMarketMeta:first.market,selectedSymbol:first.market.symbol,selectedMarketId:first.market.id,
    loadedMarketId:first.market.id,loadedInterval:first.interval,activeInterval:first.interval,candles:first.candles,
    splitPanes:targets.slice(1).map(t=>({cloudAnalysisSnapshot:()=>t}))});
}
for(const [index,{id}] of OFFICIAL_TRADING_CATALOG.entries())for(const [interval,cloudInterval] of Object.entries(intervals)) {
  test(`${id}: frozen four-chart routing ${interval} across assets and same-asset periods`,async()=>{
    const s=setup({dependencyOverrides:{activeTradingAnalysisLanguage:()=>['zh-CN','en','zh-Hant'][index%3]}});
    const targets=[target('BTCUSDT',interval,0),target('ETHUSDT','240',1),target('SOLUSDT','1D',2),target('BTCUSDT',interval==='1'?'1W':'1',3)];
    layout(s,targets);
    const captured=s.workspace.captureAnalysisTaskTarget();
    // Classification waits while the user changes layout, market and chat.
    targets[1].market.symbol='CHANGED';targets[1].interval='1W';targets[1].candles[0].time=1;
    s.workspace.splitPanes=[{cloudAnalysisSnapshot:()=>{throw Error('must not read the new chart');}}];
    s.workspace.activeInterval='1M';s.workspace.drawingStorageSessionId='different-chat';
    await s.workspace.runGeneralConversation({analysisId:`test-${id}-${interval}`,sourceThreadId:'sent-chat',instruction:'analyze',analysisTarget:captured},id);
    assert.equal(s.calls.length,4);
    assert.equal(cloudMarketContext(s.calls[0]).interval,cloudInterval);
    for(const [pane,call] of s.calls.entries()) {
      assert.equal(call.marketId,pane===0?captured.marketId:captured.splitPanes.snapshots[pane-1].market.id);
      assert.equal(call.interval,pane===0?interval:captured.splitPanes.snapshots[pane-1].interval);
      assert.equal(call.sourceThreadId,'sent-chat');assert.equal(call.storageSessionId,'original-thread');
      assert.ok(call.analysisWindowCount>=(['order-flow','dow-theory'].includes(id)?120:100));
      assert.equal(call.candles,undefined);
      if(id==='vpvr-analysis')assert.equal(call.visibleRange.visibleFrom,1700000000000);
      assert.ok(s.drawings.some(d=>d.pane===pane&&d.patch.marketId===call.marketId&&d.patch.interval===call.interval));
      assert.ok(s.indicatorDrawings.some(d=>d.pane===pane&&d.patch.marketId===call.marketId&&d.patch.interval===call.interval));
    }
    assert.deepEqual(s.failed,[]);assert.equal(s.finished.length,1);
  });
}

for(const [language,message] of [
  ['zh-CN','此分屏的行情快照尚未就绪。'],
  ['en','This chart snapshot is not ready.'],
  ['zh-TW','此分屏的行情快照尚未就緒。'],
])test(`a missing captured pane is localized while the other captured panes finish: ${language}`,async()=>{
  let split;
  const s=setup({dependencyOverrides:{activeTradingAnalysisLanguage:()=>language,
    combineTradingAnalysisReports:(_heading,report,result)=>{split=result;return report;}}});
  layout(s,[target('BTCUSDT','15',0),target('ETHUSDT','240',1),target('SOLUSDT','1D',2)]);
  s.workspace.splitPanes[0]={cloudAnalysisSnapshot:()=>{throw Error('Chart snapshot unavailable');}};
  const captured=s.workspace.captureAnalysisTaskTarget();
  await s.workspace.runOrderFlowConversation({instruction:'analyze',analysisTarget:captured});
  assert.deepEqual(s.calls.map(c=>c.marketId),['BINANCE:FUTURES:BTCUSDT','BINANCE:FUTURES:SOLUSDT']);
  assert.equal(split.completed,1);assert.equal(split.failed,1);assert.equal(split.failures[0].paneIndex,1);
  assert.equal(split.failures[0].message,message);
  assert.deepEqual(s.failed,[]);assert.equal(s.finished.length,1);
  assert.deepEqual(s.drawings.map(d=>d.pane),[0,2]);
});

test('a failed split analysis does not lose the primary report or other pane result',async()=>{
  let split;
  const s=setup({runAnalysis:async body=>{
    if(body.interval==='240')return {ok:false,error:{code:'MARKET_HISTORY_INSUFFICIENT',message:'Insufficient history'}};
    return {ok:true,analysisPlan:{report:'valid report',drawingPatch:{marketId:body.marketId,interval:body.interval,operations:[]}},model:{modelId:'server'}};
  },dependencyOverrides:{combineTradingAnalysisReports:(_heading,report,result)=>{split=result;return report;}}});
  layout(s,[target('BTCUSDT','15',0),target('ETHUSDT','240',1),target('SOLUSDT','1D',2)]);
  const result=await s.workspace.runGeneralConversation({instruction:'analyze',analysisTarget:s.workspace.captureAnalysisTaskTarget()},'chan');
  assert.equal(result.report,'valid report');assert.equal(split.completed,1);assert.equal(split.failed,1);
  assert.match(split.failures[0].message,/not enough cloud candles/);
  assert.deepEqual(s.drawings.map(d=>d.pane),[0,2]);assert.deepEqual(s.failed,[]);
});

test('captured panes own deeply frozen copies and preserve their original viewport',()=>{
  const snapshot=target('龙虾USDT','1W',2),captured=captureCloudAnalysisPanes([{cloudAnalysisSnapshot:()=>snapshot}],String);
  assert.notEqual(captured.snapshots[0],snapshot);assert.ok(Object.isFrozen(captured.snapshots[0].candles[0]));
  assert.throws(()=>{captured.snapshots[0].market.symbol='other';},TypeError);
  snapshot.candles.length=0;assert.equal(captured.snapshots[0].candles.length,100);
});

for(const language of ['zh-CN','en','zh-Hant'])test(`a split drawing failure preserves the successful cloud report: ${language}`,async()=>{
  let split;
  const s=setup({dependencyOverrides:{activeTradingAnalysisLanguage:()=>language,
    commitTradingAnalysisDrawingPatch:async(_job,_patch,pane)=>{if(pane===1)throw Error('drawing storage failed');},
    combineTradingAnalysisReports:(_heading,report,result)=>{split=result;return report;}}});
  layout(s,[target('BTCUSDT','15',0),target('ETHUSDT','240',1),target('SOLUSDT','1D',2)]);
  await s.workspace.runGeneralConversation({instruction:'analyze',analysisTarget:s.workspace.captureAnalysisTaskTarget()},'wave');
  assert.equal(split.completed,2);assert.equal(split.failed,0);
  assert.match(split.reports.find(r=>r.paneIndex===1).report,/Canonical server report/);
  assert.match(split.reports.find(r=>r.paneIndex===1).report,language==='en'?/chart drawing did not complete/:language==='zh-Hant'?/圖表繪製未完成/:/图表绘制未完成/);
});

test('spot, Unicode and small-price identities keep their exact market; calendar views stay view-only',()=>{
  for(const [kind,symbol] of [['SPOT','ETHBTC'],['FUTURES','龙虾USDT'],['FUTURES','1000PEPEUSDT']]) {
    assert.equal(cloudMarketContext({marketId:`BINANCE:${kind}:${symbol}`,interval:'1W'}).marketKey,`binance:${kind==='SPOT'?'spot':'usdm'}:${symbol}`);
  }
  for(const interval of ['1M','12M','1Y','1y'])assert.throws(()=>cloudMarketContext({marketId:'BINANCE:FUTURES:BTCUSDT',interval}),e=>e.code==='CLOUD_MARKET_UNSUPPORTED');
});

test('actual drawing commit persists a closed or changed split to its original namespace',async()=>{
  const source=fs.readFileSync(new URL('../src/renderer/trading-expert-market.ts',import.meta.url),'utf8');
  const ast=ts.createSourceFile('market.ts',source,ts.ScriptTarget.Latest,true);
  const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='commitTradingAnalysisDrawingPatch');
  const code=ts.transpileModule(node.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  for(const visible of [false,true]) {
    const saved=[],applied=[];
    const job={analysisId:'job',drawingTurnId:'chat-turn',storageSessionId:'original',status:'running',marketId:'BTC',interval:'15',language:'en'};
    const patch={marketId:'ETH',interval:'240',operations:[]};
    const deps={tradingAnalysisJobs:{get:()=>job},localizeTradingAiDrawingPatch:x=>x,translateAppText:x=>x,
      activeWorkspace:{drawingStorageSessionMatches:x=>x==='original',analysisDrawingTargetMatches:()=>visible,
        acceptAnalysisDrawingPatch:async(p,pane)=>{applied.push(pane);return true;},storeAnalysisDrawingPatch:()=>{}},
      tradingSplitPaneDrawingStorageSessionId:(id,pane)=>`${id}::split-pane:${pane}`,persistTradingAiDrawingPatch:(id,p)=>saved.push({id,p})};
    const commit=Function(...Object.keys(deps),code+';return commitTradingAnalysisDrawingPatch;')(...Object.values(deps));
    await commit(job,patch,2);
    assert.deepEqual(saved,[{id:'original::split-pane:2',p:{...patch,drawingTurnId:'chat-turn'}}]);assert.deepEqual(applied,visible?[2]:[]);
  }
});

for(const scale of [0.00001,100,80000])for(const interval of Object.keys(intervals))test(`all chart studies remain finite and aligned at price ${scale}, period ${interval}`,()=>{
  const minutes=interval==='1D'?1440:interval==='1W'?10080:Number(interval);
  const candles=Array.from({length:240},(_,i)=>{const close=scale*(1+.01*Math.sin(i/7)+i*.0001);return {time:1700000000+i*minutes*60,open:close*.999,high:close*1.002,low:close*.998,close,volume:100+i};});
  const original=structuredClone(candles),values=candles.map(c=>c.close);
  for(const {id} of TRADING_INDICATORS)for(const series of calculateTradingIndicator(id,candles).series){
    assert.equal(series.values.length,candles.length,id);assert.ok(series.values.slice(-20).every(Number.isFinite),id);
  }
  for(const series of [computeSma(values,60),computeEma(values,60),computeBbi(values)])assert.ok(series.slice(-20).every(Number.isFinite));
  const boll=computeBollingerBands(values);assert.ok(boll.upper.slice(-20).every(Number.isFinite));assert.ok(boll.lower.slice(-20).every(Number.isFinite));
  const td=computeTdSequential(candles);assert.ok(td.length>0);assert.ok(td.every(signal=>signal.count>=1&&signal.count<=9&&signal.index>=4&&signal.index<candles.length));
  assert.equal(atm1TrendCandles(candles).length,candles.length);
  const band=atm4MaBand(candles);assert.ok(band.slice(-20).every(x=>Number.isFinite(x.bandUpper)&&x.bandUpper>=x.bandLower));
  const profile=calculateTradingVolumeProfile(candles);assert.ok(profile.rows.length>0);assert.ok(profile.rows.every(r=>Number.isFinite(r.volume)&&r.priceHigh>=r.priceLow));
  assert.deepEqual(candles,original);
});
