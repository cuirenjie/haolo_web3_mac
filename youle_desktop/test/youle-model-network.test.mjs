import assert from "node:assert/strict";
import test from "node:test";
import { YouleApiClient } from "../src/main/youle-api-client.mjs";

test("catalogs, JSON/SSE chat, Gemini and binary media use the injected model transport", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Direct Node networking blocked"); });
  const calls = [];
  const client = new YouleApiClient({ serviceFetch: async () => Response.json({ configured: false, pools: [] }), networkFetch: async (url, init) => {
    assert.equal(Object.hasOwn(init, "fetchImpl"), false);
    const headers = new Headers(init.headers);
    assert.match(headers.get("authorization"), /^Bearer sk-test-/);
    calls.push({ url, init });
    if (url.endsWith("/models")) return Response.json({ data: [{ id: "qwen3.7-plus" }, { id: "gpt-image-2" }] });
    if (url.endsWith("/media/input")) {
      assert.equal(headers.get("content-type"), "video/mp4");
      assert.equal(Buffer.from(init.body).toString(), "test-video");
      return Response.json({ url: "https://haolo.pro/v1/media/input/test" });
    }
    if (url.includes(":generateContent")) return Response.json({ candidates: [{ content: { parts: [{ text: "gemini-ok" }] } }] });
    const payload = JSON.parse(init.body);
    if (payload.stream) return new Response('data: {"choices":[{"delta":{"content":"stream-ok"}}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
    return Response.json({ choices: [{ message: { content: "json-ok" } }] });
  } });
  client.loaded = true;
  client.token = "test-session";
  client.modelApiKey = "sk-test-image";
  client.modelBaseUrl = "https://haolo.pro/v1";
  client.modelKeys = ["qwen", "gemini", "doubao", "codex"].map((provider) => ({ provider, apiKey: `sk-test-${provider}`, baseUrl: "https://haolo.pro/v1" }));
  await client.fetchProviderModelCatalog("qwen", { force: true });
  await client.listImageGenerationModels({ force: true });
  assert.equal((await client.sendProviderChat({ provider: "qwen", text: "test" })).text, "json-ok");
  assert.equal((await client.sendProviderChat({ provider: "qwen", text: "test", stream: true })).text, "stream-ok");
  const attachments = [{ name: "test.mp4", mime: "video/mp4", url: `data:video/mp4;base64,${Buffer.from("test-video").toString("base64")}` }];
  assert.equal((await client.sendProviderChat({ provider: "gemini", model: "gemini-3.5-flash", text: "test", attachments })).text, "gemini-ok");
  await client.sendProviderChat({ provider: "doubao", text: "test", attachments });
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
    "/v1/models", "/v1/models", "/v1/chat/completions", "/v1/chat/completions",
    "/v1beta/models/gemini-3.5-flash:generateContent", "/v1/media/input", "/v1/chat/completions",
  ]);
});

test("a failed paid provider request is not replayed through direct fetch", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected direct replay"); });
  let attempts = 0;
  const client = new YouleApiClient({ networkFetch: async () => { attempts++; throw new Error("net::ERR_CONNECTION_RESET"); } });
  client.loaded = true;
  client.token = "test-session";
  client.modelKeys = [{ provider: "qwen", apiKey: "sk-test", baseUrl: "https://haolo.pro/v1" }];
  await assert.rejects(client.sendProviderChat({ provider: "qwen", text: "test", stream: true }));
  assert.equal(attempts, 1);
});
