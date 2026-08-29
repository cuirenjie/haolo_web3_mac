import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  getExternalModelBaseUrl,
  getExternalModelProvider,
  listExternalModelProviders,
  normalizeExternalModelProviderId,
} from "./provider-registry.mjs";

const STORE_VERSION = 1;
const MAX_API_KEY_LENGTH = 16_384;
const MAX_MODEL_LENGTH = 200;

export class ExternalModelCredentialError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ExternalModelCredentialError";
    this.code = code;
  }
}

export class ExternalModelCredentialStore {
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

  async listStatus() {
    const state = await this.readState();
    return listExternalModelProviders().map((provider) => {
      const saved = state.providers[provider.id] || null;
      return publicStatus(provider, saved, this.encryptionAvailable());
    });
  }

  async upsert({ provider: providerValue, apiKey, model, baseUrlProfile, enabled = true } = {}) {
    return this.enqueueMutation(async () => {
      const provider = requireProvider(providerValue);
      const state = await this.readState();
      const previous = state.providers[provider.id] || {};
      const normalizedKey = normalizeApiKey(apiKey);
      if (!normalizedKey && !previous.encryptedApiKey) {
        throw new ExternalModelCredentialError("API_KEY_REQUIRED", `请填写 ${provider.displayName} API Key。`);
      }
      if (!this.encryptionAvailable()) {
        throw new ExternalModelCredentialError(
          "SECURE_STORAGE_UNAVAILABLE",
          "系统安全存储当前不可用，已拒绝用明文保存 API Key。请解锁系统凭据存储后重试。",
        );
      }
      const selectedBaseUrl = selectBaseUrl(provider, baseUrlProfile || previous.baseUrlProfile);
      let encryptedApiKey = previous.encryptedApiKey;
      if (normalizedKey) {
        try {
          encryptedApiKey = this.safeStorage.encryptString(normalizedKey).toString("base64");
        } catch {
          throw new ExternalModelCredentialError(
            "CREDENTIAL_ENCRYPT_FAILED",
            "系统安全存储加密失败，API Key 未保存。请重启 Haolo 后重试。",
          );
        }
      }
      state.providers[provider.id] = {
        model: normalizeModel(model) || normalizeModel(previous.model) || provider.defaultModel,
        baseUrlProfile: selectedBaseUrl.id,
        enabled: enabled !== false,
        encryptedApiKey,
        updatedAt: this.now().toISOString(),
      };
      await this.writeState(state);
      return publicStatus(provider, state.providers[provider.id], true);
    });
  }

  async remove(providerValue) {
    return this.enqueueMutation(async () => {
      const provider = requireProvider(providerValue);
      const state = await this.readState();
      delete state.providers[provider.id];
      await this.writeState(state);
      return publicStatus(provider, null, this.encryptionAvailable());
    });
  }

