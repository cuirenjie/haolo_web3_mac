import { randomUUID } from 'node:crypto';

const FRESH_MS = 60_000;
const ACTIVE_MS = 75_000;
const CREDENTIAL_ERRORS = new Set(['BINANCE_CREDENTIALS_INVALID', 'BINANCE_AUTH_FAILED', 'BINANCE_SIGNATURE_INVALID']);

// Completion events carry only income fields, never an old balance/position snapshot.
export function createSnapshotComponents({now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout} = {}) {
  let generation = 0;
  const states = new Map();
  function stop(state) { if (state.timer) clearTimer(state.timer); state.timer = null; }
  function invalidate() {
    generation++;
    for (const state of states.values()) stop(state);
    states.clear();
  }
  function makeState() {
    return {scopeId:randomUUID(), sequence:0, pending:null, value:null, retryAt:0,
      expiresAt:0, refreshAt:0, receivedAt:0, timer:null, core:null, coreReceivedAt:0,lastReadAt:0};
  }
  function observedNow(state) {
    return Number(state.core?.asOf ?? state.core?.fetchedAt ?? now()) + Math.max(0, now() - state.coreReceivedAt);
  }
  function valid(state, zone) {
    const value = state.value;
    if (value?.pnlStatus !== 'available' || !Number.isFinite(value.realizedPnlToday)
      || !Number.isFinite(value.pnlAsOf) || now() >= state.expiresAt || now() < state.receivedAt) return false;
    const observed = Math.max(observedNow(state), Number(value.pnlServerTime ?? value.pnlAsOf));
    const day = time => new Intl.DateTimeFormat('en-CA', {timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(time);
    return observed - value.pnlAsOf < FRESH_MS && day(observed) === day(value.pnlAsOf);
  }
  function patch(state, zone) {
    const available = valid(state, zone);
    return {
      pnlScopeId:state.scopeId, pnlSequence:state.sequence, bindingVersion:state.core?.bindingVersion ?? null,
      realizedPnlToday:available ? state.value.realizedPnlToday : null,
      pnlAsOf:available ? state.value.pnlAsOf : null, pnlDayStart:state.value?.pnlDayStart ?? null,
      pnlTimeZone:zone, pnlStatus:available ? 'available' : state.pending ? 'loading' : 'waiting',
      pnlReason:available ? null : state.reason || 'INCOME_PENDING',
      pnlRetryAfterMs:Math.max(0, state.retryAt - now()),
      pnlExpiresAfterMs:available ? Math.max(0, state.expiresAt - now()) : 0,
      ...(state.credentialError ? {pnlError:{code:state.credentialError.code}} : {}),
    };
  }
  function merged(state, zone) {
    const fields = patch(state, zone), core = state.core;
    const today = fields.realizedPnlToday == null ? null : fields.realizedPnlToday + core.unrealizedPnl;
    const base = today == null ? null : core.equity - today;
    return {...core,...fields,todayPnl:today,
      todayPnlPercent:base != null && Math.abs(base)>1e-12 ? today/Math.abs(base)*100 : null};
  }
  function notify(state, config) {
    state.sequence++;
    try { config.onUpdate?.(patch(state, config.zone)); } catch {}
  }
  function active(state, current) {
    return current() && !state.credentialError && now() - state.lastReadAt < ACTIVE_MS
      && now() >= state.lastReadAt;
  }
  function schedule(state, config, current) {
    stop(state);
    if (typeof config.onUpdate !== 'function' || !current()) return;
    const available = valid(state, config.zone);
    const due = !active(state,current) || state.pending ? (available ? state.expiresAt : Infinity)
      : Math.max(state.retryAt, available ? state.refreshAt : now());
    if (!Number.isFinite(due)) return;
    const delay = Math.max(250, Math.min(due, available ? state.expiresAt : Infinity) - now());
    state.timer = setTimer(() => {
      state.timer = null;
      if (!current()) return;
      if (!valid(state, config.zone)) notify(state, config);
      if (!active(state, current)) { schedule(state,config,current); return; }
      if (!state.pending && now() >= state.retryAt) start(state, config, current);
      else schedule(state, config, current);
    }, delay);
    state.timer?.unref?.();
  }
  function start(state, config, current) {
    state.pending = Promise.resolve().then(() => config.pnl(state.core)).then(value => {
      if (!current()) return;
      if (value.bindingVersion != null && state.core.bindingVersion != null
          && value.bindingVersion !== state.core.bindingVersion) {
        throw Object.assign(new Error('Account binding changed'), {code:'ACCOUNT_CONNECTION_CHANGED',retryAfterMs:15_000});
      }
      state.reason = value.pnlReason || null;
      if (value.pnlStatus === 'available' && Number.isFinite(value.realizedPnlToday) && Number.isFinite(value.pnlAsOf)) {
        state.receivedAt = now(); state.value = value;
        const age = Math.max(0, Math.max(observedNow(state), Number(value.pnlServerTime ?? value.pnlAsOf)) - value.pnlAsOf);
        let ttl = Math.max(0, Math.min(FRESH_MS - age, Number(value.pnlExpiresAfterMs ?? FRESH_MS)));
        // Schedule expiry at the local day boundary even for an older server
        // without an explicit remaining lifetime (including DST time zones).
        const observed = Math.max(observedNow(state), Number(value.pnlServerTime ?? value.pnlAsOf));
        const formatDay = new Intl.DateTimeFormat('en-CA',{timeZone:config.zone,year:'numeric',month:'2-digit',day:'2-digit'});
        if (formatDay.format(observed) !== formatDay.format(observed+ttl)) {
          let low=0,high=Math.ceil(ttl);
          while(high-low>1){const mid=Math.floor((low+high)/2);if(formatDay.format(observed+mid)===formatDay.format(observed))low=mid;else high=mid;}
          ttl=high;
        }
        state.expiresAt = now() + ttl;
        state.refreshAt = now() + Math.max(750, Math.min(ttl, Number(value.pnlRefreshAfterMs ?? Math.max(0, 52_000-age))));
        state.retryAt = value.pnlRefreshPending ? now() + Math.max(750, Number(value.pnlRetryAfterMs) || 750) : 0;
      } else {
        // A failed soft refresh keeps a previous value only until its original expiry.
        state.retryAt = now() + Math.max(750, Number(value.pnlRetryAfterMs) || 15_000);
      }
    }).catch(error => {
      if (!current()) return;
      state.reason = String(error?.code || 'INCOME_HISTORY_UNAVAILABLE');
      if (CREDENTIAL_ERRORS.has(error?.code)) { state.credentialError=error; state.value=null; }
      if (['ACCOUNT_CONNECTION_CHANGED','CONNECTION_REVOKED','ACCOUNT_CHANGED'].includes(error?.code)) state.value=null;
      state.retryAt = now() + Math.max(1500, Number(error?.retryAfterMs) || 15_000);
    }).finally(() => {
      if (!current()) return;
      state.pending = null;
      notify(state, config);
      schedule(state, config, current);
    });
    schedule(state, config, current);
  }
  async function read(config) {
    const {scope,zone,core,isCurrent = () => true} = config;
    const epoch = generation;
    const snapshot = await core();
    if (epoch !== generation || !isCurrent()) throw Object.assign(new Error('Haolo 账号已切换，请重新读取账户数据。'),{code:'ACCOUNT_CHANGED',retryable:false});
    let state = states.get(scope);
    // A delayed core response from before rebind must not recreate the old
    // income scope or restart reads with superseded credentials.
    if (Number.isFinite(state?.core?.bindingVersion) && Number.isFinite(snapshot.bindingVersion)
      && snapshot.bindingVersion < state.core.bindingVersion) return merged(state, zone);
    if (!state || state.core?.bindingVersion !== snapshot.bindingVersion) {
      if (state) stop(state);
      state = makeState(); states.set(scope,state);
      while (states.size > 16) { const key=states.keys().next().value;stop(states.get(key));states.delete(key); }
    }
    const current = () => epoch === generation && states.get(scope) === state && isCurrent();
    state.lastReadAt = now();
    if (!state.core || Number(snapshot.asOf ?? snapshot.fetchedAt) > Number(state.core.asOf ?? state.core.fetchedAt)) {
      state.core = snapshot; state.coreReceivedAt = now();
    }
    if (state.credentialError) throw state.credentialError;
    if ((!valid(state,zone) || now() >= state.refreshAt) && !state.pending && now() >= state.retryAt) start(state,config,current);
    else schedule(state,config,current);
    return merged(state,zone);
  }
  return {read,invalidate};
}
