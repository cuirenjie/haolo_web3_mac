import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const STORE_VERSION = 1;
const MAX_OWNER_ID_LENGTH = 2_048;
const MAX_API_KEY_LENGTH = 512;
const MAX_API_SECRET_LENGTH = 2_048;

export class BinanceCredentialError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BinanceCredentialError";
    this.code = code;
  }
}

export class BinanceCredentialStore {
  constructor({ storagePath, safeStorage, now = () => new Date() } = {}) {
    if (!storagePath) throw new Error("storagePath is required");
    this.storagePath = path.resolve(storagePath);
    this.safeStorage = safeStorage;
    this.now = now;
    this.mutationQueue = Promise.resolve();
  }

  encryptionAvailable() {
    return safeStorageAvailable(this.safeStorage);
  }

  async status(ownerId) {
    const state = await this.readState();
    return publicStatus(state.connections[ownerHash(ownerId)] || null, this.encryptionAvailable());
  }

  async upsert(ownerId, { apiKey, apiSecret } = {}) {
    return this.enqueueMutation(async () => {
      const owner = ownerHash(ownerId);
      const normalizedApiKey = normalizeApiKey(apiKey);
      const normalizedApiSecret = normalizeApiSecret(apiSecret);
      if (!this.encryptionAvailable()) {
        throw new BinanceCredentialError(
          "SECURE_STORAGE_UNAVAILABLE",
          "系统安全存储当前不可用，Haolo 已拒绝用明文保存 Binance API 凭据。请解锁系统凭据存储后重试。",
        );
      }
      let encryptedCredentials = "";
      try {
        encryptedCredentials = this.safeStorage
          .encryptString(JSON.stringify({ apiKey: normalizedApiKey, apiSecret: normalizedApiSecret }))
          .toString("base64");
      } catch {
        throw new BinanceCredentialError(
          "CREDENTIAL_ENCRYPT_FAILED",
          "系统安全存储加密失败，Binance API 凭据未保存。请重启 Haolo 后重试。",
        );
      }
      const state = await this.readState();
      const previous = state.connections[owner] || null;
      const timestamp = this.now().toISOString();
      state.connections[owner] = {
        encryptedCredentials,
        apiKeyMasked: maskApiKey(normalizedApiKey),
        boundAt: previous?.boundAt || timestamp,
        updatedAt: timestamp,
      };
      await this.writeState(state);
      return publicStatus(state.connections[owner], true);
    });
  }

  async resolve(ownerId) {
    const state = await this.readState();
    const saved = state.connections[ownerHash(ownerId)] || null;
    if (!saved?.encryptedCredentials) {
      throw new BinanceCredentialError("NOT_BOUND", "尚未绑定 Binance API。");
    }
    if (!this.encryptionAvailable()) {
      throw new BinanceCredentialError(
        "SECURE_STORAGE_UNAVAILABLE",
        "系统安全存储当前不可用，无法读取 Binance API 凭据。",
      );
    }
    try {
      const plaintext = this.safeStorage.decryptString(
        Buffer.from(saved.encryptedCredentials, "base64"),
      );
      const parsed = JSON.parse(plaintext);
      return {
        apiKey: normalizeApiKey(parsed?.apiKey),
        apiSecret: normalizeApiSecret(parsed?.apiSecret),
      };
    } catch (error) {
      if (error instanceof BinanceCredentialError) throw error;
      throw new BinanceCredentialError(
        "CREDENTIAL_DECRYPT_FAILED",
        "Binance API 凭据无法解密，请解除绑定后重新配置。",
      );
    }
  }

  async remove(ownerId) {
    return this.enqueueMutation(async () => {
      const state = await this.readState();
      delete state.connections[ownerHash(ownerId)];
      await this.writeState(state);
      return publicStatus(null, this.encryptionAvailable());
    });
  }

  enqueueMutation(task) {
    const result = this.mutationQueue.then(task, task);
    this.mutationQueue = result.catch(() => {});
    return result;
  }

