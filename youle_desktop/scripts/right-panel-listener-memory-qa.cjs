// Run from the canonical repository root with Vite running on port 5177:
// node youle_desktop/node_modules/electron/cli.js youle_desktop/scripts/right-panel-listener-memory-qa.cjs
// Isolated browser mock, synthetic market data, no account or external requests.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output/white-screen-audit-20261021/listener-fix');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(os.tmpdir(), 'haolo-white-screen-audit-20261021/listener-fix-profile'));
app.commandLine.appendSwitch('disable-features', 'EnableTransparentHwndEnlargement');
const report = { started: new Date().toISOString(), versions: process.versions, samples: [], errors: [], crashes: [] };
const write = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const source = fs.readFileSync(path.join(root, 'scripts/trading-chart-shell-performance-qa.cjs'), 'utf8');
const fixture = source.slice(source.indexOf('function installMarketFixture()'), source.indexOf('\n(async () =>'));
function disableHmr() {
  const NativeSocket = WebSocket;
  window.WebSocket = class extends NativeSocket {
    constructor(url, protocols) {
      if (protocols === 'vite-hmr' || Array.isArray(protocols) && protocols.includes('vite-hmr')) {
        return Object.assign(new EventTarget(), { url: String(url), readyState: 0, protocol: 'vite-hmr', bufferedAmount: 0, send() {}, close() { this.readyState = 3; } });
      }
      super(url, protocols);
    }
  };
}
(async () => {
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: /^https?:/.test(d.url) && !d.url.startsWith('http://127.0.0.1:5177/') }));
  const win = new BrowserWindow({ show: false, width: 1280, height: 860, frame: false, transparent: false, backgroundColor: '#f6f8fa', webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: false } });
  win.webContents.on('render-process-gone', (_e, d) => report.crashes.push(d));
  const debug = win.webContents.debugger; debug.attach('1.3');
  await win.loadURL('about:blank'); await debug.sendCommand('Page.enable');
  await debug.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(${disableHmr})();\n${fixture}\ninstallMarketFixture();window.__qaErrors=[];addEventListener('error',e=>__qaErrors.push(String(e.message)));addEventListener('unhandledrejection',e=>__qaErrors.push(String(e.reason)));` });
  await debug.sendCommand('Fetch.enable', { patterns: [{ urlPattern: '*127.0.0.1:5177/main.ts*', requestStage: 'Response' }] });
  debug.on('message', async (_event, method, p) => {
    if (method !== 'Fetch.requestPaused') return;
    try {
      const body = await debug.sendCommand('Fetch.getResponseBody', { requestId: p.requestId });
      const text = (body.base64Encoded ? Buffer.from(body.body, 'base64').toString() : body.body) + '\nwindow.__audit={render,state};';
      await debug.sendCommand('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }], body: Buffer.from(text).toString('base64') });
    } catch (error) { report.errors.push(error.message); await debug.sendCommand('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {}); }
  });
  const js = expression => win.webContents.executeJavaScript(expression);
  await win.loadURL('http://127.0.0.1:5177/?i18n-layout-qa=1'); await delay(7000);
  await js(`window.__retainedButton=document.querySelector('.trading-market-split-panel-restore');window.__initialTimeOrigin=performance.timeOrigin;void 0`);
  const sample = async label => {
    await debug.sendCommand('HeapProfiler.collectGarbage');
    const listeners = await debug.sendCommand('Runtime.evaluate', { expression: `(getEventListeners(document.querySelector('.trading-market-split-panel-restore')).click||[]).length`, includeCommandLineAPI: true, returnByValue: true });
    const value = { label, heap: await debug.sendCommand('Runtime.getHeapUsage'), dom: await debug.sendCommand('Memory.getDOMCounters'), listeners: listeners.result.value,
      ui: await js(`({sameButton:__retainedButton===document.querySelector('.trading-market-split-panel-restore'),samePage:__initialTimeOrigin===performance.timeOrigin,liveNodes:document.querySelectorAll('*').length,ticks:fixtureTicks,errors:__qaErrors})`) };
    report.samples.push(value); write(); console.log(JSON.stringify(value));
    assert.equal(value.listeners, 1); assert.equal(value.ui.sameButton, true); assert.equal(value.ui.samePage, true); assert.deepEqual(value.ui.errors, []);
    return value;
  };
  const baseline = await sample('baseline');
  for (let batch = 1; batch <= 4; batch++) {
    await js(`(async()=>{for(let i=0;i<50;i++){__audit.render();await new Promise(r=>setTimeout(r,20));}})()`);
    await delay(1500); const current = await sample(`render-${batch * 50}`);
    // Allow transient chart/tooltips while rejecting the former ~575 nodes/render leak.
    assert.ok(current.dom.nodes - baseline.dom.nodes < 1000, 'detached shell DOM must be collectable');
    assert.ok(current.dom.jsEventListeners - baseline.dom.jsEventListeners < 100, 'shell listeners must not accumulate');
  }
  report.click = await js(`(()=>{const s=__audit.state;s.rightCollapsed=true;s.tradingExpertChartFocusMode=false;s.tradingExpertChartCollapsed=false;document.querySelector('.trading-market-split-panel-restore').click();return {expanded:!s.rightCollapsed}})()`);
  assert.equal(report.click.expanded, true);
  assert.deepEqual(report.errors, []); assert.deepEqual(report.crashes, []);
  report.passed = true; report.finished = new Date().toISOString(); write();
  debug.detach(); win.destroy(); app.exit(0);
})().catch(error => { report.fatal = error.stack; write(); console.error(error.stack); app.exit(1); });
setTimeout(() => { report.fatal = 'timeout'; write(); app.exit(2); }, 180000).unref();
