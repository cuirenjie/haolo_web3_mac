import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  TencentAsrError,
  buildTencentAsrWebSocketUrl,
  createTencentAsrClient,
  mergeTranscriptSegments,
  normalizeTencentAsrCredentialPayload,
  resolveTencentAsrConfig,
} from "../src/main/tencent-asr.mjs";

const credentials = {
  appId: "1250000000",
  secretId: "test-secret-id",
  secretKey: "test-secret-key",
  token: "",
  hotwordId: "",
  hotwordList: "",
  engine: "16k_zh_en",
};

test("configuration requires all Tencent Cloud credentials", () => {
  assert.throws(
    () => resolveTencentAsrConfig({}),
    (error) => error instanceof TencentAsrError && error.code === "VOICE_NOT_CONFIGURED",
  );
  assert.deepEqual(
    resolveTencentAsrConfig({
      HAOLO_TENCENT_ASR_APP_ID: credentials.appId,
      HAOLO_TENCENT_ASR_SECRET_ID: credentials.secretId,
      HAOLO_TENCENT_ASR_SECRET_KEY: credentials.secretKey,
    }),
    credentials,
  );
});

test("signed websocket URL uses the official sorted HMAC-SHA1 format", () => {
  const url = buildTencentAsrWebSocketUrl(credentials, {
    nowMs: 1_700_000_000_000,
    nonce: 123456,
    voiceId: "voice-test-id",
  });
  const [withoutSignature, encodedSignature] = url.slice("wss://".length).split("&signature=");
  const expected = crypto.createHmac("sha1", credentials.secretKey).update(withoutSignature).digest("base64");
  assert.equal(decodeURIComponent(encodedSignature), expected);
  assert.match(withoutSignature, /engine_model_type=16k_zh_en/);
  assert.match(withoutSignature, /word_info=100/);
  assert.match(withoutSignature, /filter_modal=1/);
  const query = withoutSignature.split("?")[1].split("&");
  assert.deepEqual(query, [...query].sort());
});

test("temporary credential payload is normalized with a millisecond expiry", () => {
  const nowMs = 1_700_000_000_000;
  assert.deepEqual(
    normalizeTencentAsrCredentialPayload(
      {
        app_id: credentials.appId,
        secret_id: "temporary-id",
        secret_key: "temporary-key",
        token: "temporary-token",
        expires_at: nowMs / 1000 + 1800,
        engine: "16k_zh_en",
      },
      { nowMs },
    ),
    {
      appId: credentials.appId,
      secretId: "temporary-id",
      secretKey: "temporary-key",
      token: "temporary-token",
      hotwordId: "",
      hotwordList: "",
      engine: "16k_zh_en",
      expiresAt: nowMs + 1_800_000,
    },
  );
});

test("temporary credential payload rejects missing tokens and near-expiry values", () => {
  const nowMs = 1_700_000_000_000;
  assert.throws(
    () => normalizeTencentAsrCredentialPayload({
      app_id: credentials.appId,
      secret_id: "temporary-id",
      secret_key: "temporary-key",
      expires_at: nowMs / 1000 + 1800,
    }, { nowMs }),
    (error) => error instanceof TencentAsrError && error.code === "VOICE_INVALID_CONFIG",
  );
  assert.throws(
    () => normalizeTencentAsrCredentialPayload({
      app_id: credentials.appId,
      secret_id: "temporary-id",
      secret_key: "temporary-key",
      token: "temporary-token",
      expires_at: nowMs / 1000 + 10,
    }, { nowMs }),
    (error) => error instanceof TencentAsrError && error.code === "VOICE_CREDENTIAL_EXPIRED",
  );
});

test("client awaits an asynchronous temporary credential provider", async () => {
  let socket;
  let resolved = false;
  const client = createTencentAsrClient({
    async getConfig() {
      await Promise.resolve();
      resolved = true;
      return credentials;
    },
    createWebSocket(url) {
      assert.equal(resolved, true);
      socket = new FakeSocket(url);
      queueMicrotask(() => socket.receive({ code: 0, message: "success" }));
      return socket;
    },
  });

  await client.startSession({ requestId: "async-credentials" });
  await client.cancel("async-credentials");
});

