import assert from "node:assert/strict";
import test from "node:test";
import zlib from "node:zlib";
import { once } from "node:events";
import WebSocket, { WebSocketServer } from "ws";
import { projectModelToolContext } from "../src/main/model-context-projection.mjs";
import { normalizeModelRequestBody } from "../src/main/model-request-policy.mjs";
import { ModelRequestRelay } from "../src/main/model-request-relay.mjs";
import { analysisEvidence } from "../src/main/codex-analysis-evidence.mjs";

// An independent decoder proves every value can be recovered, not merely that
// fewer characters were sent. Never uses disk, another request or an LLM.
function expandDocument(text) {
  const root = JSON.parse(text);
  if (!root.$haolo_context) {
    if (Array.isArray(root.content)) return { ...root, content: root.content.map(block =>
      block.type === "text" ? { ...block, text: JSON.stringify(expandDocument(block.text)) } : block) };
    return root;
  }
  assert.equal(root.$haolo_context.encoding, "same-document-string-references");
  function expand(value) {
    if (!value || typeof value !== "object") return value;
    if (Object.hasOwn(value, "$haolo_same_text")) {
      assert.equal(Object.keys(value).length, 1);
      const parts = value.$haolo_same_text.slice(2).split("/").map(part => part.replace(/~1/g, "/").replace(/~0/g, "~"));
      const literal = parts.reduce((node, part) => node[part], root);
      assert.equal(typeof literal, "string");
      return literal;
    }
    return Array.isArray(value) ? value.map(expand) : Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== "$haolo_context").map(([key, item]) => [key, expand(item)]));
  }
  return expand(root);
}

const report = Array.from({ length: 90 }, (_, i) =>
  `证据 ${i}: BTCUSDT 1h，时间 2026-10-25T00:${String(i % 60).padStart(2, "0")}:00Z；支撑 67123.45，止损 66899.1；未确认突破，当前仓位数据不可用，不可推断没有持仓。`).join("\n");
const evidence = { analysisRef: "analysis-owned-1", analysisKind: "strategy", answerRequired: true,
  result: analysisEvidence({ cloudReports: [{ marketId: "BINANCE:SPOT:BTCUSDT", interval: "1h", strategyId: "price-action", report }],
    marketId: "BINANCE:SPOT:BTCUSDT", interval: "1h", analysisJobId: "job-1" }),
  positionReview: { accountStatus: "unavailable", observedAt: "2026-10-25T00:00:00Z", pending: ["verify existing protective orders"] },
  delivery: "Answer the full question using this evidence; do not claim an order was placed." };
const output = JSON.stringify(evidence);
const request = { model: "deepseek-flash", reasoning: { effort: "low" }, stream: true, prompt_cache_key: "thread-1",
  instructions: "Keep the original request, constraints and evidence.",
  input: [{ role: "user", content: [{ type: "input_text", text: "继续分析同一周期，保留风控条件" }] },
    { type: "function_call", name: "haolo_analysis", call_id: "call-1", arguments: '{"interval":"1h"}' },
    { type: "function_call_output", call_id: "call-1", output }], tools: [{ type: "function", name: "haolo_analysis" }] };

test("real analysis evidence loses only its duplicate report and remains fully reconstructible", () => {
  const original = JSON.stringify(request);
  const { payload, metrics } = projectModelToolContext(request);
  assert.deepEqual(expandDocument(payload.input[2].output), JSON.parse(output));
  assert.ok(metrics.savedBytes > Buffer.byteLength(report) * 0.9);
  assert.ok(metrics.afterBytes < metrics.beforeBytes * 0.55);
  assert.equal(metrics.references, 1);
  assert.equal(metrics.changedOutputs, 1);
  assert.equal(JSON.stringify(request), original);
  assert.equal(payload.input[0], request.input[0]);
  assert.equal(payload.input[1], request.input[1]);
  assert.equal(payload.tools, request.tools);
  assert.equal(payload.instructions, request.instructions);
  assert.equal(payload.input[2].call_id, "call-1");
  assert.equal(projectModelToolContext(payload).payload, payload);
});

test("MCP, text-block tool outputs and Chat tool messages retain roles, images and error status", () => {
  const mcp = JSON.stringify({ content: [{ type: "text", text: output }, { type: "image", data: "opaque", mimeType: "image/png" }], isError: false });
  const messages = [
    { type: "mcp_call", id: "mcp-1", name: "analysis", output: mcp },
    { type: "function_call_output", call_id: "call-2", output: [{ type: "input_text", text: mcp }, { type: "input_image", image_url: "https://example.test/image" }] },
  ];
  const projected = projectModelToolContext({ input: messages }).payload;
  assert.deepEqual(expandDocument(projected.input[0].output), JSON.parse(mcp));
  assert.deepEqual(expandDocument(projected.input[1].output[0].text), JSON.parse(mcp));
  assert.equal(projected.input[1].output[1], messages[1].output[1]);
  assert.equal(projectModelToolContext(projected).payload, projected);
  const chat = projectModelToolContext({ messages: [{ role: "tool", tool_call_id: "a", content: output }, { role: "assistant", content: output }] }).payload;
  assert.deepEqual(expandDocument(chat.messages[0].content), JSON.parse(output));
  assert.equal(chat.messages[1].content, output);
});

