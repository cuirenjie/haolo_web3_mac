import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  CHROME_EFFECT_LEVELS,
  HAOLO_CHROME_PROTOCOL_VERSION,
  chromeToolEffectLevel,
  createChromeEnvelope,
  validateChromeEnvelope,
} from "./contract.mjs";
import { redactChromeLogValue } from "./policy.mjs";
import {
  chromeExtensionCompatibility,
  chromeRolloutDecision,
  normalizeChromeReleasePolicy,
} from "./release-policy.mjs";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_LINE_BYTES = 1024 * 1024;

export class ChromeNativeBroker extends EventEmitter {
  constructor({
    userDataPath,
    extensionOrigins,
    desktopExecutable = process.execPath,
    releasePolicy,
    installationKey = userDataPath,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    logger = console,
  } = {}) {
    super();
    if (!userDataPath) throw new TypeError("ChromeNativeBroker requires userDataPath");
    this.userDataPath = path.resolve(userDataPath);
    this.extensionOrigins = normalizeExtensionOrigins(extensionOrigins);
    if (!this.extensionOrigins.length) throw new TypeError("ChromeNativeBroker requires at least one extension origin");
    this.desktopExecutable = path.resolve(desktopExecutable);
    this.releasePolicy = normalizeChromeReleasePolicy(releasePolicy);
    this.release = chromeRolloutDecision(this.releasePolicy, installationKey);
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.pipeName = chromeNativePipeName(this.userDataPath);
    this.pipePath = process.platform === "win32" ? `\\\\.\\pipe\\${this.pipeName}` : path.join(this.userDataPath, `${this.pipeName}.sock`);
    this.token = null;
    this.server = null;
    this.clients = new Set();
    this.profiles = new Map();
    this.pending = new Map();
  }

