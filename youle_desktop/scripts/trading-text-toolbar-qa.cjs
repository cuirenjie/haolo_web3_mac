// Real Chromium pointer/focus ordering, isolated profile and synthetic market data.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache/text-toolbar-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { checks: [] };
let win;
(async () => {
  setTimeout(() => app.exit(1), 180000).unref();
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { offscreen: true, backgroundThrottling: false } });
  // Hidden Electron windows otherwise update activeElement without dispatching
  // native focus/blur events. Exercise the same focus lifecycle as the app.
  const js = async code => {
    try { return await win.webContents.executeJavaScript(code, true); }
    catch (error) { throw new Error(error.message + '\n' + code.slice(0, 800)); }
  };
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(20); };
  const check = async (expression, label) => { assert.equal(await js(expression), true, label); report.checks.push(label); };
  const capture = async name => fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const input = async (type, point, extra = {}) => { win.webContents.sendInputEvent({ type, ...point, ...extra }); await settle(); };
  const click = async point => {
    await input('mouseMove', point);
    await input('mouseDown', point, { button: 'left', clickCount: 1 });
    await input('mouseUp', point, { button: 'left', clickCount: 1 });
  };
  const hit = selector => js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.checkVisibility());if(!e)throw Error('Missing visible '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();const p={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};if(!e.contains(document.elementFromPoint(p.x,p.y)))throw Error('Obscured '+${JSON.stringify(selector)});return p})()`);
  const clickElement = async selector => click(await hit(selector));
  const action = name => clickElement(`[data-drawing-selection-action="${name}"]`);
  const key = async (keyCode, modifiers = []) => {
    for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode, modifiers });
    await settle();
  };
  const type = async value => { await win.webContents.insertText(value); await settle(); };
  const load = async () => {
    await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5199}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
    if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    for (let i = 0; i < 120 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.ok(await js('Boolean(window.ready)'), await js('String(window.qaError)'));
    assert.equal(await js('document.hasFocus()'), true, 'native focus events enabled');
    await js(`window.d=workspace.drawingController;document.querySelector('#host').style.cssText='width:100%;height:100%';workspace.loadingHistory=true;
      clearInterval(workspace.pollTimer);clearInterval(workspace.candlePollTimer);workspace.closeSocket();workspace.cancelScheduledLiveChartPaint();void 0`);
    await settle();
  };
  const chartPoint = (x, y) => js(`(()=>{const r=d.chartElement.getBoundingClientRect();return {x:Math.round(r.x+${x}),y:Math.round(r.y+${y})}})()`);
  const fresh = async (text = '') => {
    await js(`d.finishHorizontalLineTextEdit(false);d.selectDrawing(null);d.drawings=[];d.redoStack=[];d.persistDrawings();d.magnetEnabled=false;d.selectTool('text')`);
    await click(await chartPoint(440, 300));
    await check('!!d.horizontalLineTextEdit && document.activeElement===d.horizontalLineTextEdit.input', 'new text editor focused');
    await js('window.editor=d.horizontalLineTextEdit.input');
    if (!process.argv.includes('--baseline')) await action('reset-text');
    if (text) await type(text);
  };
  const intact = async value => check(`d.drawings.length===1 && !d.selectionToolbar.hidden && d.horizontalLineTextEdit?.input===editor && editor.value===${JSON.stringify(value)}`, 'editor, draft and toolbar survive interaction');
  await load();
  if (process.argv.includes('--baseline')) {
    await fresh(); await action('toggle-bold');
    report.baseline = await js('({drawings:d.drawings.length,editing:!!d.horizontalLineTextEdit,toolbarHidden:d.selectionToolbar.hidden,bold:!!d.drawings[0]?.bold})');
    assert.deepEqual(report.baseline, { drawings: 0, editing: false, toolbarHidden: true, bold: false });
    await capture('baseline');
    fs.writeFileSync(path.join(output, 'baseline.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.baseline)); app.exit(0); return;
  }
  for (const theme of ['light', 'dark']) {
    console.log('Checking text toolbar: ' + theme);
    await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme()`);
    for (const value of ['', '正在输入中文 123']) {
      report.current = { theme, value };
      await fresh(value);
      await check(`!d.selectionToolbar.querySelector('[data-drawing-selection-action=edit-text]').checkVisibility()`, 'text toolbar has no pen button'); await intact(value);
      await check('document.activeElement===editor', 'text editor retains input focus without a pen button');
      await action('toggle-bold'); await intact(value);
      await check('d.drawings[0].bold && getComputedStyle(editor).fontWeight==="700" && document.activeElement===editor', 'bold applies without losing input focus');
      await action('toggle-font-size'); await intact(value);
      await clickElement('[data-drawing-font-size="28"]'); await intact(value);
      await check('d.drawings[0].fontSize===28 && getComputedStyle(editor).fontSize==="28px"', 'font size applies to active editor');
      await action('toggle-text-color'); await intact(value);
      await check('!!document.querySelector(".haolo-color-picker")', 'color picker opens on first click');
      await clickElement('[data-color-swatch="#f23645"]'); await intact(value);
      await check('d.drawings[0].color==="#f23645" && getComputedStyle(editor).color==="rgb(242, 54, 69)"', 'color palette applies to active editor');
      await clickElement('[data-color-add]'); await intact(value);
      await key('A', ['control']); await type('#123456');
      await clickElement('[data-color-save]'); await intact(value);
      await check('d.drawings[0].color==="#123456"', 'custom color input preserves draft');
      await key('Escape'); await intact(value);
      await action('toggle-text-background'); await intact(value);
      await clickElement('[data-color-swatch="#ffeb3b"]'); await intact(value);
      await clickElement('[data-color-percent]'); await key('A', ['control']); await type('100');
      await check('d.drawings[0].textBackgroundColor==="#ffeb3b"', 'background color applies');
      await key('Escape'); await clickElement('.trading-plain-text-input'); await key('End');
      await type('继续'); await intact(value + '继续');
      await capture(`${theme}-${value ? 'typed' : 'empty'}-styled`);
      await key('Enter');
      await check(`!d.horizontalLineTextEdit && !d.pendingTextDrawingId && d.drawings[0].text===${JSON.stringify(value + '继续')}`, 'Enter commits text after formatting');
    }
  }
  // Toolbar moves and redraws must retain the same native input/IME node.
  console.log('Checking focus, drag and edit lifecycle');
  await fresh('中文');
  await js(`editor.dispatchEvent(new CompositionEvent('compositionstart'));editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));d.redraw()`);
  await action('toggle-bold'); await intact('中文');
  await check('document.activeElement===editor', 'formatting preserves the composing input node');
  await js(`editor.dispatchEvent(new CompositionEvent('compositionend'))`);
  const grip = await hit('.trading-drawing-selection-grip');
  await input('mouseMove', grip); await input('mouseDown', grip, { button: 'left', clickCount: 1 });
  const moved = { x: grip.x + 60, y: grip.y + 40 };
  await input('mouseMove', moved, { modifiers: ['leftButtonDown'] });
  await input('mouseUp', moved, { button: 'left', clickCount: 1 }); await intact('中文');
  await check('!d.selectionToolbarDrag && document.activeElement===editor', 'toolbar drag preserves editing');
  await action('reset-text'); await intact('中文');
  await check('!d.drawings[0].bold && !d.drawings[0].fontSize && !d.drawings[0].textBackgroundColor', 'reset style preserves text');
  // Keyboard focus can move inside the toolbar/picker, but leaving the group commits.
  await js(`d.selectionToolbar.querySelector('[data-drawing-selection-action="toggle-bold"]').focus()`);
  await intact('中文'); await key('Space');
  await check('!!d.drawings[0].bold', 'keyboard toolbar activation applies');
  await js(`const outside=document.createElement('button');outside.id='qa-outside';outside.textContent='Outside';outside.style.cssText='position:fixed;right:0;bottom:0';document.body.append(outside);outside.focus()`);
  await check('!d.horizontalLineTextEdit && d.drawings[0].text==="中文"', 'focus leaving editor group commits');
  await fresh(); await action('toggle-bold'); await click(await chartPoint(900, 520));
  await check('!d.horizontalLineTextEdit && d.drawings.length===0', 'outside click still discards empty draft');
  await fresh('外部保存'); await action('toggle-text-color'); await clickElement('[data-color-swatch="#f23645"]');
  await click(await chartPoint(900, 520));
  await check('!d.horizontalLineTextEdit && !document.querySelector(".haolo-color-picker") && d.drawings[0].text==="外部保存"', 'outside click commits and closes picker');
  await clickElement('[data-inline-annotation]');
  await check('!!d.horizontalLineTextEdit && document.activeElement===d.horizontalLineTextEdit.input', 'clicking saved text reopens editing without a pen button');
  await type('取消'); await action('toggle-bold'); await key('Escape');
  await check('!d.horizontalLineTextEdit && d.drawings[0].text==="外部保存"', 'Escape restores existing text after formatting');
  await fresh('删除'); await action('delete');
  await check('!d.horizontalLineTextEdit && d.drawings.length===0', 'delete removes editor and drawing');
  await fresh('锁定保存'); await action('toggle-lock');
  await check('!d.horizontalLineTextEdit && d.drawings[0].locked && d.drawings[0].text==="锁定保存"', 'lock commits text before disabling edit');
  await fresh('隐藏保存'); await action('toggle-visibility');
  await check('!d.horizontalLineTextEdit && d.drawingVisibility.isHidden(d.drawings[0]) && d.drawings[0].text==="隐藏保存"', 'hide commits text before hiding drawing');
  // Other annotations and geometric labels share the same inline editing lifecycle.
  for (const tool of ['note', 'pin-note', 'table', 'callout', 'comment', 'signpost', 'trend-line']) {
    await fresh();
    await js(`(()=>{d.finishHorizontalLineTextEdit(false);d.selectTool('crosshair');const drawing={id:'qa-'+${JSON.stringify(tool)},tool:${JSON.stringify(tool)},symbol:d.getSymbol(),interval:d.getInterval(),drawingScope:'main',text:'旧文字',points:[d.screenToDrawingPoint({x:440,y:300},false),d.screenToDrawingPoint({x:650,y:380},false)]};d.drawings=[drawing];d.beginInlineTextEdit(drawing);window.editor=d.horizontalLineTextEdit.input})()`);
    await type('编辑');
    await action(tool === 'trend-line' ? 'toggle-color' : 'toggle-text-color');
    await clickElement('[data-color-swatch="#f23645"]'); await intact('旧文字编辑');
    await key('Escape'); await clickElement('.trading-horizontal-line-inline-input');
    if (tool === 'table') await click(await chartPoint(1000, 400));
    else await key('Enter');
    await check('!d.horizontalLineTextEdit && d.drawings[0].text.startsWith("旧文字编辑")', tool + ' formatting and commit');
  }
  await fresh('重载保留'); await action('toggle-bold'); await action('toggle-font-size'); await clickElement('[data-drawing-font-size="28"]'); await key('Enter');
  const persisted = `JSON.stringify((({id,tool,symbol,interval,points,text,color,textBackgroundColor,fontSize,bold})=>({id,tool,symbol,interval,points,text,color,textBackgroundColor,fontSize,bold}))(d.drawings[0]))`;
  const saved = await js(persisted);
  await load(); await check(`${persisted}===${JSON.stringify(saved)}`, 'text and formatting survive reload');
  delete report.current; report.result = 'PASS';
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: report.result, checks: report.checks.length, output })); app.exit(0);
})().catch(async error => {
  report.error = error.stack;
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (win) {
    report.state = await win.webContents.executeJavaScript(`({drawing:d.drawings[0],editing:!!d.horizontalLineTextEdit,active:document.activeElement.outerHTML.slice(0,400),menu:d.activeSelectionMenu})`).catch(() => null);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
  }
  console.error(error.stack); app.exit(1);
});