test("references are confined to one output: observation identity, timestamps and all differing values survive", () => {
  const changed = JSON.stringify({ ...evidence, result: { report, reports: [{ report: `${report}\nNew invalidation: 66898.9` }] } });
  const input = [output, changed, output].map((text, i) => ({ type: "function_call_output", call_id: `c${i}`, output: text }));
  const projected = projectModelToolContext({ previous_response_id: "response-1", input }).payload;
  for (let i = 0; i < input.length; i++) assert.deepEqual(expandDocument(projected.input[i].output), JSON.parse(input[i].output));
  assert.equal(projected.input[1], input[1]);
  assert.equal(projected.previous_response_id, "response-1");
  assert.equal(projected.input[0].output, projected.input[2].output);
  // Appending another turn cannot rewrite the already cached prefix.
  const extended = projectModelToolContext({ input: [...input, { role: "user", content: "follow-up" }] }).payload;
  assert.deepEqual(extended.input.slice(0, input.length), projected.input);
});

test("JSON Pointer escapes, Unicode, unknown fields and prototype-like keys round trip exactly", () => {
  const input = JSON.stringify({ "~/": report, "a/b": [report, { observedAt: "now", value: 0, enabled: false }],
    unknown: { nested: report }, ...JSON.parse('{"__proto__":{"unchanged":true}}') });
  const { payload } = projectModelToolContext({ input: [{ type: "function_call_output", output: input }] });
  assert.deepEqual(expandDocument(payload.input[0].output), JSON.parse(input));
  assert.equal({}.unchanged, undefined);
});

test("invalid, already encoded, excessive nesting and arbitrary user/assistant text are left alone", () => {
  let deep = { a: report, b: report };
  for (let i = 0; i < 90; i++) deep = { next: deep };
  for (const text of ["not json", JSON.stringify([report, report]), JSON.stringify({ a: report, b: report, nested: { $haolo_same_text: "original user value" } }), JSON.stringify(deep)]) {
    const payload = { input: [{ type: "function_call_output", output: text }] };
    assert.equal(projectModelToolContext(payload).payload, payload);
  }
  const payload = { instructions: output, input: [{ role: "user", content: output }, { role: "assistant", content: output },
    { type: "function_call", arguments: output }, { type: "reasoning", encrypted_content: output }] };
  assert.equal(projectModelToolContext(payload).payload, payload);
});

for (const format of ["identity", "gzip", "deflate", "br", "zstd"]) {
  test(`actual wire normalization projects managed requests with ${format} and respects opt-out`, () => {
    const compress = { identity: v => v, gzip: zlib.gzipSync, deflate: zlib.deflateSync, br: zlib.brotliCompressSync, zstd: zlib.zstdCompressSync }[format];
    const decompress = { identity: v => v, gzip: zlib.gunzipSync, deflate: zlib.inflateSync, br: zlib.brotliDecompressSync, zstd: zlib.zstdDecompressSync }[format];
    const original = compress(Buffer.from(JSON.stringify(request)));
    let metric;
    const normalized = normalizeModelRequestBody(original, format, 1e7, null, true, { onMetrics: m => { metric = m; } });
    assert.deepEqual(expandDocument(JSON.parse(decompress(normalized)).input[2].output), JSON.parse(output));
    assert.ok(metric.savedBytes > 0);
    assert.deepEqual(Object.keys(metric), ["version", "changedOutputs", "references", "beforeBytes", "afterBytes", "savedBytes"]);
    for (const [managed, options] of [[false, {}], [true, { enabled: false }]]) {
      const raw = normalizeModelRequestBody(original, format, 1e7, null, managed, options);
      assert.deepEqual(JSON.parse(decompress(raw)), request);
    }
  });
}

test("HTTP compatibility and generic WebSocket projection each preserve complete tool evidence", async t => {
  const received = [], metrics = [];
  const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(upstream, "listening");
  upstream.on("connection", socket => socket.on("message", raw => { received.push(JSON.parse(String(raw))); socket.send('{"type":"response.completed"}'); }));
  const relay = new ModelRequestRelay({ upstreamBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
    WebSocketImpl: WebSocket, managedAnalysis: true, minCompressBytes: 1e7,
    fetch: async (_url, init) => { received.push(JSON.parse(Buffer.from(init.body).toString())); return new Response('data: {"type":"response.completed"}\n\n', { headers: { "content-type": "text/event-stream" } }); } });
  t.after(async () => { await relay.stop(); for (const s of upstream.clients) s.terminate(); await new Promise(r => upstream.close(r)); });
  relay.on("context-projection", m => metrics.push(m));
  await relay.start();
  const response = await fetch(`${relay.localBaseUrl()}/responses`, { method: "POST", body: JSON.stringify(request) });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /response.completed/);
  const socket = new WebSocket(`${relay.localBaseUrl().replace("http:", "ws:")}/responses`);
  await once(socket, "open");
  const reply = once(socket, "message");
  socket.send(JSON.stringify({ type: "response.create", response: request }));
  await reply;
  assert.equal(received.length, 2);
  // DeepSeek HTTP also reframes old calls lacking native reasoning. The
  // generic WebSocket projection retains its native envelope (production
  // DeepSeek providers explicitly disable WebSockets).
  assert.deepEqual(expandDocument(received[1].response.input[2].output), JSON.parse(output));
  const historyText = received[0].input[2].content[0].text;
  const historicalResult = JSON.parse(historyText.slice(historyText.indexOf("\n") + 1));
  assert.equal(historicalResult.type, "function_call_output");
  assert.equal(historicalResult.call_id, "call-1");
  assert.deepEqual(expandDocument(historicalResult.output), JSON.parse(output));
  assert.equal(metrics.length, 2);
  assert.ok(metrics.every(m => m.savedBytes > 0));
  socket.close();
});
