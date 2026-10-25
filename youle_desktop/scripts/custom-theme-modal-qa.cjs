const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/custom-theme-modal-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile')); app.disableHardwareAcceleration();
const main = fs.readFileSync(path.join(root, 'src/renderer/main.ts'), 'utf8');
const backdrop = main.match(/<div class="modal-backdrop settings-backdrop"[^>]*><\/div>/)[0];
const fixture = path.join(output, 'modal.html');
fs.writeFileSync(fixture, `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"><style>
body{margin:0;background:#fff}#stage{position:fixed;inset:0;background:#fff}#data-color{position:absolute;left:32px;top:200px;width:60px;height:60px;background:#f23645}
#settings{padding:30px}.qa-control{background:#222;color:#fff}.qa-native::backdrop,.qa-neutral{background:rgba(0,0,0,.48)}
</style></head><body><main id="stage"><div id="data-color"></div><p style="color:#123456">Chart text</p></main>${backdrop}
<dialog id="settings" class="settings-dialog" open><h2>通用设置</h2><button id="custom" class="qa-control">自定义</button><input id="white-field" style="background:#fff"><div class="qa-neutral">Gray control area</div></dialog>
<script type="module">Object.assign(window,await import('/custom-theme.ts'),await import('/color-picker.ts'));window.ready=true;</script></body></html>`);
(async()=>{
 await app.whenReady();const win=new BrowserWindow({show:false,width:1200,height:850,webPreferences:{offscreen:true,backgroundThrottling:false}});
 const js=s=>win.webContents.executeJavaScript(s,true),settle=()=>js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 await win.loadURL('http://127.0.0.1:5198/@fs/'+fixture.replaceAll('\\','/'));
 for(let i=0;i<100&&!await js('Boolean(window.ready)');i++)await new Promise(r=>setTimeout(r,100));
 assert.equal(await js('Boolean(window.ready)'),true);
 const paint=s=>js(`(()=>{const c=getComputedStyle(document.querySelector(${JSON.stringify(s)}));return [c.backgroundColor,c.backgroundImage,c.boxShadow,c.color]})()`);
 const pixel=async(x,y)=>Array.from((await win.webContents.capturePage({x,y,width:1,height:1})).toBitmap());
 const originalBarrier=await paint('.settings-backdrop'),whitePixel=await pixel(40,100),dataPixel=await pixel(40,220);
 await js(`openColorPicker({anchor:document.querySelector('#custom'),value:'#2962fff2',excludeWhite:true,onChange:()=>{}})`);await settle();
 const picker=await paint('.haolo-color-picker');
 for(const color of ['#2962ff','#cf1925','#12349e'])for(const opacity of [95,0,30,100]){
  await js(`applyCustomTheme({color:'${color}',opacity:${opacity}})`);await settle();
  assert.deepEqual(await paint('.settings-backdrop'),originalBarrier,'Settings backdrop must retain its original neutral paint and alpha');
  assert.deepEqual(await pixel(40,100),whitePixel,'White page pixels under the modal must not acquire a hue');
  assert.deepEqual(await pixel(40,220),dataPixel,'Market data pixels under the modal must not acquire a hue');
  assert.deepEqual(await paint('.haolo-color-picker'),picker,'Picker chrome must remain unchanged');
  assert.equal((await paint('#white-field'))[0],'rgb(255, 255, 255)');
 }
 fs.writeFileSync(path.join(output,'settings-fixed.png'),(await win.webContents.capturePage()).toPNG());
 await js(`closeColorPicker();document.querySelector('#settings').remove();document.querySelector('.settings-backdrop').remove();applyCustomTheme(null)`);await settle();
 assert.ok((await pixel(40,100)).every(channel=>channel===255));
 // All existing named barriers, including newly inserted inline ones, preserve paint.
 const classes=[...new Set([...fs.readFileSync(path.join(root,'src/renderer/styles.css'),'utf8').matchAll(/\.([\w-]*(?:backdrop|scrim)|[\w-]+-(?:overlay|mask))\b/g)].map(m=>m[1]))];
 await js(`window.barriers=${JSON.stringify(classes)}.map(name=>{const e=document.createElement('div');e.className=name;e.style.cssText='position:static;display:block;background:rgba(0,0,0,.42)';e.innerHTML='<button style="background:#222;color:#fff">Control</button>';document.body.append(e);return e});window.before=barriers.map(e=>getComputedStyle(e).backgroundColor);applyCustomTheme({color:'#2962ff',opacity:95})`);await settle();
 assert.deepEqual(await js('barriers.map(e=>getComputedStyle(e).backgroundColor)'),await js('before'));
 assert.equal(await js(`barriers.every(e=>getComputedStyle(e.firstElementChild).backgroundColor===mapSurfaceColor('#222',{color:'#2962ff',opacity:95}))`),true,'Dialog controls inside a backdrop still follow the theme');
 await js(`const e=document.createElement('div');e.dataset.themeBackdrop='';e.style.background='rgba(0,0,0,.4)';document.body.append(e);window.explicitBarrier=e`);await settle();
 assert.equal(await js('explicitBarrier.style.backgroundColor'),'rgba(0, 0, 0, 0.4)');
 await js(`window.reused=document.createElement('div');reused.style.background='rgba(0,0,0,.3)';document.body.append(reused)`);await settle();
 assert.notEqual(await js('reused.style.backgroundColor'),'rgba(0, 0, 0, 0.3)');
 await js(`reused.className='reused-backdrop'`);await settle();
 assert.equal(await js('reused.style.backgroundColor'),'rgba(0, 0, 0, 0.3)');
 await js('reused.remove()');
 await js('barriers.forEach(e=>e.remove());explicitBarrier.remove();applyCustomTheme(null)');
 // Browser-managed modal backdrops use the same exclusion, including mixed selectors.
 await js(`window.native=document.createElement('dialog');native.className='qa-native';native.innerHTML='<button class="qa-control">Control</button>';document.body.append(native);native.showModal()`);await settle();
 const nativePaint=await js(`getComputedStyle(native,'::backdrop').backgroundColor`),nativePixel=await pixel(40,100);
 for(const opacity of [0,95,100]){
  await js(`applyCustomTheme({color:'#2962ff',opacity:${opacity}})`);await settle();
  assert.equal(await js(`getComputedStyle(native,'::backdrop').backgroundColor`),nativePaint);
  assert.deepEqual(await pixel(40,100),nativePixel);
 }
 await js('native.close();native.remove();applyCustomTheme(null)');await settle();
 assert.ok((await pixel(40,100)).every(channel=>channel===255));
 // The exact native price-alert dialog reported by the user, plus drawing dialogs.
 for(const className of ['trading-price-alert-dialog','trading-horizontal-line-dialog','trading-drawing-clear-dialog']){
  await js(`native.className='${className}';document.body.append(native);native.showModal()`);await settle();
  const original=await js(`getComputedStyle(native,'::backdrop').backgroundColor`);
  const beforePixel=await pixel(40,100);
  await js(`applyCustomTheme({color:'#4caf50',opacity:95})`);await settle();
  assert.equal(await js(`getComputedStyle(native,'::backdrop').backgroundColor`),original,className);
  assert.deepEqual(await pixel(40,100),beforePixel,className+' must not tint the chart');
  await js('native.close();native.remove();applyCustomTheme(null)');await settle();
 }
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({pass:true,colors:3,opacities:[0,30,95,100],namedBarriers:classes.length,settingsBackdrop:true,nativeBackdrop:true,whiteAndMarketPixelsUnchanged:true,nestedControls:true}));
 console.log('PASS modal backdrop and screen pixels, '+classes.length+' named barriers, native dialogs, nested controls, picker and restoration');app.exit(0);
})().catch(e=>{console.error(e);app.exit(1)});
