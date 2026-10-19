const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/drawing-label-angle-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile')); app.disableHardwareAcceleration();
const pause = ms => new Promise(r => setTimeout(r, ms));
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show:false, width:1400, height:950, webPreferences:{ offscreen:true, backgroundThrottling:false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(40); };
  const capture = async name => fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
  const pointer = async (type,p,extra={}) => { win.webContents.sendInputEvent({type,x:Math.round(p.x),y:Math.round(p.y),...extra}); await settle(); };
  const click = async selector => {
    const p=await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await pointer('mouseMove',p);await pointer('mouseDown',p,{button:'left',clickCount:1});await pointer('mouseUp',p,{button:'left',clickCount:1});
  };
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT||5196}/@fs/${path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/')}`);
  for(let i=0;i<120&&!await js('Boolean(window.ready)');i++)await pause(100);
  assert.equal(await js('Boolean(window.ready)'),true);
  await js(`window.d=workspace.drawingController;workspace.loadingHistory=true;document.querySelector('#host').style.cssText='width:100%;height:100%';d.selectTool('crosshair')`);await settle();
  const state=()=>js(`(()=>{const drawing=d.drawings[0],p=drawing.points.map(p=>d.pointToScreen(p)),el=d.content.querySelector('.trading-horizontal-line-text'),m=el?.getScreenCTM(),input=document.querySelector('.trading-horizontal-line-inline-input');let expected=Math.atan2(p[1].y-p[0].y,p[1].x-p[0].x)*180/Math.PI;if(expected>90)expected-=180;if(expected<-90)expected+=180;const matrix=input?new DOMMatrix(getComputedStyle(input).transform):null;return {expected,actual:m?Math.atan2(m.b,m.a)*180/Math.PI:null,input:matrix?Math.atan2(matrix.b,matrix.a)*180/Math.PI:null}})()`);
  const verify = async (editing=false) => {const v=await state();assert.ok(Math.abs((editing?v.input:v.actual)-v.expected)<(editing?1e-4:1e-6),JSON.stringify(v));return v;};
  const cases=[];
  for(const tool of ['trend-line','ray','extended-line','arrow','parallel-channel','arrow-marker']) for(const reversed of [false,true]) {
    await js(`d.drawings=[{id:'angle',tool:'${tool}',symbol:d.getSymbol(),interval:d.getInterval(),points:[{time:workspace.candles.at(-100).time,price:1342},{time:workspace.candles.at(-40).time,price:1310}]${reversed?'.reverse()':''},text:'文字与画线同角度',fontSize:20}];d.selectDrawing('angle');d.redraw()`);await settle();
    for(const textAlign of ['left','center','right'])for(const textVerticalAlign of ['top','middle','bottom']) {
      await js(`Object.assign(d.drawings[0],{textAlign:'${textAlign}',textVerticalAlign:'${textVerticalAlign}'});d.redraw()`);await settle();await verify();
      cases.push([tool,reversed,textAlign,textVerticalAlign]);
    }
  }
  await js(`Object.assign(d.drawings[0],{tool:'trend-line',textAlign:'center',textVerticalAlign:'middle'});d.redraw()`);await settle();
  const before=await verify();
  await js(`const range=d.getChart().timeScale().getVisibleLogicalRange();d.getChart().timeScale().setVisibleLogicalRange({from:range.from+20,to:range.to-10});d.redraw()`);await settle();
  const zoomed=await verify();assert.ok(Math.abs(before.actual-zoomed.actual)>.1,'zoom must change the displayed angle');
  for(const theme of ['light','dark']) {
    await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();d.redraw()`);await settle();await verify();await capture('label-'+theme);
    await click('[data-horizontal-line-edit-text="angle"]');
    assert.equal(await js(`document.activeElement.matches('.trading-horizontal-line-inline-input')`),true);await verify(true);
    await js('document.activeElement.select()');await win.webContents.insertText('同角度直接编辑');await settle();await verify(true);await capture('inline-'+theme);
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});await settle();await verify();
  }
  await js(`d.selectDrawing('angle');d.redraw()`);await settle();
  const endpoint=await js(`(()=>{const r=document.querySelector('[data-drawing-handle-index="1"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const old=await verify();await pointer('mouseMove',endpoint);await pointer('mouseDown',endpoint,{button:'left',clickCount:1});
  const moved={x:endpoint.x+70,y:endpoint.y+80};await pointer('mouseMove',moved,{button:'left',modifiers:['leftButtonDown']});await pointer('mouseUp',moved,{button:'left',clickCount:1});
  const updated=await verify();assert.ok(Math.abs(updated.actual-old.actual)>.1,'endpoint dragging updates rotation');
  await capture('endpoint-updated');
  assert.equal(await js('String(window.qaError??"")'),'');
  const report={result:'PASS',rotationCases:cases.length,zoom:true,nativeInline:true,nativeEndpointDrag:true,themes:['light','dark']};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));win.destroy();app.quit();
})().catch(async e=>{console.error(e);if(win&&!win.isDestroyed())fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());win?.destroy();app.exit(1)});
