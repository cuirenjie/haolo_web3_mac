// Run against the local Vite fixture; native Electron input and a cloud API fixture.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'price-alert-markers-qa', String(Date.now()));
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const preload = path.join(output, 'preload.cjs');
fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('priceQa',Object.fromEntries(['create','snapshot','delete'].map(k=>[k,p=>ipcRenderer.invoke('priceQa:'+k,p)])));`);

(async () => {
  const { createCloudPriceAlerts } = await import(pathToFileURL(path.join(root, 'src/main/trading-alerts/cloud-price-alerts.mjs')));
  const { cloudPriceAlertFixture } = await import(pathToFileURL(path.join(root, 'test/helpers/cloud-price-alert-fixture.mjs')));
  let remote, service, calls, failDelete = false, loseCreateResponse = false, blockSnapshot = false, snapshotCalls = 0;
  const wrap = fn => async (_event, p) => { try { return {ok:true,data:await fn(p)}; } catch(error) {return {ok:false,error:{code:error.code,message:error.message}};} };
  ipcMain.handle('priceQa:create', wrap(async p => {
    calls.push(p);const result=await service.create(p);
    if(loseCreateResponse)throw Error('Connection lost after saving');
    return result;
  }));
  ipcMain.handle('priceQa:delete', wrap(async p => {if(failDelete)throw Error('Delete failed');return service.mutate('delete',p);}));
  ipcMain.handle('priceQa:snapshot', wrap(async () => {
    snapshotCalls++;
    if(blockSnapshot)await new Promise(()=>{});
    return {...await service.snapshot(),cloudLoaded:true};
  }));
  await app.whenReady();
  const win = new BrowserWindow({ show:false, width:1200, height:800, webPreferences:{preload,offscreen:true,backgroundThrottling:false} });
  win.webContents.on('console-message', event => {if(event.level==='error')console.error(event.message);});
  const js = async code => {try{return await win.webContents.executeJavaScript(code,true);}catch(error){console.error('Failed script: '+code);throw error;}};
  const until = async expression => {for(let i=0;i<100;i++){if(await js(expression))return;await pause(100);}fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());throw Error(`Timeout: ${expression}; ${await js('String(window.qaError)+" / "+document.querySelector("dialog[open]")?.textContent')}; ${output}`);};
  const settle = async () => {await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await pause(50);};
  const rect = expression => js(`(()=>{const r=(${expression}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
  const move = async (x,y) => {win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(x),y:Math.round(y)});await settle();};
  const mouse = (type,x,y) => win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});
  const click = async expression => {const r=await rect(expression);await move(r.x+r.width/2,r.y+r.height/2);mouse('mouseDown',r.x+r.width/2,r.y+r.height/2);mouse('mouseUp',r.x+r.width/2,r.y+r.height/2);await settle();};
  const shot = async name => fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
  const line = `workspace.priceAlertControl.markers.layer.querySelector('.trading-price-alert-line:not([hidden])')`;
  const caption = `(${line}).querySelector('.trading-price-alert-caption')`;
  const del = `(${line}).querySelector('[data-price-alert-delete]')`;
  const edit = `(${line}).querySelector('[data-price-alert-label]')`;
  const input = `document.querySelector('[data-price-alert-input]')`;
  const confirm = `document.querySelector('[data-price-alert-confirm]')`, cancel = `document.querySelector('[data-price-alert-cancel]')`;
  const getPrice = () => js(`Number(document.querySelector('.trading-price-alert-target').textContent.replaceAll(',',''))`);
  const typePrice = async value => {
    await click(input);
    // Hidden macOS windows do not route menu accelerators. Use Chromium's
    // native editing command, then exercise real deletion and text input.
    win.webContents.selectAll();
    for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode:'Backspace'});
    await settle();
    assert.equal(await js(`${input}.value`),'','native selection/deletion must clear the previous price');
    if(value)await win.webContents.insertText(value);
    await settle();
  };
  const openEdit = async () => {
    const r=await rect(line);await move(r.x+r.width*.77,r.y+r.height/2);
    assert.equal(await js(`getComputedStyle(${edit}).cursor`),'pointer');
    await click(edit);await until(`Boolean(${input})`);
    assert.equal(await js(`document.activeElement===${input}`),true);
  };
  const aligned = async expected => {
    const delta=await js(`(()=>{const r=(${line}).getBoundingClientRect();const c=workspace.chartElement.getBoundingClientRect();return Math.abs(r.y+r.height/2-c.y-(workspace.candleSeries||workspace.series).priceToCoordinate(${expected}))})()`);
    assert.ok(delta<1.1,`marker/price mismatch: ${delta}px`);
  };
  const drag = async (dy, escape=false) => {
    const r=await rect(line),x=r.x+r.width*.77,y=r.y+r.height/2;
    await move(x,y);
    assert.equal(await js(`getComputedStyle(${line}).cursor`),'ns-resize');
    mouse('mouseDown',x,y);
    for(let step=1;step<=6;step++) {win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(x),y:Math.round(y+dy*step/6),button:'left',modifiers:['leftButtonDown']});await pause(15);}
    await settle();
    assert.equal(await js(`getComputedStyle(${caption}).display`),'none','caption hidden while dragging');
    if(escape)for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode:'Escape'});
    mouse('mouseUp',x,y+dy);await settle();
  };
  const report=[];
  for(const theme of ['light','dark']) for(const layout of ['main','split']) {
    remote=cloudPriceAlertFixture();calls=[];
    service=createCloudPriceAlerts({owner:async()=>({ownerId:'qa',accountId:'qa',email:'qa@example.invalid',baseUrl:'qa'}),api:()=>remote});
    await win.loadURL((process.env.HAOLO_PRICE_QA_URL || process.env.HAOLO_QA_URL || 'http://127.0.0.1:5177')+'/@fs/'+path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/'));
    await until('window.ready===true');
    await js(`(async()=>{document.documentElement.dataset.theme='${theme}';document.documentElement.lang='zh-CN';window.primary=workspace;
      workspace.loadingHistory=true;workspace.splitLayoutId='1-single';workspace.applySplitLayout();workspace.applyChartTheme();
      window.codexDesktop.tradingAlertsCreateCloudPriceAlert=window.priceQa.create;window.codexDesktop.tradingAlertsSnapshot=window.priceQa.snapshot;window.codexDesktop.tradingAlertsDelete=window.priceQa.delete;
      window.alertStore=await import('/trading-price-alert-store.ts');await alertStore.refreshChartPriceAlerts();})()`);
    if(layout==='split') {
      await js(`primary.splitLayoutId='2-columns';primary.applySplitLayout();window.workspace=primary.splitPanes[0];void 0`);
      await until('workspace.candles.length>0');
    }
    await settle();
    const h=await rect('workspace.chartElement');
    await move(h.x+h.width*.7,h.y+h.height*.45);
    await until('!workspace.crosshairPriceElement.hidden');
    await click(`workspace.crosshairPriceElement.querySelector('button')`);
    await until(`Boolean(document.querySelector('dialog[open]'))`);
    const price=await getPrice();
    const beforeSnapshot=snapshotCalls;blockSnapshot=true;
    await click(confirm);
    await until(`document.querySelector('dialog[open] h2')?.textContent==='预警已创建'`);
    assert.equal(snapshotCalls,beforeSnapshot,'verified creation must not wait for another full-list request');blockSnapshot=false;
    await click(cancel);
    await until(`Boolean(${line})`);
    await aligned(price);
    const original=remote.items[0];
    await move(h.x+20,h.y+40);await shot(`${theme}-${layout}-line`);
    assert.equal(await js(`getComputedStyle(${caption}).display`),'none');
    const r=await rect(line);
    await move(r.x+r.width*.77,r.y+r.height/2);
    assert.equal(await js(`getComputedStyle(${caption}).display`),'flex');
    await shot(`${theme}-${layout}-hover`);
    await click(del);await until(`Boolean(document.querySelector('.trading-price-alert-delete-dialog[open]'))`);
    assert.equal(await js(`getComputedStyle(${confirm}).backgroundColor`),'rgb(242, 53, 69)','delete action uses the red danger color');
    await shot(`${theme}-${layout}-delete`);await click(cancel);
    assert.equal(original.state,'arming');

    const range=await js('workspace.chart.timeScale().getVisibleLogicalRange()');
    await drag(40,true);
    assert.equal(await js(`Boolean(document.querySelector('dialog[open]'))`),false);
    await aligned(price);
    await drag(45);
    await until(`document.querySelector('dialog[open] h2')?.textContent==='在此价格重新创建预警？'`);
    assert.notEqual(await getPrice(),price);
    await click(cancel);await aligned(price);
    assert.equal(calls.length,1,'cancel must not create a replacement');
    await drag(-35);
    await until(`document.querySelector('dialog[open] h2')?.textContent==='在此价格重新创建预警？'`);
    let moved=await getPrice();await shot(`${theme}-${layout}-move-confirm`);
    await click(confirm);await until(`!document.querySelector('dialog[open]')`);
    assert.equal(original.state,'deleted');assert.equal(remote.items.length,2);
    assert.equal(remote.items[1].rule.threshold,moved);
    await aligned(moved);
    assert.deepEqual(await js('workspace.chart.timeScale().getVisibleLogicalRange()'),range,'line drag must not pan the chart');
    await shot(`${theme}-${layout}-moved`);

    await openEdit();
    assert.equal(await js(`${input}.valueAsNumber`),moved,'edit starts at the exact saved price');
    await typePrice(String(moved+1.23));await aligned(moved);
    await shot(`${theme}-${layout}-edit-cancel`);await click(cancel);await aligned(moved);
    assert.equal(calls.length,2,'cancelled edits must not create an alert');
    await openEdit();
    for(const invalid of ['', '0', '-5', '1e999']) {
      await typePrice(invalid);await click(confirm);
      assert.equal(await js(`${input}.getAttribute('aria-invalid')`),'true');
      assert.equal(calls.length,2,'invalid prices must not be submitted');
      await aligned(moved);
    }
    const edited=Number((moved+2.123456).toFixed(6));
    await typePrice(String(edited));await shot(`${theme}-${layout}-edit-confirm`);
    remote.available=false;await click(confirm);await until(`${confirm}?.disabled===false`);
    assert.equal(remote.items.length,2);assert.equal(remote.items[1].state,'arming');await aligned(moved);
    assert.equal(await js(`${input}.readOnly`),true,'retry must retain the same price');
    const editRequest=calls.at(-1);
    remote.available=true;loseCreateResponse=true;
    await click(confirm);await until(`${confirm}?.disabled===false`);
    assert.equal(remote.items.length,3,'a lost response can follow a successful save');
    loseCreateResponse=false;await click(confirm);await until(`!document.querySelector('dialog[open]')`);
    assert.equal(remote.items.length,3,'retry must not duplicate the saved alert');
    assert.deepEqual(calls.at(-1),editRequest);
    assert.equal(editRequest.interval,original.rule.interval);
    assert.equal(remote.items[1].state,'deleted');
    let active=remote.items[2];
    assert.equal(active.rule.threshold,edited);moved=edited;await aligned(moved);
    assert.equal(await js(`document.querySelectorAll('.trading-price-alert-line').length`),layout==='main'?1:2);
    assert.deepEqual(await js('workspace.chart.timeScale().getVisibleLogicalRange()'),range,'editing must not pan the chart');
    await shot(`${theme}-${layout}-edited`);

    // Keyboard activation, Escape and Enter use the same dialog and replacement path.
    await js(`(${line}).focus()`);
    for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode:'Return'});
    await until(`Boolean(${input})`);
    for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode:'Escape'});
    await until(`!document.querySelector('dialog[open]')`);await aligned(moved);
    for(const [lang,title] of [['en','Edit alert price'],['zh-Hant','修改預警價格'],['ko','알림 가격 수정'],['ja','アラート価格を変更'],['vi','Chỉnh sửa giá cảnh báo'],['zh-CN','修改预警价格']]) {
      await js(`document.documentElement.lang='${lang}';workspace.priceAlertControl.updateMarkers()`);
      await openEdit();assert.equal(await js('document.querySelector("dialog[open] h2").textContent'),title);
      await shot(`${theme}-${layout}-edit-${lang}`);await click(cancel);
    }
    await openEdit();await typePrice(String(Number((moved-3.5).toFixed(6))));
    moved=await js(`${input}.valueAsNumber`);
    for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode:'Return'});
    await until(`!document.querySelector('dialog[open]')`);
    assert.equal(remote.items.length,4);assert.equal(active.state,'deleted');active=remote.items[3];
    assert.equal(active.rule.threshold,moved);await aligned(moved);

    if(layout==='split') {
      await js(`(()=>{const previous=workspace.candles;workspace.candles=previous.map((c,i)=>i===previous.length-1?{...c,close:c.close+8,high:c.high+8}:c);workspace.updateData(previous);})()`);
      await settle();await aligned(moved);
    }
    await js(`window.savedLoadedMarket=workspace.loadedMarketId;workspace.loadedMarketId='BINANCE:SPOT:BTCUSDT';workspace.priceAlertControl.updateMarkers()`);
    assert.equal(await js(`Boolean(${line})`),false,'a market change must hide the previous market alerts');
    await js(`workspace.loadedMarketId=window.savedLoadedMarket;workspace.priceAlertControl.updateMarkers()`);
    await aligned(moved);

    // Native price-axis scaling must keep the marker at its exact price.
    const axisX=h.x+h.width-15,axisY=h.y+h.height*.4;
    await move(axisX,axisY);mouse('mouseDown',axisX,axisY);
    win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(axisX),y:Math.round(axisY+35),button:'left',modifiers:['leftButtonDown']});
    mouse('mouseUp',axisX,axisY+35);await settle();await aligned(moved);
    // Completed/paused snapshots disappear; restoring active state restores the line.
    active.state='paused';active.enabled=false;
    await js('alertStore.refreshChartPriceAlerts()');assert.equal(await js(`Boolean(${line})`),false);
    active.state='arming';active.enabled=true;
    await js('alertStore.refreshChartPriceAlerts()');await until(`Boolean(${line})`);

    for(const [lang,title] of [['en','Delete this alert?'],['zh-Hant','刪除這個預警？'],['ko','이 알림을 삭제할까요?'],['zh-CN','删除这个预警？']]) {
      await js(`document.documentElement.lang='${lang}';workspace.priceAlertControl.updateMarkers();`);
      const q=await rect(line);await move(q.x+q.width*.77,q.y+q.height/2);await click(del);
      assert.equal(await js('document.querySelector("dialog[open] h2").textContent'),title);
      await shot(`${theme}-${layout}-delete-${lang}`);
      await click(lang==='zh-CN' ? `document.querySelector('[data-price-alert-close]')` : cancel);
      assert.equal(await js(`Boolean(document.querySelector('.trading-price-alert-delete-dialog[open]'))`),false);
    }
    const q=await rect(line);await move(q.x+q.width*.77,q.y+q.height/2);await click(del);
    failDelete=true;await click(confirm);await until(`${confirm}?.disabled===false`);
    assert.equal(active.state,'arming');assert.equal(await js(`Boolean(${line})`),true);
    failDelete=false;await click(confirm);await until(`!document.querySelector('dialog[open]')`);
    assert.equal(active.state,'deleted');assert.equal(await js(`Boolean(${line})`),false);
    report.push({theme,layout,price,moved});
    console.log(`PASS ${theme}/${layout}: create, hover, drag, click edit, invalid input, cancel, keyboard, exact price, failed/lost save retry, scale, pause, locales, delete failure/retry`);
  }
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({cases:report,backend:'cloud API fixture; no production alerts or emails'},null,2));
  console.log('Artifacts: '+output);win.destroy();app.exit(0);
})().catch(error=>{console.error(error.stack||error);app.exit(1);});
