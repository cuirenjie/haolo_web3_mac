import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8010;
const DEFAULT_API_PATH = "/api/external-channels";
const DEFAULT_WECHAT_ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";
const DEFAULT_WECHAT_ILINK_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
const DEFAULT_FEISHU_OPEN_API_BASE_URL = "https://open.feishu.cn";
const DEFAULT_TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const DEFAULT_WECHAT_ILINK_BOT_TYPE = "3";
const DEFAULT_WECHAT_OPENCLAW_VERSION = "2.4.6";
const LOGIN_SESSION_TTL_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 18_000;
const WECHAT_LOGIN_STATUS_TIMEOUT_MS = Number(process.env.YOULE_WECHAT_LOGIN_STATUS_TIMEOUT_MS || "") || 75_000;
const WECHAT_LIFECYCLE_NOTIFY_TIMEOUT_MS = Number(process.env.YOULE_WECHAT_LIFECYCLE_NOTIFY_TIMEOUT_MS || "") || 5_000;
const GET_UPDATES_TIMEOUT_MS = 15_000;
const TELEGRAM_GET_UPDATES_TIMEOUT_SECONDS = Number(process.env.YOULE_TELEGRAM_GET_UPDATES_TIMEOUT_SECONDS || "") || 3;
const TELEGRAM_GET_UPDATES_TIMEOUT_MS = (TELEGRAM_GET_UPDATES_TIMEOUT_SECONDS + 5) * 1000;
const WECHAT_FILE_UPLOAD_URL_TIMEOUT_MS = 30_000;
const WECHAT_FILE_CDN_UPLOAD_TIMEOUT_MS = 60_000;
const WECHAT_FILE_SEND_TIMEOUT_MS = 45_000;
const WECHAT_INBOUND_ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 60_000;
const FEISHU_INBOUND_ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 60_000;
const TELEGRAM_INBOUND_ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 60_000;
const WECHAT_REPLY_ATTACHMENT_LIMIT = 20;
const WECHAT_MAX_ATTACHMENT_BYTES = Number(process.env.YOULE_WECHAT_MAX_ATTACHMENT_BYTES || "") || 100 * 1024 * 1024;
const TELEGRAM_MAX_ATTACHMENT_BYTES = Number(process.env.YOULE_TELEGRAM_MAX_ATTACHMENT_BYTES || "") || 50 * 1024 * 1024;
const WECHAT_INBOUND_ATTACHMENT_MAX_BYTES = Number(process.env.YOULE_WECHAT_INBOUND_ATTACHMENT_MAX_BYTES || "") || WECHAT_MAX_ATTACHMENT_BYTES;
const FEISHU_INBOUND_ATTACHMENT_MAX_BYTES = Number(process.env.YOULE_FEISHU_INBOUND_ATTACHMENT_MAX_BYTES || "") || WECHAT_INBOUND_ATTACHMENT_MAX_BYTES;
const TELEGRAM_INBOUND_ATTACHMENT_MAX_BYTES = Number(process.env.YOULE_TELEGRAM_INBOUND_ATTACHMENT_MAX_BYTES || "") || 20 * 1024 * 1024;
const FEISHU_TENANT_TOKEN_REFRESH_SKEW_MS = 5 * 60_000;
const MAX_SEEN_MESSAGES = 500;
const MESSAGE_CONTEXT_SOFT_LIMIT = Math.max(
  MAX_SEEN_MESSAGES,
  Number(process.env.YOULE_EXTERNAL_CHANNEL_MESSAGE_CONTEXT_LIMIT || "") || 10_000,
);
const FEISHU_REGISTER_QR_TIMEOUT_MS = 20_000;
const FEISHU_APP_ID_ENV_KEYS = ["YOULE_FEISHU_APP_ID", "LARK_APP_ID", "FEISHU_APP_ID"];
const FEISHU_APP_SECRET_ENV_KEYS = ["YOULE_FEISHU_APP_SECRET", "LARK_APP_SECRET", "FEISHU_APP_SECRET"];
const FEISHU_MESSAGE_QUEUE_LIMIT = 200;
const FEISHU_INBOUND_MESSAGE_BATCH_DELAY_MS = Number(process.env.YOULE_FEISHU_INBOUND_BATCH_DELAY_MS || "") || 700;
const FEISHU_CONNECTION_SUPERVISOR_INTERVAL_MS = Number(process.env.YOULE_FEISHU_CONNECTION_SUPERVISOR_INTERVAL_MS || "") || 3_000;
const FEISHU_RECONNECT_MIN_INTERVAL_MS = Number(process.env.YOULE_FEISHU_RECONNECT_MIN_INTERVAL_MS || "") || 12_000;
const FEISHU_RECONNECTING_REBUILD_AFTER_MS = Number(process.env.YOULE_FEISHU_RECONNECTING_REBUILD_AFTER_MS || "") || 60_000;
const FEISHU_WS_PING_TIMEOUT_SECONDS = Number(process.env.YOULE_FEISHU_WS_PING_TIMEOUT_SECONDS || "") || 20;
const EXTERNAL_CHANNEL_ONLINE_HINT = "连接后请保持电脑在线";

const CHANNEL_ITEMS = [
  { id: "wechat", name: "\u5fae\u4fe1", description: EXTERNAL_CHANNEL_ONLINE_HINT, status: "disconnected", connected: false },
  { id: "telegram", name: "Telegram", description: EXTERNAL_CHANNEL_ONLINE_HINT, status: "disconnected", connected: false },
  { id: "feishu", name: "\u98de\u4e66", description: EXTERNAL_CHANNEL_ONLINE_HINT, status: "disconnected", connected: false },
  { id: "email", name: "\u90ae\u4ef6", description: "\u901a\u8fc7IMAP/SMTP\u8fde\u63a5\u90ae\u7bb1", status: "frontend_only", connected: false },
];

export class WechatExternalChannelServer {
  constructor(options = {}) {
    this.host = options.host || DEFAULT_HOST;
    this.port = Number(options.port ?? process.env.YOULE_EXTERNAL_CHANNELS_PORT ?? DEFAULT_PORT);
    this.apiPath = normalizeApiPath(options.apiPath || process.env.YOULE_API_EXTERNAL_CHANNELS_PATH || DEFAULT_API_PATH);
    this.fetch = options.fetch || globalThis.fetch;
    this.ilinkBaseUrl = normalizeBaseUrl(options.ilinkBaseUrl || process.env.YOULE_WECHAT_ILINK_BASE_URL || DEFAULT_WECHAT_ILINK_BASE_URL);
    this.cdnBaseUrl = normalizeBaseUrl(options.cdnBaseUrl || process.env.YOULE_WECHAT_ILINK_CDN_BASE_URL || DEFAULT_WECHAT_ILINK_CDN_BASE_URL);
    this.feishuOpenApiBaseUrl = normalizeBaseUrl(options.feishuOpenApiBaseUrl || process.env.YOULE_FEISHU_OPEN_API_BASE_URL || DEFAULT_FEISHU_OPEN_API_BASE_URL);
    this.telegramApiBaseUrl = normalizeBaseUrl(options.telegramApiBaseUrl || process.env.YOULE_TELEGRAM_API_BASE_URL || DEFAULT_TELEGRAM_API_BASE_URL);
    this.botType = String(options.botType || process.env.YOULE_WECHAT_ILINK_BOT_TYPE || DEFAULT_WECHAT_ILINK_BOT_TYPE).trim() || DEFAULT_WECHAT_ILINK_BOT_TYPE;
    this.openclawVersion = String(options.openclawVersion || process.env.YOULE_WECHAT_OPENCLAW_VERSION || DEFAULT_WECHAT_OPENCLAW_VERSION).trim() || DEFAULT_WECHAT_OPENCLAW_VERSION;
    this.statePath = options.statePath || null;
    this.logPath = options.logPath || null;
    this.safeStorage = options.safeStorage || null;
    this.feishuCredentialPath = options.feishuCredentialPath || feishuCredentialPathFromOptions(options);
    this.telegramCredentialPath = options.telegramCredentialPath || telegramCredentialPathFromOptions(options);
    this.feishuSupervisorIntervalMs = numberOption(options.feishuSupervisorIntervalMs, FEISHU_CONNECTION_SUPERVISOR_INTERVAL_MS);
    this.feishuReconnectMinIntervalMs = numberOption(options.feishuReconnectMinIntervalMs, FEISHU_RECONNECT_MIN_INTERVAL_MS);
    this.feishuReconnectingRebuildAfterMs = numberOption(options.feishuReconnectingRebuildAfterMs, FEISHU_RECONNECTING_REBUILD_AFTER_MS);
    this.cacheDir = options.cacheDir || inboundAttachmentCacheDir(options);
    this.server = null;
    this.status = "stopped";
    this.external = false;
    this.sessions = new Map();
    this.messageContextById = new Map();
    this.seenMessageIds = [];
    this.wechatReusableBotTokens = [];
    this.wechatReusableConnectionsByToken = new Map();
    this.connection = createDisconnectedConnection();
    this.qrcode = options.qrcode || QRCode;
    this.lark = options.lark || null;
    this.feishuConnection = createDisconnectedFeishuConnection();
    this.feishuChannel = null;
    this.feishuMessages = [];
    this.feishuMessageContextById = new Map();
    this.feishuSeenMessageIds = [];
    this.feishuPendingMessageBatches = new Map();
    this.feishuSupervisorTimer = null;
    this.feishuSupervisorRunning = false;
    this.feishuReconnectPromise = null;
    this.feishuLastReconnectAttemptAt = 0;
    this.feishuReconnectingSince = 0;
    this.feishuCredentialStored = false;
    this.telegramConnection = createDisconnectedTelegramConnection();
    this.telegramMessageContextById = new Map();
    this.telegramSeenMessageIds = [];
    this.telegramCredentialStored = false;
  }

