// Isolated native geometry + actual Electron quote window smoke. No account,
// network quotes, taskbar settings or production app state are modified.
const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const output = path.resolve(__dirname, "../output/taskbar-market-quote-qa");
fs.mkdirSync(output, { recursive: true });
app.setPath("userData", path.join(output, "profile"));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let quote;
app.on("window-all-closed", () => {});
(async () => {
  await app.whenReady();
  const { TaskbarMarketQuote } = await import(pathToFileURL(path.resolve(__dirname, "../src/main/taskbar-market-quote.mjs")).href);
  const state = { visible: true, minimized: false, fullscreen: false, focused: false, throttled: true };
  const owner = { isDestroyed: () => false, isVisible: () => state.visible, isMinimized: () => state.minimized,
    isFullScreen: () => state.fullscreen, webContents: { setBackgroundThrottling(value) { state.throttled = value; } },
    restore() { state.minimized = false; }, show() { state.visible = true; }, focus() { state.focused = true; } };
  quote = new TaskbarMarketQuote(() => owner);
  const sample = { marketId: "BINANCE:FUTURES:BTCUSDT", name: "BTC/USDT 永续",
    price: 81511.9, priceText: "81,511.90", changePercent: -1.61 };
  const heartbeat = setInterval(() => quote.update(sample), 1000);
  quote.update(sample);
  for (let i = 0; i < 40 && !quote.window?.isVisible(); i++) await pause(500);
  clearInterval(heartbeat);
  console.log(JSON.stringify({ layout: quote.layout, nativeError: quote.lastNativeError, visible: quote.window?.isVisible() }));
  assert.ok(quote.window?.isVisible(), "Haolo must be present with enough taskbar space for the native smoke");
  const win = quote.window;
  quote.retryAfter = Infinity;
  assert.equal(state.throttled, false);
  const inspect = () => win.webContents.executeJavaScript(`({
    text:document.body.innerText, price:document.getElementById("price").className,
    change:document.getElementById("change").className,
    fits:document.querySelector(".values").scrollWidth<=document.querySelector("button").clientWidth-16,
    dark:document.body.classList.contains("dark")
  })`);
  assert.equal((await inspect()).change, "down");
  assert.equal((await inspect()).fits, true);
  // Stop the watcher once shell placement has passed; retain its real layout.
  quote.helper?.kill(); quote.helper = null;
  state.visible = false; state.minimized = true;
  quote.render();
  assert.equal(win.isVisible(), true, "quote stays visible while Haolo is minimized");
  await win.webContents.executeJavaScript('document.querySelector("button").click()');
  await pause(100);
  assert.equal(state.focused, true, "quote click restores and focuses its owner");
  assert.equal(state.minimized, false);
  state.fullscreen = true; quote.render();
  assert.equal(win.isVisible(), false);
  state.fullscreen = false; quote.render();
  assert.equal(win.isVisible(), true);
  const validLayout = quote.layout;
  quote.layout = { visible: false }; quote.render();
  assert.equal(win.isVisible(), false, "auto-hidden shell also hides the quote");
  quote.layout = validLayout;
  for (const dark of [false, true]) {
    // Freeze only the helper while testing themes so its OS theme heartbeat
    // cannot overwrite the deterministic visual fixture.
    quote.layout.dark = dark;
    quote.lastLayoutAt = Date.now();
    quote.render();
    await pause(150);
    const screenshot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(output, dark ? "dark.png" : "light.png"), screenshot.toPNG());
    assert.equal((await inspect()).dark, dark);
  }
  quote.update({ ...sample, price: 81512.1, priceText: "81,512.10" });
  await pause(100);
  assert.equal((await inspect()).price, "up");
  quote.update({ ...sample, marketId: "ETH", name: "ETH/USDT 永续", price: 2322, priceText: "2,322.00", changePercent: 2 });
  await pause(100);
  assert.equal((await inspect()).price, "");
  assert.equal((await inspect()).change, "up");
  quote.update({ ...sample, price: null });
  await pause(100);
  assert.match((await inspect()).text, /--/);
  quote.update(null);
  assert.equal(quote.window, null);
  assert.equal(quote.helper, null);
  assert.equal(state.throttled, true);
  quote.dispose();
  console.log("Taskbar geometry, both themes, live colors, pair switch and cleanup passed.");
  app.exit(0);
})().catch((error) => { console.error(error); quote?.dispose(); app.exit(1); });
