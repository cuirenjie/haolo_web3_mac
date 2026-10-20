// Isolated Electron regression using the real chart workspace and native menu clicks.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'chart-remove-all-drawings-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  setTimeout(() => app.exit(1), 90000).unref();
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1320, height: 900,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = () => js('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const url = `http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5191}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`;
  async function load() {
    await win.loadURL(url);
    for (let i = 0; i < 150 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
    await js(`window.d=workspace.drawingController;workspace.loadingHistory=true;
      document.querySelector('#host').style.cssText='width:100%;height:100%';`);
    await settle();
  }
  async function openMenu(owner = 'workspace', pane = 0) {
    const point = await js(`(() => {
      const r=${owner}.chart.panes()[${pane}].getHTMLElement().getBoundingClientRect();
      return {x:Math.round(r.left+160),y:Math.round(r.top+80)};
    })()`);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
      win.webContents.sendInputEvent({ type, ...point, button: 'right', clickCount: 1 });
    }
    await settle();
    assert.equal(await js('document.querySelectorAll(".trading-chart-navigation-menu").length'), 1);
  }
  async function remove() {
    const point = await js(`(() => {
      const b=document.querySelector('[data-navigation-action="remove-all-drawings"]');
      const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
    })()`);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
      win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
    }
    await settle();
    assert.equal(await js('document.querySelectorAll(".trading-chart-navigation-menu").length'), 0);
    assert.equal(await js('d.clearDialog.open'), false, 'menu removal is immediate');
  }
  async function assertEmpty(owner = 'd') {
    assert.deepEqual(await js(`[
      ${owner}.drawings.length,${owner}.aiDrawings.length,${owner}.redoStack.length,
      ${owner}.draft,${owner}.aiDraft,${owner}.aiCursorPoint,${owner}.selectedDrawingId
    ]`), [0, 0, 0, null, null, null, null]);
  }
  const results = [];
  for (const theme of ['light', 'dark']) {
    await load();
    await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();
      window.sessionId='menu-clear-${theme}-'+Date.now();d.switchStorageSession(sessionId);
      window.sample={id:'manual',tool:'trend-line',symbol:d.getSymbol(),interval:d.getInterval(),locked:true,
        points:workspace.candles.slice(-30,-28).map(c=>({time:c.time,price:c.close}))};
      window.seed=()=>{
        d.drawings=[sample,{...sample,id:'other-period',interval:'1d'}];
        d.aiDrawings=[{...sample,id:'ai',source:'ai',tool:'path',colorToken:'chan-pen'}];
        d.redoStack=[{...sample,id:'redo'}];d.selectedDrawingId=sample.id;
        d.persistDrawings();d.persistAiDrawings();
        d.drawingVisibility.setLayers({manualHidden:true,aiHidden:true});d.redraw();
      };seed();`);
    for (const [language, label] of [['zh-CN', '移除所有绘图'], ['zh-TW', '移除所有繪圖'], ['en', 'Remove all drawings']]) {
      await js(`(async()=>{const m=await import('/app-language.mjs');m.applyAppLanguage('${language}',{root:document.body})})()`);
      await openMenu();
      assert.equal(await js('document.querySelector(\'[data-navigation-action="remove-all-drawings"]\').textContent'), label);
      assert.equal(await js('d.drawings.length'), 2, 'opening the menu preserves drawings');
      fs.writeFileSync(path.join(output, `${theme}-${language}.png`), (await win.webContents.capturePage()).toPNG());
      await remove();
      await assertEmpty();
      assert.equal(await js(`Object.keys(localStorage).filter(k=>
        (k.includes('manual')||k.includes('ai'))&&k.endsWith(encodeURIComponent(sessionId))).length`), 0);
      await js('d.undo();d.redo();d.redraw()');
      await assertEmpty();
      await js('seed()');
    }

    // An actual playback cancellation must not restore the complete patch afterward.
    await js(`window.patch={schemaVersion:1,analysisId:'qa',baseRevision:0,marketId:d.getSymbol(),interval:d.getInterval(),
      operations:Array.from({length:8},(_,i)=>({op:'upsert',drawing:{
        ...sample,id:'playing-'+i,source:'ai',theory:'chan',layer:'ai/chan',tool:'path',
        colorToken:'chan-pen',status:'confirmed',evidenceIds:[]}}))};
      window.playbackDone=false;d.drawingVisibility.setLayers({manualHidden:false,aiHidden:false});
      void d.playAiDrawingPatch(patch).then(()=>playbackDone=true);`);
    assert.equal(await js('playbackDone'), false, 'playback is still running before removal');
    await openMenu();
    await remove();
    for (let i = 0; i < 100 && !await js('playbackDone'); i++) await pause(50);
    assert.equal(await js('playbackDone'), true);
    await assertEmpty();

    // Clear while beforePlayback is awaiting a viewport update.
    await js(`void (window.pending=d.playAiDrawingPatch(patch,{beforePlayback:()=>new Promise(r=>window.resumePlayback=r)}));`);
    await openMenu();
    await remove();
    await js('resumePlayback();pending');
    await assertEmpty();

    // Each indicator has its own in-memory copy of the shared session history.
    await js(`workspace.activeIndicators=['volume'];workspace.rebuildIndicatorPanes();workspace.updateChartData({preserveViewport:true});`);
    await settle();
    await js(`window.indicators=[...workspace.indicatorDrawingControllers.values()];
      for(const c of indicators){c.drawings=[{...sample,id:'indicator',drawingScope:c.drawingScope}];
        c.redoStack=[sample];c.persistDrawings();c.redraw();}
      seed();`);
    assert.ok(await js('indicators.length') > 0);
    await openMenu('workspace', 1);
    await remove();
    await assertEmpty();
    assert.equal(await js('indicators.every(c=>!c.drawings.length&&!c.aiDrawings.length&&!c.redoStack.length)'), true);
    await js('for(const c of indicators){c.redo();c.persistDrawings();} d.switchStorageSession("temporary");d.switchStorageSession(sessionId)');
    await assertEmpty();

    // Split panes own separate storage; clear the chart that was right-clicked.
    await js(`workspace.splitLayoutId='2-columns';workspace.applySplitLayout();`);
    for (let i = 0; i < 100 && !await js('workspace.splitPanes[0]?.candles.length'); i++) await pause(50);
    await js(`window.split=workspace.splitPanes[0];window.sd=split.getDrawingController();
      seed();sd.drawings=[{...sample,id:'split-manual',symbol:sd.getSymbol(),interval:sd.getInterval()}];
      sd.aiDrawings=[{...sd.drawings[0],id:'split-ai',source:'ai',colorToken:'chan-pen'}];
      sd.persistDrawings();sd.persistAiDrawings();sd.redraw();`);
    await openMenu('split');
    await remove();
    await assertEmpty('sd');
    assert.equal(await js('d.drawings.length'), 2, 'split removal preserves other charts');
    await js('seed()');
    await openMenu();
    await remove();
    await assertEmpty();
    const savedSessionId = await js('sessionId');
    await load();
    await js(`d.switchStorageSession(${JSON.stringify(savedSessionId)})`);
    await assertEmpty();
    results.push({ theme, languages: 3, nativeClicks: true, hiddenAndLocked: true,
      playbackCancelled: true, pendingPlaybackCancelled: true, indicators: true,
      splitIsolation: true, reload: true });
  }
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, results }, null, 2));
  console.log(JSON.stringify({ passed: true, results, output }, null, 2));
  app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