test("client streams PCM, emits live text, and returns the stable final result", async () => {
  let socket;
  const events = [];
  const client = createTencentAsrClient({
    getConfig: () => credentials,
    voiceId: () => "voice-test-id",
    nonce: () => 123456,
    nowMs: () => 1_700_000_000_000,
    createWebSocket(url) {
      socket = new FakeSocket(url);
      queueMicrotask(() => socket.receive({ code: 0, message: "success", voice_id: "voice-test-id" }));
      return socket;
    },
  });

  const started = await client.startSession({ requestId: "request-1", onResult: (event) => events.push(event) });
  assert.equal(started.model, "16k_zh_en");
  const pcm = new Int16Array(3200).buffer;
  const sent = await client.sendAudio({ requestId: "request-1", audioBytes: pcm });
  assert.equal(sent.sentBytes, 6400);
  assert.equal(socket.sent.length, 1);
  assert.ok(Buffer.isBuffer(socket.sent[0]));

  socket.receive({
    code: 0,
    result: {
      slice_type: 1,
      index: 0,
      start_time: 0,
      end_time: 800,
      voice_text_str: "帮我查",
      word_list: [{ word: "帮", start_time: 0, end_time: 200, stable_flag: 1 }],
    },
  });
  socket.receive({
    code: 0,
    result: {
      slice_type: 2,
      index: 0,
      start_time: 0,
      end_time: 1200,
      voice_text_str: "帮我查机票。",
      word_list: [],
    },
  });
  socket.receive({
    code: 0,
    result: {
      slice_type: 1,
      index: 1,
      start_time: 1200,
      end_time: 1800,
      voice_text_str: "明天",
      word_list: [],
    },
  });
  assert.equal(events.at(-1).text, "帮我查机票。明天");
  assert.equal(events[0].words[0].stable, true);

  const finishing = client.finishSession({ requestId: "request-1" });
  assert.equal(socket.sent.at(-1), JSON.stringify({ type: "end" }));
  socket.receive({ code: 0, final: 1, voice_id: "voice-test-id" });
  const final = await finishing;
  assert.equal(final.text, "帮我查机票。明天");
  assert.equal(final.final, true);
  assert.equal(client.isActive(), false);
});

test("service errors are surfaced and release the active session", async () => {
  let socket;
  const events = [];
  const client = createTencentAsrClient({
    getConfig: () => credentials,
    createWebSocket(url) {
      socket = new FakeSocket(url);
      queueMicrotask(() => socket.receive({ code: 4002, message: "auth failed" }));
      return socket;
    },
  });
  await assert.rejects(
    client.startSession({ requestId: "bad-auth", onResult: (event) => events.push(event) }),
    (error) => error instanceof TencentAsrError && error.serviceCode === 4002,
  );
  assert.match(events[0].message, /鉴权失败/);
  assert.equal(client.isActive(), false);
  assert.equal(socket.closed, true);
});

test("audio send failures release the active session immediately", async () => {
  let socket;
  const client = createTencentAsrClient({
    getConfig: () => credentials,
    createWebSocket(url) {
      socket = new FakeSocket(url);
      socket.sendError = new Error("network unavailable");
      queueMicrotask(() => socket.receive({ code: 0, message: "success" }));
      return socket;
    },
  });

  await client.startSession({ requestId: "send-failure" });
  await assert.rejects(
    client.sendAudio({ requestId: "send-failure", audioBytes: new Int16Array(3200).buffer }),
    (error) => error instanceof TencentAsrError && error.code === "VOICE_NETWORK_ERROR",
  );
  assert.equal(client.isActive(), false);
  assert.equal(socket.closed, true);
});

test("audio send timeout releases the active session", async () => {
  let socket;
  const client = createTencentAsrClient({
    getConfig: () => credentials,
    sendTimeoutMs: 10,
    createWebSocket(url) {
      socket = new FakeSocket(url);
      socket.skipSendCallback = true;
      queueMicrotask(() => socket.receive({ code: 0, message: "success" }));
      return socket;
    },
  });

  await client.startSession({ requestId: "send-timeout" });
  await assert.rejects(
    client.sendAudio({ requestId: "send-timeout", audioBytes: new Int16Array(3200).buffer }),
    (error) => error instanceof TencentAsrError && error.code === "VOICE_SEND_TIMEOUT",
  );
  assert.equal(client.isActive(), false);
  assert.equal(socket.closed, true);
});

test("oversized PCM chunks are rejected before websocket transmission", async () => {
  let socket;
  const client = createTencentAsrClient({
    getConfig: () => credentials,
    createWebSocket(url) {
      socket = new FakeSocket(url);
      queueMicrotask(() => socket.receive({ code: 0, message: "success" }));
      return socket;
    },
  });

  await client.startSession({ requestId: "oversized-audio" });
  await assert.rejects(
    client.sendAudio({ requestId: "oversized-audio", audioBytes: new Uint8Array(64 * 1024 + 2) }),
    (error) => error instanceof TencentAsrError && error.code === "VOICE_INVALID_AUDIO",
  );
  assert.equal(socket.sent.length, 0);
  assert.equal(client.isActive(), true);
  await client.cancel("oversized-audio");
});

test("segment merge keeps Chinese adjacent and separates English words", () => {
  assert.equal(mergeTranscriptSegments(new Map([[1, "明天。"], [0, "查机票，"]])), "查机票，明天。");
  assert.equal(mergeTranscriptSegments(new Map([[0, "hello"], [1, "world"]])), "hello world");
});

class FakeSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 1;
    this.sent = [];
    this.closed = false;
    this.sendError = null;
    this.skipSendCallback = false;
  }

  send(data, options, callback) {
    if (typeof options === "function") {
      callback = options;
    }
    this.sent.push(data);
    if (!this.skipSendCallback) queueMicrotask(() => callback?.(this.sendError));
  }

  close() {
    this.closed = true;
    this.readyState = 3;
    queueMicrotask(() => this.emit("close"));
  }

  receive(payload) {
    this.emit("message", Buffer.from(JSON.stringify(payload), "utf8"));
  }
}
