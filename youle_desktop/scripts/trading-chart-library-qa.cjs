// Pixel parity: incremental/batched rendering versus full native setData.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.cache/chart-throttle-20261018');
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'library-profile'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  setTimeout(()=>app.exit(1),180000).unref();await app.whenReady();
  const win=new BrowserWindow({show:false,width:1500,height:1000,webPreferences:{offscreen:true,backgroundThrottling:false}});
  const js=s=>win.webContents.executeJavaScript(s,true);
  const source=await(await fetch('http://127.0.0.1:5183/trading-expert-market.ts')).text();
  const library=source.match(/from "([^"]*lightweight-charts[^"]*)"/)[1];
  await win.loadURL('http://127.0.0.1:5183/@fs/'+path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/'));
  for(let i=0;i<150&&!await js('Boolean(window.ready)');i++)await pause(100);
  assert.equal(await js('Boolean(window.ready)'),true);
  const result=await js(`(async()=>{
    workspace.destroy();document.body.replaceChildren();
    const lib=await import(${JSON.stringify(library)}), {setTradingChartSeriesData:set,withTradingChartSeriesBatch:batch}=await import('/trading-chart-series-data.ts');
    const charts=[], all=[];
    for(let i=0;i<2;i++){
      const host=document.createElement('div');host.style.cssText='width:720px;height:360px;';document.body.append(host);
      const chart=lib.createChart(host,{width:720,height:360,layout:{fontSize:11},timeScale:{barSpacing:6},rightPriceScale:{borderVisible:true}});
      charts.push(chart);all.push([chart.addSeries(lib.CandlestickSeries),chart.addSeries(lib.LineSeries),chart.addSeries(lib.AreaSeries),chart.addSeries(lib.BarSeries),chart.addSeries(lib.HistogramSeries,{},1)]);
    }
    if(typeof charts[0].haoloBatchUpdates!=='function')throw Error('guarded native adapter is not loaded');
    let bars=Array.from({length:5000},(_,i)=>({time:1700000000+i*60,open:100+Math.sin(i)*8,high:110+Math.sin(i)*8,low:90+Math.sin(i)*8,close:103+Math.cos(i)*6}));
    const prices=()=>bars.map(({time,open,high,low,close})=>({time,open,high,low,close}));
    const datasets=()=>[prices(),bars.map(b=>({time:b.time,value:(b.open+b.close)/2})),bars.map(b=>({time:b.time,value:b.low})),prices(),bars.map((b,i)=>({time:b.time,value:100+i%33,color:b.close>=b.open?'#2EBD85':'#F6465D'}))];
    const write=()=>{
      const data=datasets();batch(charts[0],()=>all[0].forEach((s,i)=>set(s,data[i])));
      all[1].forEach((s,i)=>s.setData(data[i]));
    };
    const settle=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const checks=[];
    const verify=async label=>{
      for(const chart of charts)chart.timeScale().setVisibleLogicalRange({from:bars.length-110,to:bars.length+4});
      await settle();
      all[0].forEach((series,i)=>{const a=series.data(),b=all[1][i].data();if(JSON.stringify(a)!==JSON.stringify(b)){const index=a.findIndex((row,j)=>JSON.stringify(row)!==JSON.stringify(b[j]));throw Error(label+': data '+i+' lengths '+a.length+'/'+b.length+' index '+index+' '+JSON.stringify([a[index],b[index]]))}});
      const images=charts.map(chart=>{const c=chart.takeScreenshot();return c.getContext('2d').getImageData(0,0,c.width,c.height).data});
      let differences=0;for(let i=0;i<images[0].length;i++)if(images[0][i]!==images[1][i])differences++;
      if(differences)throw Error(label+': '+differences+' pixel channel differences');
      checks.push(label);
    };
    write();await verify('initial');
    for(let i=0;i<12;i++){bars.at(-1).close=100+Math.sin(i)*3;write();await verify('tail '+i);}
    bars.push({...bars.at(-1),time:bars.at(-1).time+60});write();await verify('rollover');
    bars[4895]={...bars[4895],close:112,high:120};write();await verify('historical correction');
    bars.unshift({...bars[0],time:bars[0].time-60});write();await verify('backfill index shift');
    bars.splice(4900,1);write();await verify('remove timestamp');
    bars.pop();write();await verify('truncate');
    for(const series of all){series[0].applyOptions({upColor:'#ff00ff',downColor:'#00ffff',wickUpColor:'#ff00ff',wickDownColor:'#00ffff'});series[1].applyOptions({color:'#ff6600',lineWidth:4});}
    bars.at(-1).close+=.2;write();await verify('style change and live update');
    for(const mode of [1,2,0]){for(const chart of charts)chart.priceScale('right').applyOptions({mode});bars.at(-1).close+=.1;write();await verify('price mode '+mode);}
    for(const chart of charts)chart.priceScale('right').applyOptions({invertScale:true});write();await verify('inverted price');
    for(const chart of charts)chart.applyOptions({timeScale:{enableConflation:true}});write();await verify('conflation enabled');
    for(const chart of charts)chart.timeScale().setVisibleLogicalRange({from:0,to:5000});await settle();
    bars.at(-1).close+=.3;write();await verify('conflation then zoom in');
    batch(charts[0],()=>batch(charts[0],()=>write()));await verify('nested batch');
    try{batch(charts[0],()=>{bars.at(-1).close+=.4;write();throw Error('expected')})}catch(e){if(e.message!=='expected')throw e}await verify('throwing batch flush');
    all[0].forEach(s=>set(s,[]));all[1].forEach(s=>s.setData([]));write();await verify('clear and restore');
    charts.forEach(c=>c.remove());return{passed:true,pixelPairs:checks.length,checks};
  })()`);
  fs.writeFileSync(path.join(output,'native-pixels.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));win.destroy();app.exit(0);
})().catch(e=>{console.error(e);app.exit(1)});
