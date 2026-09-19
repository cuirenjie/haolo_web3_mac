const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const workspaceDirectory=path.resolve(__dirname,'..');
const outputDirectory=path.join(workspaceDirectory,'.cache','tradingview-navigation');
fs.mkdirSync(outputDirectory,{recursive:true});
app.setPath('userData',path.join(outputDirectory,'profile'));
app.disableHardwareAcceleration();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await app.whenReady();
 const w=new BrowserWindow({show:false,width:1200,height:800,webPreferences:{backgroundThrottling:false,offscreen:true}});
 const js=s=>w.webContents.executeJavaScript(s,true);
 const report={checks:[],errors:[],interactions:[]};
 w.webContents.on('console-message',(_e,level,message)=>{if(level===3)report.errors.push(message.slice(0,350));});
 const state=()=>js(`(()=>{const c=workspace.chart,s=c.priceScale('right',0),r=c.panes()[0].getHTMLElement().getBoundingClientRect();return {range:c.timeScale().getVisibleLogicalRange(),price:s.getVisibleRange(),auto:s.options().autoScale,y:(workspace.candleSeries||workspace.series).priceToCoordinate(1330),rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},guideY:Number(workspace.drawingController?.overlay.querySelector('[data-drawing-id="qa-guide"] line')?.getAttribute('y1')??NaN),chartRight:workspace.chartElement.getBoundingClientRect().right}})()`);
 async function drag(x,y,dx,dy,shift=false){
  w.webContents.sendInputEvent({type:'mouseMove',x,y});
  w.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1,modifiers:shift?['shift']:[]});
  for(let i=1;i<=12;i++){w.webContents.sendInputEvent({type:'mouseMove',x:Math.round(x+dx*i/12),y:Math.round(y+dy*i/12),button:'left',modifiers:shift?['leftButtonDown','shift']:['leftButtonDown']});await pause(18);if(i===8)await fs.promises.writeFile(path.join(outputDirectory,`navigation-${await js('document.documentElement.dataset.theme')}-${await js('workspace.candleSeries ? "main" : "split"')}-selection.png`),(await w.webContents.capturePage()).toPNG());}
  w.webContents.sendInputEvent({type:'mouseUp',x:x+dx,y:y+dy,button:'left',clickCount:1});await pause(200);
 }
 for(const theme of ['light','dark']) {
  await w.loadURL('http://127.0.0.1:5183/@fs/'+path.join(workspaceDirectory,'test','fixtures','trading-chart-navigation.html').replaceAll('\\','/')+'?theme='+theme);
  for(let i=0;i<150&&!await js('Boolean(window.ready)');i++)await pause(100);
  assert.equal(await js('Boolean(window.ready)'),true,await js('String(window.qaError)'));
  await js(`document.documentElement.dataset.theme='${theme}';workspace.loadingHistory=true;workspace.chartSettings.priceScaleMode='linear';workspace.chartSettings.scaleAnchor='right';workspace.applyChartTheme();`);await pause(350);
  await js(`(()=>{const d=workspace.drawingController;d.aiDrawings=[{id:'qa-guide',tool:'horizontal-line',symbol:workspace.selectedMarketId,interval:workspace.activeInterval,source:'ai',colorToken:'chan-note',points:[{time:workspace.candles.at(-30).time,price:1330}]}];d.redraw()})()`);
  const initial=await state();
  console.log('initial',theme,JSON.stringify(initial));
  const x=Math.round(initial.rect.left+300), y=Math.round(initial.rect.top+130);
  await drag(x,y,0,90);const vertical=await state();
  assert.ok(vertical.y-initial.y>60,JSON.stringify({initial,vertical}));
  assert.ok(Math.abs(vertical.guideY-vertical.y)<1,JSON.stringify(vertical));
  assert.equal(vertical.auto,false);assert.ok(Math.abs(vertical.range.from-initial.range.from)<0.01);
  await js('workspace.updateChartData({preserveViewport:true})');await pause(200);
  const refresh=await state();assert.ok(Math.abs(refresh.y-vertical.y)<0.1);
  await drag(x,y,100,-55);const diagonal=await state();
  assert.ok(Math.abs(diagonal.range.from-vertical.range.from)>5);
  assert.ok(diagonal.y<vertical.y-30);
  const axisX=Math.round(initial.chartRight-20);
  await drag(axisX,y,0,85);const scaled=await state();
  assert.ok(Math.abs((scaled.price.to-scaled.price.from)/(diagonal.price.to-diagonal.price.from)-1)>0.1);
  await js(`document.documentElement.dataset.theme='${theme==='light'?'dark':'light'}'`);await pause(300);
  const themed=await state();assert.deepEqual(themed.price,scaled.price);assert.ok(Math.abs(themed.y-scaled.y)<1.5,JSON.stringify({scaled,themed}));
  await js(`document.documentElement.dataset.theme='${theme}'`);await pause(250);
  await fs.promises.writeFile(path.join(outputDirectory,`navigation-${theme}-manual.png`),(await w.webContents.capturePage()).toPNG());
  w.webContents.sendInputEvent({type:'mouseDown',x:axisX,y,button:'left',clickCount:1});
  w.webContents.sendInputEvent({type:'mouseUp',x:axisX,y,button:'left',clickCount:1});await pause(50);
  w.webContents.sendInputEvent({type:'mouseDown',x:axisX,y,button:'left',clickCount:2});
  w.webContents.sendInputEvent({type:'mouseUp',x:axisX,y,button:'left',clickCount:2});await pause(300);
  const reset=await state();assert.equal(reset.auto,true);
  await fs.promises.writeFile(path.join(outputDirectory,`navigation-${theme}-reset.png`),(await w.webContents.capturePage()).toPNG());

  await drag(x,y,250,120,true);
  assert.equal(await js('document.querySelectorAll(".trading-chart-measurement").length'),1);
  assert.deepEqual((await state()).range,reset.range);
  assert.equal((await state()).auto,true);
  assert.ok((await js('document.querySelector(".trading-chart-measurement-label").textContent')).includes('%'));
  await js(`document.querySelector('[data-drawing-action="zoom-in"]').click()`);
  assert.equal(await js('workspace.chartNavigation.getTool()'),'zoom');
  await drag(x,y,400,220,false);const boxed=await state();
  assert.ok(boxed.range.to-boxed.range.from<60,JSON.stringify(boxed));
  assert.ok(boxed.price.to-boxed.price.from<reset.price.to-reset.price.from);
  assert.equal(await js('document.querySelectorAll(".trading-chart-zoom-selection").length'),0);
  const preWheel=await state();
  w.webContents.sendInputEvent({type:'mouseWheel',x,y,deltaY:-100,deltaX:0});await pause(200);
  const wheel=await state();assert.notEqual(wheel.range.to-wheel.range.from,preWheel.range.to-preWheel.range.from);
  assert.deepEqual(wheel.price,preWheel.price);assert.ok(Math.abs(wheel.guideY-wheel.y)<1);
  await js(`(()=>{const t=workspace.candles[0];const older=Array.from({length:20},(_,i)=>({...t,time:t.time-(20-i)*3600}));const r=workspace.chart.timeScale().getVisibleLogicalRange();workspace.candles=[...older,...workspace.candles];workspace.updateChartData();workspace.chart.timeScale().setVisibleLogicalRange({from:r.from+20,to:r.to+20});})()`);await pause(150);
  assert.deepEqual((await state()).price,wheel.price);
  for(const mode of ['logarithmic','percentage','linear']) {
    await js(`workspace.chartSettings.priceScaleMode='${mode}';workspace.applyChartTheme()`);await pause(150);
    const modeState=await state();assert.ok(Number.isFinite(modeState.y),JSON.stringify(modeState));
    assert.equal(modeState.auto,true);
    if(mode==='logarithmic') {
      await drag(x,y,0,40);const manualLog=await state();
      await js(`document.documentElement.dataset.theme='${theme==='light'?'dark':'light'}'`);await pause(150);
      const themedLog=await state();assert.ok(Number.isFinite(themedLog.y));assert.deepEqual(themedLog.price,manualLog.price);
      await js(`document.documentElement.dataset.theme='${theme}'`);await pause(100);
    }
  }


  async function doubleAt(cx,cy,mods=[]) {
    for(const clickCount of [1,2]) {w.webContents.sendInputEvent({type:'mouseDown',x:cx,y:cy,button:'left',clickCount,modifiers:mods});w.webContents.sendInputEvent({type:'mouseUp',x:cx,y:cy,button:'left',clickCount,modifiers:mods});await pause(60)}await pause(180);
  }
  const paneHeights=await js('workspace.chart.panes().map(p=>p.getHeight())');
  await doubleAt(x,y);const expandedHeights=await js('workspace.chart.panes().map(p=>p.getHeight())');
  assert.ok(expandedHeights[0]>paneHeights[0]);assert.ok(expandedHeights[1]<=3);
  await doubleAt(x,y);const restoredHeights=await js('workspace.chart.panes().map(p=>p.getHeight())');
  assert.ok(Math.abs(restoredHeights[0]-paneHeights[0])<2);
  await doubleAt(x,y,['control']);assert.ok(await js('workspace.chart.panes()[0].getHeight()')<=31);
  const collapsedY=await js('Math.round(workspace.chart.panes()[0].getHTMLElement().getBoundingClientRect().top+20)');
  await doubleAt(x,collapsedY,['control']);assert.ok(Math.abs(await js('workspace.chart.panes()[0].getHeight()')-paneHeights[0])<3);
  // Real wheel modifiers: rightmost bar stays fixed by default, Ctrl holds the cursor bar.
  await js('workspace.chartNavigation.reset();workspace.chartElement.focus()');await pause(250);
  const rightBefore=await state();
  w.webContents.sendInputEvent({type:'mouseWheel',x,y,deltaY:80,deltaX:0});await pause(180);
  const rightAfter=await state();assert.ok(Math.abs(rightAfter.range.to-rightBefore.range.to)<1,JSON.stringify({rightBefore,rightAfter}));
  const logicalAt=()=>js(`workspace.chart.timeScale().coordinateToLogical(${x}-workspace.chart.panes()[0].getHTMLElement().getBoundingClientRect().left)`);
  const cursorBefore=await logicalAt();
  w.webContents.sendInputEvent({type:'mouseWheel',x,y,deltaY:80,deltaX:0,modifiers:['control']});await pause(180);
  const cursorAfter=await logicalAt();assert.ok(Math.abs(cursorBefore-cursorAfter)<1.1,JSON.stringify({cursorBefore,cursorAfter}));
  const shiftBefore=await state();
  w.webContents.sendInputEvent({type:'mouseWheel',x,y,deltaY:80,deltaX:0,modifiers:['shift']});await pause(180);
  const shiftAfter=await state();assert.ok(Math.abs(shiftBefore.range.from-shiftAfter.range.from)>1);
  assert.ok(Math.abs((shiftBefore.range.to-shiftBefore.range.from)-(shiftAfter.range.to-shiftAfter.range.from))<0.01);
  const axisBefore=await state();
  w.webContents.sendInputEvent({type:'mouseWheel',x:axisX,y,deltaY:80,deltaX:0});await pause(180);
  const axisAfter=await state();assert.deepEqual(axisAfter.range,axisBefore.range);assert.equal(axisAfter.auto,false);assert.notDeepEqual(axisAfter.price,axisBefore.price);
  const key=async(keyCode,modifiers=[])=>{w.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});w.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await pause(160)};
  await js('workspace.chartElement.focus()');await key('r',['alt']);assert.equal((await state()).auto,true);
  const keyBefore=await state();await key('Left');const keyAfter=await state();assert.ok(Math.abs(keyAfter.range.from-keyBefore.range.from+1)<0.01);
  await key('Up',['control']);assert.ok((await state()).range.to-(await state()).range.from<keyAfter.range.to-keyAfter.range.from);
  await key('l',['alt']);assert.equal(await js('workspace.chart.priceScale("right").options().mode'),1);
  await key('p',['alt']);assert.equal(await js('workspace.chart.priceScale("right").options().mode'),2);
  await key('i',['alt']);assert.equal(await js('workspace.chart.priceScale("right").options().invertScale'),true);
  await key('i',['alt']);
  await js(`(()=>{const i=document.createElement('input');i.id='qa-input';document.body.append(i);i.focus()})()`);
  const typingBefore=await state();await key('Left');assert.deepEqual((await state()).range,typingBefore.range);
  await js('document.querySelector("#qa-input").remove()');
  // Box geometry in each supported price mode, including a sub-penny market.
  await js('window.qaOriginalCandles=workspace.candles.map(c=>({...c}))');
  for(const multiplier of [1,0.00000001]) for(const mode of ['linear','logarithmic','percentage']) {
    await js(`workspace.candles=qaOriginalCandles.map(c=>({...c,open:c.open*${multiplier},high:c.high*${multiplier},low:c.low*${multiplier},close:c.close*${multiplier}}));workspace.chartSettings.priceScaleMode='${mode}';workspace.applyChartTheme();workspace.updateChartData({resetViewport:true});`);await pause(200);
    const box=await js(`(()=>{const r=workspace.chart.panes()[0].getHTMLElement().getBoundingClientRect();return {x:Math.round(r.left+180),y:Math.round(r.top+110)}})()`);
    const targetPrice=await js(`workspace.candleSeries.coordinateToPrice(${box.y}-workspace.chart.panes()[0].getHTMLElement().getBoundingClientRect().top)`);
    await js(`document.querySelector('[data-drawing-action="zoom-in"]').click()`);
    await drag(box.x,box.y,360,220);
    const afterY=await js(`workspace.candleSeries.priceToCoordinate(${targetPrice})`);
    const expectedY=await js('workspace.chart.panes()[0].getHeight()*workspace.chart.priceScale("right").options().scaleMargins.top');
    assert.ok(Math.abs(afterY-expectedY)<20,JSON.stringify({multiplier,mode,afterY,expectedY}));
    if(mode==='percentage') {
      const pBefore=await state();await drag(axisX,y,0,70);const pAfter=await state();
      assert.notDeepEqual(pBefore.price,pAfter.price);assert.deepEqual(pBefore.range,pAfter.range);
    }
    report.interactions.push({theme,multiplier,mode,afterY,expectedY});
  }
  await js(`workspace.candles=qaOriginalCandles;workspace.chartSettings.priceScaleMode='linear';workspace.applyChartTheme();workspace.updateChartData({resetViewport:true});`);await pause(200);
  // Two clicks complete the tool; Esc cancels; Shift produces a transient ruler.
  async function clickAt(cx,cy,mods=[]) {w.webContents.sendInputEvent({type:'mouseDown',x:cx,y:cy,button:'left',clickCount:1,modifiers:mods});w.webContents.sendInputEvent({type:'mouseUp',x:cx,y:cy,button:'left',clickCount:1,modifiers:mods});await pause(120)}
  await js(`document.querySelector('[data-drawing-action="zoom-in"]').click()`);
  await clickAt(x,y);assert.equal(await js('Boolean(workspace.chartNavigation.selection)'),true);
  await clickAt(x+260,y+170);assert.equal(await js('Boolean(workspace.chartNavigation.selection)'),false);
  await js(`document.querySelector('[data-drawing-action="zoom-in"]').click()`);await clickAt(x,y);await key('Escape');
  assert.equal(await js('workspace.chartNavigation.getTool()'),null);
  await drag(x,y,200,130,true);
  await fs.promises.writeFile(path.join(outputDirectory,`tradingview-${theme}-measure.png`),(await w.webContents.capturePage()).toPNG());
  await key('Escape');assert.equal(await js('document.querySelectorAll(".trading-chart-measurement").length'),0);
  w.webContents.sendInputEvent({type:'mouseDown',x,y,button:'right',clickCount:1});w.webContents.sendInputEvent({type:'mouseUp',x,y,button:'right',clickCount:1});await pause(160);
  assert.equal(await js('document.querySelectorAll(".trading-chart-navigation-menu").length'),1);
  await fs.promises.writeFile(path.join(outputDirectory,`tradingview-${theme}-menu.png`),(await w.webContents.capturePage()).toPNG());
  await key('Escape');assert.equal(await js('document.querySelectorAll(".trading-chart-navigation-menu").length'),0);
  // Native time axis drag changes only horizontal zoom.
  const timeY=await js('Math.round(workspace.chartElement.getBoundingClientRect().bottom-12)');const timeBefore=await state();
  await drag(x,timeY,120,0);const timeAfter=await state();assert.notEqual(timeBefore.range.to-timeBefore.range.from,timeAfter.range.to-timeAfter.range.from);
  assert.deepEqual(timeBefore.price,timeAfter.price);

  await js(`workspace.activateDrawingController(workspace.drawingController);document.querySelector('[data-drawing-action="zoom-in"]').click()`);
  const indicatorPoint=await js('(()=>{const r=workspace.chart.panes()[1].getHTMLElement().getBoundingClientRect();return {x:Math.round(r.left+120),y:Math.round(r.top+40)}})()');
  await clickAt(indicatorPoint.x,indicatorPoint.y);
  assert.equal(await js('workspace.chartNavigation.selection?.kind'),'zoom');
  await key('Escape');assert.equal(await js('document.querySelector("[data-drawing-action=zoom-in]").getAttribute("aria-pressed")'),'false');
  for(const [letter,tool] of [['t','trend-line'],['f','fib-retracement'],['h','horizontal-line'],['v','vertical-line']]) {
    await key(letter,['alt']);assert.equal(await js('workspace.activeDrawingController.activeTool'),tool);
    await key('Escape');
  }
  await js(`window.primary=workspace;primary.splitLayoutId='2-columns';primary.applySplitLayout()`);
  for(let i=0;i<100&&!await js('primary.splitPanes[0]?.candles.length');i++)await pause(50);
  await js('window.workspace=primary.splitPanes[0];void 0');await pause(250);
  const splitInitial=await state();const sx=Math.round(splitInitial.rect.left+150),sy=Math.round(splitInitial.rect.top+150);
  await drag(sx,sy,0,90);const splitDragged=await state();
  assert.ok(splitDragged.y-splitInitial.y>60,JSON.stringify({splitInitial,splitDragged}));
  await js('workspace.updateData()');await pause(150);assert.deepEqual((await state()).price,splitDragged.price);
  await js(`workspace.updateSettings(primary.chartSettings,'${theme==='light'?'dark':'light'}')`);await pause(150);
  assert.deepEqual((await state()).price,splitDragged.price);
  await js(`workspace.updateSettings(primary.chartSettings,'${theme}')`);await pause(120);
  await js(`document.querySelector('[data-drawing-action="zoom-in"]').click()`);
  assert.equal(await js('workspace.chartNavigation.getTool()'),'zoom');
  await drag(sx,sy,180,180,false);const splitBoxed=await state();
  assert.ok(splitBoxed.range.to-splitBoxed.range.from<splitInitial.range.to-splitInitial.range.from);

  const primaryBeforeKey=await js('primary.chart.timeScale().getVisibleLogicalRange()');
  await js('workspace.chartElement.focus()');await key('Left');
  assert.deepEqual(await js('primary.chart.timeScale().getVisibleLogicalRange()'),primaryBeforeKey);
  const splitWidth=await js('workspace.chartElement.clientWidth');
  await key('Enter',['alt']);assert.ok(await js('workspace.chartElement.clientWidth')>splitWidth*1.5);
  await key('Enter',['alt']);assert.ok(Math.abs(await js('workspace.chartElement.clientWidth')-splitWidth)<2);
  await js('workspace.chartNavigation.reset()');await pause(160);
  await fs.promises.writeFile(path.join(outputDirectory,`tradingview-${theme}-split.png`),(await w.webContents.capturePage()).toPNG());
  await js('window.workspace=primary;void 0');
  report.checks.push({theme,initial,vertical,refresh,diagonal,scaled,themed,reset,boxed,splitInitial,splitDragged,splitBoxed});

  await js('workspace.destroy()');
 }
 fs.writeFileSync(path.join(outputDirectory,'tradingview-qa-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:true,themes:report.checks.length,scaleCases:report.interactions.length,outputDirectory,errors:report.errors}));w.destroy();app.exit(0);
})().catch(error=>{console.error(error);app.exit(1)});
