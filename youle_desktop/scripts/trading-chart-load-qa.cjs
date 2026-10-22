// Deterministic high-load navigation/drawing acceptance, no account or network
// trading. Run from the repository root with Vite on 5183 and Electron's CLI.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), label = process.argv[2] || 'after';
const output = path.resolve(root, process.env.CHART_QA_OUTPUT || '.cache/chart-load-20261018');
const cpuRate = Number(process.env.CHART_QA_CPU_RATE || 1);
if (process.env.CHART_QA_DISABLE_GPU === '1') app.disableHardwareAcceleration();
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile-' + label));
const pause = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  setTimeout(() => { console.error('load QA timed out'); app.exit(1); }, 240000).unref();
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1440, height: 960,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = source => win.webContents.executeJavaScript(source, true), debug = win.webContents.debugger;
  win.webContents.on('console-message', e => { if (e.level === 'error') console.error(e.message.slice(0,500)); });
  const settle = () => js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  debug.attach('1.3'); await win.loadURL('about:blank');
  if (process.argv.includes('--baseline')) {
    const ts = require('typescript');
    const transformed = await (await fetch('http://127.0.0.1:5183/trading-expert-market.ts')).text();
    const library = 'http://127.0.0.1:5183' + transformed.match(/from "([^"]*lightweight-charts[^\"]*)"/)[1];
    const baselineDir = process.env.CHART_QA_BASELINE_DIR ? path.resolve(root,process.env.CHART_QA_BASELINE_DIR) : path.join(output,'baseline');
    const names = process.env.CHART_QA_BASELINE_DIR ? fs.readdirSync(baselineDir).filter(n=>n.endsWith('.ts')) : ['trading-expert-market.ts', 'trading-expert-split-pane.ts'];
    const sources = new Map(names.map(name => {
      const source = fs.readFileSync(path.join(baselineDir, name), 'utf8');
      // The fixture imports its workspace from a Blob, so resolve relative imports.
      const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
        .replaceAll('from "./', 'from "http://127.0.0.1:5183/').replaceAll("from './", "from 'http://127.0.0.1:5183/")
        .replaceAll('from "../', 'from "http://127.0.0.1:5183/@fs/' + root.replaceAll('\\','/') + '/src/').replaceAll("from '../", "from 'http://127.0.0.1:5183/@fs/" + root.replaceAll('\\','/') + '/src/')
        .replaceAll('from "lightweight-charts"', 'from ' + JSON.stringify(library));
      return [name, code];
    }));
    if(process.env.CHART_QA_BASELINE_DIR){
      const transformedLibrary=await(await fetch(library)).text();
      const canvas='http://127.0.0.1:5183'+transformedLibrary.match(/from ["']([^"']*fancy-canvas[^"']*)["']/)[1];
      const original=fs.readFileSync(process.env.CHART_QA_BASELINE_LIBRARY || path.join(path.dirname(require.resolve('lightweight-charts/package.json')),'dist/lightweight-charts.development.mjs'),'utf8');
      sources.set('lightweight-charts.development.mjs',original.replace("from 'fancy-canvas'",'from '+JSON.stringify(canvas)));
    }
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
  await win.loadURL('http://127.0.0.1:5183/@fs/' + path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/'));
  for (let i = 0; i < 200 && !await js('Boolean(window.ready)'); i++) {
    const error = await js('window.qaError'); if (error) throw new Error(error); await pause(100);
  }
  assert.equal(await js('Boolean(window.ready)'), true);
  await js(`window.w=workspace;window.d=w.drawingController;
    clearInterval(w.pollTimer);clearInterval(w.candlePollTimer);w.favoriteTickerGeneration++;w.closeFavoriteTickerStreams();w.closeSocket();w.cancelScheduledLiveChartPaint();w.loadingHistory=true;
    const original=w.candles;w.candles=Array.from({length:5000},(_,i)=>({...original[i%original.length],time:original[0].time+(i-4500)*3600}));
    w.activeMainIndicators=['ma','ema','boll','bbi'];w.applyMainIndicatorSeriesOptions();w.updateChartData({resetViewport:true});
    window.qaTicks=0;window.qaLive=setInterval(()=>{qaTicks++;const c=w.candles.at(-1);c.close=1330+Math.sin(qaTicks/10)*5;c.high=Math.max(c.high,c.close);c.low=Math.min(c.low,c.close);w.scheduleLiveChartPaint()},50);
    window.qaRunning=false;window.qaFrames=[];window.qaStart=0;window.qaLong=[];window.qaMutations=0;window.qaMetrics={};window.qaLast=0;
    window.qaObserver=new PerformanceObserver(l=>{if(qaRunning)qaLong.push(...l.getEntries().filter(e=>e.startTime>=qaStart).map(e=>({start:e.startTime,ms:e.duration})))});qaObserver.observe({type:'longtask'});
    new MutationObserver(records=>{if(qaRunning)qaMutations+=records.reduce((n,r)=>n+r.addedNodes.length+r.removedNodes.length,0)}).observe(w.mainIndicatorLegendElement,{childList:true,subtree:true});
    for(const [target,names]of [[w,['updateChartData','paintLatestCandle','updateMainIndicatorData','updateIndicatorData','updateMainIndicatorLegends','paintCrosshair']],[d,['redraw','redrawDraggedDrawing']]])for(const name of names){const fn=target[name];if(!fn)continue;target[name]=function(...args){const start=performance.now();try{return fn.apply(this,args)}finally{if(qaRunning){const m=qaMetrics[name]??={count:0,ms:0,max:0};const t=performance.now()-start;m.count++;m.ms+=t;m.max=Math.max(m.max,t)}}}}
    function tick(t){if(qaRunning&&qaLast)qaFrames.push(t-qaLast);qaLast=t;requestAnimationFrame(tick)}requestAnimationFrame(tick);void 0`);
  const report = { label, cpuRate, candles: 5000, drawings: 300, indicators: ['ma','ema','boll','bbi'], liveHz: 20, cases: [], failures: [] };
  await debug.sendCommand('Emulation.setCPUThrottlingRate', { rate: cpuRate });
  for (const theme of process.env.CHART_QA_THEMES?.split(',') || ['light','dark']) for (const action of process.env.CHART_QA_ACTIONS?.split(',') || ['pan','wheel','endpoint','preview']) {
    await js(`document.documentElement.dataset.theme='${theme}';d.cancelDraft();d.cancelSelectionDrag();d.selectTool('crosshair');
      d.drawings=Array.from({length:300},(_,i)=>({id:'load-'+i,tool:'trend-line',symbol:d.getSymbol(),interval:d.getInterval(),points:[{time:w.candles.at(-110).time,price:1290+i*.12},{time:w.candles.at(-30).time,price:1320+i*.12}]}));
      w.chartNavigation.reset();d.selectedDrawingId=${action === 'endpoint' ? "'load-0'" : 'null'};d.redraw();void 0`);
    await pause(300); await settle();
    if (action === 'preview') await js("d.selectTool('trend-line')");
    const p = await js(`(()=>{const r=d.overlay.getBoundingClientRect();const p=${action === 'endpoint' ? 'd.pointToScreen(d.drawings[0].points[1])' : '{x:160,y:110}'};return {x:Math.round(r.left+p.x),y:Math.round(r.top+p.y)}})()`);
    win.webContents.sendInputEvent({ type:'mouseMove',...p });
    if (action !== 'wheel') win.webContents.sendInputEvent({ type:'mouseDown',...p,button:'left',clickCount:1 });
    if (action === 'preview') win.webContents.sendInputEvent({ type:'mouseUp',...p,button:'left',clickCount:1 });
    await settle();
    assert.ok(await js(action === 'endpoint' ? '!!d.dragState' : action === 'preview' ? '!!d.draft' : action === 'pan' ? '!!w.chartNavigation.drag' : 'true'), action + ' must start');
    if (process.argv.includes('--profile')) { await debug.sendCommand('Profiler.enable'); await debug.sendCommand('Profiler.start'); }
    const before = await perf();
    await js('qaFrames=[];qaLong=[];qaMetrics={};qaMutations=0;qaStart=performance.now();qaLast=0;qaRunning=true;window.qaTicksBefore=qaTicks');
    for (let i=1;i<=120;i++) {
      if (action === 'wheel') win.webContents.sendInputEvent({type:'mouseWheel',...p,deltaY:i%24<12?8:-8,deltaX:0});
      else win.webContents.sendInputEvent({type:'mouseMove',x:p.x+Math.round(Math.sin(i/20)*70),y:p.y+Math.round(Math.sin(i/25)*40),
        ...(action==='preview'?{}:{button:'left',modifiers:['leftButtonDown']})});
      await pause(8);
    }
    // Include the last submitted input's paint, even when it was queued behind
    // a long task. Do not end the sample at input dispatch or drop that gap.
    await settle();
    const result = await js(`(()=>{qaLong.push(...qaObserver.takeRecords().filter(e=>e.startTime>=qaStart).map(e=>({start:e.startTime,ms:e.duration})));qaRunning=false;const a=qaFrames.toSorted((a,b)=>a-b);return {durationMs:performance.now()-qaStart,frames:a.length,p95:a[Math.floor(a.length*.95)],max:a.at(-1),framesOver50:a.filter(t=>t>50).length,framesOver100:a.filter(t=>t>100).length,longTasks:qaLong,legendMutations:qaMutations,metrics:qaMetrics,ticks:qaTicks-qaTicksBefore}})()`);
    const after = await perf();
    if (process.argv.includes('--profile')) fs.writeFileSync(path.join(output,`${label}-${theme}-${action}-cpu.json`),JSON.stringify(await debug.sendCommand('Profiler.stop')));
    const item={theme,action,...result,layoutMs:(after.LayoutDuration-before.LayoutDuration)*1000,scriptMs:(after.ScriptDuration-before.ScriptDuration)*1000};
    report.cases.push(item);console.log(JSON.stringify(item));
    if (!(item.p95 < 50 && item.max < 180 && item.frames > 25 && item.ticks >= 10)) report.failures.push({theme,action});
    fs.writeFileSync(path.join(output,label+'.json'),JSON.stringify(report,null,2));
    if (action === 'preview') await js('d.cancelDraft()');
    else if (action !== 'wheel') win.webContents.sendInputEvent({type:'mouseUp',x:p.x+Math.round(Math.sin(6)*70),y:p.y+Math.round(Math.sin(4.8)*40),button:'left',clickCount:1});
    await settle();
  }
  await debug.sendCommand('Emulation.setCPUThrottlingRate', { rate: 1 });
  debug.detach();
  fs.writeFileSync(path.join(output,label+'.png'),(await win.webContents.capturePage()).toPNG());
  assert.equal(await js('window.qaError??null'),null);
  await js('clearInterval(qaLive);w.destroy()');win.destroy();
  if (!process.argv.includes('--baseline')) assert.deepEqual(report.failures,[], 'high-load frame acceptance');
  console.log(JSON.stringify({passed:report.failures.length===0,cases:report.cases.length}));app.exit(0);
})().catch(e=>{console.error(e);app.exit(1)});
