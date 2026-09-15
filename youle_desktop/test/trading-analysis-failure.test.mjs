import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { describeTradingAnalysisFailure, settleTradingAnalysisDrawing } from "../src/main/trading-analysis/failure.mjs";
import { tradingAnalysisFailureDiagnostic } from "../src/main/trading-analysis/diagnostics.mjs";
import { createAppServerTradingAnalysisProvider } from "../src/main/trading-analysis/app-server-provider.mjs";
import { createTradingAnalysisModelProviderRegistry } from "../src/main/trading-analysis/model-provider.mjs";
// HAOLO-TURN-DIAGNOSTICS-BEGIN: optional recorder integration test import
import { TurnDiagnosticRecorder } from "../src/main/turn-diagnostics.mjs";
// HAOLO-TURN-DIAGNOSTICS-END: optional recorder integration test import

test("failed drawing keeps successful analysis and does not re-run the model", async () => {
  const result = { report: "validated report", model: "review-model", levels: { support: 100 } };
  let modelCalls = 0;
  let drawingCalls = 0;
  const failures = [];
  const analyze = async () => { modelCalls++; return result; };
  const analyzed = await analyze();
  const outcome = await settleTradingAnalysisDrawing({
    commit: async () => { drawingCalls++; throw new Error("storage quota exceeded"); },
    isActive: () => true,
    onFailure: (error) => failures.push(error),
  });
  assert.equal(analyzed, result);
  assert.equal(modelCalls, 1);
  assert.equal(drawingCalls, 1);
  assert.equal(outcome.drawingDeferred, true);
  assert.equal(failures.length, 1);
});

test("drawing success, cancellation, inactive jobs and broken observers remain distinct", async () => {
  assert.deepEqual(await settleTradingAnalysisDrawing({ commit: async () => {}, isActive: () => true }), { drawingDeferred: false });
  for (const [error, active] of [[new DOMException("stopped", "AbortError"), true], [new Error("storage failure"), false], [Object.assign(new Error("停止"), { code: "TRADING_ANALYSIS_CANCELLED" }), true]]) {
    await assert.rejects(settleTradingAnalysisDrawing({ commit: async () => { throw error; }, isActive: () => active }), (caught) => caught === error);
  }
  assert.equal((await settleTradingAnalysisDrawing({ commit: async () => { throw new Error("quota"); }, isActive: () => true, onFailure: async () => { throw new Error("diagnostics unavailable"); } })).drawingDeferred, true);
});

test("access failures cannot be hidden by local analysis or a second strategy route", () => {
  for (const code of ["TRADING_ENTITLEMENT_UNAVAILABLE", "HAOLO_AUTH_REQUIRED", "TRIAL_REQUIRED", "INSUFFICIENT_BALANCE", "TRADING_ANALYSIS_MODEL_SIDE_EFFECT_BLOCKED"]) {
    const failure = describeTradingAnalysisFailure({ code });
    assert.equal(failure.allowLocalRecovery, false, code);
    assert.doesNotMatch(failure.summary, /K 线|模型返回/);
  }
  assert.equal(describeTradingAnalysisFailure({ code: "TRADING_ANALYSIS_MODEL_REVIEW_INVALID" }).category, "model_validation");
  assert.equal(describeTradingAnalysisFailure({ code: "TRADING_ANALYSIS_MODEL_EMPTY_RESPONSE" }).category, "model_empty");
  assert.equal(describeTradingAnalysisFailure({ code: "WORKFLOW_TURN_TIMEOUT" }).category, "timeout");
  assert.equal(describeTradingAnalysisFailure({ code: "ECONNRESET" }).category, "transport");
  assert.equal(describeTradingAnalysisFailure({ status: 429 }).category, "rate_limit");
});

