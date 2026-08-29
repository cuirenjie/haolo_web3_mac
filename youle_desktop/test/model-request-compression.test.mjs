import assert from "node:assert/strict";
import test from "node:test";
import zlib from "node:zlib";
import {
  isModelInferenceRequestUrl,
  prepareCompressedModelRequest,
} from "../src/main/model-request-compression.mjs";

test("large model JSON requests use zstd and remain byte-for-byte reversible", async () => {
  const body = JSON.stringify({
    model: "deepseek-v4-flash",
    input: "stable-context\n".repeat(20_000),
  });
  const result = await prepareCompressedModelRequest(
    "https://relay.example.test/v1/responses",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      },
      body,
    },
  );

  assert.equal(result.compression.applied, true);
  assert.equal(result.compression.encoding, "zstd");
  assert.equal(result.init.headers.get("content-encoding"), "zstd");
  assert.equal(result.init.headers.has("content-length"), false);
  assert.ok(result.compression.wireBytes < result.compression.originalBytes * 0.2);
  assert.equal(zlib.zstdDecompressSync(result.init.body).toString("utf8"), body);
});
test("small, unrelated, disabled, and already encoded requests stay untouched", async () => {
  const small = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: "small" }),
  };
  const belowThreshold = await prepareCompressedModelRequest(
    "https://relay.example.test/v1/chat/completions",
    small,
  );
  assert.equal(belowThreshold.compression.reason, "below-threshold");
  assert.equal(belowThreshold.init, small);

  const unrelated = await prepareCompressedModelRequest(
    "https://relay.example.test/api/profile/me",
    { ...small, body: "x".repeat(100_000) },
  );
  assert.equal(unrelated.compression.reason, "not-model-request");

  const disabled = await prepareCompressedModelRequest(
    "https://relay.example.test/v1/responses",
    { ...small, body: "x".repeat(100_000) },
    { env: { HAOLO_DESKTOP_MODEL_REQUEST_COMPRESSION: "0" } },
  );
  assert.equal(disabled.compression.reason, "disabled");

  const encoded = await prepareCompressedModelRequest(
    "https://relay.example.test/v1/responses",
    {
      ...small,
      headers: {
        "content-type": "application/json",
        "content-encoding": "br",
      },
      body: "x".repeat(100_000),
    },
  );
  assert.equal(encoded.compression.reason, "already-encoded");
});

test("model request URL detection covers Responses, Chat Completions, and Gemini", () => {
  assert.equal(isModelInferenceRequestUrl("https://example.test/v1/responses"), true);
  assert.equal(isModelInferenceRequestUrl("https://example.test/v1/chat/completions"), true);
  assert.equal(
    isModelInferenceRequestUrl("https://example.test/v1beta/models/gemini:streamGenerateContent"),
    true,
  );
  assert.equal(isModelInferenceRequestUrl("https://example.test/api/profile/me"), false);
});
