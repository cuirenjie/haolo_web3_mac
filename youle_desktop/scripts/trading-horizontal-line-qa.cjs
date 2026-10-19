// Native pointer input against an isolated renderer with synthetic market data.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'horizontal-line-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1304, height: 880, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => { await js('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))'); await pause(50); };
  const capture = async name => fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const click = async (selector, count = 1, horizontalFraction = 0.5) => {
    const p = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing target');const b=e.getBoundingClientRect();return {x:Math.round(b.x+b.width*${horizontalFraction}),y:Math.round(b.y+b.height/2)}})()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...p });
    win.webContents.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: count });
    win.webContents.sendInputEvent({ type: 'mouseUp', ...p, button: 'left', clickCount: count });
    await settle();
  };
  const load = async () => {
    await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5194}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
    for (let i = 0; i < 120 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
    await js(`(async()=>{document.querySelector('#host').style.cssText='width:100%;height:100%';window.d=workspace.drawingController;workspace.loadingHistory=true;window.lang=await import('/app-language.mjs');lang.observeAppLanguage(document.body)})()`);
    await settle();
  };
  await load();
  await js(`d.drawings=[{id:'horizontal-qa',tool:'horizontal-line',symbol:d.getSymbol(),interval:d.getInterval(),points:[{time:workspace.candles.at(-50).time,price:1330}]}];d.selectTool('crosshair');d.selectDrawing('horizontal-qa')`);
  await settle();
  // Hover is presentational: it must not select, move, or persist a line.
  const addTextSelector = '[data-horizontal-line-add-text="horizontal-qa"]';
  const hoverLine = async () => {
    const p = await js(`(()=>{const r=d.content.querySelector('[data-drawing-id="horizontal-qa"] .trading-drawing-hit-target').getBoundingClientRect();return {x:Math.round(r.x+r.width*.2),y:Math.round(r.y+r.height/2)}})()`);
    win.webContents.sendInputEvent({type:'mouseMove',...p}); await settle();
  };
  const addTextOpacity = () => js(`getComputedStyle(document.querySelector('${addTextSelector}')).opacity`);
  const expectTextEntry = async () => {
    assert.equal(await js(`document.querySelector('[data-line-tab="text"]').getAttribute('aria-selected')`), 'true');
    assert.equal(await js(`document.activeElement===document.querySelector('.trading-horizontal-line-dialog textarea')`), true);
    assert.equal(await js('d.pointerId===null&&d.dragState===null'), true, 'text click cannot start a drag');
  };
  for (const language of ['zh-CN', 'en', 'zh-TW']) {
    for (const theme of ['light', 'dark']) {
      await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();lang.applyAppLanguage('${language}',{root:document.body});d.selectDrawing(null)`);
      win.webContents.sendInputEvent({type:'mouseMove',x:100,y:60}); await settle();
      assert.equal(await addTextOpacity(), '0', 'prompt hidden away from line');
      const beforeHover = await js('JSON.stringify(d.drawings)');
      await hoverLine();
      assert.equal(await addTextOpacity(), '1', 'hover reveals centered action');
      assert.equal(await js('d.selectedDrawingId'), null, 'hover does not select');
      assert.equal(await js('JSON.stringify(d.drawings)'), beforeHover);
      const centered = await js(`(()=>{const a=document.querySelector('${addTextSelector}').getBoundingClientRect(),l=d.content.querySelector('[data-drawing-id="horizontal-qa"] .trading-drawing-hit-target').getBoundingClientRect();return Math.abs(a.x+a.width/2-l.x-l.width/2)<1})()`);
      assert.equal(centered, true);
      if (language === 'en') assert.equal(await js(`document.querySelector('${addTextSelector} text').textContent`), '+ Add text');
      await js('d.redraw()'); await settle(); assert.equal(await addTextOpacity(), '1', 'redraw retains hover');
      if (language === 'zh-CN') await capture(`add-text-hover-${theme}`);
      await click(addTextSelector); await expectTextEntry();
      assert.equal(await js('JSON.stringify(d.drawings)'), beforeHover, 'opening does not change line');
      if (language === 'zh-CN') await capture(`add-text-dialog-${theme}`);
      await js(`document.querySelector('[name="text"]').value='discard hover draft'`);
      await click('.trading-horizontal-line-dialog footer [data-line-cancel]');
      assert.equal(await js('JSON.stringify(d.drawings)'), beforeHover, 'Cancel does not save hover draft');
    }
  }
  // Keyboard users can reach the same action without a mouse hover.
  for (const keyCode of ['Enter', 'Space']) {
    await js(`document.querySelector('${addTextSelector}').focus()`); await settle();
    assert.equal(await addTextOpacity(), '1', await js(`JSON.stringify({active:document.activeElement?.outerHTML,focused:document.querySelector('${addTextSelector}').matches(':focus'),within:document.querySelector('${addTextSelector}').matches(':focus-within'),layer:d.overlay.className.baseVal})`));
    win.webContents.sendInputEvent({type:'keyDown',keyCode});
    win.webContents.sendInputEvent({type:'keyUp',keyCode}); await settle(); await expectTextEntry();
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'}); await settle();
    assert.equal(await js('d.horizontalLineSettings.open'), false);
  }
  await hoverLine(); await click(addTextSelector);
  await js(`document.querySelector('[name="text"]').value='我知道'`);
  await click('.trading-horizontal-line-dialog [type="submit"]');
  assert.equal(await js(`Boolean(document.querySelector('${addTextSelector}'))`), false, 'authored text replaces the add action');
  assert.equal(await js('d.drawings[0].textVerticalAlign'), 'middle');
  await load();
  assert.equal(await js('d.drawings[0].text'), '我知道', 'text added through hover survives reload');
  // Existing labels edit in place. The native input survives chart redraws and
  // keeps its draft separate from the stored drawing until Enter or blur.
  const editLabel = '[data-horizontal-line-edit-text="horizontal-qa"]';
  const inlineInput = '.trading-horizontal-line-inline-input';
  const key = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});
    if (keyCode==='Enter' && modifiers.includes('shift')) win.webContents.sendInputEvent({type:'char',keyCode:'\r',modifiers});
    win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers}); await settle();
  };
  const typeInline = async text => {
    await js(`document.querySelector('${inlineInput}').select()`);
    await win.webContents.insertText(text); await settle();
  };
  await js(`document.documentElement.dataset.theme='light';workspace.applyChartTheme();lang.applyAppLanguage('zh-CN',{root:document.body});d.selectDrawing(null)`); await settle();
  const originalPoint = await js('JSON.stringify(d.drawings[0].points)');
  await click(editLabel);
  assert.equal(await js(`document.activeElement.matches('${inlineInput}') && !d.horizontalLineSettings.open && !d.dragState && d.pointerId===null`), true);
  assert.equal(await js('JSON.stringify(d.drawings[0].points)'), originalPoint, 'single click cannot move the line');
  await typeInline('这里可以打字');
  await js(`window.inlineNode=document.activeElement;inlineNode.setSelectionRange(2,2);d.redraw()`); await settle();
  assert.equal(await js('document.activeElement===inlineNode && inlineNode.selectionStart===2'), true, 'redraw preserves the native node and caret');
  assert.equal(await js('d.drawings[0].text'), '我知道', 'typing does not persist a partial draft');
  const inlinePosition = await js(`(()=>{const r=inlineNode.getBoundingClientRect(),l=d.content.querySelector('.trading-drawing-hit-target:not(.area)').getBoundingClientRect(),s=getComputedStyle(inlineNode);return {center:Math.abs(r.x+r.width/2-l.x-l.width/2)<1,middle:Math.abs(r.y+r.height/2-l.y-l.height/2)<1,border:s.borderTopWidth,outline:s.outlineStyle,shadow:s.boxShadow}})()`);
  assert.deepEqual(inlinePosition, {center:true,middle:true,border:'0px',outline:'none',shadow:'none'});
  await js(`inlineNode.setSelectionRange(inlineNode.value.length,inlineNode.value.length)`);
  await capture('inline-edit-light');
  // IME confirmation must not save or consume the composition's Enter/Escape.
  await js(`inlineNode.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));inlineNode.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,isComposing:true}));inlineNode.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
  assert.equal(await js('document.activeElement===inlineNode && Boolean(d.horizontalLineTextEdit)'), true);
  await js(`inlineNode.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))`);
  await key('Enter');
  assert.equal(await js('d.drawings[0].text'), '这里可以打字');
  await load(); assert.equal(await js('d.drawings[0].text'), '这里可以打字', 'inline edit survives reload');
  for (const language of ['zh-CN','en','zh-TW']) {
    for (const theme of ['light','dark']) {
      await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();lang.applyAppLanguage('${language}',{root:document.body})`); await settle();
      await click(editLabel); await typeInline('修改中的文字');
      if (theme==='dark') assert.notEqual(await js(`getComputedStyle(document.querySelector('${inlineInput}')).backgroundColor`), 'rgb(255, 255, 255)');
      if (language==='zh-CN' && theme==='dark') await capture('inline-edit-dark');
      await key('Escape');
      assert.equal(await js('d.drawings[0].text'), '这里可以打字', 'Escape discards the draft in every locale/theme');
      assert.equal(await js(`Boolean(document.querySelector('${inlineInput}'))`), false);
    }
  }
  // Blur commits, Shift+Enter inserts a line break, and clearing the label
  // restores the original hover-to-add route rather than deleting the line.
  await click(editLabel); await typeInline('失焦保存');
  await click('[data-horizontal-line-settings]');
  assert.equal(await js('d.drawings[0].text'), '失焦保存');
  assert.equal(await js(`document.querySelector('.trading-horizontal-line-dialog textarea').value`), '失焦保存');
  await key('Escape');
  await click(editLabel); await key('Enter',['shift']); await win.webContents.insertText('第二行'); await settle();
  assert.equal(await js(`document.querySelector('${inlineInput}').value`), '失焦保存\n第二行');
  await key('Enter'); assert.equal(await js('d.drawings[0].text'), '失焦保存\n第二行');
  await click(editLabel); await typeInline(''); await key('Enter');
  assert.equal(await js('d.drawings[0].text'), '');
  assert.equal(await js(`Boolean(document.querySelector('${addTextSelector}'))`), true);
  await js(`d.drawings[0].text='我知道';d.redraw()`); await settle();
  // Disabled tools and changed market/session contexts must never save stale drafts.
  await click(editLabel); await typeInline('discard disabled'); await js('d.setUserDrawingEnabled(false)'); await settle();
  assert.equal(await js(`Boolean(document.querySelector('${inlineInput}'))`), false);
  assert.equal(await js('d.drawings[0].text'), '我知道');
  await js('d.setUserDrawingEnabled(true)'); await settle();
  await click(editLabel); await typeInline('discard old market');
  await js(`window.originalSymbol=d.getSymbol;d.getSymbol=()=> 'OTHER:MARKET';d.redraw();d.getSymbol=originalSymbol;d.redraw()`); await settle();
  assert.equal(await js(`Boolean(document.querySelector('${inlineInput}'))`), false);
  assert.equal(await js('d.drawings[0].text'), '我知道');
  for (const textAlign of ['left','center','right']) {
    await js(`Object.assign(d.drawings[0],{textAlign:'${textAlign}',textVerticalAlign:'middle',fontSize:20,bold:true,italic:true,textColor:'#ef5350'});d.redraw()`); await settle();
    await click(editLabel);
    const appearance=await js(`(()=>{const e=document.querySelector('${inlineInput}'),s=getComputedStyle(e),r=e.getBoundingClientRect(),b=d.overlay.getBoundingClientRect();return {align:s.textAlign,size:s.fontSize,weight:s.fontWeight,style:s.fontStyle,color:s.color,inside:r.left>=b.left&&r.right<=b.right}})()`);
    assert.deepEqual(appearance,{align:textAlign,size:'20px',weight:'700',style:'italic',color:'rgb(239, 83, 80)',inside:true});
    await key('Escape');
  }
  await js(`d.drawings[0].text=' ';d.drawings[0].locked=true;d.redraw()`); await settle();
  assert.equal(await js(`Boolean(document.querySelector('${addTextSelector}'))`), false, 'locked line has no add action');
  await js(`d.drawings[0].locked=false;d.selectTool('trend-line')`); await hoverLine();
  assert.equal(await addTextOpacity(), '0', 'drawing mode does not expose the action');
  await js(`d.selectTool('crosshair');d.setUserDrawingEnabled(false)`); await settle();
  assert.equal(await js(`Boolean(document.querySelector('${addTextSelector}'))`), false);
  await js(`d.setUserDrawingEnabled(true)`); await hoverLine(); assert.equal(await addTextOpacity(), '1');
  // Resume the existing settings regression from a clean horizontal line.
  await js(`document.documentElement.dataset.theme='light';workspace.applyChartTheme();lang.applyAppLanguage('zh-CN',{root:document.body});d.drawings=[{id:'horizontal-qa',tool:'horizontal-line',symbol:d.getSymbol(),interval:d.getInterval(),points:[{time:workspace.candles.at(-50).time,price:1330}]}];d.selectDrawing('horizontal-qa')`);
  await settle();
  // Both input routes must open the same real modal, including after SVG redraws.
  await click('[data-horizontal-line-settings]');
  assert.equal(await js('d.horizontalLineSettings.open'), true);
  await capture('style-light');
  await click('[data-line-tab="text"]');
  await js(`(()=>{const f=document.querySelector('.trading-horizontal-line-dialog form');f.elements.text.value='支撑位 Support';f.elements.textColor.value='#ef5350';f.elements.fontSize.value='24';f.elements.textAlign.value='right';f.elements.textVerticalAlign.value='middle'})()`);
  await click('[data-line-toggle="bold"]');
  await click('[data-line-toggle="italic"]');
  await capture('text-light');
  await click('[data-line-tab="coordinates"]');
  await js(`document.querySelector('[name="price"]').value='1335.25'`);
  await capture('coordinates-light');
  await click('.trading-horizontal-line-dialog [type="submit"]');
  assert.equal(await js('d.drawings[0].points[0].price'), 1335.25);
  assert.equal(await js('d.drawings[0].textAlign'), 'right');
  assert.equal(await js(`d.content.querySelector('.trading-horizontal-line-text').getAttribute('fill')`), '#ef5350');
  await capture('line-right');
  await click('[data-drawing-id="horizontal-qa"] .trading-drawing-hit-target:not(.area)', 2, 0.2);
  assert.equal(await js('d.horizontalLineSettings.open'), true, 'double click on line opens settings');
  const before = await js('JSON.stringify(d.drawings[0])');
  await js(`document.querySelector('[name="text"]').value='discard me';document.querySelector('[name="price"]').value='999'`);
  await click('.trading-horizontal-line-dialog footer [data-line-cancel]');
  assert.equal(await js('JSON.stringify(d.drawings[0])'), before, 'Cancel preserves every field');
  await click('[data-horizontal-line-settings]');
  assert.equal(await js('d.horizontalLineSettings.open'), true, 'toolbar still opens the full settings');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await settle();
  assert.equal(await js('d.horizontalLineSettings.open'), false);
  assert.equal(await js('JSON.stringify(d.drawings[0])'), before, 'Escape preserves every field');
  // Alignment, label visibility and persistence are verified through the form.
  for (const alignment of ['left', 'center', 'right']) {
    await click('[data-horizontal-line-settings]');
    await click('[data-line-tab="text"]');
    await js(`document.querySelector('[name="textAlign"]').value='${alignment}'`);
    await click('.trading-horizontal-line-dialog [type="submit"]');
    assert.equal(await js(`d.content.querySelector('.trading-horizontal-line-text').getAttribute('text-anchor')`), { left: 'start', center: 'middle', right: 'end' }[alignment]);
  }
  await click('[data-horizontal-line-settings]');
  await click('[name="showPriceLabel"]');
  await click('.trading-horizontal-line-dialog [type="submit"]');
  assert.equal(await js('d.axisMarkerLayer.children.length'), 0);
  await load();
  assert.equal(await js('d.drawings[0].text'), '支撑位 Support');
  assert.equal(await js('d.drawings[0].showPriceLabel'), false);
  assert.equal(await js('d.drawings[0].textColor'), '#ef5350');
  assert.equal(await js('d.drawings[0].italic'), true);
  assert.equal(await js('d.drawings[0].fontSize'), 24);
  await js(`d.selectDrawing(null)`); await settle();
  const paneHeights = await js('d.getChart().panes().map(p=>p.getHeight())');
  await click('[data-drawing-id="horizontal-qa"] .trading-drawing-hit-target:not(.area)', 1, 0.2);
  await click('[data-drawing-id="horizontal-qa"] .trading-drawing-hit-target:not(.area)', 2, 0.2);
  assert.equal(await js('d.horizontalLineSettings.open'), true, 'unselected line also opens with two clicks');
  assert.deepEqual(await js('d.getChart().panes().map(p=>p.getHeight())'), paneHeights, 'editing does not maximize chart panes');
  await click('.trading-horizontal-line-dialog footer [data-line-cancel]');
  for (const language of ['zh-CN', 'en', 'zh-TW']) {
    for (const theme of ['light', 'dark']) {
      await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();lang.applyAppLanguage('${language}',{root:document.body})`);
      await click('[data-horizontal-line-settings]');
      await click('[data-line-tab="text"]');
      const state = await js(`(()=>{const e=document.querySelector('.trading-horizontal-line-dialog');return {background:getComputedStyle(e).backgroundColor,fields:[...e.querySelectorAll('input,textarea,select')].map(f=>({background:getComputedStyle(f).backgroundColor,color:getComputedStyle(f).color})),text:e.innerText,width:e.scrollWidth,clientWidth:e.clientWidth,value:e.querySelector('textarea').value}})()`);
      assert.equal(state.width, state.clientWidth, 'dialog has no horizontal overflow');
      assert.equal(state.value, '支撑位 Support', 'authored text is never translated');
      if (language === 'en') assert.doesNotMatch(state.text, /[\u4e00-\u9fff]/);
      if (theme === 'dark') {
        assert.notEqual(state.background, 'rgb(255, 255, 255)');
        for (const field of state.fields) {
          assert.ok(Number(field.background.match(/\d+/)[0]) < 100, 'dark fields must have a dark background');
          assert.ok(Number(field.color.match(/\d+/)[0]) > 150, 'dark fields must have readable text');
        }
      }
      await capture(`text-${language}-${theme}`);
      await click('.trading-horizontal-line-dialog footer [data-line-cancel]');
    }
  }
  // Empty labels are valid, invalid prices are not, other lines share settings.
  await click('[data-horizontal-line-settings]');
  await js(`document.querySelector('[name="price"]').value='';document.querySelector('.trading-horizontal-line-dialog form').requestSubmit()`);
  assert.equal(await js('d.horizontalLineSettings.open'), true);
  await js(`document.querySelector('[name="price"]').value='1335.25';document.querySelector('[name="text"]').value='';document.querySelector('.trading-horizontal-line-dialog form').requestSubmit()`);
  await settle();
  assert.equal(await js(`Boolean(d.content.querySelector('.trading-horizontal-line-text'))`), false);
  await js(`d.drawings[0].tool='trend-line';d.drawings[0].points.push({...d.drawings[0].points[0],time:d.drawings[0].points[0].time+3600});d.redraw()`); await settle();
  assert.equal(await js(`d.selectionToolbar.querySelector('[data-horizontal-line-settings]').hidden`), false);
  assert.equal(await js('String(window.qaError || "")'), '');
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ result: 'PASS', routes: ['hover add text', 'keyboard add text', 'inline label edit', 'toolbar', 'line double click'], inline: ['Enter/blur save','Escape cancel','IME confirmation','redraw caret','multiline','clear label','context cleanup','appearance'], hoverWithoutMutation: true, textTabAndFocus: true, lockedAndDrawingModes: true, locales: ['zh-CN','en','zh-TW'], themes: ['light','dark'], persistence: true, cancelAndEscape: true, alignment: ['left','center','right'] }, null, 2));
  console.log('PASS: inline edit, IME, redraw/caret, Enter/blur/Escape, hover/keyboard add text, settings, double click, reload, three locales and two themes');
  win.destroy(); app.quit();
})().catch(error => { console.error(error); fs.writeFileSync(path.join(output, 'failure.txt'), String(error.stack)); win?.destroy(); app.exit(1); });
