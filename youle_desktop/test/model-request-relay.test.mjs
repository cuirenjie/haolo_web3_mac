import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import zlib from "node:zlib";
import { ModelRequestRelay } from "../src/main/model-request-relay.mjs";

test("loopback model relay compresses large JSON, preserves SSE, and reuses upstream connections", async () => {
  const requests = [];
  const upstreamSockets = new Set();
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const wireBody = Buffer.concat(chunks);
    const encoding = String(request.headers["content-encoding"] || "");
    const decodedBody = encoding === "zstd"
      ? zlib.zstdDecompressSync(wireBody)
      : wireBody;
    upstreamSockets.add(request.socket.remotePort);
    requests.push({
      url: request.url,
      headers: request.headers,
      wireBody,
      decodedBody,
    });
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    response.end("data: {\"type\":\"response.completed\"}\n\n");
  });
  await listen(upstream);
  const upstreamAddress = upstream.address();
  const relay = new ModelRequestRelay({
    upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/v1`,
    minCompressBytes: 512,
  });
  const metrics = [];
  relay.on("request-metrics", (value) => metrics.push(value));
  await relay.start();

  try {
    const largeBody = JSON.stringify({ input: "repeatable-context".repeat(10_000) });
    const firstResponse = await fetch(`${relay.localBaseUrl()}/responses?trace=one`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: largeBody,
    });
    assert.equal(firstResponse.status, 200);
    assert.match(await firstResponse.text(), /response\.completed/);

    const smallBody = JSON.stringify({ input: "small" });
    const secondResponse = await fetch(`${relay.localBaseUrl()}/responses?trace=two`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: smallBody,
    });
    assert.equal(secondResponse.status, 200);
    await secondResponse.text();

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, "/v1/responses?trace=one");
    assert.equal(requests[0].headers.authorization, "Bearer test-token");
    assert.equal(requests[0].headers["content-encoding"], "zstd");
    assert.equal(requests[0].headers["accept-encoding"], "identity");
    assert.equal(requests[0].headers["x-haolo-client-transport"], "loopback-compression-relay");
    assert.equal(requests[0].decodedBody.toString("utf8"), largeBody);
    assert.ok(requests[0].wireBody.byteLength < Buffer.byteLength(largeBody) * 0.2);
    assert.equal(requests[1].headers["content-encoding"], undefined);
    assert.equal(requests[1].decodedBody.toString("utf8"), smallBody);
    assert.equal(upstreamSockets.size, 1);
    assert.equal(metrics.length, 2);
    assert.equal(metrics[0].compression.applied, true);
    assert.equal(metrics[1].compression.reason, "below-threshold");
  } finally {
    await relay.stop();
    await close(upstream);
  }
});

test("loopback model relay rejects paths outside the configured upstream prefix", async () => {
  const upstream = http.createServer((_request, response) => response.end("unexpected"));
  await listen(upstream);
  const upstreamAddress = upstream.address();
  const relay = new ModelRequestRelay({
    upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/v1`,
  });
  await relay.start();
  try {
    const response = await fetch(`http://127.0.0.1:${relay.port}/admin/accounts`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "MODEL_RELAY_ROUTE_NOT_FOUND");
  } finally {
    await relay.stop();
    await close(upstream);
  }
});

test("loopback model relay retries an unsupported encoding once and remembers the route capability", async () => {
  const requests = [];
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({
      encoding: request.headers["content-encoding"],
      body: Buffer.concat(chunks),
    });
    if (requests.length === 1) {
      response.writeHead(415, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unsupported content encoding" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await listen(upstream);
  const upstreamAddress = upstream.address();
  const relay = new ModelRequestRelay({
    upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/v1`,
    minCompressBytes: 512,
  });
  const metrics = [];
  relay.on("request-metrics", (value) => metrics.push(value));
  await relay.start();

  try {
    const body = JSON.stringify({ input: "compatibility-context".repeat(10_000) });
    for (let index = 0; index < 2; index += 1) {
      const response = await fetch(`${relay.localBaseUrl()}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      assert.equal(response.status, 200);
      await response.text();
    }

    assert.equal(requests.length, 3);
    assert.equal(requests[0].encoding, "zstd");
    assert.equal(requests[1].encoding, undefined);
    assert.equal(requests[1].body.toString("utf8"), body);
    assert.equal(requests[2].encoding, undefined);
    assert.equal(requests[2].body.toString("utf8"), body);
    assert.equal(metrics[0].compression.fallbackApplied, true);
    assert.equal(metrics[1].compression.reason, "disabled");
  } finally {
    await relay.stop();
    await close(upstream);
  }
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}
