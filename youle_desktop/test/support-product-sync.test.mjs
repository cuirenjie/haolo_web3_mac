import assert from 'node:assert/strict';
import test from 'node:test';
import { assistText, describeSupportAction, validateSupportProposal, SUPPORT_EXECUTOR_VERSIONS } from '../src/renderer/support-assist.ts';
import { supportRuntime } from '../src/renderer/support-runtime.ts';

test('six reply languages localize consent and operation descriptions',()=>{
  for(const locale of ['zh-CN','zh-Hant','en','ko','ja','vi']) {
    assert.ok(assistText(locale,'accept'));
    assert.ok(describeSupportAction({kind:'set_theme',theme:'dark'},locale));
  }
  assert.equal(assistText('ko','accept'),'허용');
  assert.match(describeSupportAction({kind:'set_theme',theme:'dark'},'ko'),/테마/);
  assert.equal(assistText('zh-Hant','consent'),assistText('zh-TW','consent'));
  for (const [locale, accept] of [['vi', 'Đồng ý'], ['ja', '許可']]) {
    assert.equal(assistText(locale, 'accept'), accept);
    const regional = locale === 'vi' ? 'vi-VN' : 'ja-JP';
    assert.equal(assistText(regional, 'consent'), assistText(locale, 'consent'));
    assert.equal(describeSupportAction({kind:'set_theme',theme:'dark'},regional), describeSupportAction({kind:'set_theme',theme:'dark'},locale));
  }
});
test('registered feature adapters are implemented locally',()=>{
  for(const [k,v] of Object.entries(supportRuntime.action_versions)) assert.equal(SUPPORT_EXECUTOR_VERSIONS[k],v);
});
test('versioned proposal rejects stale contract, channel, release and adapter',()=>{
  const context={...supportRuntime,version:'1.0.0',channel:'haolo_web3_mac'};
  const proposal={plan:[{kind:'set_theme',theme:'dark'}],context_binding:structuredClone(context)};
  validateSupportProposal(proposal,context);
  for(const key of ['version','contract_id','channel']) assert.throws(()=>validateSupportProposal(proposal,{...context,[key]:'other'}));
  proposal.context_binding.action_versions.set_theme=2;
  assert.throws(()=>validateSupportProposal(proposal,context));
  assert.throws(()=>validateSupportProposal({plan:[{kind:'trade'}]},context));
});
