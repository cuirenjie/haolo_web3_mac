// Real chart/controllers in an isolated, hidden Electron window with fixture market data.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/visibility-settings-M1-402');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const keys = ['aiHidden', 'manualHidden', 'dataHidden', 'ordersHidden', 'plansHidden'];
const defaults = Object.fromEntries(keys.map(key => [key, false]));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  setTimeout(() => app.exit(1), 120000).unref();
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1320, height: 1000,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = () => js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const click = async selector => {
    const point = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});
      if(!e)throw Error('Missing control');e.scrollIntoView({block:'nearest'});
      const r=e.getBoundingClientRect();if(!r.width||!r.height)throw Error('Hidden control');
      return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp'])
      win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
    await settle();
  };
  const keypress = async keyCode => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await settle();
  };
  const arrow = '[data-drawing-action="toggle-tool-menu"][data-drawing-group-id="visibility"]';
  const menu = '[data-drawing-tool-menu="visibility"]';
  const aiEye = '[data-ai-text-size-action="toggle-visibility"]';
  const toggle = key => click(`[data-drawing-visibility-layer="${key}"]`);
  const open = async () => {
    if (await js(`document.querySelector('${menu}').hidden`)) await click(arrow);
  };
  const state = () => js('d.drawingVisibility.layers()');
  const counts = () => js(`({
    manual:d.content.querySelectorAll('[data-drawing-id="manual"]').length,
    ai:d.aiContent.childElementCount,
    plan:d.orderLineContent.querySelectorAll('[data-trading-plan-price-line]').length,
    orders:d.orderLineContent.querySelectorAll('[data-trading-order-line]:not([data-trading-plan-price-line])').length,
    data:getComputedStyle(document.querySelector('[data-market-ohlc]')).display!=='none'
  })`);
  const snapshot = () => js('JSON.stringify([d.drawings,d.aiDrawings,d.orderLines,d.redoStack])');
  const ready = async () => {
    for (let i = 0; i < 120 && !await js('Boolean(window.ready)'); i++) await pause(50);
    assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
    await js(`window.d=workspace.drawingController;workspace.loadingHistory=true;
      document.querySelector('#host').style.cssText='width:100%;height:100%'`);
    await settle();
  };
  const cases = [];
  for (const theme of ['light', 'dark']) {
    await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5177}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
    await ready();
    await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();
      d.drawingVisibility.setAll(false);d.setUserDrawingEnabled(true);d.selectTool('cursor');
      window.base={symbol:d.getSymbol(),interval:d.getInterval(),drawingScope:'main',
        points:[{time:workspace.candles.at(-85).time,price:1320},{time:workspace.candles.at(-25).time,price:1335}]};
      d.drawings=[{...base,id:'manual',tool:'trend-line'},{...base,id:'individually-hidden',tool:'trend-line'}];
      if(!d.drawingVisibility.isHidden(d.drawings[1]))d.drawingVisibility.toggle(d.drawings[1]);
      d.aiDrawings=[{...base,id:'theory',source:'ai',tool:'path',colorToken:'chan-pen'},
        ...['entry','stop','target','target','target'].map((role,i)=>({...base,id:'plan-'+i,source:'ai',
          tool:'path',strategyId:'price-action',colorToken:'strategy-'+role,
          points:base.points.map(p=>({...p,price:1315+i*5})),text:role}))];
      d.orderLines=['position','commission','stop-loss','take-profit','liquidation'].map((kind,i)=>({
        id:'order-'+i,marketId:d.getSymbol(),price:1312+i*5,kind,shortLabel:kind,label:'10 USDT',quantityUsdt:10
      }));
      d.redoStack=[];d.selectDrawing(null);d.redraw()`);
    await settle();
    const original = await snapshot();
    await open();
    assert.equal(await js(`document.querySelector('${arrow}').getAttribute('aria-expanded')`), 'true');
    assert.equal(await js(`document.querySelector('${menu}').querySelectorAll('[role="menuitemcheckbox"]').length`), 5);
    // Every combination runs through native clicks and actual rendering.
    for (let mask = 0; mask < 32; mask++) {
      const before = await state();
      const expected = Object.fromEntries(keys.map((key, i) => [key, Boolean(mask & (1 << i))]));
      for (const key of keys) if (before[key] !== expected[key]) await toggle(key);
      assert.deepEqual(await state(), expected);
      const visible = await counts();
      assert.equal(visible.manual, expected.manualHidden ? 0 : 1, `manual mask ${mask}`);
      assert.equal(visible.ai > 0, !expected.aiHidden, `AI mask ${mask}`);
      assert.equal(await js(`document.querySelector('${aiEye}').getAttribute('aria-pressed')`), String(expected.aiHidden), `floating eye mask ${mask}`);
      assert.equal(visible.plan, expected.plansHidden ? 0 : 5, `plan mask ${mask}`);
      assert.equal(visible.orders, expected.ordersHidden ? 0 : 5, `orders mask ${mask}`);
      assert.equal(visible.data, !expected.dataHidden, `data mask ${mask}`);
      assert.deepEqual(await js(`Array.from(document.querySelectorAll('${menu} [aria-checked]')).map(e=>e.getAttribute('aria-checked')==='true')`),
        keys.map(key => expected[key]));
      assert.equal(await snapshot(), original, 'visibility preserves geometry, prices and undo');
      assert.equal(await js('d.content.querySelector(`[data-drawing-id="individually-hidden"]`)===null'), true);
    }
    await keypress('Escape');
    assert.equal(await js(`document.querySelector('${menu}').hidden`), true);
    assert.equal(await js(`document.activeElement===document.querySelector('${arrow}')`), true);
    await click('[data-drawing-action="toggle-visibility"]');
    assert.deepEqual(await state(), defaults);
    await click('[data-drawing-action="toggle-visibility"]');
    assert.ok(Object.values(await state()).every(Boolean));
    await click('[data-drawing-action="toggle-visibility"]');
    // Floating eye -> menu/settings, and setting/menu -> floating eye.
    for (const hidden of [true, false]) {
      await click(aiEye);
      assert.equal((await state()).aiHidden, hidden);
      assert.equal((await counts()).plan, 5, 'floating AI eye preserves plans');
      assert.equal(await js(`document.querySelector('[data-drawing-visibility-layer="aiHidden"]').getAttribute('aria-checked')`), String(hidden));
      await click('[data-market-action="open-chart-settings"]');
      await click('[data-market-settings-tab="drawing-visibility"]');
      assert.equal(await js(`document.querySelector('[data-chart-setting="drawingVisibility.aiHidden"]').checked`), hidden);
      await click('[data-market-action="close-chart-settings"]');
    }
    // Dismissal and a non-cursor tool cannot leave the eye's attributes stale.
    await js(`d.dismissAiTextSizeToolbar();d.drawingVisibility.setLayers({aiHidden:true})`);
    assert.equal(await js(`document.querySelector('${aiEye}').getAttribute('aria-pressed')`), 'true');
    await js(`d.selectTool('trend-line');d.drawingVisibility.setLayers({aiHidden:false})`);
    assert.equal(await js(`document.querySelector('${aiEye}').getAttribute('aria-pressed')`), 'false');
    await js(`d.selectTool('cursor');d.aiTextSizeToolbarVisibility.restore();d.redraw()`);
    // Keyboard navigation and Space toggle the focused category.
    await open(); await keypress('Down'); await keypress('Space');
    assert.equal((await state()).aiHidden, true);
    assert.equal((await counts()).plan, 5);
    await keypress('Escape');
    // Existing settings and AI eye keep their bidirectional behavior.
    await click('[data-market-action="open-chart-settings"]');
    await click('[data-market-settings-tab="drawing-visibility"]');
    assert.equal(await js('document.querySelector(`[data-chart-setting="drawingVisibility.aiHidden"]`).checked'), true);
    await click('label:has([data-chart-setting="drawingVisibility.aiHidden"])');
    assert.equal((await state()).aiHidden, false);
    assert.equal(await js(`document.querySelectorAll('[data-chart-settings-panel="drawing-visibility"] [role="switch"]').length`), 5);
    assert.equal(await js(`document.querySelector('[data-chart-settings-panel="background"] [data-chart-setting="hideKlineAnnotations"]')===null`), true);
    for (const key of keys) {
      await click(`label:has([data-chart-setting="drawingVisibility.${key}"])`);
      assert.deepEqual(await state(), { ...defaults, [key]: true });
      const visible = await counts();
      assert.equal(visible.plan, key === 'plansHidden' ? 0 : 5);
      assert.equal(visible.orders, key === 'ordersHidden' ? 0 : 5);
      assert.equal(visible.data, key !== 'dataHidden');
      assert.equal(visible.ai > 0, key !== 'aiHidden');
      assert.equal(await js(`document.querySelector('${aiEye}').getAttribute('aria-pressed')`), String(key === 'aiHidden'));
      assert.equal(visible.manual, key === 'manualHidden' ? 0 : 1);
      assert.equal(await js(`document.querySelector('[data-drawing-visibility-layer="${key}"]').getAttribute('aria-checked')`), 'true');
      await click('[data-market-action="close-chart-settings"]');
      await open(); await toggle(key); await keypress('Escape');
      await click('[data-market-action="open-chart-settings"]');
      assert.equal(await js(`document.querySelector('[data-chart-setting="drawingVisibility.${key}"]').checked`), false);
    }
    await click('[data-market-action="close-chart-settings"]');
    // Legacy global background setting now seeds the same per-conversation switch.
    await js(`d.persistDrawings();d.persistAiDrawings();
      window.originalSession=d.storageSessionId;workspace.chartSettings.hideKlineAnnotations=true;
      workspace.syncDrawingStorageSession('legacy-visibility-${theme}-'+Date.now());
      workspace.mainIndicatorLegendElement.innerHTML='<div>MA: 1,320.00</div>'`);
    assert.equal((await state()).dataHidden, true);
    assert.equal(await js('getComputedStyle(workspace.mainIndicatorLegendElement).display'), 'none');
    await open(); await toggle('dataHidden'); await keypress('Escape');
    await js('workspace.applyKlineAnnotationVisibility()');
    assert.equal((await counts()).data, true);
    assert.notEqual(await js('getComputedStyle(workspace.mainIndicatorLegendElement).display'), 'none');
    await js('workspace.chartSettings.hideKlineAnnotations=false;workspace.syncDrawingStorageSession(originalSession)');
    await js('d.drawingVisibility.setLayers({aiHidden:true,plansHidden:true});d.persistDrawings();d.persistAiDrawings()');
    // New drawings received while hidden remain hidden, then appear on restore.
    await js(`d.aiDrawings.push({...d.aiDrawings.at(-1),id:'new-plan'});d.redraw()`);
    assert.equal((await counts()).plan, 0);
    await open(); await toggle('plansHidden');
    assert.equal((await counts()).plan, 6);
    assert.equal((await counts()).ai, 0);
    await keypress('Escape');
    // True split pane shares all five flags, including OHLC updates.
    await js(`workspace.splitLayoutId='2-columns';workspace.applySplitLayout()`);
    for (let i = 0; i < 100 && !await js('workspace.splitPanes[0]?.candles.length'); i++) await pause(50);
    await js(`window.split=workspace.splitPanes[0].drawingController;
      split.drawingVisibility.setAll(true)`);
    assert.ok(Object.values(await state()).every(Boolean));
    assert.equal(await js(`getComputedStyle(document.querySelector('[data-split-ohlc]')).display`), 'none');
    await js('split.drawingVisibility.setAll(false)');
    assert.deepEqual(await state(), defaults);
    assert.notEqual(await js(`getComputedStyle(document.querySelector('[data-split-ohlc]')).display`), 'none');
    await js(`workspace.splitLayoutId='1-single';workspace.applySplitLayout();
      d.drawingVisibility.setAll(true);window.savedSession=d.storageSessionId;
      workspace.syncDrawingStorageSession(savedSession+'-other-'+Date.now())`);
    assert.deepEqual(await state(), defaults);
    await js('workspace.syncDrawingStorageSession(savedSession)');
    assert.ok(Object.values(await state()).every(Boolean));
    await win.reload(); await ready();
    assert.ok(Object.values(await state()).every(Boolean), 'reload restores all five flags');
    assert.equal((await counts()).data, false);
    await click('[data-market-action="open-chart-settings"]');
    await click('[data-market-action="restore-chart-settings"]');
    assert.deepEqual(await state(), defaults);
    assert.equal((await counts()).plan, 5, 'stored plan levels survive reload and restore');
    await click('[data-market-action="close-chart-settings"]');
    // Theme/language screenshots, selected and focused menu state, viewport bounds.
    await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();
      d.drawingVisibility.setLayers({aiHidden:true,ordersHidden:true});
      (async()=>{const m=await import('/app-language.mjs');m.observeAppLanguage(document.body)})()`);
    for (const language of ['zh-CN', 'zh-TW', 'en']) {
      await js(`(async()=>{const m=await import('/app-language.mjs');
        m.applyAppLanguage('${language}',{root:document.body});m.localizeAppTree(document.body,'${language}')})()`);
      await open(); await keypress('Home'); await settle();
      const layout = await js(`(()=>{const m=document.querySelector('${menu}'),r=m.getBoundingClientRect();
        return {text:m.innerText,width:m.clientWidth,scroll:m.scrollWidth,x:r.x,y:r.y,bottom:r.bottom,right:r.right,
          viewport:[innerWidth,innerHeight]}})()`);
      assert.equal(layout.scroll, layout.width);
      assert.ok(layout.x >= 0 && layout.y >= 0 && layout.right <= layout.viewport[0] && layout.bottom <= layout.viewport[1]);
      if (language === 'en') assert.doesNotMatch(layout.text, /[\u3400-\u9fff]/);
      if (language === 'zh-TW') assert.ok(layout.text.includes('隱藏'));
      fs.writeFileSync(path.join(output, `${theme}-${language}.png`), (await win.webContents.capturePage()).toPNG());
      await keypress('Escape');
      await click('[data-market-action="open-chart-settings"]');
      await click('[data-market-settings-tab="drawing-visibility"]');
      await settle();
      const settingsLayout = await js(`Array.from(document.querySelectorAll('[data-chart-settings-panel="drawing-visibility"] .trading-chart-order-display-copy')).map(e=>({text:e.innerText,overflow:e.scrollWidth>e.clientWidth}))`);
      assert.equal(settingsLayout.length, 5);
      assert.ok(settingsLayout.every(row => !row.overflow));
      if (language === 'en') assert.ok(settingsLayout.every(row => !/[\u3400-\u9fff]/.test(row.text)));
      fs.writeFileSync(path.join(output, `settings-${theme}-${language}.png`), (await win.webContents.capturePage()).toPNG());
      await click('[data-market-action="close-chart-settings"]');
    }
    cases.push({ theme, combinations: 32, passed: true });
    console.log(`PASS ${theme}: 32 combinations, five settings/menu switches, floating eye sync, legacy migration, split, reload, languages`);
    await js('workspace.destroy()');
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: true, cases }, null, 2));
  win.destroy(); app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