test("provider transport preserves HTTP and request metadata through the registry", async () => {
  const provider = createAppServerTradingAnalysisProvider({ invoke: async () => ({ status: "failed", error: "request failed", httpStatus: 401, category: "auth" }) });
  const registry = createTradingAnalysisModelProviderRegistry([provider]);
  await assert.rejects(registry.analyze(provider.providerId, { schemaVersion: 1, requestId: "request-one", task: "review", theoryId: "test", snapshotId: "snapshot-one", prompt: "Review", responseFormat: "json" }), (error) => {
    assert.equal(error.status, 401);
    assert.equal(error.requestId, "request-one");
    assert.equal(describeTradingAnalysisFailure(error).allowLocalRecovery, false);
    const diagnostic = tradingAnalysisFailureDiagnostic(error);
    assert.equal(diagnostic.httpStatus, 401);
    assert.ok(diagnostic.requestHash);
    return true;
  });
  const cause = Object.assign(new Error("private upstream detail"), { status: 503, code: "NETWORK_ERROR" });
  const wrapped = Object.assign(new Error("membership unavailable", { cause }), { code: "TRADING_ENTITLEMENT_UNAVAILABLE" });
  const diagnostic = tradingAnalysisFailureDiagnostic(wrapped, { stage: "entitlement" });
  assert.equal(diagnostic.errorClass, "entitlement");
  assert.equal(diagnostic.causeClass, "transport");
  assert.equal(diagnostic.httpStatus, 503);
  assert.doesNotMatch(JSON.stringify(diagnostic), /private upstream/);
});

test("failure descriptions never include arbitrary upstream text and have English equivalents", () => {
  const error = new Error("upstream secret account detail");
  assert.doesNotMatch(describeTradingAnalysisFailure(error).summary, /secret/);
  for (const stage of ["analysis", "drawing"]) {
    assert.doesNotMatch(describeTradingAnalysisFailure(error, { stage, language: "en" }).summary, /\p{Script=Han}/u);
  }
});

// HAOLO-TURN-DIAGNOSTICS-BEGIN: optional recorder integration test
test("exported diagnostics correlate failures and retain validation evidence without model text or credentials", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-analysis-diagnostic-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const recorder = new TurnDiagnosticRecorder({ logPath: path.join(dir, "log.jsonl"), appVersion: "test" });
  const failure = Object.assign(new Error("Model response schemaVersion is invalid PRIVATE_MODEL_OUTPUT sk-secret1234567890"), {
    code: "TRADING_ANALYSIS_MODEL_REVIEW_INVALID",
    attempts: [{ effort: "medium", valid: false, error: "Model response summary is required PRIVATE_MODEL_OUTPUT", requestId: "request-one" }],
  });
  const context = { analysisJobId: "job-one", strategyId: "general", marketId: "BINANCE:FUTURES:SNDKUSDT", interval: "60", candles: Array(600), instruction: "PRIVATE_PROMPT", credentials: "PRIVATE_CREDENTIALS" };
  const first = tradingAnalysisFailureDiagnostic(failure, context);
  const second = tradingAnalysisFailureDiagnostic(new Error("storage quota"), { ...context, stage: "drawing" });
  recorder.record("trading.analysis.failed", first);
  recorder.record("trading.analysis.failed", second);
  const { report } = recorder.exportReport(path.join(dir, "report.json"));
  assert.equal(report.events.length, 2);
  assert.equal(first.analysisHash, second.analysisHash);
  assert.equal(first.candleCount, 600);
  assert.equal(first.validationRule, "schemaversion");
  assert.equal(first.attempts[0].validationRule, "summary");
  assert.equal(second.errorClass, "drawing");
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_|sk-secret|job-one|request-one/);
});
// HAOLO-TURN-DIAGNOSTICS-END: optional recorder integration test

test("renderer wiring keeps drawing failure outside the local model fallback in both themes", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const source = fs.readFileSync(path.join(root, "src/renderer/trading-expert-market.ts"), "utf8");
  const general = source.slice(source.indexOf("  async runGeneralConversation("), source.indexOf("  async runChanConversation("));
  assert.match(general, /settleTradingAnalysisDrawing\([\s\S]*?commitTradingAnalysisDrawingPatch/);
  assert.match(general, /const recovered = cancelled \|\| !failure\.allowLocalRecovery \? null/);
  assert.match(general, /\[questionLead, responseReport, drawingNote\]/);
  assert.match(general, /modelName,\s*drawingDeferred/);
  // Both modes use the same existing message surface and semantic drawing
  // tokens; this path must not introduce a separately coloured failure panel.
  assert.doesNotMatch(general, /#[0-9a-f]{3,8}\b|(?:background|color)\s*:\s*["']/iu);
});
