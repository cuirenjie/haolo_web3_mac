import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import zlib from "node:zlib";
import { once } from "node:events";
import WebSocket, { WebSocketServer } from "ws";
import { buildReadOnlyInvocationRequest } from "../src/main/external-agent/adapter.mjs";
import { AppServerClient, buildManagedLongContextModelCatalog } from "../src/main/app-server-client.mjs";
import { ModelRequestRelay } from "../src/main/model-request-relay.mjs";
import { assertAllowedModelBody } from "../src/main/model-request-policy.mjs";
import { assertAllowedModelRequest, isRetiredExecutionModel, migrateRetiredModelSelection } from "../src/main/retired-model-policy.mjs";
import { withAnalysisModelRecoveryPolicy, ANALYSIS_RECOVERY_WINDOW_MS } from "../src/main/analysis-model-policy.mjs";
import { chatModelOptionsFromList, FIXED_CHAT_MODEL_OPTIONS } from "../src/renderer/chat-model-catalog.ts";
import { normalizeBusinessModelPoolsState, businessPoolModels } from "../src/renderer/business-model-pools.ts";
import { normalizeProviderModelCatalog, providerModelOptions } from "../src/renderer/provider-model-catalog.ts";

test("retired aliases migrate from saved settings but never pass a model request boundary", async () => {
  for (const model of ["gpt-5.5", " GPT-5.5 ", "openai/gpt-5.5", "gpt-5.5-20260701", "gpt-5.5-codex-1p-codexswic-ev3"]) {
    assert.equal(isRetiredExecutionModel(model), true);
    const original = { model, modelProvider: "haolo_ai", effort: "xhigh", reasoningEffortPolicy: "fixed" };
    const migrated = migrateRetiredModelSelection(original);
    assert.equal(migrated.model, "gpt-5.6-sol");
    assert.equal(migrated.effort, undefined);
    assert.equal(original.model, model);
    for (const params of [{ model }, { collaborationMode: { settings: { model } } }, { config: { model } }]) {
      assert.throws(() => assertAllowedModelRequest(params), { code: "MODEL_RETIRED" });
      await assert.rejects(new AppServerClient().requestRaw("turn/start", params), { code: "MODEL_RETIRED" });
    }
  }
  assert.doesNotThrow(() => assertAllowedModelRequest({ model: "gpt-5.6-sol", input: [{ text: "Explain a historical gpt-5.5 failure" }] }));
});

test("an existing 24-hour window migrates old fallback preferences to DeepSeek max and restores both Sol and its provider", () => {
  const now = 1_800_000_000_000;
  const state = { version: 1, activatedAt: now, fallbackUntil: now + ANALYSIS_RECOVERY_WINDOW_MS };
  const active = withAnalysisModelRecoveryPolicy({ model: "gpt-5.5", modelProvider: "haolo_ai", effort: "xhigh" }, state, now);
  assert.equal(active.model, "deepseek-flash");
  assert.equal(active.modelProvider, "deepseek");
  assert.equal(active.reasoningEffort, "max");
  const expired = withAnalysisModelRecoveryPolicy(active, state, state.fallbackUntil);
  assert.equal(expired.model, "gpt-5.6-sol");
  assert.equal(expired.modelProvider, "haolo_ai");
  assert.equal(expired.reasoningEffortPolicy, undefined);
});

test("static, runtime and business-pool model pickers exclude retired backend/cache entries", () => {
  const ids = ["gpt-5.5", "openai/gpt-5.5", "gpt-5.6-sol"];
  const options = chatModelOptionsFromList({ data: ids.map((id) => ({ id })) });
  assert.deepEqual(options.map((o) => o.value), ["gpt-5.6-sol"]);
  assert.ok(FIXED_CHAT_MODEL_OPTIONS.every((o) => !isRetiredExecutionModel(o.value)));
  for (const configured of [true, false]) {
    const providerCatalog = { loading: false, ...normalizeProviderModelCatalog({ configured, providers: [{ provider: "codex", models: ids.map((id) => ({ id })) }] }) };
    assert.deepEqual(providerModelOptions(providerCatalog, "codex").map((m) => m.value), ["gpt-5.6-sol"]);
  }
  const pools = normalizeBusinessModelPoolsState({ configured: true, pools: [{ id: "execution", capabilities: ["root_execution"], models: ids.map((id) => ({ id, provider: "codex", enabled: true })) }] });
  assert.deepEqual(businessPoolModels(pools, "execution", "root_execution").map((m) => m.id), ["gpt-5.6-sol"]);
  const catalog = buildManagedLongContextModelCatalog({ models: [...ids, "gpt-6-astra", "gpt-5.6-terra", "gpt-5.6-luna"].map((slug) => ({ slug })) });
  assert.ok(catalog.models.every((m) => !isRetiredExecutionModel(m.slug)));
  const deepSeek = catalog.models.find((m) => m.slug === "deepseek-flash");
  assert.ok(deepSeek.supported_reasoning_levels.some((r) => r.effort === "max"));
  assert.equal(deepSeek.apply_patch_tool_type, "freeform");
  assert.equal(deepSeek.shell_type, "shell_command");
});

