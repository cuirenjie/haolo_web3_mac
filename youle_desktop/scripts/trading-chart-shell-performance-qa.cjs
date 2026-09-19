// Full desktop renderer (including global observers), isolated profile and
// synthetic REST + 20 Hz live trades. No account, trading or model calls.
// Start Vite on 5177; run: node node_modules/electron/cli.js scripts/trading-chart-shell-performance-qa.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const output = path.resolve(__dirname, '../.cache/chart-shell-performance');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
const delay = ms => new Promise(r => setTimeout(r, ms));
function installMarketFixture() {
  let desktop;
  const subscriptions = new Map();
  let sequence = 0;
  window.fixtureTicks = 0;
  Object.defineProperty(window, 'codexDesktop', { configurable: true, get: () => desktop, set(api) {
    desktop = api;
    api.getBinancePublicMarketData = async request => {
      const p = request.parameters || {}, symbol = p.symbol || 'BTCUSDT';
      if (request.path.endsWith('/klines')) {
        const step = p.interval === '1d' ? 86400000 : p.interval === '4h' ? 14400000 : 3600000;
        const count = Number(p.limit) || 500;
        const end = Math.floor(Math.min(Date.now(), Number(p.endTime) || Date.now()) / step) * step;
        return { ok: true, status: 200, data: Array.from({ length: count }, (_, i) => {
          const t = end - (count - 1 - i) * step, o = 81000 + Math.sin(i / 9) * 800, c = o + Math.sin(i) * 150;
          return [t, String(o), String(Math.max(o, c) + 100), String(Math.min(o, c) - 100), String(c), '2000', t + step - 1, '0', 1, '0', '0', '0'];
        }) };
      }
      if (request.path.endsWith('/exchangeInfo')) return { ok: true, status: 200, data: { symbols: ['BTCUSDT', 'ETHUSDT'].map(symbol => ({ symbol, baseAsset: symbol.slice(0, -4), quoteAsset: 'USDT', status: 'TRADING', contractType: 'PERPETUAL' })) } };
      if (request.path.includes('/ticker/')) {
        const data = { symbol, lastPrice: '81000', openPrice: '80000', highPrice: '82500', lowPrice: '79500', quoteVolume: '1000000' };
        return { ok: true, status: 200, data: p.symbol ? data : [data] };
      }
      return { ok: true, status: 200, data: request.path.includes('premiumIndex') ? { markPrice: '81000', lastFundingRate: '0.0001', nextFundingTime: Date.now() + 3600000 } : [] };
    };
    api.subscribeBinanceMarketStreams = async (params, callback) => {
      const subscriptionId = String(++sequence); subscriptions.set(subscriptionId, { params, callback });
      return { subscriptionId };
    };
    api.unsubscribeBinanceMarketStreams = async params => { subscriptions.delete(params.subscriptionId); return { removed: true }; };
  } });
  setInterval(() => {
    window.fixtureTicks++;
    for (const { params, callback } of subscriptions.values()) {
      if (typeof callback !== 'function') continue;
      for (const stream of params.streams || []) if (stream.includes('@aggTrade')) {
        callback({ type: 'data', stream, data: { e: 'aggTrade', s: stream.split('@')[0].toUpperCase(), p: String(81000 + Math.sin(fixtureTicks / 10) * 10), T: Date.now(), E: Date.now() } });
      }
    }
  }, 50);
}
(async () => {
  setTimeout(() => { console.error('QA timed out'); app.exit(1); }, 120000).unref();
  await app.whenReady();
  console.log('electron ready');
  const win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = s => win.webContents.executeJavaScript(s, true), debug = win.webContents.debugger;
  debug.attach('1.3');
  console.log('debugger attached');
  win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message.slice(0, 250)); });
  await win.loadURL('about:blank');
  await debug.sendCommand('Page.enable');
  await debug.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(${installMarketFixture})()` });
  console.log('market fixture installed');
  await win.webContents.session.clearStorageData();
  await win.loadURL('http://127.0.0.1:5177/?i18n-layout-qa=1');
  console.log('desktop loaded');
  await delay(3500);
  const attachCharts = async () => {
    const { result } = await debug.sendCommand('Runtime.evaluate', { expression: "import('/trading-chart-navigation.ts').then(m=>m.TradingChartNavigation.prototype)", awaitPromise: true });
    const { objects } = await debug.sendCommand('Runtime.queryObjects', { prototypeObjectId: result.objectId });
    await debug.sendCommand('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function(){window.qaNavs=this.filter(n=>n.element.isConnected).sort((a,b)=>a.element.getBoundingClientRect().left-b.element.getBoundingClientRect().left)}' });
    await debug.sendCommand('Runtime.releaseObject', { objectId: objects.objectId });
  };
  await attachCharts();
  console.log('chart attached');
  assert.ok(await js('qaNavs[0].options.getCandles().length >= 500'));
  await js(`document.querySelector('[data-market-action="select-split-layout"][data-market-layout="2-columns"]').click()`);
  await delay(1800); await attachCharts();
  console.log('split charts attached');
  assert.equal(await js('qaNavs.length'), 2);
  await js(`window.qaRunning=false;window.qaFrames=[];window.qaEvents=[];window.qaLong=[];window.qaPaints=[];
    new PerformanceObserver(l=>{if(qaRunning)qaLong.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration})))}).observe({type:'longtask'});
    window.addEventListener('pointermove',e=>{if(qaRunning)qaEvents.push({t:performance.now(),x:e.clientX,y:e.clientY,lag:performance.now()-e.timeStamp})},true);
    window.qaFrameNumber=0;
    const originalFill=CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect=function(...args){if(qaRunning&&this.canvas===window.qaCanvas&&qaPaints.at(-1)!==qaFrameNumber)qaPaints.push(qaFrameNumber);return originalFill.apply(this,args)};
    function tick(t){qaFrameNumber++;if(qaRunning){const last=qaEvents.at(-1);qaFrames.push({t,x:qaChart.timeScale().timeToCoordinate(qaAnchorTime),y:qaPriceSeries.priceToCoordinate(qaAnchorPrice),pointerX:last?.x,pointerY:last?.y,lag:last?t-last.t:0})}requestAnimationFrame(tick)}requestAnimationFrame(tick);void 0`);
  const report = { cases: [], labels: [], markerLifecycle: [], output };
  for (const theme of ['light', 'dark']) {
    await js(`document.documentElement.dataset.theme='${theme}';document.documentElement.style.setProperty('--app-font-size-offset','${theme === 'dark' ? 3 : 0}px')`);
    await delay(250);
    for (const subject of [0, 1]) {
      await js(`window.qaNav=qaNavs[${subject}];window.qaChart=qaNav.getChart();qaNav.reset();window.qaAnchorTime=qaNav.options.getCandles().at(-50).time+28800;window.qaAnchorPrice=qaNav.options.getCandles().at(-50).close;window.qaPriceSeries=qaChart.panes()[0].getSeries().find(s=>s.seriesType()==='Candlestick');window.qaCanvas=qaChart.panes()[0].getHTMLElement().querySelector('td:nth-child(2) canvas');void 0`);
      await delay(250);
      const p = await js(`(()=>{const r=qaChart.panes()[0].getHTMLElement().getBoundingClientRect();return {x:Math.round(r.left+100),y:Math.round(r.top+150)}})()`);
      for (const action of ['horizontal', 'diagonal', 'wheel']) {
        await js('qaFrames=[];qaEvents=[];qaLong=[];qaPaints=[];qaRunning=true;window.qaStartTicks=fixtureTicks');
        if (process.argv.includes('--profile')) { await debug.sendCommand('Profiler.enable'); await debug.sendCommand('Profiler.start'); }
        win.webContents.sendInputEvent({ type: 'mouseMove', ...p });
        if (action !== 'wheel') win.webContents.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 });
        for (let i = 1; i <= 120; i++) {
          if (action === 'wheel') win.webContents.sendInputEvent({ type: 'mouseWheel', ...p, deltaY: i % 24 < 12 ? 8 : -8, deltaX: 0 });
          else win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x + Math.round(Math.sin(i / 20) * 65), y: p.y + (action === 'diagonal' ? Math.round(Math.sin(i / 25) * 50) : 0), button: 'left', modifiers: ['leftButtonDown'] });
          await delay(8);
        }
        // Sample before releasing the button: a chart that only jumps on mouseup fails.
        const data = await js('qaRunning=false;({frames:qaFrames,events:qaEvents,long:qaLong,paints:qaPaints,ticks:fixtureTicks-qaStartTicks})');
        if (process.argv.includes('--profile')) fs.writeFileSync(path.join(output, 'cpu.json'), JSON.stringify(await debug.sendCommand('Profiler.stop')));
        if (action !== 'wheel') win.webContents.sendInputEvent({ type: 'mouseUp', ...p, button: 'left', clickCount: 1 });
        const gaps = data.frames.slice(1).map((f, i) => f.t - data.frames[i].t).sort((a, b) => a - b);
        const changes = data.frames.slice(1).filter((f, i) => f.x !== data.frames[i].x);
        const moves = data.frames.filter(f => Number.isFinite(f.pointerX) && Number.isFinite(f.x)).slice(5);
        const offsets = moves.map(f => f.x - f.pointerX).sort((a, b) => a - b), median = offsets[Math.floor(offsets.length / 2)];
        const errors = moves.map(f => Math.abs(f.x - f.pointerX - median)).sort((a, b) => a - b);
        const yOffsets = moves.map(f => f.y - f.pointerY).sort((a, b) => a - b), yMedian = yOffsets[Math.floor(yOffsets.length / 2)];
        const yErrors = moves.map(f => Math.abs(f.y - f.pointerY - yMedian)).sort((a, b) => a - b);
        const result = { theme, subject, action, candles: await js('qaNav.options.getCandles().length'), frames: data.frames.length, paints: data.paints.length, changes: changes.length, ticks: data.ticks, p95: gaps[Math.floor(gaps.length * .95)], maxGap: gaps.at(-1), trackingErrorP95: errors[Math.floor(errors.length * .95)], verticalErrorP95: yErrors[Math.floor(yErrors.length * .95)], longTasks: data.long };
        console.log(JSON.stringify(result)); report.cases.push(result);
        assert.ok(result.changes > 25 && result.paints > 25, 'canvas must repaint continuously while the button is held');
        assert.ok(result.p95 < 50 && result.maxGap < 180, 'sustained input must not stall');
        if (action !== 'wheel') assert.ok(result.trackingErrorP95 < 9, 'candles must follow mouse displacement within one input step');
        if (action === 'diagonal') assert.ok(result.verticalErrorP95 < 9, 'price movement must follow vertical mouse displacement');
        assert.ok(result.ticks >= 10, 'live trades must remain active during navigation');
        await js('qaNav.reset()'); await delay(150);
      }
    }
    for (const subject of [0, 1]) {
      await js(`window.qaNav=qaNavs[${subject}];window.qaChart=qaNav.getChart();window.qaSeries=qaChart.panes()[0].getSeries().find(s=>s.seriesType()==='Candlestick');window.qaOriginalData=qaSeries.data;window.qaDataReads=0;qaSeries.data=function(...args){qaDataReads++;return qaOriginalData.apply(this,args)};void 0`);
      for (const enabled of [true, false]) {
        await js(subject === 0 ? `document.querySelector('[data-market-main-indicator="td"]').click()` : `qaNav.element.closest('.trading-market-split-pane').querySelector('[data-split-main-indicator="td"]').click()`);
        await delay(250); await js('qaDataReads=0');
        for (let i = 0; i < 8; i++) { await js(`qaChart.timeScale().scrollToPosition(${i},false)`); await delay(20); }
        const reads = await js('qaDataReads');
        assert.ok(enabled ? reads > 0 : reads === 0, `TD lifecycle ${subject}: ${enabled}, reads: ${reads}`);
        report.markerLifecycle.push({ theme, subject, enabled, reads });
      }
      await js('qaSeries.data=qaOriginalData;qaNav.reset()');
    }
    // Force the custom timestamp label to the left edge in each font/theme.
    const edge = await js(`(()=>{const r=qaNavs[0].getChart().panes()[0].getHTMLElement().getBoundingClientRect();return {x:Math.round(r.left+8),y:Math.round(r.top+120)}})()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...edge }); await delay(150);
    // Shared label changes must remain inside their pane, including larger fonts.
    const labels = await js(`Array.from(document.querySelectorAll('.trading-market-extrema-label:not([hidden]),.trading-market-crosshair-time:not([hidden])')).map(e=>{const r=e.getBoundingClientRect(),p=e.closest('.trading-market-chart-viewport,.trading-market-split-viewport').getBoundingClientRect();return {kind:e.className,width:r.width,inside:r.left>=p.left-1&&r.right<=p.right+1&&r.top>=p.top-1&&r.bottom<=p.bottom+1,color:getComputedStyle(e).color}})`);
    assert.ok(labels.length >= 4 && labels.every(l => l.inside && l.width > 0)); report.labels.push({ theme, labels });
    fs.writeFileSync(path.join(output, `${theme}.png`), (await win.webContents.capturePage()).toPNG());
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, cases: report.cases.length, output }));
  win.destroy(); app.exit(0);
})().catch(e => { console.error(e); app.exit(1); });
