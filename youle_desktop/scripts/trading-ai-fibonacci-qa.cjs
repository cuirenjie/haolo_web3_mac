// Isolated real chart, synthetic candles and local profile. No account/model requests.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/ai-fibonacci-M1-459');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, `profile-${Date.now()}`));
app.disableHardwareAcceleration();
const pause = ms => new Promise(r => setTimeout(r, ms));
const rows = []; let win;
(async () => {
  setTimeout(() => app.exit(1), 90000).unref();
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 920, webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(http:\/\/127\.0\.0\.1:|data:|blob:|devtools:)/.test(details.url) }));
  const js = code => win.webContents.executeJavaScript(`(async()=>{${code}})()`, true);
  const settle = () => js('await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));d.redraw();');
  const init = async () => {
    for (let i = 0; i < 150 && !await js('return Boolean(window.ready)'); i++) await pause(50);
    assert.ok(await js('return Boolean(window.ready)'));
    await js(`window.d=workspace.drawingController;workspace.loadingHistory=true;
      document.querySelector('#host').style.cssText='width:100%;height:100%';
      window.languageModule=await import('/app-language.mjs');
      window.setup=(language,side)=>{
        languageModule.applyAppLanguage(language,{root:document.body});
        d.drawingVisibility.setAll(false);workspace.chartNavigation.setAutoScale(false);
        d.getChart().priceScale('right').setVisibleRange({from:1270,to:1380});
        d.getChart().timeScale().setVisibleLogicalRange({from:400,to:515});
        const candles=d.getCandles(),time=candles.at(-8).time,end=candles.at(-5).time;
        const sign=side==='long'?1:-1,zero=side==='long'?1290:1360,span=60;
        window.makePatch=()=>{
          const base={symbol:d.getSymbol(),interval:d.getInterval(),theory:'wave',layer:'ai/wave',locked:true,status:'tentative',colorToken:'wave-fibonacci',evidenceIds:['a','b']};
          const op=(id,tool,points,text,extra={})=>({op:'upsert',drawing:{...base,id,tool,points,text,...extra}});
          return {schemaVersion:1,analysisId:'qa-wave',drawingTurnId:'qa-fib',baseRevision:0,marketId:d.getSymbol(),interval:d.getInterval(),operations:[
            op('qa-wave-structure','path',[{time: candles.at(-90).time,price:1300},{time:candles.at(-65).time,price:1357},{time:candles.at(-30).time,price:1310},{time,price:zero}],undefined,{colorToken:'wave-primary'}),
            ...[.382,.618,1].flatMap(ratio=>{const price=zero+sign*span*ratio;return [
              op('qa-wave-fib-'+ratio,'path',[{time,price},{time:end,price}]),
              op('qa-wave-fib-'+ratio+'-label','note',[{time:end,price}],'Fib '+ratio)];}),
            op('qa-wave-summary','note',[{time:end,price:zero+sign*span*.618}],language==='en'?'Structure confirmation':language==='zh-TW'?'結構確認':'结构确认',{colorToken:'wave-note'}),
          ]};
        };
        d.storeAiDrawingPatch(makePatch());
        d.orderLines=[{id:'qa-plan',marketId:d.getSymbol(),kind:'plan-entry',price:zero+sign*span*.618,shortLabel:language==='en'?'Entry long':language==='zh-TW'?'入場做多':'入场做多',label:'Entry',labelMode:'price'}];
        window.before=JSON.stringify(d.aiDrawings);d.redraw();
      };
      window.inspect=()=>{
        const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
        const lines=[...d.aiContent.querySelectorAll('.trading-fibonacci-level-line')];
        return {same:before===JSON.stringify(d.aiDrawings),bounds:rect(d.overlay),
          lines:lines.map(e=>({ratio:+e.parentElement.dataset.fibonacciLevel,x1:+e.getAttribute('x1'),x2:+e.getAttribute('x2'),y:+e.getAttribute('y1'),color:e.getAttribute('stroke'),width:e.getAttribute('stroke-width'),dash:e.getAttribute('stroke-dasharray')})),
          labels:[...d.aiContent.querySelectorAll('.trading-fibonacci-label')].map(e=>({text:e.textContent,...rect(e)})),
          notes:[...d.aiContent.querySelectorAll('.trading-note text')].map(rect),
          bands:d.aiContent.querySelectorAll('.trading-fibonacci-band').length,
          oldLabels:d.aiContent.querySelectorAll('[data-drawing-id$="-label"]').length,
          planStrokes:[...d.orderLineContent.querySelectorAll('.trading-order-line-stroke')].map(rect),
          expected:d.aiDrawings.filter(e=>/-fib-[0-9.]+$/.test(e.id)).map(e=>({ratio:+e.id.split('-fib-')[1],y:d.getCandleSeries().priceToCoordinate(e.points[0].price)}))};
      };`);
  };
  const overlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
  const verify = async id => {
    const r=await js('return inspect()');
    assert.ok(r.same,id+' raw immutable'); assert.equal(r.lines.length,3,id);assert.equal(r.labels.length,3,id);assert.equal(r.bands,2,id);assert.equal(r.oldLabels,0,id);
    for(const line of r.lines){assert.equal(line.width,'2');assert.equal(line.dash,null);assert.ok(line.x2-line.x1>=150,id+' width');assert.ok(Math.abs(line.y-r.expected.find(e=>e.ratio===line.ratio).y)<1e-8,id+' exact price');}
    for(const label of r.labels){assert.ok(label.x>=r.bounds.x&&label.x+label.width<=r.bounds.x+r.bounds.width,id+' labels in plot');
      for(const other of [...r.notes,...r.planStrokes.map(s=>({...s,y:s.y-.5,height:1}))])assert.ok(!overlap(label,other),JSON.stringify({id,label,other}));}
    rows.push({id,...r});
  };
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5213}/@fs/${path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/')}`);
  await init();
  for(const theme of ['light','dark']) for(const width of [1400,720]) for(const language of ['zh-CN','en','zh-TW']) for(const side of ['long','short']){
    win.setSize(width,920);await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();setup('${language}','${side}');`);await settle();
    const id=[theme,width,language,side].join('-');await verify(id);
    if(language==='zh-CN'&&side==='long')fs.writeFileSync(path.join(output,id+'.png'),(await win.webContents.capturePage()).toPNG());
    await js('d.getChart().timeScale().setVisibleLogicalRange({from:430,to:510});');await settle();await verify(id+'-zoom');
  }
  await js('d.hoveredAiTextDrawingId="qa-wave-summary";d.adjustAiTextFontSize("increase");window.before=JSON.stringify(d.aiDrawings);');await settle();await verify('font-increase');
  assert.equal(await js('return d.aiContent.querySelector(".trading-fibonacci-label").style.fontSize'),'13px');
  await js('d.drawingVisibility.setLayers({aiHidden:true});d.redraw()');assert.equal(await js('return d.aiContent.children.length'),0);
  await js('d.drawingVisibility.setLayers({aiHidden:false});d.redraw()');await verify('restore-visibility');
  await win.reload();await pause(150);await init();
  await js('workspace.chartNavigation.setAutoScale(false);d.getChart().priceScale("right").setVisibleRange({from:1270,to:1380});d.getChart().timeScale().setVisibleLogicalRange({from:400,to:515});window.before=JSON.stringify(d.aiDrawings)');await settle();await verify('history-reload');
  await js('setup("zh-CN","long");window.patch=makePatch();window.original=JSON.stringify(patch);await d.playAiDrawingPatch(patch,{speedMultiplier:30});window.before=JSON.stringify(d.aiDrawings);');await settle();await verify('playback');
  assert.ok(await js('return original===JSON.stringify(patch)'));
  await js('workspace.splitLayoutId="2-columns";workspace.applySplitLayout();');
  for(let i=0;i<100&&!await js('return Boolean(workspace.splitPanes[0]?.candles.length)');i++)await pause(50);
  await js('window.d=workspace.splitPanes[0].getDrawingController();setup("zh-TW","short");');await settle();await verify('split-pane');
  assert.equal(await js('return String(window.qaError||"")'),'');
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:rows.length,rows},null,2));
  console.log(JSON.stringify({passed:rows.length,output}));app.exit(0);
})().catch(async error=>{
  fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack));
  if(win)fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());
  console.error(error);app.exit(1);
});
