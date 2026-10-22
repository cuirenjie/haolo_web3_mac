import { app, BrowserWindow } from "electron/main";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".tmp", "trading-star-watchlist-qa");
app.setPath("userData", path.join(output, "profile"));
app.disableHardwareAcceleration();
const report = { startedAt: new Date().toISOString(), checks: [], screenshots: [], errors: [] };
let window, server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  await mkdir(output, { recursive: true });
  try {
    server = await createServer({
      configFile: false, root: path.join(root, "src", "renderer"),
      server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false, fs: { allow: [root] } },
      clearScreen: false,
    });
    await server.listen();
    await app.whenReady();
    window = new BrowserWindow({
      show: false, width: 1600, height: 1000,
      webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: true },
    });
    const js = source => window.webContents.executeJavaScript(source, true);
    const wait = async expression => {
      for (let i = 0; i < 150; i++) {
        if (await js(expression)) return;
        const error = await js("window.qaError || ''");
        if (error) throw Error(error);
        await pause(100);
      }
      throw Error(`Timed out: ${expression}`);
    };
    const click = async selector => {
      const point = await js(`(() => {
        const button = document.querySelector(${JSON.stringify(selector)});
        if (!button) throw Error('Missing control: ' + ${JSON.stringify(selector)});
        button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const r = button.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`);
      window.webContents.sendInputEvent({ type: "mouseMove", ...point });
      await pause(150); // Hover-only remove controls must receive their pointer events.
      window.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
      window.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
      await pause(100);
    };
    const fixture = `${server.resolvedUrls.local[0]}@fs/${path.join(root, "test", "fixtures", "trading-watchlist.html").replaceAll("\\", "/")}`;
    const reload = async () => { await window.loadURL(fixture); await wait("window.ready === true"); };
    const capture = async name => {
      await js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      await pause(150);
      const file = path.join(output, `${name}.png`);
      await writeFile(file, (await window.webContents.capturePage()).toPNG());
      report.screenshots.push(file);
    };
    const installServer = () => js(`(() => {
      window.qaFavoriteCalls = [];
      window.qaFavoritesOffline = false;
      window.qaRemoteFavorites = new Map(JSON.parse(localStorage.getItem('qa.remote-favorites') || '[]'));
      const save = () => localStorage.setItem('qa.remote-favorites', JSON.stringify([...qaRemoteFavorites]));
      Object.assign(window.codexDesktop, {
        listTradingFavorites: async () => ({ initialized: true, version: 1, items: [...qaRemoteFavorites.values()] }),
        addTradingFavorite: async record => {
          if (qaFavoritesOffline) throw Error('QA offline');
          qaFavoriteCalls.push(['add', record.id]); qaRemoteFavorites.set(record.id, record); save(); return { version: 1 };
        },
        removeTradingFavorite: async ({ marketId }) => {
          if (qaFavoritesOffline) throw Error('QA offline');
          qaFavoriteCalls.push(['remove', marketId]); qaRemoteFavorites.delete(marketId); save(); return { version: 1 };
        },
        reorderTradingFavorites: async ({ marketIds }) => {
          if (qaFavoritesOffline) throw Error('QA offline');
          qaFavoriteCalls.push(['order', marketIds]);
          window.qaRemoteFavorites = new Map([
            ...marketIds.filter(id => qaRemoteFavorites.has(id)).map(id => [id, qaRemoteFavorites.get(id)]),
            ...qaRemoteFavorites,
          ]);
          save(); return { version: 1 };
        },
      });
    })()`);
    const star = symbol => `[data-market-action="favorite"][data-market-id="BINANCE:FUTURES:${symbol}USDT"]`;
    const tickerIds = () => js("Array.from(document.querySelectorAll('[data-market-favorite-sort-item]'), item => item.dataset.marketId)");
    const watchlistIds = () => js("Array.from(document.querySelectorAll('[data-watchlist-row]'), item => item.dataset.marketId)");
    const assertVisible = async (symbol, expected = true) => {
      const id = `BINANCE:FUTURES:${symbol}USDT`;
      assert.equal(await js(`!!document.querySelector('[data-watchlist-row="${id}"]')`), expected, `watchlist ${symbol}`);
      assert.equal(await js(`!!document.querySelector('[data-market-action="favorite-symbol"][data-market-id="${id}"]')`), expected, `ticker ${symbol}`);
      const pressed = await js(`document.querySelector(${JSON.stringify(star(symbol))})?.getAttribute('aria-pressed')`);
      if (!await js("workspace.picker.hidden") && pressed !== null && pressed !== undefined)
        assert.equal(pressed, String(expected), `star ${symbol}`);
    };
    await reload();
    await js(`(() => {
      localStorage.clear();
      const account = 'isolated-watchlist-qa';
      const sol = qaMarkets.find(m => m.id === 'BINANCE:FUTURES:SOLUSDT');
      const eth = qaMarkets.find(m => m.id === 'BINANCE:FUTURES:ETHUSDT');
      localStorage.setItem('haolo.trading-market.favorites.v1.account.' + account, JSON.stringify([sol.id, 'BINANCE:FUTURES:ORDIUSDT']));
      localStorage.setItem('haolo.trading-market.favorite-records.v1.account.' + account, JSON.stringify([sol]));
      localStorage.setItem('haolo.trading-market.watchlists.v1.account.' + account, JSON.stringify({
        version: 1, activeGroupId: 'watchlist', expanded: true,
        groups: [{ id: 'watchlist', name: '自选', markets: [eth] }],
      }));
      localStorage.setItem('qa.remote-favorites', JSON.stringify([['binance:usdm:ETHUSDT', {...eth,id:'binance:usdm:ETHUSDT'}]]));
    })()`);
    await reload();
    await assertVisible("SOL");
    await assertVisible("ORDI");
    await installServer();
    await js("workspace.syncFavoriteServer(true)");
    await assertVisible("SOL");
    assert.equal(await js("qaRemoteFavorites.size"), 3);
    report.checks.push("Existing saved stars are repaired on startup and merged into an initialized cloud list without losing its rows");

    await js("workspace.commitFavoriteTickerOrder(workspace.favoriteTickerMarkets().map(m => m.id).reverse()); workspace.renderFavoriteTickerBar()");
    const previousTickerOrder = await tickerIds();
    const newestTickerOrder = ["BINANCE:FUTURES:BNBUSDT", ...previousTickerOrder];
    const newestWatchlistOrder = ["BINANCE:FUTURES:BNBUSDT", ...await watchlistIds()];
    await click('[data-watchlist-action="sort-price"]');
    await click('[data-watchlist-action="sort-price"]');
    await js(`(() => {
      const style = document.createElement('style');
      style.textContent = '[data-watchlist-rows] { max-height: 120px !important; overflow-y: auto !important; }';
      document.head.append(style);
      const rows = document.querySelector('[data-watchlist-rows]');
      rows.scrollTop = rows.scrollHeight;
    })()`);
    assert.ok(await js("document.querySelector('[data-watchlist-rows]').scrollTop > 0"));
    await click('[data-market-action="toggle-symbols"]');
    await click(star("BNB"));
    await assertVisible("BNB");
    assert.deepEqual(await tickerIds(), newestTickerOrder, "new favorite precedes the saved manual order");
    assert.deepEqual(await watchlistIds(), newestWatchlistOrder, "new favorite leads the right list and restores manual order");
    assert.equal(await js("document.querySelector('[data-watchlist-rows]').scrollTop"), 0);
    assert.equal(await js("document.querySelector('[data-watchlist-action=\"sort-price\"] span').textContent"), "↕");
    assert.equal(await js("document.querySelector('[data-market-picker]').hidden"), false);
    await js("workspace.favoriteServerQueue");
    assert.equal(await js("qaRemoteFavorites.has('binance:usdm:BNBUSDT')"), true);
    await click(star("BNB"));
    await assertVisible("BNB", false);
    await js("workspace.favoriteServerQueue");
    assert.equal(await js("qaRemoteFavorites.has('binance:usdm:BNBUSDT')"), false);
    await click(star("BNB"));
    await js("workspace.favoriteServerQueue");
    await reload();
    await assertVisible("BNB");
    assert.deepEqual(await tickerIds(), newestTickerOrder, "newest-first order survives a renderer reload");
    assert.deepEqual(await watchlistIds(), newestWatchlistOrder, "right-side newest-first order survives reload and re-add");
    await installServer();
    await js("workspace.syncFavoriteServer(true)");
    await assertVisible("BNB");
    assert.deepEqual(await tickerIds(), newestTickerOrder, "cloud refresh preserves the newest-first ticker order");
    assert.deepEqual(await watchlistIds(), newestWatchlistOrder, "cloud refresh preserves right-side newest-first order");
    report.checks.push("Real mouse clicks on the picker star immediately add/remove both surfaces, keep the picker open and persist through reload/cloud refresh");
    report.checks.push("New favorites appear first ahead of a saved manual order, including after removal/re-add, renderer reload and cloud refresh");
    report.checks.push("New right-side favorites reset price sorting and scroll to the top, retaining all existing rows in manual order");

    await click('[data-watchlist-action="remove"][data-market-id="BINANCE:FUTURES:BNBUSDT"]');
    await assertVisible("BNB", false);
    await click('[data-market-action="toggle-symbols"]');
    await click(star("BNB"));
    await click('[data-market-action="toggle-symbols"]');
    await click('[data-market-action="remove-favorite"][data-market-id="BINANCE:FUTURES:BNBUSDT"]');
    await assertVisible("BNB", false);
    await click('[data-market-action="toggle-symbols"]');
    await assertVisible("BNB", false);
    await click('[data-market-action="toggle-symbols"]');
    report.checks.push("Removing from either the right-side list or the title bar clears the shared row and star");

    await js("workspace.watchlist.addGroup('观察组');workspace.watchlistPanel.refresh()");
    await click('[data-watchlist-action="add"]');
    await click(star("BNB"));
    assert.equal(await js("workspace.watchlist.activeGroup.markets.length"), 0);
    assert.equal(await js("workspace.watchlist.groups[0].markets.some(m=>m.id==='BINANCE:FUTURES:BNBUSDT')"), true);
    await js("workspace.favoriteServerQueue");
    const calls = await js("qaFavoriteCalls.length");
    await click('[data-market-action="toggle-symbols"]');
    await js("workspace.watchlist.addMarkets([qaMarkets.find(m=>m.id==='BINANCE:FUTURES:XAUUSDT')]);workspace.watchlistPanel.refresh()");
    await click('[data-watchlist-action="remove"][data-market-id="BINANCE:FUTURES:XAUUSDT"]');
    await js("workspace.favoriteServerQueue");
    assert.equal(await js("qaFavoriteCalls.length"), calls);
    assert.equal(await js("workspace.watchlist.activeGroup.markets.length"), 0);
    await js("workspace.watchlist.selectGroup('watchlist');workspace.watchlistPanel.refresh();workspace.syncWatchlistChanges()");
    await assertVisible("BNB");
    report.checks.push("Starring while viewing a custom group updates default favorites; custom-group removals stay isolated from cloud favorites");

    await click('[data-market-action="toggle-symbols"]');
    await js("qaFavoritesOffline=true");
    await click(star("AXS"));
    await js("workspace.favoriteServerQueue");
    await assertVisible("AXS");
    assert.equal((await tickerIds())[0], "BINANCE:FUTURES:AXSUSDT");
    assert.equal((await watchlistIds())[0], "BINANCE:FUTURES:AXSUSDT");
    assert.equal(await js("workspace.watchlist.pendingMemberships.size"), 1);
    await reload();
    await assertVisible("AXS");
    assert.equal((await tickerIds())[0], "BINANCE:FUTURES:AXSUSDT");
    assert.equal((await watchlistIds())[0], "BINANCE:FUTURES:AXSUSDT");
    await installServer();
    await js("workspace.syncFavoriteServer(true)");
    assert.equal(await js("workspace.watchlist.pendingMemberships.size"), 0);
    assert.equal(await js("qaRemoteFavorites.has('binance:usdm:AXSUSDT')"), true);
    assert.equal((await watchlistIds())[0], "BINANCE:FUTURES:AXSUSDT");
    report.checks.push("Offline additions survive a real renderer reload and upload successfully on the next sync");
    if (!await js("workspace.picker.hidden")) await click('[data-market-action="toggle-symbols"]');
    for (const theme of ["light", "dark"]) {
      await js(`document.documentElement.dataset.theme='${theme}'`);
      await assertVisible("BNB");
      await capture(`star-and-watchlist-${theme}`);
    }
    assert.equal(await js("window.qaError || ''"), "");
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.errors.push(error.stack || String(error));
    if (window && !window.isDestroyed()) {
      await writeFile(path.join(output, "failure.png"), (await window.webContents.capturePage()).toPNG());
    }
  } finally {
    await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    window?.destroy();
    await Promise.race([server?.close(), pause(2_000)]);
    app.exit(report.status === "passed" ? 0 : 1);
  }
}
void main().catch(error => { process.stderr.write(String(error)); app.exit(1); });
