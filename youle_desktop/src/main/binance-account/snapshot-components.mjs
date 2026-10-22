// Core positions never wait for optional income. Each component retains its
// original timestamp; expired income is unavailable, never an invented zero.
export function createSnapshotComponents({now = Date.now} = {}) {
  let generation = 0;
  const states = new Map();
  const invalidate = () => { generation++; states.clear(); };
  async function read({scope, zone, core, pnl, isCurrent = () => true}) {
    const epoch = generation;
    let state = states.get(scope);
    if (!state) {
      state = {pending:null, value:null, retryAt:0}; states.set(scope,state);
      while(states.size>16)states.delete(states.keys().next().value);
    }
    const current = () => epoch === generation && states.get(scope) === state && isCurrent();
    const snapshot = await core();
    if (!current()) throw Object.assign(new Error('Haolo 账号已切换，请重新读取账户数据。'),{code:'ACCOUNT_CHANGED',retryable:false});
    if(state.credentialError)throw state.credentialError;
    const day = time => new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(time);
    const cached = state.value;
    // Compare exchange observations with each other; a skewed desktop clock
    // must not make every valid income observation appear to be in the future.
    const observedNow = Number(snapshot.asOf ?? snapshot.fetchedAt ?? now());
    const valid = cached?.pnlStatus === 'available' && Number.isFinite(cached.realizedPnlToday)
      && Number.isFinite(cached.pnlAsOf) && Number.isFinite(observedNow)
      && now() - state.receivedAt >= 0 && now() - state.receivedAt < 60_000
      && observedNow - cached.pnlAsOf >= 0 && observedNow - cached.pnlAsOf < 60_000
      && day(observedNow) === day(cached.pnlAsOf);
    if (!valid && !state.pending && now() >= state.retryAt) {
      state.pending = Promise.resolve().then(pnl).then(value => {
        if(!current())return;
        state.value=value;
        state.receivedAt=now();
        state.retryAt=now()+(value.pnlStatus==='available'?0:Math.max(15_000, Number(value.pnlRetryAfterMs)||0));
      }, error => {
        if(!current())return;
        state.value=null;
        if(['BINANCE_CREDENTIALS_INVALID','BINANCE_AUTH_FAILED','BINANCE_SIGNATURE_INVALID'].includes(error?.code))state.credentialError=error;
        state.retryAt=now()+Math.max(15_000,Number(error?.retryAfterMs)||0);
      }).finally(()=>{state.pending=null;});
    }
    if(!valid)return {...snapshot,todayPnl:null,todayPnlPercent:null,realizedPnlToday:null,pnlAsOf:null,pnlStatus:'unavailable',pnlTimeZone:zone};
    const today=cached.realizedPnlToday+snapshot.unrealizedPnl;
    const base=snapshot.equity-today;
    return {...snapshot,realizedPnlToday:cached.realizedPnlToday,todayPnl:today,
      todayPnlPercent:Math.abs(base)>1e-12?today/Math.abs(base)*100:null,
      pnlStatus:'available',pnlAsOf:cached.pnlAsOf,pnlDayStart:cached.pnlDayStart,pnlTimeZone:zone};
  }
  return {read,invalidate};
}
