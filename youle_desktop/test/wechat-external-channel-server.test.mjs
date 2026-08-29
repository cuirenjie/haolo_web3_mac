import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WechatExternalChannelServer } from "../src/main/wechat-external-channel-server.mjs";

async function tempDir(name) {
  const dir = path.join(os.tmpdir(), `wechat-external-channel-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

class FakeFeishuChannel {
  constructor() {
    this.emitter = new EventEmitter();
    this.sent = [];
    this.connected = false;
    this.disconnected = false;
    this.connectionState = "idle";
  }

  on(name, handler) {
    this.emitter.on(name, handler);
    return () => this.emitter.off(name, handler);
  }

  async connect() {
    this.connected = true;
    this.connectionState = "connected";
  }

  async disconnect() {
    this.disconnected = true;
    this.connected = false;
    this.connectionState = "idle";
  }

  async send(to, input, opts) {
    const payload = { to, input, opts };
    this.sent.push(payload);
    return { messageId: `reply-${this.sent.length}` };
  }

  emitMessage(message) {
    this.emitter.emit("message", message);
  }

  getConnectionStatus() {
    return { state: this.connectionState };
  }
}

async function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for condition");
}

function fakeSafeStorage() {
  return {
    isEncryptionAvailable() {
      return true;
    },
    encryptString(value) {
      return Buffer.from(String(value), "utf8");
    },
    decryptString(value) {
      return Buffer.from(value).toString("utf8");
    },
  };
}

test("local WeChat external channel backend logs in, polls messages, and replies", async () => {
  const dir = await tempDir("happy-path");
  const requests = [];
  const fakeFetch = async (url, init = {}) => {
    const request = { url: String(url), init };
    requests.push(request);
    if (request.url === "https://ilink.example.com/ilink/bot/get_bot_qrcode?bot_type=3") {
      return new Response(JSON.stringify({ qrcode: "qr-1", qrcode_img_content: "data:image/png;base64,abc" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (request.url === "https://ilink.example.com/ilink/bot/get_qrcode_status?qrcode=qr-1") {
      return new Response(
        JSON.stringify({
          status: "confirmed",
          bot_token: "bot-token-1",
          ilink_bot_id: "bot-1",
          ilink_user_id: "wx-user-1",
          baseurl: "https://ilink.example.com",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (request.url === "https://ilink.example.com/ilink/bot/getupdates") {
      const body = JSON.parse(request.init.body);
      assert.equal(body.get_updates_buf, "");
      assert.equal(request.init.headers.Authorization, "Bearer bot-token-1");
      return new Response(
        JSON.stringify({
          ret: 0,
          get_updates_buf: "cursor-1",
          bot_message_list: [
            {
              message_id: "msg-1",
              message_type: 1,
              from_user_id: "human-1",
              to_user_id: "bot-1",
              context_token: "ctx-1",
              create_time_ms: Date.UTC(2026, 0, 1),
              item_list: [{ type: 1, text_item: { text: "hello from wechat" } }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (request.url === "https://ilink.example.com/ilink/bot/sendmessage") {
      const body = JSON.parse(request.init.body);
      assert.equal(request.init.headers.Authorization, "Bearer bot-token-1");
      assert.equal(body.msg.context_token, "ctx-1");
      assert.equal(body.msg.from_user_id, "bot-1");
      assert.equal(body.msg.to_user_id, "human-1");
      assert.equal(body.msg.item_list[0].text_item.text, "reply from desktop");
      return new Response(JSON.stringify({ ret: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: `unexpected request ${request.url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };

  const server = new WechatExternalChannelServer({
    port: 0,
    fetch: fakeFetch,
    ilinkBaseUrl: "https://ilink.example.com",
    statePath: path.join(dir, "state.json"),
    logPath: path.join(dir, "server.log"),
  });

  try {
    const status = await server.start();
    const baseUrl = `http://${status.host}:${status.port}/api/external-channels`;

    const start = await fetch(`${baseUrl}/login/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel: "wechat" }),
    }).then((response) => response.json());
    assert.equal(start.status, "waiting");
    assert.equal(start.qrcode, "qr-1");
    assert.equal(start.direct_qr_only, false);

    const login = await fetch(`${baseUrl}/wechat/login/${encodeURIComponent(start.session_key)}`).then((response) => response.json());
    assert.equal(login.status, "connected");
    assert.equal(login.connected, true);
    assert.equal(login.direct_qr_only, false);

    const bind = await fetch(`${baseUrl}/wechat/desktop-thread`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ thread_id: "thread-1" }),
    }).then((response) => response.json());
    assert.equal(bind.ok, true);
    assert.equal(bind.desktop_thread_id, "thread-1");

    const messages = await fetch(`${baseUrl}/wechat/messages`).then((response) => response.json());
    assert.equal(messages.connected, true);
    assert.equal(messages.messages.length, 1);
    assert.equal(messages.messages[0].id, "msg-1");
    assert.equal(messages.messages[0].text, "hello from wechat");

    const reply = await fetch(`${baseUrl}/wechat/messages/msg-1/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "reply from desktop" }),
    }).then((response) => response.json());
    assert.equal(reply.ok, true);
    assert.equal(reply.status, "sent");
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("local WeChat backend reuses the previous bot token when reconnecting", async () => {
  const dir = await tempDir("wechat-reconnect-token");
  const requests = [];
  const fakeFetch = async (url, init = {}) => {
    const request = { url: String(url), init };
    requests.push(request);
    if (request.url === "https://ilink.example.com/ilink/bot/get_bot_qrcode?bot_type=3") {
      const body = JSON.parse(String(request.init.body || "{}"));
      assert.deepEqual(body.local_token_list, ["bot-token-1"]);
      return new Response(JSON.stringify({ qrcode: "qr-reconnect", qrcode_img_content: "data:image/png;base64,reconnect" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (request.url.endsWith("/ilink/bot/msg/notifystart") || request.url.endsWith("/ilink/bot/msg/notifystop")) {
      return new Response(JSON.stringify({ ret: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: `unexpected request ${request.url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };

  const server = new WechatExternalChannelServer({
    fetch: fakeFetch,
    ilinkBaseUrl: "https://ilink.example.com",
    statePath: path.join(dir, "state.json"),
    logPath: path.join(dir, "server.log"),
  });

  try {
    await server.attachSession({
      payload: {
        bot_token: "bot-token-1",
        ilink_bot_id: "bot-1",
        ilink_user_id: "wx-user-1",
      },
      base_url: "https://ilink.example.com",
    });
    await server.disconnect();

    const login = await server.startLogin({ channel: "wechat" });
    assert.equal(login.status, "waiting");
    assert.equal(login.qrcode, "qr-reconnect");
    assert.equal(requests.filter((request) => request.url.includes("/ilink/bot/get_bot_qrcode")).length, 1);
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("local WeChat backend restores the previous token when reconnect returns binded_redirect", async () => {
  const dir = await tempDir("wechat-reconnect-token-status");
  const requests = [];
  const fakeFetch = async (url, init = {}) => {
    const request = { url: String(url), init };
    requests.push(request);
    if (request.url === "https://ilink.example.com/ilink/bot/get_bot_qrcode?bot_type=3") {
      const body = JSON.parse(String(request.init.body || "{}"));
      assert.deepEqual(body.local_token_list, ["bot-token-1"]);
      return new Response(JSON.stringify({ qrcode: "qr-reconnect", qrcode_img_content: "data:image/png;base64,reconnect" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (request.url === "https://ilink.example.com/ilink/bot/get_qrcode_status?qrcode=qr-reconnect") {
      return new Response(JSON.stringify({ status: "binded_redirect" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (request.url === "https://ilink.example.com/ilink/bot/msg/notifystart") {
      assert.equal(request.init.headers.Authorization, "Bearer bot-token-1");
      return new Response(JSON.stringify({ ret: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: `unexpected request ${request.url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };

  const server = new WechatExternalChannelServer({
    fetch: fakeFetch,
    ilinkBaseUrl: "https://ilink.example.com",
    statePath: path.join(dir, "state.json"),
    logPath: path.join(dir, "server.log"),
  });

  try {
    await server.attachSession({
      payload: {
        bot_token: "bot-token-1",
        ilink_bot_id: "bot-1",
        ilink_user_id: "wx-user-1",
        nickname: "微信用户",
        get_updates_buf: "cursor-1",
      },
      base_url: "https://ilink.example.com",
    });
    await server.disconnect();

    const start = await server.startLogin({ channel: "wechat" });
    const login = await server.getLogin(start.session_key);

    assert.equal(login.status, "connected");
    assert.equal(login.connected, true);
    assert.equal(server.connection.connected, true);
    assert.equal(server.connection.botToken, "bot-token-1");
    assert.equal(server.connection.botId, "bot-1");
    assert.equal(server.connection.userId, "wx-user-1");
    assert.equal(server.connection.cursor, "cursor-1");
    assert.equal(requests.some((request) => request.url.endsWith("/ilink/bot/msg/notifystart")), true);
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("local WeChat backend persists reconnect credentials after disconnect and restart", async () => {
  const dir = await tempDir("wechat-reconnect-persisted-token");
  const statePath = path.join(dir, "state.json");
  const requests = [];
  const fakeFetch = async (url, init = {}) => {
    const request = { url: String(url), init };
    requests.push(request);
    if (request.url.endsWith("/ilink/bot/msg/notifystart") || request.url.endsWith("/ilink/bot/msg/notifystop")) {
      return new Response(JSON.stringify({ ret: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (request.url === "https://ilink.example.com/ilink/bot/get_bot_qrcode?bot_type=3") {
      assert.deepEqual(JSON.parse(String(request.init.body || "{}")).local_token_list, ["bot-token-1"]);
      return new Response(JSON.stringify({ qrcode: "qr-after-restart", qrcode_img_content: "data:image/png;base64,reconnect" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (request.url === "https://ilink.example.com/ilink/bot/get_qrcode_status?qrcode=qr-after-restart") {
      return new Response(JSON.stringify({ status: "binded_redirect" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: `unexpected request ${request.url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const server = new WechatExternalChannelServer({
      fetch: fakeFetch,
      ilinkBaseUrl: "https://ilink.example.com",
      statePath,
      logPath: path.join(dir, "server.log"),
    });
    await server.attachSession({
      payload: {
        bot_token: "bot-token-1",
        ilink_bot_id: "bot-1",
        ilink_user_id: "wx-user-1",
        nickname: "微信用户",
        get_updates_buf: "cursor-1",
      },
      base_url: "https://ilink.example.com",
      desktop_thread_id: "thread-1",
    });
    await server.disconnect();

    const saved = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(saved.connected, false);
    assert.equal(saved.botToken, null);
    assert.equal(saved.wechatReusableConnections[0].botToken, "bot-token-1");

    const restored = new WechatExternalChannelServer({
      fetch: fakeFetch,
      ilinkBaseUrl: "https://ilink.example.com",
      statePath,
      logPath: path.join(dir, "server-restored.log"),
    });
    await restored.loadState();
    assert.equal(restored.connection.connected, false);
    assert.deepEqual(restored.wechatLocalTokenList(), ["bot-token-1"]);

    const start = await restored.startLogin({ channel: "wechat" });
    const login = await restored.getLogin(start.session_key);
    assert.equal(login.status, "connected");
    assert.equal(login.connected, true);
    assert.equal(restored.connection.botToken, "bot-token-1");
    assert.equal(restored.connection.botId, "bot-1");
    assert.equal(restored.connection.userId, "wx-user-1");
    assert.equal(restored.connection.desktopThreadId, "thread-1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local external channel backend connects Telegram, polls messages, and replies", async () => {
  const dir = await tempDir("telegram-happy-path");
  const token = "123456789:AAAbbbcccdddeeefffggghhh";
  const requests = [];
  const fakeFetch = async (url, init = {}) => {
    const request = { url: String(url), init };
    requests.push(request);
    if (request.url === `https://telegram.example.com/bot${token}/getMe`) {
      const body = JSON.parse(request.init.body);
      assert.deepEqual(body, {});
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            id: 123456789,
            is_bot: true,
            first_name: "Haolo",
            username: "haolo_test_bot",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (request.url === `https://telegram.example.com/bot${token}/deleteWebhook`) {
      const body = JSON.parse(request.init.body);
      assert.equal(body.drop_pending_updates, false);
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (request.url === `https://telegram.example.com/bot${token}/getUpdates`) {
      const body = JSON.parse(request.init.body);
      assert.equal(body.timeout, 3);
      assert.deepEqual(body.allowed_updates, ["message", "edited_message"]);
      assert.equal("offset" in body, false);
      return new Response(
        JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 100,
              message: {
                message_id: 10,
                date: 1767225600,
                chat: { id: 777, type: "private", first_name: "Alice" },
                from: { id: 42, first_name: "Alice", username: "alice" },
                text: "hello from telegram",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (request.url === `https://telegram.example.com/bot${token}/sendMessage`) {
      const body = JSON.parse(request.init.body);
      assert.equal(body.chat_id, "777");
      assert.equal(body.text, "reply from desktop");
      assert.deepEqual(body.reply_parameters, { message_id: 10, allow_sending_without_reply: true });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 11 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: false, description: `unexpected request ${request.url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };

  const server = new WechatExternalChannelServer({
    port: 0,
    fetch: fakeFetch,
    safeStorage: fakeSafeStorage(),
    telegramApiBaseUrl: "https://telegram.example.com",
    statePath: path.join(dir, "state.json"),
    logPath: path.join(dir, "server.log"),
  });

  try {
    const status = await server.start();
    const baseUrl = `http://${status.host}:${status.port}/api/external-channels`;

    const start = await fetch(`${baseUrl}/login/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel: "telegram", bot_token: token }),
    }).then((response) => response.json());
    assert.equal(start.channel, "telegram");
    assert.equal(start.status, "connected");
    assert.equal(start.connected, true);
    assert.equal(start.bot_username, "haolo_test_bot");
    assert.equal(start.bot_link, "https://t.me/haolo_test_bot?start=haolo");
    assert.equal(start.start_group_link, "https://t.me/haolo_test_bot?startgroup=haolo");

    const bind = await fetch(`${baseUrl}/telegram/desktop-thread`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ thread_id: "thread-telegram-1" }),
    }).then((response) => response.json());
    assert.equal(bind.ok, true);
    assert.equal(bind.desktop_thread_id, "thread-telegram-1");

    const messages = await fetch(`${baseUrl}/telegram/messages`).then((response) => response.json());
    assert.equal(messages.channel, "telegram");
    assert.equal(messages.connected, true);
    assert.equal(messages.cursor, 101);
    assert.equal(messages.messages.length, 1);
    assert.equal(messages.messages[0].id, "777:10");
    assert.equal(messages.messages[0].text, "hello from telegram");
    assert.equal(messages.messages[0].sender_name, "Alice");
    assert.equal(messages.messages[0].chat_id, "777");

    const reply = await fetch(`${baseUrl}/telegram/messages/${encodeURIComponent("777:10")}/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "reply from desktop" }),
    }).then((response) => response.json());
    assert.equal(reply.ok, true);
    assert.equal(reply.status, "sent");

    const state = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
    assert.equal(state.telegram.desktopThreadId, "thread-telegram-1");
    assert.equal(state.telegram.updateOffset, 101);
    assert.equal(state.telegram.botUsername, "haolo_test_bot");

    const credential = await readFile(path.join(dir, "telegram-credentials.bin"), "utf8");
    assert.ok(credential.includes(token));
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("local Telegram backend restores session from secure credentials", async () => {
  const dir = await tempDir("telegram-restore");
  const token = "123456789:AAAbbbcccdddeeefffggghhh";
  const statePath = path.join(dir, "state.json");
  const safeStorage = fakeSafeStorage();
  const requests = [];
  const fakeFetch = async (url, init = {}) => {
    const request = { url: String(url), init };
    requests.push(request);
    if (request.url === `https://telegram.example.com/bot${token}/getMe`) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            id: 123456789,
            is_bot: true,
            first_name: "Haolo",
            username: "haolo_restore_bot",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (request.url === `https://telegram.example.com/bot${token}/deleteWebhook`) {
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (request.url === `https://telegram.example.com/bot${token}/getUpdates`) {
      const body = JSON.parse(request.init.body);
      if (body.offset === 101) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: [
              {
                update_id: 101,
                message: {
                  message_id: 11,
                  date: 1767225660,
                  chat: { id: 777, type: "private", first_name: "Alice" },
                  from: { id: 42, first_name: "Alice", username: "alice" },
                  text: "hello after restore",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      assert.equal("offset" in body, false);
      return new Response(
        JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 100,
              message: {
                message_id: 10,
                date: 1767225600,
                chat: { id: 777, type: "private", first_name: "Alice" },
                from: { id: 42, first_name: "Alice", username: "alice" },
                text: "hello before restore",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ ok: false, description: `unexpected request ${request.url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const server = new WechatExternalChannelServer({
      fetch: fakeFetch,
      safeStorage,
      telegramApiBaseUrl: "https://telegram.example.com",
      statePath,
      logPath: path.join(dir, "server.log"),
    });
    await server.attachTelegramSession({ bot_token: token, desktop_thread_id: "thread-telegram-restore" });
    const initialMessages = await server.listTelegramMessages();
    assert.equal(initialMessages.cursor, 101);

    const restored = new WechatExternalChannelServer({
      fetch: fakeFetch,
      safeStorage,
      telegramApiBaseUrl: "https://telegram.example.com",
      statePath,
      logPath: path.join(dir, "server-restored.log"),
    });
    await restored.loadState();
    assert.equal(restored.telegramConnection.connected, false);
    assert.equal(restored.telegramCredentialStored, true);

    const restoredMessages = await restored.listTelegramMessages();
    assert.equal(restored.telegramConnection.connected, true);
    assert.equal(restored.telegramConnection.botToken, token);
    assert.equal(restored.telegramConnection.desktopThreadId, "thread-telegram-restore");
    assert.equal(restoredMessages.cursor, 102);
    assert.equal(restoredMessages.messages.length, 1);
    assert.equal(restoredMessages.messages[0].text, "hello after restore");

    const updateBodies = requests.filter((request) => request.url.endsWith("/getUpdates")).map((request) => JSON.parse(request.init.body));
    assert.equal(updateBodies.some((body) => body.offset === 101), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local Telegram backend caches inbound photos as previewable image attachments", async () => {
  const dir = await tempDir("telegram-photo-attachments");
  const token = "123456789:AAAbbbcccdddeeefffggghhh";
  const requests = [];
  const fakeFetch = async (url, init = {}) => {
    const request = { url: String(url), init };
    requests.push(request);
    if (request.url === `https://telegram.example.com/bot${token}/getMe`) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            id: 123456789,
            is_bot: true,
            first_name: "Haolo",
            username: "haolo_test_bot",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (request.url === `https://telegram.example.com/bot${token}/deleteWebhook`) {
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (request.url === `https://telegram.example.com/bot${token}/getUpdates`) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 200,
              message: {
                message_id: 20,
                date: 1767225600,
                chat: { id: 777, type: "private", first_name: "Alice" },
                from: { id: 42, first_name: "Alice" },
                photo: [
                  { file_id: "photo-a-small", file_unique_id: "unique-photo-a", file_size: 128 },
                  { file_id: "photo-a-large", file_unique_id: "unique-photo-a", file_size: 2048 },
                ],
              },
            },
            {
              update_id: 201,
              message: {
                message_id: 21,
                date: 1767225601,
                chat: { id: 777, type: "private", first_name: "Alice" },
                from: { id: 42, first_name: "Alice" },
                photo: [{ file_id: "photo-b-large", file_unique_id: "unique-photo-b", file_size: 4096 }],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (request.url === `https://telegram.example.com/bot${token}/getFile`) {
      const body = JSON.parse(request.init.body);
      const filePath = body.file_id === "photo-a-large" ? "photos/a.jpg" : body.file_id === "photo-b-large" ? "photos/b.jpg" : "";
      assert.ok(filePath, `unexpected getFile id ${body.file_id}`);
      return new Response(JSON.stringify({ ok: true, result: { file_path: filePath, file_size: 4 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (request.url === `https://telegram.example.com/file/bot${token}/photos/a.jpg` || request.url === `https://telegram.example.com/file/bot${token}/photos/b.jpg`) {
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }
    return new Response(JSON.stringify({ ok: false, description: `unexpected request ${request.url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };

  const server = new WechatExternalChannelServer({
    port: 0,
    fetch: fakeFetch,
    safeStorage: fakeSafeStorage(),
    telegramApiBaseUrl: "https://telegram.example.com",
    statePath: path.join(dir, "state.json"),
    logPath: path.join(dir, "server.log"),
    cacheDir: path.join(dir, "cache"),
  });

  try {
    const status = await server.start();
    const baseUrl = `http://${status.host}:${status.port}/api/external-channels`;

    await fetch(`${baseUrl}/login/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel: "telegram", bot_token: token }),
    }).then((response) => response.json());

    const messages = await fetch(`${baseUrl}/telegram/messages`).then((response) => response.json());
    assert.equal(messages.messages.length, 2);

    const [first, second] = messages.messages;
    assert.equal(first.attachments.length, 1);
    assert.equal(second.attachments.length, 1);
    assert.equal(first.attachments[0].object_key, "unique-photo-a");
    assert.equal(second.attachments[0].object_key, "unique-photo-b");
    assert.equal(first.attachments[0].telegram_file_id, "photo-a-large");
    assert.equal(first.attachments[0].mime, "image/jpeg");
    assert.equal(first.attachments[0].url, first.attachments[0].local_path);
    assert.equal(first.attachments[0].preview_url, first.attachments[0].local_path);
    assert.match(first.attachments[0].local_path, /telegram-photo-unique-photo-a\.jpg$/);
    assert.match(second.attachments[0].local_path, /telegram-photo-unique-photo-b\.jpg$/);
    assert.ok(requests.some((request) => request.url === `https://telegram.example.com/file/bot${token}/photos/a.jpg`));
    assert.ok(requests.some((request) => request.url === `https://telegram.example.com/file/bot${token}/photos/b.jpg`));
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("local WeChat backend accepts an existing compatible server without readyz", async () => {
  const legacyServer = http.createServer((request, response) => {
    if (request.url === "/api/external-channels") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ items: [] }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false }));
  });
  await new Promise((resolve, reject) => {
    legacyServer.once("error", reject);
    legacyServer.listen(0, "127.0.0.1", resolve);
  });
  const address = legacyServer.address();
  const port = address && typeof address === "object" ? address.port : 0;
  const server = new WechatExternalChannelServer({ port });

  try {
    const status = await server.start();
    assert.equal(status.ok, true);
    assert.equal(status.external, true);
    assert.equal(status.state, "ready");
  } finally {
    await server.stop();
    await new Promise((resolve) => legacyServer.close(resolve));
  }
});

test("local external channel backend registers Feishu, receives messages, and replies", async () => {
  const dir = await tempDir("feishu-happy-path");
  let registerOptions = null;
  let resolveRegister = null;
  let channelOptions = null;
  const fakeChannel = new FakeFeishuChannel();
  const fakeLark = {
    defaultHttpInstance: { defaults: { proxy: "http://127.0.0.1:10809" } },
    LoggerLevel: { warn: "warn" },
    registerApp(options) {
      registerOptions = options;
      options.onQRCodeReady({ url: "https://accounts.feishu.cn/open-apis/authen/qr-test", expireIn: 600 });
      return new Promise((resolve) => {
        resolveRegister = resolve;
      });
    },
    createLarkChannel(options) {
      channelOptions = options;
      return fakeChannel;
    },
  };
  const server = new WechatExternalChannelServer({
    port: 0,
    lark: fakeLark,
    qrcode: {
      async toDataURL(value) {
        return `data:image/png;base64,${Buffer.from(String(value)).toString("base64")}`;
      },
    },
    statePath: path.join(dir, "state.json"),
    logPath: path.join(dir, "server.log"),
  });

  try {
    const status = await server.start();
    const baseUrl = `http://${status.host}:${status.port}/api/external-channels`;

    const start = await fetch(`${baseUrl}/login/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel: "feishu" }),
    }).then((response) => response.json());
    assert.equal(start.channel, "feishu");
    assert.equal(start.status, "waiting");
    assert.match(start.session_key, /^feishu-/);
    assert.match(start.qrcode_url, /^data:image\/png;base64,/);
    assert.equal(fakeLark.defaultHttpInstance.defaults.proxy, false);
    assert.deepEqual(registerOptions.addons.scopes.tenant, ["im:message:send_as_bot", "im:resource"]);
    assert.deepEqual(registerOptions.addons.events.items.tenant, ["im.message.receive_v1"]);

    resolveRegister({
      client_id: "cli_feishu_1",
      client_secret: "secret-feishu-1",
      user_info: { open_id: "ou_1", tenant_brand: "feishu" },
    });
    await waitFor(async () => server.feishuConnection.connected === true);

    const login = await fetch(`${baseUrl}/feishu/login/${encodeURIComponent(start.session_key)}`).then((response) => response.json());
    assert.equal(login.status, "connected");
    assert.equal(login.connected, true);
    assert.equal(channelOptions.appId, "cli_feishu_1");
    assert.equal(channelOptions.appSecret, "secret-feishu-1");
    assert.equal(channelOptions.transport, "websocket");
    assert.equal(channelOptions.policy.dmMode, "open");
    assert.equal(channelOptions.policy.requireMention, true);
    assert.equal(fakeChannel.connected, true);

    fakeChannel.emitMessage({
      messageId: "fs-msg-1",
      chatId: "oc_chat_1",
      chatType: "p2p",
      senderId: "ou_user_1",
      senderName: "Alice",
      content: "hello from feishu",
      rawContentType: "text",
      resources: [],
      mentions: [],
      mentionAll: false,
      mentionedBot: true,
      createTime: Date.UTC(2026, 0, 1),
    });
    await waitFor(async () => server.feishuMessages.length === 1);

    const messages = await fetch(`${baseUrl}/feishu/messages`).then((response) => response.json());
    assert.equal(messages.channel, "feishu");
    assert.equal(messages.connected, true);
    assert.equal(messages.messages.length, 1);
    assert.equal(messages.messages[0].id, "fs-msg-1");
    assert.equal(messages.messages[0].text, "hello from feishu");
    assert.equal(messages.messages[0].chat_id, "oc_chat_1");

    const reply = await fetch(`${baseUrl}/feishu/messages/fs-msg-1/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "reply from desktop" }),
    }).then((response) => response.json());
    assert.equal(reply.ok, true);
    assert.equal(reply.status, "sent");
    assert.equal(fakeChannel.sent.length, 1);
    assert.equal(fakeChannel.sent[0].to, "oc_chat_1");
    assert.deepEqual(fakeChannel.sent[0].input, { markdown: "reply from desktop" });
    assert.deepEqual(fakeChannel.sent[0].opts, { replyTo: "fs-msg-1" });

    const replyFilePath = path.join(dir, "report.docx");
    await writeFile(replyFilePath, Buffer.from("reply docx", "utf8"));
    const attachmentReply = await fetch(`${baseUrl}/feishu/messages/fs-msg-1/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "处理好了\n\nAttachments:\n- report.docx: https://example.com/report.docx",
        attachments: [{ name: "report.docx", local_path: replyFilePath }],
      }),
    }).then((response) => response.json());
    assert.equal(attachmentReply.ok, true);
    assert.equal(attachmentReply.status, "sent");
    assert.equal(fakeChannel.sent.length, 3);
    assert.deepEqual(fakeChannel.sent[1].input, { markdown: "处理好了" });
    assert.deepEqual(fakeChannel.sent[1].opts, { replyTo: "fs-msg-1" });
    assert.deepEqual(fakeChannel.sent[2].input, { file: { source: replyFilePath, fileName: "report.docx" } });
    assert.deepEqual(fakeChannel.sent[2].opts, { replyTo: "fs-msg-1" });
    assert.equal(attachmentReply.attachments.length, 1);
    assert.equal(attachmentReply.attachments[0].ok, true);
    assert.equal(attachmentReply.attachments[0].kind, "file");

    const disconnect = await fetch(`${baseUrl}/feishu/disconnect`, { method: "POST" }).then((response) => response.json());
    assert.equal(disconnect.status, "disconnected");
    assert.equal(fakeChannel.disconnected, true);
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("local external channel backend restores Feishu session from secure credentials", async () => {
  const dir = await tempDir("feishu-restore-secure-credentials");
  const statePath = path.join(dir, "state.json");
  const safeStorage = fakeSafeStorage();
  const channels = [];
  const fakeLark = {
    LoggerLevel: { warn: "warn" },
    createLarkChannel() {
      const channel = new FakeFeishuChannel();
      channels.push(channel);
      return channel;
    },
  };
  let server = null;
  let restored = null;

  try {
    server = new WechatExternalChannelServer({
      port: 0,
      lark: fakeLark,
      safeStorage,
      statePath,
      logPath: path.join(dir, "server.log"),
      feishuSupervisorIntervalMs: 20,
      feishuReconnectMinIntervalMs: 0,
    });
    await server.start();
    await server.attachFeishuSession({
      payload: {
        app_id: "cli_feishu_restore",
        app_secret: "secret-feishu-restore",
        user_info: { open_id: "ou_restore", tenant_brand: "feishu" },
      },
      desktop_thread_id: "thread-feishu-restore",
    });
    assert.equal(channels.length, 1);
    assert.equal(server.feishuConnection.connected, true);
    await server.stop();
    server = null;

    restored = new WechatExternalChannelServer({
      port: 0,
      lark: fakeLark,
      safeStorage,
      statePath,
      logPath: path.join(dir, "server-restored.log"),
      feishuSupervisorIntervalMs: 20,
      feishuReconnectMinIntervalMs: 0,
    });
    await restored.start();
    await waitFor(async () => restored.feishuConnection.connected === true && channels.length >= 2, 1000);
    assert.equal(restored.feishuConnection.status, "online");
    assert.equal(restored.feishuConnection.appId, "cli_feishu_restore");
    assert.equal(restored.feishuConnection.appSecret, "secret-feishu-restore");
    assert.equal(restored.feishuConnection.desktopThreadId, "thread-feishu-restore");
  } finally {
    if (restored) await restored.stop();
    if (server) await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("local external channel backend supervisor rebuilds unhealthy Feishu websocket", async () => {
  const dir = await tempDir("feishu-supervisor-rebuild");
  const channels = [];
  const fakeLark = {
    LoggerLevel: { warn: "warn" },
    createLarkChannel() {
      const channel = new FakeFeishuChannel();
      channels.push(channel);
      return channel;
    },
  };
  const server = new WechatExternalChannelServer({
    port: 0,
    lark: fakeLark,
    statePath: path.join(dir, "state.json"),
    logPath: path.join(dir, "server.log"),
    feishuSupervisorIntervalMs: 20,
    feishuReconnectMinIntervalMs: 0,
  });

  try {
    await server.start();
    await server.attachFeishuSession({
      payload: {
        app_id: "cli_feishu_rebuild",
        app_secret: "secret-feishu-rebuild",
      },
    });
    assert.equal(channels.length, 1);
    channels[0].connectionState = "failed";
    await waitFor(async () => channels.length >= 2 && channels[1].connected === true, 1000);
    assert.equal(channels[0].disconnected, true);
    assert.equal(server.feishuConnection.connected, true);
    assert.equal(server.feishuConnection.status, "online");
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("local external channel backend downloads inbound Feishu file resources", async () => {
  const dir = await tempDir("feishu-inbound-file");
  const fileBytes = Buffer.from("hello from feishu file", "utf8");
  const requests = [];
  const fakeFetch = async (url, init = {}) => {
    const request = { url: String(url), init };
    requests.push(request);
    if (request.url === "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal") {
      const body = JSON.parse(request.init.body);
      assert.equal(body.app_id, "cli_feishu_file");
      assert.equal(body.app_secret, "secret-feishu-file");
      return new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant-token-1", expire: 7200 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (request.url === "https://open.feishu.cn/open-apis/im/v1/messages/fs-file-1/resources/file-token-1?type=file") {
      assert.equal(request.init.headers.Authorization, "Bearer tenant-token-1");
      return new Response(fileBytes, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      });
    }
    return new Response(JSON.stringify({ message: `unexpected request ${request.url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };
  const fakeChannel = new FakeFeishuChannel();
  const fakeLark = {
    LoggerLevel: { warn: "warn" },
    createLarkChannel() {
      return fakeChannel;
    },
  };
  const server = new WechatExternalChannelServer({
    port: 0,
    lark: fakeLark,
    fetch: fakeFetch,
    statePath: path.join(dir, "state.json"),
    logPath: path.join(dir, "server.log"),
  });

  try {
    await server.start();
    await server.attachFeishuSession({
      payload: {
        app_id: "cli_feishu_file",
        app_secret: "secret-feishu-file",
      },
    });

    fakeChannel.emitMessage({
      messageId: "fs-file-1",
      chatId: "oc_chat_file",
      chatType: "p2p",
      senderId: "ou_user_file",
      senderName: "Alice",
      content: '<file key="file-token-1" name="report.txt"/>',
      rawContentType: "file",
      resources: [
        {
          type: "file",
          fileKey: "file-token-1",
          fileName: "report.txt",
          size: fileBytes.length,
        },
      ],
      mentionedBot: true,
      createTime: Date.UTC(2026, 0, 2),
    });
    await waitFor(async () => server.feishuMessages.length === 1);

    const messages = await server.listFeishuMessages();
    assert.equal(messages.messages.length, 1);
    const message = messages.messages[0];
    assert.equal(message.id, "fs-file-1");
    assert.equal(message.text, "");
    assert.equal(message.content, "");
    assert.equal(message.attachments.length, 1);
    const attachment = message.attachments[0];
    assert.equal(attachment.name, "report.txt");
    assert.equal(attachment.file_key, "file-token-1");
    assert.equal(attachment.object_key, "file-token-1");
    assert.equal(attachment.mime, "text/plain");
    assert.equal(attachment.feishu_download_type, "file");
    assert.match(attachment.local_path, /wechat-inbound-attachments/);
    assert.equal(attachment.url, attachment.local_path);
    assert.equal(attachment.download_url, attachment.local_path);
    assert.deepEqual(await readFile(attachment.local_path), fileBytes);
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("local external channel backend normalizes inbound Feishu image placeholders for previews", async () => {
  const dir = await tempDir("feishu-inbound-images");
  const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const imageKeys = ["img_v3_02136_845e1ec5-0d06-4b2e-9dd0-7c77742cbd9g", "img_v3_02136_ac1aaa8c-2640-4247-85c5-1cafba68993g"];
  const requests = [];
  const fakeFetch = async (url, init = {}) => {
    const request = { url: String(url), init };
    requests.push(request);
    if (request.url === "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal") {
      return new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant-token-images", expire: 7200 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (imageKeys.some((key) => request.url === `https://open.feishu.cn/open-apis/im/v1/messages/fs-image-1/resources/${key}?type=image`)) {
      assert.equal(request.init.headers.Authorization, "Bearer tenant-token-images");
      return new Response(imageBytes, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }
    return new Response(JSON.stringify({ message: `unexpected request ${request.url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };
  const fakeChannel = new FakeFeishuChannel();
  const fakeLark = {
    LoggerLevel: { warn: "warn" },
    createLarkChannel() {
      return fakeChannel;
    },
  };
  const server = new WechatExternalChannelServer({
    port: 0,
    lark: fakeLark,
    fetch: fakeFetch,
    statePath: path.join(dir, "state.json"),
    logPath: path.join(dir, "server.log"),
  });

  try {
    await server.start();
    await server.attachFeishuSession({
      payload: {
        app_id: "cli_feishu_images",
        app_secret: "secret-feishu-images",
      },
    });

    fakeChannel.emitMessage({
      messageId: "fs-image-1",
      chatId: "oc_chat_images",
      chatType: "p2p",
      senderId: "ou_user_images",
      senderName: "Alice",
      content: imageKeys.map((key) => `![image](${key})`).join("\n\n"),
      rawContentType: "post",
      resources: imageKeys.map((key) => ({
        type: "file",
        fileKey: key,
      })),
      mentionedBot: true,
      createTime: Date.UTC(2026, 0, 3),
    });
    await waitFor(async () => server.feishuMessages.length === 1);

    const messages = await server.listFeishuMessages();
    assert.equal(messages.messages.length, 1);
    const message = messages.messages[0];
    assert.equal(message.id, "fs-image-1");
    assert.equal(message.text, "");
    assert.equal(message.content, "");
    assert.equal(message.attachments.length, 2);
    for (let index = 0; index < message.attachments.length; index += 1) {
      const attachment = message.attachments[index];
      assert.equal(attachment.file_key, imageKeys[index]);
      assert.match(attachment.name, /^feishu-image-.+\.jpg$/);
      assert.equal(attachment.mime, "image/jpeg");
      assert.equal(attachment.feishu_download_type, "image");
      assert.equal(attachment.preview_url, attachment.local_path);
      assert.equal(attachment.url, attachment.local_path);
      assert.match(attachment.local_path, /wechat-inbound-attachments/);
      assert.deepEqual(await readFile(attachment.local_path), imageBytes);
    }
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("local external channel backend batches Feishu multi-image messages with source message ids", async () => {
  const dir = await tempDir("feishu-inbound-multi-images");
  const payloads = {
    "fs-image-a:img_v3_02136_first": Buffer.from([0xff, 0xd8, 0xff, 0x01]),
    "fs-image-b:img_v3_02136_second": Buffer.from([0xff, 0xd8, 0xff, 0x02]),
  };
  const fakeFetch = async (url, init = {}) => {
    const requestUrl = String(url);
    if (requestUrl === "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal") {
      return new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant-token-multi-images", expire: 7200 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    for (const [identity, bytes] of Object.entries(payloads)) {
      const [messageId, key] = identity.split(":");
      if (requestUrl === `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${key}?type=image`) {
        assert.equal(init.headers.Authorization, "Bearer tenant-token-multi-images");
        return new Response(bytes, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      }
    }
    return new Response(JSON.stringify({ message: `unexpected request ${requestUrl}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };
  const fakeChannel = new FakeFeishuChannel();
  let larkOptions = null;
  const fakeLark = {
    LoggerLevel: { warn: "warn" },
    createLarkChannel(options) {
      larkOptions = options;
      return fakeChannel;
    },
  };
  const server = new WechatExternalChannelServer({
    port: 0,
    lark: fakeLark,
    fetch: fakeFetch,
    statePath: path.join(dir, "state.json"),
    logPath: path.join(dir, "server.log"),
  });

  try {
    await server.start();
    await server.attachFeishuSession({
      payload: {
        app_id: "cli_feishu_multi_images",
        app_secret: "secret-feishu-multi-images",
      },
    });
    assert.deepEqual(larkOptions.safety, { chatQueue: { enabled: false } });

    fakeChannel.emitMessage({
      messageId: "fs-image-a",
      chatId: "oc_chat_multi_images",
      chatType: "p2p",
      senderId: "ou_user_multi_images",
      senderName: "Alice",
      content: "![image](img_v3_02136_first)",
      rawContentType: "image",
      resources: [{ type: "image", fileKey: "img_v3_02136_first" }],
      mentionedBot: true,
      createTime: Date.UTC(2026, 0, 5),
    });
    fakeChannel.emitMessage({
      messageId: "fs-image-b",
      chatId: "oc_chat_multi_images",
      chatType: "p2p",
      senderId: "ou_user_multi_images",
      senderName: "Alice",
      content: "![image](img_v3_02136_second)",
      rawContentType: "image",
      resources: [{ type: "image", fileKey: "img_v3_02136_second" }],
      mentionedBot: true,
      createTime: Date.UTC(2026, 0, 5) + 100,
    });
    await waitFor(async () => server.feishuMessages.length === 1, 3000);

    const messages = await server.listFeishuMessages();
    assert.equal(messages.messages.length, 1);
    const message = messages.messages[0];
    assert.equal(message.id, "fs-image-b");
    assert.deepEqual(message.source_message_ids, ["fs-image-a", "fs-image-b"]);
    assert.equal(message.text, "");
    assert.equal(message.attachments.length, 2);
    assert.deepEqual(
      message.attachments.map((attachment) => attachment.feishu_message_id),
      ["fs-image-a", "fs-image-b"],
    );
    for (const attachment of message.attachments) {
      assert.equal(attachment.mime, "image/jpeg");
      assert.equal(attachment.feishu_download_type, "image");
      assert.equal(attachment.preview_url, attachment.local_path);
      assert.equal(attachment.url, attachment.local_path);
      assert.match(attachment.local_path, /wechat-inbound-attachments/);
      const bytes = await readFile(attachment.local_path);
      assert.equal(bytes[0], 0xff);
      assert.equal(bytes[1], 0xd8);
      assert.equal(bytes[2], 0xff);
    }
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("local external channel backend strips Feishu placeholders for mixed resource types", async () => {
  const dir = await tempDir("feishu-inbound-mixed-placeholders");
  const payloads = {
    "file_v3_report": Buffer.from("document bytes"),
    "audio_v3_voice": Buffer.from("audio bytes"),
    "media_v3_video": Buffer.from("video bytes"),
  };
  const expectedTypes = {
    "file_v3_report": "file",
    "audio_v3_voice": "audio",
    "media_v3_video": "media",
  };
  const fakeFetch = async (url, init = {}) => {
    const requestUrl = String(url);
    if (requestUrl === "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal") {
      return new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant-token-mixed", expire: 7200 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    for (const [key, bytes] of Object.entries(payloads)) {
      if (requestUrl === `https://open.feishu.cn/open-apis/im/v1/messages/fs-mixed-1/resources/${key}?type=${expectedTypes[key]}`) {
        assert.equal(init.headers.Authorization, "Bearer tenant-token-mixed");
        return new Response(bytes, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        });
      }
    }
    return new Response(JSON.stringify({ message: `unexpected request ${requestUrl}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };
  const fakeChannel = new FakeFeishuChannel();
  const fakeLark = {
    LoggerLevel: { warn: "warn" },
    createLarkChannel() {
      return fakeChannel;
    },
  };
  const server = new WechatExternalChannelServer({
    port: 0,
    lark: fakeLark,
    fetch: fakeFetch,
    statePath: path.join(dir, "state.json"),
    logPath: path.join(dir, "server.log"),
  });

  try {
    await server.start();
    await server.attachFeishuSession({
      payload: {
        app_id: "cli_feishu_mixed",
        app_secret: "secret-feishu-mixed",
      },
    });

    fakeChannel.emitMessage({
      messageId: "fs-mixed-1",
      chatId: "oc_chat_mixed",
      chatType: "p2p",
      senderId: "ou_user_mixed",
      senderName: "Alice",
      content: [
        "请处理这些附件",
        "[report.docx](file_v3_report)",
        '<audio key="audio_v3_voice"/>',
        "media_v3_video",
      ].join("\n\n"),
      rawContentType: "post",
      resources: [
        { type: "file", fileKey: "file_v3_report", fileName: "report.docx" },
        { type: "file", fileKey: "audio_v3_voice" },
        { type: "file", fileKey: "media_v3_video" },
      ],
      mentionedBot: true,
      createTime: Date.UTC(2026, 0, 4),
    });
    await waitFor(async () => server.feishuMessages.length === 1);

    const messages = await server.listFeishuMessages();
    const message = messages.messages[0];
    assert.equal(message.text, "请处理这些附件");
    assert.equal(message.content, "请处理这些附件");
    assert.equal(message.attachments.length, 3);
    assert.deepEqual(
      message.attachments.map((attachment) => attachment.feishu_download_type),
      ["file", "audio", "media"],
    );
    assert.equal(message.attachments[0].name, "report.docx");
    assert.equal(message.attachments[0].mime, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    assert.equal(message.attachments[0].preview_url, null);
    assert.match(message.attachments[1].name, /^feishu-audio-.+\.mp3$/);
    assert.equal(message.attachments[1].mime, "audio/mpeg");
    assert.equal(message.attachments[1].preview_url, null);
    assert.match(message.attachments[2].name, /^feishu-video-.+\.mp4$/);
    assert.equal(message.attachments[2].mime, "video/mp4");
    assert.equal(message.attachments[2].preview_url, message.attachments[2].local_path);
    for (const attachment of message.attachments) {
      assert.match(attachment.local_path, /wechat-inbound-attachments/);
      assert.equal(attachment.url, attachment.local_path);
      assert.equal(attachment.download_url, attachment.local_path);
    }
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("local WeChat backend keeps the channel connected when getupdates times out", async () => {
  const dir = await tempDir("poll-timeout");
  const timeoutError = new Error("operation aborted");
  timeoutError.name = "AbortError";
  const server = new WechatExternalChannelServer({
    fetch: async (url) => {
      if (String(url) === "https://ilink.example.com/ilink/bot/getupdates") {
        throw timeoutError;
      }
      return new Response(JSON.stringify({ ret: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    ilinkBaseUrl: "https://ilink.example.com",
    statePath: path.join(dir, "state.json"),
    logPath: path.join(dir, "server.log"),
  });

  try {
    await server.attachSession({
      payload: {
        bot_token: "bot-token-1",
        ilink_bot_id: "bot-1",
        ilink_user_id: "wx-user-1",
      },
      base_url: "https://ilink.example.com",
    });

    const messages = await server.listMessages();
    assert.equal(messages.connected, true);
    assert.equal(messages.status, "online");
    assert.equal(messages.transient_error, true);
    assert.deepEqual(messages.messages, []);
    assert.equal(server.connection.connected, true);
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("local WeChat backend normalizes inbound image items for preview cards", async () => {
  const dir = await tempDir("inbound-image");
  const imageUrl = "https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=param-1";
  const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const aesKeyHex = "00112233445566778899aabbccddeeff";
  const encryptedImage = encryptAes128EcbForTest(imageBytes, Buffer.from(aesKeyHex, "hex"));
  const aesKeyForMessage = Buffer.from(aesKeyHex, "ascii").toString("base64");
  const fakeFetch = async (url, init = {}) => {
    const requestUrl = String(url);
    if (requestUrl === "https://ilink.example.com/ilink/bot/getupdates") {
      assert.equal(init.headers.Authorization, "Bearer bot-token-1");
      return new Response(
        JSON.stringify({
          ret: 0,
          bot_message_list: [
            {
              message_id: "msg-image-1",
              message_type: 1,
              from_user_id: "human-1",
              to_user_id: "bot-1",
              context_token: "ctx-image-1",
              item_list: [
                {
                  type: 2,
                  image_item: {
                    media: {
                      encrypt_query_param: "param-1",
                      aes_key: aesKeyForMessage,
                      full_url: imageUrl,
                    },
                  },
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (requestUrl === imageUrl) {
      assert.equal(init.headers.Authorization, "Bearer bot-token-1");
      return new Response(encryptedImage, { status: 200, headers: { "content-type": "application/octet-stream" } });
    }
    return new Response(JSON.stringify({ message: `unexpected request ${url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };
  const server = new WechatExternalChannelServer({
    fetch: fakeFetch,
    ilinkBaseUrl: "https://ilink.example.com",
    statePath: path.join(dir, "state.json"),
    logPath: path.join(dir, "server.log"),
  });

  try {
    await server.attachSession({
      payload: {
        bot_token: "bot-token-1",
        ilink_bot_id: "bot-1",
        ilink_user_id: "wx-user-1",
      },
      base_url: "https://ilink.example.com",
    });

    const messages = await server.listMessages();
    assert.equal(messages.messages.length, 1);
    assert.equal(messages.messages[0].id, "msg-image-1");
    assert.equal(messages.messages[0].attachments.length, 1);
    const attachment = messages.messages[0].attachments[0];
    assert.equal(attachment.name, "wechat-image.jpg");
    assert.equal(attachment.file_name, "wechat-image.jpg");
    assert.equal(attachment.mime, "image/jpeg");
    assert.equal(attachment.mime_type, "image/jpeg");
    assert.equal(attachment.object_key, "param-1");
    assert.equal(attachment.aes_key, aesKeyForMessage);
    assert.match(attachment.url, /wechat-inbound-attachments/);
    assert.equal(attachment.url, attachment.preview_url);
    assert.equal(attachment.url, attachment.download_url);
    assert.equal(attachment.url, attachment.local_path);
    assert.equal(attachment.remote_url, imageUrl);
    assert.deepEqual(await readFile(attachment.local_path), imageBytes);
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

function encryptAes128EcbForTest(plaintext, aesKey) {
  const cipher = crypto.createCipheriv("aes-128-ecb", aesKey, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

test("local WeChat backend uploads reply attachments as WeChat file items", async () => {
  const dir = await tempDir("reply-attachment");
  const filePath = path.join(dir, "report.zip");
  const plaintext = Buffer.from("zip-content");
  await writeFile(filePath, plaintext);
  const sendMessages = [];
  let uploadBody = null;
  const fakeFetch = async (url, init = {}) => {
    const requestUrl = String(url);
    if (requestUrl === "https://ilink.example.com/ilink/bot/getupdates") {
      return new Response(
        JSON.stringify({
          ret: 0,
          bot_message_list: [
            {
              message_id: "msg-file-1",
              message_type: 1,
              from_user_id: "human-1",
              to_user_id: "bot-1",
              context_token: "ctx-file-1",
              item_list: [{ type: 1, text_item: { text: "please send file" } }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (requestUrl === "https://ilink.example.com/ilink/bot/sendmessage") {
      const body = JSON.parse(init.body);
      sendMessages.push(body);
      assert.equal(body.msg.context_token, "ctx-file-1");
      assert.equal(body.msg.to_user_id, "human-1");
      return new Response(JSON.stringify({ ret: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (requestUrl === "https://ilink.example.com/ilink/bot/getuploadurl") {
      const body = JSON.parse(init.body);
      assert.equal(body.media_type, 3);
      assert.equal(body.to_user_id, "human-1");
      assert.equal(body.rawsize, plaintext.length);
      assert.equal(body.filesize, 16);
      assert.equal(body.rawfilemd5, "4ad8d70efd803d37c20b040f7c558ad4");
      return new Response(JSON.stringify({ ret: 0, upload_full_url: "https://cdn.example.com/upload" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (requestUrl === "https://cdn.example.com/upload") {
      uploadBody = Buffer.from(init.body);
      assert.equal(init.method, "POST");
      assert.equal(uploadBody.length, 16);
      assert.notDeepEqual(uploadBody.subarray(0, plaintext.length), plaintext);
      return new Response("", { status: 200, headers: { "x-encrypted-param": "download-param-1" } });
    }
    return new Response(JSON.stringify({ message: `unexpected request ${requestUrl}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };

  const server = new WechatExternalChannelServer({
    fetch: fakeFetch,
    ilinkBaseUrl: "https://ilink.example.com",
    cdnBaseUrl: "https://cdn.example.com/c2c",
    statePath: path.join(dir, "state.json"),
    logPath: path.join(dir, "server.log"),
  });

  try {
    await server.attachSession({
      payload: {
        bot_token: "bot-token-1",
        ilink_bot_id: "bot-1",
        ilink_user_id: "wx-user-1",
      },
      base_url: "https://ilink.example.com",
    });
    const messages = await server.listMessages();
    assert.equal(messages.messages[0].id, "msg-file-1");

    const reply = await server.replyMessage("msg-file-1", {
      text: "done",
      attachments: [{ name: "report.zip", local_path: filePath, path: filePath }],
    });
    assert.equal(reply.ok, true);
    assert.equal(reply.attachments.length, 1);
    assert.equal(reply.attachments[0].status, "sent");
    assert.ok(uploadBody);
    assert.equal(sendMessages.length, 2);
    assert.equal(sendMessages[0].msg.item_list[0].type, 1);
    assert.equal(sendMessages[0].msg.item_list[0].text_item.text, "done");
    const fileItem = sendMessages[1].msg.item_list[0];
    assert.equal(fileItem.type, 4);
    assert.equal(fileItem.file_item.file_name, "report.zip");
    assert.equal(fileItem.file_item.len, String(plaintext.length));
    assert.equal(fileItem.file_item.media.encrypt_query_param, "download-param-1");
    assert.equal(fileItem.file_item.media.encrypt_type, 1);
    assert.match(fileItem.file_item.media.aes_key, /^[A-Za-z0-9+/]+=*$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local WeChat backend restores token, cursor, and reply context after restart", async () => {
  const dir = await tempDir("restore-state");
  const statePath = path.join(dir, "state.json");
  const requests = [];
  const fakeFetch = async (url, init = {}) => {
    const request = { url: String(url), init };
    requests.push(request);
    if (request.url === "https://ilink.example.com/ilink/bot/getupdates") {
      assert.equal(request.init.headers.Authorization, "Bearer bot-token-1");
      assert.equal(request.init.headers["X-WECHAT-UIN"], Buffer.from("wx-user-1").toString("base64"));
      return new Response(
        JSON.stringify({
          ret: 0,
          get_updates_buf: "cursor-1",
          bot_message_list: [
            {
              message_id: "msg-restore-1",
              message_type: 1,
              from_user_id: "human-1",
              to_user_id: "bot-1",
              context_token: "ctx-restore-1",
              item_list: [{ type: 1, text_item: { text: "restore me" } }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (request.url === "https://ilink.example.com/ilink/bot/sendmessage") {
      const body = JSON.parse(request.init.body);
      assert.equal(request.init.headers.Authorization, "Bearer bot-token-1");
      assert.equal(request.init.headers["X-WECHAT-UIN"], Buffer.from("wx-user-1").toString("base64"));
      assert.equal(body.msg.context_token, "ctx-restore-1");
      assert.equal(body.msg.from_user_id, "bot-1");
      assert.equal(body.msg.to_user_id, "human-1");
      return new Response(JSON.stringify({ ret: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: `unexpected request ${request.url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const server = new WechatExternalChannelServer({
      fetch: fakeFetch,
      ilinkBaseUrl: "https://ilink.example.com",
      statePath,
      logPath: path.join(dir, "server.log"),
    });
    await server.attachSession({
      payload: {
        bot_token: "bot-token-1",
        ilink_bot_id: "bot-1",
        ilink_user_id: "wx-user-1",
      },
      base_url: "https://ilink.example.com",
      desktop_thread_id: "thread-restore-1",
    });
    assert.equal(server.botHeaders()["X-WECHAT-UIN"], Buffer.from("wx-user-1").toString("base64"));
    const messages = await server.listMessages();
    assert.equal(messages.messages[0].id, "msg-restore-1");

    const restored = new WechatExternalChannelServer({
      fetch: fakeFetch,
      ilinkBaseUrl: "https://ilink.example.com",
      statePath,
      logPath: path.join(dir, "server-restored.log"),
    });
    await restored.loadState();
    assert.equal(restored.connection.connected, true);
    assert.equal(restored.connection.botToken, "bot-token-1");
    assert.equal(restored.connection.cursor, "cursor-1");
    assert.equal(restored.connection.desktopThreadId, "thread-restore-1");

    const reply = await restored.replyMessage("msg-restore-1", { text: "reply after restart" });
    assert.equal(reply.ok, true);
    assert.equal(reply.status, "sent");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
