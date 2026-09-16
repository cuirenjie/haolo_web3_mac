import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import zlib from "node:zlib";
import { EventEmitter } from "node:events";
import { ensureThreadSettingsAndWait } from "../src/main/thread-compaction.mjs";
import { canonicalDeepSeekModel, migrateDeepSeekModelSelection } from "../src/main/deepseek-model-policy.mjs";
import { modelFailureFacts } from "../src/main/model-failure-policy.mjs";
import { normalizeModelRequestBody } from "../src/main/model-request-policy.mjs";
import { isRecoverableAnalysisModelFailure } from "../src/main/analysis-model-recovery.mjs";
import { isRetryableModelTransportError } from "../src/main/model-transport-recovery.mjs";
import { failureDiagnosticsFromNotification } from "../src/main/turn-diagnostics.mjs";
import { TurnAutoRecoveryCoordinator } from "../src/main/turn-auto-recovery.mjs";
import { createAppServerTradingAnalysisProvider } from "../src/main/trading-analysis/app-server-provider.mjs";
import { withAnalysisModelRecoveryPolicy, ANALYSIS_RECOVERY_WINDOW_MS } from "../src/main/analysis-model-policy.mjs";
import { ModelRequestRelay } from "../src/main/model-request-relay.mjs";
import { YouleApiClient } from "../src/main/youle-api-client.mjs";
import { normalizeRuntimeThreadModelSettings } from "../src/renderer/thread-model-settings.ts";
import { chatModelOptionsFromList } from "../src/renderer/chat-model-catalog.ts";
import { normalizeBusinessModelPoolsState, executionChatModelOptions } from "../src/renderer/business-model-pools.ts";

const oldModel = "deepseek-v4-flash", model = "deepseek-flash";

test("legacy saved task selections migrate before policy, retaining max and the original expiry", () => {
  const saved = { model: oldModel, modelProvider: "deepseek", effort: "max", input: [{ text: oldModel }], collaborationMode: { settings: { model: oldModel } } };
  const migrated = migrateDeepSeekModelSelection(saved);
  assert.equal(canonicalDeepSeekModel(` ${oldModel.toUpperCase()} `), model);
  assert.equal(migrated.model, model);
  assert.equal(migrated.collaborationMode.settings.model, model);
  assert.equal(migrated.input, saved.input);
  assert.equal(saved.model, oldModel);
  assert.equal(migrateDeepSeekModelSelection(migrated), migrated);
  const state = { version: 1, activatedAt: 1000, fallbackUntil: 1000 + ANALYSIS_RECOVERY_WINDOW_MS };
  assert.equal(withAnalysisModelRecoveryPolicy(saved, state, 1001).reasoningEffort, "max");
  assert.equal(withAnalysisModelRecoveryPolicy(saved, state, 1001).model, model);
  assert.equal(withAnalysisModelRecoveryPolicy(saved, state, state.fallbackUntil).model, "gpt-5.6-sol");
  assert.equal(normalizeRuntimeThreadModelSettings(saved).model, model);
});

test("model lists deduplicate aliases while execution permissions require the authorized entry", () => {
  assert.deepEqual(chatModelOptionsFromList({ data: [{ id: oldModel }, { id: model }] }).map(m => m.value), [model]);
  const state = normalizeBusinessModelPoolsState({ configured: true, pools: [{ id: "execution", capabilities: ["root_execution"], models: [
    { id: oldModel, provider: "deepseek", enabled: false },
    { id: model, provider: "deepseek", enabled: true, routeGroupId: 15 },
  ] }] });
  const options = executionChatModelOptions(state);
  assert.equal(options.length, 1);
  assert.equal(options[0].value, model);
  assert.ok(options[0].reasoningEfforts.some(e => e.value === "max"));
  const client = new YouleApiClient();
  client.businessModelPoolsCache = { result: state };
  client.modelKeys = [{ groupId: 15, provider: "deepseek", apiKey: "synthetic-test-key" }];
  assert.equal(client.businessModelCredential("execution", "root_execution", oldModel, "deepseek").model.id, model);
});

test("a provider saved as legacy DeepSeek restores Sol and its credential route after the window expires", async () => {
  const calls = [];
  const provider = createAppServerTradingAnalysisProvider({ modelId: oldModel, modelProvider: "deepseek",
    selectModel: () => ({ modelId: "gpt-5.6-sol", fallback: false }),
    invoke: async selection => { calls.push(selection); return { status: "success", text: "completed" }; },
  });
  await provider.analyze({ task: "price-action-theory-review" }, { reasoningEffort: "medium" });
  assert.equal(calls[0].modelId, "gpt-5.6-sol");
  assert.equal(calls[0].modelProvider, "haolo_ai");
  // Repairing an already-started fallback review still finishes on max.
  await provider.analyze({ task: "price-action-theory-review" }, { recoveryModel: oldModel });
  assert.equal(calls[1].modelId, model);
  assert.equal(calls[1].modelProvider, "deepseek");
  assert.equal(calls[1].reasoningEffort, "max");
});

