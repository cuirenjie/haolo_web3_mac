const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/custom-theme-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile')); app.disableHardwareAcceleration();
const main = fs.readFileSync(path.join(root, 'src/renderer/main.ts'), 'utf8');
const transpile = s => ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const row = main.slice(main.indexOf('function renderSettingsThemeRow()'),main.indexOf('function renderSettingsFontSizeRow()'));
const start = main.indexOf('.querySelectorAll<HTMLButtonElement>("[data-settings-theme]")');
const bind = main.slice(main.lastIndexOf('\n  root',start), main.indexOf('\n  root',start+1));
const fixture = path.join(output,'fixture.html');
fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"><style>
body{padding:24px}.qa-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.qa-card{padding:24px;border:1px solid var(--line);border-radius:16px;background:var(--surface-primary);color:var(--text-primary)}
.qa-gradient{background:linear-gradient(90deg,#000,#b3b3b3,#fff);height:60px}.qa-hover:hover{background:#b3b3b3}.qa-label{color:#111827}.settings-theme-row{width:390px;max-width:100%}
.qa-cascade{background:#b3b3b3}.qa-cascade.white{background:#fff}.qa-cascade.clear{background:transparent}
@keyframes qa-paint{from{background:#fff;transform:translateX(0)}to{background:#000;transform:translateX(10px);color:#13579b}}
</style></head><body><div id="qa-white" style="background:#fff"><div id="qa-white-alpha" style="background:rgba(255,255,255,.4)">White</div></div><div id="qa-colored" style="background:#ff9800">Color</div><button id="qa-control" style="background:#ff9800">Control</button><div class="qa-grid"><div class="qa-card"><h2>Haolo</h2><div id="settings"></div><p class="qa-label">文字颜色 / Text color</p><div class="qa-gradient"></div><button class="qa-hover">Hover</button></div><div class="qa-card"><div class="composer" style="padding:24px;background:#f5f5f5;color:#111827">Chat / 聊天</div><button style="background:#000;color:#fff;padding:12px;border-radius:20px">Button</button><input placeholder="Input"><div class="qa-label">Account · Plans · Strategies · Settings</div></div></div><script type="module">
window.theme=await import('/custom-theme.ts');Object.assign(window,theme,await import('/color-picker.ts'));window.lang=await import('/app-language.mjs');
window.customThemeSelection=null;window.sharedThemePreference='light';window.state={auth:{profile:{id:'qa'}},settings:{theme:'light'}};window.root=document;window.edits=[];
window.accountSettingsSync=()=>({edit:(before,after)=>edits.push(after)});window.applyAppTheme=(value)=>document.documentElement.dataset.theme=value;
window.syncAppThemePreference=()=>{};window.APP_THEME_STORAGE_KEY='qa-theme';window.selectAppTheme=value=>{customThemeSelection=null;applyCustomTheme(null);applyAppTheme(value)};
${transpile(row)}
document.querySelector('#settings').innerHTML='<dialog class="settings-dialog" open style="position:static;width:auto;display:block">'+renderSettingsThemeRow()+'</dialog>';${transpile(bind)}
window.ready=true;</script></body></html>`);
(async()=>{
 await app.whenReady();const win=new BrowserWindow({show:false,width:1200,height:850,webPreferences:{offscreen:true,backgroundThrottling:false}});
 win.webContents.on("console-message",(_e,level,message)=>{if(level>=2)console.log(message)});
 const js=async s=>{try{return await win.webContents.executeJavaScript(s,true)}catch(e){console.error("FAILED",s);throw e}}, pause=ms=>new Promise(r=>setTimeout(r,ms));
 const settle=async()=>{await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')};
 const click=async selector=>{await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await settle()};
 await win.loadURL('http://127.0.0.1:5198/@fs/'+fixture.replaceAll('\\','/'));
 for(let i=0;i<100&&!await js('Boolean(window.ready)');i++)await pause(100);
 assert.equal(await js('Boolean(window.ready)'),true);
 await js(`for(const state of ['white','clear']){const e=document.createElement('button');e.className='qa-cascade '+state;document.body.append(e)}`);
 const foreground=await js(`[...document.querySelectorAll('.qa-label,.composer')].map(e=>getComputedStyle(e).color)`);
 await click('[data-settings-theme="custom"]');
 assert.equal(await js('document.querySelectorAll("[data-color-presets] button").length'),79);
 assert.equal(await js(`document.querySelector('[data-color-swatch="#ffffff"]') !== null`),false);
 const pickerSnapshot=()=>js(`['.haolo-color-picker','[data-color-percent]','.haolo-color-opacity > label','[data-color-hex]','[data-color-save]'].map(s=>{const c=getComputedStyle(document.querySelector(s));return [c.backgroundColor,c.borderColor,c.color,c.boxShadow]})`);
 const pickerBefore=await pickerSnapshot();
 await click('[data-color-swatch="#12349e"]');
 await js(`document.querySelector('[data-color-percent]').value='60';document.querySelector('[data-color-percent]').dispatchEvent(new Event('input',{bubbles:true}))`);await settle();
 assert.deepEqual(await pickerSnapshot(),pickerBefore);
 assert.equal(await js('getComputedStyle(document.querySelector("#qa-white")).backgroundColor'),'rgb(255, 255, 255)');
 assert.equal(await js('getComputedStyle(document.querySelector("#qa-white-alpha")).backgroundColor'),'rgba(255, 255, 255, 0.4)');
 assert.equal(await js('getComputedStyle(document.querySelector(".qa-cascade.white")).backgroundColor'),'rgb(255, 255, 255)');
 assert.equal(await js('getComputedStyle(document.querySelector(".qa-cascade.clear")).backgroundColor'),'rgba(0, 0, 0, 0)');
 assert.equal(await js('getComputedStyle(document.querySelector("#qa-colored")).backgroundColor'),'rgb(255, 152, 0)');
 assert.notEqual(await js('getComputedStyle(document.querySelector("#qa-control")).backgroundColor'),'rgb(255, 152, 0)');
 assert.equal(await js('sharedThemePreference'),'custom:#12349e:60');
 assert.equal(await js('edits.at(-1)["app.theme"]'),'custom:#12349e:60');
 await js('closeColorPicker()');await settle();
 assert.deepEqual(await js(`[...document.querySelectorAll('.qa-label,.composer')].map(e=>getComputedStyle(e).color)`),foreground);
 assert.match(await js('getComputedStyle(document.querySelector(".qa-gradient")).backgroundImage'),/rgba/);
 assert.equal(await js('getComputedStyle(document.querySelector(".composer")).backgroundColor'),await js('mapSurfaceColor("#f5f5f5",customThemeSelection)'));
 // New pages and JS-driven inline surfaces are mapped without changing foregrounds.
 await js(`const dynamic=document.createElement('div');dynamic.id='dynamic';dynamic.style.cssText='background:#b3b3b3;color:#13579b';document.body.append(dynamic)`);await settle();
 assert.equal(await js('getComputedStyle(dynamic).color'),'rgb(19, 87, 155)');
 assert.equal(await js('dynamic.style.backgroundColor'),await js('mapSurfaceColor("#b3b3b3",customThemeSelection)'));
 await js(`dynamic.style.setProperty('--qa-fill','#000');dynamic.innerHTML='<div id="transparent-child" style="--qa-fill:transparent;background:var(--qa-fill)">Transparent child</div>'`);await settle();
 assert.equal(await js('getComputedStyle(document.querySelector("#transparent-child")).backgroundColor'),'rgba(0, 0, 0, 0)');
 await js(`dynamic.style.animation='qa-paint 1s -1s forwards paused'`);await settle();
 assert.equal(await js('getComputedStyle(dynamic).backgroundColor'),await js('mapSurfaceColor("#000",customThemeSelection)'));
 assert.equal(await js('getComputedStyle(dynamic).transform'),'matrix(1, 0, 0, 1, 10, 0)');
 assert.equal(await js('getComputedStyle(dynamic).color'),'rgb(19, 87, 155)');
 await js(`dynamic.style.animation='none'`);
 for(const language of ['zh-CN','en','zh-TW','ko']){
  await js(`lang.applyAppLanguage('${language}',{root:document.body})`);await settle();
  const box=await js(`(()=>{const e=document.querySelector('.settings-theme-options'),r=e.getBoundingClientRect();return {width:r.width,overflow:e.scrollWidth>e.clientWidth+1}})()`);assert.equal(box.overflow,false);
  assert.equal(await js(`(()=>{const row=document.querySelector('.settings-theme-row');return row.scrollWidth<=row.clientWidth+1})()`),true,language+' actual settings column overflow');
  fs.writeFileSync(path.join(output,language+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 await js('applyCustomTheme(null)');await settle();assert.equal(await js('dynamic.style.backgroundColor'),'rgb(179, 179, 179)');
 for(const opacity of [0,25,100]){await js(`applyCustomTheme({color:'#a12345',opacity:${opacity}})`);await settle()}
 await js('applyCustomTheme(null)');
 await js("document.documentElement.dataset.theme='dark';state.settings.theme='dark'");
 await click('[data-settings-theme="custom"]');
 const darkPicker=await pickerSnapshot();
 await click('[data-color-swatch="#2962ff"]');
 await js(`document.querySelector('[data-color-percent]').value='0';document.querySelector('[data-color-percent]').dispatchEvent(new Event('input',{bubbles:true}))`);await settle();
 assert.deepEqual(await pickerSnapshot(),darkPicker);
 assert.equal(await js('getComputedStyle(document.querySelector("#qa-white")).backgroundColor'),'rgb(255, 255, 255)');
 await js('closeColorPicker();applyCustomTheme(null)');
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({pass:true,locales:4,opacity:[0,25,60,100],foregroundUnchanged:true,gradients:true,dynamicSurfaces:true,restore:true}));
 await win.loadURL('http://127.0.0.1:5198/@fs/'+path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/'));
 for(let i=0;i<120&&!await js('Boolean(window.ready)');i++)await pause(100);
 assert.equal(await js('Boolean(window.ready)'),true);
 const chartBefore=await js('workspace.chart.options().layout');
 const candlesBefore=await js('workspace.candleSeries.options().upColor');
 await js("(async()=>{window.custom=await import('/custom-theme.ts');custom.applyCustomTheme({color:'#12349e',opacity:60})})()");await settle();
 assert.equal(await js('workspace.chart.options().layout.textColor'),chartBefore.textColor);
 assert.equal(await js('workspace.candleSeries.options().upColor'),candlesBefore);
 assert.equal(await js('workspace.chart.options().layout.background.color'),await js("custom.mapSurfaceColor(workspace.chartSettings.themes.light.backgroundColor,{color:'#12349e',opacity:60})"));
 fs.writeFileSync(path.join(output,'chart-custom.png'),(await win.webContents.capturePage()).toPNG());
 await js('custom.applyCustomTheme(null)');await settle();assert.deepEqual(await js('workspace.chart.options().layout.background'),chartBefore.background);
 console.log('PASS custom theme: production settings picker, atomic selection, opacity, CSS/inline surfaces, gradients, unchanged text, four locales and restoration');app.exit(0);
})().catch(e=>{console.error(e);app.exit(1)});
