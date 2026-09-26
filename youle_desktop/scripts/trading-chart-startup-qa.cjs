// Run with Electron while Vite serves the renderer (default port 5177).
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'chart-startup');
const base = process.env.HAOLO_CHART_QA_URL || 'http://127.0.0.1:5177';
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  await fs.mkdir(output, { recursive: true });
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1200, height: 800,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = () => js('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))');
  const snapshot = () => js(`(() => {
    const scale = workspace.chart.timeScale(), range = scale.getVisibleLogicalRange();
    return { range, width: scale.width(), candles: workspace.chartCandles.length,
      spacing: range ? scale.width() / (range.to - range.from + 1) : null };
  })()`);
  const reports = [];
  try {
    for (const { hidden, sparse } of [
      { hidden: false, sparse: false },
      { hidden: true, sparse: false },
      { hidden: true, sparse: true },
    ]) {
      await win.webContents.session.clearStorageData();
      await win.loadURL(base + '/@fs/' + path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')
        + (hidden ? '?startup-hidden=1' : ''));
      for (let i = 0; i < 100 && !await js('Boolean(window.ready)'); i++) await pause(100);
      assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
      if (sparse) await js('workspace.loadingHistory = true; workspace.candles = workspace.candles.slice(-2); workspace.updateChartData({ resetViewport: true }); void 0');
      await settle();
      const before = await snapshot();
      if (hidden) { await js('host.hidden = false'); await settle(); }
      const opened = await snapshot();
      assert.deepEqual(opened.range, { from: opened.candles - 100, to: opened.candles + 5 },
        'Startup must show the recent-candle range after real layout, including sparse history');
      await pause(100);
      await fs.writeFile(path.join(output, sparse ? 'sparse-start.png' : hidden ? 'hidden-start.png' : 'visible-start.png'), (await win.webContents.capturePage()).toPNG());
      await js('workspace.chartNavigation.reset(); void 0');
      await settle();
      const restored = await snapshot();
      const report = { hidden, sparse, before, opened, restored };
      reports.push(report);
      await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(reports, null, 2));
      assert.ok(opened.spacing >= restored.spacing * 0.8,
        `Startup candles must not be compressed: ${JSON.stringify({ hidden, opened, restored })}`);
      // Parking an existing chart and showing it again must preserve the user's zoom.
      await js('workspace.chartNavigation.zoom(0.8); void 0'); await settle();
      const zoomed = await snapshot();
      await js('host.hidden = true'); await settle();
      await js('host.hidden = false'); await settle();
      const reopened = await snapshot();
      report.zoomed = zoomed;
      report.reopened = reopened;
      assert.ok(Math.abs(reopened.spacing - zoomed.spacing) < 0.1, 'Showing a parked chart must keep user zoom');
      assert.ok(Math.abs(reopened.range.to - zoomed.range.to) < 0.1, 'Showing a parked chart must keep scroll position');
      await js('workspace.updateChartData(); void 0'); await settle();
      assert.deepEqual((await snapshot()).range, reopened.range, 'Live data refresh must keep user zoom');
    }
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(reports, null, 2));
    console.log(JSON.stringify({ ok: true, reports, output }));
  } finally { win.destroy(); }
  app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
