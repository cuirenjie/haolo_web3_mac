import assert from 'node:assert/strict';
import test from 'node:test';
import {waitForAnalysisAdmission,isAnalysisAdmissionBusy} from '../src/main/trading-strategy-runtime/admission-recovery.mjs';
import {marketRecoveryProgressMessage} from '../src/shared/market-recovery-progress.mjs';
import {describeTradingAnalysisFailure} from '../src/main/trading-analysis/failure.mjs';
import {tradingAnalysisFailureDiagnostic} from '../src/main/trading-analysis/diagnostics.mjs';

const busy = extra=>Object.assign(Error('busy'),{status:429,code:'MOBILE_BUSY',retryable:true,...extra});
test('server retry delay is respected with short cancellable sleeps and bounded admission waiting',async()=>{
  let calls=0,clock=0;const waits=[],progress=[];
  const result = await waitForAnalysisAdmission({request:async()=>{if(++calls<3)throw busy({retryAfterMs:7000});return 'ready';},
    assertOwner:async()=>{},random:()=>0,now:()=>clock,wait:async ms=>{clock+=ms;waits.push(ms);},onProgress:p=>progress.push(p)});
  assert.equal(result,'ready');assert.equal(clock,14000);assert.ok(waits.every(ms=>ms<=1000));
  assert.deepEqual(progress.map(p=>p.stage),['service_waiting','service_waiting','service_ready']);
  calls=0;clock=0;
  await assert.rejects(waitForAnalysisAdmission({request:async()=>{calls++;throw busy();},assertOwner:async()=>{},random:()=>0,
    timeoutMs:2500,now:()=>clock,wait:async ms=>{clock+=ms;}}),{code:'MOBILE_BUSY'});
  assert.equal(clock,2500);assert.equal(calls,2);
});

test('only a proven pre-handler rejection permits replay, never ambiguous or charged failures',async()=>{
  for(const error of [busy({status:503}),busy({code:'ANALYSIS_CREDITS_REQUIRED'}),busy({code:'RUN_LIMIT'}),
    busy({code:'ANALYSIS_QUEUE_FULL'}),busy({retryable:false}),Object.assign(Error('timeout'),{code:'REQUEST_TIMEOUT'}),
    busy({payload:{detail:{code:'MODEL_RATE_LIMITED'}}})]) {
    assert.equal(isAnalysisAdmissionBusy(error),false);
    let calls=0;
    await assert.rejects(waitForAnalysisAdmission({request:async()=>{calls++;throw error;},assertOwner:async()=>{},wait:()=>{throw Error('must not wait');}}),e=>e===error);
    assert.equal(calls,1);
  }
});

test('stop or owner change interrupts waiting before another request or progress publication',async()=>{
  for(const mode of ['stop','owner']) {
    let calls=0,changed=false;const controller=new AbortController();
    await assert.rejects(waitForAnalysisAdmission({request:async()=>{calls++;throw busy();},signal:controller.signal,
      assertOwner:async()=>{if(changed)throw Object.assign(Error('owner'),{code:'TRADING_PREFERENCE_OWNER_CHANGED'});},
      wait:async()=>{if(mode==='stop')controller.abort();else changed=true;}}),
    e=>mode==='stop'?e.name==='AbortError':e.code==='TRADING_PREFERENCE_OWNER_CHANGED');
    assert.equal(calls,1);
  }
});

test('busy remains recognizable across IPC and progress has five locale variants',()=>{
  assert.equal(describeTradingAnalysisFailure({code:'MOBILE_BUSY'}).category,'rate_limit');
  for(const stage of ['service_waiting','service_ready']) {
    const values=['zh-CN','en','zh-Hant','ko','ja'].map(language=>marketRecoveryProgressMessage(stage,language));
    assert.equal(new Set(values).size,5);assert.ok(values.every(Boolean));
    assert.doesNotMatch(values[1],/\p{Script=Han}/u);
    assert.match(values[3],/\p{Script=Hangul}/u);assert.match(values[4],/\p{Script=Hiragana}/u);
  }
});

test('failure diagnostics identify the failed operation without logging arbitrary request content',()=>{
  assert.equal(tradingAnalysisFailureDiagnostic(busy({analysisOperation:'preferences'})).operation,'preferences');
  assert.equal(tradingAnalysisFailureDiagnostic(busy({analysisOperation:'Authorization: secret'})).operation,null);
});
