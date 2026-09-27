import { ANALYSIS_RECOVERY_MODEL } from "../analysis-model-policy.mjs";

export const TRADING_PRIMARY_MODEL_BUDGET_MS = 120_000;
export const TRADING_BACKUP_MODEL_BUDGET_MS = 45_000;

export function tradingModelBudgetError(modelId, exhausted = false) {
  const error = new Error("Trading analysis model time budget exhausted");
  error.code = "TRADING_ANALYSIS_MODEL_TIMEOUT";
  error.category = "timeout";
  error.retryable = !exhausted;
  error.modelId = modelId;
  if (exhausted) error.recovery = { modelId, attempts: 1, exhausted: true };
  return error;
}

// One instance per frozen review, shared by validation passes. Never persisted
// or shared between users/panes. Monotonic time cannot be renewed by progress.
export function createTradingModelBudget({ now = () => performance.now() } = {}) {
  let primaryStartedAt;
  let backupStartedAt;
  let backupExhausted = false;
  return {
    begin(modelId) {
      const backup = modelId === ANALYSIS_RECOVERY_MODEL;
      if (backup) {
        if (backupExhausted) throw tradingModelBudgetError(modelId, true);
        backupStartedAt ??= now();
      } else {
        if (backupStartedAt !== undefined) throw tradingModelBudgetError(modelId, true);
        primaryStartedAt ??= now();
      }
      return () => {
        const remaining = (backup ? TRADING_BACKUP_MODEL_BUDGET_MS : TRADING_PRIMARY_MODEL_BUDGET_MS)
          - (now() - (backup ? backupStartedAt : primaryStartedAt));
        if (remaining <= 0) {
          if (backup) backupExhausted = true;
          throw tradingModelBudgetError(modelId, backup);
        }
        return Math.ceil(remaining);
      };
    },
  };
}
