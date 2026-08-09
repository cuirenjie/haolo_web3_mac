import assert from "node:assert/strict";
import test from "node:test";
import { ExternalModelService } from "../src/main/external-agent/service.mjs";
import { getExternalModelProvider } from "../src/main/external-agent/provider-registry.mjs";

function credentialFor(providerId) {
  const provider = getExternalModelProvider(providerId);
  return {
    provider,
    apiKey: "sk-service-test-1234567890abcdef",
    model: provider.defaultModel,
    baseUrlProfile: provider.baseUrlOptions[0].id,
    baseUrl: provider.baseUrlOptions[0].baseUrl,
  };
}

function readOnlyParams(overrides = {}) {
  return {
    provider: "gpt",
    role: "review",
    dataClassification: "internal",
    userDirected: true,
    messages: [{ role: "user", content: "Review this explicitly selected internal example." }],
    ...overrides,
  };
}

test("service policy and prepared-invocation brand run before credential resolution", async () => {
  let resolveCalls = 0;
  let invokeCalls = 0;
  const credentialStore = {
    async resolve() {
      resolveCalls += 1;
      return credentialFor("openai");
    },
  };
  const service = new ExternalModelService({
    credentialStore,
    fetch: async () => { throw new Error("unused by injected invoker"); },
    readOnlyInvoker: async ({ credential, invocation }) => {
      invokeCalls += 1;
      assert.equal(credential.provider.id, "openai");
      assert.equal(invocation.provider, "openai");
      return { text: "review", usage: {}, finishReason: "stop", citations: [] };
    },
  });

  assert.throws(
    () => service.prepareReadOnly(readOnlyParams({ tools: [] })),
    (error) => error?.code === "CAPABILITY_NOT_ALLOWED",
  );
  assert.throws(
    () => service.prepareReadOnly(readOnlyParams({
      messages: [{ role: "user", content: "OPENAI_API_KEY=opaqueCredentialValue12345" }],
    })),
    (error) => error?.code === "POTENTIAL_SECRET_DETECTED",
  );
  assert.equal(resolveCalls, 0);

  const prepared = service.prepareReadOnly(readOnlyParams());
  assert.equal(prepared.provider, "openai");
  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(Object.isFrozen(prepared.messages), true);
  assert.equal(Object.isFrozen(prepared.budget), true);

  const foreignService = new ExternalModelService({
    credentialStore,
    fetch: async () => new Response("{}"),
  });
  await assert.rejects(
    foreignService.invokePreparedReadOnly(prepared),
    (error) => error?.code === "INVOCATION_NOT_PREPARED",
  );
  assert.equal(resolveCalls, 0);

  const result = await service.invokePreparedReadOnly(prepared);
  assert.equal(result.text, "review");
  assert.equal(resolveCalls, 1);
  assert.equal(invokeCalls, 1);
});

test("pre-cancelled invocation never decrypts a provider key", async () => {
  let resolveCalls = 0;
  const service = new ExternalModelService({
    credentialStore: {
      async resolve() {
        resolveCalls += 1;
        return credentialFor("openai");
      },
    },
    fetch: async () => new Response("{}"),
  });
  const prepared = service.prepareReadOnly(readOnlyParams());
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    service.invokePreparedReadOnly(prepared, { signal: controller.signal }),
    (error) => error?.code === "INVOCATION_CANCELLED",
  );
  assert.equal(resolveCalls, 0);
});

test("billable connection tests coalesce in flight and observe a server-side cooldown", async () => {
  let fetchCalls = 0;
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let nowMs = Date.parse("2026-07-20T00:00:00.000Z");
  const capturedInit = [];
  const service = new ExternalModelService({
    credentialStore: { resolve: async () => credentialFor("perplexity") },
    fetch: async (_url, init) => {
      fetchCalls += 1;
      capturedInit.push(init);
      if (fetchCalls === 1) await firstGate;
      return new Response(JSON.stringify({
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
    now: () => new Date(nowMs),
    billableTestCooldownMs: 10_000,
  });

  const first = service.testConnection("perplexity");
  const concurrent = service.testConnection("pplx");
  releaseFirst();
  const [firstResult, concurrentResult] = await Promise.all([first, concurrent]);
  assert.deepEqual(concurrentResult, firstResult);
  assert.equal(fetchCalls, 1);
  assert.equal(capturedInit[0].redirect, "error");
  assert.equal(capturedInit[0].credentials, "omit");
  assert.equal(capturedInit[0].cache, "no-store");

  await service.testConnection("perplexity");
  assert.equal(fetchCalls, 1);
  nowMs += 10_001;
  await service.testConnection("perplexity");
  assert.equal(fetchCalls, 2);
});
