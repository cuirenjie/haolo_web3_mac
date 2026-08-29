import assert from "node:assert/strict";
import test from "node:test";
import {
  ExternalAgentRuntime,
  externalAgentPublicEvent,
} from "../src/main/external-agent/runtime.mjs";

const DEFAULT_RESULT = Object.freeze({
  text: "只读审查完成。",
  usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
  finishReason: "stop",
  citations: [],
  clientTruncated: false,
});

test("feature flag fails closed before prepare, credential resolution, or fetch", () => {
  const fake = createFakeService();
  const runtime = createRuntime(fake, { enabled: false, providerAllowlist: ["openai"] });

  assert.throws(
    () => runtime.start(runInput("disabled"), { ownerId: "window-a", userDirected: true }),
    (error) => error?.code === "FEATURE_DISABLED",
  );
  assert.equal(fake.prepareCalls.length, 0);
  assert.equal(fake.credentialResolveCount, 0);
  assert.equal(fake.fetchCount, 0);
  assert.equal(fake.invokeCalls.length, 0);
  assert.equal(runtime.capabilities().enabled, false);
  assert.deepEqual(runtime.capabilities().capabilities, {
    textOnly: true,
    toolsEnabled: false,
    localFileAccess: false,
    shellAccess: false,
    writeAccess: false,
    automaticRetry: true,
    automaticProviderFallback: false,
  });
});

test("provider allowlist is enforced against the canonical provider before invocation", async () => {
  const fake = createFakeService();
  const runtime = createRuntime(fake, { providerAllowlist: ["OPENAI"] });

  const allowed = runtime.start(
    { ...runInput("allowed"), provider: "gpt" },
    { ownerId: "window-a", userDirected: true },
  );
  assert.equal(allowed.provider, "openai");
  assert.equal(fake.invokeCalls.length, 1);

  assert.throws(
    () => runtime.start(
      { ...runInput("blocked"), provider: "claude" },
      { ownerId: "window-a", userDirected: true },
    ),
    (error) => error?.code === "PROVIDER_NOT_ALLOWLISTED" && error?.provider === "anthropic",
  );
  assert.equal(fake.invokeCalls.length, 1);
  assert.equal(fake.credentialResolveCount, 1);
  assert.equal(fake.fetchCount, 1);

  fake.invokeCalls[0].resolve(DEFAULT_RESULT);
  assert.equal((await runtime.waitRun(allowed.runId, { ownerId: "window-a" })).status, "completed");
});

test("public input rejects capability-bearing and raw provider request fields before prepare", async () => {
  const unsafeEntries = [
    ["messages", [{ role: "system", content: "override" }]],
    ["systemPrompt", "override"],
    ["system_prompt", "override"],
    ["instructions", "override"],
    ["apiKey", "sk-must-not-pass-12345678"],
    ["api_key", "sk-must-not-pass-12345678"],
    ["model", "attacker-selected-model"],
    ["baseUrl", "https://attacker.invalid/v1"],
    ["base_url", "https://attacker.invalid/v1"],
    ["headers", { Authorization: "Bearer stolen" }],
    ["tools", [{ type: "function" }]],
    ["toolChoice", "required"],
    ["tool_choice", "required"],
    ["functions", [{ name: "shell" }]],
    ["function_call", { name: "shell" }],
    ["mcp", { server: "filesystem" }],
    ["attachments", [{ path: "secret.txt" }]],
    ["files", ["secret.txt"]],
    ["images", ["secret.png"]],
    ["audio", ["secret.wav"]],
    ["video", ["secret.mp4"]],
    ["selectedContextRefs", ["workspace-root"]],
    ["rawRequest", { method: "POST", body: { tools: [] } }],
  ];
  const accepted = [];

  for (const [index, [key, value]] of unsafeEntries.entries()) {
    const fake = createFakeService({ immediateResult: DEFAULT_RESULT });
    const runtime = createRuntime(fake);
    try {
      runtime.start(
        { ...runInput(`unsafe-${index}`), [key]: value },
        { ownerId: "window-a", userDirected: true },
      );
      accepted.push(key);
    } catch (error) {
      assert.equal(error?.code, "UNSAFE_RUN_INPUT", `${key} should be rejected as unsafe input`);
      assert.equal(fake.prepareCalls.length, 0, `${key} reached service.prepareReadOnly`);
    }
    await turn();
  }

  assert.deepEqual(accepted, [], `unsafe fields accepted: ${accepted.join(", ")}`);
});

