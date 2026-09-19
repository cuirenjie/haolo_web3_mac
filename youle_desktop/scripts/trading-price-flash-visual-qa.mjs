import { app, BrowserWindow } from "electron/main";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".tmp", "trading-price-flash-qa");
app.setPath("userData", path.join(output, "profile"));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { checks: [], screenshots: [], timingSamples: [] };
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
  const wait = async expression => {
    for (let i = 0; i < 120; i++) {
      if (await js(expression)) return;
      const error = await js("window.qaError || ''");
      if (error) throw Error(error);
      await pause(50);
    }
    throw Error(`Timed out: ${expression}`);
  };
  const url = `${server.resolvedUrls.local[0]}@fs/${path.join(root, "test/fixtures/trading-watchlist.html").replaceAll("\\", "/")}`;
  await window.loadURL(url);
  await wait("window.ready === true");
  window.webContents.debugger.attach("1.3");
  const cdp = (method, params) => window.webContents.debugger.sendCommand(method, params);
  await cdp("DOM.enable");
  await cdp("CSS.enable");
  const forceState = async (selector, states) => {
    const { root: documentNode } = await cdp("DOM.getDocument");
    const { nodeId } = await cdp("DOM.querySelector", { nodeId: documentNode.nodeId, selector });
    assert.ok(nodeId, selector);
    await cdp("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: states });
  };
  await js(`
    localStorage.clear();
    workspace.favoriteSymbols.clear(); workspace.favoriteMarketRecords.clear();
    qaMarkets.filter(m => m.marketType === 'perpetual').slice(0, 5).forEach(m => {
      workspace.addFavoriteMarket(m); workspace.watchlist.setMembership(m, true);
    });
    workspace.watchlistPanel.refresh(); workspace.commitFavoriteMarketChanges(); workspace.syncWatchlistChanges();
    for (const name of ['favoriteTickerFallbackTimer', 'pollTimer', 'candlePollTimer']) {
      clearInterval(workspace[name]); workspace[name] = null;
    }
    window.qaPriceNodes = () => [
      document.querySelector('[data-market-favorite-sort-item][data-market-id="BINANCE:FUTURES:BTCUSDT"] [data-market-favorite-price]'),
      document.querySelector('[data-watchlist-row="BINANCE:FUTURES:BTCUSDT"] [data-watchlist-price]'),
      [...document.querySelectorAll('.trading-market-row')].find(row => row.querySelector('[data-market-action="symbol"][data-market-id="BINANCE:FUTURES:BTCUSDT"]'))?.querySelector('[data-market-row-price]')
    ].filter(Boolean);
    window.qaEmit = price => qaStreamCallbacks.forEach(({request, callback}) => {
      if (request.marketType === 'futures' && request.streams.includes('btcusdt@ticker'))
        callback({type:'data', data:{e:'24hrTicker',s:'BTCUSDT',c:String(price),o:'80000',P:'2.35',E:Date.now()}});
    });
    window.qaFreeze = () => qaPriceNodes().map(node => {
      const animation = node.getAnimations()[0];
      if (animation) { animation.pause(); animation.currentTime = 0; }
      return { text:node.textContent, color:getComputedStyle(node).color, animated:!!animation };
    });
    void 0;
  `);
  await wait("[...qaStreamCallbacks.values()].some(s => s.request.streams.includes('btcusdt@ticker'))");
  const capture = async name => {
    window.webContents.invalidate();
    await pause(80);
    const file = path.join(output, `${name}.png`);
    await writeFile(file, (await window.webContents.capturePage()).toPNG());
    report.screenshots.push(file);
  };
  for (const theme of ["light", "dark"]) {
    await js(`document.documentElement.dataset.theme='${theme}';workspace.setPickerOpen(true)`);
    await wait("qaPriceNodes().length === 3 && !workspace.marketList.hasAttribute('aria-busy')");
    await pause(200);
    await js("qaPriceNodes().forEach(node => node.getAnimations().forEach(a => a.finish()))");
    const baseline = await js("qaPriceNodes().map(node => getComputedStyle(node).color)");
    for (const [direction, price] of [["up", theme === "light" ? 81600 : 81700], ["down", theme === "light" ? 81590 : 81690]]) {
      await js(`qaEmit(${price})`);
      await wait("workspace.favoriteTickerPaintFrame === null && workspace.liveChartPaintFrame === null && workspace.liveChartPaintTimer === null");
      const snapshots = await js("qaFreeze()");
      const expected = theme === "light" ? (direction === "up" ? "rgb(6, 118, 71)" : "rgb(196, 33, 62)")
        : (direction === "up" ? "rgb(82, 220, 136)" : "rgb(255, 113, 142)");
      for (const snapshot of snapshots) {
        assert.equal(snapshot.animated, true, `${theme} ${direction} ${JSON.stringify(snapshot)}`);
        assert.equal(snapshot.color, expected, `${theme} ${direction}`);
      }
      const timingSamples = await js(`(() => {
        const nodes = qaPriceNodes();
        const animations = nodes.map(node => node.getAnimations()[0]);
        const samples = [0, 50, 150, 350, 450, 600, 799, 800, 850].map(time => {
          animations.forEach(animation => { animation.currentTime = time; });
          return { time, colors: nodes.map(node => getComputedStyle(node).color) };
        });
        animations.forEach(animation => { animation.currentTime = 0; });
        return samples;
      })()`);
      report.timingSamples.push({ theme, direction, samples: timingSamples });
      for (const sample of timingSamples) {
        assert.deepEqual(sample.colors, sample.time < 800 ? snapshots.map(() => expected) : baseline,
          `${theme} ${direction} at ${sample.time}ms: hold full color for 800ms, then restore`);
      }
      report.checks.push(`${theme}: ${direction} keeps its full color at 0–799ms and restores at 800ms on all quote surfaces`);
      for (const state of ["hover", "active", "focus-visible"]) {
        const selectors = [
          '[data-market-favorite-sort-item][data-market-id="BINANCE:FUTURES:BTCUSDT"]',
          '[data-watchlist-row="BINANCE:FUTURES:BTCUSDT"] [data-watchlist-action="select"]',
          '[data-market-action="symbol"][data-market-id="BINANCE:FUTURES:BTCUSDT"]',
        ];
        for (const selector of selectors) await forceState(selector, [state]);
        assert.ok((await js("qaPriceNodes().map(node => getComputedStyle(node).color)")).every(color => color === expected), `${theme} ${direction} ${state}`);
        for (const selector of selectors) await forceState(selector, []);
      }
      await capture(`${theme}-${direction}`);
      await js("qaPriceNodes().forEach(node => node.getAnimations().forEach(a => a.finish()))");
      assert.deepEqual(await js("qaPriceNodes().map(node => getComputedStyle(node).color)"), baseline);
      report.checks.push(`${theme}: ${direction} flashes on titlebar, watchlist and picker; restores original text colors`);
      await js(`qaEmit(${price})`);
      await wait("workspace.favoriteTickerPaintFrame === null && workspace.liveChartPaintFrame === null && workspace.liveChartPaintTimer === null");
      assert.equal(await js("qaPriceNodes().some(node => node.getAnimations().length > 0)"), false);
      report.checks.push(`${theme}: unchanged ${price} does not flash`);
    }
    // Rebuild populated rows without a new quote: no replay or cross-symbol comparison.
    await pause(850);
    await js("workspace.renderFavoriteTickerBar();workspace.watchlistPanel.refresh();workspace.renderMarkets()");
    await wait("!workspace.marketList.hasAttribute('aria-busy')");
    assert.equal(await js("qaPriceNodes().some(node => node.getAnimations().length > 0)"), false);
    await js("workspace.setPickerOpen(false)");
    await capture(`${theme}-settled`);
    report.checks.push(`${theme}: rebuilding rows does not replay a completed flash`);
  }
  // Real time completion, followed by a theme change during a live flash.
  await js("qaEmit(81800)");
  await wait("workspace.favoriteTickerPaintFrame === null && workspace.liveChartPaintFrame === null && workspace.liveChartPaintTimer === null");
  await pause(900);
  assert.equal(await js("qaPriceNodes().some(node => node.getAnimations().length > 0)"), false);
  await js("qaEmit(81810)");
  await wait("workspace.favoriteTickerPaintFrame === null && workspace.liveChartPaintFrame === null && workspace.liveChartPaintTimer === null");
  await js("qaFreeze();document.documentElement.dataset.theme='light'");
  await js("qaPriceNodes().forEach(node => node.getAnimations().forEach(a => a.finish()))");
  await pause(200);
  assert.deepEqual(await js("qaPriceNodes().map(node => getComputedStyle(node).color)"), ["rgb(17, 24, 39)", "rgb(17, 24, 39)", "rgb(23, 32, 51)"]);
  report.checks.push("Flashes expire automatically and restore the active theme after switching during playback");
  await js("workspace.splitLayoutId='2-columns';workspace.applySplitLayout()");
  await wait("workspace.splitPanes.length === 1");
  for (const theme of ["light", "dark"]) {
    await js(`document.documentElement.dataset.theme='${theme}';workspace.splitPanes[0].setSymbolMenuOpen(true)`);
    const splitColors = await js(`(() => {
      const pane = workspace.splitPanes[0];
      const colors = [];
      for (const price of [82000, 82001, 81999]) {
        pane.updateMarkets(pane.markets.map(m => ({...m,markPrice:price,quoteAvailable:true})));
        const node = pane.symbolList.querySelector('[data-split-price]');
        node.getAnimations().forEach(a => {a.pause();a.currentTime=0});
        colors.push(getComputedStyle(node).color);
      }
      pane.setSymbolMenuOpen(false);
      return colors.slice(1);
    })()`);
    assert.deepEqual(splitColors, theme === "light" ? ["rgb(6, 118, 71)", "rgb(196, 33, 62)"] : ["rgb(82, 220, 136)", "rgb(255, 113, 142)"]);
    await js("workspace.watchlist.activeGroupId='indices';workspace.watchlistPanel.refresh()");
    await wait("document.querySelector('[data-watchlist-index] [data-watchlist-price]') !== null");
    const indexColors = await js(`(() => {
      const panel = workspace.watchlistPanel;
      const index = panel.indices.indices[0];
      const colors = [];
      for (const delta of [1, -1]) {
        index.value += delta;
        panel.refresh();
        const node = document.querySelector('[data-watchlist-index] [data-watchlist-price]');
        node.getAnimations().forEach(a => {a.pause();a.currentTime=0});
        colors.push(getComputedStyle(node).color);
      }
      return colors;
    })()`);
    assert.deepEqual(indexColors, splitColors);
    report.checks.push(`${theme}: split-pane quotes and public indices flash in both directions through row rebuilds`);
  }
  assert.equal(await js("window.qaError || ''"), "");
  await js("workspace.destroy()");
  assert.equal(await js("document.getAnimations().filter(a => a.effect?.target?.matches('[data-market-favorite-price],[data-watchlist-price],[data-market-row-price],[data-split-price]')).length"), 0);
  report.checks.push("Workspace destruction cancels price animations");
}

main().then(async () => {
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}).catch(async error => {
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  window?.destroy();
  await server?.close();
  app.exit(process.exitCode || 0);
});
