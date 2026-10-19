// Run with Electron and this checkout's Vite server on HAOLO_QA_PORT (5183 by default).
const { app, BrowserWindow, ipcMain, clipboard, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'chart-screenshot-qa');
const desktop = path.join(output, 'desktop');
fs.mkdirSync(desktop, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.setPath('desktop', desktop);
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win, originalClipboard;

(async () => {
  setTimeout(() => app.exit(1), 120000).unref();
  await app.whenReady();
  originalClipboard = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: clipboard.readImage() };
  const { captureTradingChart, normalizeTradingChartCaptureRect } = await import(pathToFileURL(path.join(root, 'src/main/trading-chart-capture.mjs')));
  const preload = path.join(output, 'preload.cjs');
  fs.writeFileSync(preload, "const { contextBridge, ipcRenderer } = require('electron'); contextBridge.exposeInMainWorld('chartCaptureQA', params => ipcRenderer.invoke('trading:captureChart', params));");
  let mode = 'success', calls = 0;
  const results = [];
  ipcMain.handle('trading:captureChart', async (event, params) => {
    calls++;
    if (mode === 'failure') throw new Error('Injected save failure');
    await pause(60);
    assert.equal(await event.sender.executeJavaScript("[...document.querySelectorAll('[data-chart-screenshot-notice]')].every(n=>n.hidden)"), true, 'previous success notice must not appear in subsequent captures');
    const result = await captureTradingChart(BrowserWindow.fromWebContents(event.sender), params, { app, clipboard });
    results.push({ result, rect: normalizeTradingChartCaptureRect(win, params.rect) });
    return result;
  });
  win = new BrowserWindow({ show: false, width: 1400, height: 1000,
    webPreferences: { preload, offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(70); };
  const button = '[data-drawing-action="screenshot"]';
  const notice = '[data-chart-screenshot-notice]';
  const click = async () => {
    await js(`document.querySelector('${button}').scrollIntoView({block:'nearest'})`); await settle();
    const zoom = win.webContents.getZoomFactor();
    const point = await js(`(()=>{const r=document.querySelector('${button}').getBoundingClientRect();return {x:Math.round((r.x+r.width/2)*${zoom}),y:Math.round((r.y+r.height/2)*${zoom})}})()`);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
    await settle();
    for (let i = 0; i < 100 && await js(`document.querySelector('${button}').disabled`); i++) await pause(30);
    assert.equal(await js(`document.querySelector('${button}').disabled`), false);
  };
  const report = [];
  for (const theme of ['light', 'dark']) for (const zoom of [1, 1.25, 1.5]) {
    await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5183}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
    win.webContents.setZoomFactor(zoom);
    assert.equal(win.webContents.getZoomFactor(), zoom);
    for (let i = 0; i < 150 && !await js('Boolean(window.ready)'); i++) await pause(70);
    assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
    await js(`host.style.cssText='width:100%;height:100vh';document.querySelector('.trading-expert-market').style.height='100%';workspace.loadingHistory=true;
      workspace.activeIndicators=['volume','macd'];workspace.rebuildIndicatorPanes();workspace.updateChartData();
      document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();
      window.codexDesktop.captureTradingChart=window.chartCaptureQA;
      window.d=workspace.drawingController;d.switchStorageSession('screenshot-qa-'+Date.now());d.selectTool('crosshair');
      window.addTestDrawing = controller => {
        const candles=controller.getCandles(), last=candles.at(-40);
        controller.drawings=[{id:'screenshot-line',tool:'trend-line',symbol:controller.getSymbol(),interval:controller.getInterval(),color:'#d500f9',lineWidth:5,text:'截图画线',points:[{time:candles.at(-90).time,price:last.close-12},{time:last.time,price:last.close+12}]}];
        controller.selectDrawing(null);controller.redraw();
      };addTestDrawing(d);void 0`);
    const split = zoom === 1.25;
    if (split) {
      await js("workspace.splitLayoutId='2-columns';workspace.applySplitLayout();void 0");
      for (let i = 0; i < 100 && !await js('Boolean(workspace.splitPanes[0]?.candles.length)'); i++) await pause(50);
      await js("workspace.splitPanes[0].activeIndicators=['volume','macd'];workspace.splitPanes[0].rebuildIndicatorPanes();workspace.splitPanes[0].updateData();addTestDrawing(workspace.splitPanes[0].drawingController);workspace.activateDrawingController(workspace.splitPanes[0].drawingController);void 0");
    }
    await settle();
    const actions = await js("[...document.querySelector('.trading-drawing-toolbar-scroll').children].filter(e=>e.matches('button')).map(e=>e.dataset.drawingAction)");
    assert.deepEqual(actions.slice(-3), ['screenshot', 'toggle-visibility', 'clear']);
    assert.ok(await js("workspace.indicatorPanes.has('volume') && workspace.indicatorPanes.has('macd')"), 'both indicator panes present');
    const before = await js('JSON.stringify({drawings:d.drawings,range:workspace.chart.timeScale().getVisibleLogicalRange()})');
    const count = calls;
    await click();
    assert.equal(calls, count + 1, 'native click invokes capture once');
    assert.equal(await js(`document.querySelector('${notice}').textContent`), '截图已经保存在桌面');
    assert.equal(await js('JSON.stringify({drawings:d.drawings,range:workspace.chart.timeScale().getVisibleLogicalRange()})'), before, 'capture preserves drawing and visible range');
    const { result, rect } = results.at(-1);
    assert.equal(path.dirname(result.path), desktop);
    const saved = nativeImage.createFromPath(result.path);
    assert.deepEqual(saved.getSize(), { width: rect.width, height: rect.height });
    assert.deepEqual(clipboard.readImage().toBitmap(), saved.toBitmap(), 'native clipboard pixels equal the saved PNG');
    const pixels = saved.toBitmap();
    let drawingPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 249 && pixels[i + 1] === 0 && pixels[i + 2] === 213) drawingPixels++;
    assert.ok(drawingPixels > 40, 'SVG drawing is included in the composed capture');
    const name = `${theme}-${zoom}-${split ? 'split' : 'single'}`;
    fs.copyFileSync(result.path, path.join(output, name + '-chart.png'));
    fs.writeFileSync(path.join(output, name + '-notice.png'), (await win.webContents.capturePage()).toPNG());
    report.push({ theme, zoom, split, width: result.width, height: result.height, drawingPixels });
  }
  // Keep repeated clicks from scheduling duplicate writes; allow retry after errors.
  const count = calls;
  await js(`(async()=>{const m=await import('/trading-chart-screenshot.ts');await Promise.all([m.captureTradingChartToDesktop(d.toolbar),m.captureTradingChartToDesktop(d.toolbar)])})()`);
  assert.equal(calls, count + 1);
  mode = 'failure'; await click();
  assert.equal(await js(`document.querySelector('${notice}').textContent`), '图表截图失败，请重试');
  assert.equal(await js("document.querySelector('.trading-chart-capturing') === null"), true);
  mode = 'success'; await click();
  assert.equal(await js(`document.querySelector('${notice}').textContent`), '截图已经保存在桌面');
  await js("(async()=>{const language=await import('/app-language.mjs');language.applyAppLanguage('en',{root:document.body})})()");
  await click();
  assert.equal(await js(`document.querySelector('${notice}').textContent`), 'Screenshot saved to Desktop');
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ cases: report, duplicateClick: 'passed', errorRecovery: 'passed' }, null, 2));
  console.log(JSON.stringify({ cases: report, duplicateClick: 'passed', errorRecovery: 'passed', output }));
})().catch(async error => {
  console.error(error);
  if (win && !win.isDestroyed()) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
  process.exitCode = 1;
}).finally(() => {
  if (originalClipboard) clipboard.write(originalClipboard);
  win?.destroy(); app.exit(process.exitCode || 0);
});
