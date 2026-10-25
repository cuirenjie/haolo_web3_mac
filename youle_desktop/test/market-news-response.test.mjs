import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNewsItem, normalizeNewsVote } from '../src/shared/market-news-response.mjs';
const item = { id:'123', title:'News <b>title</b>', content:'External text', timestamp:1792900800,
  important:true, bullish:4, bearish:2, vote:0, markets:[{coin:'BTC',quote:'USDT',symbol:'BTCUSDT',
    venue:'binance',marketType:'perpetual',changePercent:1.25}] };

test('external news attributes, dates and counts cannot inject markup or break rendering', () => {
  assert.equal(normalizeNewsItem(item).title,item.title);
  for (const update of [{id:'123" onclick="x'}, {timestamp:Infinity}, {timestamp:9e20},
    {bullish:'<img onerror=x>'}, {bearish:-1}, {vote:2}, {content:null}, {markets:[{}]}]) {
    assert.throws(()=>normalizeNewsItem({...item,...update}),/INVALID_NEWS_RESPONSE/);
  }
});

test('vote results are bound to the item and cannot replace its content or market link', () => {
  const result=normalizeNewsVote({...item,vote:1,bullish:5,url:'javascript:x',content:'replacement'},'123');
  assert.deepEqual(result,{id:'123',vote:1,bullish:5,bearish:2});
  assert.throws(()=>normalizeNewsVote({...item,id:'456'},'123'),/INVALID_NEWS_RESPONSE/);
  assert.throws(()=>normalizeNewsVote({...item,bullish:NaN},'123'),/INVALID_NEWS_RESPONSE/);
});