test("old runtime settings cannot be mistaken for confirmation of the migrated target", async () => {
  let updates = 0;
  const applied = await ensureThreadSettingsAndWait({
    serverClient: new EventEmitter(), threadId: "legacy", timeoutMs: 500,
    currentSettings: { model: oldModel, effort: "max" }, targetSettings: { model: oldModel, effort: "max" },
    updateSettings: async params => { updates++; assert.equal(params.model, model); return { model, reasoningEffort: "max" }; },
  });
  assert.equal(updates, 1);
  assert.equal(applied.threadSettings.model, model);
});

test("actual HTTP relay rewrites aliases before an exact-ID permission gate, for every supported encoding", async t => {
  const forwarded = [];
  const relay = new ModelRequestRelay({ upstreamBaseUrl: "https://model.invalid/v1", fetch: async (_url, init) => {
    const headers = new Headers(init.headers);
    const decode = { gzip: zlib.gunzipSync, br: zlib.brotliDecompressSync, deflate: zlib.inflateSync, zstd: zlib.zstdDecompressSync }[headers.get("content-encoding")];
    const payload = JSON.parse((decode ? decode(init.body) : Buffer.from(init.body)).toString());
    forwarded.push(payload);
    return new Response("{}", { status: payload.model === model ? 200 : 403 });
  } });
  await relay.start(); t.after(() => relay.stop());
  const body = Buffer.from(JSON.stringify({ model: oldModel, reasoning: { effort: "max" }, input: oldModel }));
  for (const [encoding, encode] of [["identity", b => b], ["gzip", zlib.gzipSync], ["br", zlib.brotliCompressSync], ["deflate", zlib.deflateSync], ...(zlib.zstdCompressSync ? [["zstd", zlib.zstdCompressSync]] : [])]) {
    const response = await fetch(`${relay.localBaseUrl()}/responses`, { method: "POST", headers: { "content-type": "application/json", "content-encoding": encoding }, body: encode(body) });
    assert.equal(response.status, 200, encoding);
    await response.text();
  }
  assert.ok(forwarded.every(p => p.model === model && p.reasoning.effort === "max" && p.input === oldModel));
  const nested = JSON.parse(normalizeModelRequestBody(JSON.stringify({ type: "response.create", response: { model: oldModel } })));
  assert.equal(nested.response.model, model);
});

const main = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const start = main.indexOf("function workflowCodexTerminalFailure("), end = main.indexOf("\nfunction ", start + 1);
const terminalFailure = new Function("failureDiagnosticsFromNotification", "isRecoverableAnalysisModelFailure", "firstString", `${main.slice(start, end)}; return workflowCodexTerminalFailure;`)(failureDiagnosticsFromNotification, isRecoverableAnalysisModelFailure, (...values) => values.find(v => typeof v === "string" && v.trim()) || "");

test("403 and explicit retryable=false survive native wrappers and all host recovery layers", async () => {
  for (const error of [
    { message: 'stream disconnected before completion: unexpected status 403 Forbidden: model "deepseek-v4-flash" is not enabled for 执行模式', codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 403 } } },
    { message: "stream disconnected", codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 403 } } },
    { message: "stream disconnected", cause: { error: { code: "PERMISSION_DENIED", retryable: false } } },
    { code: "CODEX_TURN_FAILED", retryable: false },
    { message: "at capacity", status: 503, cause: { status: 403 } },
  ]) {
    assert.equal(isRecoverableAnalysisModelFailure(error, { allowUnknownTerminal: true }), false);
    assert.equal(isRetryableModelTransportError(error), false);
    const event = { method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "failed", error } } };
    const failure = terminalFailure(event);
    assert.equal(failure.retryable, false, JSON.stringify(error));
    const coordinator = new TurnAutoRecoveryCoordinator({ startRecovery: async () => assert.fail("must not recover"), setTimer: () => assert.fail("must not schedule") });
    assert.equal(coordinator.handleTerminalFailure({ ...failure, threadId: "thread", failedTurnId: "turn" }).status, "ignored");
    let calls = 0;
    const provider = createAppServerTradingAnalysisProvider({ modelId: oldModel, invoke: async () => { calls++; return { status: "failed", ...failure, error: failure.detail }; }, waitForRecovery: async () => assert.fail("must not retry") });
    await assert.rejects(provider.analyze({ task: "price-action-theory-review" }));
    assert.equal(calls, 1);
  }
  assert.equal(modelFailureFacts({ status: 503, cause: { status: 403 } }).httpStatus, 403);
});
