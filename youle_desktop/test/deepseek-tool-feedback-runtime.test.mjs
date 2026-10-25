import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { AppServerClient } from "../src/main/app-server-client.mjs";

const runtime = fileURLToPath(new URL(process.platform === "darwin" ? `../resources/bin/darwin-${process.arch}/haolo_ai` : "../resources/bin/haolo_ai.exe", import.meta.url));
const reasoning = id => ({ type: "reasoning", id: `rs_${id}`, content: [{ type: "reasoning_text", text: "Use completed synthetic evidence." }], summary: [] });
const call = (name, id) => ({ type: "function_call", id: `fc_${id}`, call_id: `call_${id}`, name, status: "completed", arguments: '{"symbol":"ETHUSDT"}' });
const answer = id => ({ type: "message", id: `msg_${id}`, role: "assistant", phase: "final_answer", status: "completed", content: [{ type: "output_text", text: "Completed using receipt synthetic-one; quantity 2. The unavailable call did not execute.", annotations: [] }] });
function reply(response, output, n) {
  const events = [{ type: "response.created", response: { id: `r_${n}`, status: "in_progress", output: [] } }];
  for (const [output_index, item] of output.entries()) events.push(
    { type: "response.output_item.added", output_index, item: { ...item, status: "in_progress", ...(item.type === "function_call" ? { arguments: "" } : { content: [] }) } },
    ...(item.type === "function_call" ? [{ type: "response.function_call_arguments.delta", item_id: item.id, output_index, delta: item.arguments }] : []),
    { type: "response.output_item.done", output_index, item });
  events.push({ type: "response.completed", response: { id: `r_${n}`, status: "completed", output, usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } } });
  response.writeHead(200, { "content-type": "text/event-stream", "x-haolo-recovery-billing": "gpt-v1" });
  response.end(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(""));
}

for (const mode of ["after-business", "parallel", "refuses-repair", "cancel-repair"]) test(`native unavailable-tool feedback: ${mode}; no business replay`, {
  skip: !["win32", "darwin"].includes(process.platform) || !fs.existsSync(runtime), timeout: 45_000,
}, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-feedback-runtime-"));
  const cwd = path.join(directory, "workspace"), codexHome = path.join(directory, "runtime"), authPath = path.join(directory, "auth.json");
  fs.mkdirSync(cwd);
  let client, stage = 0, operationCount = 0, toolName;
  const requests = [], notifications = [], failures = [];
  const server = http.createServer(async (request, response) => {
    try {
      const chunks = [];for await (const chunk of request) chunks.push(chunk);
      const raw = Buffer.concat(chunks), decode = { gzip: zlib.gunzipSync, zstd: zlib.zstdDecompressSync }[request.headers["content-encoding"]];
      const payload = JSON.parse((decode ? decode(raw) : raw).toString());requests.push(payload);
      const n = requests.length;
      if (stage === 0) {
        assert.notEqual(payload.tool_choice, "none");
        assert.equal(client.toolRecoveryStates.get(payload.prompt_cache_key)?.answerOnly, false);
        toolName = payload.tools.find(tool => tool.name?.includes("synthetic_business_operation"))?.name;
        assert.ok(toolName, "native dynamic business tool was not declared");
        stage = mode === "parallel" ? 2 : 1;
        reply(response, [reasoning(n), call(toolName, n), ...(mode === "parallel" ? [call("haolo_not_needed", `${n}_bad`)] : [])], n);
      } else if (stage === 1) {
        assert.equal(operationCount, 1);
        assert.ok(JSON.stringify(payload.input).includes("synthetic-one"));
        stage = 2;reply(response, [reasoning(n), call("haolo_not_needed", n)], n);
      } else {
        assert.equal(stage, 2, "repair must not loop");stage = 3;
        assert.equal(operationCount, 1);assert.equal(payload.tool_choice, "none");assert.deepEqual(payload.tools, []);
        assert.equal(client.toolRecoveryStates.get(payload.prompt_cache_key)?.answerOnly, true);
        const input = JSON.stringify(payload.input);
        assert.ok(input.includes("HAOLO_TOOL_NOT_EXECUTED"));assert.ok(input.includes("synthetic-one"));
        assert.match(input, /unsupported|unknown|not found/i);
        if (mode === "cancel-repair") {
          response.writeHead(200, { "content-type": "text/event-stream", "x-haolo-recovery-billing": "gpt-v1" });
          response.write(`data: ${JSON.stringify({ type: "response.created", response: { id: `r_${n}`, status: "in_progress", output: [] } })}\n\n`);
        } else reply(response, [reasoning(n), mode === "refuses-repair" ? call(toolName, `${n}_replay`) : answer(n)], n);
      }
    } catch (error) { failures.push(error.stack);response.writeHead(500).end("fixture failure"); }
  });
  t.after(async () => {
    await client?.stop();server.closeAllConnections();await new Promise(r => server.close(r));
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));assert.match(path.basename(directory), /^haolo-feedback-runtime-/);
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 12, retryDelay: 150 });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  fs.writeFileSync(authPath, JSON.stringify({ OPENAI_API_KEY: "sk-local-fixture", LLMHUB_BASE_URL: baseUrl }));
  client = new AppServerClient({ cwd, codexHome, authPath, codexCommand: runtime, providerRuntimeResolver: async () => ({ deepSeek: { apiKey: "sk-local-fixture", baseUrl, billingKeyId: 123 } }) });
  client.on("notification", event => notifications.push(event));
  client.on("server-request", message => {
    if (message.method !== "item/tool/call") return client.respondError(message.id, -32601, "Unsupported test request");
    assert.equal(message.params.tool, "synthetic_business_operation");operationCount++;
    client.respond(message.id, { success: true, contentItems: [{ type: "inputText", text: JSON.stringify({ receipt: "synthetic-one", quantity: 2 }) }] });
  });
  await client.start();
  const { thread } = await client.request("thread/start", { cwd, approvalPolicy: "never", sandbox: "read-only", dynamicTools: [{ type: "function", name: "synthetic_business_operation", description: "Synthetic test operation", inputSchema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } }] });
  const run = async () => {
    const { turn } = await client.request("turn/start", { threadId: thread.id, input: [{ type: "text", text: "Perform the synthetic operation once, then summarize.", textElements: [] }] });
    const deadline = Date.now() + 15_000;
    let interrupted = false;
    for (;;) {
      const event = notifications.find(e => e.method === "turn/completed" && e.params.turn.id === turn.id);
      if (event) return event.params.turn;
      if (mode === "cancel-repair" && stage === 3 && !interrupted) { interrupted = true;await client.request("turn/interrupt", { threadId: thread.id, turnId: turn.id }); }
      assert.ok(Date.now() < deadline, JSON.stringify({ failures, requests: requests.length }));await new Promise(r => setTimeout(r, 10));
    }
  };
  const result = await run();
  assert.deepEqual(failures, []);
  assert.equal(result.status, mode === "refuses-repair" ? "failed" : mode === "cancel-repair" ? "interrupted" : "completed", JSON.stringify(result.error));
  assert.equal(operationCount, 1);assert.equal(requests.length, mode === "parallel" ? 2 : 3);
  assert.ok(!client.toolRecoveryStates.has(thread.id));
  if (mode === "after-business") {
    stage = 0;operationCount = 0;
    assert.equal((await run()).status, "completed", "new user turn must regain its normal tools");
    assert.equal(operationCount, 1);
  }
});
