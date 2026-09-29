// M2-020 R1/R2: real charts with isolated market fixtures. Start Vite on :5183.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'trading-market-recovery-mac-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1200, height: 800,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = source => win.webContents.executeJavaScript(source, true);
  const report = { simulations: [], manualViews: [], shortcuts: [], errors: [] };
  win.webContents.on('console-message', event => {
    if (event.level === 'error' && !event.message.includes('Binance market catalog is unavailable')) report.errors.push(event.message);
  });
  const settle = () => pause(160);
  const simulationView = () => js(`({
    x:workspace.chart.timeScale().timeToCoordinate(workspace.alertSimulationState.triggerTime),
    markerVisible:!workspace.alertSimulationPointElement.hidden,
    width:workspace.chart.timeScale().width(), attached:!!workspace.alertSimulationSeries,
    matching:workspace.alertSimulationMatchesCurrentContext(), candles:workspace.candles.length,
    ready:workspace.marketHistoryReady, range:workspace.chart.timeScale().getVisibleLogicalRange()
  })`);
  const assertSimulation = view => {
    assert.equal(view.attached, true); assert.equal(view.matching, true); assert.equal(view.ready, true);
    assert.equal(view.candles, 500); assert.equal(view.markerVisible, true);
    assert.ok(typeof view.x === 'number' && view.x >= 0 && view.x < view.width, JSON.stringify(view));
  };
  for (const theme of ['light', 'dark']) {
    await win.webContents.session.clearStorageData();
    await win.loadURL('http://127.0.0.1:5183/@fs/' + path.join(root, 'test/fixtures/trading-chart-navigation.html'));
    for (let i = 0; i < 100 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
    await js(`document.documentElement.dataset.theme='${theme}';window.primary=workspace;
      clearInterval(primary.pollTimer);clearInterval(primary.candlePollTimer);
      primary.favoriteTickerGeneration++;primary.closeFavoriteTickerStreams();primary.closeSocket();
      primary.cancelScheduledLiveChartPaint();primary.loadingHistory=true;
      window.fullCandles=primary.candles.map(c=>({...c}));void 0`);
    await settle();

    // Recovery must preserve a user's candle and price coordinates even when
    // completing the cache prepends 400 bars and changes native logical indices.
    for (const mode of [0, 1, 2]) {
      await js(`workspace.clearAlertSimulation();workspace.chartNavigation.setMode(${mode});
        workspace.candles=fullCandles.slice(-100);workspace.sourceCandles=workspace.candles;
        workspace.updateChartData({resetViewport:true});workspace.chart.timeScale().setVisibleLogicalRange({from:20,to:60});void 0`);
      await settle();
      const axis = await js(`(()=>{const r=workspace.chart.panes()[0].getHTMLElement().getBoundingClientRect();return {x:Math.round(r.right-20),y:Math.round(r.top+60)}})()`);
      win.webContents.sendInputEvent({ type: 'mouseWheel', ...axis, deltaY: 60, deltaX: 0 });
      await settle();
      await js(`window.anchorTime=workspace.candles[50].time+28800;
        window.anchorPrice=workspace.candleSeries.coordinateToPrice(workspace.chart.panes()[0].getHeight()*0.4);void 0`);
      const view = () => js(`({x:workspace.chart.timeScale().timeToCoordinate(anchorTime),
        y:workspace.candleSeries.priceToCoordinate(anchorPrice),auto:workspace.chart.priceScale('right',0).options().autoScale,
        range:workspace.chart.timeScale().getVisibleLogicalRange(),candles:workspace.candles.length})`);
      const before = await view();
      await js('workspace.marketHistoryReady=false;workspace.recoverMarketHistory(workspace.loadGeneration)');
      await settle();
      const after = await view();
      assert.equal(after.candles, 500); assert.equal(after.auto, false);
      assert.ok(Math.abs(after.x - before.x) < 1, JSON.stringify({ theme, mode, before, after }));
      assert.ok(Math.abs(after.y - before.y) < 1, JSON.stringify({ theme, mode, before, after }));
      report.manualViews.push({ theme, mode, before, after });
    }

    await js(`workspace.chartNavigation.setMode(0);workspace.chartNavigation.reset();
      (()=>{const bar=workspace.candles.at(-1),start=(bar.time+3600)*1000;
      workspace.showAlertSimulation({simulationId:'recovery-qa',triggerBarIndex:19,
        triggerPoint:{time:start+19*3600000,price:bar.close+1},
        generated:{primary:Array.from({length:20},(_,i)=>({time:start+i*3600000,closeTime:start+(i+1)*3600000,
        open:bar.close,close:bar.close+1,high:bar.close+2,low:bar.close-1,volume:1}))}},
        'primary',null,{animate:false,focus:true});})();void 0`);
    await settle();
    const before = await simulationView(); assertSimulation(before);
    await js('workspace.marketHistoryReady=false;workspace.recoverMarketHistory(workspace.loadGeneration)');
    await settle();
    const cachedRecovery = await simulationView(); assertSimulation(cachedRecovery);
    await js('workspace.updateChartData({resetViewport:true});void 0'); await settle();
    const explicitReset = await simulationView(); assertSimulation(explicitReset);
    await js('workspace.detachAlertSimulation();workspace.candles=[];workspace.sourceCandles=[];workspace.clearChart();workspace.marketHistoryReady=false;void 0');
    await js('workspace.recoverMarketHistory(workspace.loadGeneration)'); await settle();
    const emptyRecovery = await simulationView(); assertSimulation(emptyRecovery);
    await fs.promises.writeFile(path.join(output, theme + '-recovered.png'), (await win.webContents.capturePage()).toPNG());
    await js("workspace.alertSimulationState.marketId='BINANCE:FUTURES:RECOVERYOTHERUSDT';workspace.marketHistoryReady=false;workspace.recoverMarketHistory(workspace.loadGeneration)");
    assert.equal(await js('Boolean(workspace.alertSimulationSeries)'), false, 'another market must stay detached');
    report.simulations.push({ theme, before, cachedRecovery, explicitReset, emptyRecovery, mismatchedDetached: true });
    await js("workspace.clearAlertSimulation();primary.splitLayoutId='2-columns';primary.applySplitLayout();void 0");
    for (let i = 0; i < 100 && !await js('primary.splitPanes[0]?.candles.length'); i++) await pause(50);
    await js('clearTimeout(primary.splitPanes[0].refreshTimer);primary.splitPanes[0].refreshTimer=null;void 0');
    for (const subject of ['main', 'split']) {
      await js(`window.workspace=${subject === 'main' ? 'primary' : 'primary.splitPanes[0]'};
        workspace.chartNavigation.setMode(0);workspace.chartElement.focus();void 0`);
      const key = (code, value, extra = {}) => js(`(()=>{const e=new KeyboardEvent('keydown',{
        key:${JSON.stringify(value)},code:${JSON.stringify(code)},altKey:true,bubbles:true,cancelable:true,...${JSON.stringify(extra)}});
        workspace.chartElement.dispatchEvent(e);return {consumed:e.defaultPrevented,
        mode:workspace.chart.priceScale('right',0).options().mode,inverted:workspace.chart.priceScale('right',0).options().invertScale}})()`);
      const log = await key('KeyL', '¬'); assert.equal(log.consumed, true); assert.equal(log.mode, 1);
      const percent = await key('KeyP', 'π'); assert.equal(percent.consumed, true); assert.equal(percent.mode, 2);
      const invert = await key('KeyI', 'Dead'); assert.equal(invert.consumed, true); assert.equal(invert.inverted, true);
      await key('KeyI', 'ˆ');
      await js("workspace.chart.timeScale().setVisibleLogicalRange({from:100,to:140});void 0"); await settle();
      const reset = await key('KeyR', '®'); assert.equal(reset.consumed, true); await settle();
      const resetRange = await js('workspace.chart.timeScale().getVisibleLogicalRange()');
      assert.ok(resetRange.to > 490, JSON.stringify(resetRange));
      for (const extra of [{ isComposing: true }, { ctrlKey: true }, { metaKey: true }]) {
        const ignored = await key('KeyL', '¬', extra); assert.equal(ignored.consumed, false); assert.equal(ignored.mode, 2);
      }
      const editable = await js(`(()=>{const input=document.createElement('input');workspace.chartElement.append(input);
        const e=new KeyboardEvent('keydown',{key:'¬',code:'KeyL',altKey:true,bubbles:true,cancelable:true});
        input.dispatchEvent(e);input.remove();return e.defaultPrevented})()`);
      assert.equal(editable, false);
      report.shortcuts.push({ theme, subject, log, percent, invert, resetRange, isolated: true });
    }
    assert.equal(await js('window.qaError || null'), null);
    await js('primary.destroy()');
  }
  assert.deepEqual(report.errors, []);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, simulations: report.simulations.length,
    manualViews: report.manualViews.length, shortcuts: report.shortcuts.length, output }));
  win.destroy(); app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