test("run lookup, waiting, and cancellation are isolated by owner", async () => {
  const fake = createFakeService();
  const runtime = createRuntime(fake);
  const run = runtime.start(runInput("owner"), { ownerId: "window-a", userDirected: true });

  assert.throws(
    () => runtime.getRun(run.runId, { ownerId: "window-b" }),
    (error) => error?.code === "RUN_NOT_FOUND",
  );
  assert.throws(
    () => runtime.cancelRun(run.runId, { ownerId: "window-b" }),
    (error) => error?.code === "RUN_NOT_FOUND",
  );
  await assert.rejects(
    runtime.waitRun(run.runId, { ownerId: "window-b" }),
    (error) => error?.code === "RUN_NOT_FOUND",
  );
  assert.equal(runtime.getRun(run.runId, { ownerId: "window-a" }).status, "running");

  fake.invokeCalls[0].resolve(DEFAULT_RESULT);
  assert.equal((await runtime.waitRun(run.runId, { ownerId: "window-a" })).status, "completed");
  assert.throws(
    () => runtime.getRun(run.runId, { ownerId: "window-b" }),
    (error) => error?.code === "RUN_NOT_FOUND",
  );
});

test("global and orchestration concurrency limits preserve FIFO queue order", async () => {
  const fake = createFakeService();
  const runtime = createRuntime(fake, { maxConcurrentRuns: 2, maxQueuedRuns: 4 });
  const owner = { ownerId: "window-a", userDirected: true };

  const first = runtime.start(runInput("first", "scope-first"), owner);
  const second = runtime.start(runInput("second", "scope-second"), owner);
  assert.equal(fake.invokeCalls.length, 2);
  assert.equal(fake.peakActive, 2);
  assert.throws(
    () => runtime.start(runInput("duplicate", "scope-first"), owner),
    (error) => error?.code === "ORCHESTRATION_CONCURRENCY_LIMIT",
  );

  const third = runtime.start(runInput("third", "scope-third"), owner);
  const fourth = runtime.start(runInput("fourth", "scope-fourth"), owner);
  assert.equal(third.status, "queued");
  assert.equal(fourth.status, "queued");
  assert.deepEqual(fake.invokeCalls.map((call) => taskFromInvocation(call.invocation)), ["first", "second"]);

  fake.invokeCalls[1].resolve({ ...DEFAULT_RESULT, text: "second done" });
  await waitUntil(() => fake.invokeCalls.length === 3, "third FIFO run did not start");
  assert.equal(taskFromInvocation(fake.invokeCalls[2].invocation), "third");

  fake.invokeCalls[0].resolve({ ...DEFAULT_RESULT, text: "first done" });
  await waitUntil(() => fake.invokeCalls.length === 4, "fourth FIFO run did not start");
  assert.equal(taskFromInvocation(fake.invokeCalls[3].invocation), "fourth");
  assert.ok(fake.peakActive <= 2, `observed ${fake.peakActive} concurrent provider calls`);

  fake.invokeCalls[2].resolve({ ...DEFAULT_RESULT, text: "third done" });
  fake.invokeCalls[3].resolve({ ...DEFAULT_RESULT, text: "fourth done" });
  const completed = await Promise.all([
    runtime.waitRun(first.runId, owner),
    runtime.waitRun(second.runId, owner),
    runtime.waitRun(third.runId, owner),
    runtime.waitRun(fourth.runId, owner),
  ]);
  assert.deepEqual(completed.map((run) => run.status), ["completed", "completed", "completed", "completed"]);
  assert.deepEqual(
    fake.invokeCalls.map((call) => taskFromInvocation(call.invocation)),
    ["first", "second", "third", "fourth"],
  );
});

