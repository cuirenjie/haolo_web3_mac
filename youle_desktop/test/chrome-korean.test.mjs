import test from 'node:test';
import assert from 'node:assert/strict';
import {panelCopy} from '../extensions/haolo-chrome/panel-copy.js';
import {taskMessage,setPanelLanguage,panelLanguage} from '../extensions/haolo-chrome/task-messages.js';

test('Chrome panel copy supports four languages and preserves placeholders',()=>{
 for(const [source,row] of Object.entries(panelCopy)) {
  assert.equal(row.length,3,source);
  for(const [i,locale] of ['en','zh-TW','ko'].entries()) {
   assert.equal(taskMessage(source,locale),row[i],source);
   if(locale!=='zh-TW') assert.doesNotMatch(row[i],/[\u3400-\u9fff]/u,source);
   assert.deepEqual([...row[i].matchAll(/\{\d+\}/g)].map(x=>x[0]).sort(),[...source.matchAll(/\{\d+\}/g)].map(x=>x[0]).sort(),source);
  }
 }
 setPanelLanguage('ko-KR');assert.equal(panelLanguage(),'ko');
 assert.equal(taskMessage('任务已发送到 Haolo · {0}',undefined,['abc123']),'Haolo에 작업 전송 완료 · abc123');
 assert.equal(taskMessage('用户原始输入 BTC 123.45'),'用户原始输入 BTC 123.45');
 setPanelLanguage('zh-CN');assert.equal(taskMessage('发送'),'发送');
});
