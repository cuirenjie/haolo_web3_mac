import test from 'node:test';
import assert from 'node:assert/strict';
import { setTradingChartSeriesData as set, setTradingChartSeriesValues as values, updateTradingChartSeriesTail as tail } from '../src/renderer/trading-chart-series-data.ts';

function series() {
  return { data: [], writes: [],
    setData(data) { this.data=structuredClone(data);this.writes.push('set'); },
    update(datum) {
      const last=this.data.at(-1);
      assert.ok(!last||datum.time>=last.time,'never update an older time');
      if(last?.time===datum.time)this.data[this.data.length-1]=structuredClone(datum);
      else this.data.push(structuredClone(datum));
      this.writes.push('update');
    },
  };
}
const bars=()=>Array.from({length:1000},(_,i)=>({time:i+100,value:i,color:'#123456'}));

test('native original-time mutations cannot contaminate cached points or force full replacements',()=>{
  const s=series();const setData=s.setData,update=s.update;
  s.setData=function(data){data.forEach(point=>point._internal_originalTime??=point.time);setData.call(this,data)};
  s.update=function(point){point._internal_originalTime??=point.time;update.call(this,point)};
  const data=bars();set(s,data);
  assert.ok(data.every(point=>!('_internal_originalTime' in point)));
  for(let i=0;i<40;i++){data.at(-1).value=i;set(s,data.map(point=>({...point})));}
  assert.equal(s.writes.filter(w=>w==='set').length,1);
  data.push({...data.at(-1),time:1100});tail(s,data.at(-1));set(s,data);
  assert.equal(s.data.at(-1)._internal_originalTime,1100);
  assert.ok(data.every(point=>!('_internal_originalTime' in point)));
});

test('indicator values preserve warmup gaps, histogram colors, removals and historical fills',()=>{
  const s=series(),candles=[{time:1},{time:4},{time:8},{time:10}],numbers=[NaN,2,3,4],colors=['red','red','green','green'];
  const verify=()=>assert.deepEqual(s.data,numbers.flatMap((value,i)=>Number.isFinite(value)?[{time:candles[i].time+100,value,...(colors[i]?{color:colors[i]}:{})}]:[]));
  values(s,candles,numbers,100,colors);verify();
  values(s,candles,numbers,100,colors);assert.deepEqual(s.writes,['set']);
  numbers[3]=5;colors[3]=undefined;values(s,candles,numbers,100,colors);verify();assert.equal(s.writes.at(-1),'update');
  numbers[0]=1;values(s,candles,numbers,100,colors);verify();assert.equal(s.writes.at(-1),'set');
  numbers[3]=NaN;values(s,candles,numbers,100,colors);verify();assert.equal(s.writes.at(-1),'set');
});

test('repeated live refreshes update only the last bar, while identical and empty series do no work',()=>{
  const s=series(),data=bars();set(s,data);
  for(let i=0;i<100;i++){data.at(-1).value=i;set(s,data);assert.deepEqual(s.data,data);}
  assert.equal(s.writes.filter(x=>x==='set').length,1);
  const writes=s.writes.length;set(s,structuredClone(data));assert.equal(s.writes.length,writes);
  set(s,[]);set(s,[]);assert.deepEqual(s.data,[]);assert.equal(s.writes.length,writes+1);
  set(null,data);
});

test('an open new candle followed by the periodic full refresh never writes the previous candle',()=>{
  const s=series(),data=bars();set(s,data);
  for(let i=0;i<5;i++){const next={time:1100+i,value:i};data.push(next);tail(s,next);}
  set(s,data);assert.deepEqual(s.data,data);assert.equal(s.writes.filter(x=>x==='set').length,1);
  data.at(-1).value=99;tail(s,data.at(-1));set(s,data);assert.deepEqual(s.data,data);
  data.push({time:1105,value:5},{time:1106,value:6});set(s,data);assert.deepEqual(s.data,data);
});

test('backfill, period changes, historical corrections, truncation and style removal replace the full domain',()=>{
  for(const change of [
    data=>{data.unshift({time:99,value:5})},
    data=>{data[500].value=50000},
    data=>{data[100].color='#abcdef'},
    data=>{delete data[500].color},
    data=>{data.splice(300,1)},
    data=>{data.pop()},
    data=>{data.at(-1).time+=100},
    data=>{data.forEach(d=>d.time*=60)},
  ]){
    const s=series(),data=bars();set(s,data);change(data);set(s,data);
    assert.deepEqual(s.writes,['set','set']);assert.deepEqual(s.data,data);
  }
});

test('replacing the chart series starts a fresh snapshot and disabling/re-enabling restores every point',()=>{
  const a=series(),b=series(),data=bars();set(a,data);set(b,data);set(a,[]);set(a,data);
  assert.deepEqual(a.data,b.data);assert.deepEqual(a.writes,['set','set','set']);assert.deepEqual(b.writes,['set']);
});
