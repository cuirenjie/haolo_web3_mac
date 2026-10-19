import { app, BrowserWindow } from 'electron/main';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PRIORITY_INDICES} from '../src/shared/market-index-catalog.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'output/index-charts-20261019');
app.setPath('userData',path.join(output,'profile')); app.disableHardwareAcceleration();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let server,win; const report={checks:[],screenshots:[],status:'pending'};
async function main(){
try {
 await mkdir(output,{recursive:true});
 const data=JSON.parse(await readFile(process.env.HAOLO_CHART_FIXTURES,'utf8'));
 server=await createServer({configFile:false,root:path.join(root,'src/renderer'),server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root]}},clearScreen:false});
 await server.listen(); await app.whenReady();
 win=new BrowserWindow({show:false,width:1440,height:1080,webPreferences:{partition:'index-charts-isolated',offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:true}});
 const errors=[];win.webContents.on('console-message',(_e,_l,message)=>{if(/Uncaught|ResizeObserver loop/.test(message))errors.push(message);});
 const js=async s=>{try{return await win.webContents.executeJavaScript(`(async()=>{${s}})()`,true);}catch(e){throw Error(s.slice(0,250)+' :: '+e.message);}};
 const until=async expression=>{for(let i=0;i<100;i++){if(await js(`return ${expression}`))return;await sleep(50);}throw Error('Timed out: '+expression);};
 await win.loadURL(`${server.resolvedUrls.local[0]}@fs/${path.join(root,'test/fixtures/trading-watchlist.html').replaceAll('\\','/')}`);
 await until('window.ready===true');
 await js(`window.chartFixture=${JSON.stringify(data)};
 window.codexDesktop.getPublicMarketIndices=async()=>structuredClone(chartFixture.snapshot);
 window.chartCalls=[];window.chartFailure=false;window.delayHour=false;
 window.codexDesktop.getIndexChart=async p=>{chartCalls.push(p);if(chartFailure)throw Error('transport failure');
 const chart=chartFixture.charts[p.indexId];
 if(!p.period)return structuredClone(chart.capabilities);
 if(delayHour&&p.period==='1h')await new Promise(r=>window.finishHour=r);
 return structuredClone(p.before?chartFixture.olderGold:chart.periods[p.period]);};
 window.baseIndexChart=window.codexDesktop.getIndexChart;
 await workspace.watchlistPanel.indices.refresh();workspace.watchlist.selectGroup('indices');workspace.watchlistPanel.refresh();`);

 await js('window.originalChart=workspace.chart;window.originalCanvas=workspace.chartElement.querySelector("canvas")');
 const open=async id=>{await js(`document.querySelector('[data-index-id="${id}"]').click()`);await until(`workspace.loadedMarketId==='${id}'&&workspace.candles.length>0&&!workspace.indexLoading&&!workspace.marketLoading`);};
 for(const language of ['zh-CN','en','zh-TW'])for(const theme of ['light','dark']){
  await js(`qaSetLanguage('${language}');document.documentElement.dataset.theme='${theme}'`);
  assert.equal(await js('return document.querySelectorAll("[data-watchlist-index]").length'),data.snapshot.indices.length);
  for (const action of ['sort-price','sort-change']) {
   await js(`document.querySelector('[data-watchlist-action="${action}"]').click()`);
   assert.deepEqual(await js('return [...document.querySelectorAll("[data-watchlist-index]")].slice(0,9).map(r=>r.dataset.watchlistIndex)'),PRIORITY_INDICES.map(i=>i.id));
  }
  if(language==='en')assert.doesNotMatch(await js('return document.querySelector("[data-watchlist-host]").textContent'),/[\u4e00-\u9fff]/);
  await open('index:gold');
  assert.equal(await js('return workspace.candles.length'),300);
  assert.equal(await js('return workspace.chart===originalChart&&workspace.chartElement.querySelector("canvas")===originalCanvas'),true);
  assert.deepEqual(await js('return workspace.displayedOrderLines()'),[]);
  assert.equal(await js('return document.querySelectorAll(\'.trading-market-favorite-ticker[data-market-id="index:gold"].selected\').length'),1);
  assert.equal(await js('return ["toggle-period-editor","open-split-layouts","open-chart-settings"].every(action=>{const b=document.querySelector(`[data-market-action="${action}"]`);return b&&getComputedStyle(b).display!=="none"})'),true);
  assert.equal(await js('return getComputedStyle(document.querySelector(".trading-market-symbol [data-market-logo-shell]")).display!=="none"'),true);
  assert.equal(await js('return document.querySelectorAll(".trading-index-dialog,dialog[open]").length'),0);
  assert.doesNotMatch(await js('return document.body.innerHTML'),/aicoin|accesssecret|signature/i);
  assert.doesNotMatch(await js('return document.querySelector("[data-watchlist-host]").textContent'),/按源更新|Source cadence|按源更新/);
  assert.equal(await js('return document.querySelector(\'[data-watchlist-index="index:gold"] small\')===null'),true);
  assert.equal(await js('return document.querySelector("[data-index-chart-status]")'),null);
  await js('document.querySelector(\'[data-market-action="toggle-period-editor"]\').click()');
  assert.equal(await js('return !workspace.periodEditor.hidden&&workspace.primaryPeriodMenu.hidden'),true);
  assert.equal(await js('return workspace.periodEditor.querySelectorAll("[data-market-period-item]").length'),7);
  await sleep(100);const editorFile=path.join(output,`period-editor-${language}-${theme}.png`);
  await writeFile(editorFile,(await win.webContents.capturePage()).toPNG());report.screenshots.push(editorFile);
  await js('workspace.setPeriodEditorOpen(false)');
  await sleep(150);const file=path.join(output,`main-chart-${language}-${theme}.png`);
  await writeFile(file,(await win.webContents.capturePage()).toPNG());report.screenshots.push(file);
  report.checks.push(`${language}/${theme}: same original canvas, no modal, real OHLC and neutral UI`);
 }
 for(const id of Object.keys(data.charts)){
  await open(id);
  assert.deepEqual(await js('return workspace.indexPeriods'),data.charts[id].capabilities.periods);
 }
 report.checks.push('Nine list entries switch main chart; AHR999 daily/weekly only');
 await open('index:btc-ahr999');
 await js('workspace.periodControls.style.width="90px";workspace.syncPeriodOverflow()');
 assert.equal(await js('return workspace.overflowPeriods.every(p=>["d","w"].includes(p.unit))'),true);
 await js('document.querySelector(\'[data-market-action="toggle-period-editor"]\').click()');
 assert.equal(await js('return !workspace.periodEditor.hidden&&workspace.primaryPeriodMenu.hidden'),true);
 assert.deepEqual(await js('return [...workspace.periodItems.children].map(b=>b.dataset.marketPeriodResolution)'),['1D','1W']);
 // Real editor actions must preserve supported periods and ordinary settings.
 await js('window.savedOrdinaryPeriods=JSON.stringify(workspace.periods);window.callsBeforeInvalid=chartCalls.length;workspace.periodAmountInput.value="2";workspace.periodUnit="h";document.querySelector(\'[data-market-action="add-period"]\').click()');
 assert.equal(await js('return workspace.periodStatus.dataset.tone'), 'error');
 assert.equal(await js('return chartCalls.length===callsBeforeInvalid'),true);
 await js('workspace.periodItems.querySelector(\'[data-market-action="remove-period"][data-market-period-resolution="1D"]\').click()');
 await until('workspace.loadedInterval==="1W"&&!workspace.marketLoading');
 assert.deepEqual(await js('return workspace.visiblePeriods()'),[{amount:1,unit:'w'}]);
 await js('workspace.periodAmountInput.value="1";document.querySelector(\'[data-market-action="period-unit"][data-market-period-unit="d"]\').click();document.querySelector(\'[data-market-action="add-period"]\').click()');
 assert.deepEqual(await js('return workspace.visiblePeriods()'),[{amount:1,unit:'w'},{amount:1,unit:'d'}]);
 // Commit the same reordered DOM used by the pointer drag controller.
 await js('workspace.periodItems.prepend(workspace.periodItems.lastElementChild);workspace.finishPeriodPointerDrag(true);workspace.indexPeriodPreferences.clear()');
 assert.deepEqual(await js('return workspace.visiblePeriods()'),[{amount:1,unit:'d'},{amount:1,unit:'w'}]);
 assert.equal(await js('return JSON.stringify(workspace.periods)===savedOrdinaryPeriods'),true);
 await js('workspace.setPeriodEditorOpen(false);document.querySelector(\'[data-market-action="open-split-layouts"]\').click()');
 assert.equal(await js('return !workspace.layoutPicker.hidden'),true);
 await js('workspace.setLayoutPickerOpen(false)');
 await js('workspace.periodControls.style.width="";qaSetLanguage("en")');await sleep(100);
 assert.doesNotMatch(await js('return document.querySelector("[data-market-symbol]").textContent'),/[\u4e00-\u9fff]/);
 report.checks.push('Shared full period editor in six locale/theme combinations; supported add/remove/reorder persisted per index; unsupported period makes no request; ordinary settings isolated; footer absent');
 await open('index:gold');await js('await workspace.loadMoreHistory()');
 assert.equal(await js('return workspace.candles.length'),600);
 await js('window.delayHour=true;workspace.activeInterval="60";void workspace.restartMarketData()');
 await until('typeof finishHour==="function"');
 await js('workspace.activeInterval="1W";void workspace.restartMarketData()');
 await until('workspace.loadedInterval==="1W"&&workspace.candles.length===300&&!workspace.indexLoading');
 await js('finishHour()');await sleep(100);
 assert.equal(await js('return workspace.loadedInterval'),'1W');
 await js('window.chartFailure=true;await workspace.refreshIndexData()');
 assert.equal(await js('return workspace.candles.length'),300);
 assert.match(await js('return workspace.chartElement.getAttribute("aria-description")'),/延遲|延迟|Delayed/);
 assert.equal(await js('return document.querySelector("[data-index-chart-status]")'),null);
 await js('window.chartFailure=false;window.codexDesktop.getIndexChart=async p=>({indexId:p.indexId,periods:[],status:"empty"});await workspace.selectIndex(chartFixture.snapshot.indices[0])');
 assert.equal(await js('return workspace.candles.length'),0);
 assert.match(await js('return workspace.errorElement.textContent'),/暂无|暫無|No history/);
 await js('workspace.activeInterval="60";workspace.openDefaultPerpetualMarket()');await until('!workspace.selectedIndex&&workspace.candles.length>0');
 assert.equal(await js('return workspace.selectedMarketId.startsWith("BINANCE:")'),true);
 assert.equal(await js('return workspace.chart===originalChart'),true);
 assert.equal(await js('return document.querySelectorAll(".trading-index-dialog").length'),0);
 assert.equal(await js('return window.qaError||""'),'');assert.deepEqual(errors,[]);
 report.checks.push('History paging; late response isolation; stale preservation; honest empty state; return to trading pair on same chart');

 // Exercise the actual title-bar clicks with very different price scales, delayed
 // responses, and gateway cache fallback. This catches identity/RAF regressions.
 await js(`window.delayHour=false;window.codexDesktop.getIndexChart=baseIndexChart;
 window.baseMarketData=codexDesktop.getBinancePublicMarketData;window.marketRequests=[];
 codexDesktop.getBinancePublicMarketData=async request=>{
   if(request.path.endsWith('/ticker/24hr')&&request.parameters.symbol==='LOBSTERUSDT')return {ok:true,status:200,data:{symbol:'LOBSTERUSDT',lastPrice:'0.02',openPrice:'0.019',priceChangePercent:'5.26',quoteVolume:'10000000'}};
   if(!request.path.endsWith('/klines'))return baseMarketData(request);
   marketRequests.push(structuredClone(request));
   const interval=request.parameters.interval,match=String(interval).match(/^(\\d+)([mhdw])$/);
   const step=match?Number(match[1])*({m:60000,h:3600000,d:86400000,w:604800000}[match[2]]):3600000;
   const end=Math.floor(Date.now()/step)*step,base=request.parameters.symbol==='LOBSTERUSDT'?0.02:81000;
   const data=Array.from({length:300},(_,i)=>{const o=base*(1+Math.sin(i/9)*0.01),c=o*1.0002;
     return [end-(299-i)*step,String(o),String(c*1.001),String(o*0.999),String(c),'100',end-(298-i)*step-1,'0',1,'0','0','0'];});
   if(window.holdMarket===request.parameters.symbol)await new Promise(r=>window.releaseMarket=r);
   return {ok:true,status:200,stale:true,data};
 };
 const low={...qaMarkets.find(m=>m.symbol==='ALPINEUSDT'&&m.marketType==='perpetual'),id:'BINANCE:FUTURES:LOBSTERUSDT',symbol:'LOBSTERUSDT',baseAsset:'LOBSTER',displaySymbol:'LOBSTER/USDT',markPrice:0.02};
 workspace.markets.push(low);
 if(!workspace.isMarketFavorite(low))workspace.toggleFavoriteMarket(low);
 workspace.activeInterval='60';`);
 const lowId='BINANCE:FUTURES:LOBSTERUSDT',btcId='BINANCE:FUTURES:BTCUSDT';
 const favorite=async id=>js(`document.querySelector('.trading-market-favorite-ticker[data-market-id="${id}"]').click()`);
 const marketReady=async id=>until(`workspace.loadedMarketId==='${id}'&&!workspace.selectedIndex&&!workspace.marketLoading&&workspace.candles.length>0`);
 const hiddenUntilPaint=async()=>{
  assert.deepEqual(await js(`return {busy:workspace.host.getAttribute('aria-busy'),mask:workspace.loadingElement.hidden,
    chart:getComputedStyle(workspace.chartElement).visibility,background:getComputedStyle(workspace.loadingElement).backgroundColor}`),
    {busy:'true',mask:false,chart:'hidden',background:'rgb(255, 255, 255)'});
 };
 await js(`qaSetLanguage('zh-CN');document.documentElement.dataset.theme='light';
 codexDesktop.getIndexChart=async p=>{if(p.period)await new Promise(r=>window.releaseIndex=r);return baseIndexChart(p);};`);
 await favorite('index:gold');await until('typeof releaseIndex==="function"');
 await hiddenUntilPaint();
 await js('await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await sleep(150);
 const loadingFile=path.join(output,'loading-transition.png');await writeFile(loadingFile,(await win.webContents.capturePage()).toPNG());report.screenshots.push(loadingFile);
 // A late index response must not replace the newly chosen low-price pair.
 await favorite(lowId);await marketReady(lowId);
 assert.equal(await js('return workspace.activeInterval'),'60');
 await js('releaseIndex()');await sleep(150);
 assert.equal(await js('return workspace.loadedMarketId'),lowId);
 assert.equal(await js('return workspace.candles.every(c=>c.high<0.03&&c.low>0.01)&&workspace.errorElement.hidden'),true);
 assert.equal(await js('return marketRequests.every(r=>r.freshness!=="live")'),true);
 await js('codexDesktop.getIndexChart=baseIndexChart');
 for(let i=0;i<6;i++){
  await favorite(i%2?'index:btc-ahr999':'index:gold');await until('!!workspace.selectedIndex&&!workspace.marketLoading');
  await favorite(i%2?btcId:lowId);await marketReady(i%2?btcId:lowId);
  assert.equal(await js('return workspace.activeInterval'),'60');
  assert.equal(await js('return workspace.errorElement.hidden'),true);
 }
 // Hold an ordinary market response, then leave again before it resolves.
 await js(`window.holdMarket='LOBSTERUSDT';window.releaseMarket=null`);
 await favorite('index:gold');await until('!!workspace.selectedIndex&&!workspace.marketLoading');
 await favorite(lowId);await until('typeof releaseMarket==="function"');
 await favorite('index:btc-ahr999');await until('workspace.loadedMarketId==="index:btc-ahr999"&&!workspace.marketLoading');
 await js('releaseMarket();window.holdMarket=null');await sleep(150);
 assert.equal(await js('return workspace.loadedMarketId'),'index:btc-ahr999');
 assert.equal(await js('return workspace.candles.every(c=>c.high<10)&&workspace.errorElement.hidden'),true);
 // Verify the opaque cover also spans both scheduled chart paint frames.
 const frames=await js(`workspace.setLoading(true);workspace.setLoading(false);
 const states=[workspace.host.getAttribute('aria-busy')];
 await new Promise(r=>requestAnimationFrame(r));states.push(workspace.host.getAttribute('aria-busy'));
 await new Promise(r=>requestAnimationFrame(r));states.push(workspace.host.getAttribute('aria-busy'));return states;`);
 assert.deepEqual(frames,['true','true','false']);
 await js(`document.querySelector('[data-market-action="open-split-layouts"]').click();
 document.querySelectorAll('[data-market-action="select-split-layout"]')[1].click()`);
 await until('workspace.splitPanes.length===1');
 assert.equal(await js('return workspace.selectedIndex.id'),'index:btc-ahr999');
 await js('document.querySelector(\'[data-market-action="toggle-period-editor"]\').click()');
 assert.equal(await js('return !workspace.periodEditor.hidden&&workspace.primaryPeriodMenu.hidden'),true);
 await js('workspace.setPeriodEditorOpen(false)');
 assert.equal(await js('return marketRequests.every(r=>!String(r.parameters.symbol).includes("index:"))'),true);
 await js(`workspace.splitLayoutId='1-single';workspace.applySplitLayout();
 document.querySelector('.trading-market-favorite-ticker[data-market-id="index:gold"] [data-market-action="remove-favorite"]').click()`);
 assert.equal(await js('return document.querySelectorAll(\'.trading-market-favorite-ticker[data-market-id="index:gold"]\').length'),0);
 await open('index:gold');await open('index:gold');
 assert.equal(await js('return document.querySelectorAll(\'.trading-market-favorite-ticker[data-market-id="index:gold"]\').length'),1);
 assert.equal(await js('return workspace.chart===originalChart'),true);
 assert.doesNotMatch(await js('return document.body.innerHTML'),/aicoin|accesssecret|signature/i);
 assert.deepEqual(errors,[]);
 report.checks.push('Opaque loading and two paint-frame gate; 12 rapid favorite switches; cached low-price candles accepted; both late-response directions isolated; interval restored; index favorite removal/deduplication; split layout stays on original index canvas');

 // Search the complete production catalogue through the ordinary symbol picker.
 await js('workspace.setPickerOpen(true);document.querySelector(\'[data-market-category="index"]\').click()');
 await until('!workspace.marketList.hasAttribute("aria-busy")');
 assert.equal(await js('return workspace.marketList.querySelectorAll("[data-picker-index]").length'),450);
 assert.deepEqual(await js('return [...document.querySelectorAll("[data-market-category]")].map(b=>b.dataset.marketCategory)'),['all','crypto','commodity','stock','index']);
 assert.equal(await js('return workspace.picker.querySelectorAll(\'[data-market-watchlist-heading],input[type="checkbox"]\').length'),0);
 const pickerFile=path.join(output,'index-picker.png');await sleep(150);await writeFile(pickerFile,(await win.webContents.capturePage()).toPNG());report.screenshots.push(pickerFile);
 const search=async query=>{await js(`workspace.search.value=${JSON.stringify(query)};workspace.search.dispatchEvent(new Event('input',{bubbles:true}))`);await until('!workspace.marketList.hasAttribute("aria-busy")');};
 for(const query of ['纳斯达克综合指数','NASDAQ Composite','IXIC']){
  await search(query);assert.equal(await js('return !!workspace.marketList.querySelector(\'[data-picker-index="index:nasdaq-composite"]\')'),true);
 }
 // Every row, including nonpriority indices, must be discoverable by its code.
 const searchMisses=await js(`const misses=[];for(const index of workspace.watchlistPanel.indexCatalogue){workspace.search.value=index.code;workspace.renderMarkets();
   while(workspace.marketList.hasAttribute('aria-busy'))await new Promise(r=>setTimeout(r,0));
   if(!workspace.marketList.querySelector('[data-picker-index="'+index.id+'"]'))misses.push(index.id);}return misses;`);
 assert.deepEqual(searchMisses,[]);
 await search('NASDAQ Composite');
 await js('workspace.indexFavorites.remove("index:nasdaq-composite");workspace.renderMarkets()');await until('!workspace.marketList.hasAttribute("aria-busy")');
 await js('workspace.marketList.querySelector(\'[data-market-action="favorite"][data-market-id="index:nasdaq-composite"]\').click()');await until('!workspace.marketList.hasAttribute("aria-busy")');
 assert.equal(await js('return workspace.picker.hidden'),false);
 assert.equal(await js('return workspace.marketList.querySelector(\'[data-market-action="favorite"]\').getAttribute("aria-pressed")'),'true');
 assert.equal(await js('return !!document.querySelector(\'.trading-market-favorite-ticker[data-market-id="index:nasdaq-composite"]\')'),true);
 await js('workspace.marketList.querySelector(\'[data-market-action="favorite"]\').click()');await until('!workspace.marketList.hasAttribute("aria-busy")');
 assert.equal(await js('return !!workspace.indexFavorites.get("index:nasdaq-composite")'),false);
 await js('workspace.marketList.querySelector(\'[data-market-action="symbol"]\').click()');await until('workspace.loadedMarketId==="index:nasdaq-composite"&&!workspace.marketLoading');
 assert.equal(await js('return workspace.picker.hidden&&!!workspace.indexFavorites.get("index:nasdaq-composite")&&workspace.chart===originalChart'),true);
 await js('workspace.setPickerOpen(true);document.querySelector(\'[data-market-category="all"]\').click()');await search('NASDAQ Composite');
 assert.equal(await js('return !!workspace.marketList.querySelector(\'[data-picker-index="index:nasdaq-composite"]\')'),true);
 await js('workspace.setPickerOpen(false)');
 assert.doesNotMatch(await js('return document.body.innerHTML'),/aicoin|accesssecret|signature/i);
 assert.deepEqual(errors,[]);
 report.checks.push('All 450 indices listed and searchable by code; Chinese/English names and All category; five-column picker with no checkboxes; star add/remove and top-favorite synchronization; selection opens original chart');
 report.status='passed';
}catch(error){report.status='failed';report.error=error.stack||String(error);}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));process.stdout.write(JSON.stringify(report,null,2));win?.destroy();await server?.close();app.exit(report.status==='passed'?0:1);}
}
void main();
