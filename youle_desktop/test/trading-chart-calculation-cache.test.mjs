import test from 'node:test';
import assert from 'node:assert/strict';
import { TradingChartCalculationCache } from '../src/renderer/trading-chart-calculation-cache.ts';
import { computeSma, computeEma, computeBollingerBands, computeBbi } from '../src/renderer/trading-expert-market.ts';
import { indicatorSma, indicatorEma, calculateTradingIndicator } from '../src/renderer/trading-expert-indicators.ts';
import { setTradingChartSeriesValues, setTradingChartSeriesData } from '../src/renderer/trading-chart-series-data.ts';

test('cached open-bar calculations exactly match full history through ticks, rollover, corrections, backfill and settings', () => {
  const cache = new TradingChartCalculationCache();
  const candles = Array.from({length: 300}, (_,i) => ({time: i*60, close: 0.001 + Math.sin(i)*0.0001}));
  const verify = (period=20) => {
    const values = candles.map(c=>c.close); cache.update(values,candles);
    assert.deepEqual(cache.sma(period),computeSma(values,period));
    assert.deepEqual(cache.ema(period),computeEma(values,period));
    assert.deepEqual(cache.boll(period,2.5),computeBollingerBands(values,period,2.5));
    assert.deepEqual(cache.bbi([3,6,12,24]),computeBbi(values,[3,6,12,24]));
    assert.deepEqual(cache.sma(period,true),indicatorSma(values,period));
    assert.deepEqual(cache.ema(period,true),indicatorEma(values,period));
    const averages=[3,6,12,24].map(p=>indicatorSma(values,p));
    assert.deepEqual(cache.bbi([3,6,12,24],true),values.map((_,i)=>averages.reduce((sum,a)=>sum+a[i],0)/4));
  };
  verify();
  for(let i=0;i<100;i++){candles.at(-1).close=0.002+Math.sin(i)*0.0004;verify();}
  for(let i=0;i<30;i++){candles.push({time:candles.at(-1).time+60,close:Math.cos(i)*100});verify();}
  candles[50].close=400;verify();candles[0].close=200;verify();
  candles.unshift({time:-60,close:50});verify();
  candles.splice(100,5);verify();candles.splice(-10);verify();
  verify(10);verify(50);verify(500);verify(1);verify(20);
  candles.length=0;verify();candles.push({time:100,close:25});verify();
  for(let i=0;i<25;i++){candles.push({time:101+i,close:i});verify();}
});

test('cache preserves NaN warmup, inactive periods, and finite EMA seeding',()=>{
  const cache=new TradingChartCalculationCache(), values=[NaN,NaN,1,2,3,NaN,6,7,8,9];
  const candles=values.map((_,i)=>({time:i}));
  for(let i=0;i<5;i++){
    cache.update(values,candles);
    assert.deepEqual(cache.ema(3,true),indicatorEma(values,3));
    assert.deepEqual(cache.sma(3,true),indicatorSma(values,3));
    if(i%2===0)assert.deepEqual(cache.sma(3),computeSma(values,3));
    values[2]=i%2?NaN:1;
  }
});

test('trusted value tails retain exact series data and fall back for clear, timestamps, gaps and missed revisions',()=>{
  const cache=new TradingChartCalculationCache(), candles=Array.from({length:100},(_,i)=>({time:i+100,close:i}));
  const s={data:[],sets:0,updates:0,setData(d){this.data=structuredClone(d);this.sets++},update(d){this.updates++;assert.ok(!this.data.length||d.time>=this.data.at(-1).time);if(this.data.at(-1)?.time===d.time)this.data[this.data.length-1]=d;else this.data.push(d)}};
  const write=()=>{
    const values=candles.map(c=>c.close);cache.update(values,candles);const result=cache.sma(5);
    setTradingChartSeriesValues(s,candles,result,28800);
    assert.deepEqual(s.data,computeSma(values,5).flatMap((value,i)=>Number.isFinite(value)?[{time:candles[i].time+28800,value}]:[]));
  };
  write();for(let i=0;i<40;i++){candles.at(-1).close+=1;write();}assert.equal(s.sets,1);assert.equal(s.updates,40);
  candles.push({time:200,close:100});write();assert.equal(s.sets,1);
  candles.at(-1).close=NaN;write();assert.equal(s.sets,2);
  candles.at(-1).close=100;write();
  candles[20].time+=.5;write();assert.equal(s.sets,3);
  setTradingChartSeriesData(s,[]);write();assert.ok(s.data.length);
  cache.update(candles.map(c=>c.close+1),candles);cache.sma(5);write();
});

test('cached volume results preserve every descriptor, color and window sum',()=>{
  const cache=new TradingChartCalculationCache();
  const candles=Array.from({length:100},(_,i)=>({time:i,open:10,high:12,low:8,close:9,volume:i*.123}));
  for(let i=0;i<30;i++){
    candles.at(-1).volume=i*3.14159;candles.at(-1).close=i%2?11:9;
    assert.deepEqual(calculateTradingIndicator('volume',candles,[5,10],cache),calculateTradingIndicator('volume',candles,[5,10]));
  }
  candles[4].volume=100;
  assert.deepEqual(calculateTradingIndicator('volume',candles,[2,7],cache),calculateTradingIndicator('volume',candles,[2,7]));
});
