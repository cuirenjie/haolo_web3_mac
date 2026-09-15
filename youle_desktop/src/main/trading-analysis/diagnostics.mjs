import crypto from "node:crypto";
import { describeTradingAnalysisFailure } from "./failure.mjs";

const STAGES = new Set(["entitlement", "preparation", "analysis", "model", "drawing", "report"]);
// Keep failure metadata usable when the optional turn recorder is removed.
const diagnosticHash = (value) => value
  ? crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16)
  : null;
const identifier = (value, maximum = 120) => {
  const text = String(value || "");
  return /^[A-Za-z0-9_:./-]+$/.test(text) && text.length <= maximum ? text : null;
};

export function tradingAnalysisFailureDiagnostic(error, context = {}) {
  const stage = STAGES.has(context.stage) ? context.stage : "analysis";
  const failure = describeTradingAnalysisFailure(error, { stage });
  const attempts = Array.isArray(error?.attempts) ? error.attempts.slice(0, 3) : [];
  const validationRule = (value) => String(value || "").match(/schemaVersion|verdict|summary|JSON|candidate|drawing|coordinate|snapshot|candles?/iu)?.[0].toLowerCase() || null;
  const httpStatus = Number(error?.status || error?.httpStatus || error?.cause?.status);
  return {
    diagnosticId: `H-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
    analysisHash: diagnosticHash(context.analysisJobId),
    requestHash: diagnosticHash(context.requestId || error?.requestId),
    snapshotHash: diagnosticHash(context.snapshotId),
    strategyId: identifier(context.strategyId),
    marketId: identifier(context.marketId),
    interval: identifier(context.interval, 20),
    model: identifier(context.modelId || error?.modelId),
    stage,
    errorClass: failure.category,
    code: identifier(error?.code, 100),
    httpStatus: httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null,
    validationRule: validationRule(error?.message),
    detail: failure.summary,
    errorHash: diagnosticHash(error?.message || error?.error || error),
    causeCode: identifier(error?.cause?.code, 100),
    causeClass: error?.cause ? describeTradingAnalysisFailure(error.cause).category : null,
    causeHash: diagnosticHash(error?.cause?.message),
    retryable: error?.retryable === true,
    candleCount: Math.max(0, Math.min(100_000, Number(context.candleCount ?? context.candles?.length) || 0)),
    attempts: attempts.map((attempt) => ({
      effort: ["medium", "high", "max"].includes(attempt.effort) ? attempt.effort : null,
      valid: attempt.valid === true,
      requestHash: diagnosticHash(attempt.requestId),
      validationRule: validationRule(attempt.error),
      errorClass: attempt.valid === true ? null : describeTradingAnalysisFailure({
        code: attempt.code || "TRADING_ANALYSIS_MODEL_REVIEW_INVALID",
      }).category,
    })),
  };
}
