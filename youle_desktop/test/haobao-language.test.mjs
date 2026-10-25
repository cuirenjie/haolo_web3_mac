import test from 'node:test';
import assert from 'node:assert/strict';
import {translateAppText,applyAppLanguage} from '../src/renderer/app-language.mjs';
import {HAOBAO_COLORS,HAOBAO_CHARACTERS,HAOBAO_MOODS} from '../src/renderer/haobao-avatar.ts';

test('all appearance option names have full English and Korean translations',()=>{
  for(const item of [...HAOBAO_COLORS,...HAOBAO_CHARACTERS,...HAOBAO_MOODS])for(const locale of ['en','ko']){
    const text=translateAppText(item.name,locale);
    assert.doesNotMatch(text,/\p{Script=Han}/u,item.id+'/'+locale);
    assert.ok(text.length>0);
  }
  assert.equal(translateAppText('晴空蓝','en'),'Sky blue','must not partially translate 晴Short蓝');
  assert.equal(translateAppText('云朵白','zh-TW'),'雲朵白');
  assert.equal(translateAppText('软糖紫','zh-TW'),'軟糖紫');
  assert.equal(translateAppText('小学者','zh-TW'),'小學者');
  assert.equal(translateAppText('1–5 个字符','en'),'1–5 characters');
  assert.equal(translateAppText('1–5 个字符','ko'),'1~5자');
  for(const group of ['颜色','角色','表情'])for(const prefix of ['上一组','下一组'])for(const locale of ['en','ko'])
    assert.doesNotMatch(translateAppText(prefix+group,locale),/\p{Script=Han}/u);
});
test('language changes refresh welcome copy without translating a custom name',()=>{
  const name='晴空蓝';
  for(const [language,expected] of [['en',`Hi! I'm your ${name}.`],['ko',`안녕! 나는 당신의 ${name}예요.`],['zh-TW',`嘿！我是你的${name}。`],['zh-CN',`嘿！我是你的${name}。`]]){
    applyAppLanguage(language);
    assert.equal(translateAppText('嘿！我是你的{name}。').replace('{name}',name),expected);
    assert.equal(name,'晴空蓝');
  }
});