  async readState() {
    try {
      const text = await fs.promises.readFile(this.storagePath, "utf8");
      const parsed = JSON.parse(text);
      if (!parsed || parsed.version !== STORE_VERSION || !isRecord(parsed.connections)) {
        throw new Error("unsupported credential store format");
      }
      return {
        version: STORE_VERSION,
        connections: sanitizeConnections(parsed.connections),
      };
    } catch (error) {
      if (error?.code === "ENOENT") return emptyState();
      if (error instanceof BinanceCredentialError) throw error;
      throw new BinanceCredentialError(
        "CREDENTIAL_STORE_INVALID",
        "Binance 凭据库无法读取。为避免覆盖密钥，Haolo 已停止写入；请先备份并修复该文件。",
      );
    }
  }

  async writeState(state) {
    await fs.promises.mkdir(path.dirname(this.storagePath), { recursive: true });
    const temporaryPath = `${this.storagePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.promises.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await fs.promises.rename(temporaryPath, this.storagePath);
    } finally {
      await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    }
  }
}

function emptyState() {
  return { version: STORE_VERSION, connections: {} };
}

function sanitizeConnections(value) {
  const result = {};
  for (const [owner, rawEntry] of Object.entries(value)) {
    if (!/^[a-f0-9]{64}$/.test(owner) || !isRecord(rawEntry)) continue;
    const encryptedCredentials = stringValue(rawEntry.encryptedCredentials);
    if (!encryptedCredentials) continue;
    result[owner] = {
      encryptedCredentials,
      apiKeyMasked: stringValue(rawEntry.apiKeyMasked),
      boundAt: isoString(rawEntry.boundAt),
      updatedAt: isoString(rawEntry.updatedAt),
    };
  }
  return result;
}

function publicStatus(saved, secureStorageAvailable) {
  return {
    bound: Boolean(saved?.encryptedCredentials),
    apiKeyMasked: saved?.apiKeyMasked || null,
    boundAt: saved?.boundAt || null,
    updatedAt: saved?.updatedAt || null,
    secureStorageAvailable,
  };
}

function ownerHash(value) {
  if (typeof value !== "string") {
    throw new BinanceCredentialError("INVALID_OWNER", "当前 Haolo 账号身份无效。请重新登录后重试。");
  }
  const ownerId = value.trim();
  if (!ownerId || ownerId.length > MAX_OWNER_ID_LENGTH || /[\r\n\0]/.test(ownerId)) {
    throw new BinanceCredentialError("INVALID_OWNER", "当前 Haolo 账号身份无效。请重新登录后重试。");
  }
  return crypto.createHash("sha256").update(ownerId, "utf8").digest("hex");
}

function normalizeApiKey(value) {
  if (typeof value !== "string") {
    throw new BinanceCredentialError("INVALID_API_KEY", "请输入正确的 Binance API Key。");
  }
  const result = value.trim();
  if (!result || result.length > MAX_API_KEY_LENGTH || /[\s\0]/.test(result)) {
    throw new BinanceCredentialError("INVALID_API_KEY", "请输入正确的 Binance API Key。");
  }
  return result;
}

function normalizeApiSecret(value) {
  if (typeof value !== "string") {
    throw new BinanceCredentialError("INVALID_API_SECRET", "请输入正确的 Binance Secret Key。");
  }
  const result = value.trim();
  if (!result || result.length > MAX_API_SECRET_LENGTH || /[\r\n\0]/.test(result)) {
    throw new BinanceCredentialError("INVALID_API_SECRET", "请输入正确的 Binance Secret Key。");
  }
  return result;
}

function maskApiKey(value) {
  if (value.length <= 8) return `${value.slice(0, 2)}••••${value.slice(-2)}`;
  return `${value.slice(0, 4)}••••••${value.slice(-4)}`;
}

function safeStorageAvailable(safeStorage) {
  if (!safeStorage || typeof safeStorage.encryptString !== "function" || typeof safeStorage.decryptString !== "function") return false;
  try {
    return typeof safeStorage.isEncryptionAvailable !== "function" || safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isoString(value) {
  const result = stringValue(value);
  return result && Number.isFinite(Date.parse(result)) ? result : null;
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
