// Isolated renderer, synthetic candles and native Electron pointer input.
// Start Vite on 5183. Run from the repository root with Electron's CLI.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const label = process.argv[2] || 'after';
const output = path.join(root, '.cache/chart-smoothness-20261018');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'drawing-profile'));
if (!process.argv.includes('--gpu')) app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  setTimeout(() => { console.error('drawing QA timed out'); app.exit(1); }, 150000).unref();
  await app.whenReady();
  console.log('drawing QA ready');
  const win = new BrowserWindow({ show: false, width: 1440, height: 960,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = source => win.webContents.executeJavaScript(source, true);
  const settle = () => js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const debug = win.webContents.debugger;
  debug.attach('1.3');
  await win.loadURL('about:blank');
  // Read the two originally clean modules from Git into this isolated page.
  // This compares the same GPU/workload without reverting the working tree.
  if (process.argv.includes('--baseline')) {
    const { execFileSync } = require('node:child_process'), ts = require('typescript');
    const sources = new Map(['trading-expert-drawing.ts', 'trading-chart-navigation.ts'].map(name => {
      const source = execFileSync('git', ['show', 'HEAD:youle_desktop/src/renderer/' + name], { cwd: root, encoding: 'utf8' });
      return [name, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText];
    }));
    debug.on('message', async (_event, method, params) => {
      if (method !== 'Fetch.requestPaused') return;
      const source = sources.get(new URL(params.request.url).pathname.split('/').at(-1));
      if (source) await debug.sendCommand('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/javascript; charset=utf-8' }], body: Buffer.from(source).toString('base64') });
      else await debug.sendCommand('Fetch.continueRequest', { requestId: params.requestId });
    });
    await debug.sendCommand('Fetch.enable', { patterns: [...sources.keys()].map(name => ({ urlPattern: '*' + name + '*', requestStage: 'Request' })) });
  }
  await debug.sendCommand('Performance.enable');
  const perf = async () => Object.fromEntries((await debug.sendCommand('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const report = { label, hardwareAcceleration: process.argv.includes('--gpu'), cases: [], errors: [] };
  win.webContents.on('console-message', e => { if (e.level === 'error' && !e.message.includes('Binance market catalog')) report.errors.push(e.message); });
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5183}/@fs/` + path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/'));
  console.log('drawing fixture loaded');
  for (let i = 0; i < 150 && !await js('Boolean(window.ready)'); i++) await pause(100);
  assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
  console.log('drawing workspace ready');
  await js(`window.w=workspace;window.d=w.drawingController;
    clearInterval(w.pollTimer);clearInterval(w.candlePollTimer);w.favoriteTickerGeneration++;w.closeFavoriteTickerStreams();w.closeSocket();w.cancelScheduledLiveChartPaint();w.loadingHistory=true;
    const original=w.candles;w.candles=Array.from({length:5000},(_,i)=>({...original[i%original.length],time:original[0].time+(i-4500)*3600}));w.updateChartData({resetViewport:true});
    window.measuring=false;window.samples=[];window.metrics={};window.mutations=0;
    window.frame=0;window.previous=0;function tick(t){frame++;if(measuring&&previous)samples.push(t-previous);previous=t;requestAnimationFrame(tick)}requestAnimationFrame(tick);
    for(const name of ['redraw','renderDrawing','updateSelectionToolbar','updateToolbarState','pointToScreen','eventScreenPoint']){const original=d[name];d[name]=function(...args){const start=performance.now();try{return original.apply(this,args)}finally{if(measuring){const m=metrics[name]??={count:0,ms:0,maxMs:0};const elapsed=performance.now()-start;m.count++;m.ms+=elapsed;m.maxMs=Math.max(m.maxMs,elapsed)}}}}
    new MutationObserver(records=>{if(measuring)mutations+=records.reduce((n,r)=>n+r.addedNodes.length+r.removedNodes.length,0)}).observe(d.content,{childList:true,subtree:true});void 0`);
  for (const theme of ['light', 'dark']) for (const drawings of [80, 300]) for (const action of ['endpoint', 'preview', 'pan']) {
    if (process.argv.includes('--profile') && (theme !== 'light' || drawings !== 300 || action !== 'pan')) continue;
    await js(`document.documentElement.dataset.theme='${theme}';d.cancelDraft();d.cancelSelectionDrag();d.selectTool('crosshair');
      d.drawings=Array.from({length:${drawings}},(_,i)=>({id:'perf-'+i,tool:'trend-line',symbol:d.getSymbol(),interval:d.getInterval(),points:[{time:w.candles.at(-110).time,price:1290+i*.12},{time:w.candles.at(-30).time,price:1320+i*.12}]}));
      w.chartNavigation.reset();d.selectedDrawingId=${action === 'endpoint' ? "'perf-0'" : 'null'};d.redraw();void 0`);
    await settle();
    if (action === 'preview') await js("d.selectTool('trend-line')");
    const p = await js(`(()=>{const r=d.overlay.getBoundingClientRect();const p=${action === 'endpoint' ? "d.pointToScreen(d.drawings[0].points[1])" : '{x:160,y:110}'};return {x:Math.round(r.left+p.x),y:Math.round(r.top+p.y)}})()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...p });
    win.webContents.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 });
    if (action === 'preview') win.webContents.sendInputEvent({ type: 'mouseUp', ...p, button: 'left', clickCount: 1 });
    await settle();
    const started = await js(`({drag:!!d.dragState,draft:!!d.draft,pan:!!w.chartNavigation.drag})`);
    assert.ok(action === 'endpoint' ? started.drag : action === 'preview' ? started.draft : started.pan, JSON.stringify({ action, started, p }));
    await js("window.kept=d.content.querySelector('[data-drawing-id=\"perf-1\"]');metrics={};samples=[];mutations=0;measuring=true");
    const before = await perf();
    if (process.argv.includes('--profile')) { await debug.sendCommand('Profiler.enable'); await debug.sendCommand('Profiler.start'); }
    for (let i = 1; i <= 60; i++) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x + Math.round(Math.sin(i / 10) * 80), y: p.y + Math.round(Math.sin(i / 15) * 55),
        ...(action === 'preview' ? {} : { button: 'left', modifiers: ['leftButtonDown'] }) });
      await pause(8);
    }
    await settle();
    const after = await perf();
    if (process.argv.includes('--profile')) fs.writeFileSync(path.join(output, label + '-cpu.json'), JSON.stringify(await debug.sendCommand('Profiler.stop')));
    const result = await js(`(()=>{measuring=false;const sorted=samples.toSorted((a,b)=>a-b);return {frames:sorted.length,frameP95:sorted[Math.floor(sorted.length*.95)],maxFrame:sorted.at(-1),metrics,mutations,retained:kept===d.content.querySelector('[data-drawing-id="perf-1"]')}})()`);
    const item = { theme, drawings, action, ...result,
      layoutCount: after.LayoutCount - before.LayoutCount,
      layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
      styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000 };
    report.cases.push(item); console.log(JSON.stringify(item));
    if (action !== 'preview') win.webContents.sendInputEvent({ type: 'mouseUp', x: p.x + Math.round(Math.sin(6) * 80), y: p.y + Math.round(Math.sin(4) * 55), button: 'left', clickCount: 1 });
    else await js('d.cancelDraft()');
    await settle();
    if (label !== 'before' && !process.argv.includes('--baseline') && action !== 'pan') assert.equal(result.retained, true, 'unmodified drawing must retain its DOM');
  }
  await fs.promises.writeFile(path.join(output, label + '-drawing.png'), (await win.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(output, label + '-drawing.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(report.errors, []);assert.equal(await js('window.qaError??null'),null);
  await js('w.destroy()'); win.destroy();app.exit(0);
})().catch(e => { console.error(e);app.exit(1); });
