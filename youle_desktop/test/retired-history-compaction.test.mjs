import assert from "node:assert/strict";
import test from "node:test";
import zlib from "node:zlib";
import { once } from "node:events";
import WebSocket, { WebSocketServer } from "ws";
import { normalizeModelRequestBody } from "../src/main/model-request-policy.mjs";
import { ModelRequestRelay } from "../src/main/model-request-relay.mjs";
import { AppServerClient } from "../src/main/app-server-client.mjs";

const payload = { model: "gpt-5.5", prompt_cache_key: "old-thread", stream: true,
  input: [{ role: "user", content: [{ type: "input_text", text: "Preserve old gpt-5.5 conversation and BTC 1h request." }] }],
  reasoning: { effort: "xhigh", summary: "auto" }, tools: [] };
const resolve = id => id === "old-thread" ? { model: "gpt-5.6-sol", effort: "low" } : undefined;

for (const format of ["identity", "gzip", "deflate", "br", "zstd"]) {
  test(`internal old-model compaction migrates only a known thread (${format})`, () => {
    const compress = { identity: x => x, gzip: zlib.gzipSync, deflate: zlib.deflateSync, br: zlib.brotliCompressSync, zstd: zlib.zstdCompressSync }[format];
    const decompress = { identity: x => x, gzip: zlib.gunzipSync, deflate: zlib.inflateSync, br: zlib.brotliDecompressSync, zstd: zlib.zstdDecompressSync }[format];
    const original = compress(Buffer.from(JSON.stringify(payload)));
    assert.throws(() => normalizeModelRequestBody(original, format), { code: "MODEL_RETIRED" });
    const result = JSON.parse(decompress(normalizeModelRequestBody(original, format, 1e6, resolve)));
    assert.deepEqual(result, { ...payload, model: "gpt-5.6-sol", reasoning: { ...payload.reasoning, effort: "low" } });
    assert.equal(payload.model, "gpt-5.5");
    assert.throws(() => normalizeModelRequestBody(JSON.stringify({ ...payload, prompt_cache_key: "other" }), "", 1e6, resolve), { code: "MODEL_RETIRED" });
  });
}

test("RPC registers the selected model before compaction, cannot register a retired selection, and clears closed threads", async () => {
  const client = new AppServerClient();
  client.ws = { readyState: WebSocket.OPEN, send: raw => {
    const p = JSON.parse(raw);
    assert.deepEqual(client.historyModelSelections.get("old-thread"), { model: "deepseek-flash", effort: "max" });
    const pending = client.pending.get(p.id); clearTimeout(pending.timer); client.pending.delete(p.id); pending.resolve({});
  } };
  await client.requestRaw("turn/start", { threadId: "old-thread", model: "deepseek-flash" });
  await assert.rejects(client.requestRaw("turn/start", { threadId: "other", model: "gpt-5.5" }), { code: "MODEL_RETIRED" });
  assert.equal(client.historyModelSelections.has("other"), false);
  // A settings-only update uses the same wire migration without touching input.
  const result = JSON.parse(normalizeModelRequestBody(JSON.stringify(payload), "", 1e6, id => client.historyModelSelections.get(id)));
  assert.equal(result.model, "deepseek-flash"); assert.equal(result.reasoning.effort, "max");
  client.handleMessage(JSON.stringify({ method: "thread/closed", params: { threadId: "old-thread" } }));
  assert.equal(client.historyModelSelections.has("old-thread"), false);
});

test("HTTP and WebSocket relay use the same history migration and preserve the conversation payload", async t => {
  const received = [];
  const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(upstream, "listening");
  upstream.on("connection", socket => socket.on("message", raw => { received.push(JSON.parse(String(raw))); socket.send('{"type":"response.completed"}'); }));
  const relay = new ModelRequestRelay({ upstreamBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
    WebSocketImpl: WebSocket, resolveHistoryModel: resolve,
    fetch: async (_url, init) => { received.push(JSON.parse(Buffer.from(init.body).toString())); return new Response('{"ok":true}'); },
    minCompressBytes: 1e6 });
  t.after(async () => { await relay.stop(); for (const s of upstream.clients) s.terminate(); await new Promise(r => upstream.close(r)); });
  await relay.start();
  const response = await fetch(`${relay.localBaseUrl()}/responses`, { method: "POST", body: JSON.stringify(payload) });
  assert.equal(response.status, 200);
  const socket = new WebSocket(`${relay.localBaseUrl().replace("http:", "ws:")}/responses`);
  await once(socket, "open");
  const reply = once(socket, "message");
  socket.send(JSON.stringify({ type: "response.create", response: payload })); await reply;
  assert.equal(received[0].model, "gpt-5.6-sol");
  assert.deepEqual(received[1].response, received[0]);
  socket.close();
});
