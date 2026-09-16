import assert from "node:assert/strict";
import test from "node:test";
import { applyThreadProviderSwitch, restartIdleProviderRuntime } from "../src/main/thread-provider-switch.mjs";
import { AppServerClient } from "../src/main/app-server-client.mjs";

test("hidden runtime turns prevent a cold restart and late old completions cannot clear newer turns", async () => {
  const client = new AppServerClient();
  const notify = (method, turnId) => client.handleMessage(JSON.stringify({ method, params: { threadId: "hidden-analysis", turn: { id: turnId } } }));
  notify("turn/started", "old");
  notify("turn/started", "new");
  notify("turn/completed", "old");
  let stopped = false;
  await assert.rejects(restartIdleProviderRuntime({ client, isBusy: () => client.activeRuntimeTurns.size > 0,
    stop: () => { stopped = true; }, start: () => {} }), { code: "PROVIDER_SWITCH_RUNTIME_BUSY" });
  assert.equal(stopped, false);
  notify("turn/completed", "new");
  assert.equal(client.activeRuntimeTurns.size, 0);
});

test("cold provider recovery gates new RPCs, joins concurrent recovery and clears the gate on startup failure", async () => {
  const client = {};
  let release, starts = 0, stops = 0;
  const dependencies = { client, isBusy: () => false,
    stop: () => { stops++; return new Promise((resolve) => { release = resolve; }); },
    start: () => { starts++; throw new Error("startup failed"); } };
  const first = restartIdleProviderRuntime(dependencies);
  assert.equal(client.__youleProviderSwitchPromise, first);
  assert.equal(restartIdleProviderRuntime(dependencies), first);
  await Promise.resolve();
  assert.equal(stops, 1);
  assert.equal(starts, 0);
  release();
  await assert.rejects(first, /startup failed/);
  assert.equal(starts, 1);
  assert.equal(client.__youleProviderSwitchPromise, undefined);
});

test("provider recovery never stops a runtime with another active or pending operation", async () => {
  let stopped = false;
  await assert.rejects(restartIdleProviderRuntime({ client: {}, isBusy: () => true,
    stop: () => { stopped = true; }, start: () => {} }), { code: "PROVIDER_SWITCH_RUNTIME_BUSY" });
  assert.equal(stopped, false);
});

test("an ignored provider override fails closed even after a cold resume", async () => {
  const calls = [];
  let restarts = 0;
  await assert.rejects(applyThreadProviderSwitch({
    request: async (method, params) => { calls.push([method, params]); return { modelProvider: "haolo_ai" }; },
    baseParams: { threadId: "same-task", cwd: "workspace" },
    targetSettings: { model: "deepseek-flash", modelProvider: "deepseek", effort: "max" },
    providerOf: (result) => result.modelProvider, restartIdleRuntime: () => { restarts++; },
  }), /provider switch was not applied/);
  assert.equal(restarts, 1);
  assert.deepEqual(calls.map(([method]) => method), ["thread/unsubscribe", "thread/resume", "thread/resume"]);
  assert.ok(calls.slice(1).every(([, params]) => params.threadId === "same-task" && params.config.model_reasoning_effort === "max"));
});
