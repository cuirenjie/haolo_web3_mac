// Start Vite on 127.0.0.1:5183, then run with Electron. Uses isolated synthetic data.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'drawing-pane-clipping');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { checks: [], errors: [], nativeDrags: 0 };
let win;

(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1200, height: 800,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => {
    await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await pause(50);
  };
  win.webContents.on('console-message', event => {
    if (event.level === 'error' && !event.message.includes('Binance market catalog is unavailable')) report.errors.push(event.message);
  });
  const screenshot = async name => fs.promises.writeFile(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const geometry = () => js(`(() => {
    const d=workspace.drawingController,c=workspace.chart,r=d.overlay.getBoundingClientRect(),h=workspace.chartElement.getBoundingClientRect();
    return { x:r.x,y:r.y,width:r.width,height:r.height,chartHeight:h.height,
      paneHeight:c.panes()[0].getHeight(),plotWidth:c.timeScale().width(),overflow:getComputedStyle(d.overlay).overflow,
      paneHeights:c.panes().map(p=>p.getHeight()),range:c.timeScale().getVisibleLogicalRange(),
      prices:c.priceScale('right',0).getVisibleRange() };
  })()`);
  async function checkGeometry(label) {
    const g = await geometry();
    assert.ok(Math.abs(g.height - g.paneHeight) < .05, `${label}: main drawing must stop at its pane`);
    assert.ok(Math.abs(g.width - g.plotWidth) < .05, `${label}: drawing must stop before price axis`);
    assert.equal(g.overflow, 'hidden');
    const indicators = await js(`Array.from(workspace.indicatorDrawingControllers?.values()||[]).map(d=>({
      height:d.overlay.getBoundingClientRect().height,expected:workspace.chart.panes()[d.paneIndex].getHeight(),
      overflow:getComputedStyle(d.overlay).overflow
    }))`);
    for (const i of indicators) { assert.ok(Math.abs(i.height - i.expected) < .05, label); assert.equal(i.overflow, 'hidden'); }
    return g;
  }
  const moveOutside = async () => { win.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 5 }); await settle(); };
  async function lowerPanePixelDifference() {
    await moveOutside();
    const g = await geometry();
    const clip = { x: Math.ceil(g.x), y: Math.ceil(g.y + g.paneHeight),
      width: Math.floor(g.width), height: Math.floor(g.chartHeight - g.paneHeight) };
    const shown = (await win.webContents.capturePage(clip)).toBitmap();
    await js("workspace.drawingController.overlay.style.visibility='hidden'"); await settle();
    const hidden = (await win.webContents.capturePage(clip)).toBitmap();
    await js("workspace.drawingController.overlay.style.visibility=''"); await settle();
    assert.equal(shown.length, hidden.length);
    let pixels = 0;
    for (let i = 0; i < shown.length; i += 4) {
      if (shown[i] !== hidden[i] || shown[i + 1] !== hidden[i + 1] || shown[i + 2] !== hidden[i + 2]) pixels++;
    }
    return pixels;
  }
  async function assertClipped(theme, layout, label) {
    const g = await checkGeometry(label);
    const pixels = await lowerPanePixelDifference();
    assert.equal(pixels, 0, `${theme}/${layout}/${label}: leaked drawing pixels in indicators/time axis`);
    report.checks.push({ theme, layout, label, pixels, height: g.height, paneHeights: g.paneHeights });
  }
  async function drag(start, dx, dy, label) {
    start = { x: Math.round(start.x), y: Math.round(start.y) };
    win.webContents.sendInputEvent({ type: 'mouseMove', ...start }); await settle();
    win.webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(start.x + dx * i / 8),
        y: Math.round(start.y + dy * i / 8), modifiers: ['leftButtonDown'] });
      await settle(); await checkGeometry(`${label} frame ${i}`);
    }
    win.webContents.sendInputEvent({ type: 'mouseUp', x: start.x + dx, y: start.y + dy, button: 'left', clickCount: 1 });
    await settle(); report.nativeDrags++;
  }
  async function injectDrawings() {
    await js(`(() => {
      const d=workspace.drawingController,h=workspace.chart.panes()[0].getHeight(),w=workspace.chart.timeScale().width();
      const point=(x,y)=>d.screenToDrawingPoint({x:w*x,y:h*y},false);
      const common={symbol:d.getSymbol(),interval:d.getInterval(),drawingScope:'main'};
      const points=[point(.15,1.5),point(.35,.8),point(.48,1.12),point(.7,.3),point(.85,.65)];
      d.aiDrawings=[{...common,id:'qa-structure',tool:'path',source:'ai',colorToken:'chan-note',lineWidth:3,points},
        ...points.map((p,i)=>({...common,id:'qa-label-'+i,source:'ai',tool:'text',colorToken:'chan-note',fontSize:14,
          text:i%2?'HH':'HL',points:[p]})),
        {...common,id:'qa-region',source:'ai',tool:'rectangle',colorToken:'chan-note',text:'支撑区',points:[point(.55,.85),point(.82,1.3)]}];
      d.drawings=[{...common,id:'qa-manual',tool:'rectangle',points:[point(.25,.9),point(.5,1.4)]},
        {...common,id:'qa-fib',tool:'fib-retracement',points:[point(.65,.85),point(.9,1.3)]}];
      d.selectedDrawingId='qa-manual'; d.aiCursorPoint=point(.72,1.01);
      d.redraw(); window.savedAnchors=JSON.stringify([d.drawings,d.aiDrawings]);
    })()`); await settle();
  }
  async function setIndicators(ids) {
    await js(`workspace.activeIndicators=${JSON.stringify(ids)};workspace.rebuildIndicatorPanes();
      if(workspace===primary)workspace.updateChartData();else workspace.updateData();void 0`);
    await settle();
  }
  for (const theme of ['light', 'dark']) {
    await win.webContents.session.clearStorageData();
    await win.loadURL('http://127.0.0.1:5183/@fs/' + path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/'));
    for (let i = 0; i < 150 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
    await js(`document.documentElement.dataset.theme='${theme}';window.primary=workspace;
      workspace.loadingHistory=true;clearInterval(workspace.pollTimer);clearInterval(workspace.candlePollTimer);
      workspace.favoriteTickerGeneration++;workspace.closeFavoriteTickerStreams();workspace.closeSocket();
      workspace.cancelScheduledLiveChartPaint();workspace.latestLivePricesByMarketId.clear();
      workspace.splitLayoutId='1-single';workspace.applySplitLayout();workspace.applyChartTheme();void 0`);
    await settle();
    for (const layout of ['main', 'split']) {
      if (layout === 'split') {
        await js("primary.splitLayoutId='2-columns';primary.applySplitLayout();void 0");
        for (let i = 0; i < 100 && !await js('primary.splitPanes[0]?.candles.length'); i++) await pause(50);
        await js('window.workspace=primary.splitPanes[0];clearTimeout(workspace.refreshTimer);workspace.refreshTimer=null;void 0');
        await settle();
      }
      await setIndicators(['volume']);
      await js('workspace.chartNavigation.setAutoScale(true);void 0'); await settle();
      await injectDrawings();
      // Reproduce exactly the old main height calculation, without touching source files.
      await js(`(() => {const d=workspace.drawingController;window.fixedBounds=d.plotBounds;
        d.plotBounds=function(){return {width:Math.max(this.getChart().timeScale().width(),1),height:Math.max(this.getChart().options().height||1,1)}};
        d.redraw();})()`); await settle();
      const leakedBefore = await lowerPanePixelDifference();
      assert.ok(leakedBefore > 100, 'fixture must reproduce the reported overlap');
      await screenshot(`${theme}-${layout}-before`);
      await js('workspace.drawingController.plotBounds=window.fixedBounds;workspace.drawingController.redraw()'); await settle();
      await assertClipped(theme, layout, 'AI path/text/region, manual rectangle/fib, selected handles and AI cursor');
      report.checks.at(-1).leakedPixelsBeforeFix = leakedBefore;
      await screenshot(`${theme}-${layout}-after`);

      let g = await geometry();
      // The active main drawing surface must not intercept clicks in an indicator or the time axis.
      await js("workspace.drawingController.selectTool('trend-line')"); await settle();
      assert.equal(await js(`workspace.drawingController.overlay.contains(document.elementFromPoint(${g.x + g.width / 2},${g.y + g.paneHeight + 30}))`), false);
      await js("workspace.drawingController.selectTool('cursor')"); await settle();
      report.checks.push({ theme, layout, label: 'drawing mode leaves indicator input accessible' });

      g = await geometry();
      await drag({ x: g.x + 45, y: g.y + g.height * .45 }, 55, 65, 'diagonal chart pan');
      const panned = await geometry();
      assert.notDeepEqual(panned.range, g.range, 'native pan must change time range');
      assert.notDeepEqual(panned.prices, g.prices, 'native pan must change price range');
      await assertClipped(theme, layout, 'diagonal chart pan');
      await drag({ x: g.x + g.width + 24, y: g.y + g.height * .45 }, 0, 60, 'price axis scale');
      await assertClipped(theme, layout, 'price axis scale');
      g = await geometry();
      win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(g.x + 80), y: Math.round(g.y + 100) });
      win.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(g.x + 80), y: Math.round(g.y + 100), deltaY: -120, canScroll: true });
      await settle(); await assertClipped(theme, layout, 'mouse wheel zoom');

      // Native separator gesture: clip updates on every drag frame while layout changes.
      g = await geometry();
      await drag({ x: g.x + 80, y: g.y + g.paneHeight + 1 }, 0, -65, 'pane separator');
      assert.notEqual((await geometry()).paneHeight, g.paneHeight, 'separator must resize main pane');
      await assertClipped(theme, layout, 'native separator resize');
      assert.equal(await js('JSON.stringify([workspace.drawingController.drawings,workspace.drawingController.aiDrawings])===savedAnchors'), true, 'viewport changes must preserve drawing anchors');

      await setIndicators(['volume', 'macd', 'rsi']);
      await assertClipped(theme, layout, 'multiple indicators');
      if (layout === 'main') {
        // Indicator drawings must also stay in their own pane on either side of a boundary.
        await js(`(() => {const d=workspace.indicatorDrawingControllers.get('volume'),b=d.plotBounds();
          d.drawings=[{id:'qa-volume',symbol:d.getSymbol(),interval:d.getInterval(),drawingScope:'indicator:volume',tool:'rectangle',
            points:[d.screenToDrawingPoint({x:40,y:-80},false),d.screenToDrawingPoint({x:240,y:b.height+80},false)]}];d.redraw()})()`);
        await settle(); await checkGeometry('indicator drawing geometry');
        const clipped = await js(`(() => {const d=workspace.indicatorDrawingControllers.get('volume'),r=d.overlay.getBoundingClientRect();d.overlay.classList.add('drawing-active');
          const outside=[r.top-5,r.bottom+5].every(y=>!d.overlay.contains(document.elementFromPoint(r.left+100,y)));
          d.overlay.classList.remove('drawing-active');return outside})()`);
        assert.equal(clipped, true, 'indicator drawing must not hit adjacent panes');
      }
      await screenshot(`${theme}-${layout}-multiple-indicators`);
      await setIndicators([]); await assertClipped(theme, layout, 'no indicators / time axis remains clear');
      await setIndicators(['volume']); await assertClipped(theme, layout, 'indicator recreated');
      await js("document.getElementById('host').style.height='660px'"); await settle();
      await assertClipped(theme, layout, 'window content resize');
      await js("document.getElementById('host').style.height='800px'"); await settle();
      await js(`document.documentElement.dataset.theme='${theme === 'light' ? 'dark' : 'light'}';primary.applyChartTheme();void 0`);
      await settle(); await assertClipped(theme, layout, 'live theme switch');
      await js(`document.documentElement.dataset.theme='${theme}';primary.applyChartTheme();void 0`); await settle();
      console.log(`PASS ${theme} ${layout}: pane clipping, native pan/scale/resize, drawing hit regions and themes`);
    }
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, checks: report.checks.length, nativeDrags: report.nativeDrags, output }));
  win.destroy(); app.quit();
})().catch(async error => {
  report.failure = error.stack;
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (win) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
  console.error(error); app.exit(1);
});
