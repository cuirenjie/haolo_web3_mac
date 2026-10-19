import test from 'node:test';
import assert from 'node:assert/strict';
import {TradingIndexFavorites} from '../src/renderer/trading-index-favorites.ts';

const item={id:'index:gold',name:'伦敦金',enName:'Gold',code:'XAUUSD',value:4100,changePercent:1.2,intervalMs:0,status:'ready'};
const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values};};
test('index favorite persists once per account, strips source fields and updates quotes',()=>{
 const storage=memory(), store=new TradingIndexFavorites(storage,'one');
 store.add({...item,sourceUrl:'https://source.invalid',secret:'never-persist'});store.add(item);
 assert.equal(store.values().length,1);
 assert.doesNotMatch([...storage.values.values()].join(''),/source.invalid|secret|never-persist/);
 const restored=new TradingIndexFavorites(storage,'one');
 assert.equal(restored.get('INDEX:GOLD').status,'stale');
 assert.equal(new TradingIndexFavorites(storage,'two').values().length,0);
 restored.refresh([{...item,value:4200}]);assert.equal(restored.get(item.id).value,4200);
 restored.remove(item.id);assert.equal(new TradingIndexFavorites(storage,'one').values().length,0);
});
test('index and exchange title tickers retain a shared drag order without changing identities',()=>{
 const store=new TradingIndexFavorites(memory(),'one');store.add(item);
 const rows=[{id:'BINANCE:FUTURES:BTCUSDT'},item,{id:'BINANCE:FUTURES:ETHUSDT'}];
 store.reorder(['INDEX:GOLD','BINANCE:FUTURES:ETHUSDT','BINANCE:FUTURES:BTCUSDT']);
 assert.deepEqual(store.sort(rows).map(row=>row.id),['index:gold','BINANCE:FUTURES:ETHUSDT','BINANCE:FUTURES:BTCUSDT']);
});
