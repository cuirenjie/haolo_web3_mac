// The runtime sometimes wraps HTTP denials as responseStreamDisconnected or
// httpConnectionFailed. Retain the original terminal decision through wrappers.
import { errorSignals, isQuotaFailure } from "./error-signals.mjs";

export function modelFailureFacts(error) {
  const { detail, statuses, retryable } = errorSignals(error);
  const terminalStatus = statuses.find((s) => s < 500 && ![408, 425, 429].includes(s));
  const httpStatus = terminalStatus || statuses[0] || null;
  // WebSocket can upgrade with HTTP 101 and then reject model access in an
  // error frame. That rejection remains terminal even inside a retryable
  // stream-disconnected wrapper; changing transport or model cannot grant it.
  const modelUnavailable = /MODEL_(?:NOT_ENABLED|RETIRED|NOT_FOUND|UNSUPPORTED)|unsupported[_ ]model|\bmodel\b[^\r\n]{0,160}\b(?:not supported|not available|does not exist|do not have access)\b/i.test(detail);
  const hardFailure = modelUnavailable || Boolean(terminalStatus) || isQuotaFailure(error)
    || /PERMISSION_DENIED|MODEL_(?:NOT_ENABLED|RETIRED|ROUTE_GROUP_MISMATCH)|THREAD_PROVIDER_MISMATCH|PROVIDER_SWITCH_RUNTIME_BUSY|provider switch was not applied|provider recovery is waiting|API key is not bound to its route group|TRIAL_REQUIRED|ACCOUNT_ID_REQUIRED|CLEANUP_INCOMPLETE|unauthori[sz]ed|forbidden|auth(?:entication)?[_ ](?:failed|expired)|invalid.api.key|not enabled for|权限|鉴权|余额不足/i.test(detail);
  return { httpStatus, retryable, hardFailure, modelUnavailable, detail };
}
