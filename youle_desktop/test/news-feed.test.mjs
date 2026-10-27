import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNewsFeed, newsArticleUrl } from '../src/main/news-feed.mjs';
const item={id:'12345678-1234-1234-1234-123456789abc',articleId:'22345678-1234-1234-1234-123456789abc',sequence:1,title:'Product update',summary:'A new release'};
test('A durable pending news popup survives restart until explicitly dismissed',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'haolo-news-test-')),file=path.join(dir,'news.json');
 const feed=createNewsFeed({file,fetchFeed:async after=>({items:after?[]:[item],nextCursor:1}),changed:()=>{}});
 try{feed.start();await feed.refresh();assert.equal(feed.snapshot().pending.length,1);feed.stop();
 const restored=createNewsFeed({file,fetchFeed:async()=>({items:[],nextCursor:1}),changed:()=>{}});
 assert.equal(restored.snapshot().pending[0].id,item.id);restored.dismiss(item.id);assert.equal(restored.snapshot().pending.length,0);
 assert.equal(JSON.parse(fs.readFileSync(file)).cursor,1);
 }finally{feed.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
test('Invalid feeds do not advance the cursor or open injected routes',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'haolo-news-test-')),file=path.join(dir,'news.json');
 const feed=createNewsFeed({file,fetchFeed:async()=>({items:[{...item,articleId:'https://evil.test'}],nextCursor:1}),changed:()=>{}});
 try{feed.start();await assert.rejects(feed.refresh());assert.equal(feed.snapshot().cursor,0);assert.throws(()=>newsArticleUrl('https://evil.test'));assert.match(newsArticleUrl(item.articleId,'en'),/^https:\/\/haolo.com\/api\/news\/read\//);}finally{feed.stop();fs.rmSync(dir,{recursive:true,force:true});}
});

test('article links accept actual desktop locale identifiers', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  for (const [locale, expected] of [['ja','ja'],['ja-JP','ja'],['ja_JP','ja'],['en-US','en'],['ko-KR','ko'],['zh-TW','zh-Hant'],['zh-Hant','zh-Hant'],['zh-CN','zh-CN']])
    assert.equal(new URL(newsArticleUrl(id, locale)).searchParams.get('lang'), expected);
});