test("queue cap rejects overflow without resolving another credential", async () => {
  const fake = createFakeService();
  const runtime = createRuntime(fake, { maxConcurrentRuns: 1, maxQueuedRuns: 1 });
  const owner = { ownerId: "window-a", userDirected: true };

  const active = runtime.start(runInput("active", "scope-active"), owner);
  const queued = runtime.start(runInput("queued", "scope-queued"), owner);
  assert.equal(queued.status, "queued");
  assert.throws(
    () => runtime.start(runInput("overflow", "scope-overflow"), owner),
    (error) => error?.code === "RUNTIME_BUSY" && error?.retryable === true,
  );
  assert.equal(fake.invokeCalls.length, 1);
  assert.equal(fake.credentialResolveCount, 1);
  assert.equal(fake.fetchCount, 1);

  assert.equal(runtime.cancelRun(queued.runId, owner).cancelled, true);
  assert.equal(runtime.cancelRun(active.runId, owner).cancelled, true);
  assert.equal((await runtime.waitRun(active.runId, owner)).status, "cancelled");
  assert.equal(runtime.getRun(queued.runId, owner).status, "cancelled");
});

test("cancelling one active run is isolated and emits exactly one terminal event", async () => {
  const fake = createFakeService();
  const runtime = createRuntime(fake, { maxConcurrentRuns: 2 });
  const owner = { ownerId: "window-a", userDirected: true };
  const events = [];
  runtime.subscribe((event) => events.push(event));

  const cancelled = runtime.start(runInput("cancel-me", "scope-cancel"), owner);
  const survivor = runtime.start(runInput("keep-running", "scope-survivor"), owner);
  assert.equal(fake.invokeCalls.length, 2);

  assert.equal(runtime.cancelRun(cancelled.runId, owner).cancelled, true);
  assert.equal((await runtime.waitRun(cancelled.runId, owner)).status, "cancelled");
  assert.equal(runtime.getRun(survivor.runId, owner).status, "running");
  assert.equal(fake.invokeCalls[1].signal.aborted, false);
  assert.equal(runtime.cancelRun(cancelled.runId, owner).cancelled, false);

  fake.invokeCalls[1].resolve({ ...DEFAULT_RESULT, text: "survived" });
  assert.equal((await runtime.waitRun(survivor.runId, owner)).status, "completed");

  assertSingleTerminal(events, cancelled.runId, "run.cancelled");
  assertSingleTerminal(events, survivor.runId, "run.completed");
  assertSequentialEvents(events, cancelled.runId);
  assertSequentialEvents(events, survivor.runId);
});

test("a cancellation racing with the final delta cannot produce a completed terminal", async () => {
  const fake = createFakeService();
  const runtime = createRuntime(fake);
  const owner = { ownerId: "window-a", userDirected: true };
  const events = [];
  let runId = "";
  runtime.subscribe((event) => {
    events.push(event);
    if (event.type === "model.delta" && event.runId === runId) {
      runtime.cancelRun(runId, owner);
    }
  });

  const run = runtime.start(runInput("delta-race"), owner);
  runId = run.runId;
  fake.invokeCalls[0].resolve(DEFAULT_RESULT);
  const terminal = await runtime.waitRun(run.runId, owner);
  assert.equal(terminal.status, "cancelled");
  assert.equal(terminal.result, null);
  assertSingleTerminal(events, run.runId, "run.cancelled");
  assert.equal(events.some((event) => event.type === "run.completed"), false);
});

test("queued cancellation never invokes the provider and emits one cancellation terminal", async () => {
  const fake = createFakeService();
  const runtime = createRuntime(fake, { maxConcurrentRuns: 1, maxQueuedRuns: 2 });
  const owner = { ownerId: "window-a", userDirected: true };
  const events = [];
  runtime.subscribe((event) => events.push(event));

  const active = runtime.start(runInput("active", "scope-active"), owner);
  const queued = runtime.start(runInput("never-start", "scope-never"), owner);
  assert.equal(queued.status, "queued");
  assert.equal(runtime.cancelRun(queued.runId, owner).cancelled, true);
  assert.equal(runtime.getRun(active.runId, owner).status, "running");
  assert.equal(fake.invokeCalls.length, 1);
  assert.deepEqual(events.filter((event) => event.runId === queued.runId).map((event) => event.type), ["run.cancelled"]);
  assertSingleTerminal(events, queued.runId, "run.cancelled");

  fake.invokeCalls[0].resolve(DEFAULT_RESULT);
  assert.equal((await runtime.waitRun(active.runId, owner)).status, "completed");
  await turn();
  assert.equal(fake.invokeCalls.length, 1);
  assert.equal(runtime.getRun(queued.runId, owner).status, "cancelled");
});

