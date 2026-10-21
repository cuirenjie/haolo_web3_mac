import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const main = await fs.readFile(new URL('../src/renderer/main.ts', import.meta.url), 'utf8');
const market = await fs.readFile(new URL('../src/renderer/trading-expert-market.ts', import.meta.url), 'utf8');
function functions(source, names) {
  const ast = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
  const declarations = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text));
  assert.equal(declarations.length, names.length);
  return ts.transpileModule(declarations.map(n => n.getText(ast).replace(/^export /, '')).join('\n'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
const normalizeCode = functions(market, ['tradingViewResolution','tradingPeriodFromResolution','tradingAlertIntervalFromResolution','tradingResolutionFromAlertInterval']);
const { tradingResolutionFromAlertInterval, tradingAlertIntervalFromResolution } = new Function(normalizeCode + ';return {tradingResolutionFromAlertInterval,tradingAlertIntervalFromResolution};')();
const captureCode = functions(main, ['captureExternalTradingChartAttachment']);

function fixture({ channel='wechat', interval='60', ready=true, duringCapture, onFrame }={}) {
  const threadId = `${channel}-test`, state = {currentThreadId:threadId,tradingExpertChartFocusMode:false,leftCollapsed:false,rightCollapsed:false,tradingExpertChartCollapsed:false,externalChannels:{menuOpen:false}};
  let chart = {marketId:'BINANCE:FUTURES:SNDKUSDT',interval:tradingAlertIntervalFromResolution(interval),resolution:interval};
  const calls={capture:0,render:0,restore:0,frames:0,rejections:[]};
  const deps={
    state, isExternalTradingWorkspaceThreadId: id=>id===threadId, hasTradingExpertCurrentAnalysis:()=>true,
    tradingResolutionFromAlertInterval, tradingExpertAlertContextSnapshot:()=>chart,
    root:{querySelector:()=>({getBoundingClientRect:()=>({left:20,top:30,width:900,height:650})})},
    window:{requestAnimationFrame:fn=>queueMicrotask(()=>{calls.frames++;onFrame?.(calls.frames,state,chart);fn();}),
      codexDesktop:{captureTradingChart:async params=>{calls.capture++;assert.deepEqual(params.rect,{x:20,y:30,width:900,height:650});duringCapture?.(state,chart);return {ok:true,path:'kline.png'};}}},
    prepareTradingExpertMarketForExternalCapture:()=>ready,waitMs:async()=>{},
    render:()=>calls.render++,restoreTradingExpertChartFocusLayout:()=>{calls.restore++;state.tradingExpertChartFocusMode=false;},
    externalTradingChartCaptureAttachment:result=>result,
    wechatDebugLog:(event,payload)=>calls.rejections.push({event,...payload}),
  };
  const capture=new Function(...Object.keys(deps), 'let tradingExpertChartFocusRestoreState;\n'+captureCode+';return captureExternalTradingChartAttachment;')(...Object.values(deps));
  return {capture,threadId,state,chart,calls};
}

for (const channel of ['wechat','feishu','telegram']) test(`${channel}: analysis resolutions and alert intervals capture the same chart`, async()=>{
  for (const interval of ['1','15','60','240','1D','1W','1M','12M','30S']) {
    const f=fixture({channel,interval});
    const result=await f.capture(f.threadId,false,{marketId:f.chart.marketId,interval});
    assert.equal(result?.path,'kline.png',`${interval} / ${f.chart.interval}`);
    assert.equal(f.calls.capture,1);assert.equal(f.calls.restore,1);assert.equal(f.state.tradingExpertChartFocusMode,false);
  }
});

test('a different symbol, actual period, month versus minute, or conversation still blocks capture',async()=>{
  for (const target of [{marketId:'BINANCE:FUTURES:BTCUSDT',interval:'60'},{marketId:'BINANCE:FUTURES:SNDKUSDT',interval:'240'}]) {
    const f=fixture();assert.equal(await f.capture(f.threadId,false,target),null);assert.equal(f.calls.capture,0);
  }
  const month=fixture({interval:'1M'});assert.equal(await month.capture(month.threadId,false,{interval:'1m'}),null);
  const other=fixture();assert.equal(await other.capture('another-thread',false,{interval:'60'}),null);
});

test('chart changes during focus resize or native capture cannot attach a foreign image',async()=>{
  for(const frame of [1,3]) {
    const f=fixture({onFrame:(n,_state,chart)=>{if(n===frame)chart.resolution='240';}});
    assert.equal(await f.capture(f.threadId,false,{interval:'60'}),null);assert.equal(f.calls.capture,0);assert.equal(f.calls.restore,1);
  }
  const f=fixture({duringCapture:state=>{state.currentThreadId='other-thread';}});
  assert.equal(await f.capture(f.threadId,false,{interval:'60'}),null);assert.equal(f.calls.capture,1);assert.equal(f.calls.restore,0);
});

test('an unready chart is not sent as a successful empty screenshot and focus layout is restored',async()=>{
  const f=fixture({ready:false});assert.equal(await f.capture(f.threadId,false,{interval:'60'}),null);
  assert.equal(f.calls.capture,0);assert.equal(f.calls.restore,1);assert.equal(f.calls.rejections[0].reason,'chart-not-ready');
});
