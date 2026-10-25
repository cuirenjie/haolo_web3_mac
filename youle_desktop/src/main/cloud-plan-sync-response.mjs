import { koreanText, localizedChoice } from '../shared/korean.mjs';
import {randomUUID} from 'node:crypto';
import {cloudPlanSyncFailurePolicy} from './cloud-plan-sync-policy.mjs';
import {redactSupportText} from './diagnostic-support-evidence.mjs';
import {diagnosticHash} from './turn-diagnostics.mjs';

const messages={
  failed:['云端计划暂时无法同步，请稍后再试。','Cloud plans could not be synchronized. Please try again later.','雲端計畫暫時無法同步，請稍後再試。'],
  authentication:['请重新登录后同步云端计划。','Sign in again to synchronize cloud plans.','請重新登入後同步雲端計畫。'],
  invalid:['云端计划数据校验未通过，已保留本机计划。请更新客户端；若仍失败，请联系客服。',
    'Cloud plan data could not be validated. Local plans have been kept. Update the app; if this continues, contact support.',
    '雲端計畫資料驗證未通過，已保留本機計畫。請更新用戶端；若仍失敗，請聯絡客服。',
    '클라우드 계획 데이터를 검증하지 못했습니다. 로컬 계획은 유지됩니다. 앱을 업데이트한 후에도 문제가 계속되면 고객 지원에 문의하세요.'],
};

function originalError(error,seen=new Set()) {
  if(error==null||seen.has(error)||seen.size>=4)return null;
  seen.add(error);
  // An allowlist avoids serializing request headers, full response bodies,
  // account details or plans. Text is redacted before truncation.
  const detail=error?.payload?.detail || error?.detail;
  return {
    name:redactSupportText(error.name || typeof error,100),
    code:redactSupportText(error.code || '',100),
    message:redactSupportText(error.message || (typeof error==='string'?error:''),1200),
    status:typeof error.status==='number'?error.status:null,
    stack:redactSupportText(String(error.stack || '').split('\n').slice(0,7).join('\n'),2400),
    serverCode:redactSupportText(detail?.code || '',100),
    serverMessage:redactSupportText(typeof detail==='string'?detail:detail?.message || '',1200),
    cause:originalError(error.cause,seen),
  };
}

export function cloudPlanSyncDiagnostic(error,{accountId,stage='main',elapsedMs=0}={}) {
  return {event:'cloud-plan-sync.failed',diagnosticId:randomUUID(),operation:'list',stage,
    timestamp:new Date().toISOString(),elapsedMs,accountHash:diagnosticHash(accountId),
    requestId:redactSupportText(error?.requestId || '',160),
    ...cloudPlanSyncFailurePolicy(error),originalError:originalError(error)};
}

// This boundary is used only for the read-only list operation. Save, activation,
// lifecycle changes and deletes keep their existing explicit mutation semantics.
export async function cloudPlanListResponse(plans,{language='zh-CN',accountId,recordFailure=()=>{}}={}) {
  const startedAt=Date.now();
  try {return {ok:true,...await plans.perform('list')};}
  catch(error) {
    const policy=cloudPlanSyncFailurePolicy(error);
    const diagnostic=cloudPlanSyncDiagnostic(error,{accountId,elapsedMs:Date.now()-startedAt});
    try {
      recordFailure(diagnostic);
    } catch { /* A diagnostic write failure must not interrupt recovery. */ }
    const copy=messages[policy.category==='authentication'?'authentication':
      ['CLOUD_RESULT_CONTEXT_INVALID','CLOUD_REPORT_INVALID','CLOUD_PLAN_LIST_INVALID'].includes(policy.code)?'invalid':'failed'];
    return {ok:false,error:{...policy,diagnosticId:diagnostic.diagnosticId,
      message:language==='ko'&&copy[3]?copy[3]:localizedChoice(copy,language)}};
  }
}
