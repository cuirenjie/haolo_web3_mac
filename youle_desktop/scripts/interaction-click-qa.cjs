// Run with Electron against the local Vite renderer. All account data is mocked,
// external requests are blocked, and each scenario has isolated browser storage.
const {app, BrowserWindow} = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const out = path.resolve(__dirname, '../.cache/interaction-click-M1-426');
fs.mkdirSync(out, {recursive: true});
app.setPath('userData', path.join(out, `profile-${Date.now()}`));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const origin = process.env.HAOLO_QA_ORIGIN || 'http://127.0.0.1:5177';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = {scope: 'Real renderer, native Electron mouse/keyboard, mock account, blocked external requests', checks: []};
let current;

function instrument(config) {
  window.qa = {handlers: {}, events: [], rootRenders: 0, starts: 0, startPending: false, startCompleted: false};
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', {...descriptor, set(value) {
    if (this.id === 'app') qa.rootRenders++;
    descriptor.set.call(this, value);
  }});
  for (const type of ['pointerdown', 'pointerup', 'keydown', 'keyup', 'click']) {
    document.addEventListener(type, event => {
      if (type === 'pointerdown' || type === 'keydown') qa.held = event.target.closest?.('button') || event.target;
      qa.events.push({type, action: event.target.closest?.('[data-action]')?.dataset.action, trusted: event.isTrusted});
    }, true);
  }
  let desktop;
  Object.defineProperty(window, 'codexDesktop', {configurable: true, get: () => desktop, set(api) {
    desktop = api;
    for (const name of ['onStatus', 'onSkills', 'onAutoTasksChanged', 'onLocalArtifactsChanged', 'onProfileUpdated']) {
      const original = api[name];
      api[name] = cb => {qa.handlers[name] = cb; return original ? original.call(api, cb) : () => {};};
    }
    api.getWindowState = async () => ({mode: config.mode || 'login', bounds: {width: 1440, height: 960}, appMinimumSize: {width: 1000, height: 700}});
    api.setWindowMode = async mode => ({mode});
    api.checkWindowsUpdate = async () => ({current_version: '0.0.0', update_available: false, force_update: false});
    api.getTradingPreferenceProfile = async () => ({ok: true, completed: true, profile: {onboardingCompleted: true}});
    const start = api.start;
    api.start = async (...args) => {
      qa.starts++; qa.startPending = true;
      await new Promise(resolve => setTimeout(resolve, config.startDelay || 0));
      qa.startPending = false;
      if (config.failFirst && qa.starts === 1) throw new Error('QA controlled startup failure');
      const value = await start.apply(api, args);
      qa.startCompleted = true;
      return value;
    };
  }});
}

