import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { AppServerClient } from "../src/main/app-server-client.mjs";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-model-transport-smoke-"));
const workspace = path.join(tempRoot, "workspace");
const codexHome = path.join(tempRoot, "codex-home");
const authPath = path.join(tempRoot, "auth.json");
const codexCommand = path.resolve("resources", "bin", process.platform === "win32" ? "haolo_ai.exe" : "haolo_ai");
const promptMarker = "HAOLO_MODEL_TRANSPORT_SMOKE_MARKER";
const largePrompt = `${promptMarker}\n${"compression validation payload ".repeat(18_000)}`;

fs.mkdirSync(workspace, { recursive: true });

let resolveCaptured;
let rejectCaptured;
const capturedRequest = new Promise((resolve, reject) => {
  resolveCaptured = resolve;
  rejectCaptured = reject;
});

const upstream = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("error", rejectCaptured);
  request.on("end", () => {
    try {
      const wireBody = Buffer.concat(chunks);
      const encoding = String(request.headers["content-encoding"] || "").toLowerCase();
      const decodedBody = encoding === "zstd" ? zstdDecompressSync(wireBody) : wireBody;
      resolveCaptured({
        encoding,
        headers: request.headers,
        pathname: new URL(request.url, "http://127.0.0.1").pathname,
        wireBytes: wireBody.byteLength,
        decodedBytes: decodedBody.byteLength,
        body: decodedBody.toString("utf8"),
      });
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      response.end(
        `data: ${JSON.stringify({
          type: "response.completed",
          response: {
            id: "resp_haolo_transport_smoke",
            object: "response",
            status: "completed",
            model: "deepseek-v4-flash",
            output: [],
            usage: {
              input_tokens: 1,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 1,
              output_tokens_details: { reasoning_tokens: 0 },
              total_tokens: 2,
            },
          },
        })}\n\n`,
      );
    } catch (error) {
      rejectCaptured(error);
      response.writeHead(500).end();
    }
  });
});

await new Promise((resolve, reject) => {
  upstream.once("error", reject);
  upstream.listen(0, "127.0.0.1", resolve);
});
const upstreamAddress = upstream.address();
assert.equal(typeof upstreamAddress, "object");
const upstreamBaseUrl = `http://127.0.0.1:${upstreamAddress.port}/v1`;
fs.writeFileSync(
  authPath,
  `${JSON.stringify({ OPENAI_API_KEY: "sk-local-smoke-test", LLMHUB_BASE_URL: upstreamBaseUrl }, null, 2)}\n`,
  "utf8",
);

const client = new AppServerClient({
  cwd: workspace,
  codexCommand,
  codexHome,
  authPath,
  providerRuntimeResolver: async () => ({
    deepSeek: {
      apiKey: "sk-local-deepseek-smoke-test",
      baseUrl: upstreamBaseUrl,
    },
  }),
});
client.on("server-request", (message) => {
  client.respondError(message.id, -32601, `unsupported smoke-test server request: ${message.method}`);
});
client.on("log", (entry) => {
  if (/model-transport/i.test(entry.line)) console.log(entry.line);
});

try {
  const status = await client.start();
  assert.equal(status.modelTransport?.enabled, true);
  const threadResult = await client.request("thread/start", {
    cwd: workspace,
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: true,
    model: "deepseek-v4-flash",
    modelProvider: "deepseek",
  });
  const threadId = threadResult?.thread?.id;
  assert.ok(threadId);
  await client.request("turn/start", {
    threadId,
    input: [{ type: "text", text: largePrompt, textElements: [] }],
    cwd: workspace,
    model: "deepseek-v4-flash",
    modelProvider: "deepseek",
    approvalPolicy: "never",
    sandboxPolicy: { type: "readOnly" },
  });
  const request = await Promise.race([
    capturedRequest,
    new Promise((_, reject) => setTimeout(() => reject(new Error("model request was not captured within 30 seconds")), 30_000)),
  ]);
  assert.equal(request.pathname, "/v1/responses");
  assert.equal(request.encoding, "zstd");
  assert.equal(request.headers["x-haolo-client-transport"], "loopback-compression-relay");
  assert.match(request.body, new RegExp(promptMarker));
  assert.ok(request.wireBytes < request.decodedBytes * 0.2);
  console.log(
    `signed runtime smoke ok: ${request.decodedBytes} -> ${request.wireBytes} bytes (${Math.round((1 - request.wireBytes / request.decodedBytes) * 100)}% saved)`,
  );
} finally {
  await client.stop().catch(() => {});
  await new Promise((resolve) => upstream.close(resolve));
  let cleanupError = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      cleanupError = null;
      break;
    } catch (error) {
      cleanupError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  if (cleanupError) {
    console.warn(`temporary smoke directory will be cleaned by the OS: ${cleanupError.message}`);
  }
}