  async start() {
    if (this.status === "ready") return this.getStatus();
    await this.loadState();
    this.status = "starting";
    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => reject(error);
        this.server.once("error", onError);
        this.server.listen(this.port, this.host, () => {
          this.server.off("error", onError);
          const address = this.server.address();
          if (address && typeof address === "object") this.port = address.port;
          resolve();
        });
      });
      this.status = "ready";
      this.startFeishuConnectionSupervisor();
      void this.restoreFeishuSessionIfPossible({ reason: "server start" });
      void this.restoreTelegramSessionIfPossible({ reason: "server start" });
      await this.writeLog("server.started", { host: this.host, port: this.port });
      return this.getStatus();
    } catch (error) {
      this.status = "failed";
      if (error?.code === "EADDRINUSE" && (await this.remoteReady())) {
        this.external = true;
        this.status = "ready";
        await this.writeLog("server.external", { host: this.host, port: this.port });
        return this.getStatus();
      }
      await this.stop();
      throw error;
    }
  }

  async stop() {
    if (!this.server) {
      this.status = "stopped";
      return;
    }
    const server = this.server;
    this.server = null;
    if (this.external) {
      this.external = false;
      this.status = "stopped";
      return;
    }
    this.stopFeishuConnectionSupervisor();
    await this.closeFeishuChannel({ reason: "server stopped" });
    await new Promise((resolve) => server.close(() => resolve()));
    this.status = "stopped";
    await this.writeLog("server.stopped", { host: this.host, port: this.port });
  }

  getStatus(extra = {}) {
    return {
      ok: this.status === "ready",
      state: this.status,
      host: this.host,
      port: this.port,
      external: this.external,
      connected: Boolean(this.connection.connected || this.feishuConnection.connected || this.telegramConnection.connected),
      ...extra,
    };
  }

  async handleRequest(request, response) {
    try {
      if (request.method === "OPTIONS") {
        this.writeJson(response, 204, {});
        return;
      }
      const url = new URL(request.url || "/", `http://${this.host}:${this.port}`);
      if (request.method === "GET" && url.pathname === "/readyz") {
        this.writeJson(response, 200, { ok: true, service: "wechat-external-channel", state: this.status });
        return;
      }
      const route = this.matchApiRoute(url.pathname);
      if (route === null) {
        this.writeJson(response, 404, { ok: false, message: "not found" });
        return;
      }

      if (request.method === "GET" && (route === "" || route === "/")) {
        this.writeJson(response, 200, this.listChannels());
        return;
      }
      if (request.method === "POST" && route === "/login/start") {
        const body = await readJsonBody(request);
        this.writeJson(response, 200, await this.startLogin(body));
        return;
      }
      const loginMatch = route.match(/^\/wechat\/login\/([^/]+)$/);
      if (request.method === "GET" && loginMatch) {
        this.writeJson(response, 200, await this.getLogin(decodeURIComponent(loginMatch[1])));
        return;
      }
      const feishuLoginMatch = route.match(/^\/feishu\/login\/([^/]+)$/);
      if (request.method === "GET" && feishuLoginMatch) {
        this.writeJson(response, 200, await this.getFeishuLogin(decodeURIComponent(feishuLoginMatch[1])));
        return;
      }
      const telegramLoginMatch = route.match(/^\/telegram\/login\/([^/]+)$/);
      if (request.method === "GET" && telegramLoginMatch) {
        this.writeJson(response, 200, await this.getTelegramLogin(decodeURIComponent(telegramLoginMatch[1])));
        return;
      }
      if (request.method === "POST" && route === "/wechat/session/attach") {
        const body = await readJsonBody(request);
        this.writeJson(response, 200, await this.attachSession(body));
        return;
      }
      if (request.method === "POST" && route === "/feishu/session/attach") {
        const body = await readJsonBody(request);
        this.writeJson(response, 200, await this.attachFeishuSession(body));
        return;
      }
      if (request.method === "POST" && route === "/telegram/session/attach") {
        const body = await readJsonBody(request);
        this.writeJson(response, 200, await this.attachTelegramSession(body));
        return;
      }
      if (request.method === "POST" && route === "/wechat/desktop-thread") {
        const body = await readJsonBody(request);
        this.writeJson(response, 200, await this.bindDesktopThread(body));
        return;
      }
      if (request.method === "POST" && route === "/feishu/desktop-thread") {
        const body = await readJsonBody(request);
        this.writeJson(response, 200, await this.bindFeishuDesktopThread(body));
        return;
      }
      if (request.method === "POST" && route === "/telegram/desktop-thread") {
        const body = await readJsonBody(request);
        this.writeJson(response, 200, await this.bindTelegramDesktopThread(body));
        return;
      }
      if (request.method === "GET" && route === "/wechat/messages") {
        this.writeJson(response, 200, await this.listMessages());
        return;
      }
      if (request.method === "GET" && route === "/feishu/messages") {
        this.writeJson(response, 200, await this.listFeishuMessages());
        return;
      }
      if (request.method === "GET" && route === "/telegram/messages") {
        this.writeJson(response, 200, await this.listTelegramMessages());
        return;
      }
      const replyMatch = route.match(/^\/wechat\/messages\/([^/]+)\/reply$/);
      if (request.method === "POST" && replyMatch) {
        const body = await readJsonBody(request);
        this.writeJson(response, 200, await this.replyMessage(decodeURIComponent(replyMatch[1]), body));
        return;
      }
      const feishuReplyMatch = route.match(/^\/feishu\/messages\/([^/]+)\/reply$/);
      if (request.method === "POST" && feishuReplyMatch) {
        const body = await readJsonBody(request);
        this.writeJson(response, 200, await this.replyFeishuMessage(decodeURIComponent(feishuReplyMatch[1]), body));
        return;
      }
      const telegramReplyMatch = route.match(/^\/telegram\/messages\/([^/]+)\/reply$/);
      if (request.method === "POST" && telegramReplyMatch) {
        const body = await readJsonBody(request);
        this.writeJson(response, 200, await this.replyTelegramMessage(decodeURIComponent(telegramReplyMatch[1]), body));
        return;
      }
      if (request.method === "POST" && route === "/wechat/disconnect") {
        this.writeJson(response, 200, await this.disconnect());
        return;
      }
      if (request.method === "POST" && route === "/feishu/disconnect") {
        this.writeJson(response, 200, await this.disconnectFeishu());
        return;
      }
      if (request.method === "POST" && route === "/telegram/disconnect") {
        this.writeJson(response, 200, await this.disconnectTelegram());
        return;
      }
      this.writeJson(response, 404, { ok: false, message: "not found" });
    } catch (error) {
      await this.writeLog("request.error", { message: error?.message || String(error), stack: error?.stack });
      const status = Number(error?.statusCode || error?.status || 500);
      this.writeJson(response, status >= 400 && status < 600 ? status : 500, {
        ok: false,
        status: status === 401 || status === 403 ? "unauthorized" : "error",
        message: error?.message || String(error),
      });
    }
  }

  matchApiRoute(pathname) {
    if (pathname === this.apiPath) return "";
    if (!pathname.startsWith(`${this.apiPath}/`)) return null;
    return pathname.slice(this.apiPath.length);
  }

  writeJson(response, statusCode, payload) {
    response.writeHead(statusCode, {
      "access-control-allow-origin": "http://127.0.0.1",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "authorization,content-type,x-youle-client,x-youle-client-version,x-youle-device-id",
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    if (statusCode === 204) {
      response.end();
      return;
    }
    response.end(JSON.stringify(payload || {}));
  }

  listChannels() {
    const items = CHANNEL_ITEMS.map((item) => {
      if (item.id === "wechat") return this.wechatChannelSummary();
      if (item.id === "telegram") return this.telegramChannelSummary();
      if (item.id === "feishu") return this.feishuChannelSummary();
      return { ...item };
    });
    return { ok: true, data: items, items, channels: items };
  }

  wechatChannelSummary(extra = {}) {
    const connected = Boolean(this.connection.connected);
    return {
      ...CHANNEL_ITEMS[0],
      status: connected ? "online" : this.connection.status || "disconnected",
      connected,
      description: connected ? "\u5df2\u8fde\u63a5\uff0c\u6b63\u5728\u76d1\u542c\u5fae\u4fe1\u6d88\u606f" : CHANNEL_ITEMS[0].description,
      account_label: this.connection.accountLabel || null,
      accountLabel: this.connection.accountLabel || null,
      monitor_running: connected,
      monitorRunning: connected,
      desktop_thread_id: this.connection.desktopThreadId || null,
      desktopThreadId: this.connection.desktopThreadId || null,
      ...extra,
    };
  }

  feishuChannelSummary(extra = {}) {
    const item = CHANNEL_ITEMS.find((channel) => channel.id === "feishu") || CHANNEL_ITEMS[2];
    const connected = Boolean(this.feishuConnection.connected);
    return {
      ...item,
      status: connected ? "online" : this.feishuConnection.status || "disconnected",
      connected,
      description: connected ? "\u5df2\u8fde\u63a5\uff0c\u6b63\u5728\u76d1\u542c\u98de\u4e66\u6d88\u606f" : item.description,
      account_label: this.feishuConnection.accountLabel || null,
      accountLabel: this.feishuConnection.accountLabel || null,
      monitor_running: connected,
      monitorRunning: connected,
      desktop_thread_id: this.feishuConnection.desktopThreadId || null,
      desktopThreadId: this.feishuConnection.desktopThreadId || null,
      app_id: this.feishuConnection.appId || null,
      appId: this.feishuConnection.appId || null,
      ...extra,
    };
  }

  getDiagnosticsSnapshot() {
    return {
      state: this.status,
      connected: Boolean(this.connection.connected || this.feishuConnection.connected || this.telegramConnection.connected),
      wechatContext: this.messageContextById.size,
      wechatSeen: this.seenMessageIds.length,
      feishuContext: this.feishuMessageContextById.size,
      feishuSeen: this.feishuSeenMessageIds.length,
      feishuQueuedMessages: this.feishuMessages.length,
      feishuPendingBatches: this.feishuPendingMessageBatches.size,
      telegramContext: this.telegramMessageContextById.size,
      telegramSeen: this.telegramSeenMessageIds.length,
      contextSoftLimit: MESSAGE_CONTEXT_SOFT_LIMIT,
    };
  }

  telegramChannelSummary(extra = {}) {
    const item = CHANNEL_ITEMS.find((channel) => channel.id === "telegram") || CHANNEL_ITEMS[1];
    const connected = Boolean(this.telegramConnection.connected && this.telegramConnection.botToken);
    return {
      ...item,
      status: connected ? "online" : this.telegramConnection.status || "disconnected",
      connected,
      description: connected ? "\u5df2\u8fde\u63a5\uff0c\u6b63\u5728\u76d1\u542cTelegram\u6d88\u606f" : item.description,
      account_label: this.telegramConnection.accountLabel || null,
      accountLabel: this.telegramConnection.accountLabel || null,
      monitor_running: connected,
      monitorRunning: connected,
      desktop_thread_id: this.telegramConnection.desktopThreadId || null,
      desktopThreadId: this.telegramConnection.desktopThreadId || null,
      bot_username: this.telegramConnection.botUsername || null,
      botUsername: this.telegramConnection.botUsername || null,
      bot_id: this.telegramConnection.botId || null,
      botId: this.telegramConnection.botId || null,
      credential_stored: Boolean(this.telegramCredentialStored),
      credentialStored: Boolean(this.telegramCredentialStored),
      ...extra,
    };
  }

  async startTelegramLogin(body = {}) {
    const token = firstString(body.bot_token, body.botToken, body.token, body.access_token, body.accessToken);
    const session = {
      sessionKey: `telegram-${crypto.randomUUID()}`,
      channel: "telegram",
      status: token ? "connecting" : "waiting",
      createdAt: Date.now(),
      error: null,
      attachResult: null,
    };
    this.sessions.set(session.sessionKey, session);
    if (!token) {
      await this.writeLog("telegram.login.started", { sessionKey: session.sessionKey, tokenProvided: false });
      return telegramLoginPayload(session);
    }
    try {
      const attached = await this.attachTelegramSession({
        bot_token: token,
        desktop_thread_id: firstString(body.desktop_thread_id, body.desktopThreadId),
      });
      session.status = "connected";
      session.attachResult = attached;
      await this.writeLog("telegram.login.connected", {
        sessionKey: session.sessionKey,
        botUsername: this.telegramConnection.botUsername,
      });
      return telegramLoginPayload(session, {
        status: "connected",
        connected: true,
        attach_result: attached,
        attachResult: attached,
        desktop_thread_id: attached.desktop_thread_id,
        desktopThreadId: attached.desktopThreadId,
        bot_username: this.telegramConnection.botUsername,
        botUsername: this.telegramConnection.botUsername,
        bot_link: telegramBotLink(this.telegramConnection.botUsername),
        botLink: telegramBotLink(this.telegramConnection.botUsername),
        start_group_link: telegramBotStartGroupLink(this.telegramConnection.botUsername),
        startGroupLink: telegramBotStartGroupLink(this.telegramConnection.botUsername),
      });
    } catch (error) {
      session.status = "error";
      session.error = error?.message || String(error);
      await this.writeLog("telegram.login.error", { sessionKey: session.sessionKey, message: session.error });
      throw error;
    }
  }

  async getTelegramLogin(sessionKey) {
    const session = this.sessions.get(sessionKey);
    if (!session) {
      return { ok: false, channel: "telegram", session_key: sessionKey, sessionKey, status: "expired", connected: false };
    }
    if (Date.now() - session.createdAt > LOGIN_SESSION_TTL_MS) {
      session.status = "expired";
      this.sessions.delete(sessionKey);
      return telegramLoginPayload(session, { status: "expired", connected: false });
    }
    return telegramLoginPayload(session, {
      connected: session.status === "connected",
      attach_result: session.attachResult || null,
      attachResult: session.attachResult || null,
      bot_username: this.telegramConnection.botUsername || null,
      botUsername: this.telegramConnection.botUsername || null,
      bot_link: telegramBotLink(this.telegramConnection.botUsername),
      botLink: telegramBotLink(this.telegramConnection.botUsername),
      start_group_link: telegramBotStartGroupLink(this.telegramConnection.botUsername),
      startGroupLink: telegramBotStartGroupLink(this.telegramConnection.botUsername),
    });
  }

  async startFeishuLogin(body = {}) {
    const appId = firstString(body.app_id, body.appId, envFirst(FEISHU_APP_ID_ENV_KEYS));
    const appSecret = firstString(body.app_secret, body.appSecret, envFirst(FEISHU_APP_SECRET_ENV_KEYS));
    const existingAppId = firstString(body.existing_app_id, body.existingAppId, appId);
    if (appId && appSecret) {
      const attached = await this.attachFeishuSession({
        app_id: appId,
        app_secret: appSecret,
        desktop_thread_id: firstString(body.desktop_thread_id, body.desktopThreadId),
        user_info: objectValue(body.user_info) || objectValue(body.userInfo),
      });
      const session = {
        sessionKey: `feishu-${crypto.randomUUID()}`,
        channel: "feishu",
        status: "connected",
        createdAt: Date.now(),
        qrcode: null,
        qrcodeImage: null,
        attachResult: attached,
      };
      return feishuLoginPayload(session, {
        status: "connected",
        connected: true,
        attach_result: attached,
        attachResult: attached,
        desktop_thread_id: attached.desktop_thread_id,
        desktopThreadId: attached.desktopThreadId,
      });
    }

    const lark = await this.larkModule();
    if (!lark?.registerApp) throw httpError(500, "Feishu SDK registerApp is unavailable");
    const controller = new AbortController();
    const sessionKey = `feishu-${crypto.randomUUID()}`;
    const session = {
      sessionKey,
      channel: "feishu",
      status: "waiting",
      createdAt: Date.now(),
      qrcode: null,
      qrcodeImage: null,
      qrcodeExpireIn: null,
      notice: null,
      error: null,
      controller,
      registrationPromise: null,
      attachResult: null,
    };
    this.sessions.set(sessionKey, session);

    let resolveQr;
    let rejectQr;
    let qrReady = false;
    const qrReadyPromise = new Promise((resolve, reject) => {
      resolveQr = resolve;
      rejectQr = reject;
    });
    session.registrationPromise = Promise.resolve()
      .then(() =>
        lark.registerApp({
          source: "haolo-desktop",
          signal: controller.signal,
          appId: existingAppId || undefined,
          createOnly: firstBoolean(body.create_only, body.createOnly) === true,
          appPreset: {
            name: firstString(body.app_name, body.appName) || "Haolo",
            desc: firstString(body.app_desc, body.appDesc) || "Haolo desktop Feishu bridge",
          },
          addons: {
            scopes: { tenant: ["im:message:send_as_bot", "im:resource"] },
            events: { items: { tenant: ["im.message.receive_v1"] } },
          },
          onQRCodeReady: (info) => {
            const url = firstString(info?.url);
            if (!url) {
              rejectQr?.(new Error("Feishu registerApp did not provide a verification URL"));
              return;
            }
            session.qrcode = url;
            session.qrcodeExpireIn = Number(info?.expireIn || 0) || null;
            void this.qrcode
              .toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 260 })
              .then((dataUrl) => {
                session.qrcodeImage = dataUrl || url;
                if (!qrReady) {
                  qrReady = true;
                  resolveQr?.();
                }
              })
              .catch((error) => {
                session.qrcodeImage = url;
                if (!qrReady) {
                  qrReady = true;
                  resolveQr?.();
                }
                void this.writeLog("feishu.login.qrcode_image_error", { sessionKey, message: error?.message || String(error) });
              });
          },
          onStatusChange: (info) => {
            const status = firstString(info?.status);
            session.notice = status || session.notice;
          },
        }),
      )
      .then(async (result) => {
        const attached = await this.attachFeishuSession({
          app_id: result?.client_id,
          app_secret: result?.client_secret,
          user_info: result?.user_info,
          desktop_thread_id: firstString(body.desktop_thread_id, body.desktopThreadId, this.feishuConnection.desktopThreadId),
        });
        session.status = "connected";
        session.attachResult = attached;
        await this.writeLog("feishu.login.connected", { sessionKey, appId: attached.app_id || attached.appId });
        return attached;
      })
      .catch((error) => {
        if (error?.name === "AbortError" || error?.code === "abort") {
          session.status = "expired";
        } else if (error?.code === "expired_token") {
          session.status = "expired";
        } else {
          session.status = "error";
        }
        session.error = error?.description || error?.message || String(error);
        void this.writeLog("feishu.login.error", { sessionKey, status: session.status, message: session.error });
      });

    try {
      await promiseWithTimeout(qrReadyPromise, FEISHU_REGISTER_QR_TIMEOUT_MS, "Feishu verification QR request timed out");
    } catch (error) {
      session.status = "error";
      session.error = error?.message || String(error);
      controller.abort();
      throw error;
    }
    await this.writeLog("feishu.login.started", { sessionKey, expiresIn: session.qrcodeExpireIn });
    return feishuLoginPayload(session);
  }

  async getFeishuLogin(sessionKey) {
    const session = this.sessions.get(sessionKey);
    if (!session) {
      return { ok: false, channel: "feishu", session_key: sessionKey, sessionKey, status: "expired", connected: false };
    }
    if (Date.now() - session.createdAt > LOGIN_SESSION_TTL_MS && session.status !== "connected") {
      session.status = "expired";
      session.controller?.abort?.();
      this.sessions.delete(sessionKey);
      return feishuLoginPayload(session, { status: "expired", connected: false });
    }
    const connected = session.status === "connected" || this.feishuConnection.connected;
    if (connected) {
      return feishuLoginPayload(session, {
        status: "connected",
        connected: true,
        attach_result: session.attachResult,
        attachResult: session.attachResult,
        desktop_thread_id: this.feishuConnection.desktopThreadId || null,
        desktopThreadId: this.feishuConnection.desktopThreadId || null,
      });
    }
    return feishuLoginPayload(session, {
      status: session.status || "waiting",
      connected: false,
      message: session.error || session.notice || null,
    });
  }

  async attachFeishuSession(body = {}) {
    const payload = objectValue(body.payload) || body;
    const appId = firstString(payload.app_id, payload.appId, payload.client_id, payload.clientId, envFirst(FEISHU_APP_ID_ENV_KEYS));
    const appSecret = firstString(payload.app_secret, payload.appSecret, payload.client_secret, payload.clientSecret, envFirst(FEISHU_APP_SECRET_ENV_KEYS));
    if (!appId || !appSecret) throw httpError(400, "feishu app_id and app_secret are required");
    const userInfo = objectValue(payload.user_info) || objectValue(payload.userInfo) || {};
    const desktopThreadId = firstString(body.desktop_thread_id, body.desktopThreadId, this.feishuConnection.desktopThreadId);
    await this.closeFeishuChannel({ reason: "replace session" });
    this.feishuConnection = createDisconnectedFeishuConnection({
      connected: false,
      status: "connecting",
      appId,
      appSecret,
      userOpenId: firstString(userInfo.open_id, userInfo.openId) || null,
      tenantBrand: firstString(userInfo.tenant_brand, userInfo.tenantBrand) || null,
      accountLabel: feishuAccountLabel(userInfo, appId),
      desktopThreadId: desktopThreadId || null,
      connectedAt: new Date().toISOString(),
    });
    await this.saveFeishuCredentials({ appId, appSecret });
    await this.connectFeishuChannel({ reason: "attach session" });
    await this.writeLog("feishu.session.attached", {
      appId,
      desktopThreadId: this.feishuConnection.desktopThreadId,
      accountLabel: this.feishuConnection.accountLabel,
    });
    return {
      ok: true,
      channel: "feishu",
      status: "online",
      connected: true,
      app_id: appId,
      appId,
      desktop_thread_id: this.feishuConnection.desktopThreadId,
      desktopThreadId: this.feishuConnection.desktopThreadId,
      channel_summary: this.feishuChannelSummary(),
      channelSummary: this.feishuChannelSummary(),
    };
  }

  async connectFeishuChannel(options = {}) {
    if (this.feishuReconnectPromise) return this.feishuReconnectPromise;
    this.feishuReconnectPromise = this.connectFeishuChannelOnce(options).finally(() => {
      this.feishuReconnectPromise = null;
    });
    return this.feishuReconnectPromise;
  }

  async connectFeishuChannelOnce(options = {}) {
    const appId = firstString(this.feishuConnection.appId, envFirst(FEISHU_APP_ID_ENV_KEYS));
    const appSecret = firstString(this.feishuConnection.appSecret, envFirst(FEISHU_APP_SECRET_ENV_KEYS));
    if (!appId || !appSecret) throw new Error("feishu app_id and app_secret are required");
    await this.closeFeishuChannel({ reason: options.reason || "reconnect feishu" });
    this.feishuConnection.appId = appId;
    this.feishuConnection.appSecret = appSecret;
    this.feishuConnection.connected = false;
    this.feishuConnection.status = "connecting";
    this.feishuLastReconnectAttemptAt = Date.now();
    this.feishuReconnectingSince = 0;

    const lark = await this.larkModule();
    if (!lark?.createLarkChannel) throw httpError(500, "Feishu SDK createLarkChannel is unavailable");
    const loggerLevel = lark.LoggerLevel?.warn ?? lark.LoggerLevel?.error;
    const channel = lark.createLarkChannel({
      appId,
      appSecret,
      transport: "websocket",
      source: "haolo-desktop",
      includeRawEvent: true,
      loggerLevel,
      handshakeTimeoutMs: Number(process.env.YOULE_FEISHU_HANDSHAKE_TIMEOUT_MS || "") || 30_000,
      wsConfig: {
        pingTimeout: FEISHU_WS_PING_TIMEOUT_SECONDS,
      },
      safety: {
        chatQueue: { enabled: false },
      },
      policy: {
        dmMode: "open",
        requireMention: true,
        respondToMentionAll: false,
      },
    });
    this.feishuChannel = channel;
    channel.on?.("message", (message) => {
      void this.handleFeishuChannelMessage(message);
    });
    channel.on?.("error", (error) => {
      void this.writeLog("feishu.channel.error", { message: error?.message || String(error), code: error?.code });
    });
    channel.on?.("reconnecting", (info) => {
      this.feishuConnection.connected = true;
      this.feishuConnection.status = "reconnecting";
      this.feishuReconnectingSince ||= Date.now();
      void this.writeLog("feishu.channel.reconnecting", objectValue(info) || {});
    });
    channel.on?.("reconnected", (info) => {
      this.feishuConnection.connected = true;
      this.feishuConnection.status = "online";
      this.feishuReconnectingSince = 0;
      void this.saveState();
      void this.writeLog("feishu.channel.reconnected", objectValue(info) || {});
    });
    await channel.connect();
    this.feishuConnection.connected = true;
    this.feishuConnection.status = "online";
    this.feishuConnection.connectedAt = this.feishuConnection.connectedAt || new Date().toISOString();
    this.feishuReconnectFailures = 0;
    this.feishuReconnectingSince = 0;
    await this.saveState();
    await this.writeLog("feishu.channel.connected", {
      reason: options.reason || "connect",
      appId,
      status: this.feishuChannelConnectionState(),
    });
    return this.feishuChannelSummary();
  }

  startFeishuConnectionSupervisor() {
    if (this.feishuSupervisorTimer || this.feishuSupervisorIntervalMs <= 0) return;
    this.feishuSupervisorTimer = setInterval(() => {
      void this.checkFeishuConnectionHealth();
    }, this.feishuSupervisorIntervalMs);
    this.feishuSupervisorTimer.unref?.();
  }

  stopFeishuConnectionSupervisor() {
    if (!this.feishuSupervisorTimer) return;
    clearInterval(this.feishuSupervisorTimer);
    this.feishuSupervisorTimer = null;
  }

  async checkFeishuConnectionHealth() {
    if (this.feishuSupervisorRunning) return;
    this.feishuSupervisorRunning = true;
    try {
      if (this.feishuConnection.connected && this.feishuChannel) {
        const state = this.feishuChannelConnectionState();
        if (state === "connected") {
          if (this.feishuConnection.status !== "online") {
            this.feishuConnection.status = "online";
            this.feishuReconnectingSince = 0;
            await this.saveState();
          }
          return;
        }
        if (state === "connecting" || state === "reconnecting") {
          this.feishuConnection.status = "reconnecting";
          this.feishuReconnectingSince ||= Date.now();
          if (Date.now() - this.feishuReconnectingSince < this.feishuReconnectingRebuildAfterMs) return;
          await this.rebuildFeishuChannel("reconnecting too long");
          return;
        }
        if (state === "failed" || state === "idle" || state === "closed" || state === "closing" || !state) {
          await this.rebuildFeishuChannel(`websocket ${state || "unknown"}`);
          return;
        }
        return;
      }
      await this.restoreFeishuSessionIfPossible({ reason: "supervisor restore" });
    } catch (error) {
      await this.writeLog("feishu.supervisor.error", { message: error?.message || String(error) });
    } finally {
      this.feishuSupervisorRunning = false;
    }
  }

  feishuChannelConnectionState() {
    const status = this.feishuChannel?.getConnectionStatus?.();
    return firstString(status?.state, status?.status).toLowerCase();
  }

  async rebuildFeishuChannel(reason) {
    if (!this.feishuCanAttemptReconnect()) return false;
    this.feishuReconnectFailures += 1;
    await this.writeLog("feishu.channel.rebuild_start", { reason, failures: this.feishuReconnectFailures });
    try {
      await this.connectFeishuChannel({ reason });
      await this.writeLog("feishu.channel.rebuild_ok", { reason });
      return true;
    } catch (error) {
      this.feishuConnection.connected = false;
      this.feishuConnection.status = "reconnect_failed";
      await this.saveState();
      await this.writeLog("feishu.channel.rebuild_failed", { reason, message: error?.message || String(error) });
      return false;
    }
  }

  feishuCanAttemptReconnect() {
    if (Date.now() - this.feishuLastReconnectAttemptAt < this.feishuReconnectMinIntervalMs) return false;
    return Boolean(firstString(this.feishuConnection.appId, envFirst(FEISHU_APP_ID_ENV_KEYS)) && firstString(this.feishuConnection.appSecret, envFirst(FEISHU_APP_SECRET_ENV_KEYS)));
  }

  async restoreFeishuSessionIfPossible(options = {}) {
    if (this.feishuConnection.connected && this.feishuChannel) return true;
    const stored = await this.loadFeishuCredentials();
    const appId = firstString(this.feishuConnection.appId, stored?.appId, stored?.app_id, envFirst(FEISHU_APP_ID_ENV_KEYS));
    const appSecret = firstString(this.feishuConnection.appSecret, stored?.appSecret, stored?.app_secret, envFirst(FEISHU_APP_SECRET_ENV_KEYS));
    if (!appId || !appSecret) {
      if (appId && ["online", "restoring", "connecting", "reconnecting", "reconnect_failed"].includes(String(this.feishuConnection.status || "").toLowerCase())) {
        this.feishuConnection.connected = false;
        this.feishuConnection.status = "requires_reconnect";
        await this.saveState();
        await this.writeLog("feishu.session.restore_skipped", { reason: "missing secure credentials", appId });
      }
      return false;
    }
    this.feishuConnection.appId = appId;
    this.feishuConnection.appSecret = appSecret;
    this.feishuConnection.status = "restoring";
    await this.writeLog("feishu.session.restore_start", { reason: options.reason, appId });
    await this.connectFeishuChannel({ reason: options.reason || "restore" });
    await this.writeLog("feishu.session.restore_ok", { reason: options.reason, appId });
    return true;
  }

  async restoreTelegramSessionIfPossible(options = {}) {
    if (this.telegramConnection.connected && this.telegramConnection.botToken) return true;
    const stored = await this.loadTelegramCredentials();
    const token = normalizeTelegramBotToken(firstString(this.telegramConnection.botToken, stored?.botToken, stored?.bot_token, process.env.YOULE_TELEGRAM_BOT_TOKEN));
    if (!token) {
      if (["online", "restoring", "connecting"].includes(String(this.telegramConnection.status || "").toLowerCase())) {
        this.telegramConnection.connected = false;
        this.telegramConnection.status = "requires_reconnect";
        await this.saveState();
        await this.writeLog("telegram.session.restore_skipped", { reason: "missing secure credentials" });
      }
      return false;
    }
    const previous = this.telegramConnection;
    this.telegramConnection = {
      ...previous,
      botToken: token,
      connected: false,
      status: "restoring",
    };
    await this.writeLog("telegram.session.restore_start", { reason: options.reason });
    try {
      await this.attachTelegramSession({
        bot_token: token,
        desktop_thread_id: previous.desktopThreadId,
        update_offset: previous.updateOffset,
      });
      await this.writeLog("telegram.session.restore_ok", { reason: options.reason, botUsername: this.telegramConnection.botUsername });
      return true;
    } catch (error) {
      const authError = isTelegramAuthError(error);
      if (authError) await this.deleteTelegramCredentials();
      this.telegramConnection = {
        ...previous,
        botToken: null,
        connected: false,
        status: authError ? "requires_reconnect" : "restore_failed",
      };
      this.telegramCredentialStored = authError ? false : Boolean(stored?.botToken || stored?.bot_token || this.telegramCredentialStored);
      await this.saveState();
      await this.writeLog("telegram.session.restore_failed", {
        reason: options.reason,
        status: this.telegramConnection.status,
        message: error?.message || String(error),
      });
      return false;
    }
  }

  async bindFeishuDesktopThread(body = {}) {
    const threadId = firstString(body.thread_id, body.threadId);
    if (!threadId) throw httpError(400, "thread_id is required");
    this.feishuConnection.desktopThreadId = threadId;
    await this.saveState();
    return {
      ok: true,
      channel: "feishu",
      status: this.feishuConnection.connected ? "online" : "disconnected",
      connected: Boolean(this.feishuConnection.connected),
      thread_id: threadId,
      threadId,
      desktop_thread_id: threadId,
      desktopThreadId: threadId,
    };
  }

  async listFeishuMessages() {
    if (!this.feishuConnection.connected) {
      return { ok: true, channel: "feishu", connected: false, status: this.feishuConnection.status || "disconnected", data: [], items: [], messages: [] };
    }
    const messages = this.feishuMessages.splice(0, FEISHU_MESSAGE_QUEUE_LIMIT);
    return {
      ok: true,
      channel: "feishu",
      connected: true,
      status: this.feishuConnection.status || "online",
      data: messages,
      items: messages,
      messages,
    };
  }

  async replyFeishuMessage(messageId, body = {}) {
    if (!this.feishuConnection.connected || !this.feishuChannel) {
      return { ok: false, channel: "feishu", message_id: messageId, messageId, status: "unavailable", message: "feishu is not connected" };
    }
    const context = this.feishuMessageContextById.get(String(messageId));
    if (!context?.chatId) {
      return {
        ok: false,
        channel: "feishu",
        message_id: messageId,
        messageId,
        status: "unavailable",
        message: "missing inbound chat context for this message; cannot reply to Feishu",
      };
    }
    const attachments = Array.isArray(body.attachments) ? body.attachments.filter(objectValue).slice(0, WECHAT_REPLY_ATTACHMENT_LIMIT) : [];
    const text = stripExternalReplyAttachmentsBlock(String(body.text || body.message || "")).trim() || (attachments.length ? "文件已生成。" : "");
    const requestText =
      cleanFeishuReplyText(String(body.text || body.message || ""), attachments).trim() ||
      (attachments.length ? "\u6587\u4ef6\u5df2\u751f\u6210\uff0c\u89c1\u4e0b\u65b9\u9644\u4ef6\u3002" : text);
    if (!requestText && !attachments.length) throw httpError(400, "text or attachments are required");
    let raw = null;
    if (requestText) {
      raw = await this.feishuChannel.send(context.chatId, { markdown: requestText }, { replyTo: context.messageId });
    }
    const attachmentResults = [];
    for (const attachment of attachments) {
      try {
        attachmentResults.push(await this.sendFeishuFileAttachment(context, attachment));
      } catch (error) {
        const result = {
          ok: false,
          name: wechatAttachmentDisplayName(attachment),
          status: "failed",
          error: error?.message || String(error),
        };
        attachmentResults.push(result);
        await this.writeLog("feishu.attachment.send_failed", result);
      }
    }
    const fileErrors = attachmentResults.filter((item) => !item?.ok);
    await this.writeLog("feishu.message.replied", {
      messageId,
      chatId: context.chatId,
      textLength: requestText.length,
      attachmentCount: attachmentResults.length,
      attachmentErrorCount: fileErrors.length,
    });
    if (fileErrors.length) {
      return {
        ok: false,
        channel: "feishu",
        message_id: messageId,
        messageId,
        status: "sent_with_attachment_errors",
        message: "feishu reply text was sent, but one or more attachments failed",
        attachments: attachmentResults,
        raw,
      };
    }
    return { ok: true, channel: "feishu", message_id: messageId, messageId, status: "sent", attachments: attachmentResults, raw };
  }

  async sendFeishuFileAttachment(context, attachment) {
    const filePath = wechatAttachmentLocalPath(attachment);
    if (!filePath) throw new Error("attachment has no local file path");
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error(`attachment path is not a file: ${filePath}`);
    if (stat.size <= 0) throw new Error("attachment file is empty");
    const fileName = wechatAttachmentFileName(attachment, filePath);
    const input = feishuAttachmentSendInput(attachment, filePath, fileName);
    const raw = await this.feishuChannel.send(context.chatId, input, { replyTo: context.messageId });
    const kind = input.image ? "image" : "file";
    await this.writeLog("feishu.attachment.sent", {
      name: fileName,
      path: filePath,
      size: stat.size,
      kind,
    });
    return {
      ok: true,
      name: fileName,
      path: filePath,
      size: stat.size,
      kind,
      status: "sent",
      raw,
    };
  }

  async handleFeishuChannelMessage(message) {
    const normalized = normalizeInboundFeishuMessage(message, this.feishuConnection);
    if (!normalized) return;
    if (this.hasSeenFeishuMessage(normalized.id)) return;
    this.rememberSeenFeishuMessage(normalized.id);
    this.queueFeishuChannelInboundMessage(normalized);
  }

  queueFeishuChannelInboundMessage(normalized) {
    const key = feishuInboundBatchKey(normalized);
    const batch = this.feishuPendingMessageBatches.get(key) || { messages: [], timer: null };
    batch.messages.push(normalized);
    if (batch.timer) clearTimeout(batch.timer);
    batch.timer = setTimeout(() => {
      this.feishuPendingMessageBatches.delete(key);
      void this.acceptFeishuChannelMessage(mergeFeishuInboundMessages(batch.messages)).catch((error) => {
        void this.writeLog("feishu.message.batch_error", {
          message: error?.message || String(error),
          count: batch.messages.length,
        });
      });
    }, FEISHU_INBOUND_MESSAGE_BATCH_DELAY_MS);
    this.feishuPendingMessageBatches.set(key, batch);
  }

  async acceptFeishuChannelMessage(normalized) {
    await this.prepareInboundFeishuMessageAttachments(normalized);
    this.feishuMessageContextById.set(normalized.id, {
      chatId: normalized.chat_id,
      messageId: normalized.message_id,
      senderId: normalized.from_user_id,
    });
    trimMapToLimit(this.feishuMessageContextById, MESSAGE_CONTEXT_SOFT_LIMIT);
    this.feishuMessages.push(normalized);
    if (this.feishuMessages.length > FEISHU_MESSAGE_QUEUE_LIMIT) {
      this.feishuMessages.splice(0, this.feishuMessages.length - FEISHU_MESSAGE_QUEUE_LIMIT);
    }
    await this.saveState();
    await this.writeLog("feishu.message.received", {
      messageId: normalized.id,
      chatId: normalized.chat_id,
      textLength: normalized.text.length,
      attachmentCount: normalized.attachments.length,
    });
  }

  async startLogin(body = {}) {
    const channel = String(body.channel || body.channelId || "wechat").trim() || "wechat";
    if (channel === "feishu") return this.startFeishuLogin(body);
    if (channel === "telegram") return this.startTelegramLogin(body);
    if (channel !== "wechat") throw httpError(400, "unsupported channel");
    const localTokenList = this.wechatLocalTokenList();
    const payload = await this.requestIlinkJson(`${this.ilinkBaseUrl}/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(this.botType)}`, {
      method: "POST",
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: this.loginHeaders(),
      body: JSON.stringify({ local_token_list: localTokenList }),
    });
    const qrcode = firstPayloadString(payload, "qrcode", "qr_code", "code", "ticket");
    if (!qrcode) throw httpError(502, "wechat qrcode response is missing qrcode");
    const qrcodeImage = firstPayloadString(payload, "qrcode_img_content", "qrcode_url", "qrcodeUrl", "qr_code_url", "image");
    const sessionKey = `wechat-${crypto.randomUUID()}`;
    const session = {
      sessionKey,
      qrcode,
      qrcodeImage,
      baseUrl: this.ilinkBaseUrl,
      status: "waiting",
      createdAt: Date.now(),
      lastPayload: payload,
      localTokenList,
    };
    this.sessions.set(sessionKey, session);
    await this.writeLog("login.started", { sessionKey, reusableTokenCount: localTokenList.length });
    return loginPayload(session, {
      qrcode_img_content: qrcodeImage || null,
      raw: payload,
    });
  }

  async getLogin(sessionKey) {
    const session = this.sessions.get(sessionKey);
    if (!session) {
      return { ok: false, channel: "wechat", session_key: sessionKey, sessionKey, status: "expired", connected: false };
    }
    if (Date.now() - session.createdAt > LOGIN_SESSION_TTL_MS) {
      session.status = "expired";
      this.sessions.delete(sessionKey);
      return loginPayload(session, { status: "expired", connected: false });
    }
    let payload;
    try {
      payload = await this.requestIlinkJson(`${session.baseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(session.qrcode)}`, {
        method: "GET",
        timeoutMs: WECHAT_LOGIN_STATUS_TIMEOUT_MS,
        headers: this.loginHeaders(),
      });
    } catch (error) {
      if (!isTransientIlinkPollError(error)) throw error;
      await this.writeLog("login.poll.transient_error", { sessionKey, status: session.status, message: error?.message || String(error) });
      return loginPayload(session, {
        status: session.status === "scanned" ? "scanned" : "waiting",
        connected: false,
        transient: true,
        message: "\u5fae\u4fe1\u6388\u6743\u786e\u8ba4\u8f83\u6162\uff0c\u7ee7\u7eed\u7b49\u5f85",
      });
    }
    session.lastPayload = payload;
    const redirectHost = firstPayloadString(payload, "baseurl", "base_url", "redirect_host", "redirectHost");
    if (redirectHost) session.baseUrl = normalizeBaseUrl(redirectHost);
    session.status = normalizeLoginStatus(payload);
    if (session.status === "connected") {
      let attachPayload = payload;
      if (!firstPayloadString(payload, "bot_token", "botToken", "token", "access_token", "accessToken")) {
        const reusedToken = Array.isArray(session.localTokenList) ? firstString(session.localTokenList[0]) : firstString(session.localTokenList);
        attachPayload = this.reusedWechatLoginPayload(reusedToken, payload);
        await this.writeLog("login.connected.reused_token", {
          sessionKey,
          reused: Boolean(attachPayload),
          reusableTokenCount: Array.isArray(session.localTokenList) ? session.localTokenList.length : 0,
        });
      }
      if (!attachPayload) {
        session.status = "error";
        this.sessions.delete(sessionKey);
        await this.writeLog("login.connected.missing_reusable_token", {
          sessionKey,
          upstreamStatus: rawWechatLoginStatus(payload),
        });
        return loginPayload(session, {
          status: "error",
          connected: false,
          message: "微信已确认该账号绑定过本客户端，但本地重连凭据已丢失。请先在微信中解除旧连接，再重新扫码。",
        });
      }
      const attached = await this.attachSession({
        payload: attachPayload,
        base_url: firstPayloadString(attachPayload, "baseurl", "base_url") || session.baseUrl,
      });
      this.sessions.delete(sessionKey);
      return loginPayload(session, {
        status: "connected",
        connected: true,
        direct_qr_only: false,
        directQrOnly: false,
        channel: attached.channel,
        attach_result: attached,
        attachResult: attached,
        desktop_thread_id: attached.desktop_thread_id,
        desktopThreadId: attached.desktopThreadId,
      });
    }
    return loginPayload(session, { status: session.status, connected: false, raw: payload });
  }

  async attachSession(body = {}) {
    let payload = objectValue(body.payload) || body;
    let token = firstPayloadString(payload, "bot_token", "botToken", "token", "access_token", "accessToken");
    if (!token && rawWechatLoginStatus(payload) === "binded_redirect") {
      const reusedToken = this.wechatLocalTokenList()[0];
      const reusedPayload = this.reusedWechatLoginPayload(reusedToken, payload);
      if (reusedPayload) {
        payload = reusedPayload;
        token = reusedToken;
      }
    }
    const baseUrl = normalizeBaseUrl(
      firstString(
        body.base_url,
        body.baseUrl,
        firstPayloadString(payload, "baseurl", "base_url", "redirect_host", "redirectHost"),
      ) || this.ilinkBaseUrl,
    );
    if (!token) throw httpError(400, "wechat login payload is missing bot_token");
    const desktopThreadId = firstString(body.desktop_thread_id, body.desktopThreadId, this.connection.desktopThreadId);
    const wechatUin = firstPayloadString(payload, "wechat_uin", "uin", "ilink_user_id", "user_id", "userId");
    this.connection = {
      connected: true,
      status: "online",
      baseUrl,
      botToken: token,
      botId: firstPayloadString(payload, "ilink_bot_id", "bot_id", "botId"),
      userId: firstPayloadString(payload, "ilink_user_id", "user_id", "userId"),
      wechatUin,
      accountLabel: firstPayloadString(payload, "nickname", "nick_name", "display_name", "displayName") || "\u5fae\u4fe1",
      cursor: firstPayloadString(payload, "get_updates_buf", "getUpdatesBuf", "next_get_updates_buf", "nextGetUpdatesBuf") || "",
      desktopThreadId: desktopThreadId || null,
      connectedAt: new Date().toISOString(),
      lastPayload: redactConnectionPayload(payload),
    };
    this.rememberWechatReusableConnection(this.connection);
    await this.saveState();
    await this.notifyWechatLifecycle("start", this.connection);
    await this.writeLog("session.attached", {
      baseUrl,
      botId: this.connection.botId,
      userId: this.connection.userId,
      desktopThreadId: this.connection.desktopThreadId,
    });
    return {
      ok: true,
      channel: "wechat",
      status: "online",
      connected: true,
      desktop_thread_id: this.connection.desktopThreadId,
      desktopThreadId: this.connection.desktopThreadId,
      channel_summary: this.wechatChannelSummary(),
      channelSummary: this.wechatChannelSummary(),
    };
  }

  async attachTelegramSession(body = {}) {
    const token = normalizeTelegramBotToken(firstString(body.bot_token, body.botToken, body.token, body.access_token, body.accessToken));
    if (!token) throw httpError(400, "Telegram Bot Token is required");
    const desktopThreadId = firstString(body.desktop_thread_id, body.desktopThreadId, this.telegramConnection.desktopThreadId);
    const mePayload = await this.requestTelegramJson("getMe", { token, body: {} });
    const bot = objectValue(mePayload?.result) || {};
    const botId = firstString(bot.id);
    const botUsername = firstString(bot.username);
    if (!botId || !botUsername) throw httpError(502, "Telegram getMe response is missing bot username");
    await this.requestTelegramJson("deleteWebhook", {
      token,
      body: { drop_pending_updates: firstBoolean(body.drop_pending_updates, body.dropPendingUpdates) === true },
    });
    this.telegramConnection = createDisconnectedTelegramConnection({
      connected: true,
      status: "online",
      botToken: token,
      botId,
      botUsername,
      accountLabel: botUsername ? `@${botUsername}` : firstString(bot.first_name, bot.firstName) || "Telegram",
      desktopThreadId: desktopThreadId || null,
      connectedAt: new Date().toISOString(),
      updateOffset: firstNumber(body.update_offset, body.updateOffset, this.telegramConnection.updateOffset),
    });
    await this.saveTelegramCredentials({ botToken: token });
    await this.saveState();
    await this.writeLog("telegram.session.attached", {
      botId,
      botUsername,
      desktopThreadId: this.telegramConnection.desktopThreadId,
    });
    return {
      ok: true,
      channel: "telegram",
      status: "online",
      connected: true,
      bot_id: botId,
      botId,
      bot_username: botUsername,
      botUsername,
      bot_link: telegramBotLink(botUsername),
      botLink: telegramBotLink(botUsername),
      start_group_link: telegramBotStartGroupLink(botUsername),
      startGroupLink: telegramBotStartGroupLink(botUsername),
      desktop_thread_id: this.telegramConnection.desktopThreadId,
      desktopThreadId: this.telegramConnection.desktopThreadId,
      channel_summary: this.telegramChannelSummary(),
      channelSummary: this.telegramChannelSummary(),
    };
  }

  async bindTelegramDesktopThread(body = {}) {
    const threadId = firstString(body.thread_id, body.threadId);
    if (!threadId) throw httpError(400, "thread_id is required");
    this.telegramConnection.desktopThreadId = threadId;
    await this.saveState();
    return {
      ok: true,
      channel: "telegram",
      status: this.telegramConnection.connected ? "online" : "disconnected",
      connected: Boolean(this.telegramConnection.connected),
      thread_id: threadId,
      threadId,
      desktop_thread_id: threadId,
      desktopThreadId: threadId,
    };
  }

  async listTelegramMessages() {
    if (!this.telegramConnection.connected || !this.telegramConnection.botToken) {
      if (this.telegramCredentialStored || normalizeTelegramBotToken(firstString(process.env.YOULE_TELEGRAM_BOT_TOKEN))) {
        await this.restoreTelegramSessionIfPossible({ reason: "message poll" });
      }
    }
    if (!this.telegramConnection.connected || !this.telegramConnection.botToken) {
      return { ok: true, channel: "telegram", connected: false, status: this.telegramConnection.status || "disconnected", data: [], items: [], messages: [] };
    }
    try {
      const messages = await this.pollTelegramUpdates();
      return {
        ok: true,
        channel: "telegram",
        connected: true,
        status: this.telegramConnection.status || "online",
        data: messages,
        items: messages,
        messages,
        cursor: this.telegramConnection.updateOffset || null,
      };
    } catch (error) {
      if (isTelegramAuthError(error)) {
        await this.disconnectTelegram({ reason: `telegram session expired: ${error?.statusCode || error?.status || error?.message}` });
        return { ok: true, channel: "telegram", connected: false, status: "unauthorized", data: [], items: [], messages: [], message: error?.message || String(error) };
      }
      if (isTransientTelegramPollError(error)) {
        await this.writeLog("telegram.poll.transient_error", { message: error?.message || String(error) });
        return {
          ok: true,
          channel: "telegram",
          connected: true,
          status: "online",
          transient_error: true,
          transientError: true,
          message: error?.message || String(error),
          data: [],
          items: [],
          messages: [],
          cursor: this.telegramConnection.updateOffset || null,
        };
      }
      throw error;
    }
  }

  async pollTelegramUpdates() {
    const body = {
      timeout: TELEGRAM_GET_UPDATES_TIMEOUT_SECONDS,
      allowed_updates: ["message", "edited_message"],
    };
    if (this.telegramConnection.updateOffset != null) body.offset = this.telegramConnection.updateOffset;
    const payload = await this.requestTelegramJson("getUpdates", {
      body,
      timeoutMs: TELEGRAM_GET_UPDATES_TIMEOUT_MS,
    });
    const updates = Array.isArray(payload?.result) ? payload.result : [];
    let nextOffset = firstNumber(this.telegramConnection.updateOffset);
    const messages = [];
    for (const update of updates) {
      const updateId = firstNumber(update?.update_id);
      if (updateId != null) nextOffset = Math.max(nextOffset ?? 0, updateId + 1);
      const normalized = normalizeInboundTelegramMessage(update, this.telegramConnection);
      if (!normalized) continue;
      const id = normalized.id;
      if (this.hasSeenTelegramMessage(id)) continue;
      this.rememberSeenTelegramMessage(id);
      this.telegramMessageContextById.set(id, telegramMessageReplyContext(normalized));
      trimMapToLimit(this.telegramMessageContextById, MESSAGE_CONTEXT_SOFT_LIMIT);
      await this.prepareInboundTelegramMessageAttachments(normalized);
      messages.push(normalized);
    }
    if (nextOffset != null) this.telegramConnection.updateOffset = nextOffset;
    if (updates.length || messages.length) await this.saveState();
    return messages;
  }

  async replyTelegramMessage(messageId, body = {}) {
    if (!this.telegramConnection.connected || !this.telegramConnection.botToken) {
      return { ok: false, channel: "telegram", message_id: messageId, messageId, status: "unavailable", message: "telegram is not connected" };
    }
    const context = this.telegramMessageContextById.get(String(messageId));
    if (!context?.chatId) {
      return {
        ok: false,
        channel: "telegram",
        message_id: messageId,
        messageId,
        status: "unavailable",
        message: "missing inbound chat context for this message; cannot reply to Telegram",
      };
    }
    const attachments = Array.isArray(body.attachments) ? body.attachments.filter(objectValue).slice(0, WECHAT_REPLY_ATTACHMENT_LIMIT) : [];
    const requestText =
      cleanFeishuReplyText(String(body.text || body.message || ""), attachments).trim() ||
      (attachments.length ? "\u6587\u4ef6\u5df2\u751f\u6210\uff0c\u89c1\u4e0b\u65b9\u9644\u4ef6\u3002" : "");
    if (!requestText && !attachments.length) throw httpError(400, "text or attachments are required");
    let textResults = [];
    if (requestText) textResults = await this.sendTelegramTextReply(context, requestText);
    const attachmentResults = [];
    for (const attachment of attachments) {
      try {
        attachmentResults.push(await this.sendTelegramFileAttachment(context, attachment));
      } catch (error) {
        const result = {
          ok: false,
          name: wechatAttachmentDisplayName(attachment),
          status: "failed",
          error: error?.message || String(error),
        };
        attachmentResults.push(result);
        await this.writeLog("telegram.attachment.send_failed", result);
      }
    }
    const fileErrors = attachmentResults.filter((item) => !item?.ok);
    await this.writeLog("telegram.message.replied", {
      messageId,
      chatId: context.chatId,
      textLength: requestText.length,
      textPartCount: textResults.length,
      attachmentCount: attachmentResults.length,
      attachmentErrorCount: fileErrors.length,
    });
    if (fileErrors.length) {
      return {
        ok: false,
        channel: "telegram",
        message_id: messageId,
        messageId,
        status: "sent_with_attachment_errors",
        message: "telegram reply text was sent, but one or more attachments failed",
        attachments: attachmentResults,
        raw: textResults,
      };
    }
    return { ok: true, channel: "telegram", message_id: messageId, messageId, status: "sent", attachments: attachmentResults, raw: textResults };
  }

  async sendTelegramTextReply(context, text) {
    const chunks = telegramMessageChunks(text);
    const results = [];
    for (let index = 0; index < chunks.length; index += 1) {
      results.push(
        await this.requestTelegramJson("sendMessage", {
          body: compactObject({
            chat_id: context.chatId,
            text: chunks[index],
            message_thread_id: context.messageThreadId || undefined,
            reply_parameters:
              index === 0 && context.messageId
                ? {
                    message_id: context.messageId,
                    allow_sending_without_reply: true,
                  }
                : undefined,
          }),
        }),
      );
    }
    return results;
  }

  async sendTelegramFileAttachment(context, attachment) {
    const filePath = wechatAttachmentLocalPath(attachment);
    if (!filePath) throw new Error("attachment has no local file path");
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error(`attachment path is not a file: ${filePath}`);
    if (stat.size <= 0) throw new Error("attachment file is empty");
    if (stat.size > TELEGRAM_MAX_ATTACHMENT_BYTES) throw new Error(`attachment file is too large for Telegram: ${stat.size} bytes`);
    const fileName = wechatAttachmentFileName(attachment, filePath);
    const mime = firstString(attachment?.mime, attachment?.mime_type, attachment?.mimeType) || generatedMimeFromPath(fileName || filePath);
    const method = telegramAttachmentShouldSendAsPhoto(mime, fileName || filePath) ? "sendPhoto" : "sendDocument";
    const fieldName = method === "sendPhoto" ? "photo" : "document";
    const formData = new FormData();
    formData.append("chat_id", String(context.chatId));
    if (context.messageThreadId) formData.append("message_thread_id", String(context.messageThreadId));
    if (context.messageId) {
      formData.append(
        "reply_parameters",
        JSON.stringify({
          message_id: context.messageId,
          allow_sending_without_reply: true,
        }),
      );
    }
    const bytes = await fs.readFile(filePath);
    formData.append(fieldName, new Blob([Buffer.from(bytes)], { type: mime }), fileName);
    const raw = await this.requestTelegramForm(method, formData, { timeoutMs: WECHAT_FILE_SEND_TIMEOUT_MS });
    await this.writeLog("telegram.attachment.sent", {
      name: fileName,
      path: filePath,
      size: stat.size,
      kind: method === "sendPhoto" ? "photo" : "document",
    });
    return {
      ok: true,
      name: fileName,
      path: filePath,
      size: stat.size,
      kind: method === "sendPhoto" ? "photo" : "document",
      raw,
    };
  }

  async prepareInboundTelegramMessageAttachments(message) {
    if (!Array.isArray(message?.attachments) || !message.attachments.length || !this.cacheDir) return;
    const prepared = [];
    const seen = new Set();
    for (let index = 0; index < message.attachments.length; index += 1) {
      const attachment = message.attachments[index];
      if (!objectValue(attachment)) {
        prepared.push(attachment);
        continue;
      }
      try {
        const cached = await this.cacheInboundTelegramAttachment(message.id, attachment, index);
        prepared.push(cached || attachment);
      } catch (error) {
        await this.writeLog("telegram.inbound_attachment.cache_failed", {
          messageId: message.id,
          name: wechatAttachmentDisplayName(attachment),
          fileId: firstString(attachment.telegram_file_id, attachment.telegramFileId, attachment.file_id, attachment.fileId),
          message: error?.message || String(error),
        });
        prepared.push(attachment);
      }
    }
    message.attachments = prepared.filter((attachment) => {
      const key = telegramAttachmentIdentity(attachment);
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async cacheInboundTelegramAttachment(messageId, attachment, index) {
    const fileId = firstString(attachment.telegram_file_id, attachment.telegramFileId, attachment.file_id, attachment.fileId, attachment.object_key, attachment.objectKey);
    if (!fileId) return attachment;
    const name = wechatAttachmentDisplayName(attachment);
    const mime = firstString(attachment.mime, attachment.mime_type, attachment.mimeType) || generatedMimeFromPath(name);
    const cachePath = inboundAttachmentPath(this.cacheDir, messageId, index, name, fileId);
    if (!(await fileExists(cachePath))) {
      const payload = await this.downloadInboundTelegramAttachment(fileId, name);
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, payload);
      await this.writeLog("telegram.inbound_attachment.cached", {
        messageId,
        fileId,
        name,
        size: payload.length,
      });
    }
    return {
      ...attachment,
      name,
      file_name: name,
      fileName: name,
      mime,
      mime_type: mime,
      mimeType: mime,
      url: telegramResourceIsPreviewable(mime, name) ? cachePath : firstString(attachment.url, attachment.file_url, attachment.fileUrl) || null,
      local_path: cachePath,
      localPath: cachePath,
      path: cachePath,
      download_url: cachePath,
      downloadUrl: cachePath,
      preview_url: telegramResourceIsPreviewable(mime, name) ? cachePath : null,
      previewUrl: telegramResourceIsPreviewable(mime, name) ? cachePath : null,
    };
  }

  async downloadInboundTelegramAttachment(fileId, name) {
    const filePayload = await this.requestTelegramJson("getFile", {
      body: { file_id: fileId },
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    const result = objectValue(filePayload?.result) || {};
    const filePath = firstString(result.file_path, result.filePath);
    if (!filePath) throw new Error(`telegram getFile response is missing file_path: ${name}`);
    const size = firstNumber(result.file_size, result.fileSize);
    if (size && size > TELEGRAM_INBOUND_ATTACHMENT_MAX_BYTES) {
      throw new Error(`telegram inbound attachment is too large: ${size} bytes`);
    }
    const response = await this.fetchWithTimeout(this.telegramFileUrl(filePath), {}, TELEGRAM_INBOUND_ATTACHMENT_DOWNLOAD_TIMEOUT_MS);
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`telegram inbound attachment download failed ${response.status}: ${detail || name}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > TELEGRAM_INBOUND_ATTACHMENT_MAX_BYTES) {
      throw new Error(`telegram inbound attachment is too large: ${bytes.length} bytes`);
    }
    if (!bytes.length) throw new Error("telegram inbound attachment is empty");
    return bytes;
  }

  async requestTelegramJson(method, options = {}) {
    const body = objectValue(options.body) || {};
    return this.requestTelegramApi(method, {
      ...options,
      init: {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
      },
    });
  }

  async requestTelegramForm(method, formData, options = {}) {
    return this.requestTelegramApi(method, {
      ...options,
      init: {
        method: "POST",
        body: formData,
      },
    });
  }

  async requestTelegramApi(method, options = {}) {
    const token = normalizeTelegramBotToken(firstString(options.token, this.telegramConnection.botToken));
    if (!token) throw httpError(401, "telegram bot token is missing");
    const response = await this.fetchWithTimeout(this.telegramMethodUrl(method, token), options.init || {}, options.timeoutMs || REQUEST_TIMEOUT_MS);
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok || payload?.ok === false) {
      const message = firstString(payload?.description, payload?.message, payload?.error) || `Telegram ${method} failed: HTTP ${response.status}`;
      throw httpError(response.status || firstNumber(payload?.error_code) || 502, message);
    }
    return payload;
  }

  telegramMethodUrl(method, token = this.telegramConnection.botToken) {
    return `${this.telegramApiBaseUrl}/bot${token}/${encodeURIComponent(String(method || ""))}`;
  }

  telegramFileUrl(filePath, token = this.telegramConnection.botToken) {
    const encodedPath = String(filePath || "")
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    return `${this.telegramApiBaseUrl}/file/bot${token}/${encodedPath}`;
  }

  async bindDesktopThread(body = {}) {
    const threadId = firstString(body.thread_id, body.threadId);
    if (!threadId) throw httpError(400, "thread_id is required");
    this.connection.desktopThreadId = threadId;
    await this.saveState();
    return {
      ok: true,
      channel: "wechat",
      status: this.connection.connected ? "online" : "disconnected",
      connected: Boolean(this.connection.connected),
      thread_id: threadId,
      threadId,
      desktop_thread_id: threadId,
      desktopThreadId: threadId,
    };
  }

  async listMessages() {
    if (!this.connection.connected) {
      return { ok: true, channel: "wechat", connected: false, status: "disconnected", data: [], items: [], messages: [] };
    }
    let messages = [];
    try {
      messages = await this.pollIlinkMessages();
    } catch (error) {
      if (!this.connection.connected || !isTransientIlinkPollError(error)) {
        throw error;
      }
      await this.writeLog("poll.transient_error", { message: error?.message || String(error) });
      return {
        ok: true,
        channel: "wechat",
        connected: true,
        status: "online",
        transient_error: true,
        transientError: true,
        message: error?.message || String(error),
        data: [],
        items: [],
        messages: [],
        cursor: this.connection.cursor || "",
      };
    }
    return {
      ok: true,
      channel: "wechat",
      connected: true,
      status: "online",
      data: messages,
      items: messages,
      messages,
      cursor: this.connection.cursor || "",
    };
  }

  async pollIlinkMessages() {
    const payload = await this.requestIlinkJson(`${this.connection.baseUrl || this.ilinkBaseUrl}/ilink/bot/getupdates`, {
      method: "POST",
      timeoutMs: GET_UPDATES_TIMEOUT_MS,
      headers: this.botHeaders(),
      body: JSON.stringify({
        get_updates_buf: this.connection.cursor || "",
        base_info: this.baseInfo(),
      }),
    });
    const ret = firstNumber(payload?.ret, payload?.errcode, payload?.error_code);
    if (ret != null && ret !== 0) {
      if (ret === -14 || ret === 401 || ret === 403) {
        await this.disconnect({ reason: `wechat session expired: ${ret}` });
      }
      throw httpError(502, firstString(payload?.errmsg, payload?.message, payload?.error) || `wechat getupdates failed: ${ret}`);
    }
    const nextCursor = firstPayloadString(payload, "get_updates_buf", "getUpdatesBuf", "next_get_updates_buf", "nextGetUpdatesBuf");
    if (nextCursor) this.connection.cursor = nextCursor;
    const rawMessages = extractIlinkMessages(payload);
    const messages = [];
    for (const raw of rawMessages) {
      const normalized = normalizeInboundWechatMessage(raw, this.connection);
      if (!normalized) continue;
      const id = normalized.id;
      if (this.hasSeenMessage(id)) continue;
      this.rememberSeenMessage(id);
      this.messageContextById.set(id, messageReplyContext(raw, this.connection));
      trimMapToLimit(this.messageContextById, MESSAGE_CONTEXT_SOFT_LIMIT);
      await this.prepareInboundWechatMessageAttachments(normalized);
      messages.push(normalized);
    }
    if (nextCursor || messages.length) await this.saveState();
    return messages;
  }

  async replyMessage(messageId, body = {}) {
    if (!this.connection.connected) {
      return { ok: false, channel: "wechat", message_id: messageId, messageId, status: "unavailable", message: "wechat is not connected" };
    }
    const context = this.messageContextById.get(String(messageId));
    if (!context?.contextToken) {
      return {
        ok: false,
        channel: "wechat",
        message_id: messageId,
        messageId,
        status: "unavailable",
        message: "missing inbound context_token for this message; cannot reply to WeChat",
      };
    }
    const attachments = Array.isArray(body.attachments) ? body.attachments.filter(objectValue).slice(0, WECHAT_REPLY_ATTACHMENT_LIMIT) : [];
    const text = String(body.text || body.message || "").trim() || replyTextWithAttachments("", attachments);
    if (!text && !attachments.length) throw httpError(400, "text or attachments are required");
    let response = null;
    if (text) {
      response = await this.sendWechatReplyItem(context, { type: 1, text_item: { text } }, { timeoutMs: REQUEST_TIMEOUT_MS });
      const ret = firstNumber(response?.ret, response?.errcode, response?.error_code);
      if (ret != null && ret !== 0) {
        return {
          ok: false,
          channel: "wechat",
          message_id: messageId,
          messageId,
          status: "failed",
          message: firstString(response?.errmsg, response?.message, response?.error) || `wechat sendmessage failed: ${ret}`,
          raw: response,
        };
      }
    }
    const attachmentResults = [];
    for (const attachment of attachments) {
      try {
        attachmentResults.push(await this.sendWechatFileAttachment(context, attachment));
      } catch (error) {
        const result = {
          ok: false,
          name: wechatAttachmentDisplayName(attachment),
          status: "failed",
          error: error?.message || String(error),
        };
        attachmentResults.push(result);
        await this.writeLog("attachment.send_failed", result);
      }
    }
    const fileErrors = attachmentResults.filter((item) => !item?.ok);
    await this.writeLog("message.replied", {
      messageId,
      textLength: text.length,
      attachmentCount: attachmentResults.length,
      attachmentErrorCount: fileErrors.length,
    });
    if (fileErrors.length) {
      return {
        ok: false,
        channel: "wechat",
        message_id: messageId,
        messageId,
        status: "sent_with_attachment_errors",
        message: "wechat reply text was sent, but one or more attachments failed",
        attachments: attachmentResults,
        raw: response,
      };
    }
    return { ok: true, channel: "wechat", message_id: messageId, messageId, status: "sent", attachments: attachmentResults, raw: response };
  }

  async sendWechatReplyItem(context, item, options = {}) {
    return this.requestIlinkJson(`${this.connection.baseUrl || this.ilinkBaseUrl}/ilink/bot/sendmessage`, {
      method: "POST",
      timeoutMs: options.timeoutMs || REQUEST_TIMEOUT_MS,
      headers: this.botHeaders(),
      body: JSON.stringify({
        msg: {
          from_user_id: context.replyFromUserId,
          to_user_id: context.replyToUserId,
          client_id: `haolo-desktop-${Date.now()}-${crypto.randomUUID()}`,
          message_type: 2,
          message_state: 2,
          context_token: context.contextToken,
          item_list: [item],
        },
        base_info: this.baseInfo(),
      }),
    });
  }

  async sendWechatFileAttachment(context, attachment) {
    const uploaded = await this.uploadWechatFileAttachment(context.replyToUserId, attachment);
    const response = await this.sendWechatReplyItem(
      context,
      {
        type: 4,
        file_item: {
          media: {
            encrypt_query_param: uploaded.downloadEncryptedQueryParam,
            aes_key: Buffer.from(uploaded.aesKeyHex, "ascii").toString("base64"),
            encrypt_type: 1,
          },
          file_name: uploaded.fileName,
          len: String(uploaded.fileSize),
        },
      },
      { timeoutMs: WECHAT_FILE_SEND_TIMEOUT_MS },
    );
    const ret = firstNumber(response?.ret, response?.errcode, response?.error_code);
    if (ret != null && ret !== 0) {
      throw new Error(firstString(response?.errmsg, response?.message, response?.error) || `wechat sendmessage failed: ${ret}`);
    }
    await this.writeLog("attachment.sent", {
      name: uploaded.fileName,
      size: uploaded.fileSize,
      ciphertextSize: uploaded.ciphertextSize,
    });
    return {
      ok: true,
      name: uploaded.fileName,
      path: uploaded.filePath,
      size: uploaded.fileSize,
      status: "sent",
      raw: response,
    };
  }

  async uploadWechatFileAttachment(peerId, attachment) {
    const filePath = wechatAttachmentLocalPath(attachment);
    if (!filePath) throw new Error("attachment has no local file path");
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error(`attachment path is not a file: ${filePath}`);
    if (stat.size <= 0) throw new Error("attachment file is empty");
    if (stat.size > WECHAT_MAX_ATTACHMENT_BYTES) throw new Error(`attachment file is too large: ${stat.size} bytes`);
    const fileName = wechatAttachmentFileName(attachment, filePath);
    const plaintext = await fs.readFile(filePath);
    const aesKey = crypto.randomBytes(16);
    const aesKeyHex = aesKey.toString("hex");
    const ciphertext = encryptAes128Ecb(plaintext, aesKey);
    const filekey = crypto.randomBytes(16).toString("hex");
    const payload = {
      filekey,
      media_type: 3,
      to_user_id: peerId,
      rawsize: plaintext.length,
      rawfilemd5: crypto.createHash("md5").update(plaintext).digest("hex"),
      filesize: ciphertext.length,
      no_need_thumb: true,
      aeskey: aesKeyHex,
      base_info: this.baseInfo(),
    };
    await this.writeLog("attachment.upload_start", { name: fileName, size: plaintext.length });
    const uploadResp = await this.requestIlinkJson(`${this.connection.baseUrl || this.ilinkBaseUrl}/ilink/bot/getuploadurl`, {
      method: "POST",
      timeoutMs: WECHAT_FILE_UPLOAD_URL_TIMEOUT_MS,
      headers: this.botHeaders(),
      body: JSON.stringify(payload),
    });
    const uploadFullUrl = firstString(uploadResp?.upload_full_url, uploadResp?.uploadFullUrl);
    const uploadParam = firstString(uploadResp?.upload_param, uploadResp?.uploadParam);
    const uploadUrl = uploadFullUrl || (uploadParam ? buildCdnUploadUrl(this.cdnBaseUrl, uploadParam, filekey) : "");
    if (!uploadUrl) throw new Error(`getuploadurl returned no upload URL for ${fileName}`);
    const downloadEncryptedQueryParam = await this.uploadBufferToCdn(uploadUrl, ciphertext, fileName);
    await this.writeLog("attachment.uploaded", {
      name: fileName,
      size: plaintext.length,
      ciphertextSize: ciphertext.length,
    });
    return {
      filePath,
      fileName,
      fileSize: plaintext.length,
      ciphertextSize: ciphertext.length,
      downloadEncryptedQueryParam,
      aesKeyHex,
    };
  }

  async uploadBufferToCdn(uploadUrl, ciphertext, fileName) {
    const response = await this.fetchWithTimeout(
      uploadUrl,
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: ciphertext,
      },
      WECHAT_FILE_CDN_UPLOAD_TIMEOUT_MS,
    );
    if (response.status >= 400 && response.status < 500) {
      const detail = response.headers.get("x-error-message") || (await response.text()).slice(0, 200);
      throw new Error(`CDN upload client error ${response.status}: ${detail}`);
    }
    if (response.status !== 200) {
      const detail = response.headers.get("x-error-message") || `status ${response.status}`;
      throw new Error(`CDN upload server error: ${detail}`);
    }
    const encryptedParam = response.headers.get("x-encrypted-param");
    if (!encryptedParam) throw new Error(`CDN upload response missing x-encrypted-param for ${fileName}`);
    return encryptedParam;
  }

  async prepareInboundWechatMessageAttachments(message) {
    if (!Array.isArray(message?.attachments) || !message.attachments.length || !this.cacheDir) return;
    const prepared = [];
    for (let index = 0; index < message.attachments.length; index += 1) {
      const attachment = message.attachments[index];
      if (!objectValue(attachment)) {
        prepared.push(attachment);
        continue;
      }
      try {
        const cached = await this.cacheInboundWechatAttachment(message.id, attachment, index);
        prepared.push(cached || attachment);
      } catch (error) {
        await this.writeLog("inbound_attachment.cache_failed", {
          messageId: message.id,
          name: wechatAttachmentDisplayName(attachment),
          error: error?.message || String(error),
        });
        prepared.push(attachment);
      }
    }
    message.attachments = prepared;
  }

  async cacheInboundWechatAttachment(messageId, attachment, index) {
    const remoteUrl = firstString(attachment.url, attachment.preview_url, attachment.previewUrl, attachment.download_url, attachment.downloadUrl);
    if (!remoteUrl || !/^https?:\/\//i.test(remoteUrl)) return null;
    const name = wechatAttachmentDisplayName(attachment);
    const mime = firstString(attachment.mime, attachment.mime_type, attachment.mimeType) || generatedMimeFromPath(name);
    const cachePath = inboundAttachmentPath(this.cacheDir, messageId, index, name, remoteUrl);
    if (!(await fileExists(cachePath))) {
      const raw = await this.downloadInboundWechatAttachment(remoteUrl, name);
      const payload = decodeInboundWechatAttachment(raw, attachment, mime, name);
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, payload);
      await this.writeLog("inbound_attachment.cached", {
        messageId,
        name,
        size: payload.length,
        encryptedSize: raw.length,
        decrypted: payload.length !== raw.length || !looksLikePreviewableBytes(raw, mime, name),
      });
    }
    return {
      ...attachment,
      url: cachePath,
      preview_url: cachePath,
      previewUrl: cachePath,
      download_url: cachePath,
      downloadUrl: cachePath,
      local_path: cachePath,
      localPath: cachePath,
      path: cachePath,
      remote_url: remoteUrl,
      remoteUrl,
    };
  }

  async downloadInboundWechatAttachment(remoteUrl, name) {
    const response = await this.fetchWithTimeout(
      remoteUrl,
      {
        method: "GET",
        headers: this.botHeaders(),
      },
      WECHAT_INBOUND_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
    );
    if (!response.ok) {
      const detail = response.headers.get("x-error-message") || (await response.text()).slice(0, 200);
      throw new Error(`wechat inbound attachment download failed ${response.status}: ${detail || name}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > WECHAT_INBOUND_ATTACHMENT_MAX_BYTES) {
      throw new Error(`wechat inbound attachment is too large: ${bytes.length} bytes`);
    }
    if (!bytes.length) throw new Error("wechat inbound attachment is empty");
    return bytes;
  }

  async prepareInboundFeishuMessageAttachments(message) {
    if (!Array.isArray(message?.attachments) || !message.attachments.length || !this.cacheDir) return;
    const prepared = [];
    const messageIds = feishuMessageDownloadCandidateIds(message);
    for (let index = 0; index < message.attachments.length; index += 1) {
      const attachment = message.attachments[index];
      if (!objectValue(attachment)) {
        prepared.push(attachment);
        continue;
      }
      try {
        const cached = await this.cacheInboundFeishuAttachment(message.id, attachment, index, messageIds);
        prepared.push(cached || attachment);
      } catch (error) {
        await this.writeLog("feishu.inbound_attachment.cache_failed", {
          messageId: message.id,
          name: wechatAttachmentDisplayName(attachment),
          fileKey: firstString(attachment.file_key, attachment.fileKey, attachment.object_key, attachment.objectKey),
          candidateMessageIds: uniqueFirstStrings(feishuResourceDownloadMessageIds(attachment), messageIds),
          error: error?.message || String(error),
        });
        prepared.push(attachment);
      }
    }
    message.attachments = prepared;
  }

  async cacheInboundFeishuAttachment(messageId, attachment, index, messageIds = []) {
    const fileKey = firstString(attachment.file_key, attachment.fileKey, attachment.object_key, attachment.objectKey);
    if (!fileKey) return null;
    const downloadMessageIds = uniqueFirstStrings(feishuResourceDownloadMessageIds(attachment), messageIds, messageId);
    const downloadType = feishuResourceDownloadType(attachment);
    const name = wechatAttachmentDisplayName(attachment);
    const mime = firstString(attachment.mime, attachment.mime_type, attachment.mimeType) || feishuResourceMime(downloadType, name);
    const cachePath = inboundAttachmentPath(this.cacheDir, messageId, index, name, `${downloadType}:${fileKey}:${downloadMessageIds.join(",")}`);
    if (!(await fileExists(cachePath))) {
      const payload = await this.downloadInboundFeishuAttachment(downloadMessageIds, fileKey, downloadType, name);
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, payload);
      await this.writeLog("feishu.inbound_attachment.cached", {
        messageId,
        resourceMessageIds: downloadMessageIds,
        name,
        fileKey,
        downloadType,
        size: payload.length,
      });
    }
    return {
      ...attachment,
      mime,
      mime_type: mime,
      mimeType: mime,
      url: cachePath,
      preview_url: feishuResourceIsPreviewable(downloadType, mime, name) ? cachePath : null,
      previewUrl: feishuResourceIsPreviewable(downloadType, mime, name) ? cachePath : null,
      download_url: cachePath,
      downloadUrl: cachePath,
      local_path: cachePath,
      localPath: cachePath,
      path: cachePath,
      feishu_message_id: downloadMessageIds[0] || messageId,
      feishuMessageId: downloadMessageIds[0] || messageId,
      resource_message_id: downloadMessageIds[0] || messageId,
      resourceMessageId: downloadMessageIds[0] || messageId,
      feishu_download_type: downloadType,
      feishuDownloadType: downloadType,
    };
  }

  async downloadInboundFeishuAttachment(messageIds, fileKey, downloadType, name) {
    const token = await this.feishuTenantAccessToken();
    const candidates = uniqueFirstStrings(messageIds);
    let lastError = null;
    for (const messageId of candidates) {
      try {
        const url = new URL(
          `${this.feishuOpenApiBaseUrl}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}`,
        );
        url.searchParams.set("type", downloadType || "file");
        const response = await this.fetchWithTimeout(
          url.toString(),
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
          FEISHU_INBOUND_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
        );
        if (!response.ok) {
          const detail = response.headers.get("x-error-message") || (await response.text()).slice(0, 300);
          throw new Error(`feishu inbound attachment download failed ${response.status}: ${detail || name}`);
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > FEISHU_INBOUND_ATTACHMENT_MAX_BYTES) {
          throw new Error(`feishu inbound attachment is too large: ${bytes.length} bytes`);
        }
        if (!bytes.length) throw new Error("feishu inbound attachment is empty");
        return bytes;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("feishu inbound attachment has no message id candidates");
  }

  async feishuTenantAccessToken() {
    const cachedToken = firstString(this.feishuConnection.tenantAccessToken);
    const cachedExpiresAt = firstNumber(this.feishuConnection.tenantAccessTokenExpiresAt);
    if (cachedToken && cachedExpiresAt && cachedExpiresAt - FEISHU_TENANT_TOKEN_REFRESH_SKEW_MS > Date.now()) return cachedToken;
    const appId = firstString(this.feishuConnection.appId, envFirst(FEISHU_APP_ID_ENV_KEYS));
    const appSecret = firstString(this.feishuConnection.appSecret, envFirst(FEISHU_APP_SECRET_ENV_KEYS));
    if (!appId || !appSecret) throw new Error("feishu app_id and app_secret are required to download message resources");
    const payload = await this.requestFeishuJson("/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const code = firstNumber(payload?.code, payload?.errcode);
    if (code != null && code !== 0) {
      throw new Error(firstString(payload?.msg, payload?.message, payload?.errmsg, payload?.error) || `feishu tenant token failed: ${code}`);
    }
    const token = firstString(payload?.tenant_access_token, payload?.tenantAccessToken, payload?.access_token, payload?.accessToken);
    if (!token) throw new Error("feishu tenant token response is missing tenant_access_token");
    const expireSeconds = Math.max(60, firstNumber(payload?.expire, payload?.expires_in, payload?.expiresIn) || 7200);
    this.feishuConnection.tenantAccessToken = token;
    this.feishuConnection.tenantAccessTokenExpiresAt = Date.now() + expireSeconds * 1000;
    return token;
  }

  async requestFeishuJson(pathValue, init = {}) {
    const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchInit } = init;
    const url = /^https?:\/\//i.test(String(pathValue)) ? String(pathValue) : `${this.feishuOpenApiBaseUrl}${String(pathValue).startsWith("/") ? "" : "/"}${pathValue}`;
    const response = await this.fetchWithTimeout(url, fetchInit, timeoutMs);
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw httpError(response.status, firstString(payload?.msg, payload?.message, payload?.errmsg, payload?.error) || `HTTP ${response.status}`);
    }
    return payload;
  }

  feishuSafeStorageAvailable() {
    return Boolean(
      this.safeStorage &&
        typeof this.safeStorage.encryptString === "function" &&
        typeof this.safeStorage.decryptString === "function" &&
        (typeof this.safeStorage.isEncryptionAvailable !== "function" || this.safeStorage.isEncryptionAvailable()),
    );
  }

  async saveFeishuCredentials(credentials = {}) {
    const appId = firstString(credentials.appId, credentials.app_id);
    const appSecret = firstString(credentials.appSecret, credentials.app_secret);
    if (!appId || !appSecret || !this.feishuCredentialPath) return false;
    if (!this.feishuSafeStorageAvailable()) {
      await this.writeLog("feishu.credentials.unavailable", { reason: "safeStorage unavailable" });
      return false;
    }
    const payload = JSON.stringify({ appId, appSecret, updatedAt: new Date().toISOString() });
    const encrypted = this.safeStorage.encryptString(payload);
    await fs.mkdir(path.dirname(this.feishuCredentialPath), { recursive: true });
    await fs.writeFile(this.feishuCredentialPath, Buffer.from(encrypted));
    this.feishuCredentialStored = true;
    await this.writeLog("feishu.credentials.saved", { appId });
    return true;
  }

  async loadFeishuCredentials() {
    const envAppId = envFirst(FEISHU_APP_ID_ENV_KEYS);
    const envAppSecret = envFirst(FEISHU_APP_SECRET_ENV_KEYS);
    if (envAppId && envAppSecret) return { appId: envAppId, appSecret: envAppSecret, source: "env" };
    if (!this.feishuCredentialPath || !this.feishuSafeStorageAvailable()) return null;
    try {
      const encrypted = await fs.readFile(this.feishuCredentialPath);
      const text = this.safeStorage.decryptString(encrypted);
      const payload = JSON.parse(text);
      const appId = firstString(payload?.appId, payload?.app_id);
      const appSecret = firstString(payload?.appSecret, payload?.app_secret);
      if (!appId || !appSecret) return null;
      this.feishuCredentialStored = true;
      return { appId, appSecret, source: "safeStorage" };
    } catch (error) {
      if (error?.code !== "ENOENT") {
        await this.writeLog("feishu.credentials.load_failed", { message: error?.message || String(error) });
      }
      return null;
    }
  }

  async deleteFeishuCredentials() {
    this.feishuCredentialStored = false;
    if (!this.feishuCredentialPath) return;
    try {
      await fs.rm(this.feishuCredentialPath, { force: true });
      await this.writeLog("feishu.credentials.deleted", {});
    } catch (error) {
      await this.writeLog("feishu.credentials.delete_failed", { message: error?.message || String(error) });
    }
  }

  telegramSafeStorageAvailable() {
    return Boolean(
      this.safeStorage &&
        typeof this.safeStorage.encryptString === "function" &&
        typeof this.safeStorage.decryptString === "function" &&
        (typeof this.safeStorage.isEncryptionAvailable !== "function" || this.safeStorage.isEncryptionAvailable()),
    );
  }

  async saveTelegramCredentials(credentials = {}) {
    const botToken = normalizeTelegramBotToken(firstString(credentials.botToken, credentials.bot_token, credentials.token));
    if (!botToken || !this.telegramCredentialPath) return false;
    if (!this.telegramSafeStorageAvailable()) {
      await this.writeLog("telegram.credentials.unavailable", { reason: "safeStorage unavailable" });
      return false;
    }
    const payload = JSON.stringify({ botToken, updatedAt: new Date().toISOString() });
    const encrypted = this.safeStorage.encryptString(payload);
    await fs.mkdir(path.dirname(this.telegramCredentialPath), { recursive: true });
    await fs.writeFile(this.telegramCredentialPath, Buffer.from(encrypted));
    this.telegramCredentialStored = true;
    await this.writeLog("telegram.credentials.saved", { botUsername: this.telegramConnection.botUsername || null });
    return true;
  }

  async loadTelegramCredentials() {
    const envToken = normalizeTelegramBotToken(firstString(process.env.YOULE_TELEGRAM_BOT_TOKEN));
    if (envToken) return { botToken: envToken, source: "env" };
    if (!this.telegramCredentialPath || !this.telegramSafeStorageAvailable()) return null;
    try {
      const encrypted = await fs.readFile(this.telegramCredentialPath);
      const text = this.safeStorage.decryptString(encrypted);
      const payload = JSON.parse(text);
      const botToken = normalizeTelegramBotToken(firstString(payload?.botToken, payload?.bot_token, payload?.token));
      if (!botToken) return null;
      this.telegramCredentialStored = true;
      return { botToken, source: "safeStorage" };
    } catch (error) {
      if (error?.code !== "ENOENT") {
        await this.writeLog("telegram.credentials.load_failed", { message: error?.message || String(error) });
      }
      return null;
    }
  }

  async deleteTelegramCredentials() {
    this.telegramCredentialStored = false;
    if (!this.telegramCredentialPath) return;
    try {
      await fs.rm(this.telegramCredentialPath, { force: true });
      await this.writeLog("telegram.credentials.deleted", {});
    } catch (error) {
      await this.writeLog("telegram.credentials.delete_failed", { message: error?.message || String(error) });
    }
  }

  async disconnect(extra = {}) {
    await this.notifyWechatLifecycle("stop", this.connection);
    const threadId = this.connection.desktopThreadId || null;
    this.rememberWechatReusableConnection(this.connection);
    this.connection = createDisconnectedConnection({ desktopThreadId: threadId });
    this.sessions.clear();
    this.messageContextById.clear();
    this.seenMessageIds = [];
    await this.saveState();
    await this.writeLog("session.disconnected", extra);
    return { ok: true, channel: "wechat", connected: false, status: "disconnected" };
  }

  async disconnectTelegram(extra = {}) {
    const threadId = this.telegramConnection.desktopThreadId || null;
    await this.deleteTelegramCredentials();
    this.telegramConnection = createDisconnectedTelegramConnection({ desktopThreadId: threadId });
    for (const [key, session] of this.sessions.entries()) {
      if (session?.channel === "telegram" || String(key).startsWith("telegram-")) {
        session.controller?.abort?.();
        this.sessions.delete(key);
      }
    }
    this.telegramMessageContextById.clear();
    this.telegramSeenMessageIds = [];
    await this.saveState();
    await this.writeLog("telegram.session.disconnected", extra);
    return { ok: true, channel: "telegram", connected: false, status: "disconnected" };
  }

  async disconnectFeishu(extra = {}) {
    const threadId = this.feishuConnection.desktopThreadId || null;
    await this.closeFeishuChannel(extra);
    await this.deleteFeishuCredentials();
    this.feishuConnection = createDisconnectedFeishuConnection({ desktopThreadId: threadId });
    for (const [key, session] of this.sessions.entries()) {
      if (session?.channel === "feishu" || String(key).startsWith("feishu-")) {
        session.controller?.abort?.();
        this.sessions.delete(key);
      }
    }
    this.feishuMessages = [];
    this.feishuMessageContextById.clear();
    this.feishuSeenMessageIds = [];
    this.clearFeishuPendingMessageBatches();
    await this.saveState();
    await this.writeLog("feishu.session.disconnected", extra);
    return { ok: true, channel: "feishu", connected: false, status: "disconnected" };
  }

  async closeFeishuChannel(extra = {}) {
    this.clearFeishuPendingMessageBatches();
    const channel = this.feishuChannel;
    this.feishuChannel = null;
    if (!channel?.disconnect) return;
    try {
      await channel.disconnect();
    } catch (error) {
      await this.writeLog("feishu.channel.disconnect_error", {
        message: error?.message || String(error),
        reason: extra?.reason,
      });
    }
  }

  clearFeishuPendingMessageBatches() {
    for (const batch of this.feishuPendingMessageBatches.values()) {
      if (batch?.timer) clearTimeout(batch.timer);
    }
    this.feishuPendingMessageBatches.clear();
  }

  hasSeenMessage(messageId) {
    return this.seenMessageIds.includes(String(messageId));
  }

  rememberSeenMessage(messageId) {
    const id = String(messageId);
    this.seenMessageIds.push(id);
    if (this.seenMessageIds.length > MAX_SEEN_MESSAGES) {
      this.seenMessageIds.splice(0, this.seenMessageIds.length - MAX_SEEN_MESSAGES);
    }
  }

  hasSeenFeishuMessage(messageId) {
    return this.feishuSeenMessageIds.includes(String(messageId));
  }

  rememberSeenFeishuMessage(messageId) {
    const id = String(messageId);
    this.feishuSeenMessageIds.push(id);
    if (this.feishuSeenMessageIds.length > MAX_SEEN_MESSAGES) {
      this.feishuSeenMessageIds.splice(0, this.feishuSeenMessageIds.length - MAX_SEEN_MESSAGES);
    }
  }

  hasSeenTelegramMessage(messageId) {
    return this.telegramSeenMessageIds.includes(String(messageId));
  }

  rememberSeenTelegramMessage(messageId) {
    const id = String(messageId);
    this.telegramSeenMessageIds.push(id);
    if (this.telegramSeenMessageIds.length > MAX_SEEN_MESSAGES) {
      this.telegramSeenMessageIds.splice(0, this.telegramSeenMessageIds.length - MAX_SEEN_MESSAGES);
    }
  }

  async larkModule() {
    if (this.lark) {
      configureLarkSdkHttp(this.lark);
      return this.lark;
    }
    this.lark = await import("@larksuiteoapi/node-sdk");
    configureLarkSdkHttp(this.lark);
    return this.lark;
  }

  loginHeaders() {
    return {
      "content-type": "application/json",
      "iLink-App-Id": "bot",
      "iLink-App-ClientVersion": String(wechatClientVersionNumber(this.openclawVersion)),
    };
  }

  botHeaders(connection = this.connection) {
    return {
      "content-type": "application/json",
      AuthorizationType: "ilink_bot_token",
      Authorization: `Bearer ${connection.botToken}`,
      "X-WECHAT-UIN": this.wechatUinHeader(connection),
      "iLink-App-Id": "bot",
      "iLink-App-ClientVersion": String(wechatClientVersionNumber(this.openclawVersion)),
    };
  }

  wechatUinHeader(connection = this.connection) {
    const uin = firstString(connection?.wechatUin, connection?.userId);
    return Buffer.from(uin || String(randomUInt32())).toString("base64");
  }

  baseInfo() {
    return { channel_version: String(wechatClientVersionNumber(this.openclawVersion)) };
  }

  rememberWechatReusableConnection(connection = this.connection) {
    const token = firstString(connection?.botToken);
    if (!token) return;
    this.rememberWechatReusableBotToken(token);
    this.wechatReusableConnectionsByToken.set(token, {
      baseUrl: firstString(connection?.baseUrl) || DEFAULT_WECHAT_ILINK_BASE_URL,
      botId: firstString(connection?.botId) || null,
      userId: firstString(connection?.userId) || null,
      wechatUin: firstString(connection?.wechatUin) || null,
      accountLabel: firstString(connection?.accountLabel) || null,
      cursor: firstString(connection?.cursor) || "",
    });
  }

  rememberWechatReusableBotToken(token) {
    const value = firstString(token);
    if (!value) return;
    this.wechatReusableBotTokens = [value, ...this.wechatReusableBotTokens.filter((item) => item !== value)].slice(0, 3);
    for (const key of this.wechatReusableConnectionsByToken.keys()) {
      if (!this.wechatReusableBotTokens.includes(key)) this.wechatReusableConnectionsByToken.delete(key);
    }
  }

  wechatLocalTokenList() {
    const values = [...this.wechatReusableBotTokens];
    const activeToken = firstString(this.connection.botToken);
    if (activeToken && !values.includes(activeToken)) values.unshift(activeToken);
    // This desktop client exposes one active WeChat account. Sending a single
    // token keeps a token-less `binded_redirect` response unambiguous: it can
    // only refer to the most recently disconnected account.
    return values.slice(0, 1);
  }

  reusedWechatLoginPayload(token, statusPayload = {}) {
    const value = firstString(token);
    if (!value) return null;
    const record = this.wechatReusableConnectionsByToken.get(value) || {};
    return {
      ...(objectValue(statusPayload) || {}),
      bot_token: value,
      baseurl: firstPayloadString(statusPayload, "baseurl", "base_url") || firstString(record.baseUrl),
      ilink_bot_id: firstString(record.botId),
      ilink_user_id: firstString(record.userId),
      wechat_uin: firstString(record.wechatUin, record.userId),
      nickname: firstString(record.accountLabel) || "\u5fae\u4fe1",
      get_updates_buf: firstString(record.cursor),
    };
  }

  async notifyWechatLifecycle(action, connection = this.connection) {
    const token = firstString(connection?.botToken);
    if (!token) return false;
    const lifecycle = action === "stop" ? "stop" : "start";
    try {
      const payload = await this.requestIlinkJson(
        `${normalizeBaseUrl(connection?.baseUrl || this.ilinkBaseUrl)}/ilink/bot/msg/notify${lifecycle}`,
        {
          method: "POST",
          timeoutMs: WECHAT_LIFECYCLE_NOTIFY_TIMEOUT_MS,
          headers: this.botHeaders(connection),
          body: JSON.stringify({ base_info: this.baseInfo() }),
        },
      );
      await this.writeLog(`session.notify_${lifecycle}`, {
        ret: firstNumber(payload?.ret, payload?.errcode),
        message: firstString(payload?.errmsg, payload?.message) || null,
      });
      return true;
    } catch (error) {
      await this.writeLog(`session.notify_${lifecycle}_error`, {
        message: error?.message || String(error),
      });
      return false;
    }
  }

  async requestIlinkJson(url, init = {}) {
    const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchInit } = init;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetch(url, { ...fetchInit, signal: controller.signal });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw httpError(response.status, firstString(payload?.message, payload?.errmsg, payload?.error) || `HTTP ${response.status}`);
      }
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") throw httpError(504, "wechat request timeout");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchWithTimeout(url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error?.name === "AbortError") throw httpError(504, "wechat request timeout");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async remoteReady() {
    if (await this.probeHttpOk(`http://${this.host}:${this.port}/readyz`)) return true;
    return this.probeHttpOk(`http://${this.host}:${this.port}${this.apiPath}`);
  }

  async probeHttpOk(url) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1000);
      const response = await this.fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      return response.ok;
    } catch {
      return false;
    }
  }

  async loadState() {
    if (!this.statePath) return;
    try {
      const raw = JSON.parse(await fs.readFile(this.statePath, "utf8"));
      const botToken = firstString(raw.botToken, raw.bot_token);
      const connected = raw.connected !== false && Boolean(botToken);
      this.connection = createDisconnectedConnection({
        connected,
        status: connected ? "online" : firstString(raw.status) || "disconnected",
        baseUrl: firstString(raw.baseUrl, raw.base_url) || DEFAULT_WECHAT_ILINK_BASE_URL,
        botToken: botToken || null,
        botId: firstString(raw.botId, raw.bot_id) || null,
        userId: firstString(raw.userId, raw.user_id) || null,
        wechatUin: firstString(raw.wechatUin, raw.wechat_uin) || null,
        accountLabel: firstString(raw.accountLabel, raw.account_label) || null,
        cursor: firstString(raw.cursor, raw.get_updates_buf, raw.getUpdatesBuf),
        desktopThreadId: firstString(raw.desktopThreadId, raw.desktop_thread_id) || null,
        connectedAt: firstString(raw.connectedAt, raw.connected_at) || null,
      });
      this.wechatReusableBotTokens = [];
      this.wechatReusableConnectionsByToken.clear();
      const reusableConnections = Array.isArray(raw.wechatReusableConnections)
        ? raw.wechatReusableConnections
        : Array.isArray(raw.wechat_reusable_connections)
          ? raw.wechat_reusable_connections
          : [];
      for (const candidate of reusableConnections.slice(0, 3)) {
        const record = objectValue(candidate) || {};
        const token = firstString(record.botToken, record.bot_token, record.token);
        if (!token || this.wechatReusableConnectionsByToken.has(token)) continue;
        this.wechatReusableBotTokens.push(token);
        this.wechatReusableConnectionsByToken.set(token, {
          baseUrl: firstString(record.baseUrl, record.base_url) || DEFAULT_WECHAT_ILINK_BASE_URL,
          botId: firstString(record.botId, record.bot_id) || null,
          userId: firstString(record.userId, record.user_id) || null,
          wechatUin: firstString(record.wechatUin, record.wechat_uin) || null,
          accountLabel: firstString(record.accountLabel, record.account_label) || null,
          cursor: firstString(record.cursor, record.get_updates_buf),
        });
      }
      if (botToken) this.rememberWechatReusableConnection(this.connection);
      this.seenMessageIds = Array.isArray(raw.seenMessageIds) ? raw.seenMessageIds.map(String).slice(-MAX_SEEN_MESSAGES) : [];
      this.messageContextById = messageContextsFromState(raw.messageContexts || raw.message_contexts);
      const feishu = objectValue(raw.feishu) || {};
      this.feishuConnection = createDisconnectedFeishuConnection({
        status: firstString(feishu.status) || "disconnected",
        appId: firstString(feishu.appId, feishu.app_id) || null,
        accountLabel: firstString(feishu.accountLabel, feishu.account_label) || null,
        userOpenId: firstString(feishu.userOpenId, feishu.user_open_id, feishu.open_id) || null,
        tenantBrand: firstString(feishu.tenantBrand, feishu.tenant_brand) || null,
        desktopThreadId: firstString(feishu.desktopThreadId, feishu.desktop_thread_id) || null,
        connectedAt: firstString(feishu.connectedAt, feishu.connected_at) || null,
      });
      this.feishuCredentialStored = firstBoolean(feishu.credentialStored, feishu.credential_stored) === true;
      this.feishuSeenMessageIds = Array.isArray(feishu.seenMessageIds) ? feishu.seenMessageIds.map(String).slice(-MAX_SEEN_MESSAGES) : [];
      const telegram = objectValue(raw.telegram) || {};
      this.telegramConnection = createDisconnectedTelegramConnection({
        status: firstString(telegram.status) || "disconnected",
        botId: firstString(telegram.botId, telegram.bot_id) || null,
        botUsername: firstString(telegram.botUsername, telegram.bot_username) || null,
        accountLabel: firstString(telegram.accountLabel, telegram.account_label) || null,
        updateOffset: firstNumber(telegram.updateOffset, telegram.update_offset),
        desktopThreadId: firstString(telegram.desktopThreadId, telegram.desktop_thread_id) || null,
        connectedAt: firstString(telegram.connectedAt, telegram.connected_at) || null,
      });
      this.telegramCredentialStored = firstBoolean(telegram.credentialStored, telegram.credential_stored) === true;
      this.telegramSeenMessageIds = Array.isArray(telegram.seenMessageIds) ? telegram.seenMessageIds.map(String).slice(-MAX_SEEN_MESSAGES) : [];
    } catch {}
  }

  async saveState() {
    if (!this.statePath) return;
    const payload = {
      connected: Boolean(this.connection.connected && this.connection.botToken),
      status: this.connection.status || "disconnected",
      baseUrl: this.connection.baseUrl || null,
      botToken: this.connection.botToken || null,
      botId: this.connection.botId || null,
      userId: this.connection.userId || null,
      wechatUin: this.connection.wechatUin || null,
      cursor: this.connection.cursor || "",
      desktopThreadId: this.connection.desktopThreadId || null,
      accountLabel: this.connection.accountLabel || null,
      connectedAt: this.connection.connectedAt || null,
      wechatReusableConnections: this.wechatReusableBotTokens.map((token) => {
        const record = this.wechatReusableConnectionsByToken.get(token) || {};
        return {
          botToken: token,
          baseUrl: record.baseUrl || null,
          botId: record.botId || null,
          userId: record.userId || null,
          wechatUin: record.wechatUin || null,
          accountLabel: record.accountLabel || null,
          cursor: record.cursor || "",
        };
      }),
      seenMessageIds: this.seenMessageIds.slice(-MAX_SEEN_MESSAGES),
      messageContexts: Object.fromEntries([...this.messageContextById.entries()].slice(-MAX_SEEN_MESSAGES)),
      feishu: {
        connected: false,
        status: this.feishuConnection.connected ? "online" : this.feishuConnection.status || "disconnected",
        appId: this.feishuConnection.appId || null,
        accountLabel: this.feishuConnection.accountLabel || null,
        userOpenId: this.feishuConnection.userOpenId || null,
        tenantBrand: this.feishuConnection.tenantBrand || null,
        desktopThreadId: this.feishuConnection.desktopThreadId || null,
        connectedAt: this.feishuConnection.connectedAt || null,
        credentialStored: Boolean(this.feishuCredentialStored),
        seenMessageIds: this.feishuSeenMessageIds.slice(-MAX_SEEN_MESSAGES),
      },
      telegram: {
        connected: false,
        status: this.telegramConnection.connected ? "online" : this.telegramConnection.status || "disconnected",
        botId: this.telegramConnection.botId || null,
        botUsername: this.telegramConnection.botUsername || null,
        accountLabel: this.telegramConnection.accountLabel || null,
        updateOffset: this.telegramConnection.updateOffset ?? null,
        desktopThreadId: this.telegramConnection.desktopThreadId || null,
        connectedAt: this.telegramConnection.connectedAt || null,
        credentialStored: Boolean(this.telegramCredentialStored),
        seenMessageIds: this.telegramSeenMessageIds.slice(-MAX_SEEN_MESSAGES),
      },
      updatedAt: new Date().toISOString(),
    };
    try {
      await fs.mkdir(path.dirname(this.statePath), { recursive: true });
      await fs.writeFile(this.statePath, JSON.stringify(payload, null, 2), "utf8");
    } catch {}
  }

  async writeLog(event, payload = {}) {
    if (!this.logPath) return;
    try {
      await fs.mkdir(path.dirname(this.logPath), { recursive: true });
      await fs.appendFile(this.logPath, `${JSON.stringify({ ts: new Date().toISOString(), event, ...payload })}\n`, "utf8");
    } catch {}
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("error", reject);
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(httpError(400, "invalid JSON body"));
      }
    });
  });
}