test("HTTP transport blocks retired requests before upstream fetch, including compressed envelopes", async (t) => {
  let requests = 0;
  const relay = new ModelRequestRelay({ upstreamBaseUrl: "https://model.invalid/v1", fetch: async () => { requests++; return new Response('{}', { status: 200 }); } });
  await relay.start();
  t.after(() => relay.stop());
  const body = Buffer.from(JSON.stringify({ model: "gpt-5.5", input: "synthetic" }));
  const encodings = [["", body], ["gzip", zlib.gzipSync(body)], ["br", zlib.brotliCompressSync(body)], ["deflate", zlib.deflateSync(body)]];
  if (zlib.zstdCompressSync) encodings.push(["zstd", zlib.zstdCompressSync(body)]);
  for (const [encoding, bytes] of encodings) {
    const response = await fetch(`${relay.localBaseUrl()}/responses`, { method: "POST", headers: { "content-type": "application/json", ...(encoding ? { "content-encoding": encoding } : {}) }, body: bytes });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "MODEL_RETIRED");
    assert.equal(requests, 0);
  }
  const allowed = await fetch(`${relay.localBaseUrl()}/responses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "deepseek-flash", reasoning: { effort: "max" }, input: "gpt-5.5 appears only as historical text" }) });
  assert.equal(allowed.status, 200);
  assert.equal(requests, 1);
  assert.throws(() => assertAllowedModelBody(JSON.stringify({ type: "response.create", response: { model: "gpt-5.5" } })), { code: "MODEL_RETIRED" });
});

test("built-in defaults and active recovery notices have no retired-model selection", () => {
  const defaults = fs.readFileSync(new URL("../resources/default-haolo-ai/config.toml", import.meta.url), "utf8");
  assert.match(defaults, /^model = "gpt-5\.6-sol"$/m);
  const renderer = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
  assert.doesNotMatch(renderer, /GPT-5\.5|gpt-5\.5/);
  assert.match(renderer, /GPT-6 Astra 最高推理模式/);
  for (const script of ["smoke-haolo-network-routing.mjs", "smoke-thread-history-recovery.mjs"]) {
    assert.doesNotMatch(fs.readFileSync(new URL(`../scripts/${script}`, import.meta.url), "utf8"), /gpt-5\.5/);
  }
});

test("WebSocket transport rejects retired response.create frames without forwarding them upstream", { timeout: 5000 }, async (t) => {
  const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(upstream, "listening");
  let forwarded = 0;
  upstream.on("connection", (socket) => socket.on("message", (data) => { forwarded++; socket.send(data); }));
  const relay = new ModelRequestRelay({ upstreamBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, WebSocketImpl: WebSocket });
  await relay.start();
  t.after(async () => {
    await relay.stop();
    for (const socket of upstream.clients) socket.terminate();
    await new Promise((resolve) => upstream.close(resolve));
  });
  for (const frame of [{ type: "response.create", model: "gpt-5.5" }, { type: "response.create", response: { model: "openai/gpt-5.5" } }]) {
    const socket = new WebSocket(`${relay.localBaseUrl().replace("http:", "ws:")}/responses`);
    await once(socket, "open");
    const reply = once(socket, "message"), closed = once(socket, "close");
    socket.send(JSON.stringify(frame));
    assert.equal(JSON.parse(String((await reply)[0])).error.code, "MODEL_RETIRED");
    assert.equal((await closed)[0], 1008);
    assert.equal(forwarded, 0);
  }
  const socket = new WebSocket(`${relay.localBaseUrl().replace("http:", "ws:")}/responses`);
  await once(socket, "open");
  const reply = once(socket, "message");
  socket.send(JSON.stringify({ type: "response.create", model: "deepseek-v4-flash", reasoning: { effort: "max" } }));
  assert.equal(JSON.parse(String((await reply)[0])).model, "deepseek-flash");
  assert.equal(forwarded, 1);
  socket.close();
});

test("saved external-model credentials cannot bypass the retired-model boundary", () => {
  assert.throws(() => buildReadOnlyInvocationRequest({ credential: { model: "gpt-5.5" }, invocation: {} }), { code: "MODEL_RETIRED" });
});
