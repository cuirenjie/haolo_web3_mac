const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const tool = process.argv.find(arg => arg.startsWith('--tool='))?.split('=')[1] || 'xabcd';
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/patterns-qa', tool);
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile')); app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const near = (a, b, message = '') => assert.ok(Math.abs(a - b) < .8, `${message}: ${a} vs ${b}`);
const specifications = {
  xabcd: { count: 5, color: '#2962ff', fills: 2, ratios: 4, labels: 5 },
  cypher: { count: 5, color: '#2962ff', fills: 2, ratios: 4, labels: 5 },
  'head-shoulders': { count: 7, color: '#089981', fills: 3, ratios: 0, labels: 3 },
  abcd: { count: 4, color: '#089981', fills: 0, ratios: 2, labels: 4 },
  'triangle-pattern': { count: 4, color: '#673ab7', fills: 1, ratios: 0, labels: 4 },
  'three-drives': { count: 7, color: '#673ab7', fills: 0, ratios: 2, labels: 0 },
};
const spec = specifications[tool]; assert.ok(spec, tool);
for (const stale of ['failure.txt', 'failure.png', 'report.json']) {
  const artifact = path.join(output, stale); if (fs.existsSync(artifact)) fs.unlinkSync(artifact);
}
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(35); };
  const capture = async name => fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const input = async (type, p = { x: 0, y: 0 }, extra = {}) => { win.webContents.sendInputEvent({ type, x: Math.round(p.x), y: Math.round(p.y), ...extra }); await settle(); };
  const click = async p => { await input('mouseMove', p); await input('mouseDown', p, { button: 'left', clickCount: 1 }); await input('mouseUp', p, { button: 'left', clickCount: 1 }); };
  const drag = async (a, b) => { await input('mouseMove', a); await input('mouseDown', a, { button: 'left', clickCount: 1 }); await input('mouseMove', b, { button: 'left', modifiers: ['leftButtonDown'] }); await input('mouseUp', b, { button: 'left', clickCount: 1 }); };
  const key = async keyCode => { await input('keyDown', undefined, { keyCode }); await input('keyUp', undefined, { keyCode }); };
  const load = async () => {
    for (let i = 0; i < 120 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true);
    await js(`window.d=workspace.drawingController;workspace.loadingHistory=true;document.querySelector('#host').style.cssText='width:100%;height:100%';d.magnetEnabled=false;d.stayInDrawingMode=false;d.selectTool('crosshair');d.redraw()`); await settle();
  };
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5196}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
  await load();
  let rect = await js('(()=>{const r=d.chartElement.getBoundingClientRect();return {x:r.left,y:r.top}})()');
  const screen = p => ({ x: rect.x + p.x, y: rect.y + p.y });
  const state = () => js(`(()=>{const item=d.draft??d.drawings.at(-1),g=item&&d.content.querySelector('[data-drawing-id="'+item.id+'"]');return {draft:!!d.draft,count:d.drawings.length,model:item,confirmed:d.draftConfirmedPointCount,bounds:d.plotBounds(),
    points:item?.points.map(p=>d.pointToScreen(p)),fills:g?.querySelectorAll('[data-harmonic-fill]').length??0,labels:[...(g?.querySelectorAll('[data-harmonic-point] text')??[])].map(n=>n.textContent),
    ratios:[...(g?.querySelectorAll('[data-harmonic-ratio]')??[])].map(n=>({chord:n.dataset.harmonicRatio,text:n.textContent})),
    handles:g?.querySelectorAll('[data-harmonic-handle]').length??0,neckline:g?.querySelector('[data-head-shoulders-neckline]')?.outerHTML,triangle:g?.querySelectorAll('[data-triangle-boundary]').length??0,
    svg:g?.innerHTML??'',tool:d.activeTool,priceMarkers:d.axisMarkerLayer.querySelectorAll('[data-drawing-axis-price]').length,timeMarkers:d.axisMarkerLayer.querySelectorAll('[data-drawing-axis-time]').length,toolbar:!d.selectionToolbar.hidden}})()`);
  const expectedRatios = prices => {
    const ratio = (n, den, precision = 3) => den === 0 ? '—' : String(Number(Math.abs(n / den).toFixed(precision)));
    const [a,b,c,e,f,g] = prices;
    if (tool === 'three-drives') return [ratio(e-c,c-b,2),ratio(g-f,f-e,2)];
    if (tool === 'abcd') return [ratio(c-b,b-a),ratio(e-c,c-b)];
    if (tool === 'xabcd' || tool === 'cypher') return [ratio(c-b,b-a),tool === 'cypher'?ratio(e-a,b-a):ratio(e-c,c-b),ratio(f-e,e-c),tool === 'cypher'?ratio(f-e,e-a):ratio(f-b,b-a)];
    return [];
  };
  const verify = v => {
    assert.equal(v.model.points.length, spec.count); assert.equal(v.fills, spec.fills); assert.equal(v.labels.length, spec.labels); assert.equal(v.ratios.length, spec.ratios);
    assert.deepEqual(v.ratios.map(r=>r.text),expectedRatios(v.model.points.map(p=>p.price)));
    assert.ok(v.svg.includes(`stroke="${v.model.color??spec.color}"`)); assert.doesNotMatch(v.svg,/NaN|Infinity/);
    if(tool==='head-shoulders') {assert.ok(v.neckline);assert.deepEqual(v.labels,['左肩','头部','右肩']);}
    if(tool==='triangle-pattern') assert.equal(v.triangle,3);
  };
  for (const theme of ['light','dark']) {
    console.log(`${tool}: ${theme} placement`);
    await js(`d.selectTool('crosshair');d.selectDrawing(null);d.drawings=[];d.drawingStyles.clear();document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();d.selectTool('${tool}');d.redraw()`); await settle();
    const anchors = tool==='head-shoulders' ? [{x:220,y:370},{x:300,y:190},{x:410,y:330},{x:520,y:110},{x:670,y:335},{x:790,y:210},{x:930,y:360}]
      : tool==='three-drives' ? [{x:220,y:190},{x:330,y:370},{x:460,y:120},{x:590,y:330},{x:740,y:170},{x:860,y:290},{x:970,y:150}]
      : tool==='triangle-pattern' ? [{x:230,y:180},{x:410,y:390},{x:610,y:140},{x:800,y:270}]
      : tool==='abcd' ? [{x:230,y:370},{x:400,y:190},{x:610,y:330},{x:840,y:140}]
      : [{x:230,y:190},{x:410,y:370},{x:610,y:130},{x:790,y:340},{x:970,y:195}];
    await click(screen(anchors[0]));
    for(let i=1;i<anchors.length;i++) {
      await input('mouseMove',screen(anchors[i])); let v=await state();
      assert.equal(v.confirmed,i);assert.equal(v.count,0);assert.equal(v.handles,i);assert.equal(v.priceMarkers,i);assert.equal(v.timeMarkers,i);
      if(i===1) {assert.equal(v.fills,0);assert.equal(v.ratios.length,0);}
      if(theme==='light') await capture('preview-'+(i+1));
      await click(screen(anchors[i]));
    }
    let v=await state();verify(v);assert.equal(v.draft,false);assert.equal(v.count,1);assert.equal(v.handles,spec.count);assert.equal(v.tool,'crosshair');assert.equal(v.toolbar,true);
    const priceTops=await js(`[...d.axisMarkerLayer.querySelectorAll('[data-drawing-axis-price]')].map(n=>parseFloat(n.style.top)).sort((a,b)=>a-b)`);
    for(let i=1;i<priceTops.length;i++)assert.ok(priceTops[i]-priceTops[i-1]>=23.9,'price labels must not overlap');
    assert.equal(await js(`d.axisMarkerLayer.querySelector('[data-pattern-time-range]').style.bottom`),'0px');
    await capture(theme+'-complete');
    console.log(`${tool}: ${theme} handle and body drag`);
    for(let i=0;i<spec.count;i++) {
      const before=await state(),p=screen(before.points[i]);await drag(p,{x:p.x+8,y:p.y+6});v=await state();verify(v);
      assert.notDeepEqual(v.model.points[i],before.model.points[i],`handle ${i} moves`);
      for(let j=0;j<spec.count;j++) if(i!==j) assert.deepEqual(v.model.points[j],before.model.points[j],`handle ${i} leaves ${j}`);
    }
    v=await state();const before=v.model.points,p=screen({x:(v.points[0].x+v.points[1].x)/2,y:(v.points[0].y+v.points[1].y)/2});
    await drag(p,{x:p.x+24,y:p.y-17});v=await state();verify(v);
    for(let i=0;i<spec.count;i++){assert.notDeepEqual(v.model.points[i],before[i]);near(v.model.points[i].price-before[i].price,v.model.points[0].price-before[0].price);near(v.model.points[i].time-before[i].time,v.model.points[0].time-before[0].time);}
    // Selection is retained past the shared three-second idle timeout.
    await js(`d.overlay.classList.add('drawing-handles-idle')`);
    assert.equal(await js(`getComputedStyle(d.content.querySelector('[data-harmonic-handle]')).visibility`),'visible');
    await js('d.selectDrawing(null)');await settle();v=await state();assert.equal(v.handles,0);assert.equal(v.priceMarkers,0);assert.equal(v.timeMarkers,0);verify(v);await capture(theme+'-deselected');
    await click(screen(v.points[1]));await settle();assert.equal((await state()).handles,spec.count);
    if(tool==='triangle-pattern') {
      // The projected boundaries beyond D must select the complete drawing too.
      const edge=await js(`(()=>{const l=d.content.querySelector('[data-triangle-boundary="0"]');const x1=+l.getAttribute('x1'),y1=+l.getAttribute('y1'),x2=+l.getAttribute('x2'),y2=+l.getAttribute('y2');const x=(d.pointToScreen(d.drawings[0].points[3]).x+x2)/2;return {x,y:y1+(x-x1)*(y2-y1)/(x2-x1)}})()`);
      await js('d.selectDrawing(null)');await settle();await click(screen(edge));assert.equal((await state()).handles,spec.count,'extended boundary selects the shape');
    }
    // All anchors remain editable through the coordinate dialog.
    await js(`d.openHorizontalLineSettings(d.drawings.at(-1));document.querySelector('[data-line-tab="coordinates"]').click()`);await settle();
    assert.equal(await js(`document.querySelectorAll('dialog[open] [name="coordinatePoint"] option').length`),spec.count);
    await js(`(()=>{const s=document.querySelector('[name="coordinatePoint"]');s.value='${spec.count-1}';s.dispatchEvent(new Event('change',{bubbles:true}));const p=document.querySelector('[name="price"]');p.value=String(Number(p.value)+.1);document.querySelector('dialog[open] form').requestSubmit()})()`);await settle();verify(await state());
  }
  console.log(`${tool}: style, persistence, zoom, cancel and delete`);
  await js(`d.selectionToolbar.querySelector('[data-drawing-selection-action="pattern-label"]').click()`);await settle();
  assert.equal(await js(`document.querySelector('dialog[open] [data-line-panel="text"]').hidden`),false);
  assert.equal(await js(`document.querySelector('dialog[open] [name="text"]').hidden`),true);
  await js(`document.querySelector('dialog[open] form').requestSubmit()`);await settle();
  if(tool==='head-shoulders') {
    // Vite may version imports after an edit. Use the module loaded by the
    // chart, so this exercises the same language singleton as the renderer.
    await js(`(async()=>{const url=performance.getEntriesByType('resource').find(r=>new URL(r.name).pathname==='/app-language.mjs').name;window.patternLanguage=await import(url);patternLanguage.applyAppLanguage('en');d.redraw()})()`);await settle();
    assert.deepEqual((await state()).labels,['Left Shoulder','Head','Right Shoulder']);await capture('english-labels');
    await js(`patternLanguage.applyAppLanguage('zh-CN');d.redraw()`);await settle();
  }
  if(spec.fills) {
    // Opaque six-digit colors ending in 00 are not transparent alpha values.
    await js(`d.openHorizontalLineSettings(d.drawings.at(-1));document.querySelector('[name="patternFill"]').value='#ff0000';document.querySelector('[name="patternBackground"]').checked=true;document.querySelector('dialog[open] form').requestSubmit()`);await settle();
    assert.equal((await state()).model.textBackgroundColor,'#ff0000');
    await js(`d.openHorizontalLineSettings(d.drawings.at(-1))`);await settle();
    assert.equal(await js(`document.querySelector('[name="patternBackground"]').checked`),true);
    await js(`document.querySelector('[name="patternBackground"]').checked=false;document.querySelector('dialog[open] form').requestSubmit()`);await settle();
    assert.equal((await state()).model.textBackgroundColor,'#ff000000');
    await js(`d.openHorizontalLineSettings(d.drawings.at(-1));document.querySelector('[name="patternBackground"]').checked=true;document.querySelector('dialog[open] form').requestSubmit()`);await settle();
    assert.equal((await state()).model.textBackgroundColor,'#ff000026');
  }
  await js(`d.openHorizontalLineSettings(d.drawings.at(-1));document.querySelector('[name="color"]').value='#e91e63';document.querySelector('[name="fontSize"]').value='18';document.querySelector('[name="textColor"]').value='#ffff00';document.querySelector('[name="lineWidth"]').value='3';document.querySelector('[name="patternFill"]')?.setAttribute('value','#673ab780');document.querySelector('dialog[open] form').requestSubmit()`);await settle();
  let v=await state();verify(v);assert.equal(v.model.color,'#e91e63');assert.equal(v.model.fontSize,18);const saved=v.model;
  await win.reload();await load();v=await state();
  for(const name of ['id','tool','points','color','fontSize','lineWidth','lineStyle','textColor','textBackgroundColor']) assert.deepEqual(v.model[name],saved[name],`restored ${name}`);
  verify(v);
  await js(`d.getChart().timeScale().setVisibleLogicalRange({from:350,to:520});d.redraw()`);await settle();v=await state();assert.deepEqual(v.model.points,saved.points);verify(v);
  await js('workspace.chartNavigation.setMode(1)');await settle();v=await state();verify(v);await capture('restored-log-scale');
  await js('workspace.chartNavigation.setMode(0)');await settle();
  // Escape cancels a draft; right click removes one confirmed point.
  await js(`d.selectTool('${tool}')`);await click(screen({x:300,y:150}));await click(screen({x:500,y:300}));await input('mouseMove',screen({x:700,y:160}));
  await input('mouseDown',screen({x:700,y:160}),{button:'right',clickCount:1});await input('mouseUp',screen({x:700,y:160}),{button:'right',clickCount:1});
  v=await state();assert.equal(v.confirmed,1);assert.equal(v.count,1);await key('Escape');assert.equal((await state()).draft,false);assert.equal((await state()).count,1);
  // Lock rejects pointer edits; delete removes the selected shape.
  await js(`d.selectTool('crosshair');d.selectDrawing(d.drawings[0].id);d.drawings[0].locked=true;d.redraw()`);await settle();v=await state();const locked=v.model.points,p=screen(v.points[0]);await drag(p,{x:p.x+20,y:p.y+20});assert.deepEqual((await state()).model.points,locked);
  await js(`d.drawings[0].locked=false;d.selectDrawing(d.drawings[0].id);d.redraw();d.selectionToolbar.querySelector('[data-drawing-selection-action="delete"]').click()`);await settle();assert.equal((await state()).count,0);
  assert.equal(await js('String(window.qaError??"")'),'');
  const report={result:'PASS',tool,themes:['light','dark'],stagedPreview:true,ratioChecks:true,independentHandles:spec.count,wholeDrawingDrag:true,coordinateEditor:true,stylePersistence:true,zoomAndLog:true,rightClickRewind:true,escapeCancel:true,lock:true,delete:true};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));win.destroy();app.quit();
})().catch(async error=>{console.error(error);fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack));if(win&&!win.isDestroyed())fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());win?.destroy();app.exit(1);});