function createDisconnectedConnection(overrides = {}) {
  return {
    connected: false,
    status: "disconnected",
    baseUrl: DEFAULT_WECHAT_ILINK_BASE_URL,
    botToken: null,
    botId: null,
    userId: null,
    wechatUin: null,
    accountLabel: null,
    cursor: "",
    desktopThreadId: null,
    connectedAt: null,
    lastPayload: null,
    ...overrides,
  };
}

function createDisconnectedFeishuConnection(overrides = {}) {
  return {
    connected: false,
    status: "disconnected",
    appId: null,
    appSecret: null,
    userOpenId: null,
    tenantBrand: null,
    accountLabel: null,
    desktopThreadId: null,
    connectedAt: null,
    tenantAccessToken: null,
    tenantAccessTokenExpiresAt: null,
    ...overrides,
  };
}

function createDisconnectedTelegramConnection(overrides = {}) {
  return {
    connected: false,
    status: "disconnected",
    botToken: null,
    botId: null,
    botUsername: null,
    accountLabel: null,
    updateOffset: null,
    desktopThreadId: null,
    connectedAt: null,
    ...overrides,
  };
}

function inboundAttachmentCacheDir(options = {}) {
  if (options.cacheDir) return options.cacheDir;
  const base = options.statePath ? path.dirname(options.statePath) : options.logPath ? path.dirname(path.dirname(options.logPath)) : "";
  return base ? path.join(base, "wechat-inbound-attachments") : null;
}

