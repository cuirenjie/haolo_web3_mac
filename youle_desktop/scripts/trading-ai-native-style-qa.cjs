// Isolated real chart, fixture candles and storage; no account or model requests.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/ai-annotation-restore-M1-441');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, `profile-${Date.now()}`));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { checks: [], screenshots: [] };
let win;
(async () => {
  setTimeout(() => app.exit(1), 90000).unref();
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(`(async()=>{${code}})()`, true);
  const settle = () => js('await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const capture = async name => {
    await settle(); await pause(150);
    fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    report.screenshots.push(name);
  };
  const check = (name, actual, expected = true) => { assert.deepEqual(actual, expected, name); report.checks.push(name); };
  const click = async selector => {
    const p = await js(`const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};`);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...p, button: 'left', clickCount: 1 });
    await settle();
  };
  const init = async () => {
    for (let i = 0; i < 150 && !await js('return Boolean(window.ready)'); i++) await pause(100);
    check('real chart ready', await js('return Boolean(window.ready)'));
    await js(`window.d=workspace.drawingController;workspace.loadingHistory=true;
      document.querySelector('#host').style.cssText='width:100%;height:100%';
      window.nativeStyle=await import('/trading-ai-native-style.ts');
      window.pattern=await import('/trading-patterns.ts');
      window.defaults=await import('/trading-drawing-defaults.ts');
      window.lang=await import('/app-language.mjs');
      window.catalog=(await import('/@fs/${path.join(root, 'src/shared/official-trading-catalog.mjs').replaceAll('\\', '/')}')).OFFICIAL_TRADING_CATALOG;
      window.makePatch=(strategy='harmonic',developing=false,shark=false)=>{
        const candles=d.getCandles(), marketId=d.getSymbol(),interval=d.getInterval(),id='qa-'+strategy;
        const recent=candles.slice(-110),high=Math.max(...recent.map(c=>c.high)),low=Math.min(...recent.map(c=>c.low));
        const prices=[high-5,low+3,high-1,low+18,high-6];
        const points=[-100,-77,-52,-31,-12].map((index,i)=>({time:candles.at(index).time,price:prices[i]}));
        const names=shark?['0','X','A','B','C']:['X','A','B','C','D'];
        const op=(suffix,tool,anchors,text,style={})=>({op:'upsert',drawing:{id:id+'-'+suffix,symbol:marketId,strategyId:strategy,theory:'strategy',layer:'ai/strategy/'+strategy,
          tool,points:anchors,text,colorToken:'strategy-support',locked:true,status:'confirmed',lineWidth:3,...style}});
        const operations=[op(strategy==='harmonic'?(shark?(developing?'0xab-developing':'0xabc'):(developing?'xabc-developing':'xabcd')):'structure','path',points.slice(0,developing?4:5),undefined,{lineStyle:'solid'})];
        if(strategy==='harmonic'){
          points.slice(0,developing?4:5).forEach((p,i)=>operations.push(op('point-'+names[i].toLowerCase(),'text',[{...p,price:p.price+(i%2?-1.5:1.5)}],names[i],{fontSize:14,bold:true})));
          operations.push(op('ratio-line-ab-xa','path',[points[0],points[2]],undefined,{lineStyle:'dotted'}));
          operations.push(op('ratio-label-ab-xa','text',[{time:(points[0].time+points[2].time)/2,price:(points[0].price+points[2].price)/2}],shark?'AB/XA 1.248':'B/XA 0.618',{fontSize:12,bold:true}));
          if(developing){operations.push(op('projected-terminal-leg','path',points.slice(3),undefined,{lineStyle:'dashed',status:'tentative'}));
            operations.push(op('projected-terminal-label','text',[points[4]],names[4]+'? 预测',{fontSize:14}));}
        }
        operations.push(op('region','rectangle',[{...points[3],price:low+10},{...points[4],price:low+6}],undefined,{lineStyle:'dashed'}));
        operations.push(op('summary','note',[points[1]],'PRZ · '+(developing?'发展中 / Developing':'已确认 / Confirmed'),{fontSize:12}));
        return {schemaVersion:1,analysisId:id,drawingTurnId:id+developing+shark,baseRevision:0,marketId,interval,operations};
      };
      window.makeOrderFlowPatch=()=>{
        const patch=makePatch('order-flow');
        for(const op of patch.operations){op.drawing.theory='order-flow';op.drawing.layer='ai/order-flow';delete op.drawing.strategyId;
          op.drawing.colorToken=op.drawing.tool==='path'?'order-flow-structure-bear':op.drawing.tool==='rectangle'?'order-flow-ob-bear':'order-flow-note';}
        const anchor=patch.operations[0].drawing.points.at(-1);
        const add=(suffix,tool,text,token,offset)=>({op:'upsert',drawing:{id:'micro-'+suffix,symbol:patch.marketId,theory:'order-flow',layer:'ai/order-flow',tool,
          points:[{time:anchor.time,price:anchor.price-offset}],text,colorToken:token,status:'confirmed',locked:true,fontSize:12}});
        patch.operations.push(add('pressure-buy-label','note','大额主动买入','order-flow-buy',10),add('pressure-sell-label','note','大额主动卖出','order-flow-sell',12),
          add('cluster-buy-label','note','主动买入失衡区','order-flow-buy',14),add('cluster-sell-label','note','主动卖出失衡区','order-flow-sell',16),
          add('buy-arrow','arrow-up',undefined,'order-flow-buy',10),add('sell-arrow','arrow-down',undefined,'order-flow-sell',12),
          add('poc-label','note','成交密集价 (POC)','order-flow-poc',20),add('structure-label','note','[1H] 趋势转空 (CHoCH)','order-flow-structure-bear',24));
        return patch;
      };`);
    await settle();
  };
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5209}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
  await init();
  await js(`d.clearAllDrawings();d.drawings=[{id:'manual-kept',tool:'trend-line',symbol:d.getSymbol(),points:[{time:d.getCandles().at(-20).time,price:1320},{time:d.getCandles().at(-10).time,price:1325}]}];d.persistDrawings();window.manualBefore=JSON.stringify(d.drawings);window.undoBefore=JSON.stringify(d.redoStack);`);
  for (const theme of ['light', 'dark']) {
    await js(`document.documentElement.dataset.theme='${theme}';d.redraw()`);
    for (const [name, developing, shark] of [['classic', false, false], ['shark-developing', true, true]]) {
      await js(`d.storeAiDrawingPatch(makePatch('harmonic',${developing},${shark}));window.accepted=JSON.stringify(d.aiDrawings);d.redraw();`);
      await settle();
      check(`${theme} ${name} native fills`, await js('return d.aiContent.querySelectorAll("[data-harmonic-fill]").length'), developing ? 1 : 2);
      check(`${theme} ${name} native stroke`, await js('return d.aiContent.querySelector("[data-harmonic-legs]").getAttribute("stroke")'), '#2962ff');
      check(`${theme} ${name} restored plain labels`, await js('return d.aiContent.querySelectorAll("text.trading-ai-inline-label").length'), 6);
      check(`${theme} ${name} no annotation cards`, await js('return d.aiContent.querySelectorAll("[data-ai-harmonic-badge],.trading-manual-note-card").length'), 0);
      check(`${theme} ${name} semantic label colors`, await js('return [...d.aiContent.querySelectorAll("text.trading-ai-inline-label")].every(e=>e.getAttribute("fill").startsWith("var(--trading-ai-"))'));
      check(`${theme} ${name} label hit boxes`, await js(`return [...d.aiContent.querySelectorAll('text.trading-ai-inline-label')].every(text=>{
        const id=text.closest('[data-drawing-id]').dataset.drawingId;return d.aiTextHitContent.querySelector('[data-ai-text-size-trigger="'+id+'"] rect')!==null;});`));
      check(`${theme} ${name} stored logic unchanged`, await js('return JSON.stringify(d.aiDrawings)===accepted'));
      if (developing) {
        check(`${theme} Shark point names`, await js('return [...d.aiContent.querySelectorAll("text.trading-ai-inline-label")].map(e=>e.textContent).slice(0,4)'), ['0','X','A','B']);
        check(`${theme} prediction remains dashed`, await js('return d.aiContent.querySelector("[data-drawing-id$=projected-terminal-leg] polyline").getAttribute("stroke-dasharray")'), '8 5');
      }
      await capture(`${name}-${theme}`);
    }
    for (const strategy of await js('return catalog.map(x=>x.id)')) {
      await js(`d.storeAiDrawingPatch(makePatch('${strategy}'));d.redraw()`); await settle();
      const result = await js(`const drawing=d.aiDrawings[0],g=d.aiContent.querySelector('[data-drawing-id="'+drawing.id+'"]');
        const line=g.querySelector('polyline');return {stroke:line.getAttribute('stroke'),width:Number(line.getAttribute('stroke-width')),native:d.aiContent.querySelector('[data-ai-native-note]')!==null};`);
      if (['price-action','wyckoff'].includes(strategy)) {
        check(`${theme} ${strategy} original width`, result.width, 3);
        check(`${theme} ${strategy} original note`, result.native, false);
        check(`${theme} ${strategy} original semantic color`, result.stroke.startsWith('var(--trading-ai-'), true);
      } else {
        const expected = await js('return nativeStyle.nativeAiDrawingDefaults(d.aiDrawings[0])');
        check(`${theme} ${strategy} native color`, result.stroke, expected.color);
        check(`${theme} ${strategy} native width`, result.width, expected.lineWidth);
        check(`${theme} ${strategy} restored note`, result.native, false);
      }
      check(`${theme} ${strategy} note without background`, await js('return d.aiContent.querySelector(".trading-note rect")===null'));
      check(`${theme} ${strategy} original dashed leader`, await js('return Boolean(d.aiContent.querySelector(".trading-note line[stroke-dasharray]"))'));
    }
    await js(`d.storeAiDrawingPatch(makeOrderFlowPatch());window.orderFlowAccepted=JSON.stringify(d.aiDrawings);d.redraw()`); await settle();
    check(`${theme} order-flow micro text hidden`, await js('return [...d.aiContent.querySelectorAll("[data-drawing-id]")].filter(e=>/micro-(pressure|cluster)/.test(e.dataset.drawingId)).length'), 0);
    check(`${theme} hidden text has no hover targets`, await js('return [...d.aiTextHitContent.querySelectorAll("[data-ai-text-size-trigger]")].filter(e=>/micro-(pressure|cluster)/.test(e.dataset.aiTextSizeTrigger)).length'), 0);
    check(`${theme} hidden text excluded from toolbar`, await js('return d.aiTextDrawingsForCurrentContext().every(x=>!/^micro-(pressure|cluster)/.test(x.id))'));
    check(`${theme} buy/sell arrows preserved`, await js('return d.aiContent.querySelectorAll(".trading-drawing-directional-arrow").length'), 2);
    check(`${theme} POC and structure annotations preserved`, await js('return ["micro-poc-label","micro-structure-label"].every(id=>d.aiContent.querySelector("[data-drawing-id="+id+"] .trading-note"))'));
    check(`${theme} raw order-flow drawings preserved`, await js('return JSON.stringify(d.aiDrawings)===orderFlowAccepted'));
    await capture(`order-flow-${theme}`);
  }
  await js(`d.storeAiDrawingPatch(makePatch('harmonic'));d.redraw()`); await settle();
  const beforeFont = await js('return d.aiDrawings.find(x=>x.tool==="text").fontSize');
  await click('[data-ai-text-size-action="increase"]');
  check('A+ remains effective', await js(`return d.aiDrawings.find(x=>x.tool==='text').fontSize>${beforeFont}`));
  await click('[data-ai-text-size-action="decrease"]');
  check('A- remains effective', await js('return d.aiDrawings.find(x=>x.tool==="text").fontSize'), beforeFont);
  await click('[data-ai-text-size-action="toggle-visibility"]');
  check('hide AI', await js('return d.aiContent.childElementCount'), 0);
  await click('[data-ai-text-size-action="toggle-visibility"]');
  check('show AI', await js('return d.aiContent.querySelectorAll("text.trading-ai-inline-label").length>0'));
  check('manual drawing and redo unchanged', await js('return JSON.stringify(d.drawings)===manualBefore&&JSON.stringify(d.redoStack)===undoBefore'));
  for (const language of ['zh-CN','en','zh-TW']) {
    await js(`lang.applyAppLanguage('${language}',{root:document.body});d.redraw()`); await settle();
    check(`${language} original stored ratio text`, await js('return d.aiContent.querySelector("[data-drawing-id$=ratio-label-ab-xa] text").textContent'), 'B/XA 0.618');
  }
  await win.reload(); await pause(200); await init();
  check('stored history restores plain labels after reload', await js('return d.aiContent.querySelectorAll("text.trading-ai-inline-label").length>0'));
  check('history still contains original server line width', await js('return d.aiDrawings.find(x=>x.id.endsWith("-xabcd")).lineWidth'), 3);
  await js('d.storeAiDrawingPatch(makeOrderFlowPatch());d.redraw()'); await settle();
  await win.reload(); await pause(200); await init();
  check('order-flow history retains four suppressed source labels', await js('return d.aiDrawings.filter(x=>/^micro-(pressure|cluster)/.test(x.id)).length'), 4);
  check('order-flow history keeps source labels hidden', await js('return [...d.aiContent.querySelectorAll("[data-drawing-id]")].filter(e=>/^micro-(pressure|cluster)/.test(e.dataset.drawingId)).length'), 0);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({checks:report.checks.length,screenshots:report.screenshots,output}));
  app.exit(0);
})().catch(async error=>{
  fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack));
  if(win)fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());
  console.error(error);app.exit(1);
});
