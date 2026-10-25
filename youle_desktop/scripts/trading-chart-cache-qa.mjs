// Run from the repository root: node youle_desktop/scripts/trading-chart-cache-qa.mjs
// Real Chromium disk cache, a persistent profile, full renderer, and native input.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const libraryPath = path.join(path.dirname(require.resolve('lightweight-charts/package.json')), 'dist/lightweight-charts.development.mjs');
const normalized = libraryPath.replaceAll('\\', '/');

async function rendererProbe() {
  const { app, BrowserWindow } = require('electron');
  const [directory, phase, origin] = process.argv.slice(2);
  app.setPath('userData', path.join(directory, 'profile'));
  let stage = 'app.ready';
  const timeout = setTimeout(() => { console.error('chart cache renderer timed out at ' + stage); app.exit(1); }, 45000);
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1296, height: 876,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({
    cancel: !details.url.startsWith(origin + '/') && !/^(blob:|data:|devtools:)/.test(details.url),
  }));
  const debug = win.webContents.debugger;
  debug.attach('1.3');
  const responses = [];
  debug.on('message', (_event, method, params) => {
    if (method === 'Network.responseReceived' && params.response.url.includes('lightweight-charts.development.mjs')) {
      const r = params.response;
      responses.push({ url: r.url, fromDiskCache: !!r.fromDiskCache, cacheControl: r.headers['Cache-Control'] ?? r.headers['cache-control'] });
    }
  });
  stage = 'page load';
  // Deliberately no cache disabling, clearing, reloadIgnoringCache, or fresh profile.
  const loaded = win.loadURL(origin + '/?i18n-layout-qa=1');
  await debug.sendCommand('Network.enable');
  await loaded;
  stage = 'main UI';
  const js = expression => win.webContents.executeJavaScript(expression, true);
  await pause(2500);
  await js("document.querySelector('.settings-close-button')?.click(); void 0");
  stage = 'navigation prototype';
  const proto = await debug.sendCommand('Runtime.evaluate', {
    expression: "import('/trading-chart-navigation.ts').then(m=>m.TradingChartNavigation.prototype)", awaitPromise: true,
  });
  const objects = await debug.sendCommand('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId });
  stage = 'navigation instances';
  await debug.sendCommand('Runtime.callFunctionOn', { objectId: objects.objects.objectId,
    functionDeclaration: 'function(){window.qaNav=Array.from(this).find(n=>n.element.isConnected && n.element.getBoundingClientRect().width>300)}' });
  assert.ok(await js('!!window.qaNav'), 'full main window chart is mounted');
  stage = 'native drag';
  await js(`window.qaChart=qaNav.getChart();
    window.qaSeries=qaChart.panes()[0].getSeries().find(s=>s.seriesType()==='Candlestick');
    qaSeries.setData(Array.from({length:500},(_,i)=>{const open=1300+Math.sin(i/9)*25+i/20,close=open+Math.sin(i)*4;return {time:1700000000+i*3600,open,close,high:Math.max(open,close)+2,low:Math.min(open,close)-2}}));
    qaChart.timeScale().setVisibleLogicalRange({from:380,to:510});qaNav.setAutoScale(true);void 0`);
  const result = { phase, responses, pan: await js('typeof qaChart.haoloPanByPixels'), drags: [] };
  fs.writeFileSync(path.join(directory, phase + '.json'), JSON.stringify(result, null, 2));
  for (const dy of [0, 3]) {
    await js(`qaNav.cancelGesture();qaChart.timeScale().setVisibleLogicalRange({from:380,to:510});
      window.qaRelease=null;
      window.addEventListener('pointerup',()=>{qaRelease={offset:qaChart.timeScale().scrollPosition(),coasting:!!qaNav.coasting}},{once:true});
      void 0`);
    await pause(100);
    const point = await js(`(()=>{const r=qaChart.panes()[0].getHTMLElement().getBoundingClientRect();return {x:Math.round(r.left+90),y:Math.round(r.top+90)}})()`);
    const input = (type, x, y) => win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1,
      ...(type === 'mouseMove' ? { modifiers: ['leftButtonDown'] } : {}) });
    input('mouseMove', point.x, point.y); input('mouseDown', point.x, point.y);
    for (let i = 1; i <= 8; i++) { input('mouseMove', point.x + i * 8, point.y + i * dy); await pause(16); }
    input('mouseUp', point.x + 64, point.y + 8 * dy);
    await pause(180);
    const drag = await js('({release:qaRelease,offset:qaChart.timeScale().scrollPosition()})');
    assert.ok(drag.release, 'native pointerup was handled');
    if (phase.startsWith('legacy')) {
      assert.equal(result.pan, 'undefined'); assert.equal(drag.release.coasting, false);
    } else {
      assert.equal(result.pan, 'function'); assert.equal(drag.release.coasting, true);
      assert.ok(drag.offset < drag.release.offset - 0.5, 'full main window continues panning after release');
    }
    result.drags.push({ dy, ...drag });
  }
  assert.equal(responses.length, 1, 'one chart library version per page');
  fs.writeFileSync(path.join(directory, phase + '.json'), JSON.stringify(result, null, 2));
  if (phase === 'fixed-upgrade') fs.writeFileSync(path.join(directory, 'full-main.png'), (await win.webContents.capturePage()).toPNG());
  await pause(500);
  debug.detach(); win.destroy(); clearTimeout(timeout); app.quit();
}

