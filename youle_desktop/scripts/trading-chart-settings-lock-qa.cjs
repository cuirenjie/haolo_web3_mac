// Real settings controls and native pointer input. Start Vite on 127.0.0.1:5183.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.cache','chart-settings-lock');
// Use the actual pre-navigation GitHub revision as the linear-fit oracle.
const historical=execFileSync('git',['show','a6b975760105de9978e72968e375d3dbe8c2589d:youle_desktop/src/renderer/trading-expert-market.ts'],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
const legacy={};new Function('exports',ts.transpileModule(historical.slice(historical.indexOf('function nicePriceScaleStep('),historical.indexOf('export function initialMarketLogicalRange(')),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(legacy);
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'profile'));app.disableHardwareAcceleration();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await app.whenReady();
 const win=new BrowserWindow({show:false,width:1200,height:800,webPreferences:{offscreen:true,backgroundThrottling:false}});
 const js=s=>win.webContents.executeJavaScript(s,true),report={checks:[],drags:[],themes:[],errors:[]};
 win.webContents.on('console-message',e=>{if(e.level==='error'&&!e.message.includes('Binance market catalog is unavailable'))report.errors.push(e.message)});
 const settle=()=>js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 async function clickElement(expression){
  const p=await js(`(()=>{const e=${expression},r=e.getBoundingClientRect();if(!r.width||!r.height)throw Error('Invisible control');return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
  win.webContents.sendInputEvent({type:'mouseMove',...p});for(const type of ['mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...p,button:'left',clickCount:1});await settle();
 }
 const action=name=>clickElement(`workspace.chartNavigation.controls.querySelector('[data-navigation-action=${name}]')`);
 const setting=key=>clickElement(`primary.chartSettingsBackdrop.querySelector('[data-chart-setting=${key}]').closest('label')`);
 async function openSettings(){await clickElement(`primary.host.querySelector('[data-market-action=open-chart-settings]')`);await clickElement(`primary.chartSettingsBackdrop.querySelector('[data-market-settings-tab=coordinate]')`)}
 const closeSettings=()=>clickElement(`primary.chartSettingsBackdrop.querySelector('[data-market-action=close-chart-settings]')`);
 let candles;
 function assertFit(s,subject,mode){
  assert.ok(s.top>=-1&&s.bottom<=s.height+1,JSON.stringify({subject,mode,top:s.top,bottom:s.bottom,height:s.height}));
  assert.equal(s.preference,false,'locking must not select the saved A setting');
  if(subject==='main'&&mode===0)assert.deepEqual(s.price,legacy.fixedPriceScaleRange(legacy.visibleCandlesInLogicalRange(candles,s.range),0.02));
  else assert.equal(s.auto,true);
 }
 const snapshot=()=>js(`(()=>{const c=workspace.chart,s=workspace.candleSeries||workspace.series,p=c.panes()[0],r=c.timeScale().getVisibleLogicalRange(),v=workspace.indicatorPanes.get('volume')?.series[0].api,b=v?.priceToCoordinate(0),visible=(workspace.chartCandles||workspace.candles).slice(Math.max(0,Math.ceil(r.from)),Math.min(workspace.candles.length,Math.floor(r.to)+1));return {preference:(workspace.chartSettings||workspace.settings).autoScale,top:s.priceToCoordinate(Math.max(...visible.map(c=>c.high))),bottom:s.priceToCoordinate(Math.min(...visible.map(c=>c.low))),range:r,price:c.priceScale('right',0).getVisibleRange(),y:s.priceToCoordinate(window.anchorPrice),x:c.timeScale().logicalToCoordinate(window.anchorLogical),auto:c.priceScale('right',0).options().autoScale,modes:c.panes().map(p=>c.priceScale('right',p.paneIndex()).options().mode),heights:v?[100,1000,10000,100000].map(n=>b-v.priceToCoordinate(n)):[],volumes:v?.data().map(d=>d.value),locked:workspace.chartNavigation.controls.querySelector('[data-navigation-action=lock-vertical]').getAttribute('aria-pressed'),height:p.getHeight()}})()`);
 async function drag(dx,dy){
  const p=await js(`(()=>{const p=workspace.chart.panes()[0],r=p.getHTMLElement().getBoundingClientRect();return {x:Math.round(r.left+140),y:Math.round(r.top+p.getHeight()/2)}})()`);
  win.webContents.sendInputEvent({type:'mouseMove',...p});win.webContents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:1});
  let during;
  for(let i=1;i<=12;i++){
   win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(p.x+dx*i/12),y:Math.round(p.y+dy*i/12),button:'left',modifiers:['leftButtonDown']});await pause(18);
   if(i===8)during=await snapshot();
  }
  win.webContents.sendInputEvent({type:'mouseUp',x:p.x+dx,y:p.y+dy,button:'left',clickCount:1});await settle();
  return {during,after:await snapshot()};
 }
 async function load(theme,clear){
  if(clear)await win.webContents.session.clearStorageData();
  await win.loadURL('http://127.0.0.1:5183/@fs/'+path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/')+'?lock='+theme);
  for(let i=0;i<150&&!await js('Boolean(window.ready)');i++)await pause(100);
  assert.equal(await js('Boolean(window.ready)'),true,await js('String(window.qaError)'));
  await js(`window.primary=workspace;document.documentElement.dataset.theme='${theme}';primary.loadingHistory=true;clearInterval(primary.pollTimer);primary.pollTimer=null;clearInterval(primary.candlePollTimer);primary.candlePollTimer=null;primary.favoriteTickerGeneration++;primary.closeFavoriteTickerStreams();primary.closeSocket();primary.cancelScheduledLiveChartPaint();primary.latestLivePricesByMarketId.clear();primary.candles=primary.candles.map((c,i)=>{const o=1000+i*3+Math.sin(i/9)*20;return {...c,open:o,high:o+8,low:o-6,close:o+4,volume:[100,1000,10000,100000][i%4]}});primary.updateChartData({resetViewport:true});void 0`);await settle();
  candles=await js('primary.chartCandles');
 }
 for(const theme of ['light','dark']){
  await load(theme,true);
  assert.equal(await js("document.querySelectorAll('.trading-chart-scale-controls,[data-navigation-action=auto],[data-navigation-action=log]').length"),0);
  assert.equal(await js('primary.chartSettings.autoScale'),false);assert.equal(await js('primary.chart.priceScale("right",0).options().autoScale'),false);
  await openSettings();
  assert.deepEqual(await js("Array.from(primary.chartSettingsBackdrop.querySelectorAll('[data-chart-settings-panel=coordinate] input')).map(i=>i.checked)"),[false,false,false]);
  await fs.promises.writeFile(path.join(output,theme+'-settings-off.png'),(await win.webContents.capturePage()).toPNG());
  await setting('autoScale');assert.equal(await js('primary.chart.priceScale("right",0).options().autoScale'),true);
  await setting('logarithmicScale');assert.deepEqual(await js("primary.chart.panes().map(p=>primary.chart.priceScale('right',p.paneIndex()).options().mode)"),[1,0]);
  await setting('percentageScale');assert.equal(await js("primary.chartSettingsBackdrop.querySelector('[data-chart-setting=logarithmicScale]').checked"),false);
  await setting('percentageScale');await setting('autoScale');
  await closeSettings();report.checks.push({theme,label:'settings are unchecked by default and change only main price units'});
  await js("primary.splitLayoutId='2-columns';primary.applySplitLayout();void 0");
  for(let i=0;i<100&&!await js('Boolean(primary.splitPanes[0]?.candles.length)');i++)await pause(50);
  await js("clearTimeout(primary.splitPanes[0].refreshTimer);primary.splitPanes[0].refreshTimer=null;primary.splitPanes[0].candles=primary.candles.map(c=>({...c}));for(const w of [primary,...primary.splitPanes]){w.activeIndicators=['volume','macd'];w.rebuildIndicatorPanes();if(w===primary)w.updateChartData();else w.updateData();w.chartNavigation.reset()}void 0");await settle();
  for(const subject of ['main','split'])for(const mode of [0,1,2]){
   await js(`window.workspace=${subject==='main'?'primary':'primary.splitPanes[0]'};workspace.chartNavigation.setMode(${mode});workspace.chartNavigation.setAutoScale(false);workspace.chartNavigation.reset();void 0`);await settle();
   await js("window.anchorPrice=(workspace.candleSeries||workspace.series).coordinateToPrice(workspace.chart.panes()[0].getHeight()/2);window.anchorLogical=workspace.chart.timeScale().getVisibleLogicalRange().to-20;void 0");
   const initial=await snapshot();assert.equal(initial.locked,'false');assert.equal(initial.auto,false);assert.deepEqual(initial.modes,[mode,0,0]);
   const unlocked=await drag(0,54);assert.ok(unlocked.during.y-initial.y>25,JSON.stringify({initial,unlocked}));assert.ok(unlocked.after.y-initial.y>40);
   await action('lock-vertical');const locked=await snapshot();assert.equal(locked.locked,'true');assertFit(locked,subject,mode);
   const vertical=await drag(0,-54);assert.ok(Math.abs(vertical.after.y-locked.y)<1);assert.deepEqual(vertical.after.range,locked.range);
   const diagonal=await drag(72,48);assertFit(diagonal.during,subject,mode);assertFit(diagonal.after,subject,mode);
   assert.notDeepEqual(diagonal.after.price,locked.price,'visible highs/lows must refit after horizontal movement');
   assert.ok(diagonal.during.x-locked.x>30);assert.ok(Math.abs(diagonal.after.x-locked.x-72)<2);
   assert.deepEqual(diagonal.after.modes,[mode,0,0]);assert.deepEqual(diagonal.after.volumes,initial.volumes);
   const otherLock=await js(`(${subject==='main'?'primary.splitPanes[0]':'primary'}).chartNavigation.controls.querySelector('[data-navigation-action=lock-vertical]').getAttribute('aria-pressed')`);assert.equal(otherLock,'false');
   for(const name of ['zoom-in','zoom-out','left','right','reset']){
    await action(name);const fitted=await snapshot();assert.equal(fitted.locked,'true');assertFit(fitted,subject,mode);
   }
   if(mode===1){
    const beforeTheme=await snapshot();
    await js(`document.documentElement.dataset.theme='${theme==='light'?'dark':'light'}'`);await settle();assert.equal((await snapshot()).locked,'true');assert.ok(Math.abs((await snapshot()).y-beforeTheme.y)<1);
    await js(`document.documentElement.dataset.theme='${theme}'`);await settle();
    await fs.promises.writeFile(path.join(output,`${theme}-${subject}-locked.png`),(await win.webContents.capturePage()).toPNG());
   }
   await action('lock-vertical');const free=await snapshot();const resumed=await drag(0,-48);const movement={theme,subject,mode,during:resumed.during.y-free.y,after:resumed.after.y-free.y};assert.ok(movement.during<-16,JSON.stringify(movement));assert.ok(Math.abs(movement.after+48)<14,JSON.stringify(movement));
   report.drags.push({theme,subject,mode,lockedYDelta:diagonal.after.y-locked.y,lockedXDelta:diagonal.after.x-locked.x,unlockedYDelta:resumed.after.y-free.y});
  }
  await js('window.workspace=primary;void 0');await openSettings();await setting('autoScale');await setting('logarithmicScale');
  await fs.promises.writeFile(path.join(output,theme+'-settings-on.png'),(await win.webContents.capturePage()).toPNG());
  await closeSettings();await action('lock-vertical');
  const tone=await js("(()=>{const b=workspace.chartNavigation.controls.querySelector('[data-navigation-action=lock-vertical]'),s=getComputedStyle(b);return {color:s.color,background:s.backgroundColor,outline:s.outlineColor,pressed:b.getAttribute('aria-pressed')}})()");report.themes.push({theme,...tone});
  await load(theme,false);assert.equal(await js('primary.chartSettings.autoScale'),true);assert.equal(await js('primary.chartSettings.priceScaleMode'),'logarithmic');
  assert.equal((await snapshot()).locked,'false');assert.deepEqual((await snapshot()).modes,[1,0]);
  await openSettings();await setting('autoScale');await setting('logarithmicScale');await closeSettings();
  await action('reset');const reset=await snapshot();assert.equal(reset.auto,false);assert.ok(Number.isFinite(reset.price.from)&&reset.price.to>reset.price.from);
  await js('workspace.candleSeries.setData([]);workspace.chartNavigation.schedule();void 0');await settle();assert.equal(await js("workspace.chartNavigation.controls.querySelector('[data-navigation-action=lock-vertical]').disabled"),true);
  report.checks.push({theme,label:'preferences persist, lock defaults unlocked on reload, reset fits once and empty charts disable lock'});
  console.log('settings and lock passed',theme);
 }
 assert.notEqual(report.themes[0].background,report.themes[1].background);assert.deepEqual(report.errors,[]);
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,dragCases:report.drags.length,checks:report.checks.length,output}));win.destroy();app.quit();
})().catch(e=>{console.error(e);app.exit(1)});
