const {app, BrowserWindow} = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ts = require('typescript');
const packageRoot = path.resolve(__dirname, '..');
const output = path.join(packageRoot, '.cache/custom-theme-picker-lifecycle');
fs.mkdirSync(output, {recursive:true});
app.setPath('userData', path.join(output, 'profile')); app.disableHardwareAcceleration();
const main = fs.readFileSync(path.join(packageRoot, 'src/renderer/main.ts'), 'utf8');
const transpile = source => ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const row = main.slice(main.indexOf('function renderSettingsThemeRow()'), main.indexOf('function renderSettingsFontSizeRow()'));
const start = main.indexOf('.querySelectorAll<HTMLButtonElement>("[data-settings-theme]")');
const bind = main.slice(main.lastIndexOf('\n  root', start), main.indexOf('\n  root', start+1));
const fixture = path.join(output, 'fixture.html');
fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head><body><div id="app"></div><script type="module">
Object.assign(window, await import('/custom-theme.ts'), await import('/color-picker.ts'));
window.lang = await import('/app-language.mjs');
window.root=document.querySelector('#app');window.customThemeSelection=null;window.sharedThemePreference='light';
window.state={auth:{profile:{id:'qa'}},settings:{theme:'light'}};
window.edits=[];window.accountSettingsSync=()=>({edit:(before,after)=>edits.push(after)});
window.applyAppTheme=value=>document.documentElement.dataset.theme=value;window.syncAppThemePreference=()=>{};
window.APP_THEME_STORAGE_KEY='qa-theme';window.selectAppTheme=value=>{customThemeSelection=null;applyCustomTheme(null);applyAppTheme(value)};
${transpile(row)}
window.refreshSettings=()=>{root.innerHTML='<div class="settings-backdrop"></div><dialog class="settings-dialog" open style="padding:30px">'+renderSettingsThemeRow()+'</dialog>';${transpile(bind)}};
refreshSettings();window.ready=true;
</script></body></html>`);
(async()=>{
  await app.whenReady();
  const win=new BrowserWindow({show:false,width:1200,height:850,webPreferences:{offscreen:true,backgroundThrottling:false}});
  const js=source=>win.webContents.executeJavaScript(source,true);
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const settle=()=>js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const click=async selector=>{await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await settle()};
  const open=()=>click('[data-settings-theme="custom"]');
  const isOpen=()=>js('Boolean(window.originalPicker?.isConnected && originalPicker.matches(":popover-open"))');
  await win.loadURL('http://127.0.0.1:5198/@fs/'+fixture.replaceAll('\\','/'));
  for(let i=0;i<100&&!await js('Boolean(window.ready)');i++)await pause(100);
  assert.equal(await js('Boolean(window.ready)'),true);
  for(const theme of ['light','dark']) for(const language of ['zh-CN','en','zh-TW','ko']) {
    await js(`state.settings.theme='${theme}';customThemeSelection=null;applyCustomTheme(null);applyAppTheme('${theme}');refreshSettings();lang.applyAppLanguage('${language}',{root:document.body})`);
    await open();await js('window.originalPicker=document.querySelector(".haolo-color-picker")');
    await click('[data-color-swatch="#2962ff"]');
    await js(`document.querySelector('[data-color-percent]').value='37';document.querySelector('[data-color-percent]').dispatchEvent(new Event('input',{bubbles:true}))`);
    await click('[data-color-add]');
    await js(`window.draftInput=document.querySelector('[data-color-hex]');draftInput.value='#12';draftInput.dispatchEvent(new Event('input',{bubbles:true}));draftInput.focus();draftInput.setSelectionRange(2,3)`);
    await js('refreshSettings()');await settle();
    assert.equal(await isOpen(),true,theme+'/'+language+': background render must keep the original picker open');
    assert.equal(await js('document.activeElement===draftInput'),true,'draft focus survives');
    assert.deepEqual(await js('[draftInput.value,draftInput.selectionStart,draftInput.selectionEnd]'),['#12',2,3]);
    assert.equal(await js('document.querySelector("[data-color-percent]").value'),'37');
    assert.equal(await js('document.querySelector("[data-settings-theme=custom]").getAttribute("aria-expanded")'),'true');
    await click('[data-color-back]');
    await click('[data-color-swatch="#4caf50"]');
    assert.equal(await js('edits.at(-1)["app.theme"]'),'custom:#4caf50:37','edits continue after anchor replacement');
    // A click arriving before the next animation frame must still toggle the new anchor.
    await js('refreshSettings();document.querySelector("[data-settings-theme=custom]").click()');await settle();
    assert.equal(await isOpen(),false,'explicit toggle closes');
  }
  await open();await js('window.originalPicker=document.querySelector(".haolo-color-picker")');
  // Keep the real picker alive through timed background updates beyond the reported few seconds.
  for(let i=0;i<12;i++){await pause(2500);await js('refreshSettings()');await settle();assert.equal(await isOpen(),true,'timed refresh '+i)}
  await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');await settle();
  assert.equal(await isOpen(),false,'Escape still closes');
  await open();await js('window.originalPicker=document.querySelector(".haolo-color-picker");document.body.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))');await settle();
  assert.equal(await isOpen(),false,'outside click still closes');
  await open();await js('window.originalPicker=document.querySelector(".haolo-color-picker");root.innerHTML=""');await settle();
  assert.equal(await isOpen(),false,'leaving settings closes');
  await js('refreshSettings()');await open();await js('window.originalPicker=document.querySelector(".haolo-color-picker");state.auth.profile.id="another-account";refreshSettings()');await settle();
  assert.equal(await isOpen(),false,'account change closes');
  await js('state.auth.profile.id="qa";refreshSettings()');await open();await js('window.originalPicker=document.querySelector(".haolo-color-picker");document.querySelector(".settings-dialog").hidden=true');await settle();
  assert.equal(await isOpen(),false,'hidden owner closes');
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({pass:true,themes:2,locales:4,timedRefreshes:12,elapsedSeconds:30,draftAndFocusPreserved:true,explicitDismissal:true,accountIsolation:true}));
  console.log('PASS picker persists through 30 seconds of background renders; draft/focus/opacity and dismissal/account isolation verified');
  app.exit(0);
})().catch(error=>{console.error(error);app.exit(1)});