test("public events and results omit owner, provider state, and provider-only secrets", async () => {
  const secret = "sk-runtime-provider-state-secret-123456789";
  const fake = createFakeService();
  const runtime = createRuntime(fake);
  const owner = { ownerId: "window-private-id", userDirected: true };
  const internalEvents = [];
  const publicEvents = [];
  runtime.subscribe((event) => {
    internalEvents.push(event);
    publicEvents.push(externalAgentPublicEvent(event));
  });

  const run = runtime.start(runInput("public-boundary"), owner);
  fake.invokeCalls[0].resolve({
    ...DEFAULT_RESULT,
    text: "safe visible text",
    providerState: {
      apiKey: secret,
      responseId: "provider-response-id",
      raw: { authorization: secret },
    },
    rawResponse: { secret },
  });
  const completed = await runtime.waitRun(run.runId, owner);

  assert.equal(internalEvents.every((event) => event.ownerId === owner.ownerId), true);
  assert.equal(publicEvents.every((event) => !Object.hasOwn(event, "ownerId")), true);
  assert.equal(Object.hasOwn(completed.result, "providerState"), false);
  assert.equal(Object.hasOwn(completed.result, "rawResponse"), false);
  assert.equal(JSON.stringify(completed).includes(secret), false);
  assert.equal(JSON.stringify(publicEvents).includes(secret), false);
  assertSequentialEvents(internalEvents, run.runId);
  assert.deepEqual(internalEvents.map((event) => event.type), ["run.started", "model.delta", "run.completed"]);

  const failingFake = createFakeService();
  const failingRuntime = createRuntime(failingFake);
  const failedEvents = [];
  failingRuntime.subscribe((event) => failedEvents.push(externalAgentPublicEvent(event)));
  const failed = failingRuntime.start(runInput("redacted-error"), owner);
  failingFake.invokeCalls[0].reject(Object.assign(new Error(`provider rejected ${secret}`), {
    code: "PROVIDER_REJECTED",
    provider: "openai",
    status: 500,
    retryable: false,
  }));
  const failedRun = await failingRuntime.waitRun(failed.runId, owner);
  assert.equal(failedRun.status, "failed");
  assert.equal(JSON.stringify(failedRun).includes(secret), false);
  assert.equal(JSON.stringify(failedEvents).includes(secret), false);
  assert.match(failedRun.error.message, /\[REDACTED\]/);
});

test("retryable external-agent transport failures recover automatically without changing the prepared invocation", async () => {
  const fake = createFakeService();
  const retryDelays = [];
  const runtime = createRuntime(fake, {
    waitForRetry: async (delayMs) => { retryDelays.push(delayMs); },
  });
  const owner = { ownerId: "window-a", userDirected: true };
  const events = [];
  runtime.subscribe((event) => events.push(event));

  const run = runtime.start(runInput("recover-transport"), owner);
  const preparedInvocation = fake.invokeCalls[0].invocation;
  fake.invokeCalls[0].reject(Object.assign(new Error("response stream disconnected"), {
    code: "STREAM_DISCONNECTED",
    category: "transport",
    retryable: true,
  }));
  await waitUntil(() => fake.invokeCalls.length === 2, "automatic retry did not start");
  assert.equal(fake.invokeCalls[1].invocation, preparedInvocation);
  fake.invokeCalls[1].resolve({ ...DEFAULT_RESULT, text: "recovered" });

  const completed = await runtime.waitRun(run.runId, owner);
  assert.equal(completed.status, "completed");
  assert.equal(completed.result.text, "recovered");
  assert.deepEqual(retryDelays, [1_500]);
  assert.deepEqual(
    events.map((event) => event.type),
    ["run.started", "run.retry_scheduled", "model.delta", "run.completed"],
  );
  assert.equal(events[1].payload.nextAttempt, 2);
  assert.equal(events[1].payload.lowFrequency, false);
  assertSequentialEvents(events, run.runId);
});