function feishuCredentialPathFromOptions(options = {}) {
  if (options.feishuCredentialPath) return options.feishuCredentialPath;
  const base = options.statePath ? path.dirname(options.statePath) : options.logPath ? path.dirname(path.dirname(options.logPath)) : "";
  return base ? path.join(base, "feishu-credentials.bin") : null;
}

function configureLarkSdkHttp(lark) {
  const defaults = lark?.defaultHttpInstance?.defaults;
  if (!defaults) return;
  // Axios' env-proxy handling can turn Feishu HTTPS registration requests into
  // plain HTTP through local proxies, which prevents the QR URL from loading.
  defaults.proxy = false;
}

function telegramCredentialPathFromOptions(options = {}) {
  if (options.telegramCredentialPath) return options.telegramCredentialPath;
  const base = options.statePath ? path.dirname(options.statePath) : options.logPath ? path.dirname(path.dirname(options.logPath)) : "";
  return base ? path.join(base, "telegram-credentials.bin") : null;
}

function loginPayload(session, overrides = {}) {
  const expiresAt = new Date(session.createdAt + LOGIN_SESSION_TTL_MS).toISOString();
  return {
    ok: true,
    session_key: session.sessionKey,
    sessionKey: session.sessionKey,
    channel: "wechat",
    status: session.status,
    connected: session.status === "connected",
    qrcode: session.qrcode,
    qrcode_url: session.qrcodeImage || session.qrcode,
    qrcodeUrl: session.qrcodeImage || session.qrcode,
    expires_at: expiresAt,
    expiresAt,
    direct_qr_only: false,
    directQrOnly: false,
    ...overrides,
  };
}

