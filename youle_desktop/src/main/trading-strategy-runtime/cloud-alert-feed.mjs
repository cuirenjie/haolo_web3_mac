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
function validEvent(event,items) {
  const alert=event?.alert||items.get(event?.alertId),evidence=event?.data?.evidence;
  return Number.isSafeInteger(event?.sequence)&&event.sequence>0&&token(event.data?.eventId)&&positive(event.data?.price)
    &&Number.isSafeInteger(event.data?.occurredAt)&&event.data.occurredAt>0&&alert?.id===event.alertId
    &&conditionValid(alert.rule)&&evidence?.conditionHash===alert.rule.conditionHash
    &&['entry','stop','target:0'].includes(event.data?.condition)
    &&evidence.conditionId===alert.rule.entryCondition.conditionId&&evidence.conditionRevision===alert.rule.entryCondition.revision;
}
export function createCloudAlertFeed({owner,api,journal,notify,changed,intervalMs=15000}) {
  let inFlight=null,timer=null,stopped=true,snapshot={items:[],recentEvents:[]},snapshotOwner='';
  async function tick(captured) {
    const assert=async()=>{const current=await owner();if(current.ownerId!==captured.ownerId||current.baseUrl!==captured.baseUrl)fail('TRADING_PREFERENCE_OWNER_CHANGED');};
    if(snapshotOwner!==captured.ownerId){snapshot={items:[],recentEvents:[]};snapshotOwner=captured.ownerId;}
    const saved=await journal.get(captured.ownerId,'feed');
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
    await journal.put(captured.ownerId,'feed',{state:'feed',cursor:reply.nextCursor,pending:null});
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
  const schedule=()=>{if(stopped)return;timer=setTimeout(async()=>{try {await refresh();}catch{}finally{schedule();}},intervalMs);timer.unref?.();};
  return {refresh,async snapshot(){const current=await owner();return {...(snapshotOwner===current.ownerId?snapshot:{items:[],recentEvents:[]}),accountId:current.accountId,baseUrl:current.baseUrl};},
    start(){if(!stopped)return;stopped=false;schedule();},stop(){stopped=true;clearTimeout(timer);}};
}
