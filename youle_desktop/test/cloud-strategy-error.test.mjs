import assert from 'node:assert/strict';
import test from 'node:test';
import {cloudStrategyFailure} from '../src/main/trading-strategy-runtime/cloud-error.mjs';
import {describeTradingAnalysisFailure} from '../src/main/trading-analysis/failure.mjs';
import {buildTradingStrategyFailureReport} from '../src/main/trading-analysis/failure.mjs';
import {tradingAnalysisFailureDiagnostic} from '../src/main/trading-analysis/diagnostics.mjs';

test('dual-left rollout and budget failures retain specific three-language explanations',()=>{
  for(const code of ['LEFT_DUAL_NOT_ENABLED','LEFT_DUPLICATE_MARKET_PLAN','LEFT_ZONE_ATTEMPT_LIMIT','LEFT_OPEN_RISK_BUDGET','LEFT_DAILY_RISK_BUDGET','LEFT_PLAN_ALREADY_USED'])for(const language of ['zh-CN','en','zh-TW']){
    const error=cloudStrategyFailure({code},{language});
    assert.equal(error.code,code);assert.doesNotMatch(error.message,/Cloud analysis did not complete|云端分析未完成|雲端分析未完成/);
    if(language==='en')assert.doesNotMatch(error.message,/\p{Script=Han}/u);
  }
});

test('an unconfirmed cancellation never becomes confirmed merely because the local signal aborted',()=>{
  for(const language of ['en','zh-CN','zh-TW']) {
    const error=cloudStrategyFailure({code:'CLOUD_CANCEL_PENDING',message:'private upstream content'},{aborted:true,language});
    assert.equal(error.code,'CLOUD_CANCEL_PENDING');
    assert.equal(describeTradingAnalysisFailure(error,{language}).cancelled,false);
    assert.doesNotMatch(error.message,/private upstream/);
  }
});

test('history admission errors remain actionable through IPC, reports and diagnostics in all locales',()=>{
  for(const language of ['zh-CN','en','zh-TW','zh-Hant']) {
    for(const [code,category] of [['MARKET_HISTORY_INSUFFICIENT','history'],['ANALYSIS_WINDOW_INSUFFICIENT','analysis_window']]) {
      const error=cloudStrategyFailure({code,status:409,payload:{detail:{code}},message:'private upstream data'},{language});
      assert.equal(error.code,code);
      assert.equal(error.status,409);
      assert.equal(describeTradingAnalysisFailure(error,{language}).category,category);
      assert.equal(tradingAnalysisFailureDiagnostic(error).errorClass,category);
      const report=buildTradingStrategyFailureReport({id:'order-flow',display:{name:language==='en'?'Order flow':'訂單流'}},error,{language});
      assert.doesNotMatch(report,/private|分析流程未能完成|The analysis could not complete/);
      if(language==='en')assert.doesNotMatch(report,/\p{Script=Han}/u);
      else if(language!=='zh-CN')assert.match(report,/雲端|請/);
    }
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

test('an ambiguous model completion retains a specific safe explanation in three languages',()=>{
  for(const language of ['zh-CN','en','zh-Hant']) {
    const error=cloudStrategyFailure({code:'MODEL_OUTCOME_UNKNOWN',message:'private upstream response'},{language});
    assert.equal(describeTradingAnalysisFailure(error,{language}).category,'model_unknown');
    const report=buildTradingStrategyFailureReport({id:'wave',display:{name:'Wave'}},error,{language});
    assert.doesNotMatch(report,/private|分析流程未能完成|The analysis could not complete/);
    assert.match(report,language==='en'?/original task record was retained/:language==='zh-Hant'?/原任務記錄已保留/:/原任务记录已保留/);
    assert.doesNotMatch(report,/without an automatic repeat|未自動重複請求|未自动重复请求/);
  }
});

test('model deadlines remain timeouts through cloud errors, reports and diagnostics in all locales',()=>{
  for(const language of ['zh-CN','en','zh-Hant']) {
    const error=cloudStrategyFailure({code:'MODEL_TIMEOUT',message:'private upstream response'},{language});
    assert.equal(describeTradingAnalysisFailure(error,{language}).category,'timeout');
    assert.equal(tradingAnalysisFailureDiagnostic(error).errorClass,'timeout');
    const report=buildTradingStrategyFailureReport({id:'wave',display:{name:'Wave'}},error,{language});
    assert.match(report,language==='en'?/timed out/:language==='zh-Hant'?/逾時/:/超时/);
    assert.doesNotMatch(report,/private|未自动重复请求|模型响应结果尚未确认/);
  }
});
