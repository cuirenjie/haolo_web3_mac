import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import zlib from "node:zlib";
import { AppServerClient } from "../src/main/app-server-client.mjs";
import { failureDiagnosticsFromNotification } from "../src/main/turn-diagnostics.mjs";
import { isRecoverableAnalysisModelFailure } from "../src/main/analysis-model-recovery.mjs";
import { createAppServerTradingAnalysisProvider } from "../src/main/trading-analysis/app-server-provider.mjs";

const runtime = fileURLToPath(new URL("../resources/bin/haolo_ai.exe", import.meta.url));
test("production AppServerClient migrates a legacy task to max and makes exactly one request on 403", {
  skip: process.platform !== "win32" || !fs.existsSync(runtime), timeout: 30_000,
}, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-deepseek-denial-"));
  const cwd = path.join(directory, "workspace"), codexHome = path.join(directory, "runtime"), authPath = path.join(directory, "auth.json");
  fs.mkdirSync(cwd);
  const calls = [], events = [];
  let client;
  const server = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const decode = { gzip: zlib.gunzipSync, zstd: zlib.zstdDecompressSync }[request.headers["content-encoding"]];
    const bytes = Buffer.concat(chunks);
    calls.push({ body: JSON.parse((decode ? decode(bytes) : bytes).toString()), headers: request.headers });
    response.writeHead(403, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { code: "PERMISSION_DENIED", message: 'model "deepseek-flash" is not enabled for 执行模式', retryable: false } }));
  });
  t.after(async () => {
    await client?.stop();
    server.closeAllConnections(); await new Promise(r => server.close(r));
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^haolo-deepseek-denial-/);
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  fs.writeFileSync(authPath, JSON.stringify({ OPENAI_API_KEY: "sk-local-test", LLMHUB_BASE_URL: baseUrl }));
  client = new AppServerClient({ cwd, codexHome, authPath, codexCommand: runtime, providerRuntimeResolver: async () => ({ deepSeek: { apiKey: "sk-local-deepseek-test", baseUrl, routeGroupId: 15 } }) });
  client.on("notification", event => events.push(event));
  client.on("server-request", message => client.respondError(message.id, -32601, "No tools in denial test"));
  const terminal = async turnId => {
    const until = Date.now() + 10_000;
    for (;;) {
      const event = events.find(e => e.method === "turn/completed" && e.params?.turn?.id === turnId);
      if (event) return event;
      assert.ok(Date.now() < until, "denied runtime did not terminate promptly");
      await new Promise(r => setTimeout(r, 10));
    }
  };
  await client.start();
  const provider = createAppServerTradingAnalysisProvider({ modelId: "deepseek-v4-flash", waitForRecovery: async () => assert.fail("403 must not retry"), invoke: async selection => {
    assert.equal(selection.modelId, "deepseek-flash");
    assert.equal(selection.reasoningEffort, "max");
    // Deliberately inject persisted legacy metadata at the RPC boundary.
    const { thread } = await client.request("thread/start", { cwd, model: "deepseek-v4-flash", modelProvider: "deepseek", approvalPolicy: "never", sandbox: "read-only", ephemeral: true });
    const { turn } = await client.request("turn/start", { threadId: thread.id, model: "deepseek-v4-flash", effort: selection.reasoningEffort, input: [{ type: "text", text: "Synthetic permission check. Do not use tools.", textElements: [] }] });
    const notification = await terminal(turn.id);
    assert.equal(notification.params.turn.status, "failed");
    const failure = failureDiagnosticsFromNotification(notification);
    assert.equal(failure.httpStatus, 403);
    assert.equal(isRecoverableAnalysisModelFailure(failure, { allowUnknownTerminal: true }), false);
    return { status: "failed", error: failure.detail, httpStatus: failure.httpStatus, retryable: false };
  } });
  await assert.rejects(provider.analyze({ task: "price-action-theory-review", requestId: "synthetic" }));
  assert.equal(calls.length, 1, "native retries and host fallback must both stop on 403");
  assert.equal(calls[0].body.model, "deepseek-flash");
  assert.equal(calls[0].body.reasoning.effort, "max");
  assert.equal(calls[0].headers["x-haolo-model-pool"], "execution");
  assert.equal(calls[0].headers["x-haolo-model-capability"], "root_execution");
});
