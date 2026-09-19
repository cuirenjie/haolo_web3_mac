// Run with Electron after starting Vite on 127.0.0.1:5183.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'chart-toolbar');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1200, height: 800,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => { await js('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))'); await pause(40); };
  const report = { cases: [], errors: [] };
  win.webContents.on('console-message', event => {
    if (event.level === 'error' && !event.message.includes('Binance market catalog is unavailable')) report.errors.push(event.message);
  });
  const move = async point => { win.webContents.sendInputEvent({ type: 'mouseMove', ...point }); await settle(); };
  const rect = expression => js(`(() => { const r = (${expression}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  const control = action => `workspace.chartNavigation.controls.querySelector('[data-navigation-action="${action}"]')`;
  const toolbar = 'workspace.chartNavigation.controls';
  const center = r => ({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
  const click = async expression => {
    const point = center(await rect(expression)); await move(point);
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
    await settle();
  };
  const snapshot = () => js(`(() => {
    const c = workspace.chart, bar = workspace.chartNavigation.controls, host = workspace.chartElement;
    const r = bar.getBoundingClientRect(), h = host.getBoundingClientRect();
    const close = bar.querySelector('[data-navigation-action="hide"]'), s = getComputedStyle(close);
    return { hidden: bar.hidden, left: r.left - h.left, top: r.top - h.top, width: r.width, height: r.height,
      opacity: getComputedStyle(bar).opacity, closeOpacity: s.opacity, closeBackground: s.backgroundColor, closeColor: s.color,
      closeRadius: s.borderRadius, closeWidth: s.width, closeHeight: s.height,
      range: c.timeScale().getVisibleLogicalRange(), prices: c.panes().map(p => c.priceScale('right', p.paneIndex()).getVisibleRange()),
      locked: bar.querySelector('[data-navigation-action="lock-vertical"]').getAttribute('aria-pressed') };
  })()`);
  const screenshot = async name => fs.promises.writeFile(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const drag = async (expression, dx, dy) => {
    const start = center(await rect(expression)); await move(start);
    win.webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(start.x + dx * i / 8), y: Math.round(start.y + dy * i / 8), modifiers: ['leftButtonDown'] });
      await pause(16);
    }
    win.webContents.sendInputEvent({ type: 'mouseUp', x: start.x + dx, y: start.y + dy, button: 'left', clickCount: 1 });
    await settle();
  };
  const unchangedChart = (before, after) => { assert.deepEqual(after.range, before.range); assert.deepEqual(after.prices, before.prices); };
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.05, `${actual} should be near ${expected}`);
  for (const theme of ['light', 'dark']) {
    await win.loadURL(`http://127.0.0.1:5183/@fs/${path.join(root, 'test', 'fixtures', 'trading-chart-navigation.html').replaceAll('\\', '/')}`);
    for (let i = 0; i < 150 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
    await js(`document.documentElement.dataset.theme='${theme}'; workspace.loadingHistory=true; workspace.splitLayoutId='1-single'; workspace.applySplitLayout(); workspace.applyChartTheme(); window.primary=workspace; void 0`);
    await settle();
    for (const layout of ['main', 'split']) {
      if (layout === 'split') {
        await js("primary.splitLayoutId='2-columns'; primary.applySplitLayout(); void 0");
        for (let i = 0; i < 100 && !await js('primary.splitPanes[0]?.candles.length'); i++) await pause(50);
        await js('window.workspace=primary.splitPanes[0]; workspace.loadingHistory=true; void 0'); await settle();
      }
      const host = await rect('workspace.chartElement');
      const inside = { x: Math.round(host.x + 260), y: Math.round(host.y + 160) };
      const outside = { x: Math.round(host.x + 20), y: Math.round(host.y - 15) };
      await move(outside); await move(inside);
      const initial = await snapshot();
      near(initial.left, 8); near(initial.top, 36); assert.equal(initial.opacity, '1');
      assert.equal(initial.closeOpacity, '0');
      await move(center(await rect(toolbar)));
      const hovered = await snapshot(); assert.equal(hovered.closeOpacity, '1');
      assert.equal(hovered.closeColor, 'rgb(255, 255, 255)'); assert.equal(hovered.closeBackground, 'rgb(69, 73, 80)');
      assert.equal(hovered.closeWidth, hovered.closeHeight); assert.equal(hovered.closeRadius, '50%');
      const closeRect = await rect(control('hide')), iconRect = await rect(`${control('hide')}.querySelector('svg')`);
      assert.ok(Math.abs(closeRect.x + closeRect.width / 2 - iconRect.x - iconRect.width / 2) < 0.1);
      assert.ok(Math.abs(closeRect.y + closeRect.height / 2 - iconRect.y - iconRect.height / 2) < 0.1);
      await screenshot(`${theme}-${layout}-hover`);
      await move(center(closeRect)); const closeHovered = await snapshot();
      assert.equal(closeHovered.closeBackground, theme === 'dark' ? 'rgb(91, 96, 105)' : 'rgb(52, 55, 61)');
      assert.equal(closeHovered.closeColor, 'rgb(255, 255, 255)');
      await move(inside);
      // Dragging a navigation button must never execute its click action.
      await drag(control('zoom-in'), 140, 100);
      const dragged = await snapshot(); near(dragged.left, 148); near(dragged.top, 136);
      unchangedChart(initial, dragged);
      await screenshot(`${theme}-${layout}-dragged`);
      await click(control('zoom-in')); const zoomed = await snapshot();
      assert.ok(zoomed.range.to - zoomed.range.from < dragged.range.to - dragged.range.from);
      await click(control('zoom-out')); await click(control('left')); const panned = await snapshot();
      await click(control('right')); const returned = await snapshot();
      assert.ok(Math.abs(panned.range.from + 10 - returned.range.from) < 0.001);
      await click(control('lock-vertical')); assert.equal((await snapshot()).locked, 'true');
      await click(control('lock-vertical')); assert.equal((await snapshot()).locked, 'false');
      await click(control('reset'));
      const beforeClose = await snapshot();
      await click(control('hide')); assert.equal((await snapshot()).hidden, true);
      // Cross every native canvas and an interactive sibling drawing overlay.
      for (const offset of [{ x: 25, y: 75 }, { x: 260, y: 240 }, { x: host.width - 10, y: host.height - 12 }, { x: 180, y: host.height - 100 }]) {
        await move({ x: Math.round(host.x + offset.x), y: Math.round(host.y + offset.y) });
        assert.equal((await snapshot()).hidden, true);
      }
      await js(`(() => { const e=document.createElement('div'); e.id='qa-toolbar-overlay'; Object.assign(e.style,{position:'absolute',left:'100px',top:'150px',width:'60px',height:'60px',zIndex:'20',pointerEvents:'auto'}); workspace.chartElement.parentElement.append(e); })()`);
      await move(center(await rect('document.querySelector("#qa-toolbar-overlay")')));
      assert.equal((await snapshot()).hidden, true);
      await js('document.querySelector("#qa-toolbar-overlay").remove(); workspace.chartNavigation.schedule()'); await settle();
      assert.equal((await snapshot()).hidden, true); unchangedChart(beforeClose, await snapshot());
      await screenshot(`${theme}-${layout}-hidden`);
      await move(outside); assert.equal((await snapshot()).hidden, true);
      await move(inside); const restored = await snapshot();
      assert.equal(restored.hidden, false); near(restored.left, 8); near(restored.top, 36);
      await move(center(await rect(toolbar))); await screenshot(`${theme}-${layout}-restored`);
      // Keyboard users can reveal and activate the close button as well.
      await move(inside); await js(`${control('hide')}.focus()`); await settle();
      assert.equal((await snapshot()).closeOpacity, '1');
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' }); await settle();
      assert.equal((await snapshot()).hidden, true);
      if (layout === 'split') assert.equal(await js('primary.chartNavigation.controls.hidden'), false, 'each chart owns its dismissal');
      await move(outside); await move(inside);
      report.cases.push({ theme, layout, initial, hovered, dragged, restored });
      console.log(`PASS ${theme} ${layout}: placement, drag, actions, hover, close, re-entry and keyboard`);

      // Run the same lifecycle against the real AI annotation toolbar.
      await js(`(() => { const d=workspace.drawingController; d.aiDrawings=[-40,-20].map((offset,i)=>({
        id:'qa-text-'+i,tool:'note',source:'ai',symbol:d.getSymbol(),interval:d.getInterval(),fontSize:10,
        colorToken:'chan-note',text:i?'支撑区：确认后观察':'顶部结构：等待确认',points:[{time:workspace.candles.at(offset).time,price:workspace.candles.at(offset).close}]
      })); d.redraw(); })()`); await settle();
      const ai = 'workspace.drawingController.aiTextSizeToolbar';
      const aiButton = action => `${ai}.querySelector('[data-ai-text-size-action="${action}"]')`;
      const aiState = () => js(`(() => { const e=${ai},r=e.getBoundingClientRect(),v=workspace.chartElement.getBoundingClientRect(),c=e.querySelector('[data-ai-text-size-action="dismiss"]'),s=getComputedStyle(c);return {
        hidden:e.hidden,opacity:getComputedStyle(e).opacity,left:r.left-v.left,top:r.top-v.top,
        closeOpacity:s.opacity,closeBackground:s.backgroundColor,closeColor:s.color,closeRadius:s.borderRadius,
        fontSizes:workspace.drawingController.aiDrawings.map(d=>d.fontSize)
      }; })()`);
      await move(outside); await js('document.activeElement.blur()'); await settle();
      assert.equal((await aiState()).opacity,'0'); assert.equal((await snapshot()).opacity,'0');
      await move(inside); const aiInitial=await aiState(); assert.equal(aiInitial.hidden,false);assert.equal(aiInitial.opacity,'1');
      await move(center(await rect(ai)));const aiHovered=await aiState();
      assert.equal(aiHovered.closeOpacity,'1');assert.equal(aiHovered.closeBackground,hovered.closeBackground);
      assert.equal(aiHovered.closeColor,hovered.closeColor);assert.equal(aiHovered.closeRadius,hovered.closeRadius);
      const aiClose=await rect(aiButton('dismiss')),aiIcon=await rect(`${aiButton('dismiss')}.querySelector('svg')`);
      near(aiClose.width,aiClose.height);near(aiClose.x+aiClose.width/2,aiIcon.x+aiIcon.width/2);near(aiClose.y+aiClose.height/2,aiIcon.y+aiIcon.height/2);
      await screenshot(`${theme}-${layout}-ai-hover`);
      await move(center(aiClose));assert.equal((await aiState()).closeBackground,closeHovered.closeBackground);
      await move(inside);
      const chartBeforeAiDrag=await snapshot();
      await drag(aiButton('increase'),-35,65);const aiDragged=await aiState();
      near(aiDragged.left,Math.max(8,aiInitial.left-35));near(aiDragged.top,aiInitial.top+65);
      assert.deepEqual(aiDragged.fontSizes,[10,10]);unchangedChart(chartBeforeAiDrag,await snapshot());
      await click(aiButton('increase'));assert.deepEqual((await aiState()).fontSizes,[11,11]);
      await click(aiButton('decrease'));assert.deepEqual((await aiState()).fontSizes,[10,10]);
      await click(aiButton('dismiss'));assert.equal((await aiState()).hidden,true);
      assert.equal((await snapshot()).hidden,false,'closing AI controls leaves navigation visible');
      const triggers=await js(`workspace.drawingController.aiTextHitContent.querySelectorAll('[data-ai-text-size-trigger]').length`);
      assert.ok(triggers>=2);
      for(let i=0;i<triggers;i++){
        const trigger=`workspace.drawingController.aiTextHitContent.querySelectorAll('[data-ai-text-size-trigger]')[${i}]`;
        await move(center(await rect(trigger)));await js(`${trigger}.focus()`);await settle();
        assert.equal((await aiState()).hidden,true,'annotation hover and focus cannot undo dismissal');
      }
      await js('workspace.drawingController.redraw()');await settle();assert.equal((await aiState()).hidden,true);
      await move({x:Math.round(host.x+150),y:Math.round(host.y+host.height-100)});assert.equal((await aiState()).hidden,true);
      await move(center(await rect(toolbar)));await click(control('hide'));assert.equal((await snapshot()).hidden,true);assert.equal((await aiState()).hidden,true);
      await move(outside);assert.equal((await aiState()).hidden,true);
      await move(inside);const aiRestored=await aiState();assert.equal(aiRestored.hidden,false);
      near(aiRestored.left,aiInitial.left);near(aiRestored.top,aiInitial.top);
      assert.equal((await snapshot()).hidden,false);
      await move(center(await rect(ai)));await screenshot(`${theme}-${layout}-ai-restored`);
      await js(`${aiButton('dismiss')}.focus()`);await settle();assert.equal((await aiState()).closeOpacity,'1');
      for(const input of [{type:'keyDown',keyCode:'Enter'},{type:'char',keyCode:'\r'},{type:'keyUp',keyCode:'Enter'}])win.webContents.sendInputEvent(input);
      await settle();assert.equal((await aiState()).hidden,true);
      await move(outside);await move(inside);
      await js('workspace.drawingController.aiDrawings.forEach(d=>d.fontSize=36);workspace.drawingController.redraw()');await settle();
      assert.equal(await js(`${aiButton('increase')}.disabled`),true);
      await move(center(await rect(ai)));await screenshot(`${theme}-${layout}-ai-disabled`);
      if(layout==='split')assert.equal(await js('primary.drawingController.aiTextSizeToolbar.hidden'),false);
      report.cases.at(-1).ai={initial:aiInitial,hovered:aiHovered,dragged:aiDragged,restored:aiRestored};
      console.log(`PASS ${theme} ${layout} AI: shared visibility, close, drag, resize, annotation hover/focus, re-entry and disabled`);
    }
    await js('primary.destroy()');
  }
  assert.deepEqual(report.errors, []);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, cases: report.cases.length, output }));
  win.destroy(); app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
