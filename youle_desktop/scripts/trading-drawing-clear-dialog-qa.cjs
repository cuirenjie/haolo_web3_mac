// Real Electron modal/top-layer regression with synthetic candles and an isolated profile.
// Run against the repository's Vite server (HAOLO_QA_PORT defaults to 5183).
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'drawing-clear-dialog-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Execute the actual shell preservation functions without starting an account session.
const main = fs.readFileSync(path.join(root, 'src/renderer/main.ts'), 'utf8');
const ast = ts.createSourceFile('main.ts', main, ts.ScriptTarget.Latest, true);
const shellFunctions = ['preserveTradingExpertMarketWorkspace', 'restorePreservedTradingExpertMarketWorkspace']
  .map(name => {
    const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, name);
    return declaration.getText(ast);
  }).join('\n');
const shellCode = ts.transpileModule(shellFunctions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

(async () => {
  setTimeout(() => app.exit(1), 90000).unref();
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1320, height: 900,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = () => js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const clickPoint = async point => {
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
      win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
    }
    await settle();
  };
  const click = async selector => clickPoint(await js(`(() => {
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  })()`));
  const snapshot = () => js('JSON.stringify({manual:d.drawings,ai:d.aiDrawings,redo:d.redoStack})');
  const modal = () => js('d.clearDialog.open && d.clearDialog.matches(":modal")');
  const trash = '[data-drawing-action="clear"]';
  const cancel = '[data-drawing-clear-action="cancel"]';
  const confirm = '[data-drawing-clear-action="confirm"]';
  const results = [];
  for (const theme of ['light', 'dark']) {
    await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5183}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
    for (let i = 0; i < 120 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
    await js(`(async () => {
      const { captureTradingWorkspaceDialogs, restoreTradingWorkspaceDialogs } = await import('/trading-workspace-dialogs.ts');
      const root = document.querySelector('#host');
      root.style.cssText = 'width:100%;height:100%';
      document.documentElement.dataset.theme = ${JSON.stringify(theme)};
      workspace.applyChartTheme(); workspace.loadingHistory = true;
      const lastRenderedThreadId = 'qa-current';
      const state = { currentThreadId: 'qa-current', composerText: '' };
      let parkedTradingExpertMarketWorkspace = null;
      const isTradingExpertSurfaceThreadId = () => true;
      const tradingExpertMarketWorkspaceStorageSessionId = () => 'qa-current';
      const tradingExpertWorkspaceSessionMigrationSource = () => '';
      const tradingExpertWorkspaceSessionAliases = () => ({});
      const tradingExpertWorkspaceThreadReplacements = new Map();
      const tradingExpertFavoriteStorageAccountIdentity = () => '';
      const isBlankNewThread = () => false;
      const syncTradingExpertMarketWorkspace = () => {};
      const clearFailedTradingAlertHistorySimulation = () => {};
      const forgetTradingExpertWorkspaceSessionAlias = () => {};
      const applyTradingExpertCustomIndicatorMentions = () => {};
      ${shellCode}
      window.shellRender = (targetThreadId = 'qa-current') => {
        const preserved = preserveTradingExpertMarketWorkspace();
        root.innerHTML = targetThreadId ? '<div data-trading-market-workspace></div>' : '<div>Other page</div>';
        restorePreservedTradingExpertMarketWorkspace(preserved, targetThreadId);
      };
      window.dialogHelpers = { captureTradingWorkspaceDialogs, restoreTradingWorkspaceDialogs };
      window.d = workspace.drawingController;
      d.switchStorageSession('clear-dialog-${theme}-' + Date.now());
      const candles = workspace.candles;
      window.sample = { id:'manual-qa', tool:'trend-line', symbol:d.getSymbol(), interval:d.getInterval(),
        points: [candles.at(-50),candles.at(-20)].map(c => ({time:c.time,price:c.close})) };
      d.drawings = [sample]; d.aiDrawings = [{...sample,id:'ai-qa',source:'ai',tool:'path',colorToken:'chan-pen'}];
      d.redoStack = [{...sample,id:'redo-qa'}]; d.redraw();
      window.closeEvents = 0; d.clearDialog.addEventListener('close', () => closeEvents++);
    })()`);
    await settle();
    const before = await snapshot();
    await click(trash);
    assert.equal(await modal(), true, 'native trash click opens a modal');
    await pause(350);
    await js('document.querySelector(\'[data-drawing-clear-action="confirm"]\').focus()');
    for (let i = 0; i < 20; i++) {
      await js('shellRender()'); await settle();
      assert.equal(await modal(), true, 'background shell refresh retains the top layer');
      assert.equal(await js('document.activeElement.dataset.drawingClearAction'), 'confirm', 'focused button is retained');
    }
    await pause(3100);
    assert.equal(await modal(), true, 'remains open beyond toolbar idle timers');
    assert.equal(await js('closeEvents'), 0, 'restoration must not dispatch close');
    assert.equal(await snapshot(), before, 'opening/refreshing cannot clear drawings');
    assert.equal(await js(`(() => { const r=d.clearDialog.getBoundingClientRect();return r.top>0 && r.bottom<innerHeight && r.left>0 && r.right<innerWidth })()`), true);
    fs.writeFileSync(path.join(output, `${theme}-after-refresh.png`), (await win.webContents.capturePage()).toPNG());
    await click(cancel);
    assert.equal(await modal(), false);
    assert.equal(await snapshot(), before, 'cancel retains all data');
    assert.equal(await js('document.activeElement.dataset.drawingAction'), 'clear', 'cancel restores trigger focus');
    await js('shellRender()'); assert.equal(await modal(), false, 'cancelled dialog stays closed');
    await click(trash); await js('shellRender()'); await settle();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await settle();
    assert.equal(await modal(), false, 'Esc still dismisses');
    assert.equal(await snapshot(), before);
    await click(trash); await js('shellRender(null);shellRender(null)');
    assert.equal(await js('d.clearDialog.isConnected'), false, 'parked workspace stays offscreen');
    await js('shellRender()'); await settle();
    assert.equal(await modal(), true, 'return to the same parked task restores its modal');
    await click(confirm);
    assert.equal(await modal(), false);
    assert.deepEqual(await js('[d.drawings.length,d.aiDrawings.length,d.redoStack.length]'), [0,0,0], 'confirmation still clears only on request');
    await js('shellRender()'); assert.equal(await modal(), false, 'confirmed dialog stays closed');

    // Shared toolbar routes the same preserved dialog to the active split chart.
    await js(`d.drawings=[sample];d.redraw();workspace.splitLayoutId='2-columns';workspace.applySplitLayout()`);
    for (let i=0;i<100&&!await js('workspace.splitPanes[0]?.candles.length');i++) await pause(50);
    await js(`window.split=workspace.splitPanes[0].drawingController;split.drawings=[{...sample,id:'split-qa',symbol:split.getSymbol(),interval:split.getInterval()}];split.redraw();workspace.activateDrawingController(split)`);
    await click(trash); await js('shellRender()'); await settle();
    assert.equal(await modal(), true);
    await click(confirm);
    assert.equal(await js('split.drawings.length'), 0, 'confirmation targets active split');
    assert.equal(await js('d.drawings.length'), 1, 'other pane data remains');

    // Closed, nonmodal and detached dialogs must never be resurrected by restoration.
    assert.deepEqual(await js(`(() => {
      const host=document.createElement('section');document.body.append(host);
      const a=document.createElement('dialog'),b=document.createElement('dialog');host.append(a,b);
      a.show();b.showModal();const captured=dialogHelpers.captureTradingWorkspaceDialogs(host);
      b.close();dialogHelpers.restoreTradingWorkspaceDialogs(captured);
      const closed=!b.open,nonmodal=!a.matches(':modal');b.showModal();
      const detached=dialogHelpers.captureTradingWorkspaceDialogs(host);host.remove();
      dialogHelpers.restoreTradingWorkspaceDialogs(detached);
      return [captured.length,closed,nonmodal,!b.isConnected&&!b.matches(':modal')];
    })()`), [1,true,true,true]);
    results.push({ theme, repeatedRefreshes:20, cancel:true, escape:true, confirm:true, focus:true, parkedTask:true, splitRouting:true, guards:true });
  }
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, results }, null, 2));
  console.log(JSON.stringify({ passed:true, results, output }, null, 2));
  app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
