// Read-only local ledger reconciliation; does not invoke models or fetch secrets.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

for(const directory of process.argv.slice(2)){
  const read=name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
  const audit=read('requests.json'),billing=read('billing.json');
  assert.equal(new Set(billing.rows.map(x=>x.id)).size,billing.rows.length,'duplicate ledger ID');
  const arms={};
  for(const arm of ['baseline','optimized']){
    const requests=audit.requests.filter(x=>x.arm===arm), ids=new Set(requests.map(x=>x.interactionId));
    const rows=billing.rows.filter(x=>ids.has(x.interaction_id));
    const successful=requests.filter(x=>x.responseStatus==='completed');
    assert.equal(rows.length,successful.length,'usage row count mismatch');
    for(const request of successful){
      const matches=rows.filter(x=>x.interaction_id===request.interactionId);
      assert.equal(matches.length,1,'must have exactly one ledger row');
      const row=matches[0];
      assert.equal(row.request_id,`client:${request.clientRequestId}`);
      assert.equal(row.input_tokens+row.cache_read_tokens,request.usage.input_tokens);
      assert.equal(row.output_tokens,request.usage.output_tokens);
      assert.equal(row.upstream_model,'deepseek-flash');
      assert.equal(row.requested_model,'gpt-5.6-sol');
      assert.equal(row.reasoning_effort,'low');
      assert.equal(row.rate_multiplier,2.5);
      assert.equal(request.billingContract,'gpt-v1');
    }
    const sum=key=>rows.reduce((s,x)=>s+Number(x[key]||0),0);
    arms[arm]={requests:requests.length,successful:successful.length,ledgerRows:rows.length,
      uncachedInput:sum('input_tokens'),cachedInput:sum('cache_read_tokens'),output:sum('output_tokens'),
      actualCredits:Number(sum('actual_cost').toFixed(8)),elapsedMs:requests.reduce((s,x)=>s+(x.elapsedMs||0),0)};
  }
  assert.equal(billing.rows.length,Object.values(arms).reduce((s,x)=>s+x.ledgerRows,0));
  const summary={prefix:audit.prefix,observedAt:billing.observedAt,arms,
    inputReduction:1-(arms.optimized.uncachedInput+arms.optimized.cachedInput)/(arms.baseline.uncachedInput+arms.baseline.cachedInput),
    creditReduction:1-arms.optimized.actualCredits/arms.baseline.actualCredits};
  fs.writeFileSync(path.join(directory,'reconciled-summary.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary));
}
