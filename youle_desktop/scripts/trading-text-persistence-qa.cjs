// Exercise idle editing with real Chromium focus and the production sync controller.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache/text-persistence-qa');
const baseline = process.argv.includes('--baseline');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, baseline ? 'baseline-profile' : 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { checks: [], baseline, failures: [] };
let win;
(async () => {
  setTimeout(() => app.exit(1), 180000).unref();
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = async code => {
    try { return await win.webContents.executeJavaScript(code, true); }
    catch (error) { throw new Error(error.message + '\n' + code.slice(0, 800)); }
  };
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(25); };
  const check = async (code, label) => {
    const passed = await js(code);
    report.checks.push({ label, passed });
    if (!passed) report.failures.push(label);
    if (!passed) report.state = await js('({editing:!!d.horizontalLineTextEdit,composing:d.horizontalLineTextEdit?.composing,active:document.activeElement.tagName,drawings:d.drawings,remote,ready:sync.ready,running:sync.running,initial:sync.initial,requests:requests.slice(-12)})');
    if (!baseline) assert.equal(passed, true, label);
  };
  const key = async keyCode => {
    for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode });
    await settle();
  };
  const fresh = async (value = '') => {
    // Place the annotation between background requests; each scenario below
    // then explicitly releases the request or starts the polling timer.
    const wasRunning = await js('sync.running');
    await js('sync.running=true');
    await js(`d.finishHorizontalLineTextEdit(false);d.selectDrawing(null);d.drawings=[];d.redoStack=[];d.persistDrawings();d.magnetEnabled=false;d.selectTool('text')`);
    const point = await js(`(()=>{const r=d.chartElement.getBoundingClientRect();return {x:Math.round(r.x+440),y:Math.round(r.y+300)}})()`);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
    await settle();
    assert.equal(await js('!!d.horizontalLineTextEdit'), true, 'new text editor exists');
    await js('window.editor=d.horizontalLineTextEdit.input;window.draft=d.horizontalLineTextEdit.drawing');
    if (value) await win.webContents.insertText(value);
    await settle();
    await js(`sync.running=${wasRunning}`);
  };
  const intact = (value, label) => check(`d.horizontalLineTextEdit?.input===editor && editor.isConnected && editor.value===${JSON.stringify(value)} && d.drawings.includes(draft) && !d.selectionToolbar.hidden`, label);
  const flushSync = async () => {
    for (let i = 0; i < 100 && await js('sync.running'); i++) await pause(10);
    await js('sync.sync()');
    await settle();
  };
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5199}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  for (let i = 0; i < 120 && !await js('Boolean(window.ready)'); i++) await pause(100);
  assert.equal(await js('Boolean(window.ready)'), true);
  await js(`window.d=workspace.drawingController;document.querySelector('#host').style.cssText='width:100%;height:100%';workspace.loadingHistory=true;
    clearInterval(workspace.pollTimer);clearInterval(workspace.candlePollTimer);workspace.closeSocket();workspace.cancelScheduledLiveChartPaint();
    localStorage.clear();window.sync=d.manualSync;sync.destroy();workspace.newTaskWorkspace=true;
    window.owner='';window.remote={};window.requests=[];window.deferSession=false;
    codexDesktop.manualDrawings=async p=>{requests.push(p.action);if(p.action==='session'){if(deferSession)await new Promise(r=>window.resolveSession=r);return {owner};}
      if(p.action==='write')for(const op of p.body.operations)remote[op.id]=structuredClone(op);
      return {schemaVersion:4,version:1,marketKey:p.market||p.body.marketKey,serverTime:Date.now(),entries:Object.values(remote)};};
    sync.stopped=false;void 0`);
  await settle();
  // The actual 5-second polling cadence used to delete even an untouched draft.
  await fresh();
  console.log('Checking untouched text across repeated 5-second synchronization');
  await js(`window.quoteTicks=0;window.quoteTimer=setInterval(()=>{quoteTicks++;workspace.candleSeries.update({...workspace.candleSeries.data().at(-1),close:1330+Math.sin(quoteTicks)/10});d.redraw()},100);
    window.syncTimer=setInterval(()=>void sync.sync(),5000)`);
  await pause(11200);
  await js('clearInterval(syncTimer);clearInterval(quoteTimer)');
  await intact('', 'blank draft and toolbar survive 11 seconds of quote ticks and account polling');
  await check('quoteTicks>=50 && requests.filter(a=>a==="session").length>=2', 'live redraw and repeated account polling were exercised');
  // A delayed first account response must not replace an edit started meanwhile.
  await js(`owner='test-owner';deferSession=true;window.pendingSync=sync.sync();void 0`);
  await pause(50);
  await fresh('正在输入');
  await js(`(async()=>{deferSession=false;resolveSession();await pendingSync})()`);
  await intact('正在输入', 'delayed synchronization initialization preserves typed draft');
  // A frame without projection coordinates is transient, not a commit action.
  await fresh();
  await js(`window.originalLabelPoints=d.drawingLabelPoints;d.drawingLabelPoints=()=>[];d.redraw();d.drawingLabelPoints=originalLabelPoints;d.redraw()`);
  await intact('', 'missing chart coordinates do not discard blank draft');
  await fresh('输入法');
  await js(`editor.dispatchEvent(new CompositionEvent('compositionstart'));d.positionHorizontalLineTextEdit({width:1,height:1});d.redraw()`);
  await intact('输入法', 'temporary small chart layout preserves input composition');
  await check('d.horizontalLineTextEdit?.composing===true', 'IME composition state survives layout');
  await js(`editor.dispatchEvent(new CompositionEvent('compositionend'))`);
  // Blur with no DOM destination occurs on window deactivation, including IME windows.
  await fresh('切换窗口');
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false });
  await js('editor.blur()');
  await intact('切换窗口', 'window focus loss does not finish editing');
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  if (await js('!!d.horizontalLineTextEdit')) await js('editor.focus()');
  await settle();
  if (!baseline) {
    await key('Enter'); await flushSync();
    await check('!d.horizontalLineTextEdit && d.drawings.some(x=>x.text==="切换窗口") && Object.values(remote).some(op=>op.drawing?.text==="切换窗口")', 'explicit Enter saves and synchronizes retained text');
    const id = await js('d.drawings[0].id');
    await fresh('连续输入');
    await js(`(async()=>{editor.dispatchEvent(new CompositionEvent('compositionstart'));await sync.sync();d.redraw()})()`);
    await intact('连续输入', 'normal authenticated synchronization preserves composing draft');
    await js(`editor.dispatchEvent(new CompositionEvent('compositionend'))`);
    await key('Enter');
    await js('(async()=>{await sync.sync();await sync.sync()})()');
    await check(`d.drawings.some(x=>x.text==='连续输入') && !d.drawings.some(x=>x.id===${JSON.stringify(id)})`, 'saved edit survives subsequent reads without resurrecting removed text');
    await js(`d.beginInlineTextEdit(d.drawings.find(x=>x.text==='连续输入'));window.editor=d.horizontalLineTextEdit.input;window.draft=d.horizontalLineTextEdit.drawing`);
    await win.webContents.insertText('修改'); await js('sync.sync()');
    await intact('连续输入修改', 'editing an existing synced annotation retains its input');
    await key('Escape');
    await check(`!d.horizontalLineTextEdit && d.drawings.some(x=>x.text==='连续输入')`, 'explicit Escape cancels the edit');
    await fresh('点击外部保存');
    await js(`const button=document.createElement('button');document.body.append(button);button.focus()`);
    await check(`!d.horizontalLineTextEdit && d.drawings.some(x=>x.text==='点击外部保存')`, 'focus moving to another DOM control still commits');
  }
  fs.writeFileSync(path.join(output, baseline ? 'baseline.png' : 'verified.png'), (await win.webContents.capturePage()).toPNG());
  report.result = report.failures.length ? 'REPRODUCED' : 'PASS';
  fs.writeFileSync(path.join(output, baseline ? 'baseline.json' : 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); app.exit(0);
})().catch(error => {
  report.error = error.stack;
  fs.writeFileSync(path.join(output, baseline ? 'baseline.json' : 'report.json'), JSON.stringify(report, null, 2));
  console.error(error.stack); app.exit(1);
});
