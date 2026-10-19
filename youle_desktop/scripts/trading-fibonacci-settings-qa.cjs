// Synthetic chart, isolated profile and real Electron mouse/keyboard input.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/fibonacci-settings-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, `profile-${process.pid}`)); app.disableHardwareAcceleration();
const pause = ms => new Promise(r => setTimeout(r, ms));
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1440, height: 1080, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = async code => { try { return await win.webContents.executeJavaScript(code, true); } catch (error) { console.error('Failed script:', code); console.error(await win.webContents.executeJavaScript('String(window.qaError??"")')); throw error; } };
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(50); };
  const capture = async name => fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const click = async selector => {
    const p = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...p });
    win.webContents.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', ...p, button: 'left', clickCount: 1 }); await settle();
  };
  const key = async keyCode => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); await settle(); };
  const input = async (name, value) => { await js(`(()=>{const e=document.querySelector('.trading-fib-dialog [name="${name}"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`); await settle(); };
  const load = async () => {
    await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5198}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
    for (let i=0;i<120&&!await js('Boolean(window.ready)');i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'),true,await js('String(window.qaError)'));
    await js(`(async()=>{window.d=workspace.drawingController;workspace.loadingHistory=true;document.querySelector('#host').style.cssText='width:100%;height:100%';window.lang=await import('/app-language.mjs');lang.observeAppLanguage(document.body);})()`); await settle();
  };
  const open = async () => { await js(`d.selectDrawing('fib-qa');d.redraw()`); await settle(); await click('[data-horizontal-line-settings]'); assert.equal(await js(`!!document.querySelector('.trading-fib-dialog[open]')`),true); };
  const cancel = () => click('.trading-fib-dialog footer [data-line-cancel]');
  const confirm = () => click('.trading-fib-dialog [type="submit"]');
  const bounds = () => js(`(()=>{const es=[...document.querySelectorAll('.trading-fib-dialog,.fib-popup,.haolo-color-picker')];return es.every(e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&e.scrollWidth<=e.clientWidth+1;})})()`);
  await load();
  await js(`d.drawings=[{id:'fib-qa',tool:'fib-retracement',symbol:d.getSymbol(),interval:d.getInterval(),points:[{time:workspace.candles.at(-100).time+.375,price:1340},{time:workspace.candles.at(-35).time+.625,price:1290}]}];d.selectTool('crosshair');d.persistDrawings();d.redraw();window.original=JSON.stringify(d.drawings[0]);`);
  const original = await js('JSON.stringify(d.drawings[0])');
  await open();
  assert.equal(await js(`document.querySelectorAll('.fib-level').length`),22);
  assert.equal(await js(`document.querySelectorAll('.fib-level input[type="checkbox"]:checked').length`),11);
  assert.equal(await js(`document.querySelector('[name="level11"]').disabled`),true);
  await capture('light-style');
  // Persistent multi-select extension menu and its Escape hierarchy.
  await click('[data-fib-menu="extension"]'); await click('[data-fib-extension="extendLeft"]'); await click('[data-fib-extension="extendRight"]');
  assert.equal(await js(`document.querySelectorAll('.fib-popup [aria-checked="true"]').length`),2);
  assert.equal(await js(`d.content.querySelector('.trading-fibonacci-level-line').getAttribute('x1')`),'0');
  assert.equal(await js('JSON.stringify(d.drawings[0])'),original,'preview must not mutate saved model');
  await capture('extension'); await key('Escape');
  assert.equal(await js(`!document.querySelector('.fib-popup')&&d.horizontalLineSettings.open`),true);
  // Width and style menus render actual strokes and close on selection.
  await click('[data-fib-menu="width"]'); await capture('width'); await click('[data-fib-width="4"]');
  await click('[data-fib-menu="style"]'); await capture('line-style'); await click('[data-fib-style="dotted"]');
  assert.equal(await js(`d.content.querySelector('.trading-fibonacci-level-line').getAttribute('stroke-width')`),'4');
  assert.equal(await js(`d.content.querySelector('.trading-fibonacci-level-line').getAttribute('stroke-dasharray')`),'2 4');
  // Independent trend color, width, dash style and opacity inside one panel.
  await click('[data-fib-trend]'); await capture('trend-picker');
  await click('[data-color-swatch="#9c27b0"]'); await click('[data-color-line-width="3"]'); await click('[data-color-line-style="solid"]');
  await js(`(()=>{const p=document.querySelector('[data-color-percent]');p.value='55';p.dispatchEvent(new Event('input',{bubbles:true}));})()`); await settle();
  assert.equal(await js(`d.content.querySelector('.trading-fibonacci-connector').getAttribute('stroke')`),'#9c27b08c');
  assert.equal(await js(`d.content.querySelector('.trading-fibonacci-connector').getAttribute('stroke-width')`),'3');
  await key('Escape'); assert.equal(await js('d.horizontalLineSettings.open'),true);
  // Enable a previously disabled slot, edit its ratio and color (including alpha).
  await click('[name="enabled11"]'); await input('level11','1.5');
  await click('[name="color11"]'); await capture('level-picker'); await click('[data-color-swatch="#00bcd4"]');
  await js(`(()=>{const p=document.querySelector('[data-color-percent]');p.value='40';p.dispatchEvent(new Event('input',{bubbles:true}));})()`); await settle();
  assert.equal(await js(`d.content.querySelector('[data-fibonacci-level="1.5"] line').getAttribute('stroke')`),'#00bcd466');
  await key('Escape');
  // Cancel rolls back everything; reopening retains fractional anchor times.
  await cancel(); assert.equal(await js('JSON.stringify(d.drawings[0])'),original);
  assert.equal(await js(`d.content.querySelector('.trading-fibonacci-level-line').getAttribute('stroke-width')`),'2');
  await open(); await click('[name="enabled1"]'); await click('[data-fib-menu="width"]'); await key('End');
  await key('Enter');
  await click('[data-fib-trend]'); await click('[data-color-line-style="dotted"]'); await key('Escape');
  await click('[data-fib-menu="extension"]'); await click('[data-fib-extension="extendRight"]'); await key('Escape');
  await click('[data-line-tab="coordinates"]'); await input('price0','1345'); await capture('coordinates');
  await click('[data-line-tab="style"]'); await confirm();
  const committed = await js('JSON.stringify(d.drawings[0])');
  assert.equal(await js('d.drawings[0].fibonacci.lineWidth'),4); assert.equal(await js('d.drawings[0].fibonacci.levels[1].enabled'),false);
  assert.equal(await js('d.drawings[0].points[0].time%1'),.375); assert.equal(await js('d.drawings[0].points[1].time%1'),.625);
  await load(); assert.equal(await js('JSON.stringify(d.drawings[0].fibonacci)'),JSON.stringify(JSON.parse(committed).fibonacci));
  assert.equal(await js('d.drawings[0].points[0].price'),1345);
  // Template save/apply/reset uses the same draft and can still be canceled.
  await open(); await click('[data-fib-menu="template"]');
  await js(`document.querySelector('.fib-template-save input').value='测试模板';`); await click('[data-fib-save]');
  await click('[data-fib-menu="template"]'); await click('[data-fib-default]');
  assert.equal(await js(`d.content.querySelector('.trading-fibonacci-level-line').getAttribute('stroke-width')`),'2');
  await click('[data-fib-menu="template"]'); await click('[data-fib-template="0"]');
  assert.equal(await js(`d.content.querySelector('.trading-fibonacci-level-line').getAttribute('stroke-width')`),'4');
  await cancel();
  // Invalid inputs on a hidden panel take the user to that input.
  await open(); await click('[data-line-tab="coordinates"]'); await input('price0',''); await click('[data-line-tab="style"]'); await confirm();
  assert.equal(await js(`document.querySelector('[data-line-tab="coordinates"]').getAttribute('aria-selected')`),'true');
  await input('price0','1345'); await click('[data-line-tab="visibility"]'); await capture('visibility');
  await input('min-hours','5'); await input('max-hours','2'); await confirm(); assert.equal(await js('d.horizontalLineSettings.open'),true);
  await cancel();
  // Disabling the current period hides the SVG preview, but saving never deletes data.
  await open(); await click('[data-line-tab="visibility"]'); await click('[name="visible-hours"]');
  assert.equal(await js(`d.content.querySelectorAll('.trading-fibonacci-level-line').length`),0); await cancel();
  assert.ok(await js(`d.content.querySelectorAll('.trading-fibonacci-level-line').length`)>0);
  await open(); await click('[data-line-tab="visibility"]'); await click('[name="visible-hours"]'); await confirm();
  assert.equal(await js(`d.content.querySelectorAll('.trading-fibonacci-level-line').length`),0);
  assert.equal(await js(`d.drawings.length`),1);
  await open(); await click('[data-line-tab="visibility"]'); await click('[name="visible-hours"]'); await confirm();
  assert.ok(await js(`d.content.querySelectorAll('.trading-fibonacci-level-line').length`)>0);
  // Name is user text; scene changes roll preview back and dispose floating UI.
  await open(); await click('[data-fib-rename]'); await input('drawingName','趋势线'); await key('Enter'); await confirm();
  await open(); await click('[name="trendVisible"]'); await click('[name="color0"]');
  await js(`d.horizontalLineSettings.close()`); await settle();
  assert.equal(await js(`document.querySelectorAll('.trading-fib-dialog,.haolo-color-picker,.fib-popup').length`),0);
  assert.ok(await js(`!!d.content.querySelector('.trading-fibonacci-connector')`));
  // Light/dark + English, with keyboard navigation and bounded small-window panels.
  await js(`document.documentElement.dataset.theme='dark';workspace.applyChartTheme();lang.applyAppLanguage('en',{root:document.body});`); await settle();
  await open(); await capture('dark-english'); assert.equal(await bounds(),true);
  assert.equal(await js(`document.querySelector('.trading-fib-dialog h2').textContent`),'趋势线');
  await click('[data-fib-trend]'); await capture('dark-trend-picker'); assert.equal(await bounds(),true); await key('Escape');
  const untranslated = await js(`(()=>{const root=document.querySelector('.trading-fib-dialog');const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n,found=[];while(n=walk.nextNode())if(/\\p{Script=Han}/u.test(n.textContent)&&!n.parentElement.closest('[data-i18n-skip]'))found.push(n.textContent);return found;})()`);
  assert.deepEqual(untranslated,[]);
  await cancel(); win.setContentSize(430,640); await settle(); await open(); assert.equal(await bounds(),true); await capture('small-window');
  await click('[name="enabled21"]'); await click('[name="color21"]'); assert.equal(await bounds(),true); await capture('small-picker'); await key('Escape');
  await key('Escape'); assert.equal(await js('d.horizontalLineSettings.open'),false);
  assert.equal(await js('String(window.qaError??"")'),'');
  const report={result:'PASS',levels:22,realMouseMenus:true,keyboard:true,previewCancel:true,persistence:true,templates:true,coordinates:true,visibility:true,themes:['light','dark'],smallWindow:true};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
  win.destroy(); app.quit();
})().catch(async error=>{console.error(error);if(win&&!win.isDestroyed())fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());win?.destroy();app.exit(1);});