  async resolve(providerValue) {
    const provider = requireProvider(providerValue);
    const state = await this.readState();
    const saved = state.providers[provider.id];
    if (!saved?.encryptedApiKey || saved.enabled === false) {
      throw new ExternalModelCredentialError("PROVIDER_NOT_CONFIGURED", `${provider.displayName} 尚未配置 API Key。`);
    }
    if (!this.encryptionAvailable()) {
      throw new ExternalModelCredentialError(
        "SECURE_STORAGE_UNAVAILABLE",
        "系统安全存储当前不可用，无法解密 API Key。",
      );
    }
    let apiKey = "";
    try {
      apiKey = this.safeStorage.decryptString(Buffer.from(saved.encryptedApiKey, "base64"));
    } catch {
      throw decryptError(provider);
    }
    if (!apiKey) throw decryptError(provider);
    const selectedBaseUrl = selectBaseUrl(provider, saved.baseUrlProfile);
    return {
      provider,
      apiKey,
      model: normalizeModel(saved.model) || provider.defaultModel,
      baseUrlProfile: selectedBaseUrl.id,
      baseUrl: selectedBaseUrl.baseUrl,
    };
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
      if (!parsed || parsed.version !== STORE_VERSION || !isRecord(parsed.providers)) {
        throw new Error("unsupported credential store format");
      }
      return { version: STORE_VERSION, providers: sanitizeSavedProviders(parsed.providers) };
    } catch (error) {
      if (error?.code === "ENOENT") return emptyState();
      if (error instanceof ExternalModelCredentialError) throw error;
      throw new ExternalModelCredentialError(
        "CREDENTIAL_STORE_INVALID",
        "外部模型凭据库无法读取。为避免覆盖密钥，Haolo 已停止写入；请先备份并修复该文件。",
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
  return { version: STORE_VERSION, providers: {} };
}

function sanitizeSavedProviders(value) {
  const result = {};
  for (const [rawId, rawEntry] of Object.entries(value)) {
    const id = normalizeExternalModelProviderId(rawId);
    if (!id || !isRecord(rawEntry)) continue;
    const encryptedApiKey = typeof rawEntry.encryptedApiKey === "string" ? rawEntry.encryptedApiKey.trim() : "";
    if (!encryptedApiKey) continue;
    result[id] = {
      encryptedApiKey,
      model: normalizeModel(rawEntry.model),
      baseUrlProfile: typeof rawEntry.baseUrlProfile === "string" ? rawEntry.baseUrlProfile.trim() : "",
      enabled: rawEntry.enabled !== false,
      updatedAt: typeof rawEntry.updatedAt === "string" ? rawEntry.updatedAt : null,
    };
  }
  return result;
}

function publicStatus(provider, saved, secureStorageAvailable) {
  const selectedBaseUrl = selectBaseUrl(provider, saved?.baseUrlProfile);
  return {
    ...provider,
    configured: Boolean(saved?.encryptedApiKey),
    enabled: Boolean(saved?.encryptedApiKey) && saved?.enabled !== false,
    model: normalizeModel(saved?.model) || provider.defaultModel,
    baseUrlProfile: selectedBaseUrl.id,
    keyConsoleUrl: selectedBaseUrl.keyConsoleUrl || provider.keyConsoleUrl,
    documentationUrl: selectedBaseUrl.documentationUrl || provider.documentationUrl,
    updatedAt: typeof saved?.updatedAt === "string" ? saved.updatedAt : null,
    secureStorageAvailable,
  };
}

function requireProvider(value) {
  const provider = getExternalModelProvider(value);
  if (!provider) throw new ExternalModelCredentialError("UNKNOWN_PROVIDER", "未知的外部模型供应商。");
  return provider;
}

function selectBaseUrl(provider, profileId) {
  const selected = getExternalModelBaseUrl(provider, profileId);
  if (!selected) throw new ExternalModelCredentialError("INVALID_BASE_URL_PROFILE", "供应商 API 站点配置不正确。");
  return selected;
}

function normalizeApiKey(value) {
  if (value == null) return "";
  if (typeof value !== "string") throw new ExternalModelCredentialError("INVALID_API_KEY", "API Key 格式不正确。");
  const key = value.trim();
  if (key.length > MAX_API_KEY_LENGTH || /[\r\n\0]/.test(key)) {
    throw new ExternalModelCredentialError("INVALID_API_KEY", "API Key 格式不正确。");
  }
  return key;
}

function normalizeModel(value) {
  if (typeof value !== "string") return "";
  const model = value.trim();
  if (!model || model.length > MAX_MODEL_LENGTH || /[\r\n\0]/.test(model)) return "";
  return model;
}

function decryptError(provider) {
  return new ExternalModelCredentialError(
    "CREDENTIAL_DECRYPT_FAILED",
    `${provider.displayName} API Key 无法解密，请删除后重新配置。`,
  );
}

function safeStorageAvailable(safeStorage) {
  if (!safeStorage || typeof safeStorage.encryptString !== "function" || typeof safeStorage.decryptString !== "function") return false;
  try {
    return typeof safeStorage.isEncryptionAvailable !== "function" || safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
