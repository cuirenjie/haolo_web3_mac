// Isolated actual chart/controller; synthetic prices, no user profile or remote requests.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/ai-plan-label-M1-451');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
let win;
const pause = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1200, height: 850, webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({
    cancel: /^(https?|wss?):/.test(details.url) && !/^(http|ws):\/\/127\.0\.0\.1:/.test(details.url),
  }));
  const js = code => win.webContents.executeJavaScript(`(async()=>{${code}})()`, true);
  const settle = () => js('await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));d.redraw();');
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5221}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
  for (let i = 0; i < 150 && !await js('return Boolean(window.ready)'); i++) await pause(50);
  assert.equal(await js('return Boolean(window.ready)'), true);
  await js(`window.d=workspace.drawingController;workspace.loadingHistory=true;
    document.querySelector('#host').style.cssText='width:100%;height:100%';
    d.drawingVisibility.setAll(false);d.drawings=[];d.aiDrawings=[];d.aiDraft=null;d.orderLines=[];
    window.languageModule=await import('/app-language.mjs');
    window.setup=(language,side,size)=>{
      languageModule.applyAppLanguage(language,{root:document.body});
      workspace.chartNavigation.setAutoScale(false);
      workspace.chart.priceScale('right').setVisibleRange({from:1280,to:1380});
      workspace.chart.timeScale().setVisibleLogicalRange({from:400,to:508});
      const time=workspace.candles.at(-1).time;
      const base={source:'ai',symbol:d.getSymbol(),interval:d.getInterval(),strategyId:'price-action',fontSize:size};
      const text=language==='en'?'Entry '+side:(language==='zh-CN'?'入场':'入場')+'做'+(side==='long'?'多':'空');
      const stop=side==='long'?1290:1360,targets=side==='long'?[1330,1332,1360]:[1310,1308,1290];
      d.aiDrawings=[['entry',1320],['stop',stop],...targets.map(p=>['target',p])].map(([role,price],i)=>({
        ...base,id:'plan-'+i,tool:'path',points:[{time,price},{time:time+3600,price}],colorToken:'strategy-'+role,
        text:role==='entry'?text:language==='en'?role:language==='zh-CN'?'止损 止盈':'止損 止盈',
      }));
      const labels=language==='en'?['Bullish harami cross · awaiting close','Bottom fractal','Support confirmation']:
        language==='zh-CN'?['看涨十字孕线 · 待收盘','底分型','支撑确认']:['看漲十字孕線 · 待收盤','底分型','支撐確認'];
      for(const [i,tool] of ['text','text','note'].entries()) d.aiDrawings.push({...base,
        id:i===0?'test-candlestick-pattern-label-0':'annotation-'+i,tool,text:labels[i],
        points:[{time:time+(i===1?3600*4:0),price:i===0?1320:targets[0]}],colorToken:'price-action-candlestick'});
      window.before=JSON.stringify(d.aiDrawings);window.expectedEntry=text;d.redraw();
    };
    window.inspect=()=>{
      const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
      return {bounds:d.plotBounds(),same:before===JSON.stringify(d.aiDrawings),expectedEntry,
        texts:[...d.aiContent.querySelectorAll('text')].map(e=>({text:e.textContent,...rect(e)})),
        hits:[...d.aiTextHitContent.querySelectorAll('.trading-ai-text-size-hit-target')].map(rect),
        badges:[...d.orderLineContent.querySelectorAll('.trading-order-line-label-bg')].map(rect),
        strokes:[...d.orderLineContent.querySelectorAll('.trading-order-line-stroke')].map(rect),
        plans:[...d.orderLineContent.querySelectorAll('[data-trading-plan-price-line]')].map(g=>{
          const key=g.querySelector('.trading-order-line-label-key'),text=g.querySelector('.trading-order-line-key-text');
          const b=rect(key),t=rect(text),price=+g.dataset.orderPriceLevel;
          return {label:text.textContent,fits:t.x>=b.x-.1&&t.x+t.width<=b.x+b.width+.1,
            y:+key.getAttribute('y')+ +key.getAttribute('height')/2,priceY:d.getCandleSeries().priceToCoordinate(price)};
        })};
    };`);
  const overlaps = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
  const rows=[];
  function verify(result,id) {
    assert.equal(result.same,true,id+' immutable');
    assert.equal(result.plans.length,5,id+' plans');assert.equal(result.texts.length,3,id+' annotations');
    assert.equal(result.plans[0].label,result.expectedEntry,id+' direction');
    for(const plan of result.plans) {assert.ok(plan.fits,id+' key width');assert.ok(Math.abs(plan.y-plan.priceY)<.02,id+' exact price');}
    for(const text of result.texts) {
      assert.ok(result.badges.every(b=>!overlaps(text,b)),JSON.stringify({id,text,reason:'badge'}));
      assert.ok(result.strokes.every(b=>!overlaps(text,{...b,y:b.y-.5,height:1})),JSON.stringify({id,text,reason:'stroke'}));
      assert.ok(result.hits.some(h=>h.x<=text.x&&h.x+h.width>=text.x+text.width&&h.y<=text.y&&h.y+h.height>=text.y+text.height),JSON.stringify({id,text,hits:result.hits,reason:'hover follows text'}));
    }
    rows.push({id,...result});
  }
  for(const theme of ['light','dark']) for(const width of [1200,620]) for(const language of ['zh-CN','en','zh-TW']) for(const side of ['long','short']) {
    win.setSize(width,850);
    await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();setup('${language}','${side}',${width===620?16:12});`);
    await settle();const id=[theme,width,language,side].join('-');verify(await js('return inspect()'),id);
    if(language==='zh-CN'&&side==='long'||theme==='dark'&&width===620&&language==='en'&&side==='short')
      fs.writeFileSync(path.join(output,id+'.png'),(await win.webContents.capturePage()).toPNG());
    await js('workspace.chart.timeScale().setVisibleLogicalRange({from:430,to:511});workspace.chart.priceScale("right").setVisibleRange({from:1270,to:1390});');
    await settle();verify(await js('return inspect()'),id+'-zoom');
  }
  await js('d.drawingVisibility.setLayers({plansHidden:true});d.redraw()');
  assert.equal((await js('return inspect()')).plans.length,0);
  await js('d.drawingVisibility.setLayers({plansHidden:false});d.redraw()');verify(await js('return inspect()'),'restored');
  await js('workspace.chart.priceScale("right").applyOptions({invertScale:true});');await settle();verify(await js('return inspect()'),'inverted');
  await js('workspace.chart.priceScale("right").applyOptions({visible:false});');await settle();verify(await js('return inspect()'),'hidden-axis');
  assert.equal(await js('return String(window.qaError||"")'),'');
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:rows.length+1,rows},null,2));
  console.log(JSON.stringify({passed:rows.length+1,output}));win.destroy();app.quit();
})().catch(async error=>{
  console.error(error);fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack));
  if(win&&!win.isDestroyed()) fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());
  win?.destroy();app.exit(1);
});
