// Isolated built-app UI verification. All account data is synthetic, all network
// requests are blocked, and the user's profile and running app are untouched.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");


const root = path.resolve(__dirname, "..");
const output = path.join(root, "output", "account-performance-20261022");
require("node:fs").mkdirSync(path.join(output, "profile"), { recursive: true });
app.setPath("userData", path.join(output, "profile"));
app.on("window-all-closed", () => {});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(win, condition) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await win.webContents.executeJavaScript(`Boolean(${condition})`)) return;
    await pause(75);
  }
  throw new Error(`Timed out: ${condition}`);
}
async function main() {
await mkdir(output, { recursive: true });
await app.whenReady();
session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_details, callback) => callback({ cancel: true }));
const results = [];
try {
  for (const locale of ["zh-CN", "en", "zh-TW"]) for (const theme of ["light", "dark"]) {
    const win = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    try {
      await win.loadFile(path.join(root, "dist/renderer/index.html"), { query: { "binance-account-bound": "1", "i18n-layout-qa": "1" } });
      await waitFor(win, "document.querySelector('[data-conversation-static-action=account]')");
      await win.webContents.executeJavaScript(`localStorage.setItem('haolo.appearance.language', ${JSON.stringify(locale)}); localStorage.setItem('haolo.appearance.theme', ${JSON.stringify(theme)});`);
      await win.loadFile(path.join(root, "dist/renderer/index.html"), { query: { "binance-account-bound": "1", "i18n-layout-qa": "1" } });
      await waitFor(win, "document.querySelector('[data-conversation-static-action=account]')");
      await win.webContents.executeJavaScript("document.querySelector('[data-action=close-update-dialog]')?.click(); document.querySelector('[data-action=open-settings]')?.click(); document.querySelector('[data-settings-tab=general]')?.click();");
      await waitFor(win, "document.querySelector('[data-settings-language]')");
      await win.webContents.executeJavaScript(`(() => {
        const language = document.querySelector('[data-settings-language]');
        language.value = ${JSON.stringify(locale)}; language.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('[data-settings-theme=${theme}]').click();
        document.querySelector('[data-action=close-settings]')?.click();
      })()`);
      await win.webContents.executeJavaScript(`(() => {
        document.querySelector('[data-action=close-update-dialog]')?.click();
        window.__curveQa = { calls: [], errors: [] };
        window.addEventListener('error', event => window.__curveQa.errors.push(event.message));
        const api = window.codexDesktop;
        const status = api.getBinanceAccountStatus.bind(api);
        const snapshot = api.getBinanceAccountSnapshot.bind(api);
        api.getBinanceAccountStatus = async () => ({ ...await status(), serverCredentialsBound: true, serverConnectionId: 'qa-curve' });
        api.getBinanceAccountSnapshot = async () => ({ ...await snapshot(), estimatedTotalAssets: 68.55217183, marginBalance: 68.5522, walletBalance: 68.5522, availableBalance: 68.5522, unrealizedPnl: 0, initialMargin: 0, todayPnl: 0, todayPnlPercent: 0, realizedPnlToday: 0 });
        api.getBinanceAccountPerformance = async ({ days }) => {
          window.__curveQa.calls.push(days);
          const now = Date.now(), day = 86400000;
          const start = now - (days === 1 ? day / 2 : day * 1.6);
          const values = days === 30 ? [0, 1.2, 2.1, 1.4, 2.6] : [-.06, .12, -.08, -.51, -.51];
          return { days, asOf: now, status: 'ready', stats: { totalAmount: values.at(-1), totalRate: null }, points: [], chart: { startAt: start, endAt: now, points: values.map((amount, i) => ({ timestamp: start + (now - start) * i / 4, amount, rate: null })) } };
        };
        document.querySelector('[data-conversation-static-action=account]').click();
      })()`);
      await waitFor(win, "document.querySelector('[data-binance-account-action=refresh]')");
      await win.webContents.executeJavaScript("document.querySelector('[data-binance-account-action=refresh]').click()");
      await waitFor(win, "document.querySelector('.binance-account-primary-amount').textContent.includes('68.55217183')");
      await win.webContents.executeJavaScript("document.querySelector('[data-binance-account-section=assets]').click()");
      try { await waitFor(win, "document.querySelector('.binance-account-curve-chart')"); }
      catch (error) {
        console.error(await win.webContents.executeJavaScript("JSON.stringify({ text: document.body.innerText.slice(-4000), qa: window.__curveQa })"));
        await writeFile(path.join(output, "failure.png"), (await win.webContents.capturePage()).toPNG());
        throw error;
      }
      for (const width of [1440, 1120, 900, 700]) {
        win.setSize(width, 1000); await pause(180);
        const layout = await win.webContents.executeJavaScript(`(() => {
          const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
          const card = rect('.total-assets'), overview = rect('.binance-account-total-overview'), curve = rect('.binance-account-curve');
          const selectStyle = getComputedStyle(document.querySelector('[data-binance-performance-range]'));
          const picker = getComputedStyle(document.querySelector('[data-binance-performance-range]'), '::picker-icon');
          return { language: document.documentElement.dataset.language, theme: document.documentElement.dataset.theme, rangeBorder: selectStyle.borderWidth, pickerMask: picker.maskImage, pickerWidth: picker.width, width: innerWidth, card, overview, curve, overflow: document.documentElement.scrollWidth > innerWidth, text: document.querySelector('.binance-account-curve-toolbar').textContent.trim(), errors: window.__curveQa.errors };
        })()`);
        assert.equal(layout.overflow, false); assert.deepEqual(layout.errors, []);
        assert.equal(layout.theme, theme); assert.equal(layout.language, locale); assert.equal(layout.rangeBorder, '0px');
        assert.equal(layout.pickerMask, 'none'); assert.equal(layout.pickerWidth, '10px');
        assert.ok(layout.curve.right <= layout.card.right && layout.curve.bottom <= layout.card.bottom);
        assert.ok(layout.curve.x >= layout.overview.right || layout.curve.y >= layout.overview.bottom, "overview and chart must not overlap");
        if (width === 1440) assert.ok(layout.curve.x > layout.overview.x, "wide layout should have a chart on the right");
        results.push({ locale, theme, ...layout });
        if (width === 1440 || (locale === 'zh-CN' && width === 700)) {
          await win.webContents.capturePage(); await pause(150);
          await writeFile(path.join(output, `${locale}-${theme}-${width}.png`), (await win.webContents.capturePage()).toPNG());
        }
      }
      const colors = await win.webContents.executeJavaScript(`(() => {
        const color = selector => getComputedStyle(document.querySelector(selector)).color;
        return {
          positive: color('.binance-account-curve-segment.positive'),
          negative: color('.binance-account-curve-segment.negative'),
          peak: color('.binance-account-curve-marker.positive'),
          tail: color('.binance-account-curve-marker.negative'),
          positiveFill: color('#account-profit-fill-positive'),
          negativeFill: color('#account-profit-fill-negative'),
        };
      })()`);
      assert.notEqual(colors.positive, colors.negative);
      assert.equal(colors.peak, colors.positive); assert.equal(colors.tail, colors.negative);
      assert.equal(colors.positiveFill, colors.positive); assert.equal(colors.negativeFill, colors.negative);
      win.setSize(1440, 1000);
      await win.webContents.executeJavaScript(`document.querySelector('[data-binance-performance-mode=rate]').click()`);
      await waitFor(win, "document.querySelector('.binance-account-curve-chart').textContent.includes('%')");
      assert.equal(await win.webContents.executeJavaScript("window.__curveQa.calls.length"), 1, "switching mode reuses the same response");
      await win.webContents.executeJavaScript(`(() => { const select = document.querySelector('[data-binance-performance-range]'); select.value = '30'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await waitFor(win, "document.querySelector('.binance-account-curve-segment.positive') && !document.querySelector('.binance-account-curve-segment.negative')");
      assert.deepEqual(await win.webContents.executeJavaScript("window.__curveQa.calls"), [7, 30]);
      await win.webContents.executeJavaScript("document.querySelector('[data-binance-account-action=toggle-balances]').click()");
      await waitFor(win, "!document.querySelector('.binance-account-curve-chart')");
      assert.doesNotMatch(await win.webContents.executeJavaScript("document.querySelector('.binance-account-curve').textContent"), /2\.60|0\.51/);
    } finally { win.destroy(); }
  }
  await writeFile(path.join(output, "receipt.json"), JSON.stringify({ cases: results.length, results }, null, 2));
  console.log(JSON.stringify({ ok: true, cases: results.length, output }));
} catch (error) { console.error(error); process.exitCode = 1; }
app.exit(process.exitCode || 0);

}
main().catch(error => { console.error(error); app.exit(1); });