  async start() {
    if (this.server) return this.status();
    await fs.promises.mkdir(this.userDataPath, { recursive: true });
    if (process.platform !== "win32") await fs.promises.rm(this.pipePath, { force: true }).catch(() => {});
    this.token = crypto.randomBytes(32).toString("base64url");
    await writeChromeNativeHostConfig(this.configPath(), {
      protocolVersion: HAOLO_CHROME_PROTOCOL_VERSION,
      pipeName: this.pipeName,
      token: this.token,
      expectedOrigins: this.extensionOrigins,
      desktopExecutable: this.desktopExecutable,
      updatedAt: new Date().toISOString(),
    });
    const server = net.createServer((socket) => this.#accept(socket));
    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      server.once("error", onError);
      server.listen(this.pipePath, () => {
        server.off("error", onError);
        resolve();
      });
    });
    this.server = server;
    this.emit("status", this.status());
    return this.status();
  }

  configPath() {
    return path.join(this.userDataPath, "chrome-native-host.json");
  }

  status() {
    return {
      protocolVersion: HAOLO_CHROME_PROTOCOL_VERSION,
      running: Boolean(this.server),
      pipeName: this.pipeName,
      profileCount: this.profiles.size,
      profiles: [...this.profiles.values()].map((client) => ({
        profileId: client.profileId,
        sessionId: client.sessionId,
        extensionVersion: client.extensionVersion,
        compatibility: client.compatibility,
        connectedAt: client.connectedAt,
        lastSeenAt: client.lastSeenAt,
      })),
      release: this.release,
    };
  }

  async call(profileId, type, payload = {}, context = {}) {
    const client = this.profiles.get(String(profileId || ""));
    if (!client || client.socket.destroyed) throw brokerError("CHROME_PROFILE_DISCONNECTED", "Chrome profile is not connected.", "transport", true);
    this.#assertReleaseAllows(client, type, payload);
    const envelope = createChromeEnvelope({
      type,
      sessionId: client.sessionId,
      profileId: client.profileId,
      threadId: context.threadId,
      turnId: context.turnId,
      taskId: context.taskId,
      grantId: context.grantId,
      payload,
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(envelope.requestId);
        reject(brokerError("CHROME_EXTENSION_TIMEOUT", `Chrome extension did not respond within ${this.timeoutMs}ms.`, "timeout", true));
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(envelope.requestId, { resolve, reject, timer, profileId: client.profileId });
      try {
        writeLine(client.socket, envelope);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(envelope.requestId);
        reject(error);
      }
    });
  }

  async stop() {
    const server = this.server;
    this.server = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(brokerError("CHROME_BROKER_STOPPED", "Chrome broker stopped.", "cancelled", false));
    }
    this.pending.clear();
    for (const client of this.clients) client.socket.destroy();
    this.clients.clear();
    this.profiles.clear();
    if (server) {
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    }
    if (process.platform !== "win32") await fs.promises.rm(this.pipePath, { force: true }).catch(() => {});
    this.emit("status", this.status());
  }

  #accept(socket) {
    socket.setEncoding("utf8");
    const client = {
      socket,
      buffer: "",
      authenticated: false,
      origin: null,
      profileId: null,
      sessionId: null,
      extensionVersion: null,
      compatibility: null,
      connectedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    this.clients.add(client);
    socket.on("data", (chunk) => this.#receive(client, chunk));
    socket.on("error", (error) => this.logger.warn?.("[chrome] native host socket error", error?.message || error));
    socket.on("close", () => this.#disconnect(client));
  }

  #receive(client, chunk) {
    client.buffer += chunk;
    if (Buffer.byteLength(client.buffer, "utf8") > MAX_LINE_BYTES) {
      client.socket.destroy(brokerError("CHROME_MESSAGE_TOO_LARGE", "Chrome native message exceeds 1 MiB.", "protocol", false));
      return;
    }
    while (true) {
      const newline = client.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = client.buffer.slice(0, newline).trim();
      client.buffer = client.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        writeLine(client.socket, errorMessage(null, "CHROME_MESSAGE_INVALID", "Invalid JSON from Chrome Native Host."));
        continue;
      }
      try {
        this.#message(client, message);
      } catch (error) {
        writeLine(client.socket, errorMessage(message?.requestId, error?.code, error?.message));
        if (!client.authenticated) client.socket.end();
      }
    }
  }

  #message(client, message) {
    client.lastSeenAt = new Date().toISOString();
    if (!client.authenticated) {
      this.#authenticate(client, message);
      return;
    }
    if (message?.type === "extension.hello") {
      this.#registerProfile(client, message);
      return;
    }
    const envelope = validateChromeEnvelope(message);
    if (!client.profileId || envelope.profileId !== client.profileId || envelope.sessionId !== client.sessionId) {
      throw brokerError("CHROME_SESSION_MISMATCH", "Chrome message does not match the authenticated session.", "policy", false);
    }
    if (envelope.type === "tool.result" || envelope.type === "tool.error") {
      const pending = this.pending.get(envelope.requestId);
      if (!pending || pending.profileId !== client.profileId) return;
      clearTimeout(pending.timer);
      this.pending.delete(envelope.requestId);
      if (envelope.type === "tool.error") {
        const error = brokerError(
          envelope.payload?.code || "CHROME_EXTENSION_ERROR",
          envelope.payload?.message || "Chrome extension operation failed.",
          envelope.payload?.category || "execution",
          Boolean(envelope.payload?.retryable),
        );
        pending.reject(error);
      } else {
        pending.resolve(envelope.payload);
      }
      return;
    }
    this.emit("message", { profileId: client.profileId, envelope: structuredClone(envelope) });
    this.emit("audit", { profileId: client.profileId, envelope: redactChromeLogValue(envelope) });
  }

  #authenticate(client, message) {
    if (message?.type !== "host.hello" || message?.protocolVersion !== HAOLO_CHROME_PROTOCOL_VERSION) {
      throw brokerError("CHROME_HOST_HANDSHAKE_INVALID", "Chrome Native Host handshake is invalid.", "protocol", false);
    }
    const supplied = Buffer.from(String(message.token || ""), "utf8");
    const expected = Buffer.from(String(this.token || ""), "utf8");
    if (!supplied.length || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      throw brokerError("CHROME_HOST_UNAUTHORIZED", "Chrome Native Host token is invalid.", "policy", false);
    }
    const origin = normalizeExtensionOrigin(message.origin);
    if (!this.extensionOrigins.includes(origin)) {
      throw brokerError("CHROME_EXTENSION_UNAUTHORIZED", "Chrome extension origin is not allowed.", "policy", false);
    }
    client.authenticated = true;
    client.origin = origin;
    writeLine(client.socket, {
      protocolVersion: HAOLO_CHROME_PROTOCOL_VERSION,
      type: "host.ready",
      requestId: message.requestId || null,
      payload: { ok: true },
    });
  }

  #registerProfile(client, message) {
    const profileId = String(message.profileId || message.payload?.profileId || "").trim();
    if (!/^profile_[a-zA-Z0-9_-]{8,128}$/.test(profileId)) {
      throw brokerError("CHROME_PROFILE_INVALID", "Chrome profile instance id is invalid.", "protocol", false);
    }
    const previous = this.profiles.get(profileId);
    if (previous && previous !== client) previous.socket.destroy();
    client.profileId = profileId;
    client.sessionId = `chrome_session_${crypto.randomUUID()}`;
    client.extensionVersion = String(message.extensionVersion || message.payload?.extensionVersion || "").slice(0, 64) || null;
    client.compatibility = chromeExtensionCompatibility(client.extensionVersion, this.releasePolicy);
    this.profiles.set(profileId, client);
    writeLine(client.socket, createChromeEnvelope({
      type: "extension.ready",
      requestId: message.requestId || crypto.randomUUID(),
      sessionId: client.sessionId,
      profileId,
      payload: {
        brokerVersion: HAOLO_CHROME_PROTOCOL_VERSION,
        connected: client.compatibility.readEnabled && this.release.enabled,
        compatibility: client.compatibility,
        release: this.release,
      },
    }));
    this.emit("status", this.status());
  }

  #assertReleaseAllows(client, type, payload) {
    if (!this.release.enabled) {
      throw brokerError("CHROME_RELEASE_DISABLED", "Haolo Chrome is disabled for this release cohort.", "policy", false);
    }
    if (!client.compatibility?.readEnabled) {
      throw brokerError("CHROME_EXTENSION_VERSION_INCOMPATIBLE", "This Haolo Chrome extension version is not compatible with the desktop client.", "protocol", false);
    }
    const tool = type === "tool.call" ? String(payload?.tool || "") : null;
    const effect = tool ? chromeToolEffectLevel(tool) : null;
    const requiresWrite = type === "task.tab.create" || (effect && effect !== CHROME_EFFECT_LEVELS.OBSERVE);
    if (requiresWrite && (!this.release.writeEnabled || !client.compatibility.writeEnabled)) {
      throw brokerError("CHROME_WRITE_DISABLED", "Chrome write operations are disabled for this release or version.", "policy", false);
    }
  }

  #disconnect(client) {
    this.clients.delete(client);
    if (client.profileId && this.profiles.get(client.profileId) === client) this.profiles.delete(client.profileId);
    for (const [requestId, pending] of this.pending) {
      if (pending.profileId !== client.profileId) continue;
      clearTimeout(pending.timer);
      this.pending.delete(requestId);
      pending.reject(brokerError("CHROME_PROFILE_DISCONNECTED", "Chrome profile disconnected.", "transport", true));
    }
    this.emit("status", this.status());
  }
}

