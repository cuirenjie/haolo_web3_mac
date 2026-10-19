// Real chart/pane classes and lightweight-charts in an isolated hidden Electron.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),output=path.join(root,'output/cloud-chart-visual-qa-20261018');
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'profile'));app.disableHardwareAcceleration();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const {createServer}=await import('vite');
  const server=await createServer({configFile:path.join(root,'vite.config.mjs'),server:{port:0,strictPort:false,hmr:false}});
  await server.listen();const base=`http://127.0.0.1:${server.httpServer.address().port}`;
  await app.whenReady();
  const win=new BrowserWindow({show:false,width:1200,height:800,webPreferences:{offscreen:true,backgroundThrottling:false}});
  const js=source=>win.webContents.executeJavaScript(source,true),errors=[],checks=[];
  win.webContents.on('console-message',event=>{if(event.level==='error'&&!event.message.includes('Binance market catalog is unavailable'))errors.push(event.message);});
  const settle=()=>js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  try {
    for(const theme of ['light','dark'])for(const language of ['zh-CN','en','zh-TW']) {
      await win.webContents.session.clearStorageData();
      await win.loadURL(base+'/@fs/'+path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/'));
      for(let i=0;i<100&&!await js('Boolean(window.ready)');i++)await pause(100);
      assert.equal(await js('Boolean(window.ready)'),true,await js('String(window.qaError)'));
      await js(`window.primary=workspace;document.documentElement.dataset.theme=${JSON.stringify(theme)};primary.applyChartTheme();primary.loadingHistory=true;primary.splitLayoutId='2-columns';primary.applySplitLayout();void 0`);
      for(let i=0;i<100&&!await js('Boolean(primary.splitPanes[0]?.candles.length)');i++)await pause(50);
      assert.equal(await js('Boolean(primary.splitPanes[0]?.candles.length)'),true);
      await js(`(async()=>{const language=await import('/app-language.mjs');language.applyAppLanguage(${JSON.stringify(language)},{root:document.body});
        window.pane=primary.splitPanes[0];window.ref={conditionId:'00000000-0000-4000-8000-000000000001',revision:1,conditionHash:'a'.repeat(64)};
        window.makePatch=(w,id)=>({schemaVersion:1,analysisId:id,baseRevision:0,marketId:w.selectedMarketId||w.market.id,interval:w.activeInterval||w.interval,indicatorId:'rsi',entryConditionRef:ref,
          operations:[{op:'upsert',drawing:{id:id+'-path',theory:'strategy',strategyId:'rsi-analysis',layer:'ai/strategy/rsi-analysis',tool:'path',points:[{time:w.candles.at(-35).time,value:30},{time:w.candles.at(-5).time,value:45}],colorToken:'strategy-primary'}},
          {op:'upsert',drawing:{id:id+'-note',theory:'strategy',strategyId:'rsi-analysis',layer:'ai/strategy/rsi-analysis',tool:'text',points:[{time:w.candles.at(-20).time,value:37}],text:'RSI evidence',markerSize:0,colorToken:'strategy-note'}}]});
        primary.acceptIndicatorAnalysisDrawingPatch(makePatch(primary,'main'));primary.acceptIndicatorAnalysisDrawingPatch(makePatch(pane,'split'),1);})()`);
      await settle();
      const state=await js(`(()=>{const runtimes=[primary,pane].map(w=>w.indicatorPanes.get('rsi'));return {series:runtimes.map(r=>r.analysisSeries.length),markers:runtimes.map(r=>!!r.analysisMarkers),signatures:runtimes.map(r=>r.analysisSignature),error:window.qaError||null}})()`);
      const ticks=await js(`(()=>{const t=Date.UTC(2026,9,18)/1000;return [primary.chart,pane.chart].map(c=>c.options().timeScale.tickMarkFormatter(t));})()`);assert.deepEqual(ticks,['10/18','10/18']);
      assert.deepEqual(state.series,[1,1]);assert.deepEqual(state.markers,[true,true]);assert.equal(state.error,null);
      assert.ok(state.signatures.every(s=>s.includes('conditionHash')));
      await js('pane.rebuildIndicatorPanes();pane.updateIndicatorData();void 0');await settle();
      assert.equal(await js("pane.indicatorPanes.get('rsi').analysisSeries.length"),1);
      await js("window.originalPaneStorage=pane.drawingStorageSessionId;pane.updateDrawingStorageSession('empty-other-thread');void 0");
      assert.equal(await js("pane.indicatorPanes.get('rsi').analysisSeries.length"),0);
      await js('pane.updateDrawingStorageSession(originalPaneStorage);void 0');await settle();
      assert.equal(await js("pane.indicatorPanes.get('rsi').analysisSeries.length"),1);
      await fs.promises.writeFile(path.join(output,`${theme}-${language}.png`),(await win.webContents.capturePage()).toPNG());
      checks.push({theme,language,...state,rebuilt:true,sessionIsolated:true});
    }
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,checks,errors},null,2));
    console.log('Actual main/split RSI overlays, cache rebuild, session isolation: 2 themes × 3 languages passed.');
  } finally {win.destroy();await server.close();}
  app.exit(0);
})().catch(error=>{console.error(error.stack);app.exit(1);});
