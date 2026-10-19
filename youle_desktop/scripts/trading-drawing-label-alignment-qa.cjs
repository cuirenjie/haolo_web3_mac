// Isolated chart fixture: native text entry plus raster checks of actual SVG gaps.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/drawing-label-alignment-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile')); app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(30); };
  const move = async point => { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(point.x), y: Math.round(point.y) }); await settle(); };
  const click = async selector => {
    const p = await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await move(p);
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1 });
    await settle();
  };
  const capture = async name => fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const load = async () => {
    await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5183}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
    for (let i = 0; i < 120 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true);
    await js(`(async()=>{window.d=workspace.drawingController;window.api=await import('/trading-expert-drawing.ts');workspace.loadingHistory=true;document.querySelector('#host').style.cssText='width:100%;height:100%';d.selectTool('crosshair')})()`); await settle();
  };
  const setup = async (rising = false, reversed = false, text = '') => {
    await move({ x: 20, y: 20 });
    await js(`d.selectDrawing(null);d.drawings=[{id:'alignment',tool:'trend-line',symbol:d.getSymbol(),interval:d.getInterval(),points:[{time:workspace.candles.at(-100).time,price:${rising ? 1305 : 1335}},{time:workspace.candles.at(-40).time,price:${rising ? 1335 : 1305}}]${reversed ? '.reverse()' : ''},text:${JSON.stringify(text)}}];d.selectDrawing('alignment');d.redraw()`); await settle();
  };
  const field = async (name, value) => js(`(()=>{const e=document.querySelector('.trading-horizontal-line-dialog [name="${name}"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  const geometry = () => js(`(()=>{const v=d.drawings[0];return api.tradingDrawingLabelGeometry(v,v.points.map(p=>d.pointToScreen(p)),d.plotBounds())})()`);
  await load(); await setup();
  const mid = await js(`(()=>{const r=d.overlay.getBoundingClientRect(),p=d.drawings[0].points.map(p=>d.pointToScreen(p));return {x:r.x+(p[0].x+p[1].x)/2,y:r.y+(p[0].y+p[1].y)/2}})()`);
  await move(mid);
  const prompt = await js(`(()=>{const e=d.content.querySelector('[data-horizontal-line-add-text]'),r=e.querySelector('text').getBoundingClientRect(),b=e.querySelector('text').getBBox();return {opacity:getComputedStyle(e).opacity,bottom:b.y+b.height,x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  assert.equal(prompt.opacity, '1'); assert.ok(prompt.bottom < -3, 'add-text glyphs stay above the local stroke');
  // Traverse the space between line and glyphs, then redraw while over the text.
  for (let i = 1; i <= 8; i++) await move({ x: mid.x + (prompt.x - mid.x) * i / 8, y: mid.y + (prompt.y - mid.y) * i / 8 });
  await js('d.redraw()'); await settle();
  assert.equal(await js(`getComputedStyle(d.content.querySelector('[data-horizontal-line-add-text]')).opacity`), '1');
  await capture('add-text-above');
  await click('[data-horizontal-line-add-text] text');
  assert.equal(await js('d.horizontalLineSettings.open'), true);
  assert.deepEqual(await js(`[document.querySelector('[name="textVerticalAlign"]').value,document.querySelector('[name="textAlign"]').value]`), ['top', 'center']);
  assert.deepEqual(await js(`[...document.querySelector('[name="textAlign"]').options].map(o=>o.textContent)`), ['左', '中心', '右']);
  await win.webContents.insertText('趋势线文字'); await click('.trading-horizontal-line-dialog [type="submit"]');
  assert.equal((await geometry()).vertical, 'top'); await capture('default-top-center');
  await click('[data-horizontal-line-edit-text]');
  assert.equal(await js(`document.activeElement.matches('.trading-horizontal-line-inline-input')`), true);
  assert.ok(await js(`(()=>{const e=document.activeElement,g=api.tradingDrawingLabelGeometry(d.drawings[0],d.drawings[0].points.map(p=>d.pointToScreen(p)),d.plotBounds());return parseFloat(e.style.top)+parseFloat(e.style.height)<g.y})()`));
  await js('document.activeElement.select()'); await win.webContents.insertText('上方文字已编辑');
  for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: 'Enter' }); await settle();
  assert.equal(await js('d.drawings[0].text'), '上方文字已编辑');

  // Check a standalone raster of the *rendered* masked geometry. It must have
  // no stroke alpha through the label and retain the stroke on both sides.
  const checkGap = () => js(`(async()=>{
    const group=d.content.querySelector('[data-drawing-id="alignment"]'),label=group.querySelector('.trading-horizontal-line-text'),mask=group.querySelector('mask');
    if(!mask)throw Error('Missing gap mask');
    const hole=mask.lastElementChild,b=label.getBBox();
    const x=+hole.getAttribute('x'),y=+hole.getAttribute('y'),w=+hole.getAttribute('width'),h=+hole.getAttribute('height');
    // SVG getBBox uses float32 coordinates; allow subpixel round-off only.
    if(b.x<x-.01||b.x+b.width>x+w+.01||b.y<y-.01||b.y+b.height>y+h+.01)throw Error('Gap does not cover rendered glyph bounds: '+JSON.stringify({glyph:{x:b.x,y:b.y,width:b.width,height:b.height},gap:{x,y,w,h},drawing:d.drawings[0]}));
    const bounds=d.plotBounds(),g=api.tradingDrawingLabelGeometry(d.drawings[0],d.drawings[0].points.map(p=>d.pointToScreen(p)),bounds);
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width',String(bounds.width));svg.setAttribute('height',String(bounds.height));
    svg.append(group.querySelector('defs').cloneNode(true),group.querySelector('.trading-drawing-geometry').cloneNode(true));
    const raster=async()=>{const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg));await image.decode();const c=document.createElement('canvas');c.width=Math.ceil(bounds.width);c.height=Math.ceil(bounds.height);const ctx=c.getContext('2d');ctx.drawImage(image,0,0);return ctx};
    const masked=await raster();svg.querySelector('[mask]').removeAttribute('mask');const unmasked=await raster();
    const a=g.angle*Math.PI/180;
    const alpha=(ctx,localX)=>{const px=g.x+(localX-g.x)*Math.cos(a),py=g.y+(localX-g.x)*Math.sin(a);const data=ctx.getImageData(Math.round(px)-1,Math.round(py)-1,3,3).data;return Math.max(...Array.from({length:9},(_,i)=>data[i*4+3]))};
    for(const t of [.15,.35,.5,.65,.85]){const p=x+w*t;if(alpha(unmasked,p)<20)throw Error('Raster control misses stroke');if(alpha(masked,p)!==0)throw Error('Stroke crosses text gap')}
    // Center alignment has a visible stroke on both sides; endpoint labels
    // may extend their padding beyond the end of a short segment.
    if(d.drawings[0].textAlign==='center')for(const p of [x-6,x+w+6])if(alpha(masked,p)<20)throw Error('Gap removes adjacent stroke');
    return true;
  })()`);
  let cases = 0, gaps = 0;
  for (const theme of ['light', 'dark']) for (const rising of [false, true]) for (const reversed of [false, true]) {
    await setup(rising, reversed, '趋势线 ABC Support');
    await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();d.redraw()`); await settle();
    for (const vertical of ['top', 'middle', 'bottom']) for (const horizontal of ['left', 'center', 'right']) {
      await click('[data-horizontal-line-settings]'); await click('[data-line-tab="text"]');
      await field('textVerticalAlign', vertical); await field('textAlign', horizontal); await field('fontSize', '20');
      await click('.trading-horizontal-line-dialog [type="submit"]');
      const g = await geometry(); assert.equal(g.vertical, vertical);
      if (vertical === 'top') assert.ok(g.top + g.layout.height < g.y);
      if (vertical === 'bottom') assert.ok(g.top > g.y);
      if (vertical === 'middle') { assert.ok(Math.abs(g.top + g.layout.height / 2 - g.y) < 1e-8); assert.equal(await checkGap(), true); gaps++; }
      else assert.equal(await js(`!!d.content.querySelector('mask')`), false);
      if (!rising && !reversed && horizontal === 'center') await capture(vertical + '-center-' + theme);
      cases++;
    }
  }
  // Longer, bold italic and multiline glyphs must also fit the gap.
  await setup(false, false, 'WWW 强调趋势线\nSupport ABCDEF');
  await js(`Object.assign(d.drawings[0],{textVerticalAlign:'middle',textAlign:'center',fontSize:28,bold:true,italic:true});d.redraw()`); await settle();
  assert.equal(await checkGap(), true); gaps++; await capture('middle-multiline-dark');
  await js('d.persistDrawings()'); const saved = await js('d.drawings[0]'); await load();
  const restored = await js('d.drawings[0]');
  for (const key of Object.keys(saved)) assert.deepEqual(restored[key], saved[key], 'reload ' + key);
  assert.equal(await checkGap(), true);
  assert.equal(await js('String(window.qaError??"")'), '');
  const report = { result: 'PASS', alignmentCases: cases, rasterGapCases: gaps + 1, defaultTopCenter: true, hoverBridge: true, nativeInline: true, persistence: true };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  win.destroy(); app.quit();
})().catch(async error => { console.error(error); fs.writeFileSync(path.join(output, 'failure.txt'), String(error.stack)); if (win && !win.isDestroyed()) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG()); win?.destroy(); app.exit(1); });
