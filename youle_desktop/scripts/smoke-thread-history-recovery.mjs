// Real bundled runtime + desktop WebSocket client; all model traffic stays on loopback.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { AppServerClient } from "../src/main/app-server-client.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = path.join(packageRoot, "resources/bin", process.platform === "win32" ? "haolo_ai.exe" : "haolo_ai");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-history-runtime-"));
const codexHome = path.join(root, "runtime");
const sqliteHome = path.join(root, "sqlite");
const workspace = path.join(root, "workspace");
for (const directory of [codexHome, sqliteHome, workspace]) fs.mkdirSync(directory, { recursive: true });
const modelInputs = [];
const recoveryEvents = [];
const modelStub = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!request.url.startsWith("/v1/responses")) { response.writeHead(404); response.end(); return; }
  let body = Buffer.concat(chunks);
  if (request.headers["content-encoding"] === "gzip") body = zlib.gunzipSync(body);
  if (request.headers["content-encoding"] === "zstd") body = zlib.zstdDecompressSync(body);
  modelInputs.push(JSON.parse(body.toString("utf8")));
  const id = `response_${modelInputs.length}`;
  const item = { id: `message_${modelInputs.length}`, type: "message", role: "assistant", status: "completed", phase: "final_answer", content: [{ type: "output_text", text: "HISTORY_SMOKE_ANSWER", annotations: [] }] };
  const events = [
    { type: "response.created", response: { id, object: "response", status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
    { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: "HISTORY_SMOKE_ANSWER" },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id, object: "response", status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } },
  ];
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
});
await new Promise((resolve) => modelStub.listen(0, "127.0.0.1", resolve));
const env = Object.fromEntries(["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP", "COMSPEC", "PATHEXT"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
Object.assign(env, { CODEX_HOME: codexHome, USERPROFILE: root, HOME: root });
const settings = [
  'model_provider="probe"', 'model="gpt-5.6-sol"',
  `sqlite_home=${JSON.stringify(sqliteHome.replaceAll("\\", "/"))}`,
  'model_providers.probe.name="Local history recovery test"',
  `model_providers.probe.base_url="http://127.0.0.1:${modelStub.address().port}/v1"`,
  'model_providers.probe.wire_api="responses"',
  "model_providers.probe.requires_openai_auth=false", "features.remote_plugin=false", "features.shell_snapshot=false",
];

async function startClient() {
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(executable, [...settings.flatMap((value) => ["-c", value]), "app-server", "--listen", `ws://127.0.0.1:${port}`], {
    cwd: workspace, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-8000); });
  child.stdout.resume();
  const client = new AppServerClient({ codexHome, cwd: workspace });
  const completed = new Map();
  client.on("notification", (event) => { if (event.method === "turn/completed") completed.set(event.params.turn.id, event.params.turn); });
  client.on("log", (entry) => { if (entry.line.includes("[thread-history-recovery]")) recoveryEvents.push(entry.line); });
  const stop = async () => {
    client.status = "stopped";
    client.ws?.terminate();
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
    }
    child.stdout.destroy(); child.stderr.destroy();
  };
  try {
    const deadline = Date.now() + 20000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Runtime exited: ${stderr}`);
      try { ready = (await fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(500) })).ok; } catch { /* Starting. */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, "runtime should become ready");
    await client.connectWebSocket(`ws://127.0.0.1:${port}`);
    await client.request("initialize", { clientInfo: { name: "haolo_desktop", version: "history-smoke" }, capabilities: { experimentalApi: true } });
    client.sendNotification("initialized", {});
    client.status = "ready";
    return { client, stop, completed };
  } catch (error) { await stop(); throw error; }
}

let session;
let database;
try {
  session = await startClient();
  const started = await session.client.request("thread/start", { cwd: workspace, ephemeral: false, approvalPolicy: "never", sandbox: "read-only" });
  const threadId = started.thread.id;
  assert.equal(started.thread.historyMode, "paginated");
  const send = async (text) => {
    const result = await session.client.request("turn/start", { threadId, input: [{ type: "text", text, textElements: [] }] });
    const deadline = Date.now() + 15000;
    while (!session.completed.has(result.turn.id) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(session.completed.get(result.turn.id)?.status, "completed");
    return result.turn.id;
  };
  const firstTurnId = await send("HISTORY_SMOKE_ORIGINAL_QUESTION");
  database = new DatabaseSync(path.join(sqliteHome, "state_5.sqlite"));
  const originalMetadata = database.prepare("SELECT * FROM threads WHERE id=?").get(threadId);
  const corruptTestIndex = () => database.prepare("UPDATE threads SET history_mode='legacy' WHERE id=?").run(threadId);
  const resumeParams = { threadId, cwd: workspace, model: "gpt-5.6-sol", modelProvider: "probe", developerInstructions: "Preserve history." };
  corruptTestIndex();
  await assert.rejects(session.client.requestRaw("thread/resume", resumeParams), /list_turns is not supported yet/);
  const resumed = await session.client.request("thread/resume", resumeParams);
  assert.equal(resumed.thread.id, threadId);
  assert.ok(resumed.thread.turns.some((turn) => turn.id === firstTurnId));
  assert.equal(modelInputs.length, 1, "recovery must not submit a model request");
  assert.deepEqual(database.prepare("SELECT * FROM threads WHERE id=?").get(threadId), originalMetadata);
  console.log("PASS: live resume repairs the index and preserves the original thread, turns and metadata");

  corruptTestIndex();
  const read = await session.client.request("thread/read", { threadId, includeTurns: true });
  assert.ok(read.thread.turns.some((turn) => turn.id === firstTurnId));
  console.log("PASS: history loading repairs the same fault through the shared desktop client");

  corruptTestIndex();
  await session.stop();
  session = await startClient();
  const coldResume = await session.client.request("thread/resume", resumeParams);
  assert.equal(coldResume.thread.id, threadId);
  assert.ok(coldResume.thread.turns.some((turn) => turn.id === firstTurnId));
  console.log("PASS: recovery works after restarting the runtime with a stale index");

  await send("HISTORY_SMOKE_FOLLOWUP_QUESTION");
  assert.equal(modelInputs.length, 2, "exactly one model request for each user message");
  assert.match(JSON.stringify(modelInputs[1].input), /HISTORY_SMOKE_ORIGINAL_QUESTION/);
  assert.match(JSON.stringify(modelInputs[1].input), /HISTORY_SMOKE_FOLLOWUP_QUESTION/);
  assert.match(JSON.stringify(modelInputs[1].input), /HISTORY_SMOKE_ANSWER/);
  const finalRead = await session.client.request("thread/read", { threadId, includeTurns: true });
  assert.equal(finalRead.thread.turns.length, 2);
  assert.equal(fs.readdirSync(path.join(sqliteHome, "haolo-history-index-recovery")).length, 3);
  assert.equal(recoveryEvents.filter((event) => event.includes('"status":"verified"')).length, 3);
  console.log("PASS: followup completes with original context, two turns and no duplicate model submission");
} finally {
  database?.close();
  await session?.stop();
  modelStub.closeAllConnections();
  await new Promise((resolve) => modelStub.close(resolve));
  const resolvedRoot = path.resolve(root);
  assert.equal(path.dirname(resolvedRoot), path.resolve(os.tmpdir()));
  assert.match(path.basename(resolvedRoot), /^haolo-history-runtime-/);
  await fs.promises.rm(resolvedRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