async function create(config = {}) {
  const previous = current;
  const win = current = new BrowserWindow({show: false, width: 1440, height: 960,
    webPreferences: {offscreen: true, backgroundThrottling: false, partition: `interaction-qa-${Date.now()}`}});
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({cancel:
    !(/^(about|data|blob|devtools):/.test(details.url) || details.url.startsWith(origin + '/') || details.url.startsWith(origin.replace('http:', 'ws:') + '/'))}));
  win.webContents.debugger.attach('1.3');
  await win.loadURL('about:blank');
  previous?.destroy();
  await win.webContents.debugger.sendCommand('Page.enable');
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {source: `(${instrument.toString()})(${JSON.stringify(config)})`});
  await win.loadURL(config.fixture
    ? origin + '/@fs/' + path.resolve(__dirname, '../test/fixtures/' + config.fixture).replaceAll('\\', '/')
    : origin + '/');
  return win;
}
const js = async source => {
  const result = await current.webContents.debugger.sendCommand('Runtime.evaluate', {
    expression: source, awaitPromise: true, returnByValue: true, userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
async function until(source, timeout = 18000) {
  const began = Date.now();
  while (Date.now() - began < timeout) {if (await js(source)) return; await delay(40);}
  throw new Error(`Timed out: ${source}`);
}
function passed(name, details = {}) {report.checks.push({name, passed: true, ...details}); console.log('PASS ' + name);}
async function point(selector) {
  const result = await js(`(() => {const button = document.querySelector(${JSON.stringify(selector)});
    if (!button) return null; const r = button.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    return {x, y, hit: button.contains(document.elementFromPoint(x, y)), disabled: !!button.disabled};})()`);
  assert.ok(result && result.hit && !result.disabled, `Target usable: ${selector}; ${JSON.stringify(result)}`);
  return result;
}
const mouse = (type, p) => current.webContents.sendInputEvent({type, x: p.x, y: p.y, button: 'left', clickCount: 1});
async function click(selector) {
  const p = await point(selector); mouse('mouseMove', p); await delay(25);
  mouse('mouseDown', p); await delay(25); mouse('mouseUp', p); await delay(100);
}
async function dismissProfile() {
  if (await js("!!document.querySelector('.profile-menu')")) {
    mouse('mouseMove', {x: 720, y: 800}); mouse('mouseDown', {x: 720, y: 800});
    mouse('mouseUp', {x: 720, y: 800});
    await until("!document.querySelector('.profile-menu')");
  }
}
const emitRefresh = `qa.handlers.onSkills({cwd:'/mock/workspace',result:{data:[]}});
  qa.handlers.onStatus({state:'ready',command:'mock-browser',pid:1,port:5177});`;
async function activateDuringRefresh({selector, name, expected, keyboard = false, focusComposer = false, burst = 1, trigger = emitRefresh}) {
  const p = await point(selector);
  mouse('mouseMove', p); await delay(150);
  if (focusComposer) await js("document.querySelector('#composerInput').focus()");
  if (keyboard) await js(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await js('qa.events=[];qa.rootRenders=0');
  if (keyboard) current.webContents.sendInputEvent({type: 'keyDown', keyCode: 'Space'});
  else mouse('mouseDown', p);
  await delay(35);
  await js(`for(let i=0;i<${burst};i++){${trigger}}`);
  await delay(170);
  const during = await js('({connected:qa.held?.isConnected,renders:qa.rootRenders})');
  assert.equal(during.connected, true, `${name}: native target survives refresh`);
  assert.equal(during.renders, 0, `${name}: root not replaced while held`);
  if (keyboard) current.webContents.sendInputEvent({type: 'keyUp', keyCode: 'Space'});
  else mouse('mouseUp', p);
  await until(expected, 4000);
  const events = await js('qa.events');
  assert.equal(events.filter(event => event.type === 'click' && event.trusted).length, 1, `${name}: exactly one real activation`);
  passed(name, {burst, during});
}

(async () => {
  setTimeout(() => {throw new Error('Interaction QA timed out');}, 110000).unref();
  await app.whenReady();
  if (!process.env.HAOLO_QA_CHART_ONLY) {
  await create();
  await until("!!document.querySelector('.desktop-shell')");
  await delay(1800);
  assert.equal(await js('qa.startCompleted'), true);
  passed('normal startup waits for the workspace');
  await click('button[data-action="toggle-profile"]');
  await until("!!document.querySelector('.profile-menu')");
  passed('native baseline profile click');
  await dismissProfile();
  for (let i = 0; i < 12; i++) {
    await activateDuringRefresh({selector: 'button[data-action="toggle-profile"]', name: `runtime refresh click ${i + 1}`,
      expected: "!!document.querySelector('.profile-menu')", focusComposer: i % 2 === 0, burst: i < 2 ? 1 : 30});
    await dismissProfile();
  }
  await activateDuringRefresh({selector: 'button[data-action="toggle-profile"]', name: 'Space key activation during refresh',
    expected: "!!document.querySelector('.profile-menu')", keyboard: true, burst: 30});
  await dismissProfile();
  await activateDuringRefresh({selector: '[data-action="open-settings"]', name: 'settings opens during refresh',
    expected: "!!document.querySelector('.settings-dialog')", burst: 30});
  await activateDuringRefresh({selector: 'button[data-action="close-settings"]', name: 'settings closes during refresh',
    expected: "!document.querySelector('.settings-dialog')", burst: 30});

  // Native drag release with no button activation must flush pending UI updates.
  const held = await point('button[data-action="toggle-profile"]');
  mouse('mouseMove', held); mouse('mouseDown', held); await delay(35);
  await js(`qa.rootRenders=0;${emitRefresh}`); await delay(120);
  mouse('mouseMove', {x: 700, y: 800}); mouse('mouseUp', {x: 700, y: 800});
  await until('qa.rootRenders > 0');
  passed('drag away releases deferred rendering');
  await click('button[data-action="toggle-profile"]');
  await until("!!document.querySelector('.profile-menu')");
  passed('next click still works after canceled activation');

  await create({mode: 'app', startDelay: 13200});
  await until('qa.startPending');
  await delay(12300);
  assert.equal(await js("!!document.querySelector('.desktop-shell')"), false);
  assert.equal(await js('qa.startPending'), true);
  assert.equal(await js("!!document.querySelector('.login-restore-panel [role=status]')"), true);
  passed('slow restored app remains loading beyond 12 seconds');
  await until("!!document.querySelector('.desktop-shell')");
  assert.equal(await js('qa.startCompleted'), true);
  await activateDuringRefresh({selector: 'button[data-action="toggle-profile"]', name: 'first click after slow startup',
    expected: "!!document.querySelector('.profile-menu')", burst: 30});

  await create({failFirst: true, startDelay: 100});
  await until("!!document.querySelector('[data-action=retry-workspace-startup]')");
  assert.equal(await js("!!document.querySelector('.desktop-shell')"), false);
  await click('[data-action="retry-workspace-startup"]');
  await until("!!document.querySelector('.desktop-shell')");
  assert.equal(await js('qa.starts'), 2);
  passed('failed startup exposes a working reconnect button');

  await create({startDelay: 1600});
  await until('qa.startPending');
  await click('[data-action="cancel-login-restore"]');
  await until("!!document.querySelector('#loginIdentifier')");
  await delay(2200);
  assert.equal(await js("!!document.querySelector('.desktop-shell')"), false);
  assert.equal(await js("!!document.querySelector('#loginIdentifier')"), true);
  passed('canceling startup prevents stale completion reopening the workspace');
  }

  await create({fixture: 'trading-watchlist.html'});
  await until('!!window.ready');
  await js(`(async () => {
    (await import('/interaction-render-guard.ts')).installInteractionRenderGuard();
    workspace.watchlist.addMarkets(qaMarkets.filter(m => m.marketType === 'perpetual'));
    workspace.watchlistPanel.refresh();
    window.d = workspace.drawingController;
  })()`);
  await activateDuringRefresh({selector: '[data-watchlist-action="sort-price"]', name: 'watchlist partial refresh preserves native sorting click',
    trigger: 'workspace.watchlistPanel.refresh();', expected: "workspace.watchlistPanel.sort?.column === 'price'", burst: 30});
  await activateDuringRefresh({selector: '[data-watchlist-toggle]', name: 'watchlist toggle remains responsive during quotes refresh',
    trigger: 'workspace.watchlistPanel.refresh();', expected: '!workspace.watchlist.expanded', burst: 30});
  await js('workspace.picker.hidden=false;workspace.renderMarkets();');
  await until("!!workspace.marketList.querySelector('[data-market-action=symbol]')");
  const marketId = await js("[...workspace.marketList.querySelectorAll('[data-market-action=symbol]')].find(b=>b.dataset.marketId!==workspace.selectedMarketId).dataset.marketId");
  await activateDuringRefresh({selector: `[data-market-action="symbol"][data-market-id="${marketId}"]`,
    name: 'market directory refresh preserves selection and cancels obsolete chunks', trigger: 'workspace.renderMarkets();',
    expected: `workspace.selectedMarketId === ${JSON.stringify(marketId)} && workspace.picker.hidden`, burst: 30});
  await delay(250);
  // This fixture serves hourly bars, so choose its matching period.
  const interval = '60';
  await activateDuringRefresh({selector: `[data-market-times] [data-market-interval="${interval}"]`,
    name: 'period buttons remain selectable during their partial refresh', trigger: 'workspace.renderPeriodButtons();',
    expected: `workspace.activeInterval === ${JSON.stringify(interval)}`, burst: 30});
  await delay(250);
  await js("d.favoriteTools.add('trend-line');d.updateToolbarState();");
  await activateDuringRefresh({selector: '[data-drawing-favorites-bar] [data-drawing-tool="trend-line"]',
    name: 'drawing toolbar remains selectable during chart redraw', trigger: 'd.updateToolbarState();d.redraw();',
    expected: "d.activeTool === 'trend-line'", burst: 30});
  // Guarding toolbar markup must not freeze geometry during a native chart drag.
  await until('workspace.candles.length >= 80');
  await js("workspace.loadingHistory=true;d.drawings=[];d.selectTool('trend-line');d.redraw();");
  const bounds = await js('(() => {const r=d.overlay.getBoundingClientRect();return {x:r.x,y:r.y};})()');
  for (const offset of [{x:250,y:140},{x:650,y:230}]) {
    const p = {x:Math.round(bounds.x+offset.x),y:Math.round(bounds.y+offset.y)};
    mouse('mouseMove', p); await delay(40); mouse('mouseDown', p); mouse('mouseUp', p); await delay(80);
  }
  assert.equal(await js('d.drawings.length'), 1, 'native chart clicks create one line');
  await js('d.selectionToolbarPosition={x:700,y:60};d.redraw();');
  await delay(150);
  const handle = await js(`(() => {const r=d.content.querySelector('[data-drawing-handle-index="0"]').getBoundingClientRect();
    return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  const original = await js('JSON.stringify(d.drawings[0].points)');
  mouse('mouseMove', handle); mouse('mouseDown', handle); await delay(30);
  const moved = {x:handle.x+25,y:handle.y+20}; mouse('mouseMove', moved); await delay(80);
  assert.notEqual(await js('JSON.stringify(d.drawings[0].points)'), original, 'drawing geometry updates while held');
  mouse('mouseUp', moved); await delay(80);
  passed('chart drag geometry keeps updating before release');

  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({passed: report.checks.length, output: path.join(out, 'report.json')}));
  current.destroy(); app.exit(0);
})().catch(async error => {
  report.failure = error.stack;
  try {report.state = await js('({events:qa.events,starts:qa.starts,startPending:qa.startPending,text:document.body.innerText.slice(0,1800)})');} catch {}
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.error(error.stack); current?.destroy(); app.exit(1);
});
