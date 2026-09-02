import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import {
  YouleApiClient,
  YouleAuthContractError,
  isYouleAuthExpiredError,
  normalizeBusinessModelPools,
} from "../src/main/youle-api-client.mjs";

async function tempDir(name) {
  const dir = path.join(os.tmpdir(), `youle-api-client-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
  };
}

function labAccessToken(expSeconds, extra = {}) {
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds, ...extra }), "utf8").toString("base64url");
  return `${payload}.test-signature`;
}

function jwtAccessToken(expSeconds, extra = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }), "utf8").toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds, ...extra }), "utf8").toString("base64url");
  return `${header}.${payload}.test-signature`;
}

test("desktop support handoff is requested with authenticated client headers", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, init = {}) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({
      ticket: `hdw1.${"a".repeat(64)}`,
      expires_in: 120,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const client = new YouleApiClient({ platform: "win32" });
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "desktop-access-token";

    const handoff = await client.createDesktopWebHandoff();

    assert.equal(request.url, "https://haolo.example/api/auth/desktop-handoff");
    assert.equal(request.init.method, "POST");
    assert.equal(request.init.headers.Authorization, "Bearer desktop-access-token");
    assert.equal(request.init.headers["X-Youle-Client"], "windows-desktop");
    assert.equal(request.init.headers["content-type"], "application/json");
    assert.equal(request.init.body, "{}");
    assert.deepEqual(handoff, { ticket: `hdw1.${"a".repeat(64)}`, expiresIn: 120 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Claude provider uses its dedicated transit key and stable public model alias", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, init = {}) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({
      model: "claude-sonnet-5",
      choices: [{ message: { content: "Reviewed safely." } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "codex", apiKey: "sk-codex-user", baseUrl: "https://transit.example/v1" },
      { provider: "claude", apiKey: "sk-claude-user", baseUrl: "https://transit.example/v1" },
    ];

    const result = await client.sendProviderChat({ provider: "claude", text: "Review this change" });
    const body = JSON.parse(request.init.body);

    assert.equal(request.url, "https://transit.example/v1/chat/completions");
    assert.equal(request.init.headers.Authorization, "Bearer sk-claude-user");
    assert.equal(body.model, "claude-sonnet-5");
    assert.equal(Object.hasOwn(body, "reasoning_effort"), false);
    assert.equal(body.stream, false);
    assert.equal(result.provider, "claude");
    assert.equal(result.text, "Reviewed safely.");
    assert.deepEqual(client.sessionSummary().modelProviders, ["codex", "claude"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Codex provider uses the supported GPT-5.6 Terra alias by default", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, init = {}) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({
      model: "gpt-5.6-terra",
      choices: [{ message: { content: "Hello from Terra" } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "codex", apiKey: "sk-codex-user", baseUrl: "https://transit.example/v1" },
    ];

    const result = await client.sendProviderChat({ provider: "gpt", text: "Hello" });
    const body = JSON.parse(request.init.body);

    assert.equal(request.url, "https://transit.example/v1/chat/completions");
    assert.equal(body.model, "gpt-5.6-terra");
    assert.equal(Object.hasOwn(body, "service_tier"), false);
    assert.equal(body.reasoning_effort, "low");
    assert.deepEqual(body.messages, [{ role: "user", content: "Hello" }]);
    assert.equal(result.provider, "codex");
    assert.equal(result.model, "gpt-5.6-terra");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("large provider chats are zstd-compressed before leaving the desktop main process", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, init = {}) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({
      model: "deepseek-v4-flash",
      choices: [{ message: { content: "Compressed request accepted." } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "deepseek", apiKey: "sk-deepseek-user", baseUrl: "https://transit.example/v1" },
    ];
    const text = "stable historical context\n".repeat(10_000);

    const result = await client.sendProviderChat({ provider: "deepseek", text });
    const headers = new Headers(request.init.headers);
    const decoded = JSON.parse(zlib.zstdDecompressSync(request.init.body).toString("utf8"));

    assert.equal(request.url, "https://transit.example/v1/chat/completions");
    assert.equal(headers.get("authorization"), "Bearer sk-deepseek-user");
    assert.equal(headers.get("content-encoding"), "zstd");
    assert.equal(decoded.messages[0].content, text.trim());
    assert.equal(result.text, "Compressed request accepted.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider chat falls back once when a route rejects compressed requests", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (requests.length === 1) {
      return new Response(JSON.stringify({ error: { message: "unsupported content encoding" } }), {
        status: 415,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      model: "deepseek-v4-flash",
      choices: [{ message: { content: "Fallback accepted." } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.token = "haolo-session-token";
    client.modelKeys = [
      {
        provider: "deepseek",
        apiKey: "sk-deepseek-user",
        baseUrl: "https://compression-unsupported.example/v1",
      },
    ];
    const text = "fallback historical context\n".repeat(10_000);

    const result = await client.sendProviderChat({ provider: "deepseek", text });
    const firstHeaders = new Headers(requests[0].init.headers);
    const retryHeaders = new Headers(requests[1].init.headers);

    assert.equal(requests.length, 2);
    assert.equal(firstHeaders.get("content-encoding"), "zstd");
    assert.equal(retryHeaders.get("content-encoding"), null);
    assert.equal(JSON.parse(requests[1].init.body).messages[0].content, text.trim());
    assert.equal(result.text, "Fallback accepted.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider chat sends uploaded images as real multimodal content", async () => {
  const originalFetch = globalThis.fetch;
  const dir = await tempDir("provider-image-input");
  const imagePath = path.join(dir, "proof.png");
  await writeFile(imagePath, Buffer.from("89504e470d0a1a0a", "hex"));
  let request = null;
  globalThis.fetch = async (url, init = {}) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({
      model: "gpt-5.6-terra",
      choices: [{ message: { content: "I can see the image." } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "codex", apiKey: "sk-codex-user", baseUrl: "https://transit.example/v1" },
    ];
    const result = await client.sendProviderChat({
      provider: "codex",
      model: "gpt-5.6-terra",
      text: "Read this image",
      messages: [{ role: "user", content: "Read this image" }],
      attachments: [{
        name: "proof.png",
        mime: "image/png",
        local_path: imagePath,
      }],
    });
    const body = JSON.parse(request.init.body);
    assert.equal(request.url, "https://transit.example/v1/chat/completions");
    assert.equal(body.messages.length, 1);
    assert.deepEqual(body.messages[0].content[0], { type: "text", text: "Read this image" });
    assert.equal(body.messages[0].content[1].type, "image_url");
    assert.match(body.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
    assert.equal(result.text, "I can see the image.");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("Codex provider automatically sends medium for simple work and max for intensive work", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      model: "gpt-5.6-terra",
      choices: [{ message: { content: "Done" } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "codex", apiKey: "sk-codex-user", baseUrl: "https://transit.example/v1" },
    ];

    await client.sendProviderChat({
      provider: "codex",
      model: "gpt-5.6-terra",
      text: "把按钮文案改成保存，并更新对应测试",
    });
    await client.sendProviderChat({
      provider: "codex",
      model: "gpt-5.6-sol",
      text: "重构整个权限系统并完成安全审计和生产迁移",
    });

    assert.equal(JSON.parse(requests[0].init.body).reasoning_effort, "medium");
    assert.equal(JSON.parse(requests[1].init.body).reasoning_effort, "max");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider chat preserves the WEB3 membership-expired error for the UI", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    code: "MEMBERSHIP_EXPIRED",
    message: "会员到期",
  }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "codex", apiKey: "sk-codex-user", baseUrl: "https://transit.example/v1" },
    ];

    await assert.rejects(
      client.sendProviderChat({ provider: "gpt", text: "Hello" }),
      (error) => error?.status === 403
        && error?.code === "MEMBERSHIP_EXPIRED"
        && error?.message === "会员到期"
        && error?.retryable === false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider chat preserves the paid-trial requirement for the UI", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    code: "TRIAL_REQUIRED",
    message: "请先开通体验版或其他套餐",
  }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "codex", apiKey: "sk-codex-user", baseUrl: "https://transit.example/v1" },
    ];

    await assert.rejects(
      client.sendProviderChat({ provider: "gpt", text: "Hello" }),
      (error) => error?.status === 403
        && error?.code === "TRIAL_REQUIRED"
        && error?.message === "请先开通体验版或其他套餐"
        && error?.retryable === false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("internal low-latency provider requests can hold reasoning at low", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  globalThis.fetch = async (_url, init = {}) => {
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      model: "gpt-5.6-sol",
      choices: [{ message: { content: "Fast answer" } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "codex", apiKey: "sk-codex-user", baseUrl: "https://transit.example/v1" },
    ];
    await client.sendProviderChat({
      provider: "codex",
      model: "gpt-5.6-sol",
      text: "重构整个权限系统并完成安全审计和生产迁移",
      fixedReasoningEffort: "low",
      messages: [
        { role: "developer", content: "Answer only from the current public question." },
        { role: "user", content: "重构整个权限系统并完成安全审计和生产迁移" },
      ],
    });
    assert.equal(requestBody.reasoning_effort, "low");
    assert.equal(requestBody.service_tier, "priority");
    assert.deepEqual(requestBody.messages, [
      { role: "developer", content: "Answer only from the current public question." },
      { role: "user", content: "重构整个权限系统并完成安全审计和生产迁移" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gemini video input uses the native generateContent route with inline video data", async () => {
  const originalFetch = globalThis.fetch;
  const dir = await tempDir("provider-gemini-video");
  const videoPath = path.join(dir, "clip.mp4");
  await writeFile(videoPath, Buffer.from("00000018667479706d703432", "hex"));
  let request = null;
  globalThis.fetch = async (url, init = {}) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({
      modelVersion: "gemini-3.5-flash",
      candidates: [{
        finishReason: "STOP",
        content: { parts: [{ text: "The video shows a test clip." }] },
      }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "gemini", apiKey: "sk-gemini-user", baseUrl: "https://transit.example/v1" },
    ];
    const result = await client.sendProviderChat({
      provider: "gemini",
      model: "gemini-3.5-flash",
      text: "Describe the video",
      attachments: [{
        name: "clip.mp4",
        mime: "video/mp4",
        local_path: videoPath,
      }],
    });
    const body = JSON.parse(request.init.body);
    assert.equal(
      request.url,
      "https://transit.example/v1beta/models/gemini-3.5-flash:generateContent",
    );
    assert.equal(body.contents[0].parts[0].inlineData.mimeType, "video/mp4");
    assert.ok(body.contents[0].parts[0].inlineData.data);
    assert.equal(body.contents[0].parts[1].text, "Describe the video");
    assert.equal(result.text, "The video shows a test clip.");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("plan-mode Gemini video uses native streaming instead of a fixed total-response request", async () => {
  const originalFetch = globalThis.fetch;
  const dir = await tempDir("provider-gemini-video-stream");
  const videoPath = path.join(dir, "clip.mp4");
  await writeFile(videoPath, Buffer.from("00000018667479706d703432", "hex"));
  let request = null;
  globalThis.fetch = async (url, init = {}) => {
    request = { url: String(url), init, body: JSON.parse(init.body) };
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"modelVersion":"gemini-3.5-flash","candidates":[{"content":{"role":"model","parts":[{"text":"The video "}]}}]}\n\n',
        ));
        controller.enqueue(encoder.encode(
          'data: {"modelVersion":"gemini-3.5-flash","candidates":[{"content":{"role":"model","parts":[{"text":"shows a streamed test clip."}]},"finishReason":"STOP"}]}\n\n',
        ));
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };

  try {
    const progress = [];
    const client = new YouleApiClient({
      businessModelPoolsTtlMs: 60_000,
      providerChatStreamFirstByteTimeoutMs: 50,
      providerChatStreamInactivityTimeoutMs: 50,
    });
    client.loaded = true;
    client.token = "haolo-session-token";
    client.modelKeys = [{
      provider: "gemini",
      groupId: 8,
      apiKey: "sk-gemini-user",
      baseUrl: "https://transit.example/v1",
    }];
    client.businessModelPoolsCache = {
      cachedAt: Date.now(),
      result: normalizeBusinessModelPools({
        configured: true,
        pools: [{
          id: "question_answer",
          enabled: true,
          capabilities: ["question_answer"],
          models: [{
            id: "gemini-3.5-flash",
            display_name: "gemini-3.5-flash",
            provider: "gemini",
            route_group_id: 8,
            capabilities: ["question_answer"],
            enabled: true,
          }],
        }],
      }),
    };

    const result = await client.sendProviderChat({
      provider: "gemini",
      model: "gemini-3.5-flash",
      modelPool: "question_answer",
      modelCapability: "question_answer",
      emitTextDeltas: true,
      text: "Describe the video",
      attachments: [{
        name: "clip.mp4",
        mime: "video/mp4",
        local_path: videoPath,
      }],
      onEvent: (event) => progress.push(event),
    });

    assert.equal(
      request.url,
      "https://transit.example/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse",
    );
    assert.equal(request.body.contents[0].parts[0].inlineData.mimeType, "video/mp4");
    assert.equal(result.text, "The video shows a streamed test clip.");
    assert.equal(result.raw.stream, true);
    assert.deepEqual(
      progress
        .filter((event) => event.phase === "delta")
        .map((event) => event.delta),
      ["The video ", "shows a streamed test clip."],
    );
    assert.equal(progress.at(-1)?.phase, "completed");
    assert.equal(progress.at(-1)?.receivedChars, result.text.length);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("Doubao video input is staged on the relay before chat completions", async () => {
  const originalFetch = globalThis.fetch;
  const dir = await tempDir("provider-doubao-video");
  const videoPath = path.join(dir, "clip.mp4");
  const videoBytes = Buffer.from("00000018667479706d703432", "hex");
  await writeFile(videoPath, videoBytes);
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), init };
    requests.push(request);
    if (request.url === "https://transit.example/v1/media/input") {
      assert.equal(init.headers.Authorization, "Bearer sk-doubao-user");
      assert.equal(init.headers["content-type"], "video/mp4");
      assert.deepEqual(Buffer.from(init.body), videoBytes);
      return new Response(JSON.stringify({
        token: "0123456789abcdef0123456789abcdef",
        url: "https://transit.example/v1/media/input/0123456789abcdef0123456789abcdef",
        content_type: "video/mp4",
        size: videoBytes.length,
      }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      model: "doubao-seed-2-1-pro-260628",
      choices: [{ message: { content: "The video shows a product demo." } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "doubao", apiKey: "sk-doubao-user", baseUrl: "https://transit.example/v1" },
    ];
    const result = await client.sendProviderChat({
      provider: "doubao",
      model: "doubao-seed-2-1-pro-260628",
      text: "Describe the video",
      attachments: [{
        name: "clip.mp4",
        mime: "video/mp4",
        size: videoBytes.length,
        local_path: videoPath,
        url: "https://files.example.test/clip.mp4",
      }],
    });
    assert.equal(requests.length, 2);
    const request = requests[1];
    const body = JSON.parse(request.init.body);
    assert.equal(request.url, "https://transit.example/v1/chat/completions");
    assert.deepEqual(body.messages[0].content[1], {
      type: "video_url",
      video_url: {
        url: "https://transit.example/v1/media/input/0123456789abcdef0123456789abcdef",
      },
    });
    assert.equal(result.text, "The video shows a product demo.");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("Doubao prefers the Aliyun OSS acceleration endpoint for uploaded videos", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      model: "doubao-seed-2-1-pro-260628",
      choices: [{ message: { content: "The children are playing beside a rice field." } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "doubao", apiKey: "sk-doubao-user", baseUrl: "https://transit.example/v1" },
    ];
    const result = await client.sendProviderChat({
      provider: "doubao",
      model: "doubao-seed-2-1-pro-260628",
      text: "Describe the video",
      attachments: [{
        name: "clip.mp4",
        mime: "video/mp4",
        size: 3_655_353,
        local_path: "C:/local/cache/clip.mp4",
        url: "https://youlebucket.oss-ap-southeast-1.aliyuncs.com/material/clip.mp4?version=1",
      }],
    });
    assert.equal(requests.length, 1);
    const body = JSON.parse(requests[0].init.body);
    assert.equal(
      body.messages[0].content[1].video_url.url,
      "https://youlebucket.oss-accelerate.aliyuncs.com/material/clip.mp4?version=1",
    );
    assert.equal(result.text, "The children are playing beside a rice field.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Doubao serializes assistant history before reattaching a historical video", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, init = {}) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({
      model: "doubao-seed-2-1-pro-260628",
      choices: [{ message: { content: "00:00-00:03 shows children walking." } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "doubao", apiKey: "sk-doubao-user", baseUrl: "https://transit.example/v1" },
    ];
    const result = await client.sendProviderChat({
      provider: "doubao",
      model: "doubao-seed-2-1-pro-260628",
      text: "Mark the video segments with timestamps",
      messages: [
        { role: "system", content: "Answer with evidence from the selected source." },
        { role: "user", content: "Describe this video" },
        { role: "assistant", content: "The video shows children walking beside a field." },
        { role: "user", content: "Mark the video segments with timestamps" },
      ],
      attachments: [{
        name: "clip.mp4",
        mime: "video/mp4",
        size: 3_655_353,
        url: "https://youlebucket.oss-ap-southeast-1.aliyuncs.com/material/clip.mp4",
      }],
    });
    const body = JSON.parse(request.init.body);
    assert.equal(request.url, "https://transit.example/v1/chat/completions");
    assert.deepEqual(body.messages.map((message) => message.role), ["system", "system", "user"]);
    assert.match(body.messages[1].content, /haolo_conversation_history_json/);
    assert.match(body.messages[1].content, /Describe this video/);
    assert.match(body.messages[1].content, /The video shows children walking beside a field/);
    assert.deepEqual(body.messages[2].content, [
      { type: "text", text: "Mark the video segments with timestamps" },
      {
        type: "video_url",
        video_url: {
          url: "https://youlebucket.oss-accelerate.aliyuncs.com/material/clip.mp4",
        },
      },
    ]);
    assert.equal(result.text, "00:00-00:03 shows children walking.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider chat rejects unsupported media instead of silently dropping it", async () => {
  const client = new YouleApiClient();
  client.loaded = true;
  client.token = "haolo-session-token";
  client.modelKeys = [
    { provider: "deepseek", apiKey: "sk-deepseek-user", baseUrl: "https://transit.example/v1" },
  ];
  await assert.rejects(
    client.sendProviderChat({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      text: "Read the image",
      attachments: [{
        name: "proof.png",
        mime: "image/png",
        url: "https://files.example.test/proof.png",
      }],
    }),
    /不支持直接读取图片/,
  );
});

test("Kimi provider uses K3 by default and keeps its dedicated transit key", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, init = {}) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({
      model: "kimi-k3",
      choices: [{ message: { content: "K3 reply" } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "moonshot", apiKey: "sk-kimi-user", baseUrl: "https://kimi-transit.example/v1" },
    ];

    const result = await client.sendProviderChat({ provider: "kimi", text: "Answer with K3", temperature: 0.2 });
    const body = JSON.parse(request.init.body);
    assert.equal(request.url, "https://kimi-transit.example/v1/chat/completions");
    assert.equal(request.init.headers.Authorization, "Bearer sk-kimi-user");
    assert.equal(body.model, "kimi-k3");
    assert.equal(body.temperature, 1);
    assert.equal(result.provider, "kimi");
    assert.equal(result.model, "kimi-k3");
    assert.equal(result.text, "K3 reply");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider chat preserves read-only function calls and tool results across rounds", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), init, body });
    if (requests.length === 1) {
      return new Response(JSON.stringify({
        model: "gemini-3.5-flash",
        choices: [{
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "call_read",
              type: "function",
              function: {
                name: "haolo_workspace_read",
                arguments: JSON.stringify({ paths: ["src/main.ts"] }),
              },
            }],
          },
        }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      model: "gemini-3.5-flash",
      choices: [{ message: { content: "Reviewed with file evidence." } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "google", apiKey: "sk-gemini-user", baseUrl: "https://transit.example/v1" },
    ];
    const tools = [{
      type: "function",
      function: {
        name: "haolo_workspace_read",
        parameters: { type: "object" },
      },
    }];

    const first = await client.sendProviderChat({
      provider: "gemini",
      text: "Review this project",
      messages: [{ role: "user", content: "Review this project" }],
      tools,
      toolChoice: "auto",
    });

    assert.equal(first.text, "");
    assert.equal(first.finishReason, "tool_calls");
    assert.equal(first.toolCalls[0].id, "call_read");
    assert.equal(first.assistantMessage.tool_calls[0].function.name, "haolo_workspace_read");
    assert.deepEqual(requests[0].body.tools, tools);
    assert.equal(requests[0].body.tool_choice, "auto");

    const second = await client.sendProviderChat({
      provider: "gemini",
      text: "Review this project",
      messages: [
        { role: "user", content: "Review this project" },
        first.assistantMessage,
        {
          role: "tool",
          tool_call_id: "call_read",
          name: "haolo_workspace_read",
          content: JSON.stringify({ content: "export const answer = 42;" }),
        },
      ],
      tools,
    });

    assert.equal(second.text, "Reviewed with file evidence.");
    assert.equal(
      requests[1].body.messages.filter((message) => message.role === "user").length,
      1,
    );
    assert.equal(requests[1].body.messages[1].tool_calls[0].id, "call_read");
    assert.equal(requests[1].body.messages[2].role, "tool");
    assert.equal(requests[1].body.messages[2].tool_call_id, "call_read");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Kimi K2.6 question-answer requests leave temperature to the upstream model default", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, init = {}) => {
    request = { url: String(url), init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      model: "kimi-k2.6",
      choices: [{ message: { content: "K2.6 reply" } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({ businessModelPoolsTtlMs: 60_000 });
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelKeys = [
      {
        provider: "moonshot",
        groupId: 4,
        apiKey: "sk-kimi-user",
        baseUrl: "https://kimi-transit.example/v1",
      },
    ];
    client.businessModelPoolsCache = {
      cachedAt: Date.now(),
      result: normalizeBusinessModelPools({
        configured: true,
        pools: [{
          id: "question_answer",
          enabled: true,
          capabilities: ["question_answer"],
          models: [{
            id: "kimi-k2.6",
            display_name: "kimi-k2.6",
            provider: "kimi",
            route_group_id: 4,
            capabilities: ["question_answer"],
            enabled: true,
          }],
        }],
      }),
    };

    const result = await client.sendProviderChat({
      provider: "kimi",
      model: "kimi-k2.6",
      modelPool: "question_answer",
      modelCapability: "question_answer",
      text: "你是什么大模型？",
    });

    assert.equal(request.url, "https://kimi-transit.example/v1/chat/completions");
    assert.equal(request.init.headers.Authorization, "Bearer sk-kimi-user");
    assert.equal(request.init.headers["X-Haolo-Model-Pool"], "question_answer");
    assert.equal(request.init.headers["X-Haolo-Model-Capability"], "question_answer");
    assert.equal(request.body.model, "kimi-k2.6");
    assert.equal(request.body.stream, true);
    assert.equal("temperature" in request.body, false);
    assert.equal(result.provider, "kimi");
    assert.equal(result.model, "kimi-k2.6");
    assert.equal(result.text, "K2.6 reply");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DeepSeek provider uses the advertised V4 Flash model by default", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, init = {}) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({
      model: "deepseek-v4-flash",
      choices: [{ message: { content: "DeepSeek reply" } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "deepseek", apiKey: "sk-deepseek-user", baseUrl: "https://transit.example/v1" },
    ];

    const result = await client.sendProviderChat({ provider: "deepseek", text: "Hello" });
    const body = JSON.parse(request.init.body);

    assert.equal(request.url, "https://transit.example/v1/chat/completions");
    assert.equal(body.model, "deepseek-v4-flash");
    assert.deepEqual(body.messages, [{ role: "user", content: "Hello" }]);
    assert.equal(result.provider, "deepseek");
    assert.equal(result.model, "deepseek-v4-flash");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gemini provider uses its dedicated transit key instead of the Codex route", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, init = {}) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({
      model: "gemini-3.5-flash",
      choices: [{ message: { content: "Gemini reply" } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "google", apiKey: "sk-gemini-user", baseUrl: "https://gemini-transit.example/v1" },
    ];

    const result = await client.sendProviderChat({ provider: "gemini", text: "Answer with Gemini" });
    const body = JSON.parse(request.init.body);

    assert.equal(request.url, "https://gemini-transit.example/v1/chat/completions");
    assert.equal(request.init.headers.Authorization, "Bearer sk-gemini-user");
    assert.equal(body.model, "gemini-3.5-flash");
    assert.equal(result.provider, "gemini");
    assert.equal(result.text, "Gemini reply");
    assert.deepEqual(client.sessionSummary().modelProviders, ["gemini"]);

    await client.sendProviderChat({
      provider: "gemini",
      model: "gemini-3.1-pro-preview",
      text: "Answer with Gemini Pro",
    });
    const proBody = JSON.parse(request.init.body);
    assert.equal(proBody.model, "gemini-3.1-pro-preview");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Grok provider uses its dedicated transit key and supports both Buming models", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, init = {}) => {
    request = { url: String(url), init };
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({
      model: body.model,
      choices: [{ message: { content: "Grok reply" } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "xai", apiKey: "sk-grok-user", baseUrl: "https://grok-transit.example/v1" },
    ];

    const result = await client.sendProviderChat({ provider: "grok", text: "Answer with Grok" });
    let body = JSON.parse(request.init.body);
    assert.equal(request.url, "https://grok-transit.example/v1/chat/completions");
    assert.equal(request.init.headers.Authorization, "Bearer sk-grok-user");
    assert.equal(body.model, "grok-4.5");
    assert.equal(result.provider, "grok");
    assert.equal(result.text, "Grok reply");
    assert.deepEqual(client.sessionSummary().modelProviders, ["grok"]);

    await client.sendProviderChat({
      provider: "grok",
      model: "grok-4.3",
      text: "Answer with Grok 4.3",
    });
    body = JSON.parse(request.init.body);
    assert.equal(body.model, "grok-4.3");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MiMo provider uses its dedicated Buming transit key", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, init = {}) => {
    request = { url: String(url), init };
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({
      model: body.model,
      choices: [{ message: { content: "MiMo reply" } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "xiaomi", apiKey: "sk-mimo-user", baseUrl: "https://mimo-transit.example/v1" },
    ];

    const result = await client.sendProviderChat({ provider: "mimo", text: "Answer with MiMo" });
    const body = JSON.parse(request.init.body);
    assert.equal(request.url, "https://mimo-transit.example/v1/chat/completions");
    assert.equal(request.init.headers.Authorization, "Bearer sk-mimo-user");
    assert.equal(body.model, "mimo-v2.5-pro");
    assert.equal(result.provider, "mimo");
    assert.equal(result.text, "MiMo reply");
    assert.deepEqual(client.sessionSummary().modelProviders, ["mimo"]);

    await client.sendProviderChat({
      provider: "mimo",
      model: "mimo-v2.5",
      text: "Answer with MiMo V2.5",
    });
    assert.equal(JSON.parse(request.init.body).model, "mimo-v2.5");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Doubao and Qwen use dedicated Buming transit keys and current default models", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), init, body });
    return new Response(JSON.stringify({
      model: body.model,
      choices: [{ message: { content: `${body.model} reply` } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "bytedance", apiKey: "sk-doubao-user", baseUrl: "https://doubao-transit.example/v1" },
      { provider: "tongyi", apiKey: "sk-qwen-user", baseUrl: "https://qwen-transit.example/v1" },
    ];

    const doubaoResult = await client.sendProviderChat({ provider: "doubao", text: "Answer with Doubao" });
    const qwenResult = await client.sendProviderChat({ provider: "qwen", text: "Answer with Qwen" });

    assert.equal(requests[0].url, "https://doubao-transit.example/v1/chat/completions");
    assert.equal(requests[0].init.headers.Authorization, "Bearer sk-doubao-user");
    assert.equal(requests[0].body.model, "doubao-seed-2-1-pro-260628");
    assert.equal(doubaoResult.provider, "doubao");
    assert.equal(requests[1].url, "https://qwen-transit.example/v1/chat/completions");
    assert.equal(requests[1].init.headers.Authorization, "Bearer sk-qwen-user");
    assert.equal(requests[1].body.model, "qwen3.7-max");
    assert.equal(qwenResult.provider, "qwen");
    assert.deepEqual(client.sessionSummary().modelProviders, ["doubao", "qwen"]);

    await client.sendProviderChat({
      provider: "doubao",
      model: "doubao-seed-2-1-turbo-260628",
      text: "Answer quickly",
    });
    await client.sendProviderChat({
      provider: "qwen",
      model: "qwen3.7-plus",
      text: "Answer with Qwen Plus",
    });
    assert.equal(requests[2].body.model, "doubao-seed-2-1-turbo-260628");
    assert.equal(requests[3].body.model, "qwen3.7-plus");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("execution-pool display aliases resolve to the configured Doubao model id", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, init = {}) => {
    request = { url: String(url), init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      model: request.body.model,
      choices: [{ message: { content: "Doubao cluster reply" } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({ providerModelCatalogTtlMs: 60_000 });
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelKeys = [
      {
        provider: "doubao",
        groupId: 10,
        apiKey: "sk-doubao-user",
        baseUrl: "https://doubao-transit.example/v1",
      },
    ];
    client.businessModelPoolsCache = {
      cachedAt: Date.now(),
      result: normalizeBusinessModelPools({
        configured: true,
        pools: [
          {
            id: "execution",
            enabled: true,
            capabilities: ["cluster_node"],
            models: [
              {
                id: "doubao-seed-2-1-pro-260628",
                display_name: "seed-2-1-pro",
                provider: "doubao",
                route_group_id: 10,
                capabilities: ["cluster_node"],
                enabled: true,
              },
            ],
          },
        ],
      }),
    };

    const result = await client.sendProviderChat({
      provider: "doubao",
      model: "seed-2-1-pro",
      modelPool: "execution",
      modelCapability: "cluster_node",
      text: "写一篇短篇小说",
    });

    assert.equal(request.url, "https://doubao-transit.example/v1/chat/completions");
    assert.equal(request.init.headers.Authorization, "Bearer sk-doubao-user");
    assert.equal(request.body.model, "doubao-seed-2-1-pro-260628");
    assert.equal(result.model, "doubao-seed-2-1-pro-260628");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("all cluster providers send execution-pool technical ids for display names and aliases", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const configuredModels = [
    ["claude", "claude-sonnet-5-202607", "claude-sonnet-5", "claude-latest"],
    ["codex", "gpt-5.6-terra-202607", "gpt-5.6-terra", "terra-current"],
    ["kimi", "kimi-k3-202607", "kimi-k3", "kimi-current"],
    ["deepseek", "deepseek-v4-flash-202607", "deepseek-v4-flash", "deepseek-current"],
    ["gemini", "gemini-3.1-pro-preview", "gemini-3.1-pro", "gemini-pro-current"],
    ["grok", "grok-4.5-202607", "grok-4.5", "grok-current"],
    ["mimo", "mimo-v2.5-pro-202607", "mimo-v2.5-pro", "mimo-current"],
    ["perplexity", "sonar-pro-202607", "sonar-pro", "sonar-current"],
    ["doubao", "doubao-seed-2-1-pro-260628", "seed-2-1-pro", "doubao-pro-current"],
    ["qwen", "qwen3.7-max-202607", "qwen3.7-max", "qwen-max"],
  ].map(([provider, id, displayName, alias], index) => ({
    id,
    display_name: displayName,
    aliases: [alias],
    provider,
    route_group_id: index + 1,
    capabilities: ["cluster_node"],
    enabled: true,
  }));
  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), init, body });
    return new Response(JSON.stringify({
      model: body.model,
      choices: [{ message: { content: `${body.model} reply` } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({ providerModelCatalogTtlMs: 60_000 });
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelKeys = configuredModels.map((model, index) => ({
      provider: model.provider,
      groupId: model.route_group_id,
      apiKey: `sk-${model.provider}`,
      baseUrl: `https://${model.provider}-transit.example/v1`,
    }));
    client.businessModelPoolsCache = {
      cachedAt: Date.now(),
      result: normalizeBusinessModelPools({
        configured: true,
        pools: [{
          id: "execution",
          enabled: true,
          capabilities: ["cluster_node"],
          models: configuredModels,
        }],
      }),
    };

    for (const [index, configured] of configuredModels.entries()) {
      const requestedModel = index % 2 === 0
        ? configured.display_name.toUpperCase()
        : configured.aliases[0];
      const result = await client.sendProviderChat({
        provider: configured.provider,
        model: requestedModel,
        modelPool: "execution",
        modelCapability: "cluster_node",
        text: `execute ${configured.provider}`,
      });
      const request = requests.at(-1);
      assert.equal(request.url, `https://${configured.provider}-transit.example/v1/chat/completions`);
      assert.equal(request.init.headers.Authorization, `Bearer sk-${configured.provider}`);
      assert.equal(request.init.headers["X-Haolo-Model-Pool"], "execution");
      assert.equal(request.init.headers["X-Haolo-Model-Capability"], "cluster_node");
      assert.equal(request.body.model, configured.id);
      assert.equal(result.model, configured.id);
    }
    assert.equal(requests.length, configuredModels.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider chats use a dedicated timeout and report model response timeouts clearly", async () => {
  const originalFetch = globalThis.fetch;
  const defaultClient = new YouleApiClient();
  assert.equal(defaultClient.providerChatTimeoutMs, 120_000);
  assert.equal(defaultClient.providerMediaChatTimeoutMs, 300_000);

  globalThis.fetch = async (_url, init = {}) => new Promise((_resolve, reject) => {
    const rejectAbort = () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    };
    if (init.signal?.aborted) {
      rejectAbort();
      return;
    }
    init.signal?.addEventListener("abort", rejectAbort, { once: true });
  });

  try {
    const client = new YouleApiClient({ providerChatTimeoutMs: 5 });
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "bytedance", apiKey: "sk-doubao-user", baseUrl: "https://doubao-transit.example/v1" },
    ];

    await assert.rejects(
      client.sendProviderChat({ provider: "doubao", text: "Wait for the model" }),
      (error) => {
        assert.equal(error.code, "REQUEST_TIMEOUT");
        assert.equal(error.message, "模型响应超时，请稍后重试");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cluster provider chats fall back to regular HTTP after a pre-response stream reset", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(init.body);
    requests.push(body.stream);
    if (requests.length === 1) {
      const cause = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
      throw Object.assign(new TypeError("fetch failed"), { cause });
    }
    return new Response(JSON.stringify({
      model: "claude-fable-5",
      choices: [{ message: { content: "Recovered over regular HTTP." } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const progress = [];
    const client = new YouleApiClient();
    client.loaded = true;
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "anthropic", apiKey: "sk-claude-user", baseUrl: "https://claude-transit.example/v1" },
    ];

    const result = await client.sendProviderChat({
      provider: "claude",
      text: "Recover this cluster node",
      sourceType: "multi_model_cluster_node",
      stream: true,
      onEvent: (event) => progress.push(event),
    });

    assert.deepEqual(requests, [true, false]);
    assert.equal(result.text, "Recovered over regular HTTP.");
    assert.equal(progress.some((event) => event.stage === "transport_fallback"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("personal strategy understanding also falls back to regular HTTP before any stream bytes arrive", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(init.body);
    requests.push(body.stream);
    if (requests.length === 1) {
      const cause = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
      throw Object.assign(new TypeError("fetch failed"), { cause });
    }
    return new Response(JSON.stringify({
      model: "claude-fable-5",
      choices: [{ message: { content: "Recovered strategy JSON." } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "anthropic", apiKey: "sk-claude-user", baseUrl: "https://claude-transit.example/v1" },
    ];

    const result = await client.sendProviderChat({
      provider: "claude",
      text: "Understand this strategy",
      sourceType: "personal-strategy-understanding",
      stream: true,
    });

    assert.deepEqual(requests, [true, false]);
    assert.equal(result.text, "Recovered strategy JSON.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cluster provider chats do not replay a stream after response bytes arrive", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
        setTimeout(() => {
          controller.error(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
        }, 0);
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "anthropic", apiKey: "sk-claude-user", baseUrl: "https://claude-transit.example/v1" },
    ];

    await assert.rejects(
      client.sendProviderChat({
        provider: "claude",
        text: "Do not replay partial output",
        sourceType: "multi_model_cluster_node",
        stream: true,
      }),
      (error) => {
        assert.equal(error.code, "ECONNRESET");
        assert.equal(error.streamReceivedBytes > 0, true);
        return true;
      },
    );
    assert.equal(requestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("plan-mode streams use a first-response watchdog instead of a total-generation timeout", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  globalThis.fetch = async (_url, init = {}) => new Promise((_resolve, reject) => {
    requestBody = JSON.parse(init.body);
    const rejectAbort = () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    };
    if (init.signal?.aborted) rejectAbort();
    else init.signal?.addEventListener("abort", rejectAbort, { once: true });
  });

  try {
    const client = new YouleApiClient({
      providerChatTimeoutMs: 1,
      providerChatStreamFirstByteTimeoutMs: 5,
      providerChatStreamInactivityTimeoutMs: 50,
    });
    client.loaded = true;
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "anthropic", apiKey: "sk-claude-user", baseUrl: "https://claude-transit.example/v1" },
    ];

    await assert.rejects(
      client.sendProviderChat({
        provider: "claude",
        modelCapability: "question_answer",
        text: "Create a detailed plan",
      }),
      (error) => {
        assert.equal(error.code, "PROVIDER_FIRST_BYTE_TIMEOUT");
        assert.equal(error.category, "timeout");
        assert.equal(error.retryable, true);
        return true;
      },
    );
    assert.equal(requestBody.stream, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider chats give real media analysis a longer response window", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Promise((resolve) => {
    setTimeout(() => {
      resolve(new Response(JSON.stringify({
        model: "doubao-seed-2-1-pro-260628",
        choices: [{ message: { content: "Video analysis finished." } }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    }, 20);
  });

  try {
    const client = new YouleApiClient({
      providerChatTimeoutMs: 5,
      providerMediaChatTimeoutMs: 100,
    });
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "doubao", apiKey: "sk-doubao-user", baseUrl: "https://doubao-transit.example/v1" },
    ];

    const result = await client.sendProviderChat({
      provider: "doubao",
      model: "doubao-seed-2-1-pro-260628",
      text: "Describe this video",
      attachments: [{
        name: "clip.mp4",
        mime: "video/mp4",
        size: 3_655_353,
        url: "https://youlebucket.oss-ap-southeast-1.aliyuncs.com/material/clip.mp4",
      }],
    });

    assert.equal(result.text, "Video analysis finished.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("plan-mode stream cancellation reaches the active transit request", async () => {
  const originalFetch = globalThis.fetch;
  let observedSignal = null;
  let requestBody = null;
  globalThis.fetch = async (_url, init = {}) => new Promise((_resolve, reject) => {
    observedSignal = init.signal;
    requestBody = JSON.parse(init.body);
    const rejectAbort = () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    };
    if (init.signal?.aborted) rejectAbort();
    else init.signal?.addEventListener("abort", rejectAbort, { once: true });
  });

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "anthropic", apiKey: "sk-claude-user", baseUrl: "https://claude-transit.example/v1" },
    ];
    const controller = new AbortController();
    const request = client.sendProviderChat({
      provider: "claude",
      modelCapability: "question_answer",
      text: "Cancel this request",
      signal: controller.signal,
    });
    controller.abort();

    await assert.rejects(request, (error) => {
      assert.equal(error.name, "AbortError");
      assert.equal(error.code, "REQUEST_CANCELLED");
      assert.equal(error.retryable, false);
      return true;
    });
    assert.equal(observedSignal?.aborted, true);
    assert.equal(requestBody.stream, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider chat preserves the transit machine-readable error contract", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: {
      type: "upstream_error",
      message: "Upstream service temporarily unavailable",
      code: "UPSTREAM_TEMPORARILY_UNAVAILABLE",
      category: "remote",
      retryable: true,
      retry_after_ms: 3500,
      request_id: "cluster-request-456",
      upstream_status: 503,
      route_exhausted: true,
    },
  }), {
    status: 502,
    headers: {
      "content-type": "application/json",
      "x-client-request-id": "cluster-request-456",
      "x-haolo-retryable": "true",
    },
  });

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "anthropic", apiKey: "sk-claude-user", baseUrl: "https://claude-transit.example/v1" },
    ];

    await assert.rejects(
      client.sendProviderChat({ provider: "claude", text: "Try the routed model" }),
      (error) => {
        assert.equal(error.status, 502);
        assert.equal(error.code, "UPSTREAM_TEMPORARILY_UNAVAILABLE");
        assert.equal(error.category, "remote");
        assert.equal(error.retryable, true);
        assert.equal(error.retryAfterMs, 3500);
        assert.equal(error.requestId, "cluster-request-456");
        assert.equal(error.upstreamStatus, 503);
        assert.equal(error.routeExhausted, true);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cluster provider chats consume SSE without imposing a total response timeout", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  globalThis.fetch = async (_url, init = {}) => {
    requestBody = JSON.parse(init.body);
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"model":"claude-sonnet-5","choices":[{"delta":{"content":"Hello "}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"cluster"},"finish_reason":"stop"}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };

  try {
    const progress = [];
    const client = new YouleApiClient({
      providerChatStreamFirstByteTimeoutMs: 50,
      providerChatStreamInactivityTimeoutMs: 50,
    });
    client.loaded = true;
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "anthropic", apiKey: "sk-claude-user", baseUrl: "https://claude-transit.example/v1" },
    ];

    const result = await client.sendProviderChat({
      provider: "claude",
      text: "Stream this request",
      stream: true,
      onEvent: (event) => progress.push(event),
    });

    assert.equal(requestBody.stream, true);
    assert.equal(result.text, "Hello cluster");
    assert.equal(result.model, "claude-sonnet-5");
    assert.equal(progress.at(-1)?.phase, "completed");
    assert.equal(progress.at(-1)?.receivedChars, 13);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("explicit plan-mode display deltas preserve the upstream SSE chunk boundaries", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"choices":[{"delta":{"content":"first "}}]}\n\n',
        ));
        controller.enqueue(encoder.encode(
          'data: {"choices":[{"delta":{"content":"second"},"finish_reason":"stop"}]}\n\n',
        ));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };

  try {
    const events = [];
    const client = new YouleApiClient({
      providerChatStreamFirstByteTimeoutMs: 50,
      providerChatStreamInactivityTimeoutMs: 50,
    });
    client.loaded = true;
    client.token = "haolo-session-token";
    client.modelKeys = [{
      provider: "anthropic",
      apiKey: "sk-claude-user",
      baseUrl: "https://claude-transit.example/v1",
    }];

    const result = await client.sendProviderChat({
      provider: "claude",
      text: "Stream visibly",
      stream: true,
      emitTextDeltas: true,
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.text, "first second");
    assert.deepEqual(
      events
        .filter((event) => event.phase === "delta")
        .map((event) => event.delta),
      ["first ", "second"],
    );
    assert.equal(events.at(-1)?.phase, "completed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamed plan-mode tool calls retain fragmented names and arguments", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"read_","arguments":"{\\"path\\":\\""}}]}}]}\n\n',
        ));
        controller.enqueue(encoder.encode(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"README.md\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        ));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };

  try {
    const client = new YouleApiClient({
      providerChatStreamFirstByteTimeoutMs: 50,
      providerChatStreamInactivityTimeoutMs: 50,
    });
    client.loaded = true;
    client.token = "haolo-session-token";
    client.modelKeys = [{
      provider: "anthropic",
      apiKey: "sk-claude-user",
      baseUrl: "https://claude-transit.example/v1",
    }];

    const result = await client.sendProviderChat({
      provider: "claude",
      text: "Read a file",
      stream: true,
      tools: [{
        type: "function",
        function: {
          name: "read_file",
          parameters: { type: "object" },
        },
      }],
    });

    assert.equal(result.text, "");
    assert.deepEqual(result.toolCalls, [{
      id: "call-1",
      type: "function",
      function: {
        name: "read_file",
        arguments: '{"path":"README.md"}',
      },
    }]);
    assert.equal(result.finishReason, "tool_calls");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Doubao streaming can finish after the JSON completion timeout while progress continues", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  globalThis.fetch = async (_url, init = {}) => {
    requestBody = JSON.parse(init.body);
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(encoder.encode('data: {"model":"doubao-seed-2-1-pro-260628","choices":[{"delta":{"content":"slow "}}]}\n\n'));
        }, 2);
        setTimeout(() => {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}\n\n'));
        }, 8);
        setTimeout(() => {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }, 14);
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };

  try {
    const client = new YouleApiClient({
      providerChatTimeoutMs: 5,
      providerChatStreamFirstByteTimeoutMs: 50,
      providerChatStreamInactivityTimeoutMs: 50,
    });
    client.loaded = true;
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "bytedance", apiKey: "sk-doubao-user", baseUrl: "https://doubao-transit.example/v1" },
    ];

    const result = await client.sendProviderChat({
      provider: "doubao",
      text: "Finish the long answer",
      stream: true,
    });

    assert.equal(requestBody.stream, true);
    assert.equal(result.text, "slow answer");
    assert.equal(result.model, "doubao-seed-2-1-pro-260628");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cluster provider chats fail only after the stream stops making progress", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => {
    const body = new ReadableStream({
      start(controller) {
        init.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          controller.error(error);
        }, { once: true });
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };

  try {
    const client = new YouleApiClient({
      providerChatStreamFirstByteTimeoutMs: 50,
      providerChatStreamInactivityTimeoutMs: 5,
    });
    client.loaded = true;
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "anthropic", apiKey: "sk-claude-user", baseUrl: "https://claude-transit.example/v1" },
    ];

    await assert.rejects(
      client.sendProviderChat({ provider: "claude", text: "Wait for progress", stream: true }),
      (error) => {
        assert.equal(error.code, "PROVIDER_STREAM_INACTIVITY_TIMEOUT");
        assert.equal(error.category, "timeout");
        assert.equal(error.retryable, true);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Perplexity provider preserves Sonar citations in the visible reply", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, init = {}) => {
    request = { url: String(url), init };
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({
      model: body.model,
      choices: [{ message: { content: "Current answer [1][2]." } }],
      citations: ["https://example.com/source-a", "https://example.com/source-b"],
      search_results: [{ url: "https://example.com/source-a" }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelKeys = [
      { provider: "pplx", apiKey: "sk-perplexity-user", baseUrl: "https://perplexity-transit.example/v1" },
    ];

    const result = await client.sendProviderChat({ provider: "perplexity", text: "Research this" });
    const body = JSON.parse(request.init.body);
    assert.equal(request.url, "https://perplexity-transit.example/v1/chat/completions");
    assert.equal(request.init.headers.Authorization, "Bearer sk-perplexity-user");
    assert.equal(body.model, "sonar-pro");
    assert.equal(result.provider, "perplexity");
    assert.deepEqual(result.citations, ["https://example.com/source-a", "https://example.com/source-b"]);
    assert.match(result.text, /Current answer \[1\]\[2\]\./);
    assert.match(result.text, /\u53c2\u8003\u6765\u6e90\uff1a/);
    assert.match(result.text, /https:\/\/example\.com\/source-a/);
    assert.deepEqual(client.sessionSummary().modelProviders, ["perplexity"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy primary transit key advertises Codex contact availability", () => {
  const client = new YouleApiClient();
  client.loaded = true;
  client.modelApiKey = "sk-primary-transit";
  client.modelKeys = [];
  assert.deepEqual(client.sessionSummary().modelProviders, ["codex"]);
});

test("profile and balance hydration start in parallel", async () => {
  const client = new YouleApiClient();
  const started = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  client.fetchProfile = async () => {
    started.push("profile");
    await gate;
    return { id: "user-1", nickname: "Person" };
  };
  client.fetchSub2ApiBalance = async () => {
    started.push("balance");
    await gate;
    return { balance: 12 };
  };

  const pending = client.fetchProfileWithBalance("token-1");
  await Promise.resolve();
  assert.deepEqual(started, ["profile", "balance"]);
  release();
  const profile = await pending;
  assert.equal(profile.id, "user-1");
});

test("load keeps haolo.com session base url", async () => {
  const dir = await tempDir("haolo-base-url");
  const sessionPath = path.join(dir, "session.json");
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(
    sessionPath,
    JSON.stringify({
      baseUrl: "https://haolo.com",
      token: "token-1",
    }),
    "utf8",
  );

  try {
    const client = new YouleApiClient({ storagePath: sessionPath });
    const session = await client.getSession();
    const saved = JSON.parse(await readFile(sessionPath, "utf8"));
    assert.equal(session.baseUrl, "https://haolo.com");
    assert.equal(saved.baseUrl, "https://haolo.com");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sendOtp detects and normalizes a mainland phone identifier", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, init = {}) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ challenge_id: "sms-challenge", resend_after: 30 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    const challenge = await client.sendOtp({
      identifier: "+86 138-0013-8000",
      surface: "client",
    });

    assert.equal(request.url, "https://haolo.com/api/auth/otp/send");
    assert.deepEqual(JSON.parse(request.init.body), {
      channel: "sms",
      identifier: "13800138000",
      phone: "13800138000",
      surface: "client",
    });
    assert.equal(challenge.challenge_id, "sms-challenge");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendOtp rejects an identifier that does not match the requested channel", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("fetch should not be called");
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    await assert.rejects(
      client.sendOtp({
        channel: "sms",
        identifier: "person@example.com",
        surface: "client",
      }),
      /请输入正确的邮箱或手机号/,
    );
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("web3 auth variant is email-only and is forwarded by OTP requests", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/api/auth/otp/send")) {
      return new Response(JSON.stringify({ challenge_id: "web3-email-challenge" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      mode: "register_profile",
      registration_token: "web3-registration-token",
      invite_required: true,
      nickname_required: true,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    await assert.rejects(
      client.sendOtp({
        channel: "sms",
        identifier: "13800138000",
        surface: "client",
        clientVariant: "haolo_windows_web3",
      }),
      /仅支持邮箱验证码/,
    );

    await client.sendOtp({
      channel: "email",
      identifier: "WEB3@Example.com",
      surface: "client",
      clientVariant: "haolo_windows_web3",
    });
    const handoff = await client.verifyOtp({
      channel: "email",
      identifier: "WEB3@Example.com",
      challengeId: "web3-email-challenge",
      code: "123456",
      surface: "client",
      clientVariant: "haolo_windows_web3",
    });

    assert.equal(requests.length, 2);
    for (const request of requests) {
      const body = JSON.parse(request.init.body);
      assert.equal(body.channel, "email");
      assert.equal(body.identifier, "web3@example.com");
      assert.equal(body.client_variant, "haolo_windows_web3");
      assert.equal(Object.hasOwn(body, "phone"), false);
    }
    assert.equal(handoff.registrationToken, "web3-registration-token");
    assert.equal(handoff.inviteRequired, true);
    assert.equal(handoff.nicknameRequired, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WeChat flow APIs use the client surface and poll credential header", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    requests.push({ url: target, init });
    if (target.endsWith("/api/auth/wechat/config")) {
      return new Response(JSON.stringify({ data: { enabled: true, poll_interval_ms: 1800 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (target.endsWith("/api/auth/wechat/flows")) {
      return new Response(JSON.stringify({
        data: {
          flow_id: "wxf-client",
          poll_token: "poll-client",
          authorize_url: "https://open.weixin.qq.com/connect/qrconnect?appid=wx-test",
          poll_after: 1.5,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ data: { status: "authorized" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    const config = await client.getWechatAuthConfig({ baseUrl: "https://haolo.com" });
    const flow = await client.startWechatAuthFlow({
      baseUrl: "https://haolo.com",
      intent: "register",
      registrationToken: "reg-client",
    });
    const status = await client.getWechatAuthFlowStatus({
      baseUrl: "https://haolo.com",
      flowId: flow.flow_id,
      pollToken: flow.poll_token,
    });

    assert.equal(config.enabled, true);
    assert.deepEqual(JSON.parse(requests[1].init.body), {
      surface: "client",
      intent: "register",
      registration_token: "reg-client",
    });
    assert.match(requests[2].url, /\/api\/auth\/wechat\/flows\/wxf-client\/status\?_=/);
    assert.equal(requests[2].init.headers["X-Wechat-Poll-Token"], "poll-client");
    assert.equal(status.status, "authorized");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WeChat email OTP and registration completion carry the authorized flow", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    requests.push({ url: target, init });
    if (target.endsWith("/api/auth/otp/send")) {
      return new Response(JSON.stringify({ challenge_id: "wechat-email", resend_after: 5 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (target.endsWith("/api/auth/otp/verify")) {
      return new Response(JSON.stringify({
        registration_token: "reg-wechat",
        secondary_required_channel: "sms",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ mode: "wechat_required", registration_token: "reg-wechat" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    await client.sendOtp({
      baseUrl: "https://haolo.com",
      channel: "email",
      identifier: "person@example.com",
      surface: "client",
      wechatFlowId: "wxf-email",
      wechatPollToken: "poll-email",
    });
    await client.verifyOtp({
      baseUrl: "https://haolo.com",
      channel: "email",
      identifier: "person@example.com",
      challengeId: "wechat-email",
      code: "123456",
      surface: "client",
      wechatFlowId: "wxf-email",
      wechatPollToken: "poll-email",
    });
    const handoff = await client.completeRegistration({
      baseUrl: "https://haolo.com",
      channel: "email",
      identifier: "person@example.com",
      registrationToken: "reg-wechat",
      inviteCode: "INVITE",
      nickname: "Person",
      wechatFlowId: "wxf-email",
      wechatPollToken: "poll-email",
    });

    for (const request of requests) {
      const body = JSON.parse(request.init.body);
      assert.equal(body.wechat_flow_id, "wxf-email");
      assert.equal(body.wechat_poll_token, "poll-email");
    }
    assert.equal(handoff.mode, "wechat_required");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("multipart WeChat registration keeps flow credentials with the avatar", async () => {
  const originalFetch = globalThis.fetch;
  let form = null;
  globalThis.fetch = async (_url, init = {}) => {
    form = init.body;
    return new Response(JSON.stringify({ mode: "wechat_required", registration_token: "reg-avatar" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    await client.completeRegistration({
      baseUrl: "https://haolo.com",
      channel: "email",
      identifier: "person@example.com",
      registrationToken: "reg-avatar",
      inviteCode: "INVITE",
      nickname: "Person",
      avatarFile: {
        name: "avatar.png",
        mime: "image/png",
        bytes: new Uint8Array([137, 80, 78, 71]),
      },
      wechatFlowId: "wxf-avatar",
      wechatPollToken: "poll-avatar",
    });

    assert.ok(form instanceof FormData);
    assert.equal(form.get("surface"), "client");
    assert.equal(form.get("include_key"), "true");
    assert.equal(form.get("wechat_flow_id"), "wxf-avatar");
    assert.equal(form.get("wechat_poll_token"), "poll-avatar");
    assert.ok(form.get("avatar_file") instanceof Blob);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WeChat exchange persists a complete desktop refresh session and model key", async () => {
  const dir = await tempDir("wechat-exchange-session");
  const originalFetch = globalThis.fetch;
  let exchangeRequest = null;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith("/api/auth/wechat/flows/wxf-login/exchange")) {
      exchangeRequest = init;
      return new Response(JSON.stringify({
        access_token: labAccessToken(Math.floor(Date.now() / 1000) + 3600),
        expires_in: 3600,
        refresh_token: "wechat-refresh-secret",
        refresh_expires_in: 90 * 24 * 60 * 60,
        session_id: "session-wechat-client",
        sub2api: { api_key: "sk-wechat", transit_base_url: "https://aiapi.example.test/v1" },
        profile: { id: "wechat-user", email: "person@example.com" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.endsWith("/api/profile/me")) {
      return new Response(JSON.stringify({ id: "wechat-user", email: "person@example.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
      safeStorage: fakeSafeStorage(),
    });
    const session = await client.exchangeWechatAuthFlow({
      baseUrl: "https://haolo.com",
      flowId: "wxf-login",
      pollToken: "poll-login",
    });

    assert.deepEqual(JSON.parse(exchangeRequest.body), { poll_token: "poll-login", include_key: true });
    assert.equal(session.authenticated, true);
    assert.equal(session.sessionId, "session-wechat-client");
    assert.equal(session.hasRefreshSession, true);
    assert.equal(session.hasModelApiKey, true);
    const saved = await readFile(path.join(dir, "session.json"), "utf8");
    assert.equal(saved.includes("wechat-refresh-secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("verifyOtp sends the phone contract and preserves the normalized secondary channel", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, init = {}) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({
      data: {
        registration_token: "reg_phone_primary",
        secondaryRequiredChannel: "EMAIL",
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.deviceId = "device-phone-test";
    const result = await client.verifyOtp({
      identifier: "8613900139000",
      challengeId: "sms-challenge",
      code: "123456",
      surface: "client",
    });

    assert.equal(request.url, "https://haolo.com/api/auth/otp/verify");
    const body = JSON.parse(request.init.body);
    assert.equal(body.channel, "sms");
    assert.equal(body.identifier, "13900139000");
    assert.equal(body.phone, "13900139000");
    assert.equal(body.surface, "client");
    assert.equal(Object.hasOwn(body, "registration_token"), false);
    assert.equal(result.registration_token, "reg_phone_primary");
    assert.equal(result.secondary_required_channel, "email");
    assert.equal(result.secondaryRequiredChannel, "email");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("secondary OTP calls send the current registration token and use the rotated token", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/api/auth/otp/send")) {
      return new Response(JSON.stringify({ challenge_id: "email-secondary-challenge" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ registrationToken: "reg_after_secondary" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    await client.sendOtp({
      identifier: "SECONDARY@Example.com",
      registrationToken: "reg_after_primary",
      surface: "client",
    });
    const result = await client.verifyOtp({
      identifier: "SECONDARY@Example.com",
      registrationToken: "reg_after_primary",
      challengeId: "email-secondary-challenge",
      code: "654321",
      surface: "client",
    });

    const sendBody = JSON.parse(requests[0].init.body);
    assert.equal(sendBody.channel, "email");
    assert.equal(sendBody.identifier, "secondary@example.com");
    assert.equal(sendBody.registration_token, "reg_after_primary");
    assert.equal(Object.hasOwn(sendBody, "phone"), false);

    const verifyBody = JSON.parse(requests[1].init.body);
    assert.equal(verifyBody.registration_token, "reg_after_primary");
    assert.equal(result.registrationToken, "reg_after_secondary");
    assert.equal(result.registration_token, "reg_after_secondary");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("email-first registration sends the secondary SMS contract with its registration token", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/api/auth/otp/send")) {
      return new Response(JSON.stringify({ challenge_id: "sms-secondary-challenge" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ registration_token: "reg_after_sms_secondary" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    await client.sendOtp({
      channel: "sms",
      identifier: "+86 136-0013-6000",
      registrationToken: "reg_after_email_primary",
      surface: "client",
    });
    const result = await client.verifyOtp({
      channel: "sms",
      identifier: "+86 136-0013-6000",
      registrationToken: "reg_after_email_primary",
      challengeId: "sms-secondary-challenge",
      code: "123456",
      surface: "client",
    });

    for (const request of requests) {
      const body = JSON.parse(request.init.body);
      assert.equal(body.channel, "sms");
      assert.equal(body.identifier, "13600136000");
      assert.equal(body.phone, "13600136000");
      assert.equal(body.registration_token, "reg_after_email_primary");
    }
    assert.equal(result.registration_token, "reg_after_sms_secondary");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("completeRegistration accepts a registration token without requiring email", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/api/auth/register/complete")) {
      return new Response(JSON.stringify({
        access_token: "registered-without-email",
        refresh_token: "refresh-registered-without-email",
        refresh_expires_in: 90 * 24 * 60 * 60,
        session_id: "session-registered-without-email",
        sub2api: { api_key: "sk-registration-test" },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ detail: "profile temporarily unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    const session = await client.completeRegistration({
      registrationToken: "reg_verified_both_channels",
      phone: "+86 13700137000",
      nickname: "Phone User",
      inviteCode: "INVITE-123",
    });

    const body = JSON.parse(requests[0].init.body);
    assert.equal(body.registration_token, "reg_verified_both_channels");
    assert.equal(Object.hasOwn(body, "email"), false);
    assert.equal(Object.hasOwn(body, "phone"), false);
    assert.equal(session.profile.phone, "13700137000");
    assert.equal(session.profile.nickname, "Phone User");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("verifyOtp returns registration handoff from wrapped response payloads", async () => {
  const dir = await tempDir("wrapped-registration");
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        data: {
          registrationToken: "reg_wrapped_123",
          mode: "register",
          inviteRequired: true,
          nicknameRequired: true,
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    const result = await client.verifyOtp({
      baseUrl: "https://haolo.com",
      email: "person@example.com",
      code: "123456",
      challengeId: "lab-abc",
      surface: "client",
    });

    assert.equal(result.registrationToken, "reg_wrapped_123");
    assert.equal(result.registration_token, "reg_wrapped_123");
    assert.equal(result.mode, "register");
    assert.equal(result.isNewUser, true);
    assert.equal(result.inviteRequired, true);
    assert.equal(result.nicknameRequired, true);
    assert.equal(requests.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("completeRegistration allows empty invite when handoff marks invite optional", async () => {
  const dir = await tempDir("optional-invite");
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/api/auth/register/complete")) {
      return new Response(
        JSON.stringify({
          access_token: "mas_token_123",
          refresh_token: "refresh-mas-token-123",
          refresh_expires_in: 90 * 24 * 60 * 60,
          session_id: "session-mas-token-123",
          sub2api: { api_key: "sk-test", transit_base_url: "https://aiapi.example.test/v1" },
          profile: { id: "user-1", email: "person@example.com", nickname: "Person" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return new Response(JSON.stringify({ id: "user-1", email: "person@example.com", nickname: "Person" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    const result = await client.completeRegistration({
      baseUrl: "https://haolo.com",
      email: "person@example.com",
      registrationToken: "reg_optional_invite",
      inviteRequired: false,
      nickname: "Person",
    });

    assert.equal(result.authenticated, true);
    assert.equal(result.hasModelApiKey, true);
    const registerRequest = requests.find((request) => request.url.endsWith("/api/auth/register/complete"));
    assert.ok(registerRequest);
    const body = JSON.parse(registerRequest.init.body);
    assert.equal(body.registration_token, "reg_optional_invite");
    assert.equal(body.nickname, "Person");
    assert.equal(Object.hasOwn(body, "invite_code"), false);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("completeRegistration never sends stale otp fields", async () => {
  const dir = await tempDir("complete-registration-no-otp");
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/api/auth/register/complete")) {
      return new Response(
        JSON.stringify({
          access_token: "mas_token_no_otp",
          refresh_token: "refresh-mas-token-no-otp",
          refresh_expires_in: 90 * 24 * 60 * 60,
          session_id: "session-mas-token-no-otp",
          sub2api: { api_key: "sk-test", transit_base_url: "https://aiapi.example.test/v1" },
          profile: { id: "user-no-otp", email: "person@example.com", nickname: "Person" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return new Response(JSON.stringify({ id: "user-no-otp", email: "person@example.com", nickname: "Person" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    await client.completeRegistration({
      baseUrl: "https://haolo.com",
      email: "person@example.com",
      registrationToken: "reg_no_otp",
      inviteCode: "INVITE-123",
      nickname: "Person",
      code: "000000",
      challengeId: "expired-challenge",
    });

    const registerRequest = requests.find((request) => request.url.endsWith("/api/auth/register/complete"));
    assert.ok(registerRequest);
    const body = JSON.parse(registerRequest.init.body);
    assert.equal(body.registration_token, "reg_no_otp");
    assert.equal(body.invite_code, "INVITE-123");
    assert.equal(Object.hasOwn(body, "code"), false);
    assert.equal(Object.hasOwn(body, "challenge_id"), false);
    assert.equal(Object.hasOwn(body, "challengeId"), false);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("completeRegistration honors optional nickname and normalizes transit base url", async () => {
  const dir = await tempDir("optional-nickname");
  const originalFetch = globalThis.fetch;
  const authPath = path.join(dir, "auth.json");
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/api/auth/register/complete")) {
      return new Response(
        JSON.stringify({
          access_token: "mas_token_optional_nickname",
          refresh_token: "refresh-mas-token-optional-nickname",
          refresh_expires_in: 90 * 24 * 60 * 60,
          session_id: "session-mas-token-optional-nickname",
          sub2api: { api_key: "sk-test", transit_base_url: "http://54.235.242.62:3000/v1" },
          profile: { id: "user-2", email: "optional@example.com" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return new Response(JSON.stringify({ id: "user-2", email: "optional@example.com" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath,
    });
    const result = await client.completeRegistration({
      baseUrl: "https://haolo.com",
      email: "optional@example.com",
      registrationToken: "reg_optional_nickname",
      inviteRequired: false,
      nicknameRequired: false,
    });

    assert.equal(result.authenticated, true);
    const registerRequest = requests.find((request) => request.url.endsWith("/api/auth/register/complete"));
    assert.ok(registerRequest);
    const body = JSON.parse(registerRequest.init.body);
    assert.equal(Object.hasOwn(body, "nickname"), false);
    const auth = JSON.parse(await readFile(authPath, "utf8"));
    assert.equal(auth.TRANSIT_BASE_URL, "https://haolo.pro/v1");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("completeRegistration surfaces expired registration token detail", async () => {
  const dir = await tempDir("expired-registration");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ detail: "registration token invalid or expired" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    await assert.rejects(
      client.completeRegistration({
        baseUrl: "https://haolo.com",
        email: "person@example.com",
        registrationToken: "expired",
        inviteRequired: false,
        nickname: "Person",
      }),
      /registration token invalid or expired/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("refreshSub2ApiAccount reads balance and marks low balance", async () => {
  const dir = await tempDir("sub2api-balance");
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        enabled: true,
        account: {
          user_id: 11,
          email: "person@example.com",
          status: "active",
          role: "user",
          balance: 304.35,
          real_balance: 4.35,
          subscription_balance: 300,
          subscription_total_balance: 1200,
          subscription_credited_balance: 300,
          subscription_pending_balance: 900,
          total_balance: 304.35,
          balance_usd: "304.35",
          balance_cny: "30.00",
          balance_cny_fen: 3000,
          fx_rate_usd_to_cny: "7.5",
          subscription_balance_refresh_at: "2026-07-21T00:00:00Z",
          membership_expires_at: "2026-08-11T00:00:00Z",
          membership_plan: "pro",
          trial_eligible: false,
          active_membership: {
            plan_id: "pro",
            starts_at: "2026-07-12T00:00:00Z",
            expires_at: "2026-08-11T00:00:00Z",
          },
          pending_membership: {
            plan_id: "flagship",
            starts_at: "2026-08-11T00:00:00Z",
            expires_at: "2026-09-10T00:00:00Z",
          },
          total_recharged: 20,
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.token = "mas_token_balance";
    client.profile = { id: "user-1", email: "person@example.com" };
    client.loaded = true;

    const result = await client.refreshSub2ApiAccount();

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://haolo.com/api/sub2api/me");
    assert.equal(requests[0].init.headers.Authorization, "Bearer mas_token_balance");
    assert.equal(result.balance, 30);
    assert.equal(result.balanceLabel, "30元");
    assert.equal(result.lowBalance, false);
    assert.equal(result.threshold, 5);
    assert.equal(result.session.profile.token_balance, 30);
    assert.equal(result.session.profile.token_balance_label, "30元");
    assert.equal(result.session.profile.real_balance, 4.35);
    assert.equal(result.session.profile.total_balance, 304.35);
    assert.equal(result.session.profile.balance_usd, "4.35");
    assert.equal(result.session.profile.subscription_balance, 300);
    assert.equal(result.session.profile.subscription_total_balance, 1200);
    assert.equal(result.session.profile.subscription_credited_balance, 300);
    assert.equal(result.session.profile.subscription_pending_balance, 900);
    assert.equal(result.session.profile.subscription_balance_refresh_at, "2026-07-21T00:00:00Z");
    assert.equal(result.session.profile.membership_expires_at, "2026-08-11T00:00:00Z");
    assert.equal(result.session.profile.membership_plan, "pro");
    assert.equal(result.session.profile.trial_eligible, false);
    assert.equal(result.session.profile.active_membership.plan_id, "pro");
    assert.equal(result.session.profile.pending_membership.plan_id, "flagship");
    assert.equal(result.session.profile.pending_membership.starts_at, "2026-08-11T00:00:00Z");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("refreshSub2ApiAccount coalesces matching requests and honors a short cache window", async () => {
  const dir = await tempDir("sub2api-balance-cache");
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify({
      enabled: true,
      account: {
        email: "person@example.com",
        real_balance: 10,
        subscription_balance: 20,
        total_balance: 30,
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.token = "mas_token_balance_cache";
    client.profile = { id: "user-1", email: "person@example.com" };
    client.loaded = true;

    const [first, second] = await Promise.all([
      client.refreshSub2ApiAccount({ maxAgeMs: 5_000 }),
      client.refreshSub2ApiAccount({ maxAgeMs: 5_000 }),
    ]);
    const cached = await client.refreshSub2ApiAccount({ maxAgeMs: 5_000 });

    assert.equal(requests.length, 1);
    assert.equal(first.session.profile.total_balance, 30);
    assert.equal(second.session.profile.total_balance, 30);
    assert.equal(cached.session.profile.total_balance, 30);

    await client.refreshSub2ApiAccount();
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("refreshSub2ApiAccount clears stale membership fields for a free account", async () => {
  const dir = await tempDir("sub2api-clear-stale-membership");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    enabled: true,
    account: {
      email: "free@example.com",
      real_balance: 0,
      subscription_balance: 0,
      total_balance: 0,
      membership_plan: null,
      membership_expires_at: null,
      active_membership: null,
      pending_membership: null,
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.token = "mas_token_free";
    client.profile = {
      id: "free-user",
      email: "free@example.com",
      membership_plan: "pro",
      membership_expires_at: "2027-01-01T00:00:00Z",
      active_membership: { plan_id: "pro" },
      pending_membership: { plan_id: "flagship" },
    };
    client.loaded = true;

    const result = await client.refreshSub2ApiAccount();

    assert.equal(result.session.profile.membership_plan, null);
    assert.equal(result.session.profile.membership_expires_at, null);
    assert.equal(result.session.profile.active_membership, null);
    assert.equal(result.session.profile.pending_membership, null);
    assert.equal(result.session.profile.total_balance, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("getSubscriptionBalanceDetails reads the authoritative server snapshot", async () => {
  const dir = await tempDir("subscription-balance-details");
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        enabled: true,
        details: {
          active: true,
          plan_id: "pro",
          subscription_total_balance: 1200,
          subscription_credited_balance: 600,
          subscription_pending_balance: 600,
          next_credit_at: "2026-07-28T00:00:00Z",
          membership_expires_at: "2026-08-11T00:00:00Z",
          calculated_at: "2026-07-21T00:00:01Z",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.token = "mas_token_details";
    client.loaded = true;

    const details = await client.getSubscriptionBalanceDetails();

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://haolo.com/api/sub2api/me/subscription-balance-details");
    assert.equal(requests[0].init.headers.Authorization, "Bearer mas_token_details");
    assert.deepEqual(details, {
      active: true,
      planId: "pro",
      totalBalance: 1200,
      creditedBalance: 600,
      pendingBalance: 600,
      nextCreditAt: "2026-07-28T00:00:00Z",
      membershipExpiresAt: "2026-08-11T00:00:00Z",
      calculatedAt: "2026-07-21T00:00:01Z",
    });
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("getSubscriptionBalanceDetails rejects internally inconsistent balances", async () => {
  const dir = await tempDir("subscription-balance-details-invalid");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        details: {
          active: true,
          plan_id: "basic",
          subscription_total_balance: 600,
          subscription_credited_balance: 150,
          subscription_pending_balance: 400,
          next_credit_at: "2026-07-24T00:00:00Z",
          membership_expires_at: "2026-08-16T00:00:00Z",
          calculated_at: "2026-07-17T00:00:00Z",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.token = "mas_token_invalid_details";
    client.loaded = true;

    await assert.rejects(client.getSubscriptionBalanceDetails(), /总额与到账明细不一致/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("Web3 payment orders use the dedicated authenticated USDT route", async () => {
  const dir = await tempDir("web3-payment-order");
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      order_no: "W320260820000001",
      product_id: "subscription_pro",
      network: "tron",
      payable_amount: "498.956",
      recipient_address: "TVXvodFriEMNjsVkuRWtiAmo1qVQauv635",
      status: "pending",
      expires_at: "2026-08-20T12:30:00Z",
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.token = "mas_token_web3";
    client.loaded = true;

    const created = await client.createWeb3PaymentOrder({
      productId: "subscription_pro",
      network: "tron",
    });
    await client.createWeb3PaymentOrder({
      productId: "subscription_basic",
      network: "binance_internal",
      previousOrderNo: "W3202608210444069A4BEC",
    });
    await client.createWeb3PaymentOrder({
      productId: "subscription_flagship",
      network: "okx_internal",
    });
    const fetched = await client.getWeb3PaymentOrder({ orderNo: created.order_no });

    assert.equal(requests.length, 4);
    assert.equal(requests[0].url, "https://haolo.com/api/finance/web3/token-products/orders");
    assert.equal(requests[0].init.method, "POST");
    assert.equal(requests[0].init.headers.Authorization, "Bearer mas_token_web3");
    assert.deepEqual(JSON.parse(requests[0].init.body), {
      product_id: "subscription_pro",
      network: "tron",
      payment_channel: "web3",
    });
    assert.deepEqual(JSON.parse(requests[1].init.body), {
      product_id: "subscription_basic",
      network: "binance_internal",
      payment_channel: "web3",
      previous_order_no: "W3202608210444069A4BEC",
    });
    assert.deepEqual(JSON.parse(requests[2].init.body), {
      product_id: "subscription_flagship",
      network: "okx_internal",
      payment_channel: "web3",
    });
    assert.equal(requests[3].url, "https://haolo.com/api/finance/web3/token-products/orders/W320260820000001");
    assert.equal(requests[3].init.method, "GET");
    assert.equal(fetched.payable_amount, "498.956");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateVideoExpertAccess validates video expert email through the server", async () => {
  const dir = await tempDir("video-expert-server-validation");
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ allowed: true, status: "allowed", source: "server_allowlist" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.token = "mas_token_video";
    client.profile = { id: "user-video", email: "Joiec@QQ.com" };
    client.loaded = true;

    const result = await client.validateVideoExpertAccess();

    assert.equal(result.allowed, true);
    assert.equal(result.email, "joiec@qq.com");
    assert.equal(result.source, "server_allowlist");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://haolo.com/api/video-expert/access/validate");
    const body = JSON.parse(requests[0].init.body);
    assert.equal(body.email, "joiec@qq.com");
    assert.equal(body.identifier, "joiec@qq.com");
    assert.equal(body.source, "video_expert");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("refreshProfile preserves member level summary", async () => {
  const dir = await tempDir("profile-level");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: "user-level-1",
        email: "level@example.com",
        level: {
          enabled: true,
          locked: false,
          level: 4,
          icons: [{ type: "egg_cat", count: 1 }],
          current_progress: 1,
          required_progress: 600,
          today_activity: 110,
          today_activity_cap: 150,
          online_reward_claimed: true,
          task_reward_count: 1,
          task_reward_cap: 5,
          is_member_accelerated: false,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.token = "mas_token_level";
    client.loaded = true;

    const session = await client.refreshProfile();

    assert.equal(session.profile.level.level, 4);
    assert.deepEqual(session.profile.level.icons, [{ type: "egg_cat", count: 1 }]);
    assert.equal(session.profile.level.current_progress, 1);
    assert.equal(session.profile.level.required_progress, 600);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("refreshProfile keeps cached member level when profile omits it", async () => {
  const dir = await tempDir("profile-level-cache");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ id: "user-level-cache", email: "level-cache@example.com" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.token = "mas_token_level_cache";
    client.profile = {
      id: "user-level-cache",
      level: { level: 5, icons: [{ type: "egg_cat", count: 1 }, { type: "egg", count: 1 }] },
    };
    client.loaded = true;

    const session = await client.refreshProfile();

    assert.equal(session.profile.email, "level-cache@example.com");
    assert.equal(session.profile.level.level, 5);
    assert.deepEqual(session.profile.level.icons, [{ type: "egg_cat", count: 1 }, { type: "egg", count: 1 }]);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("refreshProfile normalizes member level aliases", async () => {
  const dir = await tempDir("profile-level-aliases");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: "user-level-aliases",
        email: "level-aliases@example.com",
        level_summary: {
          current_level: "5",
          level_icons: [{ icon: "egg-cat" }, { key: "egg", value: 1 }],
          currentProgress: 8,
          requiredProgress: 600,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.token = "mas_token_level_aliases";
    client.loaded = true;

    const session = await client.refreshProfile();

    assert.equal(session.profile.level.level, 5);
    assert.deepEqual(session.profile.level.icons, [{ type: "egg_cat", count: 1 }, { type: "egg", count: 1 }]);
    assert.equal(session.profile.level.current_progress, 8);
    assert.equal(session.profile.level.required_progress, 600);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("refreshMemberLevel calls level endpoint and stores summary", async () => {
  const dir = await tempDir("refresh-member-level");
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        enabled: true,
        locked: false,
        level: 64,
        icons: [{ type: "cat_king", count: 1 }],
        current_progress: 1,
        required_progress: 1500,
        today_activity: 150,
        today_activity_cap: 200,
        online_reward_claimed: true,
        task_reward_count: 2,
        task_reward_cap: 5,
        is_member_accelerated: true,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.token = "mas_token_level";
    client.profile = { id: "user-level-2" };
    client.loaded = true;

    const result = await client.refreshMemberLevel();

    assert.equal(requests[0].url, "https://haolo.com/api/level/me");
    assert.equal(requests[0].init.headers.Authorization, "Bearer mas_token_level");
    assert.equal(result.level.level, 64);
    assert.deepEqual(result.session.profile.level.icons, [{ type: "cat_king", count: 1 }]);
    assert.equal(result.session.profile.level.is_member_accelerated, true);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("sendActivityHeartbeat posts client surface and stores returned level", async () => {
  const dir = await tempDir("member-heartbeat");
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        enabled: true,
        locked: false,
        level: 5,
        icons: [{ type: "egg_cat", count: 1 }, { type: "egg", count: 1 }],
        current_progress: 10,
        required_progress: 600,
        today_activity: 120,
        today_activity_cap: 150,
        online_reward_claimed: true,
        task_reward_count: 0,
        task_reward_cap: 5,
        is_member_accelerated: false,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.token = "mas_token_heartbeat";
    client.profile = { id: "user-level-3" };
    client.loaded = true;

    const result = await client.sendActivityHeartbeat({
      onlineSecondsDelta: 60,
      sourceId: "2026-06-05",
      clientVariant: "haolo_windows_web3",
    });

    assert.equal(requests[0].url, "https://haolo.com/api/activity/heartbeat");
    assert.equal(requests[0].init.headers.Authorization, "Bearer mas_token_heartbeat");
    const body = JSON.parse(requests[0].init.body);
    assert.equal(body.surface, "client");
    assert.equal(body.client_variant, "haolo_windows_web3");
    assert.equal(body.online_seconds_delta, 60);
    assert.equal(body.source_id, "2026-06-05");
    assert.equal(result.session.profile.level.level, 5);
    assert.deepEqual(result.session.profile.level.icons, [{ type: "egg_cat", count: 1 }, { type: "egg", count: 1 }]);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("reportTaskCompleted posts client source and stores returned level", async () => {
  const dir = await tempDir("member-task-completed");
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        enabled: true,
        locked: false,
        level: 6,
        icons: [{ type: "cat", count: 1 }, { type: "egg_cat", count: 1 }],
        current_progress: 0,
        required_progress: 900,
        today_activity: 150,
        today_activity_cap: 150,
        online_reward_claimed: true,
        task_reward_count: 1,
        task_reward_cap: 5,
        is_member_accelerated: false,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.token = "mas_token_task";
    client.profile = { id: "user-level-4" };
    client.loaded = true;

    const result = await client.reportTaskCompleted({ taskId: "turn:abc", sourceType: "chat_turn" });

    assert.equal(requests[0].url, "https://haolo.com/api/internal/activity/task-completed");
    assert.equal(requests[0].init.headers.Authorization, "Bearer mas_token_task");
    const body = JSON.parse(requests[0].init.body);
    assert.deepEqual(body, {
      user_id: "user-level-4",
      task_id: "turn:abc",
      surface: "client",
      source_type: "chat_turn",
    });
    assert.equal(result.session.profile.level.level, 6);
    assert.deepEqual(result.session.profile.level.icons, [{ type: "cat", count: 1 }, { type: "egg_cat", count: 1 }]);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("replyExternalChannelMessage uploads local attachments before replying to WeChat", async () => {
  const dir = await tempDir("wechat-reply-attachment");
  const attachmentPath = path.join(dir, "numbers_1_to_100.txt");
  await writeFile(attachmentPath, "1\n2\n", "utf8");

  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), init };
    requests.push(request);
    if (request.url === "https://haolo.com/api/upload/sign") {
      return new Response(
        JSON.stringify({
          data: {
            upload_url: "https://upload.example.com/reply/numbers",
            object_key: "wechat/replies/numbers_1_to_100.txt",
            headers: { "x-upload-token": "signed" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (request.url === "https://upload.example.com/reply/numbers") {
      assert.equal(init.method, "PUT");
      assert.equal(init.headers["Content-Type"], "text/plain");
      assert.equal(init.headers["x-upload-token"], "signed");
      assert.equal(Buffer.from(init.body).toString("utf8"), "1\n2\n");
      return new Response("", { status: 200 });
    }
    if (request.url === "https://haolo.com/api/upload/confirm") {
      return new Response(
        JSON.stringify({
          data: {
            object_key: "wechat/replies/numbers_1_to_100.txt",
            content_type: "text/plain",
            size_bytes: 4,
            url: "https://cdn.example.com/wechat/replies/numbers_1_to_100.txt",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (request.url === "https://wechat.example.com/api/external-channels/wechat/messages/msg-1/reply") {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ detail: `unexpected request ${request.url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.externalChannelsBaseUrl = "https://wechat.example.com";
    client.externalChannelsToken = "wechat-token";
    client.token = "mas_token_upload";
    client.loaded = true;

    const result = await client.replyExternalChannelMessage({
      channel: "wechat",
      messageId: "msg-1",
      text: "已生成 txt 文件：",
      attachments: [
        {
          name: "numbers_1_to_100.txt",
          mime: "text/plain",
          local_path: attachmentPath,
          path: attachmentPath,
        },
      ],
    });

    assert.equal(result.ok, true);
    const signRequest = requests.find((request) => request.url === "https://haolo.com/api/upload/sign");
    assert.equal(signRequest.init.headers.Authorization, "Bearer mas_token_upload");
    const signBody = JSON.parse(signRequest.init.body);
    assert.equal(signBody.file_name, "numbers_1_to_100.txt");
    assert.equal(signBody.content_type, "text/plain");
    assert.equal(signBody.purpose, "external_channel_reply");
    assert.equal(signBody.size_bytes, 4);

    const replyRequest = requests.find((request) => request.url.endsWith("/api/external-channels/wechat/messages/msg-1/reply"));
    assert.equal(replyRequest.init.headers.Authorization, "Bearer wechat-token");
    const replyBody = JSON.parse(replyRequest.init.body);
    assert.equal(replyBody.text, "已生成 txt 文件：");
    assert.equal(replyBody.kind, "final");
    assert.equal(replyBody.attachments.length, 1);
    const replyAttachment = replyBody.attachments[0];
    assert.equal(replyAttachment.name, "numbers_1_to_100.txt");
    assert.equal(replyAttachment.file_name, "numbers_1_to_100.txt");
    assert.equal(replyAttachment.fileName, "numbers_1_to_100.txt");
    assert.equal(replyAttachment.mime, "text/plain");
    assert.equal(replyAttachment.mime_type, "text/plain");
    assert.equal(replyAttachment.mimeType, "text/plain");
    assert.equal(replyAttachment.content_type, "text/plain");
    assert.equal(replyAttachment.contentType, "text/plain");
    assert.equal(replyAttachment.size, 4);
    assert.equal(replyAttachment.size_bytes, 4);
    assert.equal(replyAttachment.sizeBytes, 4);
    assert.equal(replyAttachment.object_key, "wechat/replies/numbers_1_to_100.txt");
    assert.equal(replyAttachment.url, "https://cdn.example.com/wechat/replies/numbers_1_to_100.txt");
    assert.equal(replyAttachment.local_path, attachmentPath);
    assert.equal(replyAttachment.localPath, attachmentPath);
    assert.equal(replyAttachment.path, attachmentPath);
    assert.equal(replyAttachment.file_path, attachmentPath);
    assert.equal(replyAttachment.filePath, attachmentPath);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("replyExternalChannelMessage does not add fallback links for delivered zip attachments", async () => {
  const dir = await tempDir("wechat-reply-zip-fallback");
  const attachmentPath = path.join(dir, "archive.zip");
  await writeFile(attachmentPath, Buffer.from("PK\x03\x04zip"));

  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), init };
    requests.push(request);
    if (request.url === "https://haolo.com/api/upload/sign") {
      return new Response(
        JSON.stringify({
          data: {
            upload_url: "https://upload.example.com/reply/archive",
            object_key: "wechat/replies/archive.zip",
            headers: { "x-upload-token": "signed" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (request.url === "https://upload.example.com/reply/archive") {
      assert.equal(init.method, "PUT");
      assert.equal(init.headers["Content-Type"], "application/zip");
      return new Response("", { status: 200 });
    }
    if (request.url === "https://haolo.com/api/upload/confirm") {
      return new Response(
        JSON.stringify({
          data: {
            object_key: "wechat/replies/archive.zip",
            content_type: "application/zip",
            size_bytes: 7,
            url: "https://cdn.example.com/wechat/replies/archive.zip",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (request.url === "https://wechat.example.com/api/external-channels/wechat/messages/msg-zip/reply") {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ detail: `unexpected request ${request.url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.externalChannelsBaseUrl = "https://wechat.example.com";
    client.externalChannelsToken = "wechat-token";
    client.token = "mas_token_upload";
    client.loaded = true;

    const result = await client.replyExternalChannelMessage({
      channel: "wechat",
      messageId: "msg-zip",
      text: "\u5df2\u6253\u5305\u5b8c\u6210\u3002",
      attachments: [
        {
          name: "archive.zip",
          local_path: attachmentPath,
          path: attachmentPath,
        },
      ],
    });

    assert.equal(result.ok, true);
    const signRequest = requests.find((request) => request.url === "https://haolo.com/api/upload/sign");
    const signBody = JSON.parse(signRequest.init.body);
    assert.equal(signBody.file_name, "archive.zip");
    assert.equal(signBody.content_type, "application/zip");

    const replyRequest = requests.find((request) => request.url.endsWith("/api/external-channels/wechat/messages/msg-zip/reply"));
    const replyBody = JSON.parse(replyRequest.init.body);
    assert.equal(replyBody.text, "\u5df2\u6253\u5305\u5b8c\u6210\u3002");
    assert.equal(replyBody.text.includes("\u4e0b\u8f7d\u94fe\u63a5\uff1a"), false);
    assert.equal(replyBody.text.includes("https://cdn.example.com/wechat/replies/archive.zip"), false);
    assert.equal(replyBody.attachments.length, 1);
    assert.equal(replyBody.attachments[0].file_name, "archive.zip");
    assert.equal(replyBody.attachments[0].mime_type, "application/zip");
    assert.equal(replyBody.attachments[0].size_bytes, 7);
    assert.equal(replyBody.attachments[0].url, "https://cdn.example.com/wechat/replies/archive.zip");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("replyExternalChannelMessage sends large attachments without duplicate fallback links", async () => {
  const dir = await tempDir("wechat-reply-large-attachment");

  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), init };
    requests.push(request);
    if (request.url === "https://wechat.example.com/api/external-channels/wechat/messages/msg-large-link/reply") {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ detail: `unexpected request ${request.url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.externalChannelsBaseUrl = "https://wechat.example.com";
    client.externalChannelsToken = "wechat-token";
    client.loaded = true;

    const result = await client.replyExternalChannelMessage({
      channel: "wechat",
      messageId: "msg-large-link",
      text: "\u5df2\u6253\u5305\u5b8c\u6210\u3002",
      attachments: [
        {
          name: "archive.zip",
          mime: "application/zip",
          size: 63_146_859,
          object_key: "wechat/replies/archive.zip",
          url: "https://cdn.example.com/wechat/replies/archive.zip",
        },
      ],
    });

    assert.equal(result.ok, true);
    const replyRequest = requests.find((request) => request.url.endsWith("/api/external-channels/wechat/messages/msg-large-link/reply"));
    const replyBody = JSON.parse(replyRequest.init.body);
    assert.equal(replyBody.text, "\u5df2\u6253\u5305\u5b8c\u6210\u3002");
    assert.equal(replyBody.text.includes("\u4e0b\u8f7d\u94fe\u63a5\uff1a"), false);
    assert.equal(replyBody.text.includes("https://cdn.example.com/wechat/replies/archive.zip"), false);
    assert.equal(replyBody.attachments.length, 1);
    assert.equal(replyBody.attachments[0].file_name, "archive.zip");
    assert.equal(replyBody.attachments[0].mime_type, "application/zip");
    assert.equal(replyBody.attachments[0].size_bytes, 63_146_859);
    assert.equal(replyBody.attachments[0].url, "https://cdn.example.com/wechat/replies/archive.zip");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("listExternalChannelMessages reports unavailable when local WeChat backend is down", async () => {
  const dir = await tempDir("wechat-messages-unavailable");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const error = new Error("fetch failed");
    error.cause = { code: "ECONNREFUSED" };
    throw error;
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.externalChannelsBaseUrl = "http://127.0.0.1:8010";
    client.externalChannelsToken = "wechat-token";
    client.loaded = true;

    const result = await client.listExternalChannelMessages({ channel: "wechat" });

    assert.equal(result.fallback, true);
    assert.equal(result.connected, false);
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.messages, []);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("startExternalChannelLogin falls back to direct WeChat QR when local backend is down", async () => {
  const dir = await tempDir("wechat-direct-login-fallback");
  const originalFetch = globalThis.fetch;
  const requests = [];
  const qrcodeImage = Buffer.alloc(96, 1).toString("base64");
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), init };
    requests.push(request);
    if (request.url === "http://127.0.0.1:8010/api/external-channels/login/start") {
      const error = new Error("fetch failed");
      error.cause = { code: "ECONNREFUSED" };
      throw error;
    }
    if (request.url === "https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3") {
      return new Response(
        JSON.stringify({
          qrcode: "qr-ticket-1",
          qrcode_img_content: qrcodeImage,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (request.url === "https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=qr-ticket-1") {
      return new Response(JSON.stringify({ status: "binded_redirect" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (request.url === "http://127.0.0.1:8010/api/external-channels/wechat/session/attach") {
      const body = JSON.parse(String(init.body || "{}"));
      assert.equal(body.payload.status, "binded_redirect");
      return new Response(JSON.stringify({ ok: true, channel: "wechat", status: "online", connected: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ detail: `unexpected request ${request.url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.externalChannelsBaseUrl = "http://127.0.0.1:8010";
    client.externalChannelsToken = "wechat-token";
    client.loaded = true;

    const result = await client.startExternalChannelLogin({ channel: "wechat" });

    assert.equal(result.channel, "wechat");
    assert.equal(result.status, "waiting");
    assert.equal(result.direct_qr_only, true);
    assert.equal(result.directQrOnly, true);
    assert.match(result.sessionKey, /^direct-wechat:/);
    assert.equal(result.qrcode, "qr-ticket-1");
    assert.equal(result.qrcodeUrl, `data:image/png;base64,${qrcodeImage}`);
    assert.equal(requests[0].init.headers.Authorization, "Bearer wechat-token");
    assert.equal(requests.length, 2);

    const reconnect = await client.getExternalChannelLogin({ channel: "wechat", sessionKey: result.sessionKey });
    assert.equal(reconnect.status, "connected");
    assert.equal(reconnect.connected, true);
    assert.equal(reconnect.direct_qr_only, false);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("Feishu external channel methods route to local Feishu backend", async () => {
  const dir = await tempDir("feishu-external-channel-routes");
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), init };
    requests.push(request);
    if (request.url === "https://external.example.com/api/external-channels/login/start") {
      const body = JSON.parse(init.body);
      assert.equal(body.channel, "feishu");
      return new Response(
        JSON.stringify({
          channel: "feishu",
          session_key: "feishu-session-1",
          status: "waiting",
          qrcode_url: "data:image/png;base64,ZmVpc2h1",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (request.url === "https://external.example.com/api/external-channels/feishu/login/feishu-session-1") {
      return new Response(JSON.stringify({ channel: "feishu", status: "connected", connected: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (request.url === "https://external.example.com/api/external-channels/feishu/desktop-thread") {
      const body = JSON.parse(init.body);
      assert.equal(body.thread_id, "thread-feishu-1");
      return new Response(JSON.stringify({ ok: true, channel: "feishu", desktop_thread_id: "thread-feishu-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (request.url === "https://external.example.com/api/external-channels/feishu/messages") {
      return new Response(JSON.stringify({ channel: "feishu", messages: [{ id: "fs-msg-1", text: "hello" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (request.url === "https://external.example.com/api/external-channels/feishu/messages/fs-msg-1/reply") {
      const body = JSON.parse(init.body);
      assert.equal(body.text, "reply from haolo");
      assert.equal(body.kind, "final");
      return new Response(JSON.stringify({ ok: true, channel: "feishu", status: "sent" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (request.url === "https://external.example.com/api/external-channels/feishu/disconnect") {
      return new Response(JSON.stringify({ ok: true, channel: "feishu", status: "disconnected" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ detail: `unexpected request ${request.url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.externalChannelsBaseUrl = "https://external.example.com";
    client.externalChannelsToken = "external-token";
    client.loaded = true;

    const start = await client.startExternalChannelLogin({ channel: "feishu" });
    assert.equal(start.channel, "feishu");
    assert.equal(start.qrcodeUrl, "data:image/png;base64,ZmVpc2h1");

    const login = await client.getExternalChannelLogin({ channel: "feishu", sessionKey: "feishu-session-1" });
    assert.equal(login.connected, true);

    const bind = await client.bindExternalChannelThread({ channel: "feishu", threadId: "thread-feishu-1" });
    assert.equal(bind.ok, true);

    const messages = await client.listExternalChannelMessages({ channel: "feishu" });
    assert.equal(messages.messages[0].id, "fs-msg-1");

    const reply = await client.replyExternalChannelMessage({ channel: "feishu", messageId: "fs-msg-1", text: "reply from haolo" });
    assert.equal(reply.status, "sent");

    const disconnect = await client.disconnectExternalChannel({ channel: "feishu" });
    assert.equal(disconnect.status, "disconnected");
    assert.equal(requests.every((request) => request.init.headers.Authorization === "Bearer external-token"), true);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("disconnectExternalChannel sends a WeChat notice before disconnecting", async () => {
  const dir = await tempDir("wechat-disconnect-notice");
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), init };
    requests.push(request);
    if (request.url === "https://wechat.example.com/api/external-channels/wechat/messages/msg-disconnect/reply") {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (request.url === "https://wechat.example.com/api/external-channels/wechat/disconnect") {
      return new Response(JSON.stringify({ ok: true, status: "disconnected" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ detail: `unexpected request ${request.url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.externalChannelsBaseUrl = "https://wechat.example.com";
    client.externalChannelsToken = "wechat-token";
    client.loaded = true;

    const result = await client.disconnectExternalChannel({
      channel: "wechat",
      messageId: "msg-disconnect",
      notifyText: "\u5fae\u4fe1\u5df2\u65ad\u5f00\uff0c\u60a8\u53ef\u4ee5\u518d\u6b21\u626b\u7801\u8fde\u63a5\u3002",
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "disconnected");
    assert.equal(result.disconnect_notice_sent, true);
    assert.equal(result.disconnectNoticeSent, true);

    assert.equal(requests[0].url, "https://wechat.example.com/api/external-channels/wechat/messages/msg-disconnect/reply");
    assert.equal(requests[1].url, "https://wechat.example.com/api/external-channels/wechat/disconnect");
    assert.equal(requests[0].init.headers.Authorization, "Bearer wechat-token");
    assert.equal(requests[1].init.headers.Authorization, "Bearer wechat-token");
    const replyBody = JSON.parse(requests[0].init.body);
    assert.equal(replyBody.kind, "final");
    assert.equal(replyBody.text, "\u5fae\u4fe1\u5df2\u65ad\u5f00\uff0c\u60a8\u53ef\u4ee5\u518d\u6b21\u626b\u7801\u8fde\u63a5\u3002");
    assert.deepEqual(replyBody.attachments, []);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("getTencentAsrCredentials requests an authenticated temporary credential", async () => {
  const dir = await tempDir("tencent-asr-credentials");
  const originalFetch = globalThis.fetch;
  const requests = [];
  const expiresAt = 1_700_001_800;
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      app_id: "1250000000",
      secret_id: "temporary-id",
      secret_key: "temporary-key",
      token: "temporary-token",
      expires_at: expiresAt,
      engine: "16k_zh_en",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.token = "mas_token_asr";
    client.loaded = true;

    const result = await client.getTencentAsrCredentials();

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://haolo.com/api/asr/credentials");
    assert.equal(requests[0].init.method, "POST");
    assert.equal(requests[0].init.headers.Authorization, "Bearer mas_token_asr");
    assert.equal(requests[0].init.body, undefined);
    assert.equal(result.secret_id, "temporary-id");
    assert.equal(result.expires_at, expiresAt);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("login persists refresh credentials only through safeStorage encryption", async () => {
  const dir = await tempDir("encrypted-refresh-session");
  const sessionPath = path.join(dir, "session.json");
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/api/auth/otp/verify")) {
      return new Response(JSON.stringify({
        access_token: labAccessToken(Math.floor(Date.now() / 1000) + 3600),
        expires_in: 3600,
        refresh_token: "refresh-secret-value",
        refresh_expires_in: 90 * 24 * 60 * 60,
        session_id: "session-desktop-1",
        sub2api: { api_key: "sk-test", transit_base_url: "https://aiapi.example.test/v1" },
        profile: { id: "user-1", email: "person@example.com" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url).endsWith("/api/profile/me")) {
      return new Response(JSON.stringify({ id: "user-1", email: "person@example.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const safeStorage = fakeSafeStorage();
    const client = new YouleApiClient({
      storagePath: sessionPath,
      authPath: path.join(dir, "auth.json"),
      safeStorage,
    });
    const session = await client.verifyOtp({
      baseUrl: "https://haolo.com",
      email: "person@example.com",
      code: "123456",
      challengeId: "challenge-1",
      surface: "client",
    });

    const loginRequest = requests.find((request) => request.url.endsWith("/api/auth/otp/verify"));
    const loginBody = JSON.parse(loginRequest.init.body);
    assert.match(loginBody.device_id, /^device_/);
    assert.equal(session.sessionId, "session-desktop-1");
    assert.equal(session.hasRefreshSession, true);

    const rawSession = await readFile(sessionPath, "utf8");
    const saved = JSON.parse(rawSession);
    assert.equal(rawSession.includes("refresh-secret-value"), false);
    assert.equal(Object.hasOwn(saved, "refreshToken"), false);
    assert.ok(saved.refreshTokenEncrypted);

    const restored = new YouleApiClient({ storagePath: sessionPath, safeStorage });
    const restoredSession = await restored.getSession();
    assert.equal(restoredSession.sessionId, "session-desktop-1");
    assert.equal(restoredSession.hasRefreshSession, true);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("client login rejects an access-only response instead of creating a broken session", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({
      access_token: "access-only-must-be-rejected",
      expires_in: 3600,
      sub2api: { api_key: "sk-test" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const client = new YouleApiClient({ safeStorage: fakeSafeStorage() });
    client.loaded = true;
    await assert.rejects(
      client.verifyOtp({
        email: "person@example.com",
        code: "123456",
        challengeId: "challenge-incomplete-session",
        surface: "client",
      }),
      (error) => error instanceof YouleAuthContractError && error.code === "AUTH_SESSION_REQUIRED",
    );
    assert.equal(requestCount, 1);
    assert.equal(client.token, null);
    assert.equal(client.refreshToken, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refreshProfile reports subscription account failures and preserves cached membership", async () => {
  const dir = await tempDir("profile-subscription-refresh-failure");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/api/sub2api/me")) {
      return new Response(JSON.stringify({ detail: "relay unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ id: "user-member", email: "member@example.com" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.baseUrl = "https://haolo.com";
    client.token = "mas_token_member";
    client.profile = {
      id: "user-member",
      email: "member@example.com",
      membership_plan: "basic",
      subscription_balance: 150,
    };
    client.loaded = true;

    await assert.rejects(client.refreshProfile());
    assert.equal(client.profile.membership_plan, "basic");
    assert.equal(client.profile.subscription_balance, 150);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("load removes legacy plaintext refresh fields without importing them", async () => {
  const dir = await tempDir("plaintext-refresh-cleanup");
  const sessionPath = path.join(dir, "session.json");
  await writeFile(sessionPath, JSON.stringify({
    baseUrl: "https://haolo.com",
    token: "access-current",
    refreshToken: "must-not-survive",
    refresh_token: "must-not-survive-either",
    session_id: "session-legacy",
    deviceId: "device-legacy",
  }), "utf8");

  try {
    const client = new YouleApiClient({ storagePath: sessionPath, safeStorage: fakeSafeStorage() });
    const session = await client.getSession();
    const rawSession = await readFile(sessionPath, "utf8");
    const saved = JSON.parse(rawSession);
    assert.equal(rawSession.includes("must-not-survive"), false);
    assert.equal(Object.hasOwn(saved, "refreshToken"), false);
    assert.equal(Object.hasOwn(saved, "refresh_token"), false);
    assert.equal(saved.sessionId, null);
    assert.equal(session.sessionId, null);
    assert.equal(session.hasRefreshSession, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("refreshProfile refreshes centrally provisioned model keys without requiring login", async () => {
  const dir = await tempDir("profile-model-key-refresh");
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    requests.push(requestUrl);
    if (requestUrl.endsWith("/api/sub2api/me/keys")) {
      return new Response(JSON.stringify({
        keys: [
          {
            provider: "doubao",
            api_key: "sk-doubao-refresh",
            base_url: "https://aiapi.example.test/v1",
          },
          {
            provider: "qwen",
            api_key: "sk-qwen-refresh",
            base_url: "https://aiapi.example.test/v1",
          },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (requestUrl.endsWith("/api/sub2api/me")) {
      return new Response(JSON.stringify({ balance: 18 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ id: "user-refresh", email: "person@example.com" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({
      storagePath: path.join(dir, "session.json"),
      authPath: path.join(dir, "auth.json"),
    });
    client.loaded = true;
    client.token = "access-current";
    client.modelKeys = [{ provider: "codex", apiKey: "sk-old", baseUrl: "https://aiapi.example.test/v1" }];

    const session = await client.refreshProfile();

    assert.deepEqual(session.modelProviders.sort(), ["doubao", "qwen"]);
    assert.equal(client.providerKey("doubao").apiKey, "sk-doubao-refresh");
    assert.equal(client.providerKey("qwen").apiKey, "sk-qwen-refresh");
    assert.ok(requests.some((url) => url.endsWith("/api/sub2api/me/keys")));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("empty or malformed session files recover to a valid signed-out session", async () => {
  for (const [name, raw] of [["empty", ""], ["malformed", "{\n"]]) {
    const dir = await tempDir(`recover-${name}-session`);
    const sessionPath = path.join(dir, "session.json");
    await writeFile(sessionPath, raw, "utf8");
    try {
      const client = new YouleApiClient({ storagePath: sessionPath });
      const session = await client.getSession();
      const saved = JSON.parse(await readFile(sessionPath, "utf8"));

      assert.equal(session.authenticated, false);
      assert.match(saved.deviceId, /^device_/);
      assert.deepEqual(await readdir(dir), ["session.json"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("safeStorage unavailability never falls back to plaintext refresh persistence", async () => {
  const dir = await tempDir("refresh-without-safe-storage");
  const sessionPath = path.join(dir, "session.json");
  try {
    const client = new YouleApiClient({ storagePath: sessionPath });
    client.loaded = true;
    client.token = "access-current";
    client.deviceId = "device-current";
    client.setRefreshToken("memory-only-refresh-secret");
    await client.save();

    const rawSession = await readFile(sessionPath, "utf8");
    const saved = JSON.parse(rawSession);
    assert.equal(rawSession.includes("memory-only-refresh-secret"), false);
    assert.equal(saved.token, null);
    assert.equal(saved.sessionId, null);
    assert.equal(saved.refreshTokenEncrypted, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("environment access tokens never mix with or overwrite a persisted refresh session", async () => {
  const dir = await tempDir("environment-token-isolation");
  const sessionPath = path.join(dir, "session.json");
  const originalHaoloToken = process.env.HAOLO_API_TOKEN;
  const originalYouleToken = process.env.YOULE_API_TOKEN;
  const safeStorage = fakeSafeStorage();
  const persisted = {
    baseUrl: "https://haolo.com",
    token: "persisted-access",
    refreshTokenEncrypted: safeStorage.encryptString("persisted-refresh").toString("base64"),
    refreshExpiresAt: Date.now() + 90 * 24 * 60 * 60_000,
    sessionId: "persisted-session",
    deviceId: "persisted-device",
  };
  await writeFile(sessionPath, JSON.stringify(persisted), "utf8");

  try {
    process.env.HAOLO_API_TOKEN = "environment-access";
    delete process.env.YOULE_API_TOKEN;
    const client = new YouleApiClient({ storagePath: sessionPath, safeStorage });
    const session = await client.getSession();
    assert.equal(client.token, "environment-access");
    assert.equal(client.refreshToken, null);
    assert.equal(session.sessionId, null);
    assert.equal(session.hasRefreshSession, false);

    client.profile = { id: "environment-user" };
    await client.save();
    assert.deepEqual(JSON.parse(await readFile(sessionPath, "utf8")), persisted);

    delete process.env.HAOLO_API_TOKEN;
    const restored = new YouleApiClient({ storagePath: sessionPath, safeStorage });
    const restoredSession = await restored.getSession();
    assert.equal(restored.token, "persisted-access");
    assert.equal(restored.refreshToken, "persisted-refresh");
    assert.equal(restoredSession.sessionId, "persisted-session");
  } finally {
    if (originalHaoloToken == null) delete process.env.HAOLO_API_TOKEN;
    else process.env.HAOLO_API_TOKEN = originalHaoloToken;
    if (originalYouleToken == null) delete process.env.YOULE_API_TOKEN;
    else process.env.YOULE_API_TOKEN = originalYouleToken;
    await rm(dir, { recursive: true, force: true });
  }
});

test("same-token encryption failure keeps the last valid ciphertext", () => {
  let failEncryption = false;
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => {
      if (failEncryption) throw new Error("temporary encryption failure");
      return Buffer.from(`encrypted:${value}`, "utf8");
    },
    decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
  };
  const client = new YouleApiClient({ safeStorage });
  client.setRefreshToken("stable-refresh");
  const validCiphertext = client.refreshTokenEncrypted;

  failEncryption = true;
  client.setRefreshToken("stable-refresh");
  assert.equal(client.refreshTokenEncrypted, validCiphertext);
  client.setRefreshToken("rotated-refresh");
  assert.equal(client.refreshTokenEncrypted, null);
});

test("authenticated 401 refreshes once and replays concurrent requests", async () => {
  const originalFetch = globalThis.fetch;
  let refreshCalls = 0;
  let profileCalls = 0;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith("/api/auth/refresh")) {
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({
        access_token: "access-new",
        expires_in: 3600,
        refresh_token: "refresh-stable",
        refresh_expires_in: 90 * 24 * 60 * 60,
        session_id: "session-1",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.endsWith("/api/profile/me")) {
      profileCalls += 1;
      if (init.headers.Authorization === "Bearer access-old") {
        return new Response(JSON.stringify({ code: "ACCESS_TOKEN_EXPIRED" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      assert.equal(init.headers.Authorization, "Bearer access-new");
      return new Response(JSON.stringify({ id: "user-1", email: "person@example.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const client = new YouleApiClient({ safeStorage: fakeSafeStorage() });
    client.loaded = true;
    client.baseUrl = "https://haolo.com";
    client.token = "access-old";
    client.expiresAt = Date.now() + 2 * 60 * 60_000;
    client.accessTokenTtlSeconds = 3600;
    client.deviceId = "device-test";
    client.sessionId = "session-1";
    client.setRefreshToken("refresh-stable");

    const [first, second] = await Promise.all([client.refreshProfile(), client.refreshProfile()]);
    assert.equal(first.authenticated, true);
    assert.equal(second.authenticated, true);
    assert.equal(client.token, "access-new");
    assert.equal(refreshCalls, 1);
    assert.equal(profileCalls, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("external-channel requests using the account token also refresh and replay", async () => {
  const originalFetch = globalThis.fetch;
  let refreshCalls = 0;
  let channelCalls = 0;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith("/api/auth/refresh")) {
      refreshCalls += 1;
      return new Response(JSON.stringify({ access_token: "access-new", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (target.endsWith("/api/external-channels")) {
      channelCalls += 1;
      if (init.headers.Authorization === "Bearer access-old") {
        return new Response(JSON.stringify({ code: "ACCESS_TOKEN_EXPIRED" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      assert.equal(init.headers.Authorization, "Bearer access-new");
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const client = new YouleApiClient({ safeStorage: fakeSafeStorage() });
    client.loaded = true;
    client.baseUrl = "https://haolo.com";
    client.externalChannelsBaseUrl = "https://haolo.com";
    client.token = "access-old";
    client.expiresAt = Date.now() + 2 * 60 * 60_000;
    client.accessTokenTtlSeconds = 3600;
    client.setRefreshToken("refresh-stable");

    await client.listExternalChannels();
    assert.equal(refreshCalls, 1);
    assert.equal(channelCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("transient refresh failure keeps the local session", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/api/auth/refresh")) {
      return new Response(JSON.stringify({ code: "TEMPORARY_UNAVAILABLE" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ code: "ACCESS_TOKEN_EXPIRED" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({ safeStorage: fakeSafeStorage() });
    client.loaded = true;
    client.baseUrl = "https://haolo.com";
    client.token = "access-old";
    client.expiresAt = Date.now() + 2 * 60 * 60_000;
    client.accessTokenTtlSeconds = 3600;
    client.deviceId = "device-test";
    client.setRefreshToken("refresh-stable");

    await assert.rejects(client.refreshProfile(), (error) => !isYouleAuthExpiredError(error));
    assert.equal(client.token, "access-old");
    assert.equal(client.refreshToken, "refresh-stable");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("network, timeout, and any 403 refresh failures keep the local session", async (t) => {
  const cases = [
    ["network", () => {
      throw new TypeError("fetch failed");
    }],
    ["timeout", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }],
    ["structured 403", () => new Response(JSON.stringify({ detail: { code: "SESSION_REVOKED", message: "revoked" } }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })],
  ];

  for (const [name, refreshResponse] of cases) {
    await t.test(name, async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        if (String(url).endsWith("/api/auth/refresh")) return refreshResponse();
        return new Response(JSON.stringify({ code: "ACCESS_TOKEN_EXPIRED" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      };

      try {
        const client = new YouleApiClient({ safeStorage: fakeSafeStorage() });
        client.loaded = true;
        client.baseUrl = "https://haolo.com";
        client.token = "access-old";
        client.expiresAt = Date.now() + 2 * 60 * 60_000;
        client.accessTokenTtlSeconds = 3600;
        client.setRefreshToken("refresh-stable");

        await assert.rejects(client.refreshProfile(), (error) => !isYouleAuthExpiredError(error));
        assert.equal(client.token, "access-old");
        assert.equal(client.refreshToken, "refresh-stable");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
});

test("only a structured terminal refresh response expires authentication", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/api/auth/refresh")) {
      return new Response(JSON.stringify({ detail: { code: "SESSION_REVOKED", message: "session revoked" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ code: "ACCESS_TOKEN_EXPIRED" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({ safeStorage: fakeSafeStorage() });
    client.loaded = true;
    client.baseUrl = "https://haolo.com";
    client.token = "access-old";
    client.expiresAt = Date.now() + 2 * 60 * 60_000;
    client.accessTokenTtlSeconds = 3600;
    client.deviceId = "device-test";
    client.setRefreshToken("refresh-stable");

    await assert.rejects(client.refreshProfile(), (error) => isYouleAuthExpiredError(error) && /session revoked/i.test(error.message));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("expired access token without a refresh token fails locally and never calls refresh", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("refresh endpoint must not be called with an expired access token");
  };

  try {
    const client = new YouleApiClient({ safeStorage: fakeSafeStorage() });
    client.loaded = true;
    client.token = "expired-access-only";
    client.expiresAt = Date.now() - 60_000;
    client.accessTokenTtlSeconds = 3600;

    await assert.rejects(
      client.refreshAccessToken({ force: true, reason: "test-expired-access-only" }),
      (error) => isYouleAuthExpiredError(error) && /缺少刷新凭据/.test(error.message),
    );
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("trusted gateway auth uses an unexpired token without waiting for background refresh", async () => {
  const client = new YouleApiClient({ safeStorage: fakeSafeStorage() });
  client.loaded = true;
  client.token = "still-valid-gateway-token";
  client.expiresAt = Date.now() + 60_000;
  client.accessTokenTtlSeconds = 3_600;
  let releaseRefresh;
  client.refreshPromise = new Promise((resolve) => { releaseRefresh = resolve; });
  try {
    const token = await Promise.race([
      client.getTrustedAccessToken(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("trusted token lookup blocked")), 25)),
    ]);
    assert.equal(token, "still-valid-gateway-token");
  } finally {
    releaseRefresh?.("refreshed-token");
    await client.refreshPromise;
    client.refreshPromise = null;
  }
});

test("legacy access upgrade requires the server to return a complete refresh session", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    access_token: "upgraded-access-without-refresh",
    expires_in: 3600,
  }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    const client = new YouleApiClient({ safeStorage: fakeSafeStorage() });
    client.loaded = true;
    client.token = "still-valid-legacy-access";
    client.expiresAt = Date.now() + 60_000;
    client.accessTokenTtlSeconds = 3600;

    await assert.rejects(
      client.refreshAccessToken({ force: true, reason: "test-incomplete-upgrade" }),
      (error) => isYouleAuthExpiredError(error) && /无法升级/.test(error.message),
    );
    assert.equal(client.token, "still-valid-legacy-access");
    assert.equal(client.refreshToken, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy two-part access tokens refresh proactively before expiry", async () => {
  const dir = await tempDir("legacy-two-part-refresh");
  const sessionPath = path.join(dir, "session.json");
  const originalFetch = globalThis.fetch;
  const oldToken = labAccessToken(Math.floor(Date.now() / 1000) + 60);
  await writeFile(sessionPath, JSON.stringify({
    baseUrl: "https://haolo.com",
    token: oldToken,
    deviceId: "device-legacy",
  }), "utf8");
  let refreshRequest = null;
  globalThis.fetch = async (url, init = {}) => {
    refreshRequest = { url: String(url), init };
    return new Response(JSON.stringify({
      access_token: "legacy-refreshed",
      expires_in: 7200,
      refresh_token: "legacy-refresh-session",
      refresh_expires_in: 90 * 24 * 60 * 60,
      session_id: "legacy-session-id",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({ storagePath: sessionPath });
    await client.getSession();
    assert.equal(refreshRequest.url, "https://haolo.com/api/auth/refresh");
    assert.equal(refreshRequest.init.headers.Authorization, `Bearer ${oldToken}`);
    assert.equal(refreshRequest.init.body, undefined);
    assert.equal(client.token, "legacy-refreshed");
    assert.equal(client.refreshToken, "legacy-refresh-session");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("three-part JWT access tokens also refresh proactively before expiry", async () => {
  const dir = await tempDir("jwt-three-part-refresh");
  const sessionPath = path.join(dir, "session.json");
  const originalFetch = globalThis.fetch;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const oldToken = jwtAccessToken(nowSeconds + 10 * 60, { iat: nowSeconds - (72 * 60 * 60 - 10 * 60) });
  await writeFile(sessionPath, JSON.stringify({
    baseUrl: "https://haolo.com",
    token: oldToken,
    deviceId: "device-jwt",
  }), "utf8");
  let refreshRequest = null;
  globalThis.fetch = async (url, init = {}) => {
    refreshRequest = { url: String(url), init };
    return new Response(JSON.stringify({
      access_token: "jwt-refreshed",
      expires_in: 7200,
      refresh_token: "jwt-refresh-session",
      refresh_expires_in: 90 * 24 * 60 * 60,
      session_id: "jwt-session-id",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({ storagePath: sessionPath });
    await client.getSession();
    assert.equal(refreshRequest.url, "https://haolo.com/api/auth/refresh");
    assert.equal(refreshRequest.init.headers.Authorization, `Bearer ${oldToken}`);
    assert.equal(client.token, "jwt-refreshed");
    assert.equal(client.refreshToken, "jwt-refresh-session");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("logout revokes only known current sessions and always clears locally", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  };

  try {
    const client = new YouleApiClient({ safeStorage: fakeSafeStorage() });
    client.loaded = true;
    client.baseUrl = "https://haolo.com";
    client.token = "access-current";
    client.sessionId = "session-current";
    client.deviceId = "device-current";
    client.setRefreshToken("refresh-current");

    const session = await client.logout();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://haolo.com/api/auth/logout");
    assert.deepEqual(JSON.parse(requests[0].init.body), { refresh_token: "refresh-current" });
    assert.equal(session.authenticated, false);
    assert.equal(client.refreshToken, null);
    assert.equal(client.sessionId, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("logout and a new WeChat login cannot be overwritten by an older refresh response", async () => {
  const originalFetch = globalThis.fetch;
  let releaseRefresh;
  let markRefreshStarted;
  const refreshStarted = new Promise((resolve) => {
    markRefreshStarted = resolve;
  });
  const refreshResponse = new Promise((resolve) => {
    releaseRefresh = resolve;
  });

  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith("/api/auth/refresh")) {
      markRefreshStarted();
      await refreshResponse;
      return new Response(JSON.stringify({
        access_token: "stale-refreshed-access",
        expires_in: 3600,
        refresh_token: "stale-refreshed-session",
        refresh_expires_in: 90 * 24 * 60 * 60,
        session_id: "stale-session",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (target.endsWith("/api/auth/logout")) {
      return new Response(null, { status: 204 });
    }
    if (target.endsWith("/api/auth/wechat/flows/wxf-new/exchange")) {
      return new Response(JSON.stringify({
        access_token: "new-wechat-access",
        expires_in: 3600,
        refresh_token: "new-wechat-refresh",
        refresh_expires_in: 90 * 24 * 60 * 60,
        session_id: "new-wechat-session",
        sub2api: { api_key: "sk-new-wechat", transit_base_url: "https://aiapi.example.test/v1" },
        profile: { id: "new-wechat-user", email: "new@example.com" },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (target.endsWith("/api/profile/me")) {
      return new Response(JSON.stringify({ id: "new-wechat-user", email: "new@example.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (target.endsWith("/api/sub2api/me")) {
      return new Response(JSON.stringify({ balance: 10 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected request ${target}`);
  };

  try {
    const client = new YouleApiClient({ safeStorage: fakeSafeStorage() });
    client.loaded = true;
    client.baseUrl = "https://haolo.com";
    client.token = "old-access";
    client.expiresAt = Date.now() + 60_000;
    client.accessTokenTtlSeconds = 3600;
    client.sessionId = "old-session";
    client.setRefreshToken("old-refresh");

    const staleRefresh = client.refreshAccessToken({ force: true, reason: "logout-race-test" });
    await refreshStarted;
    await client.logout();
    const newSession = await client.exchangeWechatAuthFlow({
      baseUrl: "https://haolo.com",
      flowId: "wxf-new",
      pollToken: "poll-new",
    });
    assert.equal(newSession.authenticated, true);
    assert.equal(newSession.sessionId, "new-wechat-session");

    releaseRefresh();
    await staleRefresh;

    assert.equal(client.token, "new-wechat-access");
    assert.equal(client.refreshToken, "new-wechat-refresh");
    assert.equal(client.sessionId, "new-wechat-session");
    assert.equal(client.profile.id, "new-wechat-user");
  } finally {
    releaseRefresh?.();
    globalThis.fetch = originalFetch;
  }
});

test("ordinary API 403 never expires or refreshes authentication", async () => {
  const originalFetch = globalThis.fetch;
  let refreshCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/api/auth/refresh")) refreshCalls += 1;
    return new Response(JSON.stringify({ code: "FORBIDDEN" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({ safeStorage: fakeSafeStorage() });
    client.loaded = true;
    client.baseUrl = "https://haolo.com";
    client.token = "access-current";
    client.expiresAt = Date.now() + 2 * 60 * 60_000;
    client.accessTokenTtlSeconds = 3600;
    client.deviceId = "device-current";
    client.setRefreshToken("refresh-current");

    await assert.rejects(client.refreshMemberLevel(), (error) => !isYouleAuthExpiredError(error));
    assert.equal(refreshCalls, 0);
    assert.equal(client.token, "access-current");
    assert.equal(client.refreshToken, "refresh-current");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a revoked session from an authenticated API expires authentication", async () => {
  const originalFetch = globalThis.fetch;
  let refreshCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/api/auth/refresh")) refreshCalls += 1;
    return new Response(JSON.stringify({ detail: { message: "session has been revoked" } }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({ safeStorage: fakeSafeStorage() });
    client.loaded = true;
    client.baseUrl = "https://haolo.com";
    client.token = "access-revoked";
    client.expiresAt = Date.now() + 2 * 60 * 60_000;
    client.accessTokenTtlSeconds = 3600;
    client.deviceId = "device-revoked";
    client.setRefreshToken("refresh-revoked");

    await assert.rejects(
      client.refreshMemberLevel(),
      (error) => isYouleAuthExpiredError(error) && /session has been revoked/i.test(error.message),
    );
    assert.equal(refreshCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("concurrent startup callers share one session load", async () => {
  const client = new YouleApiClient();
  let loadCalls = 0;
  client.loadFromStorage = async () => {
    loadCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    client.loaded = true;
    client.token = "access-loaded";
  };

  const [first, second] = await Promise.all([client.getSession(), client.getSession()]);
  assert.equal(loadCalls, 1);
  assert.equal(first.authenticated, true);
  assert.equal(second.authenticated, true);
});

test("uploadMaterialFile completes sign, object upload, confirmation, and material creation", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const requestUrl = String(url);
    requests.push({ url: requestUrl, init });
    if (requestUrl === "https://haolo.example.test/api/upload/sign") {
      return new Response(JSON.stringify({
        upload_url: "https://oss.example.test/materials/probe.txt?signature=test",
        object_key: "materials/probe.txt",
        headers: { "x-oss-test": "signed" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (requestUrl.startsWith("https://oss.example.test/materials/probe.txt")) {
      return new Response("", { status: 200 });
    }
    if (requestUrl === "https://haolo.example.test/api/upload/confirm") {
      return new Response(JSON.stringify({
        object_key: "materials/probe.txt",
        size_bytes: 3,
        content_type: "text/plain",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (requestUrl === "https://haolo.example.test/api/materials") {
      return new Response(JSON.stringify({
        id: "material-probe",
        name: "probe.txt",
        object_key: "materials/probe.txt",
        size: 3,
        mime: "text/plain",
      }), { status: 201, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${requestUrl}`);
  };

  try {
    const client = new YouleApiClient({ safeStorage: fakeSafeStorage() });
    client.loaded = true;
    client.baseUrl = "https://haolo.example.test";
    client.token = "access-upload-test";
    client.expiresAt = Date.now() + 60 * 60_000;
    client.accessTokenTtlSeconds = 3600;
    client.setRefreshToken("refresh-upload-test");

    const result = await client.uploadMaterialFile({
      name: "probe.txt",
      mime: "text/plain",
      size: 3,
      bytes: new Uint8Array([1, 2, 3]).buffer,
      folder: "默认",
    });

    assert.equal(result.material.id, "material-probe");
    assert.deepEqual(requests.map((request) => new URL(request.url).pathname), [
      "/api/upload/sign",
      "/materials/probe.txt",
      "/api/upload/confirm",
      "/api/materials",
    ]);
    assert.equal(requests[0].init.headers.Authorization, "Bearer access-upload-test");
    assert.equal(requests[1].init.headers["x-oss-test"], "signed");
    assert.equal(requests[1].init.headers["Content-Type"], "text/plain");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uploadMaterialFile uses the injected Electron network stack and prefers OSS acceleration", async () => {
  const originalFetch = globalThis.fetch;
  const apiRequests = [];
  const objectRequests = [];
  globalThis.fetch = async (url, init = {}) => {
    const requestUrl = String(url);
    apiRequests.push({ url: requestUrl, init });
    if (requestUrl === "https://haolo.example.test/api/upload/sign") {
      return new Response(JSON.stringify({
        upload_url: "https://youlebucket.oss-ap-southeast-1.aliyuncs.com/material/probe.txt?signature=test",
        object_key: "material/probe.txt",
        headers: { "x-oss-test": "signed" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (requestUrl === "https://haolo.example.test/api/upload/confirm") {
      return new Response(JSON.stringify({
        object_key: "material/probe.txt",
        size_bytes: 3,
        content_type: "text/plain",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (requestUrl === "https://haolo.example.test/api/materials") {
      return new Response(JSON.stringify({
        id: "material-accelerated",
        name: "probe.txt",
        object_key: "material/probe.txt",
        size: 3,
        mime: "text/plain",
      }), { status: 201, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected API request: ${requestUrl}`);
  };

  try {
    const client = new YouleApiClient({
      safeStorage: fakeSafeStorage(),
      networkFetch: async (url, init = {}) => {
        objectRequests.push({ url: String(url), init });
        return new Response("", { status: 200 });
      },
    });
    client.loaded = true;
    client.baseUrl = "https://haolo.example.test";
    client.token = "access-upload-accelerated";
    client.expiresAt = Date.now() + 60 * 60_000;
    client.accessTokenTtlSeconds = 3600;

    const result = await client.uploadMaterialFile({
      name: "probe.txt",
      mime: "text/plain",
      size: 3,
      bytes: new Uint8Array([1, 2, 3]).buffer,
    });

    assert.equal(result.material.id, "material-accelerated");
    assert.deepEqual(objectRequests.map((request) => request.url), [
      "https://youlebucket.oss-accelerate.aliyuncs.com/material/probe.txt?signature=test",
    ]);
    assert.equal(objectRequests[0].init.method, "PUT");
    assert.equal(objectRequests[0].init.headers["x-oss-test"], "signed");
    assert.equal(apiRequests.some((request) => request.url.includes("aliyuncs.com")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uploadMaterialFile falls back to the signed regional OSS URL when acceleration fails", async () => {
  const originalFetch = globalThis.fetch;
  const objectUrls = [];
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl === "https://haolo.example.test/api/upload/sign") {
      return new Response(JSON.stringify({
        upload_url: "https://youlebucket.oss-ap-southeast-1.aliyuncs.com/material/fallback.txt?signature=test",
        object_key: "material/fallback.txt",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (requestUrl === "https://haolo.example.test/api/upload/confirm") {
      return new Response(JSON.stringify({
        object_key: "material/fallback.txt",
        size_bytes: 2,
        content_type: "text/plain",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (requestUrl === "https://haolo.example.test/api/materials") {
      return new Response(JSON.stringify({
        id: "material-fallback",
        name: "fallback.txt",
        object_key: "material/fallback.txt",
        size: 2,
        mime: "text/plain",
      }), { status: 201, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected API request: ${requestUrl}`);
  };

  try {
    const client = new YouleApiClient({
      safeStorage: fakeSafeStorage(),
      networkFetch: async (url) => {
        const requestUrl = String(url);
        objectUrls.push(requestUrl);
        if (requestUrl.includes(".oss-accelerate.aliyuncs.com")) {
          throw new TypeError("fetch failed");
        }
        return new Response("", { status: 200 });
      },
    });
    client.loaded = true;
    client.baseUrl = "https://haolo.example.test";
    client.token = "access-upload-fallback";
    client.expiresAt = Date.now() + 60 * 60_000;
    client.accessTokenTtlSeconds = 3600;

    const result = await client.uploadMaterialFile({
      name: "fallback.txt",
      mime: "text/plain",
      size: 2,
      bytes: new Uint8Array([1, 2]).buffer,
    });

    assert.equal(result.material.id, "material-fallback");
    assert.deepEqual(objectUrls, [
      "https://youlebucket.oss-accelerate.aliyuncs.com/material/fallback.txt?signature=test",
      "https://youlebucket.oss-ap-southeast-1.aliyuncs.com/material/fallback.txt?signature=test",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("desktop main injects Electron net.fetch into material uploads", async () => {
  const source = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  assert.match(
    source,
    /new YouleApiClient\(\{[\s\S]*?networkFetch:\s*appNetworkFetch,[\s\S]*?\}\)/,
  );
  assert.match(
    source,
    /function appNetworkFetch\(url, options = \{\}\)[\s\S]*?net\?\.fetch[\s\S]*?return net\.fetch\(url, options\)/,
  );
});
