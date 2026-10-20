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
test("bundled CLI reproduces retired-history compaction failure and completes the same chain with a scoped migration", {
  skip: process.platform !== "win32" || !fs.existsSync(runtime), timeout: 60_000,
}, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-legacy-compact-"));
  const home = path.join(directory, "home"); fs.mkdirSync(home);
  const requests = [], events = [], blocked = [];
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
  const relay = new ModelRequestRelay({ upstreamBaseUrl: `http://127.0.0.1:${model.address().port}/v1`,
    resolveHistoryModel: id => migrationEnabled ? host.historyModelSelections.get(id) : undefined });
  relay.on("request-error", e => blocked.push(e.code));
  await relay.start();
  const stop = async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise(r => child.once("exit", r)); child.kill(); await exited;
    }
    for (const p of host?.pending.values() || []) clearTimeout(p.timer);
  };
  t.after(async () => {
    await stop(); await relay.stop(); model.closeAllConnections(); await new Promise(r => model.close(r));
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^haolo-legacy-compact-/);
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  const start = async () => {
    const settings = [
      `model="${seed ? "gpt-5.5" : "gpt-5.6-sol"}"`, 'model_provider="fixture"',
      "model_context_window=20000", "model_auto_compact_token_limit=10000",
      "features.remote_plugin=false", "features.plugins=false", "features.apps=false",
      'model_providers.fixture.name="fixture"',
      `model_providers.fixture.base_url="${seed ? `http://127.0.0.1:${model.address().port}/v1` : relay.localBaseUrl()}"`,
      'model_providers.fixture.wire_api="responses"', "model_providers.fixture.requires_openai_auth=false",
      "model_providers.fixture.supports_websockets=false", "model_providers.fixture.request_max_retries=0",
      "model_providers.fixture.stream_max_retries=0",
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
    lines.on("line", line => host.handleMessage(line));
    await host.requestRaw("initialize", { clientInfo: { name: "legacy_compaction_test", version: "1" }, capabilities: { experimentalApi: true } });
    host.sendNotification("initialized", {});
  };
  const rpc = (method, params) => requestWithThreadHistoryRecovery({
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
  await stop(); seed = false; await start();
  for (const id of ids) await rpc("thread/resume", { threadId: id, cwd: directory, model: "gpt-5.6-sol" });
  const first = await run(ids[0], "帮我用裸K策略分析 BTCUSDT 1小时");
  assert.equal(first.status, "failed");
  assert.ok(blocked.includes("MODEL_RETIRED"));
  const before = requests.length, eventStart = events.length;
  migrationEnabled = true;
  const fixed = await run(ids[1], "帮我用裸K策略分析 BTCUSDT 1小时");
  assert.equal(fixed.status, "completed", JSON.stringify(fixed));
  const migratedRequests = requests.slice(before);
  assert.ok(migratedRequests.length >= 2, "compaction and subsequent answer must both reach the model");
  assert.ok(migratedRequests.every(r => r.model === "gpt-5.6-sol"));
  assert.ok(JSON.stringify(migratedRequests.at(-1).input).includes("帮我用裸K策略分析 BTCUSDT 1小时"));
  assert.ok(events.slice(eventStart).some(e => e.method === "item/completed" && e.params.item?.type === "contextCompaction"));
  const history = await rpc("thread/read", { threadId: ids[1], includeTurns: true });
  assert.ok(JSON.stringify(history).includes("Historical BTCUSDT 1h conversation"));
});
