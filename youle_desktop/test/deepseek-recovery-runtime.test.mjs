import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import test from "node:test";
import zlib from "node:zlib";
import { buildManagedLongContextModelCatalog } from "../src/main/app-server-client.mjs";
import { applyThreadProviderSwitch } from "../src/main/thread-provider-switch.mjs";
import { requestWithThreadHistoryRecovery } from "../src/main/thread-history-recovery.mjs";
import { createProviderSendHost } from "./helpers/provider-send-host.mjs";
import { ANALYSIS_RECOVERY_WINDOW_MS } from "../src/main/analysis-model-policy.mjs";

const runtime = fileURLToPath(new URL(process.platform === "darwin" ? `../resources/bin/darwin-${process.arch}/haolo_ai` : "../resources/bin/haolo_ai.exe", import.meta.url));
test("bundled runtime changes Sol to DeepSeek in the same task, sends max and completes a market-tool round trip", {
  skip: !["win32", "darwin"].includes(process.platform) || !fs.existsSync(runtime), timeout: 45_000,
}, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-deepseek-runtime-"));
  const codexHome = path.join(directory, "runtime");
  const cwd = path.join(directory, "workspace");
  fs.mkdirSync(codexHome); fs.mkdirSync(cwd);
  const catalog = buildManagedLongContextModelCatalog(execFileSync(runtime, ["debug", "models", "--bundled"], { encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 }));
  const catalogFile = path.join(codexHome, "models.json");
  fs.writeFileSync(catalogFile, JSON.stringify(catalog));
  const calls = [], toolCalls = [], events = [], pending = new Map();
  let deepSeekCalls = 0, child, nextId = 0, overloadSol = true;
  const server = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    if (request.url !== "/v1/responses") { response.writeHead(404).end(); return; }
    let body = Buffer.concat(chunks);
    if (request.headers["content-encoding"] === "gzip") body = zlib.gunzipSync(body);
    if (request.headers["content-encoding"] === "zstd") body = zlib.zstdDecompressSync(body);
    const payload = JSON.parse(body.toString("utf8"));
    calls.push({ payload, provider: request.headers["x-test-provider"] });
    const id = `local_${calls.length}`;
    let stream;
    if (payload.model === "gpt-5.6-sol" && overloadSol) {
      stream = [{ type: "response.failed", response: { id, status: "failed", error: { code: "server_is_overloaded", message: "Selected model is at capacity" }, output: [] } }];
    } else {
      const tool = ++deepSeekCalls === 1;
      const item = tool
        ? { id: "fc_market", type: "function_call", call_id: "market_call", name: "haolo_candles", arguments: '{"symbol":"ETHUSDT"}', status: "completed" }
        : { id: "msg_result", type: "message", role: "assistant", phase: "final_answer", status: "completed", content: [{ type: "output_text", text: '{"analysis":"complete","snapshotId":"closed-eth-1h"}', annotations: [] }] };
      stream = [
        { type: "response.created", response: { id, status: "in_progress", output: [] } },
        { type: "response.output_item.added", output_index: 0, item: tool ? { ...item, arguments: "", status: "in_progress" } : { ...item, content: [], status: "in_progress" } },
        tool ? { type: "response.function_call_arguments.delta", item_id: item.id, output_index: 0, delta: item.arguments }
          : { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: item.content[0].text },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: { id, status: "completed", output: [item], usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } } },
      ];
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(stream.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  });
  t.after(async () => {
    if (child && child.exitCode == null && child.signalCode == null) await stop();
    for (const slot of pending.values()) clearTimeout(slot.timer);
    server.closeAllConnections(); await new Promise((r) => server.close(r));
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^haolo-deepseek-runtime-/);
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const settings = ['model="gpt-5.6-sol"', 'model_provider="haolo_ai"', `model_catalog_json=${JSON.stringify(catalogFile)}`, "features.remote_plugin=false", "features.plugins=false", "features.apps=false"];
  for (const provider of ["haolo_ai", "deepseek"]) settings.push(
    `model_providers.${provider}.name="${provider}"`, `model_providers.${provider}.base_url="http://127.0.0.1:${server.address().port}/v1"`,
    `model_providers.${provider}.wire_api="responses"`, `model_providers.${provider}.requires_openai_auth=false`, `model_providers.${provider}.supports_websockets=false`,
    `model_providers.${provider}.request_max_retries=0`, `model_providers.${provider}.stream_max_retries=0`, `model_providers.${provider}.http_headers={ "X-Test-Provider" = "${provider}" }`,
  );
  const env = Object.fromEntries(["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP", "COMSPEC", "PATHEXT"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  Object.assign(env, { CODEX_HOME: codexHome, USERPROFILE: directory });
  const onLine = (line) => {
    let message; try { message = JSON.parse(line); } catch { return; }
    events.push(message);
    if (message.method === "item/tool/call") {
      toolCalls.push(message.params);
      child.stdin.write(`${JSON.stringify({ id: message.id, result: { success: true, contentItems: [{ type: "inputText", text: JSON.stringify({ snapshotId: "closed-eth-1h", candles: [{ time: 1_710_000_000, open: 2300, high: 2400, low: 2250, close: 2350 }] }) }] } })}\n`);
      return;
    }
    const slot = pending.get(message.id); if (!slot) return;
    clearTimeout(slot.timer); pending.delete(message.id);
    if (message.error) slot.reject(new Error(message.error.message)); else slot.resolve(message.result);
  };
  const raw = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, 10_000);
    pending.set(id, { resolve, reject, timer }); child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  const rpc = (method, params) => requestWithThreadHistoryRecovery({ request: raw, method, params, codexHome });
  const terminal = async (turnId) => {
    const deadline = Date.now() + 12_000;
    for (;;) {
      const event = events.find((m) => m.method === "turn/completed" && m.params.turn.id === turnId);
      if (event) return event.params.turn;
      assert.ok(Date.now() < deadline, "runtime turn did not finish");
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const stop = async () => {
    const stopped = new Promise((resolve) => child.once("exit", resolve));
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 3_000);
    try { child.kill(); await stopped; } finally { clearTimeout(killTimer); }
  };
  const start = async () => {
    child = spawn(runtime, [...settings.flatMap((value) => ["-c", value]), "app-server", "--stdio"], { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    child.stderr.on("data", () => {});
    const lines = createInterface({ input: child.stdout }); t.after(() => lines.close());
    lines.on("line", onLine);
    await rpc("initialize", { clientInfo: { name: "haolo_deepseek_test", version: "1" }, capabilities: { experimentalApi: true } });
    child.stdin.write('{"method":"initialized","params":{}}\n');
  };
  await start();

  const started = await rpc("thread/start", { cwd, approvalPolicy: "never", sandbox: "read-only", dynamicTools: [{ type: "function", name: "haolo_candles", description: "Read synthetic closed candles", inputSchema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } }] });
  const threadId = started.thread.id;
  const first = await rpc("turn/start", { threadId, input: [{ type: "text", text: "Analyze these ETH candles and retain this task", textElements: [] }], model: "gpt-5.6-sol" });
  assert.equal((await terminal(first.turn.id)).status, "failed");
  let restarts = 0;
  const switched = await applyThreadProviderSwitch({
    request: rpc, baseParams: { threadId, cwd },
    targetSettings: { model: "deepseek-flash", modelProvider: "deepseek", effort: "max" },
    providerOf: (result) => result.modelProvider,
    restartIdleRuntime: async () => { restarts += 1; await stop(); await start(); },
  });
  assert.equal(restarts, 1);
  assert.equal(switched.thread.id, threadId);
  assert.equal(switched.modelProvider, "deepseek");
  const second = await rpc("turn/start", { threadId, model: "deepseek-flash", effort: "max", input: [{ type: "text", text: "Continue the same analysis using the market tool", textElements: [] }] });
  assert.equal((await terminal(second.turn.id)).status, "completed");
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].threadId, threadId);
  assert.deepEqual(calls.map((c) => c.payload.model), ["gpt-5.6-sol", "deepseek-flash", "deepseek-flash"]);
  assert.ok(calls.slice(1).every((c) => c.provider === "deepseek" && c.payload.reasoning.effort === "max"));
  assert.ok(JSON.stringify(calls.at(-1).payload.input).includes("closed-eth-1h"));
  assert.ok(JSON.stringify(calls[1].payload.input).includes("retain this task"));
  overloadSol = false;
  const activatedAt = 1_800_000_000_000;
  const state = { version: 1, activatedAt, fallbackUntil: activatedAt + ANALYSIS_RECOVERY_WINDOW_MS };
  // Exercise the production send IPC, not just the switch utility: previously
  // these ordinary sends changed the model but kept the other provider's key.
  for (const [now, rememberedModel, expectedModel, expectedProvider] of [
    [state.fallbackUntil, "deepseek-flash", "gpt-5.6-sol", "haolo_ai"],
    [activatedAt, "gpt-5.6-sol", "deepseek-flash", "deepseek"],
    [activatedAt, "deepseek-flash", "deepseek-flash", "deepseek"],
    [state.fallbackUntil, "deepseek-flash", "gpt-5.6-sol", "haolo_ai"],
  ]) {
    const host = createProviderSendHost({ request: rpc, cwd, state, now, stop, start });
    const before = calls.length;
    const sent = await host.send({ threadId, model: rememberedModel, text: "Continue the same task without repeating the tool.", approvalPolicy: "never", sandbox: "read-only" });
    assert.equal((await terminal(sent.turn.id)).status, "completed");
    assert.equal(calls.length, before + 1, "switching must not send a probe or replay the user turn");
    assert.equal(calls.at(-1).payload.model, expectedModel);
    assert.equal(calls.at(-1).provider, expectedProvider);
    assert.ok(JSON.stringify(calls.at(-1).payload.input).includes("retain this task"));
    assert.ok(JSON.stringify(calls.at(-1).payload.input).includes("closed-eth-1h"));
  }
  const fresh = await rpc("thread/start", { cwd, model: "gpt-5.6-sol", modelProvider: "haolo_ai", approvalPolicy: "never", sandbox: "read-only" });
  const freshHost = createProviderSendHost({ request: rpc, cwd, stop, start });
  const firstSend = await freshHost.send({ threadId: fresh.thread.id, model: "gpt-5.6-sol", text: "First message", approvalPolicy: "never", sandbox: "read-only" });
  assert.equal((await terminal(firstSend.turn.id)).status, "completed");
  assert.equal(calls.at(-1).provider, "haolo_ai");
  assert.equal(toolCalls.length, 1, "provider changes must not replay the original tool");
  assert.ok(calls.every((c) => c.provider === (c.payload.model === "deepseek-flash" ? "deepseek" : "haolo_ai")));
});
