// Real settings dialog and controller; isolated preferences, no account writes.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const ts = require('typescript');
const project = path.resolve(__dirname, '..');
const output = path.join(project, 'output', 'preference-restore-20261026');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();

(async () => {
  const { harnessSource } = await import(pathToFileURL(path.join(project, 'test/helpers/trading-preference-harness.mjs')));
  const main = fs.readFileSync(path.join(project, 'src/renderer/main.ts'), 'utf8');
  const dialog = ts.transpileModule(main.slice(main.indexOf('function renderSettingsDialog()'), main.indexOf('function renderGitHubSettingsPanel()')),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const assets = Object.fromEntries(['PROFILE', 'CONSUMPTION', 'GENERAL', 'ABOUT', 'CLOSE'].map(name =>
    [`SETTINGS_${name}_ICON_URL`, pathToFileURL(path.join(project, `src/renderer/assets/images/settings-${name.toLowerCase()}.svg`)).href]));
  const fixture = path.join(output, 'settings.html');
  fs.writeFileSync(fixture, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    ${['styles.css', 'workspace-ui-refinement.css'].map(name => fs.readFileSync(path.join(project, 'src/renderer', name), 'utf8')).join('\n')}
    body{background:#e9ebee}html[data-theme=dark] body{background:#202329}
    </style></head><body><div id="root"></div><script type="module">
    import {localizeAppTree} from ${JSON.stringify(pathToFileURL(path.join(project, 'src/renderer/app-language.mjs')).href)};
    window.localizeAppTree=localizeAppTree;</script></body></html>`);
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1200, height: 860,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = source => win.webContents.executeJavaScript(source, true);
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') { errors.push(event.message); console.error(event.message); } });
  const report = [];
  for (const theme of ['light', 'dark']) {
    await win.loadFile(fixture);
    await js(`(async()=>{${harnessSource}
      document.documentElement.dataset.theme=${JSON.stringify(theme)};
      window.root=document.querySelector('#root');
      window.stored={entryMode:'left',maxLossPerTradePercent:3,moveStopToBreakEven:false,
        minimumRiskRewardRatio:2,analysisStyle:'detailed',entries:[]};
      window.calls=[];window.revision=5;window.releaseSave=null;
      window.h=createHarness({localizeAppTree,render:()=>redraw(),api:{
        getTradingPreferenceProfile:async()=>({ok:true,revision,profile:stored}),
        saveTradingPreferenceProfile:async payload=>{
          calls.push(payload);await new Promise(resolve=>{releaseSave=resolve});
          stored={preferenceForm:structuredClone(payload)};return {ok:true,revision:++revision,profile:stored};
        }
      }});
      h.state.settingsOpen=true;h.state.settings={tab:'trading',cwd:'',language:'zh-CN'};
      window.editor=h.tradingPreferenceSettings;
      const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
      const deps={state:h.state,tradingPreferenceSettings:editor,ENABLE_GITHUB_SETTINGS_UI:false,
        ENABLE_LOCAL_EXTERNAL_MODEL_SETTINGS:false,escapeAttr:escape,escapeHtml:escape,
        selectedChatModelValue:()=>'',renderOption:()=>'',DESKTOP_APPROVAL_POLICY:'never',
        DESKTOP_SANDBOX_POLICY:'danger-full-access',...${JSON.stringify(assets)}};
      const renderDialog=new Function(...Object.keys(deps),${JSON.stringify(dialog + ';return renderSettingsDialog;')})(...Object.values(deps));
      window.redraw=()=>{const restore=editor.captureView(root);root.innerHTML=renderDialog();
        localizeAppTree(root,h.state.settings.language);restore(root);editor.bind(root);};
      window.choose=(field,value)=>document.querySelector('[data-preference-field="'+field+'"] input[value="'+value+'"]').click();
      await editor.load();})()
    `);
    assert.equal(await js(`document.querySelector('[data-preference-restore]').disabled`), false);
    await js(`choose('risk','custom');const custom=document.querySelector('[data-preference-custom=risk]');custom.value='';custom.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-preference-restore]').click();document.querySelector('[data-preference-restore]').click();`);
    assert.equal(await js('calls.length'), 1);
    assert.deepEqual(await js('calls[0].changedFields.slice().sort()'), ['breakEven', 'discipline', 'entryMode', 'extraNotes', 'ratio', 'risk', 'sections', 'style']);
    assert.equal(await js('calls[0].expectedRevision'), 5);
    assert.equal(await js(`document.querySelector('[data-preference-restore]').disabled`), true);
    assert.equal(await js(`document.querySelector('[data-preference-field=entryMode] input:checked').value`), 'right');
    assert.equal(await js(`document.querySelector('[data-preference-custom=risk]').hidden`), true);
    await js(`releaseSave();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    assert.match(await js(`document.querySelector('.settings-trading-status').textContent`), /已保存/);
    await js(`editor.beginSession();editor.load();`);
    assert.equal(await js(`document.querySelector('[data-preference-field=risk] input:checked').value`), '2');
    for (const language of ['zh-CN', 'en', 'zh-TW', 'ko', 'ja']) {
      for (const [width, height, fontOffset] of [[1200, 860, 0], [900, 680, 3]]) {
        win.setSize(width, height);
        await js(`h.state.settings.language=${JSON.stringify(language)};
          document.documentElement.style.setProperty('--app-font-size-offset','${fontOffset}px');redraw();
          document.querySelector('.settings-main').scrollTop=0;
          new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
        const layout = await js(`(()=>{const reset=document.querySelector('[data-preference-restore]');
          const save=document.querySelector('[data-preference-save]');const main=document.querySelector('.settings-main');
          const a=reset.getBoundingClientRect(),b=save.getBoundingClientRect(),m=main.getBoundingClientRect();
          return {label:reset.textContent,overflow:main.scrollWidth>main.clientWidth,left:a.right<=b.left,
            sameRow:Math.abs(a.top-b.top)<=2,visible:a.bottom<=m.bottom&&a.top>=m.top,transparent:getComputedStyle(reset).backgroundColor};})()`);
        assert.equal(layout.overflow, false);
        assert.equal(layout.left, true);
        assert.equal(layout.sameRow, true);
        assert.equal(layout.visible, true);
        assert.equal(layout.transparent, 'rgba(0, 0, 0, 0)');
        if (language !== 'zh-CN') assert.notEqual(layout.label, '恢复默认');
        report.push({ theme, language, width, fontOffset, ...layout });
        if (language === 'zh-CN' && width === 1200) {
          fs.writeFileSync(path.join(output, `${theme}.png`), (await win.webContents.capturePage()).toPNG());
        }
      }
    }
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ checks: report, errors }, null, 2));
  console.log(JSON.stringify({ ok: true, output, layouts: report.length }));
  win.destroy(); app.quit();
})().catch(error => { console.error(error); app.exit(1); });
