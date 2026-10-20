// Real settings DOM -> IPC -> API client -> local HTTP/PostgreSQL.
// Only accepts the isolated integration server; never loads a user profile.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const project = path.resolve(__dirname, '..');
const output = path.join(project, '.cache', 'trading-preference-cloud-save-qa');
const baseUrl = process.env.HAOLO_PREFERENCE_TEST_BASE_URL;
const accountId = process.env.HAOLO_PREFERENCE_TEST_OWNER;
const endpoint = new URL(baseUrl);
assert.equal(endpoint.protocol, 'http:');
assert.equal(endpoint.hostname, '127.0.0.1');
assert.match(accountId, /^[0-9a-f-]{36}$/);
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();

(async () => {
  const load = relative => import(pathToFileURL(path.join(project, relative)));
  const { YouleApiClient } = await load('src/main/youle-api-client.mjs');
  const { createCloudTradingPreferences, cloudTradingPreferenceFailure } = await load('src/main/personal-context/cloud-trading-preferences.mjs');
  const { harnessSource } = await load('test/helpers/trading-preference-harness.mjs');
  const { translateAppText } = await load('src/renderer/app-language.mjs');
  const writes = [];
  let interrupt = false, blocked = false, dropResponse = false, supersede = false;
  const api = new YouleApiClient({
    serviceFetch: async (url, options) => {
      assert.equal(new URL(url).origin, endpoint.origin);
      if (options.method === 'GET' && blocked) throw new TypeError('isolated confirmation interruption');
      const response = await fetch(url, { ...options, headers: { ...options.headers, 'X-Test-User': accountId } });
      if (options.method === 'PATCH') {
        writes.push({ body: JSON.parse(options.body), status: response.status });
        if (interrupt && response.ok) { blocked = true; interrupt = false; }
        if (dropResponse && response.ok) { dropResponse = false; throw new TypeError('fetch failed'); }
        if (supersede && response.ok) {
          supersede = false;
          const receipt = await response.clone().json();
          const other = await fetch(url, { method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-Test-User': accountId, 'Idempotency-Key': randomUUID() },
            body: JSON.stringify({ expectedRevision: receipt.revision, changes: { entryMode: { selected: ['auto'], custom: '' } } }),
          });
          assert.equal(other.status, 200);
          await other.json();
        }
      }
      return response;
    },
  });
  api.loaded = true; api.baseUrl = baseUrl; api.profile = { id: accountId }; api.token = 'isolated-test-only';
  const makeAdapter = () => createCloudTradingPreferences({
    owner: async () => ({ ownerId: `${baseUrl}::${accountId}`, accountId, baseUrl }), api: () => api,
  });
  const adapter = makeAdapter();
  ipcMain.handle('qa:load', () => adapter.load());
  ipcMain.handle('qa:save', async (_event, payload) => {
    try { return await adapter.save(payload); } catch (error) { return cloudTradingPreferenceFailure(error); }
  });
  const preload = path.join(output, 'preload.cjs');
  fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');
    contextBridge.exposeInMainWorld('qa',{load:()=>ipcRenderer.invoke('qa:load'),save:p=>ipcRenderer.invoke('qa:save',p)});`);
  const fixture = path.join(output, 'settings.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8">
    <style>${fs.readFileSync(path.join(project, 'src/renderer/styles.css'), 'utf8')}</style>
    <style>body{overflow:auto;padding:24px}.settings-main{max-width:850px;margin:auto;max-height:790px;overflow:auto}
    html[data-theme=dark] body{background:#202329;color:#eee}</style></head>
    <body><div class="settings-main" id="root"></div><script type="module">
    import {localizeAppTree} from ${JSON.stringify(pathToFileURL(path.join(project, 'src/renderer/app-language.mjs')).href)};
    window.localizeAppTree=localizeAppTree;</script></body></html>`);
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1000, height: 880,
    webPreferences: { preload, offscreen: true, backgroundThrottling: false } });
  win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
  const js = code => win.webContents.executeJavaScript(code, true);
  const capture = async name => {
    // DOM assertions precede compositor painting in offscreen Electron.
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG());
  };
  const report = [];
  for (const theme of ['light', 'dark']) for (const language of ['zh-CN', 'en', 'zh-TW']) {
    await win.loadFile(fixture);
    await js(`${harnessSource}
      window.root=document.querySelector('#root');
      document.documentElement.dataset.theme=${JSON.stringify(theme)};
      window.lang=${JSON.stringify(language)};
      window.h=createHarness({localizeAppTree,render:()=>redraw(),api:{
        getTradingPreferenceProfile:()=>qa.load(),saveTradingPreferenceProfile:p=>qa.save(p)}});
      h.state.settingsOpen=true;h.state.settings={tab:'trading',language:lang};
      window.editor=h.tradingPreferenceSettings;
      window.redraw=()=>{root.innerHTML=editor.render();localizeAppTree(root,lang);editor.bind(root);};
      window.choose=mode=>document.querySelector('[name=settings-preference-entryMode][value='+mode+']').click();
      window.waitForSave=async()=>{for(let i=0;i<500;i++){
        if(document.querySelector('[data-trading-settings]').getAttribute('aria-busy')==='false')return;
        await new Promise(r=>setTimeout(r,20));}throw Error('Save did not settle');};
      window.waitForLoad=async()=>{for(let i=0;i<500;i++){
        if(document.querySelector('[data-trading-settings]'))return;
        await new Promise(r=>setTimeout(r,20));}throw Error('Load did not settle');};
      editor.load().then(()=>redraw());`);
    // The previous locale ends on auto; start with a different radio so each
    // iteration exercises a real change event and an enabled Save button.
    for (const mode of ['right', 'left', 'auto']) {
      const count = writes.length;
      await js(`choose(${JSON.stringify(mode)});document.querySelector('[data-preference-save]').click();waitForSave();`);
      assert.equal(writes.length, count + 1);
      assert.deepEqual(writes.at(-1).body.changes, { entryMode: { selected: [mode], custom: '' } });
      assert.equal(Object.hasOwn(writes.at(-1).body, 'extraNotes'), false);
      assert.equal(await js(`document.querySelector('.settings-trading-status').textContent`),
        translateAppText('交易偏好已保存', language));
      assert.equal(await js(`document.querySelector('[role=alert]').hidden`), true);
      const persisted = await makeAdapter().load();
      assert.equal(persisted.profile.entryMode, mode);
      assert.equal(persisted.completed, true);
      assert.equal(persisted.profile.entries.some(e => e.key === 'onboarding_completed'), false);
      assert.equal(persisted.profile.fieldSources.risk, 'product_default');
      await js(`editor.beginSession();editor.load();`);
      assert.equal(await js(`document.querySelector('[name=settings-preference-entryMode]:checked').value`), mode);
    }
    interrupt = true;
    await js(`choose('right');document.querySelector('[data-preference-save]').click();waitForSave();`);
    assert.equal(await js(`document.querySelector('[role=alert]').hidden`), false);
    assert.ok((await js(`document.querySelector('[role=alert]').textContent`))
      .includes(translateAppText('保存结果待确认', language)));
    assert.equal(await js(`document.querySelector('.settings-trading-status').textContent`),
      translateAppText('保存结果待确认', language));
    assert.equal(await js(`document.querySelector('[data-preference-source=entryMode]').textContent`),
      translateAppText('保存结果待确认', language));
    assert.equal(await js(`document.querySelector('[data-preference-save]').textContent`),
      translateAppText('重试确认', language));
    await js(`root.scrollTop=root.scrollHeight`);
    await capture(`${theme}-${language}-pending.png`);
    blocked = false;
    const committedRevision = (await makeAdapter().load()).revision;
    await js(`document.querySelector('[data-preference-save]').click();waitForSave();`);
    assert.equal((await makeAdapter().load()).revision, committedRevision);
    assert.equal(await js(`document.querySelector('[role=alert]').hidden`), true);
    assert.equal(await js(`document.querySelector('.settings-trading-status').textContent`),
      translateAppText('交易偏好已保存', language));
    dropResponse = true;
    await js(`choose('left');document.querySelector('[data-preference-save]').click();waitForSave();`);
    const unknownAlert = await js(`document.querySelector('[role=alert]').textContent`);
    assert.ok(unknownAlert.includes(translateAppText('保存结果待确认', language)));
    assert.ok(unknownAlert.includes(translateAppText(
      '未收到完整的保存回执，暂时无法确认是否保存成功。你的修改已保留，请重试确认。', language)));
    const lostReceiptRevision = (await makeAdapter().load()).revision;
    await js(`document.querySelector('[data-preference-save]').click();waitForSave();`);
    assert.equal((await makeAdapter().load()).revision, lostReceiptRevision);
    assert.equal(await js(`document.querySelector('[role=alert]').hidden`), true);
    assert.equal(await js(`document.querySelector('.settings-trading-status').textContent`),
      translateAppText('交易偏好已保存', language));
    await js(`root.scrollTop=root.scrollHeight`);
    await capture(`${theme}-${language}-success.png`);
    supersede = true;
    await js(`choose('right');document.querySelector('[data-preference-save]').click();waitForSave();`);
    assert.ok((await js(`document.querySelector('[role=alert]').textContent`))
      .includes(translateAppText('配置已更新', language)));
    assert.equal(await js(`document.querySelector('[data-preference-source=entryMode]').textContent`),
      translateAppText('待核对的修改', language));
    assert.equal(await js(`document.querySelector('[data-preference-save]').textContent`),
      translateAppText('重新加载', language));
    const beforeReload = writes.length;
    await js(`document.querySelector('[data-preference-save]').click();waitForLoad();`);
    assert.equal(writes.length, beforeReload);
    assert.equal(await js(`document.querySelector('[name=settings-preference-entryMode]:checked').value`), 'auto');
    report.push({ theme, language, entryModes: 3, confirmationRetry: true, lostPatchReceipt: true,
      supersededSaveReload: true, noDuplicateWrite: true });
  }
  assert.ok(writes.every(w => w.status === 200));
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: true, cases: report, patchRequests: writes.length }, null, 2));
  console.log(JSON.stringify({ passed: true, cases: report.length, patchRequests: writes.length }));
  win.destroy();
  app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
