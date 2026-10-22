// Isolated real chart/controller QA. Never attaches to the user's app window.
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/plan-prices-M1-416');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/plan-prices-sndk.json'), 'utf8'));
fs.mkdirSync(output, {recursive:true});
app.setPath('userData', path.join(output, 'visual-profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(r=>setTimeout(r,ms));
(async()=>{
  const timeout=setTimeout(()=>app.exit(1),120000); timeout.unref();
  await app.whenReady();
  const win=new BrowserWindow({show:false,width:1500,height:900,webPreferences:{offscreen:true,backgroundThrottling:false}});
  win.webContents.on('console-message', event => console.log(event.message));
  const js=code=>win.webContents.executeJavaScript(`(async()=>{try{${/^(window\.|d\.)/.test(code)?code:`return (${code});`}}catch(e){console.error(e.stack);throw e;}})()`,true);
  const rows=[];
  for(const theme of ['light','dark']) for(const locale of ['zh-CN','zh-Hant','en']) {
    await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT||5177}/@fs/${path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/')}`);
    for(let i=0;i<150&&!await js('Boolean(window.ready)');i++)await pause(40);
    assert.equal(await js('Boolean(window.ready)'),true,await js('String(window.qaError)'));
    await js(`window.fixture=${JSON.stringify(fixture)};
      window.d=workspace.drawingController;
      workspace.loadingHistory=true;
      workspace.selectedMarketId=fixture.executionPlan.market.marketId;
      document.documentElement.dataset.theme=${JSON.stringify(theme)};workspace.applyChartTheme();
      document.querySelector('#host').style.cssText='width:1160px;height:880px';
      d.drawingVisibility.setAll(false);d.drawings=[];d.orderLines=[];
      window.drawingsModule=await import('/trading-expert-drawing.ts');
      window.historyModule=await import('/trading-plan-drawing-history.ts');
      window.cards=await import('/@fs/${path.join(root,'src/main/execution-plan-card-view.mjs').replaceAll('\\','/')}');
      window.contract=await import('/@fs/${path.join(root,'src/main/cloud-plan-contract.mjs').replaceAll('\\','/')}');
      window.projection=await import('/@fs/${path.join(root,'src/shared/execution-plan-drawings.mjs').replaceAll('\\','/')}');
      window.old=drawingsModule.normalizeTradingAiDrawingPatch(fixture.drawingPatch).map(x=>({...x,source:'ai'}));
      d.aiDrawings=old;d.getCandleSeries().applyOptions({autoscaleInfoProvider:()=>({priceRange:{minValue:1300,maxValue:1490}})});
      workspace.chart?.resize?.(1160,780);d.redraw();
      window.labels=()=>Array.from(d.orderLineContent.querySelectorAll('[data-trading-plan-price-line]')).map(e=>e.textContent);
    `);
    await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await js('d.redraw()');
    assert.equal((await js('labels()')).length,4,'original has entry, stop and only two targets');
    // Register the historical report: the live controller must repaint through
    // its event listener, without resetting drawings or loading another chart.
    await js(`window.reportText='SNDK/USDT 币安永续 1H\\n当前动作：等待条件触发\\n方向判断：偏多\\n策略：裸K分析\\n做多触发价：1391.74\\n止损与失效：1360.64\\n分批止盈：第一目标 1411.46；第二目标 1421.63；第三目标 1453.96\\n风险收益比：1:0.50';
      window.runId='11111111-1111-4111-8111-111111111111';
      window.report={schemaVersion:1,executionPolicy:'right-legacy-v1',runId,resultHash:'a'.repeat(64),locale:${JSON.stringify(locale)},
        marketId:fixture.executionPlan.market.marketId,interval:'60',strategyId:'price-action',report:reportText,
        executionPlan:fixture.executionPlan,drawingPatch:fixture.drawingPatch,origin:null,
        planRecords:contract.legacyReportCandidates(reportText).map((c,i)=>({id:'22222222-2222-4222-8222-000000000000',runId,version:1,
          confirmationHash:'b'.repeat(64),executionPolicy:'right-legacy-v1',monitoringPolicy:'windows_v1',cardIndex:i,card:{title:c.title,content:c.content}}))};
      historyModule.rememberTradingPlanDrawingHistory(d.storageSessionId,[report]);
      window.card=document.createElement('aside');card.className='execution-plan-surface';
      card.style.cssText='position:fixed;right:14px;top:180px;width:310px;padding:16px;border:1px solid #888;border-radius:16px;box-sizing:border-box';
      const s=fixture.executionPlan.scenarios[0];
      card.innerHTML='<h3>SNDK · 1H</h3>'+cards.executionPlanStructuredCardBody({entry:{lower:s.trigger.price},stop:s.stop.price,
        targets:s.targets.map(t=>t.price),direction:s.side},${JSON.stringify(locale==='zh-Hant'?'zh-TW':locale)});
      document.body.append(card);
    `);
    await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const labels=await js('labels()');
    assert.equal(labels.length,5);
    for(const price of ['1391.740','1360.640','1411.460','1421.630','1453.960'])assert.ok(labels.some(t=>t.includes(price)),price);
    assert.ok(labels.some(t=>t.includes(locale==='en'?'TP3':'第3止盈')));
    assert.ok(!labels.some(t=>t.includes('1438.406')));
    const coordinates=await js(`Array.from(d.orderLineContent.querySelectorAll('[data-trading-order-price-level]')).map(e=>{
      const line=e.querySelector('line');return {price:Number(e.dataset.tradingOrderPriceLevel),y:Number(line.getAttribute('y1')),y2:Number(line.getAttribute('y2'))};
    })`);
    const expected=await js('Object.fromEntries([1391.74,1360.64,1411.46,1421.63,1453.96].map(p=>[p,d.getCandleSeries().priceToCoordinate(p)]))');
    coordinates.forEach(p=>{assert.ok(Math.abs(p.y-expected[p.price])<.02);assert.equal(p.y,p.y2);});
    const file=`${theme}-${locale}.png`;
    fs.writeFileSync(path.join(output,file),(await win.webContents.capturePage()).toPNG());
    await js(`d.drawingVisibility.setLayers({plansHidden:true});d.redraw()`);
    assert.equal((await js('labels()')).length,0);
    await js(`d.drawingVisibility.setLayers({plansHidden:false});d.redraw();d.aiDrawings=[];d.redraw()`);
    assert.equal((await js('labels()')).length,0,'cleared history never resurrects');
    await js(`d.aiDrawings=old;workspace.selectedMarketId='BINANCE:FUTURES:ETHUSDT';d.redraw()`);
    assert.equal((await js('labels()')).length,0,'market isolation');
    rows.push({theme,locale,labels,coordinates,screenshot:file,historyRepaired:true,clearedStaysEmpty:true});
  }
  fs.writeFileSync(path.join(output,'visual.json'),JSON.stringify({ok:true,rows},null,2));
  console.log(JSON.stringify({ok:true,cases:rows.length,output}));
  win.webContents.removeAllListeners('console-message');
  setImmediate(()=>app.exit(0));
})().catch(error=>{console.error(error);app.exit(1);});