export function chromeNativePipeName(userDataPath, user = os.userInfo().username) {
  const identity = `${String(user || "").toLowerCase()}|${path.resolve(userDataPath).replace(/\\/g, "/").toLowerCase()}`;
  return `haolo-chrome-${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
}

export async function writeChromeNativeHostConfig(configPath, config) {
  const target = path.resolve(configPath);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.promises.writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.promises.rename(temp, target);
  await fs.promises.chmod(target, 0o600).catch(() => {});
  return target;
}

function normalizeExtensionOrigins(values) {
  const list = Array.isArray(values) ? values : typeof values === "string" ? [values] : [];
  return [...new Set(list.map(normalizeExtensionOrigin))];
}

function normalizeExtensionOrigin(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!/^chrome-extension:\/\/[a-p]{32}$/i.test(text)) throw brokerError("CHROME_EXTENSION_ORIGIN_INVALID", "Chrome extension origin is invalid.", "protocol", false);
  return `${text.toLowerCase()}/`;
}

function writeLine(socket, value) {
  if (!socket || socket.destroyed) throw brokerError("CHROME_PROFILE_DISCONNECTED", "Chrome native connection is closed.", "transport", true);
  socket.write(`${JSON.stringify(value)}\n`, "utf8");
}

function errorMessage(requestId, code, message) {
  return {
    protocolVersion: HAOLO_CHROME_PROTOCOL_VERSION,
    type: "host.error",
    requestId: requestId || null,
    payload: { code: code || "CHROME_HOST_ERROR", message: message || "Chrome host error." },
  };
}

function brokerError(code, message, category, retryable) {
  const error = new Error(message);
  error.code = code;
  error.category = category;
  error.retryable = retryable;
  return error;
}
