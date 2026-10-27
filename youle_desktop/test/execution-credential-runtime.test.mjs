import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AppServerClient } from "../src/main/app-server-client.mjs";
import { failureDiagnosticsFromNotification } from "../src/main/turn-diagnostics.mjs";
import { createProviderSendHost } from "./helpers/provider-send-host.mjs";

const runtime = fileURLToPath(new URL("../resources/bin/haolo_ai.exe", import.meta.url));
test("native missing-token failure recovers on the next send without restarting the desktop or replacing the task", {
  skip: process.platform !== "win32" || !fs.existsSync(runtime), timeout: 45_000,
}, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-credential-recovery-"));
  const cwd = path.join(directory, "workspace"), codexHome = path.join(directory, "runtime"), authPath = path.join(directory, "auth.json");
  fs.mkdirSync(cwd);
  let client, credentialsAvailable = false, requests = 0;
  const events = [], logs = [];
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) { /* Consume the synthetic request. */ }
    requests++;
    const output = [{ type: "message", id: "msg_recovered", role: "assistant", phase: "final_answer", status: "completed",
      content: [{ type: "output_text", text: "Recovered synthetic task.", annotations: [] }] }];
    const stream = [
      { type: "response.created", response: { id: "r_recovered", status: "in_progress", output: [] } },
      { type: "response.output_item.added", output_index: 0, item: { ...output[0], status: "in_progress", content: [] } },
      { type: "response.output_item.done", output_index: 0, item: output[0] },
      { type: "response.completed", response: { id: "r_recovered", status: "completed", output, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } },
    ];
    response.writeHead(200, { "content-type": "text/event-stream", "x-haolo-recovery-billing": "gpt-v1" });
    response.end(stream.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  });
  t.after(async () => {
    await client?.stop();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^haolo-credential-recovery-/);
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 12, retryDelay: 150 });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  fs.writeFileSync(authPath, JSON.stringify({ OPENAI_API_KEY: "sk-local-fixture", LLMHUB_BASE_URL: baseUrl }));
  client = new AppServerClient({ cwd, codexHome, authPath, codexCommand: runtime,
    providerRuntimeResolver: async () => ({ deepSeek: credentialsAvailable ? { apiKey: "sk-local-fixture", baseUrl, billingKeyId: 123 } : null }),
  });
  client.on("notification", (event) => events.push(event));
  client.on("log", (event) => logs.push(event.line));
  client.on("server-request", (message) => client.respondError(message.id, -32601, "No tools in credential test"));
  const terminal = async (turnId) => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const event = events.find((event) => event.method === "turn/completed" && event.params?.turn?.id === turnId);
      if (event) return event;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail(`synthetic turn did not terminate: ${JSON.stringify({ turnId, requests, status: client.status, transport: client.modelTransport, relays: client.modelRequestRelays.length, logs: logs.slice(-12),
      events: events.slice(-12).map((event) => ({ method: event.method, turnId: event.params?.turn?.id || event.params?.turnId, error: event.params?.error })) })}`);
  };
  await client.start();
  assert.equal(client.providerRuntime.deepSeek.available, false);
  const { thread } = await client.request("thread/start", { cwd, model: "deepseek-flash", modelProvider: "deepseek", approvalPolicy: "never", sandbox: "read-only" });
  const { turn } = await client.request("turn/start", { threadId: thread.id, input: [{ type: "text", text: "Synthetic task. Do not use tools.", textElements: [] }] });
  const failed = await terminal(turn.id);
  assert.equal(failed.params.turn.status, "failed");
  assert.match(failureDiagnosticsFromNotification(failed).detail, /Missing environment variable.*HAOLO_DEEPSEEK_EXECUTION_TOKEN/);
  assert.equal(requests, 0);

  credentialsAvailable = true;
  const host = createProviderSendHost({ client, cwd, request: (method, params) => client.request(method, params),
    stop: () => client.stop(), start: () => client.start(),
  });
  const recovered = await host.send({ threadId: thread.id, model: "deepseek-flash", text: "Continue the synthetic task. Do not use tools.", approvalPolicy: "never", sandbox: "read-only" });
  assert.equal((await terminal(recovered.turn.id)).params.turn.status, "completed");
  assert.equal(client.providerRuntime.deepSeek.available, true);
  assert.equal(requests, 1);
  const history = await client.request("thread/read", { threadId: thread.id, includeTurns: true });
  assert.equal(history.thread.id, thread.id);
  assert.equal(history.thread.turns.length, 2);
});
