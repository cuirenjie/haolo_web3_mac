import assert from 'node:assert/strict';
import test from 'node:test';
import {setup} from './helpers/cloud-renderer-harness.mjs';
for(const method of ['runGeneralConversation','runChanConversation','runWaveConversation','runWyckoffConversation','runOrderFlowConversation']) {
  test(method+' preserves the selected model on the main chart and split panes',async()=>{
    const s=setup();await s.workspace[method]({instruction:'analyze',model:'gpt-6-astra',modelId:'gpt-6-astra',modelProvider:'codex',explicitModelSelection:true});
    assert.equal(s.calls.length,2);
    for(const body of s.calls)assert.deepEqual([body.model,body.modelId,body.modelProvider,body.explicitModelSelection],['gpt-6-astra','gpt-6-astra','codex',true]);
  });
}
