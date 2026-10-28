// Run with node from the repository root. Starts an isolated Vite server and
// an offscreen Electron window; neither the development client nor user data is opened.
if (!process.versions.electron) {
  const path=require('node:path'),{spawn}=require('node:child_process');
  (async()=>{
    const {createServer}=await import('vite');
    const root=path.resolve(__dirname,'../..');
    const server=await createServer({configFile:path.join(root,'youle_desktop/vite.config.mjs'),server:{port:5196,strictPort:true,hmr:false}});
    await server.listen();
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    try {
      const child=spawn(require('electron'),[__filename],{cwd:root,windowsHide:true,stdio:'inherit',env});
      process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code??1));});
    } finally {await server.close();}
  })().catch(error=>{console.error(error);process.exitCode=1;});
} else {
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.HAOLO_PRICE_AXIS_QA_DIR || path.join(root, '.cache', 'price-axis-qa', String(Date.now())));
fs.mkdirSync(output,{recursive:true});
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => { await pause(100); await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); };
  const click = async selector => { await js(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); };
  const open = async () => { await click('[data-market-action="open-chart-settings"]'); await click('[data-market-settings-tab="coordinate"]'); };
  const close = () => click('[data-market-action="close-chart-settings"]');
  const setting = key => click(`[data-chart-setting="${key}"]`);
  const shot = async name => fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const state = () => js(`(() => { const w=workspace,c=w.chart;return {hidden:w.chartSettings.hidePriceAxis,colors:c.panes().map(p=>c.priceScale('right',p.paneIndex()).options().textColor),width:c.priceScale('right',0).width(),plot:c.timeScale().width(),host:w.chartElement.clientWidth,range:c.timeScale().getVisibleLogicalRange(),price:c.priceScale('right',0).getVisibleRange(),lastValue:w.candleSeries.options().lastValueVisible,live:{hidden:w.currentPriceElement.hidden,text:w.currentPriceElement.textContent},countdown:{hidden:w.candleCountdownElement.hidden,text:w.candleCountdownElement.textContent}};})()`);
  async function load(clear=false) {
    if(clear) await win.webContents.session.clearStorageData();
    await win.loadURL('http://127.0.0.1:5196/@fs/' + path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/'));
    for(let i=0;i<180&&!await js('Boolean(window.ready)');i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'),true,await js('String(window.qaError)'));
    await js('workspace.loadingHistory=true;clearInterval(workspace.pollTimer);clearInterval(workspace.candlePollTimer);workspace.favoriteTickerGeneration++;workspace.closeFavoriteTickerStreams();workspace.closeSocket();void 0');
    await settle();
  }
  setTimeout(()=>app.exit(1),180000).unref();
  const report=[];
  await load(true);
  // Observe actual canvas tick drawing, not just the saved preference.
  await js(`window.tickDraws=[];window.originalFillText=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){if(this.canvas.isConnected)tickDraws.push({text:String(text),color:this.fillStyle,width:this.canvas.getBoundingClientRect().width});return originalFillText.call(this,text,...args)};void 0`);
  for(const theme of ['light','dark']) {
    await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();void 0`); await settle();
    await open();
    if(await js('workspace.chartSettings.hidePriceAxis')) await setting('hidePriceAxis');
    if(!await js('workspace.chartSettings.showCountdown')) await setting('showCountdown');
    await close();
    const before=await state();
    assert.notEqual(before.colors[0],'transparent');
    await open(); await js('tickDraws=[]'); await setting('hidePriceAxis');
    await shot(`${theme}-settings`); await close();
    const after=await state();
    assert.equal(after.hidden,true);assert.equal(after.colors[0],'transparent');
    assert.equal(after.width,0);assert.equal(after.plot,before.plot+before.width);assert.ok(Math.abs(after.plot-after.host)<=1);
    assert.equal(after.lastValue,before.lastValue);assert.equal(after.countdown.hidden,false);

    const current=await js("(()=>{const e=document.querySelector('[data-market-current-price]');return{hidden:e.hidden,text:e.textContent}})()");
    assert.equal(current.hidden,false);assert.match(current.text,/\d/);
    assert.deepEqual(after.colors.slice(1),before.colors.slice(1));
    const draws=await js('tickDraws.filter(x=>x.width<160&&/\\d/.test(x.text))');
    assert.ok(draws.some(x=>x.color==='#00000000'||x.color==='rgba(0, 0, 0, 0)'),JSON.stringify(draws.slice(-8)));
    const point=await js(`(()=>{const r=workspace.chart.panes()[0].getHTMLElement().getBoundingClientRect();return{x:Math.round(r.left+250),y:Math.round(r.top+100)}})()`);
    win.webContents.sendInputEvent({type:'mouseMove',...point});await settle();
    const labels=await js(`Array.from(document.querySelectorAll('[data-market-focus-price],[data-market-crosshair-price],[data-market-live-price],[data-market-candle-countdown]')).map(e=>({tag:e.outerHTML.slice(0,230),hidden:e.hidden,text:e.textContent}))`);
    assert.equal(await js('workspace.crosshairPriceElement.hidden'),false);
    await shot(`${theme}-hidden`);

    // The reclaimed column is a real canvas with native hover input.
    const edge=await js("(()=>{const r=workspace.chartElement.getBoundingClientRect();return{x:Math.floor(r.left+workspace.chart.timeScale().width()-8),y:Math.floor(r.top+130)}})()");
    win.webContents.sendInputEvent({type:'mouseMove',...edge});await settle();
    assert.equal(await js('workspace.crosshairPriceElement.hidden'),false);
    // Manual drawing price tags must also stay inside the reclaimed plot.
    await js("(()=>{const d=workspace.drawingController;d.drawings=[{id:'axis-qa',tool:'horizontal-line',symbol:d.getSymbol(),interval:d.getInterval(),points:[{time:workspace.candles.at(-20).time,price:1320}]}];d.selectDrawing('axis-qa');d.redraw()})()");await settle();
    const marker=await js("(()=>{const e=workspace.drawingController.axisMarkerLayer.querySelector('[data-drawing-axis-price]'),r=e?.getBoundingClientRect(),h=workspace.chartElement.getBoundingClientRect();return{count:!!e,text:e?.textContent,left:r?.left,right:r?.right,hostLeft:h.left,hostRight:h.right}})()");
    assert.equal(marker.count,true);assert.match(marker.text,/1320|1,320/);assert.ok(marker.left>=marker.hostLeft&&marker.right<=marker.hostRight+2);
    await js("workspace.drawingController.drawings=[];workspace.drawingController.selectDrawing(null);workspace.drawingController.redraw();void 0");

    // New split panes must immediately inherit the preference without hiding their indicator scale.
    await js("workspace.splitLayoutId='2-columns';workspace.applySplitLayout();void 0");
    for(let i=0;i<100&&!await js('Boolean(workspace.splitPanes[0]?.candles.length)');i++) await pause(50);
    await settle();
    assert.equal(await js('workspace.splitPanes[0].chart.priceScale("right",0).options().textColor'),'transparent');
    const splitAxis=await js(`(()=>{const w=workspace.splitPanes[0],c=w.chart,axis=c.panes()[0].getHTMLElement().lastElementChild.querySelector('canvas');return {width:c.priceScale('right',0).width(),plot:c.timeScale().width(),host:w.chartElement.clientWidth,lastValue:w.series.options().lastValueVisible,painted:axis.getContext('2d').getImageData(0,0,axis.width,axis.height).data.some((v,i)=>i%4===3&&v>0)}})()`);
    assert.equal(splitAxis.width,0);assert.ok(Math.abs(splitAxis.plot-splitAxis.host)<=2);
    assert.equal(splitAxis.lastValue,true);assert.equal(splitAxis.painted,true);
    await open();await setting('hidePriceAxis');await close();
    assert.notEqual(await js('workspace.splitPanes[0].chart.priceScale("right",0).options().textColor'),'transparent');
    await open();await setting('hidePriceAxis');await close();
    assert.equal(await js('workspace.splitPanes[0].chart.priceScale("right",0).options().textColor'),'transparent');
    for(const mode of [1,2,0]) { await js(`workspace.chartNavigation.setMode(${mode});void 0`);await settle();assert.equal((await state()).colors[0],'transparent'); }
    const geometry=await js(`(()=>{const c=workspace.chart;const a=workspace.currentPriceElement.getBoundingClientRect(),r=workspace.chartElement.getBoundingClientRect();return {labelRight:a.right,chartRight:r.right,screenshotWidth:c.takeScreenshot().width,canvasWidth:c.panes()[0].getHTMLElement().querySelector('canvas').width};})()`);
    assert.ok(Math.abs(geometry.labelRight-geometry.chartRight)<=2,JSON.stringify(geometry));assert.equal(geometry.screenshotWidth,geometry.canvasWidth);
    report.push({theme,before,after,current,labels,geometry,canvasHiddenTickDraws:draws.filter(x=>x.color==='#00000000'||x.color==='rgba(0, 0, 0, 0)').length});
    await js("workspace.splitLayoutId='1-single';workspace.applySplitLayout();void 0");
  }
  await load();assert.equal((await state()).hidden,true);assert.equal((await state()).colors[0],'transparent');
  await js("document.getElementById('host').style.width='1000px';void 0");await settle();
  const resized=await state();assert.equal(resized.width,0);assert.ok(Math.abs(resized.plot-resized.host)<=2);
  await open();await click('[data-market-action="restore-chart-settings"]');await close();
  assert.equal((await state()).hidden,false);assert.notEqual((await state()).colors[0],'transparent');
  assert.ok((await state()).width>0);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,cases:report,reload:true,restoreDefaults:true},null,2));
  console.log(JSON.stringify({passed:true,themes:2,split:true,modes:3,reload:true,restoreDefaults:true,output}));
  await js('workspace.destroy()');win.destroy();app.exit(0);
})().catch(error=>{console.error(error);app.exit(1)});

}
