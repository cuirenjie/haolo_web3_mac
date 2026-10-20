import {cloudAnalysisText} from '../../src/renderer/cloud-analysis-text.ts';
import {tradingMarketAvailable,tradingMarketUnavailableMessage} from '../../src/shared/trading-market-availability.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {cloudAnalysisWindow} from '../../src/renderer/cloud-analysis-window.ts';
import {captureCloudAnalysisPanes} from '../../src/renderer/cloud-analysis-panes.ts';
import {settleTradingAnalysisDrawing,describeTradingAnalysisFailure} from '../../src/main/trading-analysis/failure.mjs';
import {selectTradingAnalysisMarket,selectTradingAnalysisInterval} from '../../src/renderer/trading-analysis-target.mjs';
const source=fs.readFileSync(new URL('../../src/renderer/trading-expert-market.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('market.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const methods=[];
function visit(node) {
  if(ts.isMethodDeclaration(node)&&['runGeneralConversation','runChanConversation','runWaveConversation','runWyckoffConversation','runOrderFlowConversation','runSplitPaneAnalyses','captureSplitPaneAnalysisSnapshots','captureAnalysisTaskTarget'].includes(node.name.getText(ast)))methods.push(node.getText(ast));
  ts.forEachChild(node,visit);
}visit(ast);
const compiled=ts.transpileModule(`class Harness {${methods.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const market={id:'BINANCE:FUTURES:BTCUSDT',symbol:'BTCUSDT',baseAsset:'BTC',quoteAsset:'USDT',provider:'binance',marketType:'perpetual'};
export function setup({apiFailure=false,runAnalysis,dependencyOverrides={}}={}) {
  const calls=[],drawings=[],indicatorDrawings=[],finished=[],failed=[];
  const api=async body=>{calls.push(body);if(runAnalysis)return runAnalysis(body);return apiFailure?{ok:false,error:{code:'ENTRY_WORKER_UNAVAILABLE',message:'offline'}}:
    {ok:true,snapshot:{candles:Array(84),orderFlow:{trades:Array(12)}},analysisPlan:{report:'Canonical server report',narrative:'Server conclusion',drawingPatch:{marketId:body.marketId,interval:body.interval,operations:[]},indicatorDrawingPatch:{marketId:body.marketId,interval:body.interval,indicatorId:'rsi',operations:[]}},model:{modelId:'server-model'}};};
  const dependencies={describeTradingAnalysisFailure,captureCloudAnalysisPanes,tradingMarketAvailable,tradingMarketUnavailableMessage,cloudAnalysisText,window:{codexDesktop:{runTradingStrategyAnalysis:api,runTradingGeneralAnalysis:api}},cloudAnalysisWindow,
    selectTradingAnalysisMarket,selectTradingAnalysisInterval,marketFromFavoriteRecord:x=>x,visibleCandlesInLogicalRange:x=>x,
    tradingViewResolutionDurationMs:()=>60000,tradingPeriodLabelForResolution:x=>x,activeTradingAnalysisLanguage:()=> 'en',tradingFavoriteRecord:x=>x,
    tradingAnalysisJobs:{start:x=>({...x,analysisId:x.analysisId||'test-job'}),isActive:()=>true,complete:id=>finished.push(id),fail:(id,e)=>failed.push(e.code)},
    tradingAnalysisModelDisplayName:model=>model.modelId,settleTradingAnalysisDrawing,
    commitTradingAnalysisDrawingPatch:async(job,patch,pane)=>drawings.push({job,patch,pane}),commitTradingIndicatorAnalysisDrawingPatch:async(job,patch,pane=0)=>indicatorDrawings.push({job,patch,pane}),
    cloudAnalysisDrawingPlan,cloudReportFromResponse:()=>[],rememberTradingAnalysisJobContext:()=>{},recordTradingRendererFailure:()=>{},
    tradingAnalysisPaneHeading:(market,interval)=>`${market.id} ${interval}`,combineTradingAnalysisReports:(_heading,report)=>report,combineTradingAnalysisNarratives:(_heading,report)=>report};
  Object.assign(dependencies,dependencyOverrides);
  const Harness=Function(...Object.keys(dependencies),compiled+';return Harness;')(...Object.values(dependencies));
  const workspace=new Harness();Object.assign(workspace,{markets:[market],selectedMarketMeta:market,selectedSymbol:'BTCUSDT',selectedMarketId:market.id,
    loadedMarketId:market.id,loadedInterval:'60',activeInterval:'60',drawingStorageSessionId:'original-thread',candles:[],
    splitPanes:[{cloudAnalysisSnapshot:()=>({paneIndex:1,market:{...market,id:'BINANCE:FUTURES:ETHUSDT',symbol:'ETHUSDT'},interval:'240',candles:[]})}],splitPaneSelections:new Map(),
    loadMarkets:()=>{throw Error('must not fetch local market data');},refreshCurrentMarketSnapshotForAnalysis:()=>{throw Error('must not refresh local candles');}});
  return {workspace,calls,drawings,indicatorDrawings,finished,failed};
}
import {cloudAnalysisDrawingPlan} from '../../src/shared/execution-plan-drawings.mjs';
