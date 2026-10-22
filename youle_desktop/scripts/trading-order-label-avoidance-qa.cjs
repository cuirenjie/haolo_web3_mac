// Actual chart/controller in an isolated offscreen Electron window; no account or live workspace.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/order-label-avoidance-M1-398');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
let win;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1200, height: 850,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(`(async()=>{try{return await eval(${JSON.stringify(code)})}catch(error){throw new Error(error.stack)}})()`, true)
    .catch(error => { throw new Error(`${error.message}\nExpression: ${code}`); });
  const settle = () => js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5196}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
  for (let i = 0; i < 100 && !await js('Boolean(window.ready)'); i++) await pause(100);
  assert.equal(await js('Boolean(window.ready)'), true);
  await js(`(async()=>{
    window.d=workspace.drawingController;
    window.collect=(await import('/trading-drawing-label-obstacles.ts')).tradingDrawingLabelObstacles;
    workspace.loadingHistory=true;
    document.querySelector('#host').style.cssText='width:100%;height:100%';
    d.drawingVisibility.setLayers({manualHidden:false,aiHidden:false});d.drawings=[];d.aiDrawings=[];d.aiDraft=null;
    window.setup=(crowded,language)=>{
      const b=d.plotBounds(),point=(x,y)=>d.screenToDrawingPoint({x,y},false);
      const base={source:'ai',symbol:d.getSymbol(),interval:d.getInterval(),strategyId:'price-action'};
      const levels=[['target',.19],['target',.36],['target',.52],['entry',.74],['stop',.91]];
      d.aiDrawings=levels.map(([role,y],i)=>({...base,id:'level-'+i,tool:'path',
        points:[point(b.width*.12,b.height*y),point(b.width*.9,b.height*y)],
        colorToken:'strategy-'+role,text:language==='en'?role:'入场 止损 止盈'}));
      if(crowded){
        d.aiDrawings.push({...base,id:'resistance',tool:'rectangle',colorToken:'strategy-resistance',
          points:[point(b.width*.56,b.height*.36-10),point(b.width*.99,b.height*.45)],
          text:language==='en'?'Resistance zone 1315–1325 (5 touches)':'压力区 1315–1325（5个触点）',fontSize:14});
        d.aiDrawings.push({...base,id:'support',tool:'rectangle',colorToken:'strategy-support',
          points:[point(b.width*.55,b.height*.52-10),point(b.width*.99,b.height*.64)],
          text:language==='en'?'Support zone 1290–1300 (6 touches)':'支撑区 1290–1300（6个触点）',fontSize:14});
        // Native right-side note plus a rotated manual line label.
        d.aiDrawings.push({...base,id:'pattern',tool:'text',colorToken:'strategy-resistance',
          points:[point(b.width*.83,b.height*.19+4)],text:language==='en'?'Doji · pending':'十字星 · 待收盘',fontSize:16});
        d.drawings=[{id:'manual',tool:'trend-line',symbol:d.getSymbol(),interval:d.getInterval(),
          points:[point(b.width*.7,b.height*.73),point(b.width*.98,b.height*.80)],
          text:language==='en'?'Manual support':'手工支撑标注',textVerticalAlign:'middle',textAlign:'right',fontSize:14}];
      }else d.drawings=[];
      d.redraw();
    };
    window.inspect=()=>{
      const bounds=d.plotBounds(),obstacles=collect(d.overlay,[d.content,d.aiContent]);
      const candles=d.visibleCandleObstacles(bounds);
      const overlap=(a,b)=>Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)+.05
        &&Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y)+.05;
      const labels=[...d.orderLineContent.querySelectorAll('.trading-order-line')].map(g=>{
        const bg=g.querySelector('.trading-order-line-label-bg').getBBox();
        const text=g.querySelector('.trading-order-line-label-text').getBBox();
        return {id:g.dataset.tradingOrderLine,x:bg.x,y:bg.y,width:bg.width,height:bg.height,
          textFits:text.x+text.width<=bg.x+bg.width+1,
          annotationHits:obstacles.filter(o=>overlap(bg,o)).length,
          candleHits:candles.filter(o=>overlap(bg,o)).length};
      });
      return {bounds,obstacles:obstacles.length,labels,strokes:[...d.orderLineContent.querySelectorAll('.trading-order-line-stroke')].map(e=>+e.getAttribute('y1'))};
    };
  })()`);
  const reports = [];
  for (const theme of ['light', 'dark']) for (const width of [1200, 620]) for (const language of ['zh-CN', 'en']) {
    win.setSize(width, 850);
    await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)};workspace.applyChartTheme()`);
    await settle();
    await js('workspace.chart.timeScale().setVisibleLogicalRange({from:workspace.candles.length-100,to:workspace.candles.length+12})');
    await settle();
    for (const crowded of [false, true]) {
      await js(`setup(${crowded},${JSON.stringify(language)})`); await settle();
      const result = await js('inspect()');
      const id = `${theme}-${width}-${language}-${crowded ? 'crowded' : 'clear'}`;
      assert.equal(result.labels.length, 5, id);
      assert.ok(result.labels.every(label => label.textFits && label.x >= 0
        && label.x + label.width <= result.bounds.width + 1 && label.annotationHits === 0), JSON.stringify({ id, ...result }));
      if (!crowded) {
        assert.ok(result.labels[0].x + result.labels[0].width > result.bounds.width * .8, id);
        if (width === 1200) assert.ok(result.labels.every(label => label.candleHits === 0), JSON.stringify({ id, ...result }));
      }
      if (crowded) {
        assert.ok(result.obstacles >= 4, id);
        assert.ok(result.labels.some(label => label.x < result.bounds.width * .6), id);
      }
      const first = JSON.stringify(result.labels);
      await js('d.redraw()');
      assert.equal(JSON.stringify((await js('inspect()')).labels), first, 'stable repeated redraw ' + id);
      reports.push({ id, ...result });
      if (language === 'zh-CN') fs.writeFileSync(path.join(output, id + '.png'), (await win.webContents.capturePage()).toPNG());
    }
    // Reproject both price labels and obstacles after real chart zoom/pan.
    await js(`(()=>{const t=workspace.chart.timeScale(),r=t.getVisibleLogicalRange(),span=r.to-r.from;t.setVisibleLogicalRange({from:r.from+span*.12,to:r.to-span*.06});d.redraw()})()`);
    await settle();
    const zoomed = await js('inspect()');
    assert.ok(zoomed.labels.every(label => label.annotationHits === 0), JSON.stringify({ zoomed }));
    reports.push({ id: `${theme}-${width}-${language}-zoom`, ...zoomed });
  }
  // Hide all drawings, including stale annotation obstacles; account levels still render.
  await js(`d.orderLines=[{id:'account',marketId:d.getSymbol(),price:d.aiDrawings[0].points[0].price,kind:'take-profit',shortLabel:'止盈',label:'50 USDT',quantityUsdt:50}];d.drawingVisibility.setLayers({aiHidden:true,manualHidden:true});d.redraw()`);
  const hidden = await js('inspect()');
  assert.equal(hidden.labels.length, 1); assert.equal(hidden.obstacles, 0);
  assert.equal(await js('String(window.qaError||"")'), '');
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: reports.length, reports, hidden }, null, 2));
  console.log(JSON.stringify({ passed: reports.length, output }));
  win.destroy(); app.quit();
})().catch(async error => {
  console.error(error);
  fs.writeFileSync(path.join(output, 'failure.txt'), String(error.stack));
  if (win && !win.isDestroyed()) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
  win?.destroy(); app.exit(1);
});
