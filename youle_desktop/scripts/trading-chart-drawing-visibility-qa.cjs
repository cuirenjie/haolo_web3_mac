// Isolated synthetic charts; native Electron clicks exercise the settings/eye wiring.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'chart-drawing-visibility-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  setTimeout(() => app.exit(1), 120000).unref();
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1320, height: 1000,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = () => js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const click = async selector => {
    const point = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();if(!r.width||!r.height)throw Error('Hidden '+${JSON.stringify(selector)});return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    for(const type of ['mouseMove','mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...point,button:'left',clickCount:1});
    await settle();
  };
  const capture = async name => fs.writeFileSync(path.join(output, name+'.png'), (await win.webContents.capturePage()).toPNG());
  const input = key => `[data-chart-setting="drawingVisibility.${key}"]`;
  const toggle = key => click(`label:has(${input(key)})`);
  const open = async () => {
    await click('[data-market-action="open-chart-settings"]');
    await click('[data-market-settings-tab="drawing-visibility"]');
  };
  const close = () => click('[data-market-action="close-chart-settings"]');
  const aiEye = '[data-ai-text-size-action="toggle-visibility"]';
  const sideEye = '[data-drawing-action="toggle-visibility"]';
  const counts = () => js('[d.content.childElementCount,d.aiContent.childElementCount]');
  // This regression covers the original settings page's two drawing switches;
  // trading-visibility-menu-qa.cjs covers all five toolbar categories.
  const flags = () => js('({aiHidden:workspace.drawingVisibilitySettings.aiHidden,manualHidden:workspace.drawingVisibilitySettings.manualHidden})');
  const snapshot = () => js('JSON.stringify({manual:d.drawings,ai:d.aiDrawings,redo:d.redoStack})');
  const cases = [];
  for (const theme of ['light','dark']) {
    await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5183}/@fs/${path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/')}`);
    for(let i=0;i<120&&!await js('Boolean(window.ready)');i++)await pause(100);
    assert.equal(await js('Boolean(window.ready)'),true,await js('String(window.qaError)'));
    await js(`document.documentElement.dataset.theme='${theme}';document.querySelector('#host').style.cssText='width:100%;height:100%';
      workspace.applyChartTheme();window.d=workspace.drawingController;
      workspace.drawingVisibilitySettings.setAll(false);
      d.setUserDrawingEnabled(true);d.selectTool('cursor');
      window.line={id:'visible-line-${theme}',tool:'trend-line',symbol:d.getSymbol(),interval:d.getInterval(),drawingScope:'main',
        points:[{time:workspace.candles.at(-85).time,price:1320},{time:workspace.candles.at(-25).time,price:1335}]};
      d.drawings=[line,{...line,id:'individually-hidden-${theme}'}];
      if(!d.drawingVisibility.isHidden(d.drawings[1]))d.drawingVisibility.toggle(d.drawings[1]);
      d.aiDrawings=[{...line,id:'ai-line-${theme}',source:'ai',tool:'path',colorToken:'chan-pen'},
        {id:'ai-note-${theme}',source:'ai',tool:'note',symbol:d.getSymbol(),interval:d.getInterval(),fontSize:10,colorToken:'chan-note',text:'结构参考：等待确认',
          points:[{time:workspace.candles.at(-40).time,price:workspace.candles.at(-40).close}]}];
      d.redoStack=[];d.selectDrawing(null);d.redraw();void 0`);
    await settle();
    const original = await snapshot();
    assert.ok((await counts()).every(n=>n>0));
    await open();
    assert.deepEqual(await flags(),{aiHidden:false,manualHidden:false});
    await toggle('aiHidden');
    assert.ok((await counts())[0]>0);assert.equal((await counts())[1],0);
    await capture(theme+'-ai-hidden');
    await toggle('manualHidden');
    assert.deepEqual(await counts(),[0,0]);
    assert.equal(await js('d.axisMarkerLayer.childElementCount'),0);
    await toggle('aiHidden');
    assert.equal((await counts())[0],0);assert.ok((await counts())[1]>0);
    await toggle('manualHidden');
    assert.ok((await counts()).every(n=>n>0));
    assert.equal(await js('d.content.querySelector(`[data-drawing-id="${d.drawings[1].id}"]`)'),null,'individual hidden state remains hidden');
    assert.equal(await snapshot(),original,'all four switch combinations preserve drawing data and undo');
    // Eye -> settings and settings -> eye, including both hidden and dismissed controls.
    await close();await click(aiEye);await open();
    assert.equal(await js(`document.querySelector('${input('aiHidden')}').checked`),true);
    await toggle('manualHidden');await close();
    assert.equal(await js('d.aiTextSizeToolbar.hidden'),false,'AI restore eye remains available with both layers hidden');
    await click(aiEye);
    assert.deepEqual(await flags(),{aiHidden:false,manualHidden:true});
    await click(sideEye);assert.deepEqual(await flags(),{aiHidden:true,manualHidden:true});
    await click(sideEye);assert.deepEqual(await flags(),{aiHidden:false,manualHidden:false});
    // A real split session has a suffix; preferences must synchronize without aliasing object IDs.
    await js(`workspace.splitLayoutId='2-columns';workspace.applySplitLayout()`);
    for(let i=0;i<100&&!await js('workspace.splitPanes[0]?.candles.length');i++)await pause(50);
    await js(`window.split=workspace.splitPanes[0].drawingController;
      split.drawings=[{...line,id:'split-manual',symbol:split.getSymbol(),interval:split.getInterval()}];
      split.aiDrawings=[{...d.aiDrawings[0],id:'split-ai',symbol:split.getSymbol(),interval:split.getInterval()}];split.redraw()`);
    assert.equal(await js('split.storageSessionId'),await js('d.storageSessionId+"::split-pane:1"'));
    await open();await toggle('manualHidden');await toggle('aiHidden');
    assert.deepEqual(await js('[split.content.childElementCount,split.aiContent.childElementCount]'),[0,0]);
    await close();
    await js('split.drawingVisibility.toggleAi()');
    assert.equal(await js('d.drawingVisibility.aiHidden'),false);
    await open();
    assert.equal(await js(`document.querySelector('${input('aiHidden')}').checked`),false);
    await toggle('manualHidden');await close();
    await js(`workspace.splitLayoutId='1-single';workspace.applySplitLayout()`);
    // Switch sessions through the workspace (including fresh -> persistent migration).
    await open();await toggle('aiHidden');await toggle('manualHidden');await close();
    await js(`window.savedSession=d.storageSessionId;d.persistDrawings();d.persistAiDrawings();workspace.syncDrawingStorageSession(savedSession+'-other-'+Date.now())`);
    await settle();assert.deepEqual(await flags(),{aiHidden:false,manualHidden:false});
    await js('workspace.syncDrawingStorageSession(savedSession)');await settle();
    assert.deepEqual(await flags(),{aiHidden:true,manualHidden:true});
    // Reload recreates controllers with the same persisted session.
    await win.reload();
    for(let i=0;i<120&&!await js('Boolean(window.ready)');i++)await pause(100);
    await js(`window.d=workspace.drawingController;document.documentElement.dataset.theme='${theme}';document.querySelector('#host').style.cssText='width:100%;height:100%';workspace.applyChartTheme()`);
    assert.deepEqual(await flags(),{aiHidden:true,manualHidden:true});
    assert.deepEqual(await counts(),[0,0]);
    await open();await click('[data-market-action="restore-chart-settings"]');
    assert.deepEqual(await flags(),{aiHidden:false,manualHidden:false});
    assert.ok((await counts()).every(n=>n>0));
    assert.equal(await js('d.drawingVisibility.isHidden(d.drawings[1])'),true);
    // Keyboard toggles and labels fit all supported locales in both themes.
    await js(`(async()=>{const m=await import('/app-language.mjs');m.observeAppLanguage(document.body)})()`);
    for (const language of ['zh-CN','zh-TW','en']) {
      await js(`(async()=>{const m=await import('/app-language.mjs');m.applyAppLanguage('${language}',{root:document.body});m.localizeAppTree(document.body,'${language}')})()`);
      await settle();
      const labels = await js(`Array.from(document.querySelectorAll('[data-chart-settings-panel="drawing-visibility"] input')).map(e=>e.getAttribute('aria-label'))`);
      assert.equal(labels.length,5);
      if(language==='en')assert.ok(labels.every(label=>!/[\u3400-\u9fff]/.test(label)),JSON.stringify(labels));
      if(language==='zh-TW')assert.ok(labels.every(label=>label.includes('隱藏')),JSON.stringify(labels));
      const overflow = await js(`Array.from(document.querySelectorAll('[data-chart-settings-panel="drawing-visibility"] .trading-chart-order-display-copy')).some(e=>e.scrollWidth>e.clientWidth)`);
      assert.equal(overflow,false,'translated labels fit');
      await capture(theme+'-'+language);
    }
    await js(`document.querySelector('${input('manualHidden')}').focus()`);
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});await settle();
    assert.equal((await flags()).manualHidden,true,'keyboard switch changes manual layer');
    await js('workspace.drawingVisibilitySettings.setLayers({manualHidden:false});d.setUserDrawingEnabled(false)');
    await toggle('aiHidden');assert.equal((await flags()).aiHidden,true,'settings usable when drawing tools disabled');
    await toggle('aiHidden');
    cases.push({theme,passed:true});console.log('PASS '+theme+': switches, eyes, split, session/reload, defaults, locales, keyboard');
    await js('workspace.destroy()');
  }
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,cases},null,2));
  win.destroy();app.exit(0);
})().catch(error=>{console.error(error);app.exit(1)});
