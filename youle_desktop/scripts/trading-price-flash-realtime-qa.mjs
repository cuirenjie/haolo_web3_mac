import { app, BrowserWindow } from "electron/main";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".tmp", "trading-price-flash-realtime-qa");
const report = [];
app.setPath("userData", path.join(output, "profile"));
app.disableHardwareAcceleration();
let server, window;

async function main() {
  await mkdir(output, { recursive: true });
  server = await createServer({ configFile: false, root: path.join(root, "src/renderer"),
    server: { host: "127.0.0.1", port: 0, hmr: false, fs: { allow: [root] } }, clearScreen: false });
  await server.listen();
  await app.whenReady();
  window = new BrowserWindow({ show: false, width: 1500, height: 920,
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: true } });
  const js = source => window.webContents.executeJavaScript(source, true);
  await window.loadURL(`${server.resolvedUrls.local[0]}@fs/${path.join(root, "test/fixtures/trading-watchlist.html").replaceAll("\\", "/")}`);
  for (let i = 0; !(await js("window.ready === true")); i++) {
    assert.ok(i < 150, await js("window.qaError || 'Fixture timed out'"));
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await js(`
    localStorage.clear();
    workspace.favoriteSymbols.clear(); workspace.favoriteMarketRecords.clear();
    qaMarkets.filter(m => m.marketType === 'perpetual').slice(0, 5).forEach(m => {
      workspace.addFavoriteMarket(m); workspace.watchlist.setMembership(m, true);
    });
    workspace.watchlistPanel.refresh(); workspace.commitFavoriteMarketChanges(); workspace.syncWatchlistChanges();
    // Keep the real stream callbacks, but remove fixture REST pollers so only
    // the quotes explicitly sent by each timing case can change the prices.
    for (const name of ['favoriteTickerFallbackTimer', 'pollTimer', 'candlePollTimer']) {
      clearInterval(workspace[name]); workspace[name] = null;
    }
    window.qaPriceNodes = () => [
      document.querySelector('[data-market-favorite-sort-item][data-market-id="BINANCE:FUTURES:BTCUSDT"] [data-market-favorite-price]'),
      document.querySelector('[data-watchlist-row="BINANCE:FUTURES:BTCUSDT"] [data-watchlist-price]')
    ];
    window.qaEmit = price => qaStreamCallbacks.forEach(({request, callback}) => {
      if (request.marketType === 'futures' && request.streams.includes('btcusdt@ticker'))
        callback({type:'data', data:{e:'24hrTicker',s:'BTCUSDT',c:String(price),o:'80000',P:'2.35',E:Date.now()}});
    });
    void 0;
  `);
  let price = 84000;
  for (const theme of ["light", "dark"]) {
    for (const mode of ["steady", "repaint", "rerender", "remount", "titlebar-move"]) {
      const trace = await js(`(async () => {
        document.documentElement.dataset.theme = '${theme}';
        qaEmit(${price++});
        await new Promise(resolve => setTimeout(resolve, 1100));
        const neutral = qaPriceNodes().map(node => getComputedStyle(node).color);
        const samples = [];
        const start = performance.now();
        let acted = false;
        qaEmit(${price++});
        while (performance.now() - start < 1150) {
          await new Promise(requestAnimationFrame);
          const elapsed = performance.now() - start;
          if (!acted && elapsed >= 150) {
            acted = true;
            if ('${mode}' === 'repaint') {
              workspace.scheduleFavoriteTickerPaint(); workspace.watchlistPanel.paintQuotes();
            } else if ('${mode}' === 'rerender') {
              workspace.renderFavoriteTickerBar(); workspace.watchlistPanel.refresh();
            } else if ('${mode}' === 'remount') {
              document.querySelector('.trading-expert-panel').outerHTML = qaPanelMarkup();
              workspace.syncWatchlistHost();
            } else if ('${mode}' === 'titlebar-move') {
              const host = document.querySelector('[data-titlebar-market-favorites-host]');
              host.replaceWith(host.cloneNode(false)); workspace.syncTitlebarFavoriteTickerHost();
            }
          }
          samples.push({ elapsed, colors: qaPriceNodes().map(node => getComputedStyle(node).color) });
        }
        return { theme:'${theme}', mode:'${mode}', neutral, samples };
      })()`);
      const expected = theme === "light" ? "rgb(6, 118, 71)" : "rgb(82, 220, 136)";
      trace.holds = [0, 1].map(index => {
        const first = trace.samples.find(sample => sample.colors[index] === expected);
        const ended = trace.samples.find(sample => first && sample.elapsed > first.elapsed && sample.colors[index] === trace.neutral[index]);
        return { surface: index ? "watchlist" : "titlebar", firstColorMs: first?.elapsed, returnedMs: ended?.elapsed,
          visibleHoldMs: first && ended ? ended.elapsed - first.elapsed : null };
      });
      report.push(trace);
      console.log(JSON.stringify({theme, mode, holds: trace.holds}));
    }
  }
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  for (const trace of report) for (const hold of trace.holds) {
    assert.ok(hold.visibleHoldMs >= 775 && hold.visibleHoldMs < 950,
      `${trace.theme} ${trace.mode} ${hold.surface}: visible color lasted ${hold.visibleHoldMs}ms`);
    const expected = trace.theme === "light" ? "rgb(6, 118, 71)" : "rgb(82, 220, 136)";
    const index = hold.surface === "titlebar" ? 0 : 1;
    assert.ok(trace.samples.filter(sample => sample.elapsed >= hold.firstColorMs && sample.elapsed < hold.returnedMs)
      .every(sample => sample.colors[index] === expected), "No neutral gap or fading during the hold");
  }
  assert.equal(await js("window.qaError || ''"), "");
  await js("workspace.destroy()");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  window?.destroy();
  await server?.close();
  app.exit(process.exitCode || 0);
});
