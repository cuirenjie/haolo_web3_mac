import {isRecoverableNetworkError,networkErrorCode} from './system-proxy-fetch.mjs';

const AUTH_CODES=new Set(['HAOLO_AUTH_REQUIRED','HAOLO_ACCOUNT_ID_REQUIRED','AUTH_SESSION_REQUIRED','YOULE_AUTH_EXPIRED','TRADING_PREFERENCE_OWNER_CHANGED']);
const CANCEL_CODES=new Set(['REQUEST_CANCELLED','TRADING_ANALYSIS_CANCELLED']);
const INVALID_CODES=new Set(['CLOUD_RESULT_CONTEXT_INVALID','CLOUD_PLAN_LIST_INVALID','CLOUD_REPORT_INVALID','CLOUD_PLAN_LIMIT','PLAN_CURSOR_EXPIRED']);

// Shared by the trusted IPC boundary and renderer. Never infer a retry from the
// translated display message, or let retryable=true override an auth/4xx refusal.
export function cloudPlanSyncFailurePolicy(error) {
  const detail=error?.payload?.detail || error?.detail;
  const rawCode=detail?.code || error?.code || networkErrorCode(error);
  const code=/^[A-Z0-9_.-]{1,100}$/.test(String(rawCode || ''))?String(rawCode):'CLOUD_PLAN_SYNC_FAILED';
  const status=Number.isInteger(error?.status)&&error.status>=100&&error.status<=599?error.status:null;
  const retryAfterMs=typeof error?.retryAfterMs==='number'&&Number.isFinite(error.retryAfterMs)
    ?Math.min(2_147_483_647,Math.max(0,error.retryAfterMs)):0;
  let category='permanent';
  if(AUTH_CODES.has(code)||[401,403].includes(status))category='authentication';
  else if(CANCEL_CODES.has(code)||error?.name==='AbortError'||error?.category==='cancelled')category='cancelled';
  else if(INVALID_CODES.has(code))category='permanent';
  else if(status!==null) {
    if([408,425,429].includes(status)||status>=500)category='service';
  } else if(isRecoverableNetworkError(error)||code==='REQUEST_TIMEOUT'||error?.name==='TimeoutError'
    ||['transport','timeout','network'].includes(error?.category))category='network';
  else if(error?.retryable===true)category='service';
  const retryable=category==='network'||category==='service';
  return {code,status,category,retryable,retryAfterMs,silent:retryable||category==='cancelled'};
}
