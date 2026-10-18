import assert from 'node:assert/strict';
import test from 'node:test';
import {cloudStrategyFailure} from '../src/main/trading-strategy-runtime/cloud-error.mjs';
import {describeTradingAnalysisFailure} from '../src/main/trading-analysis/failure.mjs';

test('an unconfirmed cancellation never becomes confirmed merely because the local signal aborted',()=>{
  for(const language of ['en','zh-CN','zh-TW']) {
    const error=cloudStrategyFailure({code:'CLOUD_CANCEL_PENDING',message:'private upstream content'},{aborted:true,language});
    assert.equal(error.code,'CLOUD_CANCEL_PENDING');
    assert.equal(describeTradingAnalysisFailure(error,{language}).cancelled,false);
    assert.doesNotMatch(error.message,/private upstream/);
  }
});

test('cloud error envelopes use bounded fixed messages and no local strategy recovery',()=>{
  for(const code of ['WINDOWS_WORKER_UNAVAILABLE','WINDOWS_STRATEGY_UNSUPPORTED','CLOUD_RUN_PENDING','CLOUD_RESULT_CONTEXT_INVALID','UNKNOWN_PRIVATE_UPSTREAM']) {
    const error=cloudStrategyFailure({payload:{detail:{code}},message:'api-key-secret'},{language:'en'});
    assert.equal(error.code,code);
    assert.doesNotMatch(error.message,/secret|\p{Script=Han}/u);
    assert.equal(describeTradingAnalysisFailure(error).allowLocalRecovery,false);
  }
});