function feishuLoginPayload(session, overrides = {}) {
  const expiresAt = new Date(session.createdAt + LOGIN_SESSION_TTL_MS).toISOString();
  return {
    ok: true,
    session_key: session.sessionKey,
    sessionKey: session.sessionKey,
    channel: "feishu",
    status: session.status,
    connected: session.status === "connected",
    qrcode: session.qrcode || null,
    qrcode_url: session.qrcodeImage || session.qrcode || null,
    qrcodeUrl: session.qrcodeImage || session.qrcode || null,
    verification_url: session.qrcode || null,
    verificationUrl: session.qrcode || null,
    expires_at: expiresAt,
    expiresAt,
    direct_qr_only: false,
    directQrOnly: false,
    ...overrides,
  };
}

function telegramLoginPayload(session, overrides = {}) {
  const expiresAt = new Date(session.createdAt + LOGIN_SESSION_TTL_MS).toISOString();
  return {
    ok: true,
    session_key: session.sessionKey,
    sessionKey: session.sessionKey,
    channel: "telegram",
    status: session.status,
    connected: session.status === "connected",
    qrcode: null,
    qrcode_url: null,
    qrcodeUrl: null,
    expires_at: expiresAt,
    expiresAt,
    direct_qr_only: false,
    directQrOnly: false,
    message: session.error || null,
    ...overrides,
  };
}

