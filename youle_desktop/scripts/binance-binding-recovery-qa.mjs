// Offline Electron visual check using the actual account renderer, locale tree and CSS.
import { app, BrowserWindow, session } from "electron/main";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

async function main() {
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "output", "binance-binding-recovery-qa");
await mkdir(output, { recursive: true });
app.setPath("userData", path.join(output, "profile"));
const bundle = await build({
  stdin: { resolveDir: root, contents: `
    import {createBinanceAccountUiState,renderBinanceAccountPage,renderBinanceAccountDialog} from './src/renderer/binance-account-ui.ts';
    import {applyAppLanguage} from './src/renderer/app-language.mjs';
    import {binanceBindingErrorMessage} from './src/shared/binance-account-errors.mjs';
    window.drawBindingQa=(language,theme,dialog=false)=>{
      document.documentElement.dataset.theme=theme;
      const state=createBinanceAccountUiState();state.loaded=true;
      state.status={bound:false,bindingIncomplete:true,secureStorageAvailable:true};
      state.dialog.open=dialog;state.dialog.mode='rebind';state.dialog.challengeId='offline';
      state.dialog.error=binanceBindingErrorMessage('READ_ONLY_KEY_REQUIRED');
      document.querySelector('#app').innerHTML='<main class="desktop-body">'+renderBinanceAccountPage(state)+'</main>'+renderBinanceAccountDialog(state);
      applyAppLanguage(language,{root:document.querySelector('#app')});
    };` },
  bundle: true, write: false, platform: "browser", format: "iife", logLevel: "error",
});
await writeFile(path.join(output, "fixture.js"), bundle.outputFiles[0].contents);
await writeFile(path.join(output, "fixture.html"), `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${pathToFileURL(path.join(root, "src/renderer/styles.css"))}">
<style>html,body,#app{height:100%;margin:0}#app,.desktop-body{display:flex;flex:1;min-height:0}.desktop-body{height:100%}</style>
</head><body><div id="app"></div><script src="./fixture.js"></script></body></html>`);
await app.whenReady();
const isolated = session.fromPartition(`binding-qa-${Date.now()}`);
isolated.webRequest.onBeforeRequest({ urls: ["https://*/*", "http://*/*", "wss://*/*", "ws://*/*"] }, (_details, callback) => callback({ cancel: true }));
const win = new BrowserWindow({ show: false, width: 1200, height: 850, webPreferences: { session: isolated, offscreen: true, sandbox: true, contextIsolation: true } });
const results = [];
try {
  await win.loadFile(path.join(output, "fixture.html"));
  for (const language of ["zh-CN", "en", "zh-TW"]) for (const theme of ["light", "dark"]) for (const dialog of [false, true]) {
    await win.webContents.executeJavaScript(`window.drawBindingQa(${JSON.stringify(language)},${JSON.stringify(theme)},${dialog})`);
    await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const state = await win.webContents.executeJavaScript(`(()=>{
      const button=document.querySelector('[data-binance-account-action="rebind"]');
      const style=getComputedStyle(button),r=button.getBoundingClientRect();
      const error=document.querySelector('[role="alert"]');
      return {text:document.body.innerText,button:button.innerText,buttonWidth:r.width,buttonScrollWidth:button.scrollWidth,
        buttonClientWidth:button.clientWidth,color:style.color,background:style.backgroundColor,
        error:error?.innerText,overflow:document.documentElement.scrollWidth>innerWidth};
    })()`);
    assert.equal(state.overflow, false);
    assert.ok(state.buttonWidth > 0 && state.buttonScrollWidth <= state.buttonClientWidth);
    assert.notEqual(state.color, state.background);
    assert.doesNotMatch(state.text, /HTTP 422|当前绑定设备不在 Windows/);
    if (language === "en") assert.doesNotMatch(state.text, /[\u3400-\u9fff]/);
    if (dialog) assert.ok(state.error && !/^HTTP/.test(state.error));
    const name = `${language}-${theme}-${dialog ? "permission" : "incomplete"}`;
    const capture = await win.webContents.capturePage();
    const pixels = capture.toBitmap(), colors = new Set();
    for (let i = 0; i < pixels.length; i += 64) colors.add(pixels.readUInt32LE(i));
    assert.ok(colors.size > 20, `Blank screenshot: ${name}`);
    await writeFile(path.join(output, `${name}.png`), capture.toPNG());
    results.push({ name, passed: true, ...state });
  }
  await writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: results.length, output }));
} finally {
  win.destroy();
  app.quit();
}
}
main().catch(error => { console.error(error); app.exit(1); });
