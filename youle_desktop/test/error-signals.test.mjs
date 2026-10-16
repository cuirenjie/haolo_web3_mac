import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { errorSignals, isQuotaFailure } from "../src/main/error-signals.mjs";
import { modelFailureFacts } from "../src/main/model-failure-policy.mjs";
import { describeTradingAnalysisFailure } from "../src/main/trading-analysis/failure.mjs";
import { isRetryableModelTransportError } from "../src/main/model-transport-recovery.mjs";
import { classifyTurnFailure } from "../src/main/turn-diagnostics.mjs";
import { isLocalProxyConnectionRefusedError } from "../src/renderer/local-proxy-recovery.ts";

function actualClassifier(path, name) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn, name);
  return new Function("errorSignals", `${fn.getText(ast)}; return ${name};`)(errorSignals);
}

test("workflow, automation and recovery classification never infer status from prices", () => {
  const workflow = actualClassifier("../src/main/main.mjs", "workflowCodexFailureClass");
  const auth = actualClassifier("../src/main/automation/runner.mjs", "isAuthExpired");
  const recovery = actualClassifier("../src/main/turn-auto-recovery.mjs", "classifyStartFailure");
  for (const code of [401, 403, 429, 500, 502, 503, 504, 529]) {
    const message = `validation failed near price 1,${code}.66`;
    assert.equal(workflow(message), "unknown");
    assert.equal(auth(message), false);
    assert.equal(recovery(new Error(message)), "stream_disconnected");
  }
  assert.equal(workflow("HTTP 429"), "rate_limit");
  assert.equal(workflow("HTTP 503"), "upstream_5xx");
  assert.equal(auth("HTTP 401"), true);
  assert.equal(auth("HTTP 403"), true);
  assert.equal(recovery({ status: 429 }), "rate_limit");
});

test("all 400–599 numeric price forms are data, not HTTP failures", () => {
  for (let code = 400; code < 600; code++) {
    for (const price of [`${code}`, `${code}.66`, `1,${code}.66`, `0.${code}`, `1${code}`, `${code},000`]) {
      const message = `SNDKUSDT: HH ${price}; 目标价 ${price}，${code} 根 K 线。`;
      assert.deepEqual(errorSignals({ message }).statuses, [], message);
      assert.equal(isQuotaFailure(message), false, message);
      assert.equal(modelFailureFacts({ message }).httpStatus, null, message);
      assert.equal(describeTradingAnalysisFailure({ message }).category, "analysis", message);
      assert.equal(classifyTurnFailure(message), "unknown", message);
    }
    for (const raw of [`HTTP ${code}.66`, `status: ${code},000`, `HTTP ${code}0`, `MODEL_HTTP_${code}suffix`]) {
      assert.deepEqual(errorSignals(raw).statuses, [], raw);
    }
    assert.deepEqual(errorSignals({ status: code + 0.66 }).statuses, []);
    assert.deepEqual(errorSignals({ status: `${code}.66` }).statuses, []);
  }
});

test("explicit HTTP fields, wrappers and legacy transport messages retain real status codes", () => {
  for (const code of [400, 401, 402, 403, 408, 425, 429, 500, 502, 503, 504, 529]) {
    for (const error of [
      { status: code }, { statusCode: String(code) }, { status_code: code }, { code }, { error: { error_code: String(code) } },
      { error: { httpStatus: code } }, { cause: { response: { status: code } } },
      { codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: code } } },
      new Error(`HTTP ${code}: upstream rejected`), `HTTP/1.1 ${code}`, `unexpected status code: ${code}`,
      { code: `MODEL_HTTP_${code}` }, JSON.stringify({ error: { status: code } }),
    ]) {
      assert.deepEqual(errorSignals(error).statuses, [code]);
      assert.equal(isQuotaFailure(error), code === 402);
      assert.equal(modelFailureFacts(error).httpStatus, code);
    }
  }
  for (const error of [new Error("Payment required (402)"), "insufficient_quota", "会员到期", "积分不足", { code: "ANALYSIS_CREDITS_REQUIRED" }]) {
    assert.equal(isQuotaFailure(error), true);
    assert.equal(describeTradingAnalysisFailure(error).category, "membership");
    assert.equal(describeTradingAnalysisFailure(error).allowLocalRecovery, false);
    assert.equal(modelFailureFacts(error).hardFailure, true);
  }
  assert.equal(isRetryableModelTransportError({ error: { status: 402 }, retryable: true }), false);
  assert.equal(isRetryableModelTransportError({ message: "HTTP 429" }), true);
  assert.equal(isRetryableModelTransportError({ message: "price 1,429.66" }), false);
  assert.equal(classifyTurnFailure("HTTP 429"), "rate_limit");
  assert.equal(classifyTurnFailure("HTTP 503"), "upstream_5xx");
  assert.equal(classifyTurnFailure("HTTP 401"), "authentication");
  assert.equal(isLocalProxyConnectionRefusedError("price 10061.23"), false);
  assert.equal(isLocalProxyConnectionRefusedError("os error 10061"), true);
});

test("arbitrary response content, stack traces and cycles never become billing signals", () => {
  const value = { text: "HTTP 402 积分不足", summary: "会员到期", price: 402, body: "HTTP 401" };
  value.self = value;
  assert.equal(isQuotaFailure(value), false);
  assert.deepEqual(errorSignals({ response: value }).statuses, []);
  assert.equal(isQuotaFailure(JSON.stringify({ response: { text: value.text } })), false);
  const error = new Error("Failed at price 1,402.66");
  error.stack = "at quota (line 402): 积分不足";
  error.cause = error;
  assert.equal(isQuotaFailure(error), false);
  error.cause = { statusCode: 402 };
  assert.equal(isQuotaFailure(error), true);
});
