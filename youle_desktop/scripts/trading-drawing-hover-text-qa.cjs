// Real mouse input, synthetic candles, and storage isolated from the user's app.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/drawing-hover-text-qa');
fs.mkdirSync(output, { recursive: true }); app.setPath('userData', path.join(output, 'profile')); app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(30); };
  const move = async p => { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(p.x), y: Math.round(p.y) }); await settle(); };
  const click = async p => { await move(p); for (const type of ['mouseDown','mouseUp']) win.webContents.sendInputEvent({ type, x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1 }); await settle(); };
  const promptState = (hoverOnly = false) => js(`(()=>{const actions=[...d.content.querySelectorAll('[data-horizontal-line-add-text]')].filter(e=>!${hoverOnly}||!e.hasAttribute('data-drawing-text-position'));const e=actions.find(e=>getComputedStyle(e).opacity==='1')??actions[0],m=e?.getScreenCTM();return e?{center:e.hasAttribute('data-drawing-text-position'),opacity:getComputedStyle(e).opacity,color:getComputedStyle(e).color,fill:e.querySelector('rect').getAttribute('fill'),x:m.e,y:m.f,angle:Math.atan2(m.b,m.a)*180/Math.PI}:null})()`);
  const away = async () => { await move({x:20,y:20}); assert.equal((await promptState(true))?.opacity ?? '0','0','hover action hides away from the drawing'); };
  const capture = async name => {
    const r=await js(`(()=>{const r=document.querySelector('.trading-expert-market').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`);
    fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage(r)).toPNG());
  };
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5183}/@fs/${path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/')}`);
  for(let i=0;i<120&&!await js('Boolean(window.ready)');i++)await pause(100);
  assert.equal(await js('Boolean(window.ready)'),true);
  await js(`(async()=>{window.d=workspace.drawingController;workspace.loadingHistory=true;document.querySelector('#host').style.cssText='width:100%;height:100%';window.api=await import('/trading-expert-drawing.ts');d.selectTool('crosshair')})()`);await settle();
  const setup = async (tool, prices=[1323,1315]) => {
    await move({x:20,y:20});
    await js(`(()=>{d.selectDrawing(null);const t=api.tradingDrawingToolDefinition('${tool}'),n=Math.max(api.tradingDrawingRequiredPointCount(t),t.freehand||api.tradingDrawingIsMultiPoint(t.id)?4:2);d.drawings=[{id:'hover',tool:t.id,symbol:d.getSymbol(),interval:d.getInterval(),points:Array.from({length:n},(_,i)=>({time:workspace.candles.at(-100+Math.round(i*60/(n-1))).time,price:${prices[0]}+(${prices[1]}-${prices[0]})*i/(n-1)+(n>=3&&i>=2&&i%2===0?16:0)}))}];d.selectTool('crosshair');d.selectDrawing('hover');d.redraw()})()`);await settle();
  };
  const levelPoint = ratio => js(`(()=>{const e=d.content.querySelector('[data-fibonacci-level="${ratio}"] line'),r=e.getBoundingClientRect();return {x:r.x+r.width*.1,y:r.y+r.height/2,cx:r.x+r.width/2,color:getComputedStyle(e).stroke}})()`);
  const report={result:'PASS',fib:[],tools:[],curves:[],redraw:true,nativeClick:true,hoverHiddenAway:true};
  for(const theme of ['light','dark']) {
    await setup('fib-retracement');await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();d.redraw()`);await settle();
    for(const selected of [false,true]) {
      await js(`d.selectDrawing(${selected ? "'hover'" : 'null'});d.redraw()`);await settle();await away();
      const before=await js('JSON.stringify(d.drawings)');
      for(const ratio of ['0','0.236','0.382','0.5','0.618','0.786','1','1.618','2.618','3.618','4.236']) {
        const p=await levelPoint(ratio);await move(p);
        const state=await promptState();assert.equal(state.opacity,'1',theme+' '+ratio+' '+JSON.stringify(await js(`({point:${JSON.stringify(p)},target:document.elementFromPoint(${p.x},${p.y})?.outerHTML.slice(0,600),overlay:d.overlay.getAttribute('class'),pointer:d.hoverText.pointer,enabled:d.userDrawingEnabled,tool:d.activeTool})`)));
        assert.ok(state.center ? Math.hypot(state.y-p.y,state.x-p.cx)<24 : Math.abs(state.y-p.y)<1 && Math.abs(state.x-p.cx)<1,JSON.stringify({ratio,state,p}));
        if (!state.center) assert.equal(state.color,p.color);assert.equal(state.fill,'transparent');assert.equal(state.angle,0);
        await js('d.redraw()');await settle();const redrawn=await promptState();assert.ok(Math.abs(redrawn.y-p.y)<(redrawn.center?24:1),'redraw preserves the visible text action');
        report.fib.push({theme,selected,ratio});
      }
      await away();assert.equal(await js('JSON.stringify(d.drawings)'),before,'hover cannot mutate drawings');
    }
    await setup('fib-retracement',[1337,1294]);await move(await levelPoint('0.5'));await capture('fib-hover-'+theme);
    const state=await promptState();await click(state);
    assert.equal(await js(`d.horizontalLineSettings.open && document.querySelector('[data-line-tab="text"]').getAttribute('aria-selected')==='true'`),true);
    assert.equal(await js('d.dragState===null'),true);
    await js(`document.querySelector('.trading-horizontal-line-dialog [data-line-cancel]').click()`);await settle();await away();await capture('fib-away-'+theme);
  }
  await js(`document.documentElement.dataset.theme='light';workspace.applyChartTheme()`);
  const tools=await js(`api.TRADING_DRAWING_TOOLS.filter(t=>api.tradingDrawingSupportsSettings(t.id)).map(t=>t.id)`);
  for(const tool of tools) {
    await setup(tool,[1335,1305]);await away();
    const candidates=await js(`(()=>{const bounds=d.overlay.getBoundingClientRect();return [...d.content.querySelectorAll('.trading-drawing-geometry :is(line,polyline,polygon,rect,circle,ellipse,path)[stroke]')].filter(e=>getComputedStyle(e).stroke!=='none').flatMap(e=>{const length=e.getTotalLength(),m=e.getScreenCTM();return [.23,.61,.83,.02,.06,.1,.16,.33,.5,.7,.9].map(t=>{const p=e.getPointAtLength(length*t),v=new DOMPoint(p.x,p.y).matrixTransform(m);return {x:v.x,y:v.y}})}).filter(p=>p.x>bounds.left+4&&p.x<bounds.right-4&&p.y>bounds.top+15&&p.y<bounds.bottom-15)})()`);
    if(!candidates.length) candidates.push(...await js(`(()=>{const glyph=d.content.querySelector('.trading-drawing-geometry :is(text,path,polygon)[fill]');if(!glyph)return [];const r=glyph.getBoundingClientRect();return [{x:r.x+r.width/2,y:r.y+r.height/2}]})()`));
    let shown=false;
    for(const candidate of candidates) { await move(candidate); if((await promptState())?.opacity==='1'){shown=true;break;} }
    assert.equal(shown,true,'hover on '+tool+' ('+candidates.length+' stroke samples)');
    await away();report.tools.push(tool);
  }
  // Different edges/derived lines must move the action independently.
  for(const tool of ['parallel-channel','pitchfork','gann-box','rectangle','triangle','multi-point-polyline','circle','ellipse','arc','curve','double-curve','fib-speed-arcs']) {
    await setup(tool,[1338,1303]);
    if(['circle','fib-speed-arcs'].includes(tool)) { await js(`d.drawings[0].points=[{time:workspace.candles.at(-70).time,price:1325},{time:workspace.candles.at(-55).time,price:1315}];d.redraw()`);await settle(); }
    await js('d.selectDrawing(null)');await settle();
    const positions=await js(`(()=>{const bounds=d.overlay.getBoundingClientRect();return [...d.content.querySelectorAll('.trading-drawing-geometry :is(line,polyline,polygon,rect,circle,ellipse,path)[stroke]')].filter(e=>getComputedStyle(e).stroke!=='none').flatMap(e=>[.16,.46,.76].map(t=>{const p=e.getPointAtLength(e.getTotalLength()*t),v=new DOMPoint(p.x,p.y).matrixTransform(e.getScreenCTM());return {x:v.x,y:v.y}})).filter(p=>p.x>bounds.left+50&&p.x<bounds.right-50&&p.y>bounds.top+30&&p.y<bounds.bottom-30)})()`);
    const centers=[];
    for(const p of positions) { await away();await move(p);const s=await promptState();if(s?.opacity==='1')centers.push({x:s.x,y:s.y}); }
    assert.ok(centers.some(c=>Math.hypot(c.x-centers[0].x,c.y-centers[0].y)>10),tool+' must follow different strokes');
    report.curves.push(tool);
  }
  await setup('rectangle',[1338,1303]);
  const interior=await js(`(()=>{const r=d.content.querySelector('.trading-drawing-geometry rect').getBoundingClientRect();return {x:r.x+r.width*.3,y:r.y+r.height*.3}})()`);
  await move(interior);assert.equal((await promptState(true)).opacity,'0','shape interiors do not count as hovering a stroke');
  await setup('fib-retracement',[1337,1294]);await js('d.drawings[0].locked=true;d.redraw()');await move(await levelPoint('0.5'));assert.equal(await promptState(),null,'locked tool has no action');
  await js(`d.drawings[0].locked=false;d.selectTool('trend-line');d.redraw()`);await move(await levelPoint('0.5'));assert.equal((await promptState()).opacity,'0','drawing mode hides actions');
  await js(`d.selectTool('crosshair');d.setUserDrawingEnabled(false)`);await settle();assert.equal(await promptState(),null,'disabled drawing hides actions');
  assert.equal(await js('String(window.qaError??"")'),'');
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,fib:report.fib.length,tools:report.tools.length,curves:report.curves.length}));
  win.destroy();app.quit();
})().catch(async e=>{console.error(e);if(win&&!win.isDestroyed())fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());win?.destroy();app.exit(1)});
