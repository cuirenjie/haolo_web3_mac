const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/measurement-reference-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile')); app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1200, height: 1100, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => { await js('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))'); await pause(50); };
  const input = async (type, point, extra = {}) => { win.webContents.sendInputEvent({ type, x: Math.round(point.x), y: Math.round(point.y), ...extra }); await settle(); };
  const click = async point => { await input('mouseMove', point); await input('mouseDown', point, { button: 'left', clickCount: 1 }); await input('mouseUp', point, { button: 'left', clickCount: 1 }); };
  const capture = async name => fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const fixture = 'trading-chart-navigation.html';
  await win.loadURL(`http://127.0.0.1:5196/@fs/${path.join(root, 'test/fixtures', fixture).replaceAll('\\', '/')}`);
  for (let i = 0; i < 150 && !await js('!!window.ready'); i++) await pause(100);
  assert.ok(await js('!!window.ready'), await js('String(window.qaError)'));
  await js(`window.d = workspace.drawingController; window.n = workspace.chartNavigation;
    workspace.loadingHistory = true; document.querySelector('#host').style.cssText = 'width:100%;height:100%';
    d.selectTool('crosshair'); d.drawings = []; d.redraw();
    workspace.chart.timeScale().setVisibleLogicalRange({from:390,to:510});`);
  // Retrieve the same navigation instance used by the drawing toolbar.
  await js('window.n = d.getNavigation(); void 0'); await settle();
  const pane = await js(`(() => { const p = workspace.chart.panes()[0], r = p.getHTMLElement().getBoundingClientRect();
    return {left:r.left,top:r.top,right:r.right-workspace.chart.priceScale('right',0).width(),bottom:r.bottom}; })()`);
  const point = (x, y) => ({ x: pane.left + x, y: pane.top + y });
  const state = () => js(`(() => { const e = document.querySelector('.trading-chart-measurement'), l = e?.querySelector('.trading-chart-measurement-label');
    if (!e) return null;
    const s = getComputedStyle(e), c = getComputedStyle(l), r = e.getBoundingClientRect(), b = l.getBoundingClientRect();
    return {text:l.textContent,classes:e.className,fill:s.backgroundColor,border:s.borderWidth,color:c.backgroundColor,textColor:c.color,font:c.fontSize,weight:c.fontWeight,lineHeight:c.lineHeight,radius:c.borderRadius,arrows:e.querySelectorAll('span').length,
      rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height},card:{left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height}};
  })()`);
  const reports = [];
  for (const theme of ['light', 'dark']) {
    await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();`); await settle();
    for (const direction of ['up', 'down', 'reverse']) {
      const a = point(direction === 'reverse' ? 730 : 260, direction === 'down' ? 150 : 300);
      const b = point(direction === 'reverse' ? 260 : 730, direction === 'down' ? 300 : 150);
      await js('n.cancelGesture()');
      if (direction !== 'reverse') {
        // Exercise the actual ruler toolbar control and its two-click preview.
        const button = await js(`(() => {const r=d.toolbar.querySelector('[data-drawing-action="measure"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        await click(button); await click(a); await input('mouseMove', b);
        assert.ok(await js('n.selection?.awaitingClick'));
        await capture(`${theme}-${direction}-preview`); await click(b);
      } else {
        await input('mouseMove', a); await input('mouseDown', a, { button:'left',clickCount:1,modifiers:['shift'] });
        await input('mouseMove', b, { button:'left',modifiers:['leftButtonDown','shift'] });
        await input('mouseUp', b, { button:'left',clickCount:1 });
      }
      const s = await state(); assert.ok(s, `${theme}/${direction}: missing measurement`);
      assert.equal(s.color, direction === 'down' ? 'rgb(247, 82, 95)' : 'rgb(41, 98, 255)');
      assert.equal(s.textColor, 'rgb(255, 255, 255)'); assert.equal(s.border, '0px');
      assert.equal(s.arrows, 2); assert.equal(s.card.height, 105); assert.equal(s.font, '18px'); assert.equal(s.lineHeight, '30px');
      assert.equal(s.text.split('\n').length, 3); assert.match(s.text, /根K线, /); assert.match(s.text, /成交量 /);
      assert.ok(Math.abs((s.card.left+s.card.right)/2 - (s.rect.left+s.rect.right)/2) < 1);
      if (direction === 'down') { assert.ok(s.classes.includes('downward')); assert.ok(Math.abs(s.card.top - s.rect.bottom - 15) < 1, JSON.stringify({pane,s})); }
      else assert.ok(Math.abs(s.rect.top - s.card.bottom - 15) < 1);
      if (direction === 'reverse') assert.ok(s.classes.includes('backwards'));
      assert.equal(await js('n.getTool()'), null); await capture(`${theme}-${direction}`); reports.push({theme,direction,...s});
    }
  }
  // The card remains readable at each pane boundary and with no reported volume.
  await js(`n.options.getCandles = () => workspace.candles.map(c => ({...c, volume:0})); void 0`);
  for (const [a,b] of [[point(8,130),point(12,2)],[point(8,130),point(12,pane.bottom-pane.top-2)],
    [{x:pane.right-8,y:pane.top+130},{x:pane.right-2,y:pane.top+2}]]) {
    await js('n.setTool("measure")'); await click(a); await input('mouseMove', b); await click(b);
    const s = await state(); assert.ok(s.card.left >= pane.left && s.card.right <= pane.right && s.card.top >= pane.top && s.card.bottom <= pane.bottom);
    assert.match(s.text, /成交量 0$/); reports.push({edge:true,...s});
  }
  await capture('edge');
  await js('n.cancelGesture()'); assert.equal(await state(), null);
  assert.equal(await js('String(window.qaError??"")'), '');
  fs.writeFileSync(path.join(output,'report.json'), JSON.stringify({result:'PASS',fixture,reports},null,2));
  console.log(`PASS: ${reports.length} measurement scenarios; screenshots: ${output}`); win.destroy(); app.quit();
})().catch(async error => { console.error(error); if(win&&!win.isDestroyed()) {fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());win.destroy();} app.exit(1); });
