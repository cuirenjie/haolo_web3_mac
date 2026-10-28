const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'price-alert-qa', String(Date.now()));
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const preload = path.join(output, 'preload.cjs');
fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron'); contextBridge.exposeInMainWorld('priceQa', {create:p=>ipcRenderer.invoke('priceQa:create',p),snapshot:()=>ipcRenderer.invoke('priceQa:snapshot')});`);
let service;
(async () => {
  const { createCloudPriceAlerts } = await import(pathToFileURL(path.join(root, 'src/main/trading-alerts/cloud-price-alerts.mjs')));
  const { cloudPriceAlertFixture } = await import(pathToFileURL(path.join(root, 'test/helpers/cloud-price-alert-fixture.mjs')));
  const remote = cloudPriceAlertFixture();
  let calls = [], hideReadback = false;
  service = createCloudPriceAlerts({owner:async()=>({ownerId:'qa',accountId:'qa',email:'fixture@example.invalid',baseUrl:'qa'}),api:()=>remote});
  ipcMain.handle('priceQa:create', async (_event, params) => {
    calls.push(params);const data=await service.create(params);
    if(hideReadback)delete data.readbackVerified; // Exercise compatibility with an older main process.
    return {ok:true,data};
  });
  ipcMain.handle('priceQa:snapshot', async () => ({ok:true,data:{...(hideReadback ? {alerts:[]} : await service.snapshot()),cloudLoaded:true}}));
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { preload, offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const until = async expression => { for (let i = 0; i < 100; i++) { if (await js(expression)) return; await pause(100); } throw new Error(`Timed out: ${expression} / ${await js('String(window.qaError)')}`); };
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(40); };
  const rect = expression => js(`(()=>{const r=(${expression}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
  const move = async (x, y) => { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) }); await settle(); };
  const click = async expression => { const r = await rect(expression), p = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; await move(p.x,p.y);
    for (const type of ['mouseDown','mouseUp']) win.webContents.sendInputEvent({ type, ...p, button: 'left', clickCount: 1 }); await settle(); };
  const screenshot = async name => fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const plus = 'workspace.crosshairPriceElement.querySelector("button")';
  const confirm = 'document.querySelector("[data-price-alert-confirm]")';
  const cancel = 'document.querySelector("[data-price-alert-cancel]")';
  const results = [];
  for (const theme of ['light','dark']) {
    const fixture = path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/');
    await win.loadURL(`${process.env.HAOLO_PRICE_QA_URL || 'http://127.0.0.1:5177'}/@fs/${fixture}`);
    await until('window.ready === true');
    await js(`document.documentElement.dataset.theme='${theme}';document.documentElement.lang='zh-CN';window.primary=workspace;
      workspace.loadingHistory=true;workspace.splitLayoutId='1-single';workspace.applySplitLayout();workspace.applyChartTheme();
      window.codexDesktop.tradingAlertsCreateCloudPriceAlert=window.priceQa.create;window.codexDesktop.tradingAlertsSnapshot=window.priceQa.snapshot;
      window.addEventListener('haolo:open-price-alert',async()=>{const m=await import('/trading-alerts-ui.ts');const state=m.createTradingAlertsUiState();m.applyTradingAlertsSnapshot(state,await window.priceQa.snapshot());state.filter='triggered';
        const panel=document.createElement('div');panel.id='price-qa-cards';panel.innerHTML=m.renderTradingAlertsPage(state);host.hidden=true;document.body.append(panel);});`);
    for (const layout of ['main','split']) {
      if (layout === 'split') {
        await js("primary.splitLayoutId='2-columns';primary.applySplitLayout();window.workspace=primary.splitPanes[0];void 0");
        await until('workspace.candles.length > 0');
      }
      await settle();
      const h = await rect('workspace.chartElement');
      await move(h.x + h.width * .6, h.y + h.height * .45);
      await until('!workspace.crosshairPriceElement.hidden');
      const label = await js('workspace.crosshairPriceElement.querySelector("span").textContent');
      assert.equal(await js('getComputedStyle(workspace.crosshairPriceElement).backgroundColor'), 'rgb(19, 19, 19)');
      if (layout === 'main') assert.equal(await js('getComputedStyle(workspace.crosshairTimeElement).backgroundColor'), 'rgb(19, 19, 19)');
      await screenshot(`${theme}-${layout}-labels`);
      const start = calls.length;
      await click(plus); await until('Boolean(document.querySelector("dialog[open]"))');
      assert.equal(await js('document.querySelector(".trading-price-alert-target").textContent'), label);
      await screenshot(`${theme}-${layout}-confirm`);
      await click(cancel); assert.equal(calls.length, start);
      if (layout === 'main') {
        for (const [locale,heading] of [['en','Create a price alert?'],['zh-Hant','建立價格預警？'],['zh-CN','创建价格预警？']]) {
          await js(`document.documentElement.lang=${JSON.stringify(locale)}`);
          await move(h.x+h.width*.6,h.y+h.height*.45);await click(plus);
          assert.equal(await js('document.querySelector(".trading-price-alert-dialog h2").textContent'),heading);
          assert.equal(await js('Boolean(document.querySelector(".trading-price-alert-dialog small"))'),false);
          await screenshot(`${theme}-${locale}-dialog`);await click(cancel);
        }
      }
      await move(h.x + h.width * .6, h.y + h.height * .45); await click(plus);
      const target = await js('document.querySelector(".trading-price-alert-target").textContent');
      hideReadback = theme === 'light' && layout === 'main';
      await click(confirm);
      await until('document.querySelector("[data-price-alert-confirm]")?.disabled === false');
      if (hideReadback) {
        const statusText = await js('document.querySelector("[data-price-alert-status]").textContent');
        assert.ok(statusText.includes('尚未'), statusText || 'Empty creation status');
        assert.equal((await service.snapshot()).alerts.length, 1);
        hideReadback = false;
        await click(confirm); await until('document.querySelector("[data-price-alert-confirm]")?.disabled === false');
        assert.equal(await js('document.querySelector(".trading-price-alert-dialog h2")?.textContent'), '预警已创建', await js('document.querySelector("[data-price-alert-status]")?.textContent'));
        assert.equal(calls[start].requestId, calls[start + 1].requestId);
        assert.equal((await service.snapshot()).alerts.length, 1);
      } else await until('document.querySelector(".trading-price-alert-dialog h2")?.textContent === "预警已创建"');
      assert.equal(calls.at(-1).price, Number(target.replaceAll(',','')));
      await screenshot(`${theme}-${layout}-created`);
      const remoteAlert = remote.items.at(-1);
      remoteAlert.state='completed';remoteAlert.enabled=false;
      const alert = (await service.snapshot()).alerts.find(a => a.cloud.id === remoteAlert.id);
      assert.equal(alert.status, 'completed');
      await click(confirm); await until('Boolean(document.querySelector("#price-qa-cards [data-trading-alert-card]"))');
      assert.ok(await js(`Boolean(document.querySelector('[data-trading-alert-card="${alert.alertId}"]'))`));
      await screenshot(`${theme}-${layout}-card`);
      await js('document.querySelector("#price-qa-cards").remove();host.hidden=false;');
      results.push({ theme, layout, price: calls.at(-1).price, alertId: alert.alertId, status: alert.status });
      console.log(`PASS ${theme}/${layout}: pointer +, cancel, confirmation, cloud card readback`);
    }
  }
  assert.equal(remote.items.length, 4);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ results, backend:'fixture; email tested separately against PostgreSQL Worker' }, null, 2));
  console.log('Artifacts: ' + output);
  win.destroy(); app.exit(0);
})().catch(async error => { console.error(error.stack || error); app.exit(1); });
