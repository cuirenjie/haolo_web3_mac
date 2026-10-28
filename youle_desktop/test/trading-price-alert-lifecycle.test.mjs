import test from 'node:test';
import assert from 'node:assert/strict';
import {TradingPriceAlertControl} from '../src/renderer/trading-price-alert.ts';
import {subscribeChartPriceAlerts} from '../src/renderer/trading-price-alert-store.ts';
import {createCloudPriceAlerts} from '../src/main/trading-alerts/cloud-price-alerts.mjs';
import {cloudPriceAlertFixture} from './helpers/cloud-price-alert-fixture.mjs';

class Element extends EventTarget {
  children=new Map(); dataset={}; style={}; disabled=false; isConnected=true; textContent=''; value='';
  querySelector(selector){if(!this.children.has(selector))this.children.set(selector,new Element());return this.children.get(selector);}
  setAttribute(){} removeAttribute(){} append(){} replaceWith(){} focus(){} select(){} matches(){return false;}
  showModal(){this.open=true;} close(){this.open=false;this.dispatchEvent(new Event('close'));} remove(){this.isConnected=false;}
  get valueAsNumber(){return this.value===''?NaN:Number(this.value);}
  click(){if(!this.disabled)return this.onclick?.();}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function harness(){
  const previous={window:globalThis.window,document:globalThis.document};let profile,latest=[],calls=0,finish;
  const remote=cloudPriceAlertFixture();
  const service=createCloudPriceAlerts({owner:async()=>({ownerId:'qa',accountId:'qa',email:'qa@example.invalid',baseUrl:'qa'}),api:()=>remote});
  const api={onProfileUpdated:fn=>{profile=fn;return()=>{};},tradingAlertsSnapshot:async()=>({cloudLoaded:true,alerts:[]}),
    tradingAlertsCreateCloudPriceAlert:async spec=>{calls++;const result=await service.create(spec);await new Promise(resolve=>finish=resolve);return {ok:true,data:result};},
    tradingAlertsDelete:async()=>{calls++;return {ok:true};}};
  globalThis.window=Object.assign(new EventTarget(),{codexDesktop:api,setInterval:()=>1,clearInterval(){}});
  globalThis.document={documentElement:{lang:'en'},activeElement:null,hidden:false,body:new Element(),createElement:()=>new Element()};
  const unsubscribe=subscribeChartPriceAlerts(value=>latest=value);await tick();
  const context={marketId:'BINANCE:FUTURES:BTCUSDT',interval:'1m',referencePrice:100};
  const control=new TradingPriceAlertControl(new Element(),()=>context);
  return {control,context,api,get calls(){return calls;},get latest(){return latest;},switch:()=>profile(),release:()=>finish(),
    async wait(){for(let i=0;i<10&&!finish;i++)await tick();assert.ok(finish);},
    cleanup(){control.destroy();unsubscribe();Object.assign(globalThis,previous);}};
}

for(const mode of ['create','edit','delete'])test(`an open ${mode} dialog cannot submit after an account change`,async()=>{
  const h=await harness();try{
    const alert={alertId:'cloud-price-00000000-0000-4000-8000-000000000001',marketId:h.context.marketId,interval:'1m',price:105,version:2,operator:'gte'};
    if(mode==='delete')h.control.openDelete(alert);else h.control.showCreate({...h.context,price:105},'105',mode==='edit'?alert:undefined,mode==='edit');
    const button=h.control.dialog.querySelector('[data-price-alert-confirm]');h.switch();await tick();
    void button.click();await tick();assert.equal(h.calls,0);
  }finally{h.cleanup();}
});

for(const mode of ['account-change','destroy'])test(`a saved receipt arriving after ${mode} cannot repopulate chart alerts`,async()=>{
  const h=await harness();try{
    h.control.showCreate({...h.context,price:105},'105');
    const pending=h.control.dialog.querySelector('[data-price-alert-confirm]').click();await h.wait();
    if(mode==='account-change')h.switch();else h.control.destroy();
    await tick();h.release();await pending;assert.deepEqual(h.latest,[]);
  }finally{h.cleanup();}
});
