import assert from 'node:assert/strict';
import test from 'node:test';
import {cloudStrategyFailure} from '../src/main/trading-strategy-runtime/cloud-error.mjs';
import {describeTradingAnalysisFailure,buildTradingStrategyFailureReport,tradingAnalysisStoppedMessage} from '../src/main/trading-analysis/failure.mjs';
import {tradingAnalysisFailureDiagnostic} from '../src/main/trading-analysis/diagnostics.mjs';

for (const language of ['zh-CN','en','zh-TW','zh-Hant']) {
  test(`order flow quota exhaustion remains distinct from absent data (${language})`,()=>{
    const code='ORDER_FLOW_DATA_RATE_LIMITED';
    const error=cloudStrategyFailure({code,message:'private upstream response'},{language});
    const failure=describeTradingAnalysisFailure(error,{language});
    assert.equal(failure.category,'order_flow_rate_limit');
    assert.equal(failure.allowLocalRecovery,false);
    assert.equal(tradingAnalysisFailureDiagnostic(error).errorClass,'order_flow_rate_limit');
    const reports=[error.message,failure.summary,
      buildTradingStrategyFailureReport({id:'order-flow',display:{name:'Order flow'}},error,{language}),
      tradingAnalysisStoppedMessage(error,{language,strategyName:'Order flow'})];
    for(const report of reports) {
      assert.match(report,language==='en'?/rate limited/:language==='zh-CN'?/行情请求仍受限/:/行情請求仍受限/);
      assert.doesNotMatch(report,/private|积分|點數|credits|数据不足|資料不足/);
      if(language==='en')assert.doesNotMatch(report,/\p{Script=Han}/u);
    }
    assert.equal(describeTradingAnalysisFailure({code:'ORDER_FLOW_DATA_UNAVAILABLE'},{language}).category,'order_flow_data');
  });
}
