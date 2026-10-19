// Run with Electron while Vite serves this checkout at 127.0.0.1:5183.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'period-price-axis');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1200, height: 800,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => { await pause(60); await js('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))'); };
  const screenshot = async name => fs.promises.writeFile(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const fixture = `http://127.0.0.1:5183/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`;
  const load = async () => {
    await win.loadURL(fixture);
    for (let i = 0; i < 150 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
    await js("host.style.width='100%';host.style.height='100vh';window.primary=workspace;primary.loadingHistory=true;void 0");
    // The shared fixture normally supplies hourly candles only. Supply each
    // requested base resolution so overflow selections exercise real loading.
    await js(`(() => {const original=codexDesktop.getBinancePublicMarketData;codexDesktop.getBinancePublicMarketData=async request=>{
      if(!request.path.endsWith('/klines'))return original(request);
      const match=/^(\\d+)([mhdwM])$/.exec(request.parameters.interval);
      const step=Number(match?.[1]||1)*({m:60000,h:3600000,d:86400000,w:604800000,M:2592000000}[match?.[2]]||3600000);
      const end=Math.floor(Date.now()/step)*step;
      return {ok:true,status:200,data:Array.from({length:1000},(_,i)=>{const t=end-(999-i)*step,o=1300+Math.sin(i/9)*25+i/20,c=o+Math.sin(i)*4;
        return [t,String(o),String(Math.max(o,c)+2),String(Math.min(o,c)-2),String(c),'100',t+step-1,'0',1,'0','0','0'];})};
    }})()`);
    await settle();
  };
  const click = async selector => {
    const p = await js(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...p, button: 'left', clickCount: 1 });
    await settle();
  };
  const state = () => js(`(() => {const w=primary, r=w.periodTimes.getBoundingClientRect(),m=w.periodMoreButton.getBoundingClientRect();return {
    count:w.periods.length, active:w.activeInterval, open:!w.periodOverflow.hidden, more:!w.periodMoreButton.hidden,
    moreLabel:w.periodMoreLabel.textContent.trim(), moreSelected:w.periodMoreButton.classList.contains('selected'),
    visible:[...w.periodTimes.querySelectorAll('button:not([hidden])')].map(b=>b.dataset.marketInterval),
    overflow:w.overflowPeriods.map(p=>p.unit==='m'?String(p.amount):p.unit==='h'?String(p.amount*60):p.amount+p.unit.toUpperCase()),
    fits:[...w.periodTimes.querySelectorAll('button:not([hidden])')].every(b=>{const bR=b.getBoundingClientRect();return bR.left>=r.left-1&&bR.right<=r.right+1}),
    moreFits:m.right<=w.periodControls.getBoundingClientRect().right+1,
    popupCount:w.periodOverflowItems.querySelectorAll('button').length,
    popupScroll:w.periodOverflowItems.scrollHeight>w.periodOverflowItems.clientHeight,
    editorScroll:w.periodItems.scrollHeight>w.periodItems.clientHeight
  }})()`);
  const report = { periods: [], axes: [] };
  await win.webContents.session.clearStorageData();
  await load();
  await js("document.documentElement.dataset.theme='dark'");
  await click('[data-market-action="toggle-period-editor"]');
  // Exercise the real add action beyond the former ten-item cap.
  for (let value = 21; value <= 40; value++) {
    await js(`primary.periodAmountInput.value='${value}';primary.host.querySelector('[data-market-action="add-period"]').click()`);
  }
  await settle();
  assert.equal(await js('primary.periods.length'), 26);
  assert.equal((await state()).editorScroll, true);
  await screenshot('dark-editor-unlimited');
  await js('primary.setPeriodEditorOpen(false)');
  await load();
  assert.equal(await js('primary.periods.length'), 26, 'saved periods survive restart without truncation');
  for (const theme of ['light', 'dark']) {
    await js(`document.documentElement.dataset.theme='${theme}'`);
    for (const width of [1200, 720, 420]) {
      win.setSize(width, 800); await settle();
      const before = await state();
      assert.equal(before.count, 26); assert.equal(before.more, true);
      assert.equal(before.fits, true); assert.equal(before.moreFits, true);
      assert.equal(new Set([...before.visible, ...before.overflow]).size, 26);
      assert.equal(before.visible.length + before.overflow.length, 26);
      await click('[data-market-action="toggle-more-periods"]');
      const open = await state(); assert.equal(open.open, true); assert.equal(open.popupCount, open.overflow.length);
      await screenshot(`${theme}-${width}-more`);
      const next = open.overflow.at(-1);
      const nextLabel = await js(`primary.periodOverflowItems.querySelector('[data-market-interval="${next}"]').textContent.trim()`);
      await js(`primary.periodOverflowItems.querySelector('[data-market-interval="${next}"]').click()`); await settle();
      const chosen = await state(); assert.equal(chosen.active, next); assert.equal(chosen.open, false);
      assert.ok(chosen.overflow.includes(next));
      assert.equal(chosen.moreLabel, nextLabel);
      assert.equal(chosen.moreSelected, true);
      assert.equal(chosen.fits, true); assert.equal(chosen.moreFits, true);
      assert.equal(await js('document.activeElement===primary.periodMoreButton'), true);
      await screenshot(`${theme}-${width}-selected-period`);
      assert.equal(await js('primary.errorElement.hidden'), true, 'custom resolution loads successfully');
      await click('[data-market-action="toggle-more-periods"]');
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await settle();
      assert.equal((await state()).open, false);
      assert.equal(await js('document.activeElement===primary.periodMoreButton'), true);
      await click('[data-market-action="toggle-more-periods"]');
      await js("primary.chartElement.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))");
      assert.equal((await state()).open, false);
      if (chosen.visible.length) {
        await js(`primary.periodTimes.querySelector('[data-market-interval="${chosen.visible[0]}"]').click()`); await settle();
        const reset = await state();
        assert.equal(reset.moreLabel, '更多');
        assert.equal(reset.moreSelected, false);
      }
      report.periods.push({ theme, width, before, chosen });
    }
  }
  win.setSize(1200, 800); await settle();
  await js("primary.draftPeriods=[{amount:1,unit:'h'}];primary.applyDraftPeriods()"); await settle();
  assert.equal((await state()).more, false, 'no stale More button after removing overflow');
  await js("primary.splitLayoutId='2-columns';primary.applySplitLayout();void 0");
  for (let i = 0; i < 150 && !await js('primary.splitPanes[0]?.candles.length'); i++) await pause(100);
  await settle();
  const geometry = () => js(`(() => {const c=workspace.chart;return {font:c.options().layout.fontSize,width:c.priceScale('right',0).width(),
    range:c.timeScale().getVisibleLogicalRange(), price:c.priceScale('right',0).getVisibleRange(),auto:c.priceScale('right',0).options().autoScale,
    otherFont:other.chart.options().layout.fontSize,otherRange:other.chart.timeScale().getVisibleLogicalRange()}})()`);
  const nearRange = (a, b, label) => { for (const k of ['from', 'to']) assert.ok(Math.abs(a[k] - b[k]) < 0.01, `${label}: ${JSON.stringify({a,b})}`); };
  const wheel = async (deltaY, axis) => {
    const p = await js(`(() => {const c=workspace.chart,r=c.panes()[0].getHTMLElement().getBoundingClientRect();return {x:Math.round(${axis ? 'r.right-8' : 'r.left+c.timeScale().width()/2'}),y:Math.round(r.top+100)}})()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...p });
    win.webContents.sendInputEvent({ type: 'mouseWheel', ...p, deltaX: 0, deltaY }); await settle();
  };
  for (const theme of ['light', 'dark']) for (const subject of ['main', 'split']) {
    await js(`document.documentElement.dataset.theme='${theme}';window.workspace=${subject === 'main' ? 'primary' : 'primary.splitPanes[0]'};window.other=${subject === 'main' ? 'primary.splitPanes[0]' : 'primary'};workspace.loadingHistory=true;workspace.chartNavigation.reset();workspace.chart.timeScale().setVisibleLogicalRange({from:200,to:380});void 0`);
    await settle();
    const before = await geometry();
    await wheel(100, true); const larger = await geometry();
    assert.ok(larger.font > before.font); assert.ok(larger.width > before.width);
    assert.ok(Math.abs(larger.width / before.width - larger.font / before.font) < 0.1);
    nearRange(larger.range, before.range, 'axis wheel must preserve candle window');
    assert.equal(larger.auto, before.auto); assert.equal(larger.otherFont, before.otherFont);
    nearRange(larger.otherRange, before.otherRange, 'other pane');
    await screenshot(`${theme}-${subject}-larger-prices`);
    await wheel(-100, true); const smaller = await geometry();
    assert.ok(smaller.font < larger.font); assert.ok(smaller.width < larger.width);
    nearRange(smaller.range, before.range, 'axis down wheel');
    await wheel(100, false); const zoomed = await geometry();
    assert.equal(zoomed.font, smaller.font);
    assert.ok(zoomed.range.to - zoomed.range.from < smaller.range.to - smaller.range.from);
    report.axes.push({ theme, subject, before, larger, smaller, zoomed });
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`PASS: unlimited periods, persistence, adaptive overflow, selection, dismissal, themes, main/split price sizing and independent chart zoom. ${output}`);
  win.destroy(); app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
