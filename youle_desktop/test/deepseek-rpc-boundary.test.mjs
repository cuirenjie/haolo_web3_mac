import test from "node:test";
import assert from "node:assert/strict";
import { AppServerClient, defaultCodexConfigArgs } from "../src/main/app-server-client.mjs";
import { normalizeAnalysisRPCSelection } from "../src/main/analysis-model-policy.mjs";
import { ModelRequestRelay } from "../src/main/model-request-relay.mjs";
import zlib from "node:zlib";

const aliases = ["gpt-5.6-sol", "gpt-6-sol", "gpt-6-astra", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark", "gpt-5.2", "deepseek-v4-flash", "deepseek-flash"];

test("native recovery scope survives duplicate notifications, isolates threads, and ends only with its own turn", () => {
  const client = new AppServerClient();
  const event = (method, threadId, turnId) => client.handleMessage(JSON.stringify({ method, params: { threadId, turn: { id: turnId } } }));
  event("turn/started", "one", "turn-a");
  const state = client.toolRecoveryStates.get("one");state.answerOnly = true;
  event("turn/started", "one", "turn-a");assert.equal(client.toolRecoveryStates.get("one"), state);
  event("turn/started", "two", "turn-b");assert.equal(client.toolRecoveryStates.get("two").answerOnly, false);
  event("turn/completed", "one", "stale-turn");assert.equal(client.toolRecoveryStates.get("one"), state);
  event("turn/completed", "one", "turn-a");assert.ok(!client.toolRecoveryStates.has("one"));
  event("turn/started", "one", "turn-c");assert.equal(client.toolRecoveryStates.get("one").answerOnly, false);
  event("thread/closed", "one");assert.ok(!client.toolRecoveryStates.has("one"));
  assert.ok(client.toolRecoveryStates.has("two"));
});
test("every native analysis lifecycle RPC normalizes historical selection without touching evidence", async () => {
  const client = new AppServerClient();
  const sent = [];
  client.ws = { readyState: 1, send(raw) {
    const rpc = JSON.parse(raw); sent.push(rpc);
    const pending = client.pending.get(rpc.id);
    clearTimeout(pending.timer); client.pending.delete(rpc.id); pending.resolve({});
  } };
  for (const method of ["thread/start", "thread/resume", "thread/fork", "thread/settings/update", "turn/start"]) {
    for (const model of aliases) {
      const input = [{ type: "text", text: `Preserve ${model} exactly in user evidence` }];
      const params = { threadId: "t", model, modelProvider: "haolo_ai", reasoningEffort: "max", input,
        collaborationMode: { settings: { model, reasoning_effort: "high" } } };
      await client.requestRaw(method, params);
      const actual = sent.at(-1).params;
      assert.equal(actual.model, "deepseek-flash");
      assert.equal(actual.modelProvider, "deepseek");
      assert.equal(actual.reasoningEffort, "low");
      assert.equal(actual.collaborationMode.settings.model, "deepseek-flash");
      assert.equal(actual.collaborationMode.settings.reasoning_effort, "low");
      assert.deepEqual(actual.input, input);
      assert.equal(params.model, model);
    }
  }
  assert.equal(client.historyModelSelections.get("t").effort, "low");
});

test("managed wire requests clamp compressed stale aliases while preserving all input and output allowances", async t => {
  const captured = [];
  const relay = new ModelRequestRelay({ upstreamBaseUrl: "https://fixture.invalid/v1", managedAnalysis: true,
    fetch: async (_url, init) => {
      const encoding = new Headers(init.headers).get("content-encoding");
      captured.push(JSON.parse((encoding === "gzip" ? zlib.gunzipSync(init.body) : Buffer.from(init.body)).toString()));
      return new Response("{}");
    } });
  await relay.start(); t.after(() => relay.stop());
  const original = { model: "gpt-6-astra", reasoning: { effort: "max", summary: "auto" }, max_output_tokens: 32768,
    input: [{ type: "function_call", call_id: "c", name: "analysis", arguments: '{"evidence":"gpt-6-astra"}' },
      { type: "function_call_output", call_id: "c", output: "unmodified evidence" }], tools: [], store: false };
  const response = await fetch(`${relay.localBaseUrl()}/responses`, { method: "POST",
    headers: { "content-type": "application/json", "content-encoding": "gzip" }, body: zlib.gzipSync(JSON.stringify(original)) });
  assert.equal(response.status, 200); await response.text();
  assert.equal(captured[0].model, "deepseek-flash");
  assert.equal(captured[0].reasoning.effort, "low");
  assert.equal(captured[0].max_output_tokens, original.max_output_tokens);
  assert.ok(JSON.stringify(captured[0].input).includes("unmodified evidence"));
  assert.equal(original.input[0].type, "function_call", "request-local adaptation never rewrites saved input");
});

test("read-only history, dedicated media and independent models keep their selections", () => {
  const history = { model: "gpt-6-astra" };
  assert.equal(normalizeAnalysisRPCSelection("thread/read", history), history);
  for (const params of [{ model: "custom-model", modelProvider: "custom" },
    { model: "gpt-6-astra", conversationMode: "image-generation" }]) {
    assert.equal(normalizeAnalysisRPCSelection("turn/start", params), params);
  }
  const args = defaultCodexConfigArgs();
  assert.ok(args.includes('model_reasoning_effort="low"'));
  assert.ok(args.includes("model_providers.haolo_ai.supports_websockets=false"));
  assert.ok(args.includes("model_providers.deepseek.supports_websockets=false"));
});
