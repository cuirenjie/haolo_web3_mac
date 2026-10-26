import {createHash} from 'node:crypto';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const token=value=>typeof value==='string'&&value.length>0&&value.length<=200;
const predicate=value=>value&&['at_or_above','at_or_below','in_zone','cross_up','cross_down'].includes(value.operator)
  &&positive(value.lower)&&(value.operator==='in_zone'?positive(value.upper)&&value.upper>=value.lower:value.upper==null);
const conditionValid=rule=>rule?.monitoringPolicy==='entry_v2'&&hash(rule.conditionHash)
  &&token(rule.marketKey)&&token(rule.interval)&&token(rule.entryCondition?.conditionId)
  &&Number.isSafeInteger(rule.entryCondition?.revision)&&rule.entryCondition.revision>0
  &&rule.entryCondition?.schemaVersion===2&&['touch','bar_close','breakout_retest'].includes(rule.entryCondition.confirmation)
  &&predicate(rule.entryCondition.trigger)&&Number.isSafeInteger(rule.entryCondition.expiresAt)&&rule.entryCondition.expiresAt>0
  &&(!rule.entryCondition.invalidation||predicate(rule.entryCondition.invalidation))
  &&(rule.entryCondition.confirmation!=='breakout_retest'||(predicate(rule.entryCondition.retest)&&rule.entryCondition.retest.operator==='in_zone'));
