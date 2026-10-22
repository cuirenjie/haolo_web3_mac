const { app, BrowserWindow, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const out = process.env.HAOLO_QA_OUTPUT || path.resolve(__dirname, '../.cache/channel-delivery-M1-428');
const origin = process.env.HAOLO_QA_ORIGIN || 'http://127.0.0.1:5177';
fs.mkdirSync(out, {recursive:true});
app.setPath('userData',path.join(out,`visual-profile-${Date.now()}`));
app.disableHardwareAcceleration();
const report={checks:[],images:[]};
let win;
(async()=>{
  setTimeout(()=>app.exit(1),90000).unref();
  const fixtures=await import(pathToFileURL(path.resolve(__dirname,'../test/support/cloud-plan-card-fixture.mjs')).href);
  const { saveExternalTradingPlanImage }=await import(pathToFileURL(path.resolve(__dirname,'../src/main/external-trading-plan-image.mjs')).href);
  await app.whenReady();
  win=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{offscreen:true,backgroundThrottling:false}});
  win.webContents.session.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!(/^(about|data|blob|devtools):/.test(d.url)||d.url.startsWith(origin+'/')||d.url.startsWith(origin.replace('http:','ws:')+'/'))}));
  await win.loadURL(origin+'/');
  const js=code=>win.webContents.executeJavaScript(code,true);
  await js(`(async()=>{
    window.qaImages=await import('/external-trading-plan-images.ts');
    window.qaView=await import(${JSON.stringify('/@fs/' + path.resolve(__dirname,'../src/main/execution-plan-card-view.mjs').replace(/\\/g,'/'))});
  })()`);
  const sample=await js(`(async()=>{
    const heading=qaView.executionPlanCardHeading('ETH/USDT 币安永续 1H · 条件计划',[{label:'Direction',text:'long'},{label:'Strategy',text:'price-action'}],'zh-CN');
    const body=qaView.executionPlanStructuredCardBody({entry:{lower:2459.9},stop:2424.34,targets:[2485.05,2497.2,2531.03],direction:'long',riskReward:[.5,.8,1.64],account:{mode:'new_position',notional:41.65,estimatedStopLoss:.68,targetOrders:[{targetIndex:0,price:2485.05,notional:13.74,estimatedNetProfit:.11},{targetIndex:1,price:2497.2,notional:13.74,estimatedNetProfit:.18},{targetIndex:2,price:2531.03,notional:14.16,estimatedNetProfit:.38}]}},'zh-CN');
    const snapshot=qaImages.externalPlanImageSnapshot(heading+body);
    return {snapshot,dataUrl:await qaImages.renderExternalTradingPlanImage(snapshot)};
  })()`);
  assert.equal(sample.snapshot.metrics[0].price,'2459.900');
  assert.equal(sample.snapshot.metrics[1].price,'2424.340');
  assert.deepEqual(sample.snapshot.targets.map(t=>t.profit.value),['+0.11','+0.29','+0.67']);
  const file=await saveExternalTradingPlanImage({dataUrl:sample.dataUrl},{app:{getPath:()=>out},nativeImage});
  fs.copyFileSync(file.path,path.join(out,'reference-card.png'));
  report.images.push({label:'reference',path:path.join(out,'reference-card.png'),width:file.width,height:file.height});
  report.checks.push({label:'reference prices, position amounts and cumulative profits',passed:true,snapshot:sample.snapshot});
  const short=await js(`(async()=>{
    const heading=qaView.executionPlanCardHeading('SNDK/USDT 币安永续 1H · 条件计划',[{label:'Direction',text:'short'},{label:'Strategy',text:'wyckoff'}],'zh-CN');
    const body=qaView.executionPlanStructuredCardBody({entry:{lower:1377.95},stop:1418.19,targets:[1353.7,1340.8,1239.38],direction:'short',riskReward:[.5,.8,3.16],account:{mode:'new_position',notional:21.96,estimatedStopLoss:.68,targetOrders:[{targetIndex:0,price:1353.7,notional:7.24,estimatedNetProfit:.01},{targetIndex:1,price:1340.8,notional:7.24,estimatedNetProfit:.28},{targetIndex:2,price:1239.38,notional:7.48,estimatedNetProfit:.73}]}},'zh-CN');
    const snapshot=qaImages.externalPlanImageSnapshot(heading+body);
    return {snapshot,dataUrl:await qaImages.renderExternalTradingPlanImage(snapshot)};
  })()`);
  const shortFile=await saveExternalTradingPlanImage({dataUrl:short.dataUrl},{app:{getPath:()=>out},nativeImage});
  fs.copyFileSync(shortFile.path,path.join(out,'sndk-short-card.png'));
  report.images.push({label:'SNDK short Wyckoff',path:path.join(out,'sndk-short-card.png'),width:shortFile.width,height:shortFile.height});
  // Inspect rendered pixels, not the coordinates used by the implementation.
  for(const [label,input] of [['ETH long',sample],['SNDK short',short]]) {
    const geometry=await js(`(async()=>{
      const img=new Image();img.src=${JSON.stringify(input.dataUrl)};await img.decode();
      const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const g=c.getContext('2d');g.drawImage(img,0,0);
      const {data}=g.getImageData(0,0,c.width,c.height);
      const bounds=(test,x0=0,y0=0,x1=c.width,y1=190)=>{let l=Infinity,t=Infinity,r=-1,b=-1;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*c.width+x)*4;if(test(data[i],data[i+1],data[i+2])){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}}return {l,t,r,b,cx:(l+r)/2,cy:(t+b)/2};};
      const boxes=${JSON.stringify(input.snapshot.badges.map(b=>b.tone==='strategy'?[154,103,0]:b.tone==='bearish'?[203,62,80]:[37,133,76]))}.map(color=>{
        const box=bounds((r,g,b)=>Math.abs(r-color[0])<2&&Math.abs(g-color[1])<2&&Math.abs(b-color[2])<2);
        const ink=bounds((r,g,b)=>r>240&&g>240&&b>240,box.l+12,box.t+12,box.r-11,box.b-11);
        return {box,ink};
      });
      const title=bounds((r,g,b)=>r<50&&g<50&&b<50,20,20,boxes[0].box.l-15,190);
      return {boxes,title};
    })()`);
    for(const {box,ink} of geometry.boxes) {
      assert.ok(Number.isFinite(ink.cx)&&Number.isFinite(ink.cy));
      assert.ok(Math.abs(box.cx-ink.cx)<=2,label+': horizontal ink centering');
      assert.ok(Math.abs(box.cy-ink.cy)<=2,label+': vertical ink centering');
      assert.ok(Math.abs(box.cy-geometry.title.cy)<=2,label+': title row alignment');
    }
    report.checks.push({label:label+' painted badge pixels centered and aligned to title',passed:true,geometry});
  }
  for(const language of ['zh-CN','zh-TW','en']) for(const side of ['long','short']) {
    const input=fixtures.cloudAccountPlanCardFixture(language==='zh-TW'?'zh-Hant':language,side);
    input.strategyId=language==='en'?'moving-average-analysis':'price-action';
    const result=await js(`(async()=>{
      const item={id:'current-plan',text:'report',__youleExecutionPlanPresentation:'execution-plan',__youleCloudReports:[${JSON.stringify(input)}]};
      const images=[];
      const attachments=await qaImages.createExternalTradingReplyPlanAttachments([item],${JSON.stringify(language)},async({dataUrl})=>{images.push(dataUrl);return {ok:true,path:'current.png',name:'current.png',size:1}});
      const markup=qaImages.externalTradingPlanCardMarkup({cloudReports:item.__youleCloudReports},${JSON.stringify(language)})[0];
      return {attachments,images,snapshot:qaImages.externalPlanImageSnapshot(markup)};
    })()`);
    assert.equal(result.attachments.length,1);assert.equal(result.images.length,1);
    assert.ok(result.snapshot.metrics.every(m=>m.detail));assert.ok(result.snapshot.targets.every(t=>t.profit&&t.amount));
    const image=await saveExternalTradingPlanImage({dataUrl:result.images[0]},{app:{getPath:()=>out},nativeImage});
    fs.copyFileSync(image.path,path.join(out,`${language}-${side}.png`));
    report.images.push({label:`${language}-${side}`,path:path.join(out,`${language}-${side}.png`),width:image.width,height:image.height});
    report.checks.push({label:`${language}-${side} real canvas and temporary PNG save`,passed:true});
  }
  const none=await js(`qaImages.createExternalTradingReplyPlanAttachments([{text:'Hello',__youleExecutionPlanPresentation:'plain'}],'zh-CN',()=>{throw Error('must not save')})`);
  assert.deepEqual(none,[]);
  report.checks.push({label:'ordinary non-plan reply creates no card',passed:true});
  fs.writeFileSync(path.join(out,'visual-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.checks.length,images:report.images}));app.exit(0);
})().catch(error=>{fs.writeFileSync(path.join(out,'visual-error.log'),error.stack);console.error(error);app.exit(1)});