async function cacheUpgradeRegression() {
  const { createServer } = await import('vite');
  const { default: config } = await import('../vite.config.mjs');
  const { patchTradingChartLibrary, tradingChartLibraryPlugin } = await import('./trading-chart-library-patch.mjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haolo-chart-cache-qa-'));
  console.log('Evidence:', directory);
  const upstream = fs.readFileSync(libraryPath, 'utf8');
  const current = patchTradingChartLibrary(upstream);
  // Model the pre-inertia API contract, while keeping this regression independent
  // of Git history and without checking in a multi-megabyte vendor snapshot.
  const from = current.indexOf('    haoloPanByPixels('), to = current.indexOf('    haoloBatchUpdates(paint)', from);
  assert.ok(from > 0 && to > from);
  const old = current.slice(0, from) + current.slice(to);
  const adapter = fs.readFileSync(new URL('./trading-chart-library-patch.mjs', import.meta.url), 'utf8');
  const futurePath = path.join(directory, 'future-adapter.mjs');
  fs.writeFileSync(futurePath, adapter.replace('  return source;', '  return source + "\\n// cache-qa-next-adapter";'));
  const future = (await import(pathToFileURL(futurePath).href)).tradingChartLibraryPlugin;
  const report = [];
  let port = Number(process.env.HAOLO_CHART_CACHE_QA_PORT || 5186);
  assert.notEqual(port, 5177, 'cache regression must not use the running development server');
  // The first cold Vite scan uses a temporary dependency hash. Prime it before
  // testing a restart with the stable metadata used by an established dev app.
  for (const phase of ['legacy-prime', 'legacy-warm', 'legacy-stale', 'fixed-upgrade', 'fixed-warm', 'fixed-restart', 'future-upgrade']) {
    let plugin;
    if (phase.startsWith('legacy')) {
      plugin = { name: 'haolo-retained-chart-render-points', enforce: 'pre',
        config: () => ({ resolve: { alias: [{ find: /^lightweight-charts$/, replacement: normalized }] } }),
        transform: (_source, id) => id.replaceAll('\\', '/').split('?')[0] === normalized
          ? { code: phase === 'legacy-stale' ? current : old, map: null } : null };
    } else plugin = (phase === 'future-upgrade' ? future : tradingChartLibraryPlugin)(libraryPath);
    const server = await createServer({ ...config, configFile: false, plugins: [plugin],
      cacheDir: path.join(directory, 'vite'), server: { ...config.server, port, strictPort: true, hmr: false } });
    let requests = 0;
    server.httpServer.on('request', request => { if (request.url.includes('lightweight-charts.development.mjs')) requests++; });
    try {
      await server.listen(); port = server.httpServer.address().port;
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      await new Promise((resolve, reject) => {
        const child = spawn(require('electron'), [fileURLToPath(import.meta.url), directory, phase, `http://127.0.0.1:${port}`],
          { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        let output = '';
        child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
        child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${phase}: ${code}\n${output}`)));
      });
      const result = JSON.parse(fs.readFileSync(path.join(directory, phase + '.json'), 'utf8'));
      report.push({ ...result, requests });
      console.log(phase, JSON.stringify({ pan: result.pan, fromDiskCache: result.responses[0].fromDiskCache, requests }));
    } finally { await server.close(); }
  }
  const [prime, warm, stale, fixed, fixedWarm, restart, next] = report;
  assert.equal(prime.responses[0].fromDiskCache, false);
  assert.match(warm.responses[0].cacheControl, /immutable/);
  assert.equal(stale.responses[0].url, warm.responses[0].url);
  assert.equal(stale.responses[0].fromDiskCache, true, 'reproduce stale adapter across Electron/Vite restarts');
  assert.equal(stale.requests, 0, 'the updated legacy server is bypassed by disk cache');
  assert.notEqual(fixed.responses[0].url, stale.responses[0].url);
  assert.ok(new URL(fixed.responses[0].url).searchParams.get('haolo_chart'));
  assert.equal(fixed.responses[0].fromDiskCache, false);
  assert.equal(new URL(restart.responses[0].url).searchParams.get('haolo_chart'), new URL(fixed.responses[0].url).searchParams.get('haolo_chart'));
  assert.equal(restart.responses[0].url, fixedWarm.responses[0].url);
  assert.equal(restart.responses[0].cacheControl, 'no-cache', 'versioned adapter revalidates rewritten dependency imports');
  assert.equal(restart.requests, 1, 'unchanged adapter checks the server on restart');
  assert.notEqual(new URL(next.responses[0].url).searchParams.get('haolo_chart'), new URL(fixed.responses[0].url).searchParams.get('haolo_chart'));
  assert.equal(next.responses[0].fromDiskCache, false, 'adapter-only future upgrade bypasses older immutable entry');
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log('PASS: legacy failure reproduced; upgrade, restart and future adapter update passed with the same disk cache.');
}

// Do not hold Electron's ESM entry evaluation open while awaiting app.ready.
(process.versions.electron ? rendererProbe() : cacheUpgradeRegression()).catch(error => {
  console.error(error); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1;
});