export function validEvent(event,items) {
  const alert=event?.alert||items.get(event?.alertId),evidence=event?.data?.evidence;
  const name=event?.data?.condition,exits=alert?.rule?.preferenceExitPolicy;
  const newExit=exits?.version==='preference-exits-v1'&&(
    name==='break_even'&&exits.moveStopToBreakEven===true
    ||name==='time'&&positive(alert.rule.leftHoldingDeadline)
    ||name==='structure'&&alert.rule.leftPolicy?.version==='price-action-left-dual-v1'
    ||/^target:[12]$/.test(name)&&positive(alert.rule.targets?.[Number(name.split(':')[1])]));
  return Number.isSafeInteger(event?.sequence)&&event.sequence>0&&token(event.data?.eventId)&&positive(event.data?.price)
    &&Number.isSafeInteger(event.data?.occurredAt)&&event.data.occurredAt>0&&alert?.id===event.alertId
    &&conditionValid(alert.rule)&&evidence?.conditionHash===alert.rule.conditionHash
    &&(['entry','stop','target:0'].includes(name)||newExit)
    &&evidence.conditionId===alert.rule.entryCondition.conditionId&&evidence.conditionRevision===alert.rule.entryCondition.revision;
}
export function createCloudAlertFeed({owner,api,journal,notify,changed,intervalMs=15000,eventsMode=false,now=Date.now}) {
  let inFlight=null,timer=null,stopped=true,snapshot={items:[],recentEvents:[]},snapshotOwner='';
  async function tick(captured) {
    const assert=async()=>{const current=await owner();if(current.ownerId!==captured.ownerId||current.baseUrl!==captured.baseUrl)fail('TRADING_PREFERENCE_OWNER_CHANGED');};
    if(snapshotOwner!==captured.ownerId){snapshot={items:[],recentEvents:[]};snapshotOwner=captured.ownerId;}
    const saved=eventsMode?null:await journal.get(captured.ownerId,'feed');
    if(saved&&(!Number.isSafeInteger(saved.cursor)||saved.cursor<0))fail('CLOUD_ALERT_CURSOR_INVALID');
    await assert();
    const reply=await api().tradingCloudRequest('alertFeed',saved?{after:saved.cursor}:{},{expectedAccountId:captured.accountId,expectedBaseUrl:captured.baseUrl});
    await assert();
    if(reply.schemaVersion!==1||!Array.isArray(reply.items)||reply.items.length>200||!Array.isArray(reply.events)||reply.events.length>200
      ||!Array.isArray(reply.recentEvents)||reply.recentEvents.length>20||!Number.isSafeInteger(reply.nextCursor)||reply.nextCursor<(saved?.cursor||0))fail('CLOUD_ALERT_FEED_INVALID');
    let cursor=saved?.cursor??reply.nextCursor;
    const items=new Map(reply.items.map(item=>[item.id,item]));
    for(const item of reply.items)if(!token(item?.id)||!conditionValid(item.rule))fail('CLOUD_ALERT_FEED_INVALID');
    if(items.size!==reply.items.length||reply.recentEvents.some(event=>!validEvent(event,items)))fail('CLOUD_ALERT_FEED_INVALID');
    for(const event of reply.events) {
      if(!validEvent(event,items)||event.sequence<=cursor||event.sequence>reply.nextCursor)fail('CLOUD_ALERT_FEED_INVALID');
      const alert=event.alert||items.get(event.alertId);
      await assert();
      // Commit a durable pending delivery before notifying. A crash can repeat
      // the same event, never silently consume it before notification succeeds.
      await journal.put(captured.ownerId,'feed',{state:'feed',cursor,pending:event.data.eventId});
      await assert();
      await notify({alert,event});
      await assert();
      cursor=event.sequence;
      await journal.put(captured.ownerId,'feed',{state:'feed',cursor,pending:null});
    }
    await assert();
    if(!eventsMode)await journal.put(captured.ownerId,'feed',{state:'feed',cursor:reply.nextCursor,pending:null});
    await assert();
    snapshot={items:reply.items,recentEvents:reply.recentEvents,hasMore:reply.hasMore===true};snapshotOwner=captured.ownerId;
    changed?.({...snapshot,accountId:captured.accountId,baseUrl:captured.baseUrl});
    return snapshot;
  }
  const refresh=()=>{
    if(inFlight)return inFlight;
    inFlight=(async()=>{
      const captured=await owner();
      try {return await tick(captured);}
      catch(error) {
        const current=await owner().catch(()=>null);
        if(current?.ownerId===captured.ownerId&&current.baseUrl===captured.baseUrl) {
          snapshot={items:[],recentEvents:[],error:{code:error.code||'CLOUD_ALERT_FEED_UNAVAILABLE'}};snapshotOwner=captured.ownerId;
          changed?.({...snapshot,accountId:captured.accountId,baseUrl:captured.baseUrl});
        }
        throw error;
      }
    })().finally(()=>{inFlight=null;});
    return inFlight;
  };
  let delivering=Promise.resolve();
  async function receipt(captured) {
    const value=await journal.get(captured.ownerId,'delivery-v2');
    if(value&&(!Number.isSafeInteger(value.cursor)||value.cursor<0||!Array.isArray(value.recentEvents)))fail('CLOUD_ALERT_CURSOR_INVALID');
    return value||{cursor:0,recentEvents:[],pending:null};
  }
  async function accept(captured,page,assert) {
    await assert();
    if(snapshotOwner!==captured.ownerId){snapshot={items:[],recentEvents:[]};snapshotOwner=captured.ownerId;}
    let saved=await receipt(captured);
    if(page.version!==2||!Array.isArray(page.events)||page.events.length>100
      ||!Number.isSafeInteger(page.cursor)||page.cursor<0||!Number.isSafeInteger(page.head)||page.head<0||page.cursor>page.head)fail('CLOUD_ALERT_FEED_INVALID');
    let sequence=saved.cursor;
    for(const event of page.events) {
      if(!Number.isSafeInteger(event?.sequence)||event.sequence<=0||!Number.isSafeInteger(event.sourceSequence)||event.sourceSequence<=0)fail('CLOUD_ALERT_FEED_INVALID');
      if(event.sequence<=saved.cursor)continue;
      if(event.sequence!==sequence+1)fail('CLOUD_ALERT_SEQUENCE_GAP');
      sequence=event.sequence;
    }
    if(sequence!==Math.max(saved.cursor,page.cursor))fail('CLOUD_ALERT_FEED_INVALID');
    const legacy=await journal.get(captured.ownerId,'feed');
    for(const event of page.events) {
      if(event.sequence<=saved.cursor)continue;
      await assert();
      if(!validEvent(event,new Map())) {
        // A failed receipt is distinct from delivery. Original evidence stays
        // in the server outbox; persist its digest and source reference with
        // the cursor atomically. Bound the local journal during long catchup.
        const failure={sequence:event.sequence,sourceSequence:event.sourceSequence,
          code:event.rejected==='EVENT_TOO_LARGE'?'EVENT_TOO_LARGE':'CLOUD_ALERT_EVIDENCE_INVALID',at:now(),
          digest:createHash('sha256').update(JSON.stringify(event)).digest('hex')};
        saved={...saved,cursor:event.sequence,pending:null,
          failedCount:(saved.failedCount||0)+1,
          failedDigest:createHash('sha256').update((saved.failedDigest||'')+JSON.stringify(failure)).digest('hex'),
          failedReceipts:[failure,...(saved.failedReceipts||[])].slice(0,200)};
        await journal.put(captured.ownerId,'delivery-v2',saved);
        continue;
      }
      // The inbox survives a crash even if the OS notification is disabled.
      saved={...saved,pending:event};
      await journal.put(captured.ownerId,'delivery-v2',saved);
      await assert();
      const old=event.sourceSequence<=(legacy?.cursor||0)||saved.recentEvents.some(prior=>prior.data.eventId===event.data.eventId);
      const age=now()-event.data.occurredAt;
      if(!old&&age>=-60000&&age<=300000)await notify({alert:event.alert,event});
      await assert();
      saved={...saved,cursor:event.sequence,pending:null,recentEvents:[event,...saved.recentEvents.filter(prior=>prior.data.eventId!==event.data.eventId)].slice(0,200)};
      await journal.put(captured.ownerId,'delivery-v2',saved);
    }
    await assert();
    snapshot={...snapshot,recentEvents:saved.recentEvents,error:undefined};snapshotOwner=captured.ownerId;
    changed?.({...snapshot,accountId:captured.accountId,baseUrl:captured.baseUrl});
  }
  return {refresh,
    async cursor(captured){return (await receipt(captured)).cursor;},
    deliver(captured,page,assert){const work=delivering.then(()=>accept(captured,page,assert));delivering=work.catch(()=>{});return work;},
    async gap(captured,value){
      if(value.reason!=='history_expired'||!Number.isSafeInteger(value.cursor)||value.cursor<0)fail('CLOUD_ALERT_CURSOR_INVALID');
      const current=await owner();if(current.ownerId!==captured.ownerId||current.baseUrl!==captured.baseUrl)fail('TRADING_PREFERENCE_OWNER_CHANGED');
      const saved=await receipt(captured);if(value.cursor<saved.cursor)fail('CLOUD_ALERT_CURSOR_INVALID');
      await journal.put(captured.ownerId,'delivery-v2',{...saved,cursor:value.cursor,historyGap:true});
    },
    async snapshot(){const current=await owner();const saved=eventsMode?await receipt(current):null;return {...(snapshotOwner===current.ownerId?snapshot:{items:[],recentEvents:[]}),...(saved?{recentEvents:saved.recentEvents,historyGap:!!saved.historyGap}:{}),accountId:current.accountId,baseUrl:current.baseUrl};},
    // Scheduling belongs to the one account event connection. Explicit refresh
    // remains a read for opening the reminder UI and old test/integration users.
    start(){stopped=false;},stop(){stopped=true;clearTimeout(timer);}};
}
