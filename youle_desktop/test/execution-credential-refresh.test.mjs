import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { applyThreadProviderSwitch, assertThreadProvider, restartIdleProviderRuntime } from "../src/main/thread-provider-switch.mjs";
import { ensureDeepSeekRuntimeCredential } from "../src/main/execution-credential-refresh.mjs";
import { isQuotaFailure } from "../src/main/error-signals.mjs";

const source = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
function mainFunction(name, nextName, context) {
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf(`\nfunction ${nextName}(`, start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
  return context[name];
}

test("execution credentials missing from the login snapshot refresh before provider startup", async () => {
  let refreshed = 0;
  const apiClient = {
    listBusinessModelPools: async () => ({ configured: true }),
    businessModelCredential: (_pool, _capability, _model, provider) => provider === "codex"
      ? { apiKeyId: 21 }
      : refreshed ? { apiKey: "test-credential", baseUrl: "https://example.test/v1", groupId: 15 } : null,
    refreshProfile: async () => { refreshed++; },
  };
  const context = vm.createContext({
    getYouleApiClient: () => apiClient,
    DEEPSEEK_EXECUTION_MODEL: "deepseek-flash", DEEPSEEK_EXECUTION_PROVIDER_ID: "deepseek",
  });
  const resolve = mainFunction("resolveDeepSeekExecutionProviderRuntime", "withExecutionCredentialAvailability", context);
  const runtime = await resolve();
  assert.equal(refreshed, 1);
  assert.equal(runtime.deepSeek.apiKey, "test-credential");
  assert.equal(runtime.deepSeek.billingKeyId, 21);
});

test("resuming the same DeepSeek task repairs a previously credential-less runtime before any turn", async () => {
  const client = { status: "ready", providerRuntime: { deepSeek: { available: false } } };
  let recoveries = 0;
  const requests = [];
  const context = vm.createContext({
    firstString: (...values) => values.find((value) => typeof value === "string" && value) || "",
    DEEPSEEK_EXECUTION_PROVIDER_ID: "deepseek",
    ensureDeepSeekExecutionRuntime: async (actualClient, threadId) => {
      assert.equal(actualClient, client);
      assert.equal(threadId, "original-task");
      recoveries++;
      client.providerRuntime.deepSeek.available = true;
    },
    ensureDeepSeekThreadHistoryHasSupportedMedia: async () => {},
    requestAppServer: async (_client, method, params) => {
      assert.equal(client.providerRuntime.deepSeek.available, true, "runtime must receive its credential before resume");
      requests.push([method, params.threadId]);
      return { modelProvider: "deepseek", thread: { id: params.threadId } };
    },
    threadModelProviderFromResumeResult: (result) => result.modelProvider,
    isMissingRolloutErrorMessage: () => false,
    applyThreadProviderSwitch, assertThreadProvider, restartIdleProviderRuntime,
  });
  const resume = mainFunction("resumeThreadForRequestedProvider", "withThreadRuntimeSettings", context);
  const result = await resume({ serverClient: client, threadId: "original-task", cwd: "workspace", targetSettings: { modelProvider: "deepseek" } });
  assert.equal(recoveries, 1);
  assert.equal(result.thread.id, "original-task");
  assert.deepEqual(requests, [["thread/resume", "original-task"]]);
});

function runtimeFixture({ available = false, status = "ready", busy = false } = {}) {
  const client = { status, providerRuntime: { deepSeek: { available } } };
  const calls = [];
  const dependencies = {
    client,
    isBusy: () => busy,
    stop: async () => { calls.push("stop"); client.status = "stopped"; },
    start: async () => { calls.push("start"); client.status = "ready"; client.providerRuntime.deepSeek.available = true; },
  };
  return { client, calls, dependencies };
}

test("a credential-less running process recovers once and healthy sends reuse it", async () => {
  const { client, calls, dependencies } = runtimeFixture();
  await ensureDeepSeekRuntimeCredential(dependencies);
  await ensureDeepSeekRuntimeCredential(dependencies);
  assert.deepEqual(calls, ["stop", "start"]);
  assert.equal(client.__youleProviderSwitchPromise, undefined);
});

test("concurrent credential recovery joins the same runtime restart", async () => {
  const { calls, dependencies } = runtimeFixture();
  await Promise.all([
    ensureDeepSeekRuntimeCredential(dependencies),
    ensureDeepSeekRuntimeCredential(dependencies),
  ]);
  assert.deepEqual(calls, ["stop", "start"]);
});

test("missing credentials cannot interrupt an active or pending task", async () => {
  const { calls, dependencies } = runtimeFixture({ busy: true });
  await assert.rejects(ensureDeepSeekRuntimeCredential(dependencies), { code: "PROVIDER_SWITCH_RUNTIME_BUSY" });
  assert.deepEqual(calls, []);
});

test("a stopped runtime starts once without an extra recovery restart", async () => {
  const { calls, dependencies } = runtimeFixture({ status: "stopped" });
  await ensureDeepSeekRuntimeCredential(dependencies);
  assert.deepEqual(calls, ["start"]);
});

test("unavailable credentials fail before sending, without a misleading quota error or retry loop", async () => {
  const { calls, dependencies } = runtimeFixture();
  dependencies.start = async () => { calls.push("start"); dependencies.client.status = "ready"; };
  await assert.rejects(ensureDeepSeekRuntimeCredential(dependencies), (error) => {
    assert.equal(error.code, "MODEL_CREDENTIALS_UNAVAILABLE");
    assert.equal(isQuotaFailure(error), false);
    assert.equal(error.message.includes("HAOLO_DEEPSEEK_EXECUTION_TOKEN"), false);
    return true;
  });
  assert.deepEqual(calls, ["stop", "start"]);
  assert.equal(isQuotaFailure(new Error("Missing environment variable: `HAOLO_DEEPSEEK_EXECUTION_TOKEN`.")), false);
});

test("failed recovery releases the gate and a later send can recover", async () => {
  const { client, calls, dependencies } = runtimeFixture();
  const start = dependencies.start;
  dependencies.start = async () => { throw new Error("temporary startup failure"); };
  await assert.rejects(ensureDeepSeekRuntimeCredential(dependencies), /temporary startup failure/);
  assert.equal(client.__youleProviderSwitchPromise, undefined);
  dependencies.start = start;
  await ensureDeepSeekRuntimeCredential(dependencies);
  assert.deepEqual(calls, ["stop", "start"]);
});

test("credential recovery busy checks include hidden turns and exclude only the current pending send", () => {
  const serverClient = { __youleWorkspaceKey: "workspace", pending: new Map(), activeRuntimeTurns: new Map() };
  const pendingCodexTurnThreadIds = new Set(["current"]);
  const activeCodexTurnsByThread = new Map();
  const context = vm.createContext({
    appShuttingDown: false, appCleanupStarted: false, activeCodexTurnsByThread, pendingCodexTurnThreadIds,
    appServerClientByThreadId: new Map([["current", "workspace"], ["other", "workspace"]]),
  });
  const start = source.indexOf("function isAppServerProviderRecoveryBusy(");
  const end = source.indexOf("\nfunction ensureDeepSeekExecutionRuntime(", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
  const isBusy = () => context.isAppServerProviderRecoveryBusy(serverClient, "current");
  assert.equal(isBusy(), false);
  serverClient.activeRuntimeTurns.set("hidden", "turn");
  assert.equal(isBusy(), true);
  serverClient.activeRuntimeTurns.clear();
  pendingCodexTurnThreadIds.add("other");
  assert.equal(isBusy(), true);
  pendingCodexTurnThreadIds.delete("other");
  activeCodexTurnsByThread.set("current", "active-turn");
  assert.equal(isBusy(), true);
  activeCodexTurnsByThread.clear();
  serverClient.pending.set(1, {});
  assert.equal(isBusy(), true);
});
