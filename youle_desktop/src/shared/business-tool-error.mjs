// Keep the machine-readable policy across renderer IPC and tool transports.
// Missing retryability is not an instruction to permanently stop a workflow.
export function businessToolError(error) {
  const message = String(error?.message || error || 'Business tool failed.').slice(0, 4000);
  const code = /^[A-Z][A-Z0-9_]{2,99}$/.test(error?.code || '') ? error.code : undefined;
  return { message, ...(code ? { code } : {}),
    ...(typeof error?.retryable === 'boolean' ? { retryable: error.retryable } : {}),
    ...(typeof error?.category === 'string' ? { category: error.category.slice(0, 100) } : {}),
    ...(/^[A-Za-z0-9_-]{1,100}$/.test(error?.diagnosticId || '') ? { diagnosticId: error.diagnosticId } : {}),
    ...(/^[a-f0-9-]{36}$/i.test(error?.runId || '') ? { runId: error.runId } : {}),
    ...(/^[a-z0-9][a-z0-9_-]{0,99}$/.test(error?.strategyId || '') ? { strategyId: error.strategyId } : {}),
    ...(Array.isArray(error?.completedStrategyIds) ? { completedStrategyIds: [...new Set(error.completedStrategyIds
      .filter(id => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,99}$/.test(id)))].slice(0, 20) } : {}),
    ...(isTerminalAnalysisError(error) ? { nextAction: 'stop', terminal: true } : {}),
  };
}

export function isTerminalAnalysisError(error) {
  return error?.retryable === false && /^[A-Z][A-Z0-9_]{2,99}$/.test(error?.code || '')
    && !/CANCEL|ABORT/.test(error.code);
}

export function restoreBusinessToolError(value) {
  const fields = businessToolError(value);
  return Object.assign(new Error(fields.message), fields);
}
