// Native pointer input against an isolated renderer with synthetic market data.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'horizontal-line-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1304, height: 880, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => { await js('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))'); await pause(50); };
  const capture = async name => fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const click = async (selector, count = 1, horizontalFraction = 0.5) => {
    const p = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing target');const b=e.getBoundingClientRect();return {x:Math.round(b.x+b.width*${horizontalFraction}),y:Math.round(b.y+b.height/2)}})()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...p });
    win.webContents.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: count });
    win.webContents.sendInputEvent({ type: 'mouseUp', ...p, button: 'left', clickCount: count });
    await settle();
  };
  const load = async () => {
    await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5194}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
    for (let i = 0; i < 120 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
    await js(`(async()=>{document.querySelector('#host').style.cssText='width:100%;height:100%';window.d=workspace.drawingController;workspace.loadingHistory=true;window.lang=await import('/app-language.mjs');lang.observeAppLanguage(document.body)})()`);
    await settle();
  };
  await load();
  await js(`d.drawings=[{id:'horizontal-qa',tool:'horizontal-line',symbol:d.getSymbol(),interval:d.getInterval(),points:[{time:workspace.candles.at(-50).time,price:1330}]}];d.selectTool('crosshair');d.selectDrawing('horizontal-qa')`);
  await settle();
  // Both input routes must open the same real modal, including after SVG redraws.
  await click('[data-horizontal-line-settings]');
  assert.equal(await js('d.horizontalLineSettings.open'), true);
  await capture('style-light');
  await click('[data-line-tab="text"]');
  await js(`(()=>{const f=document.querySelector('.trading-horizontal-line-dialog form');f.elements.text.value='支撑位 Support';f.elements.textColor.value='#ef5350';f.elements.fontSize.value='24';f.elements.textAlign.value='right';f.elements.textVerticalAlign.value='middle'})()`);
  await click('[data-line-toggle="bold"]');
  await click('[data-line-toggle="italic"]');
  await capture('text-light');
  await click('[data-line-tab="coordinates"]');
  await js(`document.querySelector('[name="price"]').value='1335.25'`);
  await capture('coordinates-light');
  await click('.trading-horizontal-line-dialog [type="submit"]');
  assert.equal(await js('d.drawings[0].points[0].price'), 1335.25);
  assert.equal(await js('d.drawings[0].textAlign'), 'right');
  assert.equal(await js(`d.content.querySelector('.trading-horizontal-line-text').getAttribute('fill')`), '#ef5350');
  await capture('line-right');
  await click('[data-drawing-id="horizontal-qa"] .trading-drawing-hit-target:not(.area)', 2, 0.2);
  assert.equal(await js('d.horizontalLineSettings.open'), true, 'double click on line opens settings');
  const before = await js('JSON.stringify(d.drawings[0])');
  await js(`document.querySelector('[name="text"]').value='discard me';document.querySelector('[name="price"]').value='999'`);
  await click('.trading-horizontal-line-dialog footer [data-line-cancel]');
  assert.equal(await js('JSON.stringify(d.drawings[0])'), before, 'Cancel preserves every field');
  await click('.trading-horizontal-line-text + .trading-drawing-hit-target', 2);
  assert.equal(await js('d.horizontalLineSettings.open'), true, 'double click on label opens settings');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await settle();
  assert.equal(await js('d.horizontalLineSettings.open'), false);
  assert.equal(await js('JSON.stringify(d.drawings[0])'), before, 'Escape preserves every field');
  // Alignment, label visibility and persistence are verified through the form.
  for (const alignment of ['left', 'center', 'right']) {
    await click('[data-horizontal-line-settings]');
    await click('[data-line-tab="text"]');
    await js(`document.querySelector('[name="textAlign"]').value='${alignment}'`);
    await click('.trading-horizontal-line-dialog [type="submit"]');
    assert.equal(await js(`d.content.querySelector('.trading-horizontal-line-text').getAttribute('text-anchor')`), { left: 'start', center: 'middle', right: 'end' }[alignment]);
  }
  await click('[data-horizontal-line-settings]');
  await click('[name="showPriceLabel"]');
  await click('.trading-horizontal-line-dialog [type="submit"]');
  assert.equal(await js('d.axisMarkerLayer.children.length'), 0);
  await load();
  assert.equal(await js('d.drawings[0].text'), '支撑位 Support');
  assert.equal(await js('d.drawings[0].showPriceLabel'), false);
  assert.equal(await js('d.drawings[0].textColor'), '#ef5350');
  assert.equal(await js('d.drawings[0].italic'), true);
  assert.equal(await js('d.drawings[0].fontSize'), 24);
  await js(`d.selectDrawing(null)`); await settle();
  const paneHeights = await js('d.getChart().panes().map(p=>p.getHeight())');
  await click('[data-drawing-id="horizontal-qa"] .trading-drawing-hit-target:not(.area)', 1, 0.2);
  await click('[data-drawing-id="horizontal-qa"] .trading-drawing-hit-target:not(.area)', 2, 0.2);
  assert.equal(await js('d.horizontalLineSettings.open'), true, 'unselected line also opens with two clicks');
  assert.deepEqual(await js('d.getChart().panes().map(p=>p.getHeight())'), paneHeights, 'editing does not maximize chart panes');
  await click('.trading-horizontal-line-dialog footer [data-line-cancel]');
  for (const language of ['zh-CN', 'en', 'zh-TW']) {
    for (const theme of ['light', 'dark']) {
      await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();lang.applyAppLanguage('${language}',{root:document.body})`);
      await click('[data-horizontal-line-settings]');
      await click('[data-line-tab="text"]');
      const state = await js(`(()=>{const e=document.querySelector('.trading-horizontal-line-dialog');return {background:getComputedStyle(e).backgroundColor,fields:[...e.querySelectorAll('input,textarea,select')].map(f=>({background:getComputedStyle(f).backgroundColor,color:getComputedStyle(f).color})),text:e.innerText,width:e.scrollWidth,clientWidth:e.clientWidth,value:e.querySelector('textarea').value}})()`);
      assert.equal(state.width, state.clientWidth, 'dialog has no horizontal overflow');
      assert.equal(state.value, '支撑位 Support', 'authored text is never translated');
      if (language === 'en') assert.doesNotMatch(state.text, /[\u4e00-\u9fff]/);
      if (theme === 'dark') {
        assert.notEqual(state.background, 'rgb(255, 255, 255)');
        for (const field of state.fields) {
          assert.ok(Number(field.background.match(/\d+/)[0]) < 100, 'dark fields must have a dark background');
          assert.ok(Number(field.color.match(/\d+/)[0]) > 150, 'dark fields must have readable text');
        }
      }
      await capture(`text-${language}-${theme}`);
      await click('.trading-horizontal-line-dialog footer [data-line-cancel]');
    }
  }
  // Empty labels are valid, invalid prices are not, other tools keep their toolbar.
  await click('[data-horizontal-line-settings]');
  await js(`document.querySelector('[name="price"]').value='';document.querySelector('.trading-horizontal-line-dialog form').requestSubmit()`);
  assert.equal(await js('d.horizontalLineSettings.open'), true);
  await js(`document.querySelector('[name="price"]').value='1335.25';document.querySelector('[name="text"]').value='';document.querySelector('.trading-horizontal-line-dialog form').requestSubmit()`);
  await settle();
  assert.equal(await js(`Boolean(d.content.querySelector('.trading-horizontal-line-text'))`), false);
  await js(`d.drawings[0].tool='trend-line';d.drawings[0].points.push({...d.drawings[0].points[0],time:d.drawings[0].points[0].time+3600});d.redraw()`); await settle();
  assert.equal(await js(`d.selectionToolbar.querySelector('[data-horizontal-line-settings]').hidden`), true);
  assert.equal(await js('String(window.qaError || "")'), '');
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ result: 'PASS', routes: ['toolbar', 'line double click', 'label double click'], locales: ['zh-CN','en','zh-TW'], themes: ['light','dark'], persistence: true, cancelAndEscape: true, alignment: ['left','center','right'] }, null, 2));
  console.log('PASS: horizontal line settings, native double click, label editing, alignment, cancel/Escape, reload, three locales and two themes');
  win.destroy(); app.quit();
})().catch(error => { console.error(error); fs.writeFileSync(path.join(output, 'failure.txt'), String(error.stack)); win?.destroy(); app.exit(1); });
