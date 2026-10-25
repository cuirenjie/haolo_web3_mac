import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import test from "node:test";
import { AppServerClient } from "../src/main/app-server-client.mjs";
import { ModelRequestRelay } from "../src/main/model-request-relay.mjs";
import { requestWithThreadHistoryRecovery } from "../src/main/thread-history-recovery.mjs";

const runtime = fileURLToPath(new URL("../resources/bin/haolo_ai.exe", import.meta.url));
test("bundled CLI compacts retired history with DeepSeek and relay migration requires the same live thread", {
  skip: process.platform !== "win32" || !fs.existsSync(runtime), timeout: 60_000,
}, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-legacy-compact-"));
  const home = path.join(directory, "home"); fs.mkdirSync(home);
  const requests = [], events = [], blocked = [];
  const fixturePending = new Map();
  let fixtureRequestId = 0;
  let child, host, seed = true, migrationEnabled = false, stderr = "";
  const model = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    let bytes = Buffer.concat(chunks);
    if (req.headers["content-encoding"] === "zstd") bytes = zlib.zstdDecompressSync(bytes);
    if (req.headers["content-encoding"] === "gzip") bytes = zlib.gunzipSync(bytes);
    const input = JSON.parse(bytes); requests.push(input);
    const id = `fixture_${requests.length}`;
    const item = { id: `msg_${id}`, type: "message", role: "assistant", phase: "final_answer", status: "completed",
      content: [{ type: "output_text", text: "Keep BTCUSDT 1h and the user's price-action analysis goal.", annotations: [] }] };
    const stream = [
      { type: "response.created", response: { id, status: "in_progress", output: [] } },
      { type: "response.output_item.added", output_index: 0, item: { ...item, content: [], status: "in_progress" } },
      { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: item.content[0].text },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: { id, status: "completed", output: [item],
        usage: { input_tokens: seed ? 15000 : 100, output_tokens: 10, total_tokens: seed ? 15010 : 110 } } },
    ];
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(stream.map(e => `data: ${JSON.stringify(e)}\n\n`).join(""));
  });
  await new Promise(r => model.listen(0, "127.0.0.1", r));
  const relay = new ModelRequestRelay({ upstreamBaseUrl: `http://127.0.0.1:${model.address().port}/v1`, managedAnalysis: true,
    resolveHistoryModel: id => migrationEnabled ? host.historyModelSelections.get(id) : undefined });
  relay.on("request-error", e => blocked.push(e.code));
  await relay.start();
  const stop = async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise(r => child.once("exit", r)); child.kill(); await exited;
    }
    for (const p of host?.pending.values() || []) clearTimeout(p.timer);
    for (const p of fixturePending.values()) clearTimeout(p.timer);
    fixturePending.clear();
  };
  t.after(async () => {
    await stop(); await relay.stop(); model.closeAllConnections(); await new Promise(r => model.close(r));
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^haolo-legacy-compact-/);
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  const start = async () => {
    // Today's host resolves this provider ID; both fixture phases point it
    // exclusively at the isolated local server.
    const provider = "deepseek";
    const settings = [
      `model="${seed ? "gpt-5.5" : "deepseek-flash"}"`, `model_provider="${provider}"`,
      "model_context_window=20000", "model_auto_compact_token_limit=10000",
      "features.remote_plugin=false", "features.plugins=false", "features.apps=false",
      `model_providers.${provider}.name="fixture"`,
      `model_providers.${provider}.base_url="${seed ? `http://127.0.0.1:${model.address().port}/v1` : relay.localBaseUrl()}"`,
      `model_providers.${provider}.wire_api="responses"`, `model_providers.${provider}.requires_openai_auth=false`,
      `model_providers.${provider}.supports_websockets=false`, `model_providers.${provider}.request_max_retries=0`,
      `model_providers.${provider}.stream_max_retries=0`,
    ];
    const env = Object.fromEntries(["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP", "COMSPEC", "PATHEXT"]
      .filter(k => process.env[k]).map(k => [k, process.env[k]]));
    Object.assign(env, { CODEX_HOME: home, USERPROFILE: directory });
    child = spawn(runtime, [...settings.flatMap(s => ["-c", s]), "app-server", "--stdio"], {
      cwd: directory, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.on("data", b => { stderr = (stderr + b).slice(-6000); });
    host = new AppServerClient({ codexHome: home });
    host.ws = { readyState: 1, send: raw => child.stdin.write(`${raw}\n`) };
    host.on("notification", e => events.push(e));
    const lines = readline.createInterface({ input: child.stdout });
    child.once("exit", () => lines.close());
    lines.on("line", line => {
      const message = JSON.parse(line), pending = fixturePending.get(message.id);
      if (!pending) return host.handleMessage(line);
      fixturePending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    await host.requestRaw("initialize", { clientInfo: { name: "legacy_compaction_test", version: "1" }, capabilities: { experimentalApi: true } });
    host.sendNotification("initialized", {});
  };
  // Seed genuinely retired history through the native fixture protocol only.
  // Today's host normalizes legacy selections; all resume/repair operations
  // below still use the production host and its DeepSeek-only normalization.
  const seedRpc = (method, params) => new Promise((resolve, reject) => {
    const id = `seed_${++fixtureRequestId}`;
    const timer = setTimeout(() => {
      fixturePending.delete(id); reject(new Error(`fixture ${method} timed out`));
    }, 12_000);
    fixturePending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  const rpc = (method, params) => seed ? seedRpc(method, params) : requestWithThreadHistoryRecovery({
    request: (m, p) => host.requestRaw(m, p, 12_000), method, params, codexHome: home,
  });
  const run = async (threadId, text) => {
    const result = await rpc("turn/start", { threadId, ...(seed ? {} : { model: "gpt-5.6-sol" }),
      input: [{ type: "text", text, textElements: [] }] });
    const until = Date.now() + 12_000;
    while (true) {
      const event = events.find(e => e.method === "turn/completed" && e.params.turn.id === result.turn.id);
      if (event) return event.params.turn;
      assert.ok(Date.now() < until, `turn timeout: ${stderr}`);
      await new Promise(r => setTimeout(r, 20));
    }
  };
  await start();
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const created = await rpc("thread/start", { cwd: directory, approvalPolicy: "never", sandbox: "read-only" });
    ids.push(created.thread.id);
    assert.equal((await run(ids[i], "Historical BTCUSDT 1h conversation")).status, "completed");
  }
  assert.ok(requests.length >= 2 && requests.every(r => r.model === "gpt-5.5"), "seed must contain actual retired-model history");
  await stop(); seed = false; await start();
  for (const id of ids) await rpc("thread/resume", { threadId: id, cwd: directory, model: "gpt-5.6-sol" });
  const firstRequest = requests.length, firstEvent = events.length;
  const first = await run(ids[0], "帮我用裸K策略分析 BTCUSDT 1小时");
  assert.equal(first.status, "completed", JSON.stringify(first));
  assert.ok(requests.length >= firstRequest + 2, "automatic compaction and its answer must both run");
  assert.ok(requests.slice(firstRequest).every(r => r.model === "deepseek-flash" && r.reasoning?.effort === "low"));
  assert.ok(events.slice(firstEvent).some(e => e.method === "item/completed" && e.params.item?.type === "contextCompaction"));
  // Current RPC normalization already prevents the original CLI failure. Keep
  // the negative control at the wire boundary for older persisted compactions.
  const legacyRequest = threadId => fetch(`${relay.localBaseUrl()}/responses`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...requests[0], model: "gpt-5.5", prompt_cache_key: threadId }),
  });
  const rejected = await legacyRequest(ids[0]);
  assert.equal(rejected.status, 400); await rejected.text();
  assert.ok(blocked.includes("MODEL_RETIRED"));
  migrationEnabled = true;
  const unconfirmed = await legacyRequest(ids[1]);
  assert.equal(unconfirmed.status, 400); await unconfirmed.text();
  const admitted = requests.length;
  const migrated = await legacyRequest(ids[0]);
  assert.equal(migrated.status, 200); await migrated.text();
  assert.equal(requests.length, admitted + 1);
  assert.equal(requests.at(-1).model, "deepseek-flash");
  assert.equal(requests.at(-1).reasoning.effort, "low");
  const before = requests.length, eventStart = events.length;
  const fixed = await run(ids[1], "帮我用裸K策略分析 BTCUSDT 1小时");
  assert.equal(fixed.status, "completed", JSON.stringify(fixed));
  const migratedRequests = requests.slice(before);
  assert.ok(migratedRequests.length >= 2, "compaction and subsequent answer must both reach the model");
  assert.ok(migratedRequests.every(r => r.model === "deepseek-flash"));
  assert.ok(migratedRequests.every(r => r.reasoning?.effort === "low"));
  assert.ok(JSON.stringify(migratedRequests.at(-1).input).includes("帮我用裸K策略分析 BTCUSDT 1小时"));
  assert.ok(events.slice(eventStart).some(e => e.method === "item/completed" && e.params.item?.type === "contextCompaction"));
  const history = await rpc("thread/read", { threadId: ids[1], includeTurns: true });
  assert.ok(JSON.stringify(history).includes("Historical BTCUSDT 1h conversation"));
});
