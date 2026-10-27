// Isolated Electron settings -> IPC -> real preference adapter. Synthetic
// admission rejection only; no user profile, production request or model call.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
const output = path.join(project, 'output', 'preference-save-20261026', 'visual');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();

(async () => {
  const load = relative => import(pathToFileURL(path.join(project, relative)));
  const { createCloudTradingPreferences, cloudTradingPreferenceFailure } = await load('src/main/personal-context/cloud-trading-preferences.mjs');
  const { DEFAULT_TRADING_PREFERENCE_ENTRIES } = await load('src/main/personal-context/trading-preference-defaults.mjs');
  const { TRADING_PREFERENCE_CHOICE_FIELDS } = await load('src/shared/trading-preference-fields.mjs');
  const { harnessSource } = await load('test/helpers/trading-preference-harness.mjs');
  const { translateAppText } = await load('src/renderer/app-language.mjs');
  const initial = () => ({ schemaVersion: 1, revision: 0, configHash: 'a'.repeat(64),
    entries: structuredClone(DEFAULT_TRADING_PREFERENCE_ENTRIES), extraNotes: { value: '', source: 'product_default' },
    fields: { entryMode: { choice: { selected: ['right'], custom: '' }, source: 'product_default' },
      ...Object.fromEntries(Object.values(TRADING_PREFERENCE_CHOICE_FIELDS).flat().map(f => [f.id,
        { choice: { selected: [f.defaultValue], custom: '' }, source: 'product_default' }])) },
  });
  let adapter, current, writes, blocked, remaining, clock, requests;
  const reset = () => {
    current = initial(); writes = 0; blocked = false; remaining = 1; clock = 0; requests = [];
    adapter = createCloudTradingPreferences({ owner: async () => ({ ownerId: 'qa', accountId: 'qa', baseUrl: 'https://qa.invalid' }),
      wait: async ms => { clock += ms; await new Promise(resolve => setTimeout(resolve, 60)); },
      now: () => clock, random: () => 0, preferenceBusyTimeoutMs: 2500,
      api: () => ({ tradingCloudRequest: async (op, body, options) => {
        if (op === 'preferences') return current;
        requests.push({ body: structuredClone(body), key: options.idempotencyKey });
        if (blocked || remaining-- > 0) throw Object.assign(Error('busy'), { status: 429, code: 'MOBILE_BUSY', retryAfterMs: 2000 });
        current = structuredClone(current); current.revision++; current.configHash = 'b'.repeat(64); writes++;
        for (const [id, choice] of Object.entries(body.changes)) current.fields[id] = { choice, source: 'user_saved' };
        return current;
      } }),
    });
  };
  ipcMain.handle('qa:load', () => adapter.load());
  ipcMain.handle('qa:save', async (_event, payload) => {
    try { return await adapter.save(payload); } catch (error) { return cloudTradingPreferenceFailure(error); }
  });
  const preload = path.join(output, 'preload.cjs');
  fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('qa',{
    load:()=>ipcRenderer.invoke('qa:load'),save:p=>ipcRenderer.invoke('qa:save',p)});`);
  const fixture = path.join(output, 'settings.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8"><style>
    ${fs.readFileSync(path.join(project, 'src/renderer/styles.css'), 'utf8')}
    body{overflow:hidden;padding:16px;box-sizing:border-box}.settings-main{max-width:850px;margin:auto;height:calc(100vh - 64px);overflow:auto}
    html[data-theme=dark] body{background:#202329;color:#eee}
    </style></head><body><div class="settings-main" id="root"></div><script type="module">
    import {localizeAppTree} from ${JSON.stringify(pathToFileURL(path.join(project, 'src/renderer/app-language.mjs')).href)};
    window.localizeAppTree=localizeAppTree;</script></body></html>`);
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1000, height: 850,
    webPreferences: { preload, offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const capture = async name => {
    await js(`document.querySelector('[data-preference-save]').scrollIntoView({block:'end'});
      new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
    fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG());
  };
  const report = [];
  for (const theme of ['light', 'dark']) for (const language of ['zh-CN', 'en', 'zh-TW', 'ko', 'ja']) {
    reset(); await win.loadFile(fixture);
    await js(`${harnessSource}
      document.documentElement.dataset.theme=${JSON.stringify(theme)};
      window.root=document.querySelector('#root');window.language=${JSON.stringify(language)};
      window.redraw=()=>{root.innerHTML=editor.render();localizeAppTree(root,language);editor.bind(root);};
      window.h=createHarness({render:()=>redraw(),api:{getTradingPreferenceProfile:()=>qa.load(),saveTradingPreferenceProfile:p=>qa.save(p)}});
      window.editor=h.tradingPreferenceSettings;h.state.settingsOpen=true;h.state.settings={tab:'trading',language};
      window.setMode=mode=>document.querySelector('[name=settings-preference-entryMode][value='+mode+']').click();
      window.settle=async()=>{for(let i=0;i<150;i++){if(document.querySelector('[data-trading-settings]').getAttribute('aria-busy')==='false')return;
        await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Save did not settle');};
      editor.load().then(()=>redraw());`);
    await js(`setMode('left');document.querySelector('[data-preference-save]').click();`);
    assert.equal(await js(`document.querySelector('[data-trading-settings]').getAttribute('aria-busy')`), 'true');
    await js('settle()');
    assert.equal(writes, 1); assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]);
    assert.equal(await js(`document.querySelector('.settings-trading-status').textContent`), translateAppText('交易偏好已保存', language));
    await capture(`${theme}-${language}-saved.png`);
    await js('editor.reset();editor.load().then(()=>redraw());');
    assert.equal(await js(`document.querySelector('[name=settings-preference-entryMode]:checked').value`), 'left');
    blocked = true;
    await js(`setMode('right');document.querySelector('[data-preference-save]').click();settle();`);
    const message = cloudTradingPreferenceFailure({ code: 'MOBILE_BUSY' }).error.message;
    assert.ok((await js(`document.querySelector('[role=alert]').textContent`)).includes(translateAppText(message, language)));
    assert.equal(writes, 1); assert.equal(current.fields.entryMode.choice.selected[0], 'left');
    assert.equal(await js(`document.querySelector('[name=settings-preference-entryMode]:checked').value`), 'right');
    const bounds = await js(`(()=>{const el=document.querySelector('[role=alert]');return {client:el.clientWidth,scroll:el.scrollWidth};})()`);
    assert.ok(bounds.scroll <= bounds.client + 1);
    await capture(`${theme}-${language}-busy.png`);
    blocked = false; await js(`document.querySelector('[data-preference-save]').click();settle();`);
    assert.equal(writes, 2); assert.equal(current.fields.entryMode.choice.selected[0], 'right');
    report.push({ theme, language, passed: true, writes });
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.length, output }));
  win.destroy(); app.quit();
})().catch(error => { console.error(error); app.exit(1); });
