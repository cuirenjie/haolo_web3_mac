// Exercise the built renderer with isolated fake account I/O. No real email,
// credentials, production requests or user profile are used.
import { app, BrowserWindow } from "electron/main";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".tmp", "binance-account-recovery-qa");
app.setPath("userData", path.join(output, "profile"));
app.on("window-all-closed", () => {});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(win, expression) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await delay(75);
  }
  throw new Error(`Timed out: ${expression}`);
}
async function capture(win, name) {
  // The first capture of a hidden window can precede Chromium's first paint.
  await win.webContents.capturePage();
  await delay(250);
  await writeFile(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
}

async function main() {
await mkdir(output, { recursive: true });
await app.whenReady();
const results = [];
try {
  for (const locale of ["zh-CN", "en", "zh-TW"]) for (const theme of ["light", "dark"]) {
    const win = new BrowserWindow({ width: 1280, height: 900, show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    try {
      await win.loadFile(path.join(root, "dist", "renderer", "index.html"), { query: { "binance-account-bound": "1", "i18n-layout-qa": "1" } });
      await waitFor(win, "document.querySelector('[data-conversation-static-action=account]')");
      await win.webContents.executeJavaScript(`localStorage.setItem('haolo.appearance.language', ${JSON.stringify(locale)}); localStorage.setItem('haolo.appearance.theme', ${JSON.stringify(theme)});`);
      win.reload();
      await waitFor(win, "document.querySelector('[data-conversation-static-action=account]')");
      await win.webContents.executeJavaScript(`document.querySelector('[data-action=close-update-dialog]')?.click(); document.querySelector('[data-action=open-settings]')?.click(); document.querySelector('[data-settings-tab=general]')?.click();`);
      await waitFor(win, "document.querySelector('[data-settings-language]')");
      await win.webContents.executeJavaScript(`(() => {
        const language = document.querySelector('[data-settings-language]');
        language.value = ${JSON.stringify(locale)}; language.dispatchEvent(new Event('change', {bubbles:true}));
        document.querySelector('[data-settings-theme=${theme}]').click();
        document.querySelector('[data-action=close-settings]')?.click();
      })()`);
      await win.webContents.executeJavaScript(`(() => {
        document.querySelector('[data-action=close-update-dialog]')?.click();
        const api = window.codexDesktop;
        const bind = api.bindBinanceAccount.bind(api);
        const read = api.getBinanceAccountSnapshot.bind(api);
        window.__binanceQa = { bound: false, reads: 0, attempts: 0, emails: 0 };
        api.getBinanceAccountSnapshot = async (...args) => {
          window.__binanceQa.reads++;
          if (!window.__binanceQa.bound) throw Object.assign(new Error('API Key 无效，请重新绑定'), { code: 'BINANCE_CREDENTIALS_INVALID', retryable: false });
          return read(...args);
        };
        api.sendBinanceAccountOtp = async () => {
          window.__binanceQa.emails++;
          return {challengeId:'offline-challenge',emailMasked:'qa****@example.test',resendAfter:60};
        };
        api.bindBinanceAccount = async params => {
          window.__binanceQa.attempts++;
          window.__binanceQa.correctPayload = params.apiKey === 'offline-new-key' && params.apiSecret === 'offline-new-secret' && params.code === '123456' && params.challengeId === 'offline-challenge';
          await new Promise(resolve => setTimeout(resolve, 350));
          if (window.__binanceQa.attempts === 1) throw new Error('API Key 无效，请重新绑定');
          window.__binanceQa.bound = true;
          return bind(params);
        };
        document.querySelector('[data-conversation-static-action=account]').click();
        document.querySelector('[data-binance-account-action=refresh]')?.click();
      })()`);
      await waitFor(win, "document.querySelector('[data-binance-account-action=rebind]')");
      const error = await win.webContents.executeJavaScript(`(() => {
        const b = document.querySelector('[data-binance-account-action=rebind]');
        const style = getComputedStyle(b), r=b.getBoundingClientRect();
        return {text:document.querySelector('.binance-account-loading.error').textContent,button:b.textContent,theme:document.documentElement.dataset.theme,
          colors:{foreground:style.color,background:style.backgroundColor},fits:r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight};
      })()`);
      assert.equal(error.theme, theme);
      assert.equal(error.fits, true);
      assert.match(error.text, locale === "en" ? /Invalid API Key\. Please reconnect your account\./ : locale === "zh-TW" ? /API Key 無效，請重新綁定/ : /API Key 无效，请重新绑定/);
      assert.equal(error.button.trim(), locale === "en" ? "Reconnect" : locale === "zh-TW" ? "重新綁定" : "重新绑定");
      await capture(win, `${locale}-${theme}-error`);
      // Closing the dialog must leave the recovery button available.
      await win.webContents.executeJavaScript("document.querySelector('[data-binance-account-action=rebind]').click()");
      await waitFor(win, "document.querySelector('[data-binance-account-form-mode=rebind]') && !document.querySelector('input[name=apiKey]').disabled");
      await win.webContents.executeJavaScript("document.querySelector('[data-binance-account-action=close-dialog]').click(); document.querySelector('[data-binance-account-action=rebind]').click()");
      await waitFor(win, "document.querySelector('[data-binance-account-form-mode=rebind]') && !document.querySelector('input[name=apiKey]').disabled");
      const form = await win.webContents.executeJavaScript(`(() => {
        const f = document.querySelector('[data-binance-account-dialog-form]');
        const r=f.closest('dialog').getBoundingClientRect();
        return {title:document.getElementById('binanceAccountDialogTitle').textContent,disabled:f.querySelector('[type=submit]').disabled,
          secretType:f.querySelector('[name=apiSecret]').type,fits:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth};
      })()`);
      assert.equal(form.disabled, true); assert.equal(form.secretType, "password"); assert.equal(form.fits, true);
      assert.equal(form.title, locale === "en" ? "Reconnect Binance API" : locale === "zh-TW" ? "重新綁定 Binance API" : "重新绑定 Binance API");
      await capture(win, `${locale}-${theme}-form`);
      await win.webContents.executeJavaScript(`(() => {
        for (const [name,value] of Object.entries({apiKey:'offline-new-key',apiSecret:'offline-new-secret',code:'123456'})) {
          const input=document.querySelector('input[name='+name+']'); input.value=value; input.dispatchEvent(new Event('input',{bubbles:true}));
        }
        document.querySelector('[data-binance-account-dialog-form]').requestSubmit();
      })()`);
      await waitFor(win, "document.querySelector('.binance-account-dialog-error')");
      assert.equal(await win.webContents.executeJavaScript("document.querySelector('[data-binance-account-action=rebind]') !== null && !window.__binanceQa.bound"), true);
      await win.webContents.executeJavaScript("document.querySelector('[data-binance-account-dialog-form]').requestSubmit()");
      await waitFor(win, "document.querySelector('.binance-account-summary-card') && !document.querySelector('.binance-account-dialog')");
      const flow = await win.webContents.executeJavaScript("window.__binanceQa");
      assert.equal(flow.attempts, 2); assert.equal(flow.emails, 2); assert.equal(flow.correctPayload, true); assert.equal(flow.bound, true);
      results.push({ locale, theme, error, form, flow });
    } catch (error) {
      await capture(win, `${locale}-${theme}-failed`);
      console.error(await win.webContents.executeJavaScript("JSON.stringify({qa:window.__binanceQa,body:document.body.innerText.slice(-3000)})"));
      throw error;
    } finally { win.destroy(); }
  }
  await writeFile(path.join(output, "report.json"), JSON.stringify({ passed: true, results }, null, 2));
  console.log(JSON.stringify({ passed: true, scenarios: results.length, output }));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally { app.exit(process.exitCode || 0); }
}

main().catch(error => { console.error(error); app.exit(1); });