test("waitRun follows a queued run through execution to its terminal state", async () => {
  const fake = createFakeService();
  const runtime = createRuntime(fake, { maxConcurrentRuns: 1, maxQueuedRuns: 2 });
  const owner = { ownerId: "window-a", userDirected: true };
  const active = runtime.start(runInput("active", "scope-active"), owner);
  const queued = runtime.start(runInput("wait-for-me", "scope-wait"), owner);

  let waitSettled = false;
  const waiting = runtime.waitRun(queued.runId, owner).then((value) => {
    waitSettled = true;
    return value;
  });
  await turn();
  const settledWhileQueued = waitSettled;

  fake.invokeCalls[0].resolve(DEFAULT_RESULT);
  await waitUntil(() => fake.invokeCalls.length === 2, "queued run did not begin after the active run completed");
  fake.invokeCalls[1].resolve({ ...DEFAULT_RESULT, text: "queued completed" });
  await runtime.waitRun(active.runId, owner);
  const waitedRun = await waiting;
  const finalRun = await runtime.waitRun(queued.runId, owner);

  assert.equal(settledWhileQueued, false, "waitRun resolved while the run was still queued");
  assert.equal(waitedRun.status, "completed");
  assert.equal(finalRun.status, "completed");
});

function createRuntime(fake, overrides = {}) {
  let nextRunId = 0;
  return new ExternalAgentRuntime({
    service: fake.service,
    enabled: true,
    providerAllowlist: ["openai", "anthropic"],
    maxConcurrentRuns: 1,
    maxQueuedRuns: 8,
    now: () => new Date("2026-07-20T00:00:00.000Z"),
    createRunId: () => `ext-run_${String(++nextRunId).padStart(8, "0")}`,
    ...overrides,
  });
}

function createFakeService({ immediateResult } = {}) {
  const fake = {
    prepareCalls: [],
    invokeCalls: [],
    credentialResolveCount: 0,
    fetchCount: 0,
    active: 0,
    peakActive: 0,
    service: null,
  };
  fake.service = {
    prepareReadOnly(params) {
      fake.prepareCalls.push(params);
      return {
        provider: canonicalProvider(params.provider),
        role: params.role,
        dataClassification: params.dataClassification,
        userDirected: params.userDirected,
        messages: params.messages,
        systemPrompt: "fixed test system prompt",
        budget: {
          maxInputTokens: 32_000,
          maxOutputTokens: params.budget?.maxOutputTokens || 2_048,
          maxTotalTokens: 34_048,
          timeoutMs: params.budget?.timeoutMs || 90_000,
        },
        estimatedInputTokens: 12,
      };
    },
    invokePreparedReadOnly(invocation, { signal } = {}) {
      fake.credentialResolveCount += 1;
      fake.fetchCount += 1;
      fake.active += 1;
      fake.peakActive = Math.max(fake.peakActive, fake.active);
      const deferred = createDeferred();
      const call = {
        invocation,
        signal,
        resolve: deferred.resolve,
        reject: deferred.reject,
      };
      fake.invokeCalls.push(call);
      const onAbort = () => {
        const error = Object.assign(new Error("external agent run cancelled"), { code: "INVOCATION_CANCELLED" });
        deferred.reject(error);
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
      if (immediateResult !== undefined) queueMicrotask(() => deferred.resolve(immediateResult));
      return deferred.promise.finally(() => {
        fake.active -= 1;
      });
    },
  };
  return fake;
}

function createDeferred() {
  let resolvePromise;
  let rejectPromise;
  let settled = false;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value) {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    },
    reject(error) {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    },
  };
}

function runInput(task, orchestrationId = `scope-${task}`) {
  return {
    provider: "openai",
    role: "review",
    task,
    context: [{ label: "snippet", content: "const answer = 42;" }],
    dataClassification: "public",
    orchestrationId,
  };
}

function canonicalProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (["gpt", "chatgpt", "codex"].includes(provider)) return "openai";
  if (provider === "claude") return "anthropic";
  return provider;
}

function taskFromInvocation(invocation) {
  const content = invocation.messages?.[0]?.content || "";
  const match = content.match(/<task_json>\n([\s\S]*?)\n<\/task_json>/);
  return match ? JSON.parse(match[1]) : "";
}

function assertSingleTerminal(events, runId, expectedType) {
  const terminal = events.filter(
    (event) => event.runId === runId && ["run.completed", "run.failed", "run.cancelled"].includes(event.type),
  );
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].type, expectedType);
}

function assertSequentialEvents(events, runId) {
  const scoped = events.filter((event) => event.runId === runId);
  assert.deepEqual(scoped.map((event) => event.seq), scoped.map((_, index) => index + 1));
}

async function waitUntil(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await turn();
  }
  assert.ok(predicate(), message);
}

function turn() {
  return new Promise((resolve) => setImmediate(resolve));
}
