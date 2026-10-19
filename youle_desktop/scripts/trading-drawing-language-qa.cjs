// Isolated renderer audit: synthetic candles, no real account or drawing sync.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'drawing-language-audit-20261017');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { menus: [], tools: [], statuses: [], errors: [] };
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1304, height: 940, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = async code => {
    try { return await win.webContents.executeJavaScript(code, true); }
    catch(error) { throw new Error(`${error.message}\nScript: ${code}\nRenderer errors: ${JSON.stringify(report.errors)}`); }
  };
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(20); };
  const capture = async name => fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  win.webContents.on('console-message', event => { if(event.level === 'error' && !event.message.includes('Binance market catalog is unavailable')) report.errors.push(event.message); });
  await win.loadURL(`http://127.0.0.1:5183/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
  for(let i=0;i<120 && !await js('Boolean(window.ready)');i++) await pause(100);
  assert.equal(await js('Boolean(window.ready)'),true,await js('String(window.qaError)'));
  await js(`(async()=>{
    document.querySelector('#host').style.cssText='width:100%;height:100%';
    window.d=workspace.drawingController;workspace.loadingHistory=true;
    window.catalog=await import('/trading-expert-drawing.ts');window.menus=await import('/trading-drawing-catalog.ts');
    window.language=await import('/app-language.mjs');
    d.drawings=[];d.favoriteTools.clear();d.selectTool('crosshair');
    language.applyAppLanguage('en',{root:document.body});window.stopLanguage=language.observeAppLanguage(document.body);
    window.untranslated=()=>{const found=[];
      for(const root of document.querySelectorAll('[data-i18n-drawing]')) {
        const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;
        while(n=walker.nextNode()) if(!n.parentElement.closest('[data-i18n-skip],textarea') && /\\p{Script=Han}/u.test(n.nodeValue)) found.push({text:n.nodeValue,tag:n.parentElement.tagName});
        for(const e of [root,...root.querySelectorAll('*')]) if(!e.closest('[data-i18n-skip]')) for(const attr of ['title','aria-label','placeholder']) if(/\\p{Script=Han}/u.test(e.getAttribute(attr)||'')) found.push({attr,value:e.getAttribute(attr)});
      }return found;
    };
  })()`);
  await settle();
  assert.deepEqual(await js('untranslated()'),[], 'initial UI, including hidden menus and editor controls');
  for(const theme of ['light','dark']) {
    await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme()`);
    for(const group of await js('menus.DRAWING_MENU_SECTIONS.map(g=>g.id)')) {
      await js(`d.closeToolMenus();d.toolbar.querySelector('[data-drawing-group-id="${group}"][data-drawing-action="toggle-tool-menu"]').click()`);await settle();
      const metrics=await js(`(()=>{const menu=d.toolbar.querySelector('[data-drawing-tool-menu="${group}"]');return {headings:[...menu.querySelectorAll('h3')].map(e=>e.textContent),rows:[...menu.querySelectorAll('.trading-drawing-menu-row')].map(row=>{const button=row.querySelector('[data-drawing-tool]'),label=button.querySelector('span'),range=document.createRange();range.selectNodeContents(label);const r=range.getBoundingClientRect(),key=button.querySelector('kbd'),favorite=row.querySelector('.trading-drawing-favorite');return {id:button.dataset.drawingTool,text:label.firstChild.textContent,labelRight:r.right,boundary:Math.min(key.textContent?key.getBoundingClientRect().left:Infinity,favorite?favorite.getBoundingClientRect().left:row.getBoundingClientRect().right),height:row.getBoundingClientRect().height}})};})()`);
      for(const row of metrics.rows) assert.ok(row.labelRight<=row.boundary+1,`${theme}/${group}/${row.id}: label overlaps shortcut or favorite ${JSON.stringify(row)}`);
      assert.deepEqual(await js('untranslated()'),[],`${theme}/${group}`);
      report.menus.push({theme,group,...metrics});await capture(`${theme}-${group}`);
    }
  }
  await js(`document.documentElement.dataset.theme='light';workspace.applyChartTheme();d.closeToolMenus()`);
  for(const tool of await js('catalog.TRADING_DRAWING_TOOLS.map(t=>({id:t.id,label:t.label,kind:t.kind}))')) {
    await js(`d.selectTool(${JSON.stringify(tool.id)})`);await settle();
    assert.deepEqual(await js('untranslated()'),[],`select ${tool.id}`);
    report.tools.push({id:tool.id,status:await js('d.status.textContent')});
  }
  for(const [action,on,off] of [['toggle-lock','Unlock all drawings','Lock all drawings'],['toggle-visibility','Show all drawings','Hide all drawings']]) {
    for(const title of [on,off]) {
      await js(`d.toolbar.querySelector('[data-drawing-action="${action}"]').click()`);await settle();
      assert.equal(await js(`d.toolbar.querySelector('[data-drawing-action="${action}"]').title`),title);
      assert.deepEqual(await js('untranslated()'),[],`${action}: ${title}`);
    }
  }
  await js(`d.selectedDrawingId=null;d.selectTool('crosshair');
    d.drawings=['long-position','short-position','measure','image','table','anchored-vwap','anchored-volume-profile'].map((tool,i)=>({id:'language-label-'+i,tool,symbol:d.getSymbol(),interval:d.getInterval(),drawingScope:'main',points:[workspace.candles.at(-45),workspace.candles.at(-20)].map(c=>({time:c.time,price:c.close}))}));
    window.savedGetCandles=d.getCandles;window.savedDrawingCandles=d.getCandles();d.getCandles=()=>savedDrawingCandles.map(c=>({...c,volume:0}));d.redraw()`);await settle();
  assert.deepEqual(await js('untranslated()'),[], 'system labels in drawings');
  const systemLabels=await js('d.content.textContent');
  for(const text of ['Target','Stop','Enter an image URL','Item','Value','No volume data']) assert.ok(systemLabels.includes(text),text);
  await js('d.getCandles=savedGetCandles;d.drawings=[];d.redraw()');
  // Real draft state transitions for every multi-click family, including undo.
  const click=async(x,y,button='left')=>{
    win.webContents.sendInputEvent({type:'mouseMove',x,y});
    win.webContents.sendInputEvent({type:'mouseDown',x,y,button,clickCount:1});
    win.webContents.sendInputEvent({type:'mouseUp',x,y,button,clickCount:1});await settle();
  };
  const plot=await js('(()=>{const r=d.overlay.getBoundingClientRect();return {x:r.x,y:r.y}})()');
  const points=[{x:Math.round(plot.x+180),y:Math.round(plot.y+160)},{x:Math.round(plot.x+300),y:Math.round(plot.y+220)}];
  for(const id of ['trend-line','triangle','fib-retracement','parallel-channel','xabcd','elliott-triple-combo','multi-point-path','multi-point-polyline','price-note']) {
    await js(`d.cancelDraft();d.selectTool('${id}')`);
    await click(points[0].x,points[0].y);
    assert.deepEqual(await js('untranslated()'),[],`${id}: first point`);
    report.statuses.push(await js('d.status.textContent'));
    if(!['trend-line','fib-retracement','price-note'].includes(id)) {
      await click(points[1].x,points[1].y);
      assert.deepEqual(await js('untranslated()'),[],`${id}: second point`);
      report.statuses.push(await js('d.status.textContent'));
      if(!id.startsWith('multi-point')) {
        await click(points[1].x,points[1].y,'right');
        assert.deepEqual(await js('untranslated()'),[],`${id}: undo point`);
        report.statuses.push(await js('d.status.textContent'));
      }
    }
  }
  await js(`d.cancelDraft();d.selectTool('text')`);await click(points[0].x,points[0].y);
  assert.deepEqual(await js('untranslated()'),[], 'text editor');
  await capture('text-editor');
  await js(`d.textInputElement().value='中文交易计划：回归趋势';d.confirmTextInput(d.drawings.at(-1))`);await settle();
  for(const id of ['table','note']) {
    await js(`d.selectTool('${id}')`);await click(points[1].x,points[1].y);
    await js(`d.textInputElement().value=${JSON.stringify('项目 | 价格\n止损 | 100')};d.confirmTextInput(d.drawings.at(-1))`);await settle();
  }
  await js(`d.selectTool('crosshair');d.toolbar.querySelector('[data-drawing-group-id="trend"][data-drawing-action="toggle-tool-menu"]').click();d.toolbar.querySelector('[data-favorite-tool="trend-angle"]').click()`);await settle();
  assert.equal(await js(`d.toolbar.querySelector('[data-favorite-tool="trend-angle"]').title`),'Remove from favorites');
  const authored=await js(`[...d.content.querySelectorAll('[data-i18n-skip]')].map(e=>e.textContent)`);
  assert.ok(authored.some(t=>t.includes('中文交易计划')));
  assert.ok(authored.some(t=>t.includes('项目')));
  for(const lang of ['zh-CN','en','zh-TW','en']) {
    await js(`language.applyAppLanguage('${lang}',{root:document.body});d.updateToolbarState()`);await settle();
    assert.deepEqual(await js(`[...d.content.querySelectorAll('[data-i18n-skip]')].map(e=>e.textContent)`),authored,`${lang}: user text must stay verbatim`);
    const title=await js(`d.toolbar.querySelector('[data-drawing-group="trend"] .trading-drawing-primary').title`);
    assert.equal(title,lang==='en'?'Trendline':lang==='zh-TW'?'趨勢線':'趋势线');
    if(lang==='en') assert.deepEqual(await js('untranslated()'),[], 'language round trip');
  }
  await js('d.closeToolMenus();d.openClearDialog()');await settle();
  assert.deepEqual(await js('untranslated()'),[], 'session clear dialog');await capture('clear-dialog');
  await js(`d.clearDialog.close();d.clearScopeLabel='副图 MACD';d.openClearDialog()`);await settle();
  assert.deepEqual(await js('untranslated()'),[], 'indicator pane clear dialog');
  await js('d.clearDialog.close();d.clearScopeLabel=null');
  win.setSize(900,680);await settle();
  await js(`d.toolbar.querySelector('[data-drawing-group-id="pattern"][data-drawing-action="toggle-tool-menu"]').click()`);await settle();
  assert.deepEqual(await js('untranslated()'),[], 'small viewport');await capture('small-pattern');
  report.roundTrip='PASS: en → zh-CN → en → zh-TW → en; user text preserved';
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  assert.deepEqual(report.errors,[]);
  fs.rmSync(path.join(output,'failure.txt'),{force:true});
  console.log(`PASS: ${report.menus.length} menu/theme cases; ${report.tools.length} tools; ${report.statuses.length} draft states; editors, favorites, dialogs, language switching and user annotations`);
  win.destroy();app.quit();
})().catch(error=>{console.error(error);fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack));win?.destroy();app.exit(1)});