function normalizeApiPath(value) {
  const text = String(value || DEFAULT_API_PATH).trim();
  return `/${text.replace(/^\/+|\/+$/g, "")}`;
}

function normalizeBaseUrl(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text) return DEFAULT_WECHAT_ILINK_BASE_URL;
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function uniqueFirstStrings(...values) {
  const seen = new Set();
  const output = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const text = firstString(value);
    if (!text || seen.has(text)) return;
    seen.add(text);
    output.push(text);
  };
  for (const value of values) visit(value);
  return output;
}

function firstNumber(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const number = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function numberOption(value, fallback) {
  const number = firstNumber(value);
  return number == null ? fallback : number;
}

function firstBoolean(...values) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const text = value.trim().toLowerCase();
      if (["true", "1", "yes", "y"].includes(text)) return true;
      if (["false", "0", "no", "n"].includes(text)) return false;
    }
    if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  }
  return null;
}

function compactObject(value) {
  const source = objectValue(value) || {};
  return Object.fromEntries(Object.entries(source).filter(([, item]) => item !== undefined && item !== null && item !== ""));
}

function envFirst(keys) {
  for (const key of keys) {
    const value = firstString(process.env[key]);
    if (value) return value;
  }
  return "";
}

function promiseWithTimeout(promise, timeoutMs, message) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(httpError(504, message)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function firstPayloadString(payload, ...keys) {
  const sources = [payload, payload?.data, payload?.result, payload?.payload, payload?.raw].filter(objectValue);
  for (const source of sources) {
    const value = firstString(...keys.map((key) => source[key]));
    if (value) return value;
  }
  return "";
}

function normalizeLoginStatus(payload) {
  if (firstPayloadString(payload, "bot_token", "botToken", "token", "access_token")) return "connected";
  const raw = rawWechatLoginStatus(payload);
  if (["confirmed", "connected", "success", "authorized", "logged_in", "login_success", "binded_redirect", "2", "200"].includes(raw)) return "connected";
  if (["scaned", "scanned", "scan", "scaned_but_redirect", "1", "201"].includes(raw)) return "scanned";
  if (["expired", "timeout", "cancelled", "canceled", "failed", "3", "400", "401", "403", "408"].includes(raw)) return "expired";
  return "waiting";
}

function rawWechatLoginStatus(payload) {
  return firstPayloadString(payload, "status", "qrcode_status", "qrcodeStatus", "state", "code", "ret").toLowerCase();
}

function extractIlinkMessages(payload) {
  const source = objectValue(payload?.data) || objectValue(payload?.result) || objectValue(payload) || {};
  for (const key of ["msgs", "messages", "items", "message_list", "messageList", "bot_message_list", "botMessageList", "updates"]) {
    if (Array.isArray(source[key])) return source[key];
  }
  return [];
}

function normalizeInboundWechatMessage(raw, connection) {
  if (!objectValue(raw)) return null;
  const messageType = firstNumber(raw.message_type, raw.messageType);
  if (messageType === 2) return null;
  const id = firstString(raw.message_id, raw.messageId, raw.id, raw.client_id, raw.clientId);
  if (!id) return null;
  const text = itemListText(raw.item_list || raw.itemList);
  const attachments = itemListAttachments(raw.item_list || raw.itemList);
  if (!text && !attachments.length) return null;
  const timestamp = firstNumber(raw.create_time_ms, raw.createTimeMs, raw.created_at_ms, raw.createdAtMs);
  return {
    id,
    message_id: id,
    messageId: id,
    channel: "wechat",
    text,
    content: text,
    attachments,
    created_at: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
    createdAt: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
    from_user_id: firstString(raw.from_user_id, raw.fromUserId),
    to_user_id: firstString(raw.to_user_id, raw.toUserId),
    account_label: connection.accountLabel || null,
    raw,
  };
}

function normalizeInboundFeishuMessage(raw, connection) {
  if (!objectValue(raw)) return null;
  const id = firstString(raw.messageId, raw.message_id, raw.id);
  const chatId = firstString(raw.chatId, raw.chat_id, raw.open_chat_id);
  if (!id || !chatId) return null;
  const rawText = firstString(raw.content, raw.text);
  const resourceHints = feishuResourcePlaceholderHints(rawText, firstString(raw.rawContentType, raw.raw_content_type));
  const text = stripFeishuResourcePlaceholders(rawText);
  const attachments = Array.isArray(raw.resources) ? raw.resources.map((resource) => feishuResourceAttachment(resource, resourceHints, id)).filter(Boolean) : [];
  if (!text && !attachments.length) return null;
  const createdAt = feishuMessageCreatedAt(raw.createTime ?? raw.create_time ?? raw.createdAt ?? raw.created_at);
  return {
    id,
    message_id: id,
    messageId: id,
    channel: "feishu",
    text,
    content: text,
    raw_content_type: firstString(raw.rawContentType, raw.raw_content_type),
    rawContentType: firstString(raw.rawContentType, raw.raw_content_type),
    attachments,
    resources: Array.isArray(raw.resources) ? raw.resources : [],
    created_at: createdAt,
    createdAt,
    from_user_id: firstString(raw.senderId, raw.sender_id),
    fromUserId: firstString(raw.senderId, raw.sender_id),
    sender_name: firstString(raw.senderName, raw.sender_name),
    senderName: firstString(raw.senderName, raw.sender_name),
    chat_id: chatId,
    chatId,
    chat_type: firstString(raw.chatType, raw.chat_type),
    chatType: firstString(raw.chatType, raw.chat_type),
    account_label: connection.accountLabel || null,
    accountLabel: connection.accountLabel || null,
    reply_to_message_id: firstString(raw.replyToMessageId, raw.reply_to_message_id),
    replyToMessageId: firstString(raw.replyToMessageId, raw.reply_to_message_id),
    thread_id: firstString(raw.threadId, raw.thread_id),
    threadId: firstString(raw.threadId, raw.thread_id),
    raw,
  };
}

function normalizeInboundTelegramMessage(update, connection) {
  const raw = objectValue(update);
  if (!raw) return null;
  const message = objectValue(raw.message) || objectValue(raw.edited_message);
  if (!message) return null;
  const chat = objectValue(message.chat) || {};
  const from = objectValue(message.from) || {};
  const chatId = firstString(chat.id);
  const messageNumber = firstNumber(message.message_id, message.messageId);
  if (!chatId || messageNumber == null) return null;
  const fromUserId = firstString(from.id);
  if (fromUserId && String(fromUserId) === String(connection.botId || "")) return null;
  const rawText = firstString(message.text, message.caption);
  const entities = Array.isArray(message.entities) ? message.entities : Array.isArray(message.caption_entities) ? message.caption_entities : [];
  const attachments = telegramMessageAttachments(message);
  if (!telegramShouldHandleMessage(message, rawText, entities, connection)) return null;
  const text = telegramCleanInboundText(rawText, entities, connection, attachments);
  if (!text && !attachments.length) return null;
  const createdAt = telegramMessageCreatedAt(message.date);
  const replyTo = objectValue(message.reply_to_message) || objectValue(message.replyToMessage);
  return {
    id: `${chatId}:${messageNumber}`,
    message_id: `${chatId}:${messageNumber}`,
    messageId: `${chatId}:${messageNumber}`,
    telegram_message_id: messageNumber,
    telegramMessageId: messageNumber,
    update_id: firstNumber(raw.update_id, raw.updateId),
    updateId: firstNumber(raw.update_id, raw.updateId),
    channel: "telegram",
    text,
    content: text,
    attachments,
    created_at: createdAt,
    createdAt,
    from_user_id: fromUserId,
    fromUserId,
    sender_name: telegramSenderName(from),
    senderName: telegramSenderName(from),
    chat_id: chatId,
    chatId,
    chat_type: firstString(chat.type),
    chatType: firstString(chat.type),
    chat_title: firstString(chat.title, chat.username),
    chatTitle: firstString(chat.title, chat.username),
    account_label: connection.accountLabel || null,
    accountLabel: connection.accountLabel || null,
    reply_to_message_id: replyTo ? firstString(replyTo.message_id, replyTo.messageId) : null,
    replyToMessageId: replyTo ? firstString(replyTo.message_id, replyTo.messageId) : null,
    message_thread_id: firstString(message.message_thread_id, message.messageThreadId),
    messageThreadId: firstString(message.message_thread_id, message.messageThreadId),
    raw,
  };
}

function telegramShouldHandleMessage(message, text, entities, connection) {
  const chat = objectValue(message.chat) || {};
  const type = firstString(chat.type).toLowerCase();
  if (type === "private" || !type) return true;
  return telegramMessageRepliesToBot(message, connection) || telegramMessageMentionsBot(text, entities, connection) || telegramCommandTargetsBot(text, entities, connection);
}

function telegramMessageRepliesToBot(message, connection) {
  const replyTo = objectValue(message.reply_to_message) || objectValue(message.replyToMessage);
  const replyFrom = objectValue(replyTo?.from) || {};
  return Boolean(replyFrom && firstString(replyFrom.id) && String(firstString(replyFrom.id)) === String(connection.botId || ""));
}

function telegramMessageMentionsBot(text, entities, connection) {
  const username = String(connection.botUsername || "").replace(/^@/, "").toLowerCase();
  if (!username) return false;
  for (const entity of Array.isArray(entities) ? entities : []) {
    const record = objectValue(entity);
    if (!record || firstString(record.type).toLowerCase() !== "mention") continue;
    if (telegramEntityText(text, record).replace(/^@/, "").toLowerCase() === username) return true;
  }
  return new RegExp(`@${escapeRegExp(username)}\\b`, "i").test(String(text || ""));
}

function telegramCommandTargetsBot(text, entities, connection) {
  const username = String(connection.botUsername || "").replace(/^@/, "").toLowerCase();
  for (const entity of Array.isArray(entities) ? entities : []) {
    const record = objectValue(entity);
    if (!record || firstString(record.type).toLowerCase() !== "bot_command") continue;
    const command = telegramEntityText(text, record).toLowerCase();
    if (!command.startsWith("/")) continue;
    const atIndex = command.indexOf("@");
    if (atIndex >= 0 && username && command.slice(atIndex + 1) === username) return true;
  }
  return false;
}

function telegramCleanInboundText(text, entities, connection, attachments = []) {
  let value = String(text || "").trim();
  const username = String(connection.botUsername || "").replace(/^@/, "");
  if (username) {
    value = value.replace(new RegExp(`@${escapeRegExp(username)}\\b`, "gi"), "").trim();
    value = value.replace(new RegExp(`(/\\w+)@${escapeRegExp(username)}\\b`, "gi"), "$1").trim();
  }
  if (/^\/start(?:\s+\S+)?$/i.test(value)) return attachments.length ? "" : "\u4f60\u597d";
  return value.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function telegramEntityText(text, entity) {
  const offset = firstNumber(entity.offset) || 0;
  const length = firstNumber(entity.length) || 0;
  return String(text || "").slice(offset, offset + length);
}

function telegramMessageAttachments(message) {
  const attachments = [];
  const photos = Array.isArray(message.photo) ? message.photo.filter(objectValue) : [];
  if (photos.length) {
    const photo = photos.reduce((best, item) => ((firstNumber(item.file_size, item.fileSize) || 0) > (firstNumber(best.file_size, best.fileSize) || 0) ? item : best), photos[0]);
    attachments.push(telegramFileAttachment(photo, "image", telegramDefaultFileName("telegram-photo", photo, ".jpg"), "image/jpeg"));
  }
  const document = objectValue(message.document);
  if (document) {
    attachments.push(
      telegramFileAttachment(
        document,
        "file",
        firstString(document.file_name, document.fileName) || telegramDefaultFileName("telegram-file", document, ""),
        firstString(document.mime_type, document.mimeType) || "",
      ),
    );
  }
  const video = objectValue(message.video);
  if (video) attachments.push(telegramFileAttachment(video, "video", firstString(video.file_name, video.fileName) || telegramDefaultFileName("telegram-video", video, ".mp4"), "video/mp4"));
  const animation = objectValue(message.animation);
  if (animation) {
    attachments.push(
      telegramFileAttachment(animation, "video", firstString(animation.file_name, animation.fileName) || telegramDefaultFileName("telegram-animation", animation, ".mp4"), "video/mp4"),
    );
  }
  const audio = objectValue(message.audio);
  if (audio) attachments.push(telegramFileAttachment(audio, "audio", firstString(audio.file_name, audio.fileName) || telegramDefaultFileName("telegram-audio", audio, ".mp3"), "audio/mpeg"));
  const voice = objectValue(message.voice);
  if (voice) attachments.push(telegramFileAttachment(voice, "audio", telegramDefaultFileName("telegram-voice", voice, ".ogg"), "audio/ogg"));
  return attachments.filter(Boolean);
}

function telegramFileAttachment(file, type, name, fallbackMime = "") {
  if (!objectValue(file)) return null;
  const fileId = firstString(file.file_id, file.fileId);
  if (!fileId) return null;
  const fileUniqueId = firstString(file.file_unique_id, file.fileUniqueId);
  const fileName = name || telegramDefaultFileName(`telegram-${type || "file"}`, file, "");
  const mime = firstString(file.mime_type, file.mimeType, fallbackMime) || generatedMimeFromPath(fileName);
  return {
    name: fileName,
    file_name: fileName,
    fileName,
    mime,
    mime_type: mime,
    mimeType: mime,
    size: firstNumber(file.file_size, file.fileSize),
    size_bytes: firstNumber(file.file_size, file.fileSize),
    sizeBytes: firstNumber(file.file_size, file.fileSize),
    file_id: fileId,
    fileId,
    telegram_file_id: fileId,
    telegramFileId: fileId,
    telegram_file_unique_id: fileUniqueId,
    telegramFileUniqueId: fileUniqueId,
    type: type || "file",
    kind: type || "file",
    telegram_download_type: type || "file",
    telegramDownloadType: type || "file",
    object_key: fileUniqueId || fileId,
    objectKey: fileUniqueId || fileId,
  };
}

function telegramAttachmentIdentity(attachment) {
  if (!objectValue(attachment)) return "";
  const key = firstString(
    attachment.telegram_file_unique_id,
    attachment.telegramFileUniqueId,
    attachment.object_key,
    attachment.objectKey,
    attachment.local_path,
    attachment.localPath,
    attachment.path,
  );
  if (key) return key.toLowerCase();
  const name = wechatAttachmentDisplayName(attachment).toLowerCase();
  const size = firstNumber(attachment.size, attachment.size_bytes, attachment.sizeBytes, attachment.file_size, attachment.fileSize);
  return name && size ? `${name}:${size}` : "";
}

function telegramDefaultFileName(prefix, file, ext = "") {
  const suffix = sanitizeFileName(firstString(file.file_unique_id, file.fileUniqueId, file.file_id, file.fileId).slice(-18) || "file");
  return `${prefix}-${suffix}${ext && !suffix.toLowerCase().endsWith(ext.toLowerCase()) ? ext : ""}`;
}

function telegramSenderName(from) {
  return [firstString(from.first_name, from.firstName), firstString(from.last_name, from.lastName)].filter(Boolean).join(" ") || firstString(from.username) || "Telegram";
}

function telegramMessageCreatedAt(value) {
  const number = firstNumber(value);
  if (!number) return new Date().toISOString();
  const date = new Date(number * 1000);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function telegramMessageReplyContext(message) {
  return {
    chatId: firstString(message.chat_id, message.chatId),
    messageId: firstNumber(message.telegram_message_id, message.telegramMessageId),
    messageThreadId: firstString(message.message_thread_id, message.messageThreadId),
  };
}

function feishuInboundBatchKey(message) {
  return [
    firstString(message?.chat_id, message?.chatId) || "chat",
    firstString(message?.from_user_id, message?.fromUserId) || "sender",
    firstString(message?.chat_type, message?.chatType) || "type",
  ].join(":");
}

function mergeFeishuInboundMessages(messages) {
  const valid = Array.isArray(messages) ? messages.filter(Boolean) : [];
  if (valid.length <= 1) return valid[0] || null;
  const first = valid[0];
  const last = valid[valid.length - 1];
  const text = valid
    .map((message) => firstString(message.text, message.content))
    .filter(Boolean)
    .join("\n\n");
  const sourceMessageIds = uniqueFirstStrings(valid.map((message) => firstString(message.id, message.message_id, message.messageId)));
  const attachments = valid.flatMap((message) => {
    const sourceMessageId = firstString(message.id, message.message_id, message.messageId);
    return (Array.isArray(message.attachments) ? message.attachments : []).map((attachment) => ({
      ...attachment,
      feishu_message_id: firstString(attachment.feishu_message_id, attachment.feishuMessageId, attachment.resource_message_id, attachment.resourceMessageId, sourceMessageId) || null,
      feishuMessageId: firstString(attachment.feishu_message_id, attachment.feishuMessageId, attachment.resource_message_id, attachment.resourceMessageId, sourceMessageId) || null,
      resource_message_id: firstString(attachment.resource_message_id, attachment.resourceMessageId, attachment.feishu_message_id, attachment.feishuMessageId, sourceMessageId) || null,
      resourceMessageId: firstString(attachment.resource_message_id, attachment.resourceMessageId, attachment.feishu_message_id, attachment.feishuMessageId, sourceMessageId) || null,
    }));
  });
  return {
    ...last,
    text,
    content: text,
    attachments,
    resources: valid.flatMap((message) => (Array.isArray(message.resources) ? message.resources : [])),
    source_message_ids: sourceMessageIds,
    sourceMessageIds: sourceMessageIds,
    created_at: firstString(first.created_at, first.createdAt) || firstString(last.created_at, last.createdAt),
    createdAt: firstString(first.createdAt, first.created_at) || firstString(last.createdAt, last.created_at),
  };
}

function stripFeishuResourcePlaceholders(value) {
  const text = String(value || "");
  if (!text) return "";
  return text
    .replace(/!?\[[^\]\r\n]*\]\(\s*(?:img|image|file|media|audio|video)[_-][^) \r\n]*\s*\)/gi, "")
    .replace(/<\s*(?:file|img|image|media|audio|video)\b[^>]*>\s*<\/\s*(?:file|img|image|media|audio|video)\s*>/gi, "")
    .replace(/<\s*(?:file|img|image|media|audio|video)\b[^>]*\/\s*>/gi, "")
    .replace(/^\s*(?:img|image|file|media|audio|video)[_-][^\s<>()\[\]]+\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function feishuResourcePlaceholderHints(value, rawContentType = "") {
  const text = String(value || "");
  const imageKeys = new Set();
  const resourceTypes = new Map();
  for (const match of text.matchAll(/!?\[[^\]\r\n]*\]\(\s*([^)\s\r\n]+)\s*\)/gi)) {
    const key = feishuResourcePlaceholderKey(match[1]);
    const type = feishuResourceKeyType(key);
    if (key && type) resourceTypes.set(key, type);
    if (key && type === "image") imageKeys.add(key);
  }
  for (const match of text.matchAll(/<\s*(file|img|image|media|audio|video)\b[^>]*\b(?:key|image_key|file_key)=["']([^"']+)["'][^>]*\/?\s*>/gi)) {
    const key = feishuResourcePlaceholderKey(match[2]);
    const type = normalizeFeishuResourceType(match[1]);
    if (key && type) resourceTypes.set(key, type);
    if (key && type === "image") imageKeys.add(key);
  }
  return {
    imageKeys,
    resourceTypes,
    defaultType: normalizeFeishuResourceType(rawContentType),
  };
}

function feishuResourcePlaceholderKey(value) {
  const text = firstString(value);
  if (!text) return "";
  return text.replace(/^["'`<]+|["'`>)]+$/g, "").trim();
}

function feishuResourceKeyLooksLikeImage(value) {
  return feishuResourceKeyType(value) === "image";
}

function feishuResourceKeyType(value) {
  const text = String(value || "").trim().toLowerCase();
  if (/^(?:img|image)[_-]/.test(text)) return "image";
  if (/^(?:media|video)[_-]/.test(text)) return "media";
  if (/^audio[_-]/.test(text)) return "audio";
  if (/^file[_-]/.test(text)) return "file";
  return "";
}

function feishuResourceAttachment(resource, hints = {}, fallbackMessageId = "") {
  if (!objectValue(resource)) return null;
  const image = objectValue(resource.image) || objectValue(resource.image_content) || objectValue(resource.imageContent) || {};
  const file = objectValue(resource.file) || objectValue(resource.file_content) || objectValue(resource.fileContent) || objectValue(resource.media) || {};
  const fileKey = firstString(
    resource.fileKey,
    resource.file_key,
    resource.imageKey,
    resource.image_key,
    resource.key,
    resource.file_id,
    resource.fileId,
    image.imageKey,
    image.image_key,
    image.key,
    file.fileKey,
    file.file_key,
    file.mediaKey,
    file.media_key,
    file.key,
  );
  const type = normalizeFeishuResourceType(firstString(resource.type, resource.resource_type, resource.resourceType, resource.message_type, resource.messageType, hints.defaultType), resource, fileKey, hints);
  const name = firstString(
    resource.fileName,
    resource.file_name,
    resource.name,
    resource.title,
    image.fileName,
    image.file_name,
    image.name,
    file.fileName,
    file.file_name,
    file.name,
    fileKey ? feishuResourceDefaultName(type, fileKey) : "",
  );
  if (!fileKey && !name) return null;
  const mime = feishuResourceMime(type, name);
  const downloadType = feishuResourceDownloadType({ resource_type: type });
  const resourceMessageId = feishuResourceMessageId(resource, fallbackMessageId);
  return {
    name: name || "feishu-file",
    file_name: name || "feishu-file",
    fileName: name || "feishu-file",
    mime,
    mime_type: mime,
    mimeType: mime,
    size: firstNumber(resource.size, resource.size_bytes, resource.sizeBytes, resource.fileSize, resource.file_size, file.size, file.fileSize, file.file_size),
    size_bytes: firstNumber(resource.size, resource.size_bytes, resource.sizeBytes, resource.fileSize, resource.file_size, file.size, file.fileSize, file.file_size),
    sizeBytes: firstNumber(resource.size, resource.size_bytes, resource.sizeBytes, resource.fileSize, resource.file_size, file.size, file.fileSize, file.file_size),
    object_key: fileKey || null,
    file_key: fileKey || null,
    fileKey: fileKey || null,
    feishu_message_id: resourceMessageId || null,
    feishuMessageId: resourceMessageId || null,
    resource_message_id: resourceMessageId || null,
    resourceMessageId: resourceMessageId || null,
    resource_type: type,
    resourceType: type,
    feishu_download_type: downloadType,
    feishuDownloadType: downloadType,
    raw: resource,
  };
}

function feishuResourceMessageId(resource, fallbackMessageId = "") {
  const record = objectValue(resource) || {};
  const raw = objectValue(record.raw) || {};
  const message = objectValue(record.message) || objectValue(raw.message) || {};
  return firstString(
    record.feishu_message_id,
    record.feishuMessageId,
    record.resource_message_id,
    record.resourceMessageId,
    record.messageId,
    record.message_id,
    record.open_message_id,
    record.openMessageId,
    message.messageId,
    message.message_id,
    message.open_message_id,
    message.openMessageId,
    raw.messageId,
    raw.message_id,
    raw.open_message_id,
    raw.openMessageId,
    fallbackMessageId,
  );
}

function feishuResourceDownloadMessageIds(attachment) {
  const record = objectValue(attachment) || {};
  return uniqueFirstStrings(
    feishuResourceMessageId(record),
    record.source_message_ids,
    record.sourceMessageIds,
  );
}

function feishuMessageDownloadCandidateIds(message) {
  const record = objectValue(message) || {};
  return uniqueFirstStrings(
    record.id,
    record.message_id,
    record.messageId,
    record.source_message_ids,
    record.sourceMessageIds,
  );
}

function normalizeFeishuResourceType(type, resource = {}, fileKey = "", hints = {}) {
  const resourceKey = firstString(
    fileKey,
    resource?.fileKey,
    resource?.file_key,
    resource?.imageKey,
    resource?.image_key,
    resource?.object_key,
    resource?.objectKey,
    objectValue(resource?.image)?.imageKey,
    objectValue(resource?.image)?.image_key,
  );
  const keyType = feishuResourceKeyType(resourceKey);
  const value = String(type || "").trim().toLowerCase();
  if (value === "img") return "image";
  if (value === "video") return "media";
  if (["image", "audio", "media"].includes(value)) return value;
  if (resourceKey && hints.resourceTypes?.has?.(resourceKey)) return hints.resourceTypes.get(resourceKey);
  if (keyType && (!value || value === "file")) return keyType;
  if (value === "file") return "file";
  if (resourceKey && (feishuResourceKeyLooksLikeImage(resourceKey) || hints.imageKeys?.has?.(resourceKey))) return "image";
  if (firstString(resource.imageKey, resource.image_key, objectValue(resource.image)?.imageKey, objectValue(resource.image)?.image_key)) return "image";
  return "file";
}

function feishuResourceDownloadType(resource) {
  const type = normalizeFeishuResourceType(
    firstString(resource?.feishu_download_type, resource?.feishuDownloadType, resource?.resource_type, resource?.resourceType, resource?.type),
    resource,
  );
  return type === "image" || type === "audio" || type === "media" ? type : "file";
}

function feishuResourceDefaultName(type, fileKey) {
  const suffix = sanitizeFileName(String(fileKey || "").slice(-16) || "file");
  if (type === "image") return `feishu-image-${suffix}.jpg`;
  if (type === "audio") return `feishu-audio-${suffix}.mp3`;
  if (type === "media") return `feishu-video-${suffix}.mp4`;
  return `feishu-file-${suffix}`;
}

function feishuResourceIsPreviewable(downloadType, mime, name) {
  const type = String(downloadType || "").toLowerCase();
  const mimeText = String(mime || "").toLowerCase();
  if (type === "image" || mimeText.startsWith("image/")) return true;
  if (type === "media" || mimeText.startsWith("video/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg|mp4|m4v|webm|ogg|mov)$/i.test(String(name || ""));
}

function feishuResourceMime(type, name) {
  const value = String(type || "").toLowerCase();
  if (value === "image") return imageMimeFromPath(name) || "image/jpeg";
  if (value === "media" || value === "video") return videoMimeFromPath(name) || "video/mp4";
  if (value === "audio") return "audio/mpeg";
  return generatedMimeFromPath(name);
}

function feishuMessageCreatedAt(value) {
  const number = firstNumber(value);
  if (!number) return new Date().toISOString();
  const ms = number < 10_000_000_000 ? number * 1000 : number;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function feishuAccountLabel(userInfo = {}, appId = "") {
  const tenantBrand = firstString(userInfo.tenant_brand, userInfo.tenantBrand);
  const userId = firstString(userInfo.open_id, userInfo.openId);
  if (tenantBrand && userId) return `${tenantBrand}:${userId}`;
  return userId || appId || "\u98de\u4e66";
}

function normalizeTelegramBotToken(value) {
  const token = String(value || "").trim();
  return /^\d+:[A-Za-z0-9_-]{20,}$/.test(token) ? token : "";
}

function telegramBotLink(username) {
  const value = String(username || "").replace(/^@/, "").trim();
  return value ? `https://t.me/${value}?start=haolo` : null;
}

function telegramBotStartGroupLink(username) {
  const value = String(username || "").replace(/^@/, "").trim();
  return value ? `https://t.me/${value}?startgroup=haolo` : null;
}

function telegramMessageChunks(text) {
  const value = String(text || "").trim();
  if (!value) return [];
  const chunks = [];
  for (let index = 0; index < value.length; index += 3800) {
    chunks.push(value.slice(index, index + 3800));
  }
  return chunks;
}

function telegramResourceIsPreviewable(mime, name) {
  const value = String(mime || "").toLowerCase();
  return value.startsWith("image/") || /\.(?:png|jpe?g|gif|bmp|webp)$/i.test(String(name || "").split(/[?#]/)[0] || "");
}

function telegramAttachmentShouldSendAsPhoto(mime, name) {
  const value = String(mime || "").toLowerCase();
  if (/^image\/(?:png|jpe?g|gif|bmp|webp)$/.test(value)) return true;
  return /\.(?:png|jpe?g|gif|bmp|webp)$/i.test(String(name || "").split(/[?#]/)[0] || "");
}

function itemListText(value) {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      if (!objectValue(item)) return "";
      const text = firstString(item.text_item?.text, item.textItem?.text, item.voice_item?.text, item.voiceItem?.text);
      const refText = firstString(item.ref_msg?.title, item.refMsg?.title);
      return [text, refText].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function itemListAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!objectValue(item)) return null;
      const fileItem = objectValue(item.file_item) || objectValue(item.fileItem);
      const imageItem = objectValue(item.image_item) || objectValue(item.imageItem);
      const videoItem = objectValue(item.video_item) || objectValue(item.videoItem);
      const file = fileItem || imageItem || videoItem;
      if (!file) return null;
      const media = objectValue(file.media) || {};
      const kind = imageItem ? "image" : videoItem ? "video" : "file";
      const url = wechatInboundAttachmentUrl(file, media);
      const name = wechatInboundAttachmentName(kind, file, url);
      const mime = wechatInboundAttachmentMime(kind, name, file);
      const objectKey = firstString(media.encrypt_query_param, media.encryptQueryParam);
      const aesKey = firstString(media.aes_key, media.aesKey, file.aeskey, file.aes_key, file.aesKey);
      return {
        name: name || "wechat-file",
        file_name: name || "wechat-file",
        fileName: name || "wechat-file",
        mime,
        mime_type: mime,
        mimeType: mime,
        size: firstNumber(file.len, file.size, file.file_size, file.fileSize),
        size_bytes: firstNumber(file.len, file.size, file.file_size, file.fileSize),
        sizeBytes: firstNumber(file.len, file.size, file.file_size, file.fileSize),
        media,
        object_key: objectKey,
        aes_key: aesKey,
        url: url || null,
        preview_url: kind === "image" || kind === "video" ? url || null : null,
        previewUrl: kind === "image" || kind === "video" ? url || null : null,
        download_url: url || null,
        downloadUrl: url || null,
      };
    })
    .filter(Boolean);
}

function wechatInboundAttachmentUrl(file, media) {
  return firstString(
    file.full_url,
    file.fullUrl,
    file.fullurl,
    file.url,
    file.file_url,
    file.fileUrl,
    file.media_url,
    file.mediaUrl,
    file.cdn_url,
    file.cdnUrl,
    file.thumb_url,
    file.thumbUrl,
    file.download_url,
    file.downloadUrl,
    media.full_url,
    media.fullUrl,
    media.fullurl,
    media.url,
    media.file_url,
    media.fileUrl,
    media.media_url,
    media.mediaUrl,
    media.cdn_url,
    media.cdnUrl,
    media.thumb_url,
    media.thumbUrl,
    media.download_url,
    media.downloadUrl,
  );
}

function wechatInboundAttachmentName(kind, file, url) {
  const explicitName = firstString(file.file_name, file.fileName, file.name, file.filename, file.title);
  const urlName = fileNameFromReference(url);
  const rawName = explicitName || (urlName && path.extname(urlName) ? urlName : "");
  if (rawName && path.extname(rawName)) return rawName;
  if (kind === "image") return rawName && rawName !== "wechat-image" ? `${rawName}.jpg` : "wechat-image.jpg";
  if (kind === "video") return rawName && rawName !== "wechat-video" ? `${rawName}.mp4` : "wechat-video.mp4";
  return rawName || urlName || "wechat-file";
}

function wechatInboundAttachmentMime(kind, name, file) {
  const explicitMime = firstString(file.mime, file.mime_type, file.mimeType, file.content_type, file.contentType);
  if (explicitMime) return explicitMime;
  if (kind === "image") return imageMimeFromPath(name) || "image/jpeg";
  if (kind === "video") return videoMimeFromPath(name) || "video/mp4";
  return generatedMimeFromPath(name);
}

function fileNameFromReference(value) {
  const text = firstString(value);
  if (!text) return "";
  const withoutQuery = text.split(/[?#]/)[0] || "";
  const normalized = withoutQuery.replace(/\\/g, "/").replace(/\/+$/g, "");
  const name = normalized.split("/").pop() || "";
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function imageMimeFromPath(value) {
  const lower = String(value || "").toLowerCase().split(/[?#]/)[0] || "";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "";
}

function videoMimeFromPath(value) {
  const lower = String(value || "").toLowerCase().split(/[?#]/)[0] || "";
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".ogg")) return "video/ogg";
  if (lower.endsWith(".mov")) return "video/quicktime";
  return "";
}

function generatedMimeFromPath(value) {
  const lower = String(value || "").toLowerCase().split(/[?#]/)[0] || "";
  const imageMime = imageMimeFromPath(lower);
  if (imageMime) return imageMime;
  const videoMime = videoMimeFromPath(lower);
  if (videoMime) return videoMime;
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (/\.(doc|docx|wps)$/.test(lower)) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".rtf")) return "application/rtf";
  if (/\.(xls|xlsx)$/.test(lower)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (/\.(ppt|pptx)$/.test(lower)) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".txt") || lower.endsWith(".log")) return "text/plain";
  if (/\.(zip|rar|7z)$/.test(lower)) return "application/zip";
  return "application/octet-stream";
}

function inboundAttachmentPath(cacheDir, messageId, index, name, remoteUrl) {
  const hash = crypto.createHash("sha256").update(`${messageId}\n${index}\n${remoteUrl}`).digest("hex").slice(0, 16);
  const safeMessageId = sanitizeFileName(String(messageId || "message"));
  const safeName = sanitizeFileName(name || "wechat-file");
  return path.join(cacheDir, safeMessageId || "message", `${String(index + 1).padStart(2, "0")}-${hash}-${safeName}`);
}

function sanitizeFileName(value) {
  const name = path.basename(String(value || "wechat-file").replace(/\\/g, "/")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  return (name || "wechat-file").slice(0, 180);
}

function decodeInboundWechatAttachment(raw, attachment, mime, name) {
  if (looksLikePreviewableBytes(raw, mime, name)) return raw;
  for (const key of inboundWechatAesKeyCandidates(attachment)) {
    try {
      const decoded = decryptAes128Ecb(raw, key);
      if (looksLikePreviewableBytes(decoded, mime, name) || decoded.length < raw.length) return decoded;
    } catch {}
  }
  return raw;
}

function inboundWechatAesKeyCandidates(attachment) {
  const record = objectValue(attachment) || {};
  const media = objectValue(record.media) || {};
  const values = [
    record.aes_key,
    record.aesKey,
    record.aeskey,
    media.aes_key,
    media.aesKey,
    media.aeskey,
  ];
  const keys = [];
  for (const value of values) {
    const text = firstString(value);
    if (!text) continue;
    for (const candidate of aesKeyCandidatesFromText(text)) {
      if (candidate.length === 16 && !keys.some((key) => key.equals(candidate))) keys.push(candidate);
    }
  }
  return keys;
}

function aesKeyCandidatesFromText(text) {
  const candidates = [];
  const clean = text.trim();
  const add = (buffer) => {
    if (Buffer.isBuffer(buffer) && buffer.length === 16 && !candidates.some((item) => item.equals(buffer))) candidates.push(buffer);
  };
  if (/^[0-9a-f]{32}$/i.test(clean)) add(Buffer.from(clean, "hex"));
  try {
    const decoded = Buffer.from(clean, "base64");
    add(decoded);
    const decodedText = decoded.toString("utf8").trim();
    if (/^[0-9a-f]{32}$/i.test(decodedText)) add(Buffer.from(decodedText, "hex"));
  } catch {}
  return candidates;
}

function decryptAes128Ecb(ciphertext, aesKey) {
  const decipher = crypto.createDecipheriv("aes-128-ecb", aesKey, null);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function looksLikePreviewableBytes(bytes, mime, name) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) return false;
  const lowerMime = String(mime || "").toLowerCase();
  const lowerName = String(name || "").toLowerCase();
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  if (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a") return true;
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return true;
  if (bytes.subarray(0, 4).toString("ascii") === "%PDF") return true;
  if (bytes.subarray(0, 2).toString("ascii") === "PK") return true;
  if (lowerMime.startsWith("text/") || /\.(txt|md|json|csv|log)$/i.test(lowerName)) return looksLikeTextBytes(bytes);
  return false;
}

function looksLikeTextBytes(bytes) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 512));
  if (!sample.length) return false;
  let printable = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 0x80) printable += 1;
  }
  return printable / sample.length > 0.9;
}

async function fileExists(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function messageReplyContext(raw, connection) {
  const fromUserId = firstString(raw.from_user_id, raw.fromUserId);
  const toUserId = firstString(raw.to_user_id, raw.toUserId, connection.botId, connection.userId);
  return {
    contextToken: firstString(raw.context_token, raw.contextToken),
    replyFromUserId: toUserId || connection.botId || connection.userId || "",
    replyToUserId: fromUserId,
  };
}

function messageContextsFromState(value) {
  const source = objectValue(value);
  if (!source) return new Map();
  const entries = Object.entries(source)
    .map(([messageId, context]) => {
      const record = objectValue(context);
      if (!messageId || !record) return null;
      const normalized = {
        contextToken: firstString(record.contextToken, record.context_token),
        replyFromUserId: firstString(record.replyFromUserId, record.reply_from_user_id),
        replyToUserId: firstString(record.replyToUserId, record.reply_to_user_id),
      };
      return normalized.contextToken && normalized.replyFromUserId && normalized.replyToUserId ? [messageId, normalized] : null;
    })
    .filter(Boolean);
  return new Map(entries.slice(-MAX_SEEN_MESSAGES));
}

function trimMapToLimit(map, limit) {
  if (!map || !Number.isFinite(limit) || limit <= 0) return;
  while (map.size > limit) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) return;
    map.delete(oldest);
  }
}

function replyTextWithAttachments(text, attachments) {
  const base = String(text || "").trim();
  const lines = Array.isArray(attachments)
    ? attachments
        .map((attachment) => {
          if (!objectValue(attachment)) return "";
          const name = firstString(attachment.name, attachment.file_name, attachment.fileName) || "attachment";
          const url = firstString(attachment.download_url, attachment.downloadUrl, attachment.url);
          return url ? `- ${name}: ${url}` : `- ${name}`;
        })
        .filter(Boolean)
    : [];
  if (!lines.length) return base;
  return `${base}\n\nAttachments:\n${lines.join("\n")}`.trim();
}

function stripExternalReplyAttachmentsBlock(text) {
  const value = String(text || "");
  const match = value.match(/(?:^|\n)\s*Attachments\s*:\s*\n[\s\S]*$/i);
  if (!match || match.index == null) return value.trim();
  return value.slice(0, match.index).trim();
}

function cleanFeishuReplyText(text, attachments) {
  const value = stripExternalReplyAttachmentsBlock(text);
  if (!Array.isArray(attachments) || !attachments.length) return value.trim();
  const names = new Set();
  const references = new Set();
  for (const attachment of attachments) {
    const filePath = wechatAttachmentLocalPath(attachment);
    const name = wechatAttachmentFileName(attachment, filePath);
    if (name) names.add(name.toLowerCase());
    if (filePath) references.add(normalizedAttachmentReference(filePath));
  }
  const withoutMarkdownLinks = value.replace(/\[([^\]\r\n]+)\]\(([^\)\r\n]+)\)/g, (match, label, target) =>
    attachmentReferenceMatches(String(label || ""), names, references) || attachmentReferenceMatches(String(target || ""), names, references) ? "" : match,
  );
  return withoutMarkdownLinks
    .split(/\r?\n/)
    .filter((line) => !attachmentReferenceLine(line, names, references))
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function attachmentReferenceLine(line, names, references) {
  const text = String(line || "")
    .replace(/^[\s>*\-•\d.、]+/u, "")
    .replace(/`/g, "")
    .trim();
  if (!text) return false;
  if (attachmentReferenceMatches(text, names, references)) return true;
  const localPath = localPathFromReference(text);
  if (!localPath) return false;
  const lower = text.toLowerCase();
  return Array.from(names).some((name) => lower.includes(name));
}

function attachmentReferenceMatches(value, names, references) {
  const text = String(value || "").trim().replace(/^["'`]+|["'`]+$/g, "");
  if (!text) return false;
  const localPath = localPathFromReference(text);
  if (localPath && references.has(normalizedAttachmentReference(localPath))) return true;
  const normalized = normalizedAttachmentReference(text);
  if (references.has(normalized)) return true;
  const name = fileNameFromReference(text).toLowerCase();
  return Boolean(name && names.has(name));
}

function normalizedAttachmentReference(value) {
  return String(value || "").trim().replace(/^["'`]+|["'`]+$/g, "").replace(/\\/g, "/").toLowerCase();
}

function feishuAttachmentSendInput(attachment, filePath, fileName) {
  const mime = firstString(attachment?.mime, attachment?.mime_type, attachment?.mimeType) || generatedMimeFromPath(fileName || filePath);
  if (feishuAttachmentShouldSendAsImage(mime, fileName || filePath)) {
    return { image: { source: filePath } };
  }
  return { file: { source: filePath, fileName } };
}

function feishuAttachmentShouldSendAsImage(mime, name) {
  const mimeText = String(mime || "").toLowerCase();
  if (/^image\/(?:png|jpe?g|gif|bmp|webp)$/.test(mimeText)) return true;
  return /\.(?:png|jpe?g|gif|bmp|webp)$/i.test(String(name || "").split(/[?#]/)[0] || "");
}

function wechatAttachmentDisplayName(attachment) {
  return firstString(attachment?.name, attachment?.file_name, attachment?.fileName) || "attachment";
}

function wechatAttachmentLocalPath(attachment) {
  if (!objectValue(attachment)) return "";
  for (const key of ["local_path", "localPath", "file_path", "filePath", "path", "url", "download_url", "downloadUrl"]) {
    const value = firstString(attachment[key]);
    const filePath = localPathFromReference(value);
    if (filePath) return filePath;
  }
  return "";
}

function localPathFromReference(value) {
  const text = String(value || "").trim().replace(/^["']|["']$/g, "");
  if (!text) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^file:/i.test(text)) return "";
  if (/^file:/i.test(text)) {
    try {
      return fileURLToPath(text);
    } catch {
      return "";
    }
  }
  if (/^[a-z]:[\\/]/i.test(text) || text.startsWith("\\\\") || text.startsWith("/") || text.startsWith("\\")) {
    return path.normalize(text);
  }
  return "";
}

function wechatAttachmentFileName(attachment, filePath) {
  const rawName = wechatAttachmentDisplayName(attachment);
  const pathName = path.basename(String(filePath || ""));
  let name = path.basename(rawName.replace(/\\/g, "/")).trim() || pathName || "attachment";
  if (!path.extname(name) && path.extname(pathName)) name = `${name}${path.extname(pathName)}`;
  return name.slice(0, 180);
}

function encryptAes128Ecb(plaintext, aesKey) {
  const cipher = crypto.createCipheriv("aes-128-ecb", aesKey, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

function buildCdnUploadUrl(cdnBaseUrl, uploadParam, filekey) {
  const base = normalizeBaseUrl(cdnBaseUrl || DEFAULT_WECHAT_ILINK_CDN_BASE_URL).replace(/\/+$/, "");
  return `${base}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`;
}

function redactConnectionPayload(payload) {
  const source = objectValue(payload) ? { ...payload } : {};
  for (const key of ["bot_token", "botToken", "token", "access_token", "accessToken"]) {
    if (source[key]) source[key] = "[redacted]";
  }
  return source;
}

function randomUInt32() {
  return crypto.randomBytes(4).readUInt32BE(0);
}

function wechatClientVersionNumber(version) {
  const parts = String(version || "")
    .match(/\d+/g)
    ?.slice(0, 3)
    .map((part) => Number(part)) || [];
  while (parts.length < 3) parts.push(0);
  const [major, minor, patch] = parts;
  return (major << 16) | (minor << 8) | patch;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isTransientIlinkPollError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return Number(error?.statusCode || error?.status) === 504 || /wechat request timeout|fetch failed|network/i.test(message);
}

function isTelegramAuthError(error) {
  const status = Number(error?.statusCode || error?.status);
  return status === 401 || status === 403;
}

function isTransientTelegramPollError(error) {
  const status = Number(error?.statusCode || error?.status);
  const message = error instanceof Error ? error.message : String(error || "");
  return status === 409 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || /timeout|timed out|fetch failed|network/i.test(message);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
