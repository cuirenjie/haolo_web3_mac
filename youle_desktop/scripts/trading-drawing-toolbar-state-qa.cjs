// Real pointer/keyboard checks against the isolated chart fixture (no user account).
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/drawing-toolbar-state-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = [];
let win;
(async () => {
  setTimeout(() => {console.error('Toolbar QA timed out');app.exit(1);},360000).unref();
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 1100, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => { await js('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))'); await pause(20); };
  const input = async (type, point = {}, extra = {}) => { win.webContents.sendInputEvent({ type, ...point, ...extra }); await settle(); };
  const click = async point => {
    await input('mouseMove', point); await input('mouseDown', point, { button: 'left', clickCount: 1 });
    await input('mouseUp', point, { button: 'left', clickCount: 1 });
  };
  const button = async selector => {
    const point = await js(`(() => { const e = d.toolbar.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:'nearest'});
      const r = e.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
    await click(point);
  };
  const action = name => button(`[data-drawing-action="${name}"]`);
  const snapshot = selector => js(`(() => { const e=d.toolbar.querySelector(${JSON.stringify(selector)}), s=getComputedStyle(e);
    return {active:e.classList.contains('active'),pressed:e.getAttribute('aria-pressed'),checked:e.getAttribute('aria-checked'),color:s.color,background:s.backgroundColor}; })()`);
  const selected = async (selector, expected) => {
    const state = await snapshot(selector);
    assert.equal(state.active, expected, selector);
    assert.equal(state.pressed ?? state.checked, String(expected), selector);
    if (expected) {
      assert.notEqual(state.background, 'rgba(0, 0, 0, 0)', `${selector}: selection must have a persistent visible background`);
      assert.notEqual(state.background, state.color, selector);
    }
    return state;
  };
  const capture = async name => fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const url = `http://127.0.0.1:5199/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`;
  await win.loadURL(url);
  for (let i=0; i<150 && !await js('Boolean(window.ready)'); i++) await pause(100);
  assert.ok(await js('Boolean(window.ready)'), await js('String(window.qaError)'));
  await js(`(async()=>{ window.d=workspace.drawingController;window.n=d.getNavigation();workspace.loadingHistory=true;
    document.querySelector('#host').style.cssText='width:100%;height:100%';d.drawings=[];d.favoriteTools.clear();d.selectTool('crosshair');
    window.catalog=await import('/trading-expert-drawing.ts');window.groups=await import('/trading-drawing-catalog.ts'); })()`);
  await settle();
  const cursor = '[data-drawing-group="cursor"] .trading-drawing-primary';
  const measure = '[data-drawing-action="measure"]', zoom = '[data-drawing-action="zoom-in"]';
  const pane = await js(`(() => {const r=workspace.chart.panes()[0].getHTMLElement().getBoundingClientRect();return {x:Math.round(r.left+220),y:Math.round(r.top+180)}})()`);
  for (const theme of ['light', 'dark']) {
    await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();d.selectTool('crosshair')`); await settle();
    await action('measure'); await input('mouseMove', pane);
    if (process.argv.includes('--baseline')) {
      report.push({theme,tool:await js('n.getTool()'),measure:await snapshot(measure),cursor:await snapshot(cursor)});
      await capture(`${theme}-before`); continue;
    }
    assert.equal(await js('n.getTool()'), 'measure');
    report.push({theme,measure:await selected(measure,true)}); await selected(cursor,false); await selected(zoom,false);
    await capture(`${theme}-measure-selected`);
    // Real pointerdown must not erase the active tool before the second click.
    await action('measure'); assert.equal(await js('n.getTool()'),null);
    await selected(measure,false); await selected(cursor,true);
    await action('measure'); await selected(measure,true);
    await input('keyDown', {}, {keyCode:'Escape'}); await input('keyUp', {}, {keyCode:'Escape'});
    await selected(measure,false); await selected(cursor,true);
    await action('measure'); await action('zoom-in'); await input('mouseMove',pane);
    await selected(measure,false); await selected(zoom,true); await selected(cursor,false);
    await capture(`${theme}-zoom-selected`);
    await action('zoom-in'); assert.equal(await js('n.getTool()'),null);
    await selected(zoom,false); await selected(cursor,true);
    // Cancel an in-progress selection without applying it or leaving its overlay.
    for (const name of ['measure','zoom-in']) {
      const before=await js('workspace.chart.timeScale().getVisibleLogicalRange()');
      await action(name); await click(pane); await input('mouseMove',{x:pane.x+140,y:pane.y+60});
      assert.ok(await js('Boolean(n.selection)'));
      await action(name); await input('mouseMove',pane);
      assert.equal(await js('n.getTool()'),null); assert.equal(await js('n.selection'),null);
      assert.equal(await js('Boolean(n.measurement)'),false);
      assert.deepEqual(await js('workspace.chart.timeScale().getVisibleLogicalRange()'),before);
      await selected(measure,false); await selected(zoom,false); await selected(cursor,true);
    }
    // Finish both navigation gestures: their icons must reset immediately.
    for (const name of ['zoom-in','measure']) {
      await action(name); await click(pane); await input('mouseMove',{x:pane.x+180,y:pane.y+90});
      await selected(name === 'measure' ? measure : zoom,true);
      await click({x:pane.x+180,y:pane.y+90});
      assert.equal(await js('n.getTool()'),null); await selected(measure,false); await selected(zoom,false); await selected(cursor,true);
    }
    await action('measure'); await button('[data-drawing-group="trend"] .trading-drawing-primary');
    await selected(measure,false); await selected(cursor,false); await selected('[data-drawing-group="trend"] .trading-drawing-primary',true);
    // Every persistent toggle keeps its pressed appearance after the pointer leaves.
    for (const name of ['toggle-magnet','toggle-stay','toggle-lock','toggle-visibility']) {
      const selector=`[data-drawing-action="${name}"]`;
      if ((await snapshot(selector)).pressed === 'true') await action(name);
      await action(name); await input('mouseMove',pane); await selected(selector,true);
      await action(name); await input('mouseMove',pane); await selected(selector,false);
      report.push({theme,toggle:name});
    }
    for (const mode of ['weak','strong']) {
      for (const expected of [true,false]) {
        await button('[data-drawing-action="toggle-tool-menu"][data-drawing-group-id="magnet"]');
        await button(`[data-magnet-mode="${mode}"]`);
        await selected('[data-drawing-action="toggle-magnet"]',expected);
        assert.equal(await js(`d.toolbar.querySelector('[data-magnet-mode="${mode}"]').getAttribute('aria-checked')`),String(expected));
      }
    }
    // Exercise all catalog tool buttons; image/post tools open dialogs instead.
    const allEntries = await js(`catalog.TRADING_DRAWING_TOOLS.filter(t=>!['image','tweet','emoji','sticker','icon'].includes(t.id)).map(t=>({id:t.id,group:groups.drawingMenuGroup(t.id)}))`);
    const entries = process.argv.includes('--interactions-only') ? allEntries.filter(t=>['crosshair','eraser','trend-line','rectangle'].includes(t.id)) : allEntries;
    for (const {id,group} of entries) {
      await js('d.selectTool("crosshair")');
      await button(`[data-drawing-action="toggle-tool-menu"][data-drawing-group-id="${group}"]`);
      await button(`[data-drawing-tool-menu="${group}"] [data-drawing-tool="${id}"]`);
      assert.equal(await js('d.activeTool'),id);
      await selected(`[data-drawing-group="${group}"] .trading-drawing-primary`,true);
      await selected(`[data-drawing-tool-menu="${group}"] [data-drawing-tool="${id}"]`,true);
      assert.equal(await js(`d.toolbar.querySelectorAll('.trading-drawing-primary.active').length`),1);
      await button(`[data-drawing-group="${group}"] .trading-drawing-primary`);
      assert.equal(await js('d.activeTool'),'crosshair',`${id}: repeated primary click returns to cursor`);
      await selected(cursor,true);
      if (group!=='cursor') await selected(`[data-drawing-group="${group}"] .trading-drawing-primary`,false);
    }
    report.push({theme,catalogTools:entries.length});
    for (const id of ['emoji','sticker','icon']) {
      await button('[data-drawing-action="toggle-tool-menu"][data-drawing-group-id="icons"]');
      await button(`[data-symbol-tab="${id}"]`);
      await button(`[data-drawing-symbol-grid] [data-symbol-tool="${id}"]`);
      assert.equal(await js('d.activeTool'),id);
      await selected('[data-drawing-group="icons"] .trading-drawing-primary',true);
      await selected(cursor,false);
      await button('[data-drawing-group="icons"] .trading-drawing-primary');
      await selected('[data-drawing-group="icons"] .trading-drawing-primary',false); await selected(cursor,true);
    }
    for (const id of ['image','tweet']) {
      await button('[data-drawing-action="toggle-tool-menu"][data-drawing-group-id="annotation"]');
      await button(`[data-drawing-tool-menu="annotation"] [data-drawing-tool="${id}"]`);
      assert.ok(await js(`d.${id === 'image' ? 'imageDialog' : 'xPostDialog'}.open`));
      await selected(cursor,true); await selected('[data-drawing-group="annotation"] .trading-drawing-primary',false);
      await input('keyDown', {}, {keyCode:'Escape'}); await input('keyUp', {}, {keyCode:'Escape'});
      assert.equal(await js(`d.${id === 'image' ? 'imageDialog' : 'xPostDialog'}.open`),false);
      await selected(cursor,true);
    }
    report.push({theme,symbolTools:3,dialogTools:2});
    // The same symbol toggles off; a different glyph of the same type switches it.
    for (const index of [0,1,1]) {
      await button('[data-drawing-action="toggle-tool-menu"][data-drawing-group-id="icons"]');
      await button('[data-symbol-tab="emoji"]');
      await button(`[data-drawing-symbol-grid] button:nth-child(${index+1})`);
    }
    await selected('[data-drawing-group="icons"] .trading-drawing-primary',false); await selected(cursor,true);
    await js('d.selectTool("cursor")');
    await button('[data-drawing-group="trend"] .trading-drawing-primary');
    await button('[data-drawing-group="trend"] .trading-drawing-primary');
    assert.equal(await js('d.activeTool'),'cursor','cancellation restores the remembered ordinary cursor');
    await js('d.selectTool("eraser")');
    await action('measure'); await action('measure');
    assert.equal(await js('d.activeTool'),'crosshair','cancellation never returns to the eraser');
    // Completing a drawing resets its button, unless stay-in-drawing mode is on.
    await js('d.lastToolByGroup.set("cursor","crosshair");d.selectTool("crosshair")');
    for (const stay of [false,true]) {
      if (stay) await action('toggle-stay');
      await button('[data-drawing-action="toggle-tool-menu"][data-drawing-group-id="trend"]');
      await button('[data-drawing-tool-menu="trend"] [data-drawing-tool="trend-line"]');
      await click(pane); await input('mouseMove',{x:pane.x+150,y:pane.y+70}); await click({x:pane.x+150,y:pane.y+70});
      await selected('[data-drawing-group="trend"] .trading-drawing-primary',stay); await selected(cursor,!stay);
      if (stay) {
        // Escape first clears the completed drawing selection, then exits the tool.
        await input('keyDown', {}, {keyCode:'Escape'}); await input('keyUp', {}, {keyCode:'Escape'});
        assert.equal(await js('d.selectedDrawingId'),null);
        await selected('[data-drawing-group="trend"] .trading-drawing-primary',true);
        await input('keyDown', {}, {keyCode:'Escape'}); await input('keyUp', {}, {keyCode:'Escape'});
        await selected(cursor,true); await selected('[data-drawing-group="trend"] .trading-drawing-primary',false);
        await action('toggle-stay');
      }
    }
    await js(`d.selectTool('crosshair')`);
    await button('[data-drawing-action="toggle-tool-menu"][data-drawing-group-id="trend"]');
    await button('[data-favorite-tool="trend-line"]');
    await button('[data-drawing-tool-menu="trend"] [data-drawing-tool="trend-line"]');
    const favorite='[data-drawing-favorites-bar] [data-drawing-tool="trend-line"]';
    await selected(favorite,true); await action('toggle-stay'); await selected(favorite,true); await action('toggle-stay');
    await action('measure'); await selected(favorite,false);
    await button(favorite); await selected(favorite,true); await selected(measure,false);
    await button(favorite); await selected(favorite,false); await selected(cursor,true);
    await button(favorite); await selected(favorite,true);
    // Cancelling a drawing midway discards its draft, not completed drawings.
    const drawingCount=await js('d.drawings.length');
    await click({x:pane.x+40,y:pane.y+100}); await input('mouseMove',{x:pane.x+120,y:pane.y+160});
    assert.ok(await js('Boolean(d.draft)'));
    await button(favorite); assert.equal(await js('d.draft'),null);
    assert.equal(await js('d.drawings.length'),drawingCount); await selected(favorite,false); await selected(cursor,true);
    // Menu selection and keyboard activation use the same toggle behavior.
    await button(favorite);
    await button('[data-drawing-action="toggle-tool-menu"][data-drawing-group-id="trend"]');
    await button('[data-drawing-tool-menu="trend"] [data-drawing-tool="trend-line"]');
    await selected(favorite,false); await selected(cursor,true);
    await js(`d.toolbar.querySelector(${JSON.stringify(favorite)}).focus()`);
    assert.equal(await js(`document.activeElement===d.toolbar.querySelector(${JSON.stringify(favorite)})`),true);
    for (const expected of [true,false]) {
      await input('keyDown',{}, {keyCode:'Enter'}); await input('char',{}, {keyCode:'\r'}); await input('keyUp',{}, {keyCode:'Enter'});
      await selected(favorite,expected); await selected(cursor,!expected);
    }
    await button(cursor); await selected(favorite,false); await selected(cursor,true);
    await js('d.favoriteTools.clear();d.updateToolbarState()');
    // Momentary commands never advertise a persistent selected mode.
    for (const name of ['screenshot','clear','undo','redo','zoom-out']) {
      const s=await snapshot(`[data-drawing-action="${name}"]`); assert.equal(s.active,false); assert.equal(s.pressed,null);
    }
    report.push({theme,repeatClickCancellation:'PASS',draftCancellation:'PASS',keyboardToggle:'PASS'});
    console.log(`PASS: ${theme} tool selection and repeat-click cancellation`);
  }
  if (!process.argv.includes('--baseline')) {
    await js(`workspace.splitLayoutId='2-columns';workspace.applySplitLayout()`);
    for (let i=0; i<100 && !await js('Boolean(workspace.splitPanes[0]?.drawingController && workspace.splitPanes[0]?.candles.length)'); i++) await pause(50);
    assert.ok(await js('Boolean(workspace.splitPanes[0]?.drawingController)'));
    await js('workspace.splitPanes[0].loadingHistory=true'); await settle();
    const panePoint = expression => js(`(() => {const r=(${expression}).chartElement.getBoundingClientRect();return {x:Math.round(r.x+170),y:Math.round(r.y+120)}})()`);
    const splitPoint = await panePoint('workspace.splitPanes[0]');
    await click(splitPoint);
    await js('window.d=workspace.splitPanes[0].drawingController;window.n=d.getNavigation();void 0');
    await action('measure'); await input('mouseMove',splitPoint);
    assert.equal(await js('n.getTool()'),'measure'); await selected(measure,true); await selected(cursor,false);
    await capture('dark-split-measure-selected');
    await action('measure'); assert.equal(await js('n.getTool()'),null);
    await selected(measure,false); await selected(cursor,true);
    await click(await panePoint('workspace'));
    await js('window.d=workspace.drawingController;window.n=d.getNavigation();void 0');
    await action('zoom-in'); await selected(zoom,true); await selected(cursor,false);
    await button(cursor); await selected(zoom,false); await selected(cursor,true);
    report.push({sharedToolbarAcrossPanes:'PASS'});
  }
  assert.equal(await js('String(window.qaError??"")'),'');
  fs.writeFileSync(path.join(output,process.argv.includes('--baseline')?'baseline.json':'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report)); console.log('PASS: toolbar selection QA');win.destroy();app.quit();
})().catch(async error => {console.error(error);if(win&&!win.isDestroyed()){fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());win.destroy();}app.exit(1);});
