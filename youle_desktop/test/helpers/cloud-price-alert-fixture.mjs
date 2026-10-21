import {randomUUID, createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
export function cloudPriceAlertFixture() {
  const items = [], receipts = new Map(), calls = [];
  let hideList = false, available = true;
  return {items,calls, set hideList(v) {hideList=v;}, set available(v) {available=v;},
    async tradingCloudRequest(operation, body={}, options={}) {
      calls.push({operation,body:structuredClone(body),options});
      if (operation === 'capabilities') return {priceAlerts:available?'inclusive-intrabar-v1':null};
      if (operation === 'priceAlerts') return {items:structuredClone(hideList?[]:items.filter(a=>a.state!=='deleted'))};
      const key=options.idempotencyKey;
      if (receipts.has(key)) {
        const old=receipts.get(key);
        if(!isDeepStrictEqual(old.body,body))throw Object.assign(new Error('reused'),{code:'IDEMPOTENCY_CONFLICT'});
        return structuredClone(old.result);
      }
      let result;
      if(operation === 'createPriceAlertDraft') {
        result={...body,id:randomUUID(),ruleHash:createHash('sha256').update(JSON.stringify(body.rule)).digest('hex'),
          version:1,state:'draft',confirmedVersion:null,createdAt:new Date().toISOString()};items.push(result);
      } else {
        const item=items.find(a=>a.id===body.alertId);
        if(!item||item.version!==body.version)throw Object.assign(new Error('version'),{code:'VERSION_CONFLICT'});
        if(operation === 'confirmPriceAlert') {item.state='arming';item.enabled=true;item.confirmedVersion=body.version;}
        else if(operation === 'priceAlertAction') {item.state={pause:'paused',resume:'arming',delete:'deleted'}[body.action];item.enabled=body.action==='resume';}
        else throw Error(operation);
        item.version++;result=item;
      }
      receipts.set(key,{body:structuredClone(body),result:structuredClone(result)});
      return structuredClone(result);
    },
  };
}
