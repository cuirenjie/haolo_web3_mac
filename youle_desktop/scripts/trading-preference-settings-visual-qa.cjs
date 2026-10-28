// Exercise the production settings dialog, navigation and preference controller
// in a hidden Electron renderer, with isolated profile I/O.
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const ts = require("typescript");
const project = path.resolve(__dirname, "..");
const output = path.join(project, ".cache", "trading-preference-settings-qa");
fs.mkdirSync(output, { recursive: true });
app.setPath("userData", path.join(output, "profile"));
app.disableHardwareAcceleration();

(async () => {
  const { harnessSource } = await import(pathToFileURL(path.join(project, "test/helpers/trading-preference-harness.mjs")));
  const { compileTradingPreferences } = await import(pathToFileURL(path.join(project, "src/main/personal-context/trading-preference-compiler.mjs")));
  const { tradingRiskProfileFromEntries } = await import(pathToFileURL(path.join(project, "src/main/personal-context/memory-store.mjs")));
  const { createCloudTradingPreferences } = await import(pathToFileURL(path.join(project, "src/main/personal-context/cloud-trading-preferences.mjs")));
  const { DEFAULT_TRADING_PREFERENCE_ENTRIES } = await import(pathToFileURL(path.join(project, "src/main/personal-context/trading-preference-defaults.mjs")));
  const { TRADING_PREFERENCE_CHOICE_FIELDS } = await import(pathToFileURL(path.join(project, "src/shared/trading-preference-fields.mjs")));
  let cloudConfig, cloudAdapter;
  ipcMain.handle("qa:cloud-preferences", async (_event, operation, payload) => {
    if (operation === "reset") {
      cloudConfig = { schemaVersion: 1, revision: 0, configHash: "a".repeat(64),
        entries: DEFAULT_TRADING_PREFERENCE_ENTRIES, extraNotes: { value: "" },
        fields: { entryMode: { choice: { selected: ["auto"], custom: "" }, source: "product_default" },
          ...Object.fromEntries(Object.values(TRADING_PREFERENCE_CHOICE_FIELDS).flat().map(field =>
            [field.id, { choice: { selected: [field.defaultValue], custom: "" }, source: "product_default" }])) },
      };
      cloudAdapter = createCloudTradingPreferences({
        owner: async () => ({ ownerId: "qa-cloud", accountId: "qa-account", baseUrl: "https://haolo.example" }),
        store: () => ({ list: async () => ({ entries: [] }) }),
        api: () => ({ tradingCloudRequest: async (kind, body) => {
          if (kind === "preferences") return cloudConfig;
          assert.equal(kind, "savePreferences");
          assert.deepEqual(Object.keys(body.changes), ["entryMode"]);
          assert.equal(body.expectedRevision, cloudConfig.revision);
          assert.equal(Object.hasOwn(body, "extraNotes"), false);
          cloudConfig = { ...cloudConfig, revision: cloudConfig.revision + 1,
            fields: { ...cloudConfig.fields, entryMode: { choice: body.changes.entryMode, source: "user_saved" } } };
          return cloudConfig;
        } }),
      });
      return;
    }
    if (operation === "load") return cloudAdapter.load();
    assert.equal(operation, "save");
    return cloudAdapter.save(payload);
  });
  // Exercise the real host compiler and schema checks; only model transport is a
  // fixture here. Live-model acceptance is a separate script.
  ipcMain.handle("qa:compile-preferences", async (_event, payload) => {
    try {
      const result = await compileTradingPreferences(payload, { analyze: async () => ({ text: JSON.stringify({ schemaVersion: 1, fields: Object.entries(payload.choices).filter(([,c]) => c.selected.includes("custom")).map(([id,c]) => ({ id, status: "accepted", value: id === "risk" ? Number.parseFloat(c.custom) : c.custom, requirements: c.custom })) }) }) });
      return { ok: true, completed: true, profile: { ...tradingRiskProfileFromEntries(result.entries), entryMode: payload.entryMode,
        fieldSources: Object.fromEntries((payload.changedFields || []).map(id => [id, 'user_saved'])) } };
    } catch (error) { return { ok: false, error: { message: error.message, fieldId: error.fieldId } }; }
  });
  const main = fs.readFileSync(path.join(project, "src/renderer/main.ts"), "utf8");
  const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const dialog = transpile(main.slice(main.indexOf("function renderSettingsDialog()"), main.indexOf("function renderGitHubSettingsPanel()")));
  const openSettingsSource = transpile(main.slice(main.indexOf('function openSettingsDialog('), main.indexOf('async function refreshGitHubConnection(')));
  const toastSource = transpile(main.slice(main.indexOf('function showToast('), main.indexOf('function openMyConfigPage(')));
  const navAt = main.indexOf('.querySelectorAll<HTMLButtonElement>("[data-settings-tab]")');
  const navigation = transpile(main.slice(main.lastIndexOf("\n  root", navAt), main.indexOf("\n  root", navAt)));
  const assets = Object.fromEntries(["PROFILE", "CONSUMPTION", "GENERAL", "ABOUT", "CLOSE"].map(name => [`SETTINGS_${name}_ICON_URL`, pathToFileURL(path.join(project, `src/renderer/assets/images/settings-${name.toLowerCase()}.svg`)).href]));
  const fixture = path.join(output, "settings.html");
  fs.writeFileSync(fixture, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${fs.readFileSync(path.join(project, "src/renderer/styles.css"), "utf8")}</style><style>body{background:#e9ebee}html[data-theme=dark] body{background:#202329}</style></head><body><div id="root"></div><script type="module">import {localizeAppTree} from ${JSON.stringify(pathToFileURL(path.join(project, "src/renderer/app-language.mjs")).href)};window.localizeAppTree=localizeAppTree;</script></body></html>`);
  await app.whenReady();
  const preload = path.join(output, "preload.cjs");
  fs.writeFileSync(preload, 'const {contextBridge,ipcRenderer}=require("electron");contextBridge.exposeInMainWorld("qa",{compile:payload=>ipcRenderer.invoke("qa:compile-preferences",payload),cloud:(operation,payload)=>ipcRenderer.invoke("qa:cloud-preferences",operation,payload)});');
  const win = new BrowserWindow({ show: false, width: 1200, height: 860, webPreferences: { preload, offscreen: true, backgroundThrottling: false } });
  const js = async code => {
    try { return await win.webContents.executeJavaScript(code, true); }
    catch (error) { console.error("Renderer check failed:", code.slice(0, 160), errors); throw error; }
  };
  const errors = [];
  win.webContents.on("console-message", event => {
    if (event.level === "error") {
      errors.push(event.message);
      console.error(event.message);
    }
  });
  const bootstrap = `${harnessSource}
    window.root = document.querySelector('#root');
    window.stored = { onboardingCompleted:true, maxLossPerTradePercent:1, moveStopToBreakEven:false, breakEvenTriggerR:1, minimumRiskRewardRatio:2, analysisStyle:'detailed', requiredAnalysisSections:'根据问题按需选择栏目', entries:[{scope:'trading.discipline',key:'user_custom_rules',value:'不允许亏损加仓；每天最多两次'}] };
    window.saveCalls = []; window.failSave = false; window.failLoad = false; window.useCloud = false;
    window.h = createHarness({localizeAppTree, window, localStorage, render:()=>redraw(),
      openSettingsDialog:tab=>window.openSettings(tab), showToast:(...args)=>window.showSetupToast(...args), api:{
      getTradingPreferenceProfile:async()=>{if(failLoad) throw Error('load'); if(useCloud)return qa.cloud('load'); return {ok:true,completed:stored.onboardingCompleted,profile:stored}},
      saveTradingPreferenceProfile:async payload=>{saveCalls.push(payload);if(failSave) throw Error('save'); const result=useCloud?await qa.cloud('save',payload):await qa.compile(payload); if(result.ok) stored=result.profile; return result;}
    }});
    h.state.settingsOpen=true;
    h.state.settings={tab:'general',cwd:'',language:'zh-CN',github:{},externalModels:{loaded:true}};
    window.state=h.state; window.tradingPreferenceSettings=h.tradingPreferenceSettings;
    const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
    const deps={state, tradingPreferenceSettings, ENABLE_GITHUB_SETTINGS_UI:false, ENABLE_LOCAL_EXTERNAL_MODEL_SETTINGS:false,
      escapeHtml:esc,escapeAttr:esc,selectedChatModelValue:()=>'',renderOption:()=>'',DESKTOP_APPROVAL_POLICY:'never',DESKTOP_SANDBOX_POLICY:'danger-full-access',
      ...${JSON.stringify(assets)},settingsSyncStatusText:()=>'',renderSettingsDesktopShortcutRow:()=>'',renderSettingsLanguageRow:()=>'',renderSettingsSwitchRow:()=>'',renderSettingsTaskCompletionPopupRow:()=>'',renderSettingsThemeRow:()=>'',renderSettingsFontSizeRow:()=>'',renderSettingsUserDataRow:()=>'',renderSettingsDiagnosticsButton:()=>'',
      root, render:()=>redraw(),clearGitHubAuthorizationPolling(){},refreshExternalModelProviders(){},refreshGitHubConnection(){},prepareProfileEditDraft(){},prefetchConsumptionData(){},refreshSystemIntegrationState(){}
    };
    const renderDialog = new Function(...Object.keys(deps), ${JSON.stringify(dialog + ";return renderSettingsDialog;")})(...Object.values(deps));
    const bindNavigation = new Function(...Object.keys(deps), ${JSON.stringify(navigation)});
    window.openSettings = new Function(...Object.keys(deps), ${JSON.stringify(openSettingsSource + ";return openSettingsDialog;")})(...Object.values(deps));
    window.showSetupToast = new Function(...Object.keys(deps), ${JSON.stringify("let toastTimer = null;" + toastSource + ";return showToast;")})(...Object.values(deps));
    window.redraw=()=>{const restore=tradingPreferenceSettings.captureView(root);root.innerHTML=(state.settingsOpen?renderDialog():'')+(state.error?'<div class="toast">'+esc(state.error)+'</div>':'');localizeAppTree(root,state.settings.language);restore(root);bindNavigation(...Object.values(deps));tradingPreferenceSettings.bind(root);};
    window.choose=(field,value)=>document.querySelector('[data-preference-field="'+field+'"] input[value="'+value+'"]').click();
    window.fill=(field,text)=>{const input=document.querySelector('[data-preference-custom="'+field+'"]');input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));};
    window.reopen=async()=>{tradingPreferenceSettings.beginSession();await tradingPreferenceSettings.load();};
    window.waitForSave=async()=>{for(let i=0;i<500&&document.querySelector('[data-trading-settings]')?.getAttribute('aria-busy')==='true';i++)await new Promise(resolve=>setTimeout(resolve,20));};
    redraw();
  `;
  const report = { themes: [], cloudEntryModes: [], errors };
  for (const theme of ["light", "dark"]) {
    await win.webContents.session.clearStorageData();
    await win.loadFile(fixture);
    await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await js(bootstrap);
    assert.deepEqual(await js(`Array.from(document.querySelectorAll('[data-settings-tab]')).map(e=>e.dataset.settingsTab)`), ["profile", "trading", "general", "about"]);
    await js(`h.state.settingsOpen=false;h.startTradingPreferenceOnboarding()`);
    assert.equal(await js(`h.state.settingsOpen && h.state.settings.tab==='trading'`), true);
    assert.equal(await js(`h.flows.size`), 0);
    assert.equal(await js(`Object.keys(h.state.items).length`), 0);
    assert.equal(await js(`document.querySelector('[data-preference-field=risk] input:checked').value`), "1");
    assert.equal(await js(`document.querySelector('[data-preference-field]')?.dataset.preferenceField`), "entryMode");
    assert.equal(await js(`document.querySelector('[data-preference-field=entryMode] input:checked').value`), "right");
    assert.equal(await js(`document.querySelectorAll('[data-preference-field=entryMode] input').length`), 2);
    assert.equal(await js(`document.querySelector('[data-preference-field=entryMode] textarea')`), null);
    assert.equal(await js(`document.querySelector('[data-preference-field=breakEven] input:checked').value`), "off");
    assert.equal(await js(`document.querySelector('[data-preference-custom=discipline]').value`), "每天最多两次");
    assert.equal(await js(`document.querySelectorAll('form').length`), 1);
    await new Promise(resolve => setTimeout(resolve, 120));
    fs.writeFileSync(path.join(output, `${theme}-top.png`), (await win.webContents.capturePage()).toPNG());
    await js(`choose('entryMode','left');choose('risk','custom');fill('risk','1.25%，仅在趋势确认时交易');choose('discipline','none');choose('style','concise')`);
    await js(`document.querySelector('[data-settings-tab=general]').click();document.querySelector('[data-settings-tab=trading]').click()`);
    assert.equal(await js(`document.querySelector('[data-preference-custom=risk]').value`), "1.25%，仅在趋势确认时交易");
    await js(`choose('style','custom');fill('style','先列结论，再解释依据');document.querySelector('[data-preference-custom=style]').setSelectionRange(3,5)`);
    const beforeRender = await js(`({scroll:document.querySelector('.settings-main').scrollTop,selection:document.activeElement.selectionStart})`);
    await js(`redraw()`);
    assert.equal(await js(`document.activeElement.dataset.preferenceCustom`), "style");
    assert.equal(await js(`document.activeElement.selectionStart`), beforeRender.selection);
    assert.equal(await js(`document.querySelector('.settings-main').scrollTop`), beforeRender.scroll);
    await js(`choose('style','concise')`);
    await js(`fill('risk','101%');document.querySelector('[data-preference-save]').click();waitForSave()`);
    assert.equal(await js(`saveCalls.length`), 1);
    assert.equal(await js(`saveCalls[0].entryMode`), "left");
    assert.deepEqual(await js(`saveCalls[0].changedFields.slice().sort()`), ["discipline", "entryMode", "risk", "style"]);
    assert.equal(await js(`document.activeElement.dataset.preferenceCustom`), "risk");
    await js(`fill('risk','1.25%，仅在趋势确认时交易');failSave=true;document.querySelector('[data-preference-save]').click();waitForSave()`);
    assert.match(await js(`document.querySelector('[role=alert]').textContent`), /已保留你的修改/);
    await js(`failSave=false;document.querySelector('[data-preference-save]').click();waitForSave()`);
    assert.match(await js(`document.querySelector('.settings-trading-status').textContent`), /已保存/);
    await js(`reopen()`);
    assert.equal(await js(`document.querySelector('[data-preference-field=entryMode] input:checked').value`), "left");
    assert.match(await js(`document.querySelector('[data-preference-source=entryMode]').textContent`), /已保存/);
    assert.equal(await js(`document.querySelector('[data-preference-custom=risk]').value`), "1.25%，仅在趋势确认时交易");
    assert.deepEqual(await js(`Array.from(document.querySelectorAll('[data-preference-field=discipline] input:checked')).map(e=>e.value)`), ["none"]);
    await js(`document.querySelector('.settings-main').scrollTop=99999`);
    await new Promise(resolve => setTimeout(resolve, 100));
    fs.writeFileSync(path.join(output, `${theme}-bottom.png`), (await win.webContents.capturePage()).toPNG());
    for (const language of ["en", "zh-TW", "zh-CN"]) {
      await js(`state.settings.language=${JSON.stringify(language)};redraw()`);
      if (language === "en") {
        const text = await js(`document.querySelector('[data-trading-settings]').innerText`);
        assert.doesNotMatch(text, /\p{Script=Han}/u, text);
        await js(`choose('style','detailed')`);
        assert.doesNotMatch(await js(`document.querySelector('.settings-trading-status').textContent`), /\p{Script=Han}/u);
      }
      assert.equal(await js(`document.querySelector('[data-preference-custom=risk]').value`), "1.25%，仅在趋势确认时交易");
    }
    for (const size of [[1200,860],[900,680]]) {
      win.setSize(...size);
      await js(`document.documentElement.style.setProperty('--settings-font-size-offset','3px');redraw()`);
      const layout = await js(`(()=>{const main=document.querySelector('.settings-main');const save=document.querySelector('[data-preference-save]');main.scrollTop=99999;return {overflow:main.scrollWidth>main.clientWidth,saveBottom:save.getBoundingClientRect().bottom,mainBottom:main.getBoundingClientRect().bottom}})()`);
      assert.equal(layout.overflow, false);
      assert.ok(layout.saveBottom <= layout.mainBottom + 1);
    }
    await js(`failLoad=true;reopen()`);
    assert.equal(await js(`document.querySelector('[data-preference-save]')===null`), true);
    await js(`failLoad=false;document.querySelector('[data-preference-retry]').click()`);
    assert.equal(await js(`document.querySelectorAll('[data-preference-field]').length`), 7);
    const writesBeforeDefaults = await js(`saveCalls.length`);
    await js(`stored={onboardingCompleted:false,maxLossPerTradePercent:2,minimumRiskRewardRatio:0.4,moveStopToBreakEven:true,breakEvenTriggerR:1,analysisStyle:'concise',entries:[]};reopen()`);
    assert.equal(await js(`document.querySelector('.settings-trading-intro')`), null);
    assert.equal(await js(`document.querySelector('[data-preference-save]').disabled`), true);
    assert.equal(await js(`saveCalls.length`), writesBeforeDefaults);
    await js(`choose('risk','3')`);
    assert.equal(await js(`document.querySelector('[data-preference-save]').disabled`), false);
    assert.equal(await js(`stored.maxLossPerTradePercent`), 2);
    await js(`document.querySelector('[data-preference-save]').click();waitForSave()`);
    assert.equal(await js(`stored.maxLossPerTradePercent`), 3);
    assert.equal(await js(`document.querySelector('[data-preference-save]').disabled`), true);
    win.setSize(1200, 860);
    await js(`document.documentElement.style.setProperty('--settings-font-size-offset','0px');
      stored={onboardingCompleted:false};h.resetTradingPreferenceProfileState();state.settingsOpen=false;state.error=null;redraw();
      h.loadTradingPreferenceProfile()`);
    await js(`h.scheduleTradingPreferenceSetupPrompt();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    assert.equal(await js(`state.settingsOpen && state.settings.tab==='trading'`), true);
    assert.deepEqual(await js(`Array.from(document.querySelectorAll('.settings-nav > button')).map(button=>button.dataset.settingsTab||button.dataset.action)`),
      ["profile", "trading", "open-consumption", "general", "about"]);
    assert.equal(await js(`document.querySelector('.toast').textContent`), "请设置交易偏好，新增左侧入场策略");
    assert.equal(await js(`getComputedStyle(document.querySelector('.toast')).bottom`), "22px");
    fs.writeFileSync(path.join(output, `${theme}-first-setup.png`), (await win.webContents.capturePage()).toPNG());
    await js(`state.settingsOpen=false;redraw();h.scheduleTradingPreferenceSetupPrompt();new Promise(resolve=>requestAnimationFrame(resolve))`);
    assert.equal(await js(`state.settingsOpen`), false);
    await win.loadFile(fixture);
    await js(bootstrap);
    await js(`stored={onboardingCompleted:false};h.resetTradingPreferenceProfileState();state.settingsOpen=false;redraw();h.loadTradingPreferenceProfile()`);
    await js(`h.scheduleTradingPreferenceSetupPrompt();new Promise(resolve=>requestAnimationFrame(resolve))`);
    assert.equal(await js(`state.settingsOpen`), false, "persisted prompt history must survive renderer reload");
    // The cloud schema has no legacy onboarding_completed entry; saved-field provenance confirms completion.
    // Exercise actual radio clicks, IPC and the production cloud adapter.
    await js(`qa.cloud('reset')`);
    await js(`useCloud=true;state.settingsOpen=true;state.settings.tab='trading';reopen()`);
    for (const mode of ["left", "right"]) {
      await js(`choose('entryMode',${JSON.stringify(mode)})`);
      if (mode === "left") {
        await js(`failSave=true;document.querySelector('[data-preference-save]').click();waitForSave()`);
        assert.equal(await js(`document.querySelector('[role=alert]').hidden`), false);
        assert.equal(await js(`document.querySelector('[data-preference-field=entryMode] input:checked').value`), mode);
        assert.equal((await cloudAdapter.effective()).revision, 0);
        await js(`failSave=false`);
      }
      await js(`document.querySelector('[data-preference-save]').click();waitForSave()`);
      assert.match(await js(`document.querySelector('.settings-trading-status').textContent`), /交易偏好已保存/);
      assert.equal(await js(`document.querySelector('[role=alert]').hidden`), true);
      assert.equal(await js(`document.querySelector('[data-preference-save]').disabled`), true);
      assert.equal(await js(`stored.onboardingCompleted`), true);
      assert.deepEqual(await js(`saveCalls.at(-1).changedFields`), ["entryMode"]);
      assert.equal((await cloudAdapter.effective()).profile.entryMode, mode);
      await js(`reopen()`);
      assert.equal(await js(`document.querySelector('[data-preference-field=entryMode] input:checked').value`), mode);
      assert.match(await js(`document.querySelector('[data-preference-source=entryMode]').textContent`), /已保存的偏好/);
      assert.match(await js(`document.querySelector('[data-preference-source=risk]').textContent`), /产品默认值/);
      assert.equal(await js(`document.querySelector('[data-preference-save]').disabled`), true);
      report.cloudEntryModes.push({ theme, mode, revision: cloudConfig.revision });
    }
    report.themes.push(theme);
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, output, ...report }));
  win.destroy();
  app.quit();
})().catch(error => { console.error(error); app.exit(1); });
