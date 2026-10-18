// Verify incremental writes against real Lightweight Charts, including live
// candle rollover, historical edits and changes of chart style/indicator panes.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.cache/chart-load-20261018');
app.setPath('userData',path.join(output,'data-profile'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  setTimeout(()=>app.exit(1),90000).unref();await app.whenReady();
  const win=new BrowserWindow({show:false,width:1440,height:960,webPreferences:{offscreen:true,backgroundThrottling:false}});
  const js=s=>win.webContents.executeJavaScript(s,true);
  await win.loadURL('http://127.0.0.1:5183/@fs/'+path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/'));
  for(let i=0;i<150&&!await js('Boolean(window.ready)');i++)await pause(100);
  assert.equal(await js('Boolean(window.ready)'),true);
  const result=await js(`(async()=>{
    const w=workspace,checks=[];const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label)};
    const normalized=data=>JSON.stringify(data.map(d=>Object.fromEntries(Object.entries(d).filter(([,v])=>v!==undefined).sort())));
    clearInterval(w.pollTimer);clearInterval(w.candlePollTimer);w.favoriteTickerGeneration++;w.closeFavoriteTickerStreams();w.closeSocket();w.cancelScheduledLiveChartPaint();w.loadingHistory=true;
    const {atm1TrendCandles,computeSma,computeEma,computeBollingerBands,computeBbi,calculateTradingIndicator}=await import('/trading-expert-market.ts').then(async m=>({...m,...await import('/trading-expert-indicators.ts')}));
    w.activeMainIndicators=['ma','ema','boll','bbi'];w.applyMainIndicatorSeriesOptions();w.activeIndicators=['volume','macd'];w.rebuildIndicatorPanes();
    const verify=label=>{
      check(normalized(w.candleSeries.data())===normalized(w.primarySeriesData(w.chartCandles,w.trendBandEnabled?atm1TrendCandles(w.chartCandles):null)),label+': primary data');
      const keys={ma:['short','medium','long','extraLong','ultraLong'],ema:['short','medium','long','extraLong','ultraLong'],boll:['upper','middle','lower'],bbi:['bbi']};
      for(const id of w.activeMainIndicators)w.mainIndicatorSeries.get(id).forEach((series,i)=>{
        const setting=w.indicatorSettings['main:'+id]??w.indicatorSettings['main.'+id]??w.indicatorSettings[id];
        const values=w.mainIndicatorValues.get(id)?.[i]??[];
        const closes=w.chartCandles.map(c=>c.close),params=setting.parameters;
        const boll=id==='boll'?computeBollingerBands(closes,params[0],params[1]):null;
        const reference=id==='ma'?computeSma(closes,params[i]):id==='ema'?computeEma(closes,params[i]):id==='bbi'?computeBbi(closes,params):[boll.upper,boll.middle,boll.lower][i];
        check(values.length===reference.length&&values.every((v,j)=>Object.is(v,reference[j])),label+': full formula '+id+'/'+i);
        const visible=setting.series[keys[id][i]].visible;
        const expected=visible?values.flatMap((value,index)=>Number.isFinite(value)?[{time:w.chartCandles[index].time+28800,value}]:[]):[];
        check(normalized(series.data())===normalized(expected),label+': '+id+'/'+i);
      });
      for(const [id,runtime]of w.indicatorPanes){
        const setting=w.indicatorSettings['sub:'+id]??w.indicatorSettings['sub.'+id]??w.indicatorSettings[id];
        const expected=calculateTradingIndicator(id,w.candles,setting.parameters);
        for(const series of runtime.series){const d=expected.series.find(d=>d.key===series.key);
          const data=d.values.flatMap((value,i)=>Number.isFinite(value)?[{time:w.candles[i].time+28800,value,...(d.colors?.[i]?{color:d.colors[i]}:{})}]:[]);
          check(normalized(series.api.data())===normalized(data),label+': '+id+'/'+series.key);
        }
      }
    };
    for(const style of ['candlestick','heikin-ashi','hlc','close-line','bars']){
      w.chartSettings.chartStyle=style;w.rebuildPrimarySeries();w.updateChartData();verify(style+'/initial');
      const last=w.candles.at(-1);last.close+=.125;last.high=Math.max(last.high,last.close);w.paintLatestCandle();w.updateChartData();verify(style+'/live tail');
      for(let i=0;i<3;i++){w.candles.push({...w.candles.at(-1),time:w.candles.at(-1).time+3600});w.paintLatestCandle();}
      w.updateChartData();verify(style+'/rollover');
      w.candles[100].close+=.375;w.candles[100].high=Math.max(w.candles[100].close,w.candles[100].high);w.updateChartData();verify(style+'/historical correction');
      w.candles.unshift({...w.candles[0],time:w.candles[0].time-3600});w.updateChartData();verify(style+'/backfill');
    }
    w.chartSettings.chartStyle='candlestick';w.trendBandEnabled=true;w.rebuildPrimarySeries();w.updateChartData();verify('trend band');
    w.clearChart();w.updateChartData();verify('restored after clear');
    w.destroy();return{passed:true,checks:checks.length};
  })()`);
  fs.writeFileSync(path.join(output,'data.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));win.destroy();app.exit(0);
})().catch(e=>{console.error(e);app.exit(1)});
