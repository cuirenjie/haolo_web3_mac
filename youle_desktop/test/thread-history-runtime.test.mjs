import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import zlib from "node:zlib";
import { requestWithThreadHistoryRecovery } from "../src/main/thread-history-recovery.mjs";

const runtime = fileURLToPath(new URL("../resources/bin/haolo_ai.exe", import.meta.url));
const skip = process.platform !== "win32" || !fs.existsSync(runtime);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A real app-server talking only to a loopback model stub, in disposable storage.
// This catches the startup timing / SQLite projection gap that RPC mocks miss.
for (const separateSqliteHome of [false, true]) {
  test(`bundled runtime initializes empty history and preserves followups (separate sqlite: ${separateSqliteHome})`, { skip, timeout: 45_000 }, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-history-runtime-"));
    const codexHome = path.join(root, "runtime");
    const sqliteHome = separateSqliteHome ? path.join(root, "sqlite") : codexHome;
    const cwd = path.join(root, "workspace");
    for (const directory of [codexHome, sqliteHome, cwd]) fs.mkdirSync(directory, { recursive: true });
    let requests = 0;
    const modelInputs = [];
    const server = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      if (request.url !== "/v1/responses") { response.writeHead(404).end(); return; }
      let body = Buffer.concat(chunks);
      if (request.headers["content-encoding"] === "gzip") body = zlib.gunzipSync(body);
      if (request.headers["content-encoding"] === "zstd") body = zlib.zstdDecompressSync(body);
      modelInputs.push(JSON.parse(body.toString("utf8")));
      const number = ++requests;
      const id = `local_response_${number}`;
      const item = { id: `local_message_${number}`, type: "message", status: "completed", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: `local answer ${number}`, annotations: [] }] };
      const events = [
        { type: "response.created", response: { id, object: "response", status: "in_progress", output: [] } },
        { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
        { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: `local answer ${number}` },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: { id, object: "response", status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } },
      ];
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
    });
    const clients = [];
    t.after(async () => {
      for (const client of clients) await client.stop();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
      assert.match(path.basename(root), /^haolo-history-runtime-/);
      await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const settings = [
      'model_provider="local_history_test"', 'model="gpt-5.5"',
      'model_providers.local_history_test.name="Local history test"',
      `model_providers.local_history_test.base_url="http://127.0.0.1:${server.address().port}/v1"`,
      'model_providers.local_history_test.wire_api="responses"',
      "model_providers.local_history_test.requires_openai_auth=false",
      "model_providers.local_history_test.supports_websockets=false",
      "features.remote_plugin=false", "features.plugins=false", "features.apps=false",
      `sqlite_home=${JSON.stringify(sqliteHome)}`,
    ];
    const env = Object.fromEntries(["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP", "COMSPEC", "PATHEXT"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
    Object.assign(env, { CODEX_HOME: codexHome, USERPROFILE: root, HOME: root });
    const start = async () => {
      const client = await startRuntime({ cwd, env, settings, codexHome });
      clients.push(client);
      return client;
    };
    let client = await start();
    const createEmpty = async () => {
      const result = await client.raw("thread/start", { cwd, approvalPolicy: "never", sandbox: "read-only", ephemeral: false });
      await assert.rejects(client.raw("thread/read", { threadId: result.thread.id, includeTurns: true }), /list_turns is not supported yet/);
      const deadline = Date.now() + 5_000;
      while (!fs.existsSync(result.thread.path) && Date.now() < deadline) await wait(10);
      assert.equal(fs.existsSync(result.thread.path), true);
      return result.thread;
    };
    const runTurn = async (threadId, text) => {
      const started = await client.request("turn/start", { threadId, input: [{ type: "text", text, textElements: [] }] });
      const deadline = Date.now() + 10_000;
      while (!client.completed.has(started.turn.id) && Date.now() < deadline) await wait(10);
      assert.equal(client.completed.get(started.turn.id)?.status, "completed");
    };

    const thread = await createEmpty();
    const originalRollout = fs.readFileSync(thread.path);
    const originalMetadata = await client.raw("thread/read", { threadId: thread.id, includeTurns: false });
    // Exercise the exact screenshot error before going through the fixed client.
    await assert.rejects(client.raw("thread/read", { threadId: thread.id, includeTurns: true }), /list_turns is not supported yet/);
    const results = await Promise.all([
      client.request("thread/read", { threadId: thread.id, includeTurns: true }),
      client.request("thread/resume", { threadId: thread.id, cwd, excludeTurns: true }),
    ]);
    for (const result of results) assert.equal(result.thread.id, thread.id);
    assert.equal(client.updates(), 1);
    assert.equal(requests, 0);
    assert.deepEqual(fs.readFileSync(thread.path), originalRollout);
    assert.deepEqual(results[0].thread.gitInfo, originalMetadata.thread.gitInfo);
    assert.equal(results[1].modelProvider, "local_history_test");

    // Match the chart transcript flow: pre-read -> inject -> verify -> followup.
    await client.request("thread/inject_items", { threadId: thread.id, items: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "synthetic saved question" }] },
      { type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "synthetic saved explanation" }] },
    ] });
    await client.request("thread/read", { threadId: thread.id, includeTurns: true });
    await client.request("thread/resume", { threadId: thread.id, cwd, excludeTurns: true });
    await runTurn(thread.id, "synthetic first followup");
    await client.request("thread/resume", { threadId: thread.id, cwd });
    await runTurn(thread.id, "synthetic second followup");
    assert.equal(requests, 2);
    assert.equal(client.updates(), 1);
    const followupInput = JSON.stringify(modelInputs[1].input);
    for (const text of ["synthetic saved question", "synthetic saved explanation", "synthetic first followup", "local answer 1", "synthetic second followup"]) assert.ok(followupInput.includes(text), text);
    const transcript = fs.readFileSync(thread.path, "utf8");
    for (const text of ["synthetic saved question", "synthetic saved explanation", "synthetic first followup", "synthetic second followup", "local answer 1", "local answer 2"]) assert.ok(transcript.includes(text), text);

    // Recover an empty task that predates the fixed app / a runtime restart.
    const cold = await createEmpty();
    await client.stop();
    client = await start();
    const resumed = await client.request("thread/resume", { threadId: cold.id, cwd, excludeTurns: true });
    assert.equal(resumed.thread.id, cold.id);
    await runTurn(cold.id, "first message after restart");
    assert.equal(requests, 3);

    // Native recovery may rebuild an index from real messages. Our empty-task
    // workaround must not run on it or hide any recovered history.
    const db = new DatabaseSync(path.join(sqliteHome, "state_5.sqlite"));
    try { db.prepare("DELETE FROM threads WHERE id = ?").run(thread.id); } finally { db.close(); }
    const before = fs.readFileSync(thread.path);
    const updates = client.updates();
    const recovered = await client.request("thread/read", { threadId: thread.id, includeTurns: true });
    assert.equal(recovered.thread.id, thread.id);
    assert.ok(recovered.thread.turns.length >= 2);
    assert.equal(client.updates(), updates);
    assert.equal(requests, 3);
    assert.deepEqual(fs.readFileSync(thread.path), before);
  });
}

