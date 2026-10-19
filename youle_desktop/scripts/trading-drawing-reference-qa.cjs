// Isolated Electron renderer QA. No real account, remote drawing sync, or user profile.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'drawing-icon-audit-20261017');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { menus: [], drawings: [], errors: [] };
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1304, height: 880, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = async code => {
    let timeout;
    try {
      return await Promise.race([win.webContents.executeJavaScript(code, true), new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Renderer evaluation timed out')), 15000);
      })]);
    } catch(error) { throw new Error(`${error.message}\nScript: ${code.slice(-600)}`); }
    finally { clearTimeout(timeout); }
  };
  const interactionsOnly = process.argv.includes('--interactions-only');
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(25); };
  const capture = async name => fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const fixture = `http://127.0.0.1:5183/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`;
  const load = async () => {
    await win.loadURL(fixture);
    for (let i=0;i<120 && !await js('Boolean(window.ready)');i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
    await js(`(async()=>{document.querySelector('#host').style.cssText='width:100%;height:100%'; window.d=workspace.drawingController; workspace.loadingHistory=true; window.catalog=await import('/trading-expert-drawing.ts'); window.menuCatalog=await import('/trading-drawing-catalog.ts');})()`);
    await settle();
  };
  win.webContents.on('console-message', event => {
    if (event.level === 'error' && !event.message.includes('Binance market catalog is unavailable')) report.errors.push(event.message);
  });
  await load();
  await js('d.drawings=[];d.favoriteTools.clear();d.persistDrawings();d.selectTool("crosshair")');
  // Switching tools must never turn the brush/T category entries into a rectangle/callout.
  for (const [tool,group,icon] of [['rectangle','brush','brush'],['callout','annotation','text'],['parallel-channel','trend','trend']]) {
    await js(`d.selectTool('${tool}')`);
    assert.equal(await js(`d.toolbar.querySelector('[data-drawing-group="${group}"] .trading-drawing-primary svg').dataset.drawingIcon`),icon);
    await js(`d.toolbar.querySelector('[data-drawing-group="${group}"] .trading-drawing-primary').click()`);
    assert.equal(await js('d.activeTool'),group==='trend'?'trend-line':icon);
  }
  const actionIcon = action => js(`d.toolbar.querySelector('[data-drawing-action="${action}"] svg').dataset.drawingIcon`);
  for (const [action,off,on] of [['toggle-lock','unlock','lock'],['toggle-stay','pin','pin-locked'],['toggle-visibility','drawings-visible','drawings-hidden']]) {
    assert.equal(await actionIcon(action),off);
    await js(`d.toolbar.querySelector('[data-drawing-action="${action}"]').click()`);
    assert.equal(await actionIcon(action),on);
    await js(`d.toolbar.querySelector('[data-drawing-action="${action}"]').click()`);
    assert.equal(await actionIcon(action),off);
  }
  await js('d.selectTool("crosshair")');
  await capture('light-toolbar');
  for (const theme of interactionsOnly ? [] : ['light','dark']) {
    await js(`document.documentElement.dataset.theme='${theme}'; workspace.applyChartTheme()`);
    for (const group of await js('menuCatalog.DRAWING_MENU_SECTIONS.map(g=>g.id)')) {
      await js(`d.closeToolMenus(); d.toolbar.querySelector('[data-drawing-action="toggle-tool-menu"][data-drawing-group-id="${group}"]').click()`); await settle();
      const metrics = await js(`(() => { const m=d.toolbar.querySelector('[data-drawing-tool-menu="${group}"]'),r=m.getBoundingClientRect(); return {hidden:m.hidden,top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,viewport:innerHeight,rail:d.toolbar.getBoundingClientRect().width,rows:[...m.querySelectorAll('.trading-drawing-menu-row')].map(e=>e.getBoundingClientRect().height)}; })()`);
      assert.equal(metrics.hidden,false); assert.ok(metrics.bottom<=metrics.viewport+1); assert.ok(metrics.top>=0);
      assert.equal(metrics.rail,52); metrics.rows.forEach(height=>assert.equal(height,40));
      const reachable = await js(`(() => {const m=d.toolbar.querySelector('[data-drawing-tool-menu="${group}"]');const scroll=m.querySelector('.trading-drawing-menu-scroll');if(!scroll)return true;scroll.scrollTop=scroll.scrollHeight;const last=[...m.querySelectorAll('[role="menuitemradio"], [role="menuitem"]')].at(-1),r=last.getBoundingClientRect();const hit=document.elementFromPoint(r.left+15,r.top+r.height/2);scroll.scrollTop=0;return last.contains(hit);})()`);
      assert.equal(reachable,true,`${theme} ${group}: last row must not be clipped by a chart ancestor`);
      report.menus.push({theme,group,...metrics}); await capture(`${theme}-${group}`);
    }
  }
  await js(`document.documentElement.dataset.theme='light';workspace.applyChartTheme();d.closeToolMenus()`);
  if (!interactionsOnly) {
    await js(`window.gallery=document.createElement('div');gallery.className='trading-drawing-tool-menu';gallery.style.cssText='position:fixed;inset:8px;max-width:none;max-height:none;width:auto;padding:12px;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;z-index:9999;background:white;color:#131722;--drawing-icon-fill:white';gallery.innerHTML=catalog.TRADING_DRAWING_TOOLS.map(t=>'<div style="display:flex;align-items:center;gap:8px;min-width:0">'+menuCatalog.renderDrawingIcon(t.icon)+'<span style="font:11px Arial;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+t.label+'</span></div>').join('');document.body.append(gallery)`);
    await settle();
    report.icons = await js(`Array.from(gallery.querySelectorAll('svg')).map(svg=>({id:svg.dataset.drawingIcon,box:{width:svg.getBBox().width,height:svg.getBBox().height}}))`);
    assert.equal(report.icons.length,104);
    for(const icon of report.icons) assert.ok(icon.box.width>0 && icon.box.height>0,icon.id);
    await capture('all-tool-icons');
    await js('gallery.remove()');
  }
  // A favorite must not select a tool or close the menu, and must survive reload.
  await js(`d.favoriteTools.clear();d.toolbar.querySelector('[data-drawing-action="toggle-tool-menu"][data-drawing-group-id="trend"]').click();d.toolbar.querySelector('[data-favorite-tool="trend-line"]').click()`);
  assert.equal(await js('d.activeMenu'),'trend'); assert.equal(await js('d.favoriteTools.has("trend-line")'),true);
  await js('d.closeToolMenus()');
  const click = async (x,y,clickCount=1) => {
    win.webContents.sendInputEvent({type:'mouseMove',x,y});
    win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount});
    win.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount});
    await settle();
  };
  const tools = await js('catalog.TRADING_DRAWING_TOOLS.filter(t=>!["cursor","eraser"].includes(t.kind)).map(t=>({id:t.id,kind:t.kind,freehand:t.freehand,multi:catalog.tradingDrawingIsMultiPoint(t.id),count:catalog.tradingDrawingIsMultiPoint(t.id)?4:catalog.tradingDrawingRequiredPointCount(t)}))');
  for (const tool of interactionsOnly ? [] : tools) {
    await js(`d.drawings=[];d.selectedDrawingId=null;d.selectTool(${JSON.stringify(tool.id)});d.redraw()`);
    const r = await js('(()=>{const r=d.overlay.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()');
    const points = Array.from({length:Math.max(tool.count,2)},(_,i)=>({x:Math.round(r.x+180+i*65),y:Math.round(r.y+150+(i%2)*75)}));
    if(tool.freehand) {
      const a=points[0],b=points[1];
      win.webContents.sendInputEvent({type:'mouseDown',...a,button:'left',clickCount:1});
      for(let i=1;i<=10;i++) win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(a.x+(b.x-a.x)*i/10),y:Math.round(a.y+(b.y-a.y)*i/10),modifiers:['leftButtonDown']});
      win.webContents.sendInputEvent({type:'mouseUp',...b,button:'left',clickCount:1}); await settle();
    } else for (const p of points.slice(0,tool.count)) await click(p.x,p.y);
    if(tool.multi) await click(points.at(-1).x,points.at(-1).y,2);
    if(tool.kind==='text') {
      await js(`d.textInputElement().value=${JSON.stringify(tool.id==='table'?'名称 | 价格\nBTC | 100':tool.id==='image'?'https://example.invalid/test.png':'测试标注')};d.confirmTextInput(d.drawings.at(-1))`); await settle();
    }
    const state = await js(`(()=>{const model=d.drawings.at(-1);const group=model&&d.content.querySelector('[data-drawing-id="'+model.id+'"]');return {count:d.drawings.length,tool:model?.tool,points:model?.points.length,markup:group?.innerHTML??'',draft:!!d.draft}})()`);
    assert.equal(state.count,1,`${tool.id}: clicks must create exactly one drawing; ${JSON.stringify(state)}`);
    assert.equal(state.tool,tool.id); assert.equal(state.draft,false);
    assert.equal(await js('d.activeTool'),'crosshair',`${tool.id}: return to the chosen cursor`);
    assert.ok(state.markup.length>50,`${tool.id}: drawing visible`);
    assert.doesNotMatch(state.markup,/NaN|Infinity|undefined/,`${tool.id}: finite geometry`);
    if(!tool.freehand) assert.equal(state.points,tool.count);
    await js('d.undo()'); assert.equal(await js('d.drawings.length'),0,`${tool.id}: undo`);
    await js('d.redo()'); assert.equal(await js('d.drawings.length'),1,`${tool.id}: redo`);
    report.drawings.push({id:tool.id,points:state.points});
    if(['fib-trend-time','fib-speed-arcs','gann-square-fixed','anchored-vwap','anchored-volume-profile','sector','sine-line','time-cycles','elliott-triple-combo','table','multi-point-path','multi-point-polyline'].includes(tool.id)) await capture(`drawing-${tool.id}`);
    console.log(`PASS ${tool.id}: placement, geometry, undo/redo`);
  }
  // Save/load the new 3-anchor tool and anchored note using the same storage path as production.
  await js(`d.drawings=['fib-trend-time','anchored-note','emoji'].map((tool,i)=>({id:'restore-'+tool,tool,symbol:d.getSymbol(),interval:d.getInterval(),drawingScope:'main',text:i===2?'🚀':'备注',viewportAnchor:i===1?{x:.4,y:.3}:undefined,points:workspace.candles.slice(-60,-57).map(c=>({time:c.time,price:c.close}))}));d.persistDrawings()`);
  await load();
  assert.deepEqual(await js('d.drawings.map(m=>m.tool)'),['fib-trend-time','anchored-note','emoji']);
  assert.equal(await js('d.drawings[1].viewportAnchor.x'),.4);
  assert.equal(await js('d.drawings[2].text'),'🚀');
  assert.equal(await js('d.favoriteTools.has("trend-line")'),true);
  await js(`(async()=>{const imageTools=await import('/trading-drawing-extra-tools.ts');const c=document.createElement('canvas');c.width=c.height=16;c.getContext('2d').fillRect(0,0,16,16);d.pendingImageReference=imageTools.storeDrawingImage(c.toDataURL('image/png'));d.selectTool('image');})()`);
  const imagePoint=await js('(()=>{const r=d.overlay.getBoundingClientRect();return {x:Math.round(r.x+220),y:Math.round(r.y+180)}})()');
  await click(imagePoint.x,imagePoint.y);
  assert.equal(await js('d.pendingTextDrawingId'),null,'local image places immediately without asking for text');
  assert.equal(await js('d.drawings.at(-1).tool'),'image');
  assert.equal(await js('d.content.querySelector("image").getAttribute("href").startsWith("data:image/png;base64,")'),true);
  await load();
  assert.equal(await js('d.drawings.at(-1).tool'),'image');
  assert.equal(await js('d.content.querySelector("image").getAttribute("href").startsWith("data:image/png;base64,")'),true);
  // Drag a new tool's third anchor, then its body, without moving the chart.
  await js(`d.drawings=d.drawings.filter(m=>m.tool==='fib-trend-time');d.selectedDrawingId=d.drawings[0].id;d.selectTool('cursor');d.redraw()`); await settle();
  const drag = async (from,dx,dy) => {
    win.webContents.sendInputEvent({type:'mouseDown',...from,button:'left',clickCount:1});
    for(let i=1;i<=8;i++) {win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(from.x+dx*i/8),y:Math.round(from.y+dy*i/8),modifiers:['leftButtonDown']});await pause(8);}
    win.webContents.sendInputEvent({type:'mouseUp',x:from.x+dx,y:from.y+dy,button:'left',clickCount:1}); await settle();
  };
  const before = await js('structuredClone(d.drawings[0].points)');
  const handle = await js(`(()=>{const r=d.content.querySelector('[data-drawing-handle-index="2"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  await drag(handle,45,20);
  const after = await js('structuredClone(d.drawings[0].points)');
  assert.deepEqual(after.slice(0,2),before.slice(0,2)); assert.notDeepEqual(after[2],before[2]);
  // Free-length drawings: keyboard/right-click completion excludes the moving preview.
  const plot=await js('(()=>{const r=d.overlay.getBoundingClientRect();return {x:r.x,y:r.y}})()');
  const anchors=[{x:plot.x+180,y:plot.y+180},{x:plot.x+320,y:plot.y+180},{x:plot.x+320,y:plot.y+300}].map(p=>({x:Math.round(p.x),y:Math.round(p.y)}));
  for(const id of ['multi-point-path','multi-point-polyline']) for(const finish of ['Escape','Enter','right']) {
    await js(`d.drawings=[];d.selectTool('${id}')`);
    for(const p of anchors) await click(p.x,p.y);
    const confirmed=await js('structuredClone(d.draft.points.slice(0,d.draftConfirmedPointCount))');
    win.webContents.sendInputEvent({type:'mouseMove',x:anchors[2].x+40,y:anchors[2].y+40});await settle();
    if(finish==='right') {
      win.webContents.sendInputEvent({type:'mouseDown',...anchors[2],button:'right',clickCount:1});
      win.webContents.sendInputEvent({type:'mouseUp',...anchors[2],button:'right',clickCount:1});
    } else {
      win.webContents.sendInputEvent({type:'keyDown',keyCode:finish});
      win.webContents.sendInputEvent({type:'keyUp',keyCode:finish});
    }
    await settle();
    assert.equal(await js('d.drawings.length'),1,`${id}: ${finish}`);
    assert.deepEqual(await js('d.drawings[0].points'),confirmed,`${id}: exclude preview on ${finish}`);
    assert.equal(await js('catalog.tradingDrawingIsClosedPolyline(d.drawings[0])'),false);
    assert.equal(await js('!!d.content.querySelector("polyline[marker-end]")'),id==='multi-point-path');
  }
  // Returning to the first vertex closes the polygon and survives vertex/body drag and reload.
  await js(`d.drawings=[];d.selectTool('multi-point-polyline')`);
  for(const p of anchors) await click(p.x,p.y);
  await click(anchors[0].x,anchors[0].y);
  assert.equal(await js('catalog.tradingDrawingIsClosedPolyline(d.drawings[0])'),true);
  await click(anchors[1].x-20,anchors[1].y+25);
  const firstHandle=await js(`(()=>{const r=d.content.querySelector('[data-drawing-handle-index="0"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  await drag(firstHandle,20,10);
  assert.equal(await js('catalog.tradingDrawingIsClosedPolyline(d.drawings[0])'),true);
  assert.equal(await js('d.content.querySelectorAll("[data-drawing-handle-index]").length'),3);
  const closedBefore=await js('structuredClone(d.drawings[0].points)');
  await drag({x:anchors[1].x-30,y:anchors[1].y+40},20,15);
  assert.notDeepEqual(await js('d.drawings[0].points'),closedBefore);
  assert.equal(await js('catalog.tradingDrawingIsClosedPolyline(d.drawings[0])'),true);
  await capture('closed-polyline'); await load();
  assert.equal(await js('catalog.tradingDrawingIsClosedPolyline(d.drawings[0])'),true);
  // Every vertex remains editable past the old 12-handle display limit.
  await js(`d.drawings=[];d.selectTool('multi-point-path')`);
  for(let i=0;i<14;i++) await click(Math.round(plot.x+150+i*45),Math.round(plot.y+150+(i%2)*80));
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});await settle();
  await js('d.selectDrawing(d.drawings[0].id)');
  assert.equal(await js('d.content.querySelectorAll("[data-drawing-handle-index]").length'),14);
  const lastHandle=await js(`(()=>{const r=d.content.querySelector('[data-drawing-handle-index="13"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  const lastBefore=await js('structuredClone(d.drawings[0].points[13])');await drag(lastHandle,20,15);
  assert.notDeepEqual(await js('d.drawings[0].points[13]'),lastBefore);
  await load();assert.equal(await js('d.drawings[0].points.length'),14);
  // Magic is a transient cursor, never a saved drawing, and its particles clean themselves up.
  await js(`d.selectTool('magic')`);
  win.webContents.sendInputEvent({type:'mouseMove',x:anchors[0].x+10,y:anchors[0].y+10});await settle();
  assert.ok(await js('!!d.magicTrail?.children.length'));
  await pause(700);assert.equal(await js('d.magicTrail.children.length'),0);
  assert.equal(await js('d.drawings.length'),1);
  await js(`d.selectTool('crosshair')`);
  report.multiPointInteractions='PASS: open/closed, double-click, Escape, Enter, right-click, vertex/body dragging, 14 vertices, reload, transient magic cursor';
  // Shared toolbar must retain the chosen symbol and remembered merged menu item across panes.
  await js(`d.selectTool('parallel-channel');d.symbolGlyph='🚀';d.selectTool('emoji');window.shared=d.sharedToolState();workspace.splitLayoutId='2-columns';workspace.applySplitLayout()`);
  for(let i=0;i<100 && !await js('Boolean(workspace.splitPanes[0]?.drawingController)');i++) await pause(50);
  await js(`window.sd=workspace.splitPanes[0].drawingController;sd.applySharedToolState(shared)`);
  assert.equal(await js('sd.symbolGlyph'),'🚀'); assert.equal(await js('sd.activeTool'),'emoji');
  await js(`workspace.splitLayoutId='1-single';workspace.applySplitLayout();d=workspace.drawingController;void 0`); await settle();
  // Short viewport: long menus scroll and the last tool remains reachable.
  win.setSize(1000,600); await settle();
  await js(`d.toolbar.querySelector('[data-drawing-action="toggle-tool-menu"][data-drawing-group-id="trend"]').click();d.toolbar.querySelector('[data-drawing-tool-menu="trend"] [data-drawing-tool="inside-pitchfork"]').focus()`); await settle();
  assert.equal(await js('document.activeElement.dataset.drawingTool'),'inside-pitchfork');
  await capture('small-viewport-menu');
  // Exclude the intentional invalid-image URL used for local placement coverage.
  report.errors=report.errors.filter(e=>!e.includes('ERR_NAME_NOT_RESOLVED'));
  fs.writeFileSync(path.join(output,interactionsOnly?'interactions-report.json':'report.json'),JSON.stringify(report,null,2));
  console.log(`PASS ${report.menus.length} menu/theme cases, ${report.drawings.length} drawing tools, persistence and small viewport`);
  win.destroy(); app.quit();
})().catch(error=>{console.error(error,report.errors);fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack)+'\n'+JSON.stringify(report.errors));win?.destroy();app.exit(1)});
