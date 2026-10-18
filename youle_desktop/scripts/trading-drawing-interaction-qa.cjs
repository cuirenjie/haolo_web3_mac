// Native DOM verification for retained SVG, coalesced pointers and cancellation.
// Synthetic prices only; Vite on 5183, isolated Electron profile.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/chart-smoothness-20261018');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'interaction-profile'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  setTimeout(() => app.exit(1), 60000).unref();
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = source => win.webContents.executeJavaScript(source, true);
  await win.loadURL('http://127.0.0.1:5183/@fs/' + path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/'));
  for (let i = 0; i < 100 && !await js('Boolean(window.ready)'); i++) await pause(100);
  assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
  const result = await js(`(async()=>{
    const w=workspace,d=w.drawingController,checks=[];
    const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label)};
    const settle=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    clearInterval(w.pollTimer);clearInterval(w.candlePollTimer);w.favoriteTickerGeneration++;w.closeFavoriteTickerStreams();w.closeSocket();w.cancelScheduledLiveChartPaint();w.loadingHistory=true;
    const {TradingDrawingLayer}=await import('/trading-drawing-layer.ts');
    const {TRADING_DRAWING_TOOLS}=await import('/trading-expert-drawing.ts');
    const {deferTradingChartShellRender}=await import('/trading-chart-interaction.ts');
    const {updateTradingChartLegendRows}=await import('/trading-chart-legend.ts');
    const legend=document.createElement('div'),extension=document.createElement('div');
    extension.textContent='simulation';legend.append(extension);
    const row=(id,text,color='#123456')=>({id,title:id,items:[{text,color}]});
    const update=rows=>updateTradingChartLegendRows(legend,'data-market-main-indicator-legend',rows);
    update([row('ma','MA:1'),row('ema','EMA:2')]);
    const ma=legend.children[0],ema=legend.children[1],maValue=ma.querySelector('span');
    const observer=new MutationObserver(()=>{});observer.observe(legend,{subtree:true,attributes:true,characterData:true,childList:true});
    for(let i=0;i<100;i++)update([row('ma','MA:1'),row('ema','EMA:2')]);
    check(observer.takeRecords().length===0,'100 identical legend paints have zero DOM mutations');
    update([row('ema','EMA:3'),row('ma','MA:4','#654321')]);
    check(legend.children[0]===ema&&legend.children[1]===ma&&ma.querySelector('span')===maValue&&maValue.textContent==='MA:4'&&maValue.style.getPropertyValue('--main-indicator-series-color')==='#654321','legend values colors and order update in retained nodes');
    legend.replaceChildren(extension);update([row('ma','MA:5')]);
    check(legend.firstElementChild===ma&&legend.lastElementChild===extension&&maValue.textContent==='MA:5','legend survives external reset and preserves extension rows');
    update([]);check(legend.childElementCount===1&&legend.firstElementChild===extension,'disabling indicators preserves extension rows');observer.disconnect();
    const svg=()=>document.createElementNS('http://www.w3.org/2000/svg','g');
    const root=svg(),expected=svg(),layer=new TradingDrawingLayer(root);
    const snapshot=node=>node.nodeType===1?[node.nodeName,Array.from(node.attributes,a=>[a.name,a.value]).sort(),Array.from(node.childNodes,snapshot)]:node.nodeValue;
    let combinations=0;
    for(const theme of ['light','dark']){
      document.documentElement.dataset.theme=theme;
      for(const tool of TRADING_DRAWING_TOOLS){
        if(tool.kind==='cursor'||tool.kind==='eraser'||tool.id==='image')continue;
        for(let variant=0;variant<5;variant++){
          const drawing={id:'verify',tool:tool.id,symbol:d.getSymbol(),interval:d.getInterval(),
            text:variant%2?'Price < & > "quoted"':'价格',lineWidth:variant%3+1,
            points:Array.from({length:variant===3?6:3},(_,i)=>({time:w.candles.at(-70+i*10).time+variant*400,price:1305+i*5+variant*3}))};
          d.selectedDrawingId=variant%2?'verify':null;
          const markup=d.renderDrawing(drawing,d.plotBounds(),variant===4);
          layer.render([{id:drawing.id,markup}]);expected.innerHTML=markup;
          check(JSON.stringify(snapshot(root))===JSON.stringify(snapshot(expected)),theme+'/'+tool.id+'/'+variant);
          combinations++;
        }
      }
    }
    layer.render([{id:'a',markup:'<g data-drawing-id="a"><text title="A &amp; B">A &amp; B</text></g>'},{id:'b',markup:'<g data-drawing-id="b"><line x1="1"/></g>'}]);
    const a=root.firstElementChild,b=root.lastElementChild;
    layer.render([{id:'b',markup:'<g data-drawing-id="b"><line x1="2"/></g>'},{id:'a',markup:'<g data-drawing-id="a"><text title="C &lt; D">C &lt; D</text></g>'}]);
    check(root.firstElementChild===b&&root.lastElementChild===a&&a.firstElementChild.getAttribute('title')==='C < D','keyed order and entity decoding');
    layer.render([{id:'b',markup:''},{id:'a',markup:'<g data-drawing-id="a"><circle cx="2"/></g>'}]);
    check(root.childElementCount===1&&root.firstElementChild===a&&a.firstElementChild.nodeName==='circle','empty first group and geometry topology change');
    layer.render([]);check(!root.childNodes.length,'clear removes cached groups');
    const lineMarkup=(x1,y1,x2,y2,color='red',extra='')=>'<g data-drawing-id="translate"><line stroke="'+color+'" x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'"/>'+extra+'</g>';
    const checkLine=(values,label)=>{
      const group=root.firstElementChild,line=group.firstElementChild;
      const matrix=group.transform.baseVal.consolidate()?.matrix??new DOMMatrix();
      const a=new DOMPoint(line.x1.baseVal.value,line.y1.baseVal.value).matrixTransform(matrix);
      const b=new DOMPoint(line.x2.baseVal.value,line.y2.baseVal.value).matrixTransform(matrix);
      check([a.x,a.y,b.x,b.y].every((value,i)=>Math.abs(value-values[i])<0.0001),label);
    };
    layer.update('translate',lineMarkup(10,20,40,50));const translated=root.firstElementChild;
    for(let i=1;i<=100;i++)layer.update('translate',lineMarkup(10+i*.375,20-i*.25,40+i*.375,50-i*.25));
    checkLine([47.5,-5,77.5,25],'100 translated frames preserve exact geometry');
    check(translated===root.firstElementChild&&translated.hasAttribute('transform'),'panning retains hit nodes with a translation');
    layer.update('translate',lineMarkup(0,0,77.5,25));checkLine([0,0,77.5,25],'clipped endpoint rebases every coordinate');
    check(!translated.hasAttribute('transform'),'clipping leaves translation fast path');
    layer.update('translate',lineMarkup(3,7,80.5,32));
    layer.update('translate',lineMarkup(3,7,80.5,32,'blue'));checkLine([3,7,80.5,32],'style changes rebase translated geometry');
    layer.update('translate',lineMarkup(8,12,85.5,37,'blue','<circle cx="8" cy="12" r="3"/>'));checkLine([8,12,85.5,37],'selection handles restore full geometry');
    layer.render([]);
    const segments=Array.from({length:50},(_,i)=>({id:'segment-'+i,key:'blue',x1:20,y1:20+i,x2:200,y2:150+i}));
    const entries=()=>segments.map(s=>({id:s.id,segment:s,render:()=>'<g data-drawing-id="'+s.id+'"><line vector-effect="non-scaling-stroke" stroke="'+s.key+'" x1="'+s.x1+'" y1="'+s.y1+'" x2="'+s.x2+'" y2="'+s.y2+'"/></g>'}));
    const checkSegments=label=>{
      const parent=DOMMatrix.fromMatrix(root.transform.baseVal.consolidate()?.matrix??{});
      for(const s of segments){const group=Array.from(root.children).find(n=>n.dataset.drawingId===s.id);const line=group.firstElementChild;
        const matrix=parent.multiply(DOMMatrix.fromMatrix(group.transform.baseVal.consolidate()?.matrix??{}));
        const a=new DOMPoint(line.x1.baseVal.value,line.y1.baseVal.value).matrixTransform(matrix),b=new DOMPoint(line.x2.baseVal.value,line.y2.baseVal.value).matrixTransform(matrix);
        if(![a.x-s.x1,a.y-s.y1,b.x-s.x2,b.y-s.y2].every(v=>Math.abs(v)<.0001))throw Error(label+' '+s.id);
      }check(true,label);
    };
    layer.render(entries());const retainedSegments=Array.from(root.children);
    const segmentObserver=new MutationObserver(()=>{});segmentObserver.observe(root,{attributes:true,subtree:true,childList:true});
    for(let frame=0;frame<100;frame++){
      for(let i=0;i<segments.length;i++){const s=segments[i];segments[i]={...s,x1:s.x1*1.001+.25,x2:s.x2*1.001+.25,y1:s.y1*.999-.125,y2:s.y2*.999-.125};}
      layer.render(entries());checkSegments('batched pan/zoom '+frame);
    }
    const mutations=segmentObserver.takeRecords();check(mutations.length===100&&mutations.every(m=>m.target===root&&m.attributeName==='transform'),'one parent mutation per dense viewport frame');
    check(Array.from(root.children).every((node,i)=>node===retainedSegments[i]),'batched viewport preserves every hit node');
    segments[0]={...segments[0],x1:0};layer.render(entries());checkSegments('clipping rebases the entire viewport');
    segments[1]={...segments[1],key:'red'};layer.render(entries());checkSegments('style edit retains other segment coordinates');
    segments.reverse();layer.render(entries());checkSegments('reordering after viewport transform');
    for(let i=0;i<segments.length;i++)segments[i]={...segments[i],x1:segments[i].x1+10,x2:segments[i].x2+10};layer.render(entries());
    const removed=segments.shift();layer.update(removed.id,'');check(!Array.from(root.children).some(n=>n.dataset.drawingId===removed.id),'empty geometry removes a transformed individual group');checkSegments('individual edit rebases other groups');
    segmentObserver.disconnect();layer.render([]);check(!root.hasAttribute('transform')&&!root.children.length,'clearing removes viewport transform');
    d.drawings=[];d.selectedDrawingId=null;d.redraw();w.chartNavigation.reset();await settle();
    const event=(type,x,y,target=d.overlay)=>{const r=d.chartElement.getBoundingClientRect();const e=new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:42,isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:r.left+x,clientY:r.top+y});target.dispatchEvent(e);return e};
    const close=(a,b)=>Math.abs(a-b)<0.01;
    d.selectTool('trend-line');event('pointerdown',160,160);event('pointerup',160,160);
    const old=d.draft.points[1];for(let i=0;i<100;i++)event('pointermove',200+i,210);
    check(d.pendingPointerMoves.length===1&&d.draft.points[1]===old,'100 moves coalesce before paint');
    await settle();check(close(d.pointToScreen(d.draft.points[1]).x,299),'latest preview point reaches next frame');
    event('pointermove',310,220);event('pointerdown',330,230);event('pointerup',330,230);
    check(!d.draft&&d.drawings.length===1&&close(d.pointToScreen(d.drawings[0].points[1]).x,330),'second click wins over queued preview');
    const drawing=d.drawings[0];
    const startHandle=()=>{d.selectTool('crosshair');d.selectDrawing(drawing.id);d.redraw();const p=d.pointToScreen(drawing.points[1]);event('pointerdown',p.x,p.y,d.content.querySelector('[data-drawing-handle-index="1"]'));check(!!d.dragState,'endpoint captured');};
    startHandle();let resumed=0;
    check(deferTradingChartShellRender(()=>resumed++),'drawing drag protects shell attachment');
    event('pointermove',350,240);event('pointerup',375,255);await settle();
    check(close(d.pointToScreen(drawing.points[1]).x,375)&&close(d.pointToScreen(drawing.points[1]).y,255)&&resumed===1,'release preserves final coordinates and resumes shell');
    for(const cancel of ['pointercancel','lostpointercapture','blur']){
      const original=JSON.stringify(drawing.points);startHandle();event('pointermove',420,280);await settle();
      if(cancel==='blur')window.dispatchEvent(new Event('blur'));else event(cancel,420,280);
      await settle();check(JSON.stringify(drawing.points)===original&&!d.dragState&&d.pointerId===null&&d.dragRedrawFrame===null,'rollback on '+cancel);
    }
    d.selectTool('brush');event('pointerdown',180,300);
    const r=d.chartElement.getBoundingClientRect();const samples=[{x:210,y:320},{x:240,y:270},{x:270,y:340}].map(p=>new PointerEvent('pointermove',{pointerId:42,clientX:r.left+p.x,clientY:r.top+p.y}));
    const pen=new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:42,isPrimary:true,clientX:r.left+270,clientY:r.top+340});
    Object.defineProperty(pen,'getCoalescedEvents',{value:()=>samples});d.overlay.dispatchEvent(pen);
    check(d.pendingPointerMoves.length===3,'freehand retains every coalesced sample');event('pointerup',290,310);
    const stroke=d.drawings.at(-1),screen=stroke.points.map(p=>d.pointToScreen(p));
    check(screen.some(p=>close(p.x,240)&&close(p.y,270))&&close(screen.at(-1).x,290),'freehand bend and final endpoint survive');
    const unchanged=d.content.querySelector('[data-drawing-id="'+drawing.id+'"]');d.selectDrawing(stroke.id);d.redraw();
    check(d.content.querySelector('[data-drawing-id="'+drawing.id+'"]')===unchanged,'selection preserves other figures');
    d.undo();check(d.drawings.length===1,'undo after coalesced freehand');d.redo();check(d.drawings.length===2,'redo after coalesced freehand');
    d.selectTool('brush');event('pointerdown',150,150);event('pointermove',220,220);
    check(deferTradingChartShellRender(()=>resumed++),'destroy starts with a guarded gesture');
    d.destroy();await settle();check(d.dragRedrawFrame===null&&resumed===2,'destroy clears frame and releases guard');
    return {passed:true,combinations,checks:checks.length,interactionChecks:checks.filter(label=>!label.startsWith('light/')&&!label.startsWith('dark/'))};
  })()`);
  assert.equal(result.passed, true);
  fs.writeFileSync(path.join(output, 'interaction.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));win.destroy();app.exit(0);
})().catch(e=>{console.error(e);app.exit(1)});
