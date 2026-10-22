// Real chart/controller in an isolated offscreen window with synthetic data.
// Run from the repository root with HAOLO_QA_PORT pointing to a test Vite server.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/plan-axis-M1-447');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
let win;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1200, height: 850,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^https?:|^wss?:/.test(details.url) && !details.url.startsWith('http://127.0.0.1:') && !details.url.startsWith('ws://127.0.0.1:') });
  });
  const js = code => win.webContents.executeJavaScript(`(async()=>{return await eval(${JSON.stringify(code)})})()`, true);
  const settle = () => js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5189}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
  for (let i = 0; i < 150 && !await js('Boolean(window.ready)'); i++) await pause(50);
  assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
  await js(`(async()=>{
    window.d=workspace.drawingController;
    workspace.loadingHistory=true;
    document.querySelector('#host').style.cssText='width:100%;height:100%';
    d.drawingVisibility.setAll(false);d.drawings=[];d.aiDrawings=[];d.aiDraft=null;d.orderLines=[];
    workspace.candles=workspace.candles.map(c=>({...c,open:c.open*60,high:c.high*60,low:c.low*60,close:c.close*60}));
    workspace.candleSeries.setData(workspace.candles);
    workspace.candleSeries.applyOptions({autoscaleInfoProvider:()=>({priceRange:{minValue:80000,maxValue:83500}})});
    window.setup=language=>{
      const base={source:'ai',symbol:d.getSymbol(),interval:d.getInterval(),strategyId:'price-action'};
      const time=workspace.candles.at(-1).time;
      const levels=[['entry',81766.24],['stop',82584],['target',81146.40],['target',80622],['target',80361.44]];
      d.aiDrawings=levels.map(([role,price],i)=>({...base,id:'level-'+i,tool:'path',
        points:[{time,price},{time:time+3600,price}],colorToken:'strategy-'+role,
        text:language==='en'?role:language==='zh-TW'?'入場 止損 止盈參考':'入场 止损 止盈'}));
      d.redraw();
    };
    window.inspect=()=>{
      const b=d.plotBounds(),axis=workspace.chart.priceScale('right').width();
      const svg=d.orderLineContent.ownerSVGElement,origin=svg.getBoundingClientRect();
      return {bounds:b,axis,svgWidth:+svg.getAttribute('width'),svgHeight:+svg.getAttribute('height'),
        manualWidth:+d.overlay.getAttribute('width'),manualHeight:+d.overlay.getAttribute('height'),
        overflow:getComputedStyle(svg).overflow,pointerEvents:getComputedStyle(svg).pointerEvents,
        labels:[...d.orderLineContent.querySelectorAll('[data-trading-plan-price-line]')].map(g=>{
          const key=g.querySelector('.trading-order-line-label-key').getBoundingClientRect();
          const text=g.querySelector('.trading-order-line-label-text')?.getBoundingClientRect();
          const bg=g.querySelector('.trading-order-line-label-bg').getBoundingClientRect();
          const price=+g.dataset.orderPriceLevel,y=d.getCandleSeries().priceToCoordinate(price);
          return {price,label:g.querySelector('.trading-order-line-key-text').textContent,
            keyRight:key.right-origin.left,priceLeft:text?text.left-origin.left:null,priceRight:text?text.right-origin.left:null,
            center:(bg.top+bg.bottom)/2-origin.top,y,color:getComputedStyle(g).color,
            connector:!!g.querySelector('.trading-order-line-connector'),keyFits:(()=>{
              const t=g.querySelector('.trading-order-line-key-text').getBoundingClientRect();
              return t.left>=key.left-.1&&t.right<=key.right+.1;})()};
        }),strokes:[...d.orderLineContent.querySelectorAll('.trading-order-line-stroke')].map(e=>({
          y:+e.getAttribute('y1'),x2:+e.getAttribute('x2'),dash:getComputedStyle(e).strokeDasharray}))};
    };
  })()`);
  const rows = [];
  function verify(result, id) {
    assert.equal(result.labels.length, 5, id);
    assert.equal(result.svgWidth, result.bounds.width + result.axis, id);
    assert.equal(result.svgHeight, result.bounds.height, id);
    assert.equal(result.manualWidth, result.bounds.width, id);
    assert.equal(result.manualHeight, result.bounds.height, id);
    assert.equal(result.overflow, 'hidden'); assert.equal(result.pointerEvents, 'none');
    result.labels.forEach(label => {
      assert.ok(Math.abs(label.keyRight - result.bounds.width) < .1, JSON.stringify({ id, label, result }));
      assert.ok(Math.abs(label.center - label.y) < .1 && !label.connector, JSON.stringify({ id, label }));
      assert.ok(label.keyFits && label.priceLeft >= result.bounds.width && label.priceRight <= result.svgWidth, JSON.stringify({ id, label }));
      assert.ok(result.strokes.some(s => Math.abs(s.y - label.y) < .02 && s.x2 === result.bounds.width && s.dash !== 'none'));
    });
  }
  for (const theme of ['light', 'dark']) for (const width of [1200, 620]) for (const language of ['zh-CN', 'en', 'zh-TW']) {
    win.setSize(width, 850);
    await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)};workspace.applyChartTheme();setup(${JSON.stringify(language)})`);
    await settle(); await js('d.redraw()');
    let result = await js('inspect()'); const id = `${theme}-${width}-${language}`;
    verify(result, id); rows.push({ id, ...result });
    if (language === 'zh-CN') fs.writeFileSync(path.join(output, `${id}.png`), (await win.webContents.capturePage()).toPNG());
    await js('workspace.chart.timeScale().setVisibleLogicalRange({from:workspace.candles.length-55,to:workspace.candles.length+10});workspace.chart.priceScale("right").applyOptions({scaleMargins:{top:.15,bottom:.12}})');
    await settle(); await js('d.redraw()'); result = await js('inspect()');
    verify(result, `${id}-zoom`); rows.push({ id: `${id}-zoom`, ...result });
  }
  // A nearby account order must not push a plan away from its exact price.
  await js(`d.orderLines=[{id:'account',marketId:d.getSymbol(),price:81768,kind:'take-profit',shortLabel:'止盈',label:'50 USDT',quantityUsdt:50}];d.redraw()`);
  verify(await js('inspect()'), 'nearby-account-order');
  await js('d.drawingVisibility.setLayers({plansHidden:true});d.redraw()');
  assert.equal((await js('inspect()')).labels.length, 0);
  assert.equal(await js('d.orderLineContent.querySelectorAll("[data-trading-order-line]").length'), 1);
  await js('d.drawingVisibility.setLayers({plansHidden:false});d.redraw()');
  verify(await js('inspect()'), 'restored');
  await js('workspace.chart.priceScale("right").applyOptions({visible:false})'); await settle(); await js('d.redraw()');
  const hidden = await js('inspect()');
  assert.equal(hidden.axis, 0); assert.ok(hidden.labels.every(l => l.priceLeft === null));
  assert.equal(hidden.svgWidth, hidden.bounds.width);
  assert.equal(await js('String(window.qaError||"")'), '');
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: rows.length + 4, rows, hiddenAxis: hidden }, null, 2));
  console.log(JSON.stringify({ passed: rows.length + 4, output }));
  win.destroy(); app.quit();
})().catch(async error => {
  console.error(error); fs.writeFileSync(path.join(output, 'failure.txt'), String(error.stack));
  if (win && !win.isDestroyed()) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
  win?.destroy(); app.exit(1);
});