async function startRuntime({ cwd, env, settings, codexHome }) {
  const child = spawn(runtime, [...settings.flatMap((value) => ["-c", value]), "app-server", "--stdio"], {
    cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  const completed = new Map();
  let exitSeen = false;
  const exited = new Promise((resolve) => child.once("exit", () => { exitSeen = true; resolve(); }));
  let nextId = 1;
  let updates = 0;
  child.stderr.on("data", () => {});
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.method === "turn/completed") completed.set(message.params.turn.id, message.params.turn);
    const slot = pending.get(message.id);
    if (!slot) return;
    clearTimeout(slot.timer);
    pending.delete(message.id);
    if (message.error) slot.reject(Object.assign(new Error(message.error.message), { data: message.error }));
    else slot.resolve(message.result);
  });
  const rejectPending = (error) => {
    for (const slot of pending.values()) { clearTimeout(slot.timer); slot.reject(error); }
    pending.clear();
  };
  child.on("error", rejectPending);
  child.on("exit", (code) => rejectPending(new Error(`test runtime exited: ${code}`)));
  const raw = (method, params, timeout = 10_000) => new Promise((resolve, reject) => {
    const id = nextId++;
    if (method === "thread/metadata/update") updates++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeout);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  const stop = async () => {
    if (!exitSeen) {
      child.kill();
      await exited;
    }
    lines.close();
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
  };
  try {
    await raw("initialize", { clientInfo: { name: "haolo_history_test", version: "1.0.0" }, capabilities: { experimentalApi: true } });
    child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
  } catch (error) { await stop(); throw error; }
  return { raw, stop, completed, updates: () => updates, request: (method, params) => requestWithThreadHistoryRecovery({ request: raw, method, params, codexHome }) };
}
